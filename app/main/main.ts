/**
 * Edward's desktop app: one window, a tray icon, and the same core as the terminal version running
 * in this (main) process. The window is sandboxed: no Node, no remote content, and only the methods
 * in shared/api.ts through preload.
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, session as electronSession, shell, Tray } from "electron";
import { appendFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { AUMID } from "../../src/background/notify.js";
import { runtime } from "../../src/runtime.js";
import "./builtin.js";
import { handleScheme, registerScheme } from "./images.js";
import { handleMailScheme, MAIL_PRIVILEGES, MAIL_SCHEME } from "./mailview.js";
import { EdwardService } from "./service.js";
import type { EdwardApi, EdwardEvent } from "../shared/api.js";

const here = import.meta.dirname; // build/main
const ICON = join(here, "..", "icon.png");
const RENDERER = join(here, "..", "renderer", "index.html");
const PRELOAD = join(here, "..", "preload", "preload.cjs");
/** Packaged, these live in app.asar.unpacked: Windows (toasts) and plain Node (the tick) need real files. */
const unpacked = (p: string) => p.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);

// Background reminders run this same executable as plain Node with the bundled tick script.
runtime.iconPath = unpacked(ICON);
runtime.tick = { exe: process.execPath, args: [unpacked(join(here, "tick.js"))], env: { ELECTRON_RUN_AS_NODE: "1" } };

/** Test hook: EDWARD_SHOT="page=file.png;page2=file2.png" renders those pages hidden and saves pictures, then quits. */
const SHOTS = (process.env.EDWARD_SHOT ?? "").split(";").filter(Boolean).map((s) => s.split("=") as [string, string]);
if (SHOTS.length) {
  runtime.silent = true;
  runtime.noBackgroundWork = true;
  // Its own browser profile, so a check can run while the installed Edward is open.
  app.setPath("userData", join(app.getPath("temp"), "edward-shot"));
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let service: EdwardService;

if (!SHOTS.length && !app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId(AUMID);
registerScheme([MAIL_PRIVILEGES]);

const shotListeners: ((e: EdwardEvent) => void)[] = [];
const emit = (e: EdwardEvent) => {
  for (const l of shotListeners) l(e);
  win?.webContents.send("edward:event", e);
};

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1020,
    minHeight: 680,
    show: false,
    title: "Edward",
    icon: ICON,
    backgroundColor: "#F3F6FA",
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  win.removeMenu();
  // Nothing navigates away from Edward's own page, and the email frame stays on the email it was
  // given (no refresh, no link that replaces it); links open in the browser, web addresses only.
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("will-frame-navigate", (e) => {
    if (!e.isMainFrame && !e.url.startsWith(`${MAIL_SCHEME}://page/`)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("close", (e) => {
    // Closing the window keeps Edward in the tray, so reminders still pop up; Quit is in the tray menu.
    if (!quitting && !SHOTS.length) {
      e.preventDefault();
      win?.hide();
    }
  });
  if (!SHOTS.length) win.once("ready-to-show", () => win?.show());
  void win.loadFile(RENDERER);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip("Edward");
  const open = () => {
    if (!win) createWindow();
    win!.show();
    win!.focus();
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Edward", click: open },
      { type: "separator" },
      { label: "Quit Edward", click: () => ((quitting = true), app.quit()) },
    ]),
  );
  tray.on("click", open);
}

const METHODS = new Set<keyof EdwardApi>([
  "state", "signIn", "send", "interrupt", "newConversation", "conversations", "openConversation", "transcript", "setMode", "answer",
  "attachFiles", "attachClipboard", "removeAttachment", "today", "calendar", "mail", "mailMessage", "mailOriginal", "mailList", "calendarRange", "calendarTargets", "eventSave", "eventDelete", "mailCompose", "mailCheck", "mailSend", "mailSaveDraft", "mailWrite", "bills", "billHistory", "billAction",
  "billEdit", "billScan", "billMonth", "billExport", "forgetBills", "reminders", "reminderAction", "memory", "memoryAdd", "memoryEdit",
  "memoryForget", "memoryReview", "memoryUndo", "memoryExport", "pictures", "pictureAction", "settings", "updateSettings", "chooseImagesFolder",
  "doctor", "data", "backup", "exportAll", "openDataFolder", "deleteEverything", "google", "chooseGoogleClient", "connectGoogle", "checkGoogle",
  "disconnectGoogle", "updateAccount", "setDefaultAccount", "openGuide", "finishSetup",
]);

app.on("second-instance", () => {
  win?.show();
  win?.focus();
});

app.on("before-quit", () => {
  quitting = true;
  service?.close();
});

app.whenReady().then(async () => {
  handleScheme();
  handleMailScheme();
  // The page needs no camera, microphone, location or notifications from Chromium.
  electronSession.defaultSession.setPermissionRequestHandler((_wc, _perm, done) => done(false));
  service = new EdwardService(emit, () => win);
  ipcMain.handle("edward:call", async (e, method: string, args: unknown[]) => {
    // Only Edward's own page, and only the listed methods.
    if (!e.senderFrame?.url.startsWith("file://") || !METHODS.has(method as keyof EdwardApi)) throw new Error("not allowed");
    const fn = (service as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!;
    return fn.apply(service, Array.isArray(args) ? args : []);
  });
  const started = service.start().catch((e) => emit({ type: "notice", lines: [`Edward couldn't start: ${e instanceof Error ? e.message : String(e)}`] }));
  ipcMain.handle("edward:ready", () => started.then(() => true));
  createWindow();
  if (SHOTS.length) return takeShots();
  createTray();
});

app.on("window-all-closed", () => {
  if (SHOTS.length) app.quit();
  // otherwise stay in the tray
});

async function takeShots() {
  const w = win!;
  // The packaged GUI has no console attached; the page's messages go to a file when asked.
  const log = process.env.EDWARD_SHOT_LOG;
  if (log) w.webContents.on("console-message", (e) => appendFileSync(log, `[page ${e.level}] ${e.message}\n`));
  await new Promise<void>((r) => w.webContents.once("did-finish-load", () => r()));
  // EDWARD_SHOT_SAY: send this message first and wait for the reply (or for a card asking for an OK).
  const say = process.env.EDWARD_SHOT_SAY;
  if (say) {
    await w.webContents.executeJavaScript("window.edward.ready()");
    let asked = false;
    const off = (e: EdwardEvent) => void (e.type === "ask" && (asked = true));
    shotListeners.push(off);
    void service.send(say);
    const until = Date.now() + 150_000;
    await new Promise((r) => setTimeout(r, 1500));
    while (Date.now() < until && service.session.busy && !asked) await new Promise((r) => setTimeout(r, 500));
    await new Promise((r) => setTimeout(r, 1500));
  }
  for (const [page, file] of SHOTS) {
    emit({ type: "navigate", to: page });
    await new Promise((r) => setTimeout(r, Number(process.env.EDWARD_SHOT_WAIT ?? 2500)));
    // EDWARD_SHOT_JS: run this in the page before the picture (e.g. click a button), then wait again.
    if (process.env.EDWARD_SHOT_JS) {
      await w.webContents.executeJavaScript(process.env.EDWARD_SHOT_JS).catch((e: unknown) => log && appendFileSync(log, `[shot js] ${String(e)}\n`));
      await new Promise((r) => setTimeout(r, Number(process.env.EDWARD_SHOT_WAIT ?? 2500)));
    }
    const img = await w.webContents.capturePage();
    writeFileSync(file, img.toPNG());
  }
  quitting = true;
  app.quit();
}
