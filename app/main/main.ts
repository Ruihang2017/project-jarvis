/**
 * Edward's desktop app: one window, a tray icon, and the same core as the terminal version running
 * in this (main) process. The window is sandboxed: no Node, no remote content, and only the methods
 * in shared/api.ts through preload.
 */
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, session as electronSession, shell, systemPreferences, Tray } from "electron";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { AUMID } from "../../src/background/notify.js";
import { runtime } from "../../src/runtime.js";
import { envVar } from "../../src/settings.js";
import { INSTALL_CODEX, SHELL_NAME } from "../../src/config.js";
import { demoGoogle } from "../../src/demo/google.js";
import "./builtin.js";
import { handleScheme, registerScheme } from "./images.js";
import { handleMailScheme, MAIL_PRIVILEGES, MAIL_SCHEME } from "./mailview.js";
import { EdwardService } from "./service.js";
import { record, type Step } from "./record.js";
import type { EdwardApi, EdwardEvent } from "../shared/api.js";

const MAC = process.platform === "darwin";
const here = import.meta.dirname; // build/main
const ICON = join(here, "..", "icon.png");
const RENDERER = join(here, "..", "renderer", "index.html");
const PRELOAD = join(here, "..", "preload", "preload.cjs");
/** Packaged, these live in app.asar.unpacked: notifications and plain Node (the tick) need real files. */
const unpacked = (p: string) => p.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);

// Background reminders run this same executable as plain Node with the bundled tick script.
runtime.iconPath = unpacked(ICON);
runtime.tick = { exe: process.execPath, args: [unpacked(join(here, "tick.js"))], env: { ELECTRON_RUN_AS_NODE: "1" } };

// On a Mac Electron's own folder would be the same one as Edward's data (~/Library/Application
// Support/Edward); the browser's caches go next to it instead, so backups and exports stay clean.
if (MAC) app.setPath("userData", join(app.getPath("appData"), "Edward-app"));

/** Test hook: EDWARD_SHOT="page=file.png;page2=file2.png" renders those pages hidden and saves pictures, then quits. */
const SHOTS = (process.env.EDWARD_SHOT ?? "").split(";").filter(Boolean).map((s) => s.split("=") as [string, string]);
/** Tutorial videos (D44): EDWARD_RECORD=<steps.json> EDWARD_RECORD_OUT=<folder> plays the steps and saves frames (record.ts). */
const RECORD = process.env.EDWARD_RECORD;
/** A hidden, automated run: screenshots or a recording. */
const AUTOMATED = SHOTS.length > 0 || Boolean(RECORD);
/**
 * Demo mode (D44): Google answered from made-up data, for the tutorial videos. Only with its own data
 * folder (filled by app/scripts/demo.ts), so it can never mix with real accounts.
 */
if (process.env.EDWARD_DEMO) {
  if (!envVar("DATA_DIR")) throw new Error("EDWARD_DEMO needs EDWARD_DATA_DIR: a separate folder made by app/scripts/demo.ts");
  runtime.googleHttp = demoGoogle();
  runtime.silent = true;
  app.setPath("userData", join(app.getPath("temp"), "edward-demo"));
}
if (AUTOMATED) {
  runtime.silent = true;
  runtime.noBackgroundWork = true;
  // Its own browser profile, so a check can run while the installed Edward is open.
  app.setPath("userData", join(app.getPath("temp"), "edward-shot"));
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let service: EdwardService;

if (!AUTOMATED && !app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId(AUMID);
registerScheme([MAIL_PRIVILEGES]);

const shotListeners: ((e: EdwardEvent) => void)[] = [];
const emit = (e: EdwardEvent) => {
  for (const l of shotListeners) l(e);
  // While quitting, Codex's exit and late background results arrive after the window is gone.
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("edward:event", e);
};

function createWindow() {
  win = new BrowserWindow({
    // Recordings are 16:9 (1440×810 of page, at the screen's scale).
    ...(RECORD ? { width: 1440, height: 810, useContentSize: true } : { width: 1360, height: 860 }),
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
  if (!MAC) win.removeMenu();
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
    // Closing the window keeps Edward running, so reminders still pop up: in the tray on Windows (Quit
    // is in its menu), in the Dock on a Mac (Cmd+Q quits).
    if (!quitting && !AUTOMATED) {
      e.preventDefault();
      win?.hide();
    }
  });
  if (!AUTOMATED) win.once("ready-to-show", () => win?.show());
  void win.loadFile(RENDERER);
}

const openWindow = () => {
  if (!win || win.isDestroyed()) createWindow();
  win!.show();
  win!.focus();
};

/**
 * A Mac app has its menu at the top of the screen, and the usual shortcuts (copy, paste, undo, close,
 * quit) only work through it.
 */
function createMacMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }, { type: "separator" }, { label: "Edward", click: openWindow }] },
    ]),
  );
}

/** Notifications from the app itself on a Mac: they say Edward and open it when clicked. */
function macNotifications() {
  const showing = new Map<string, Notification>();
  runtime.notify = (t) => {
    if (!Notification.isSupported()) return false;
    const [first = "", ...rest] = t.body.split("\n").filter(Boolean);
    const n = new Notification({ title: t.title, subtitle: rest.length ? first : undefined, body: rest.length ? rest.slice(0, 2).join("\n") : first });
    n.on("click", openWindow);
    // One per tag, as on Windows; and kept until it is gone, or it could be collected before it is clicked.
    const key = t.tag ?? `${Date.now()}-${showing.size}`;
    showing.get(key)?.close();
    showing.set(key, n);
    n.on("close", () => showing.get(key) === n && showing.delete(key));
    n.show();
    return true;
  };
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip("Edward");
  const open = openWindow;
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
  "state", "signIn", "aiUseKey", "send", "interrupt", "newConversation", "conversations", "openConversation", "transcript", "setMode", "answer",
  "attachFiles", "attachClipboard", "removeAttachment", "today", "calendar", "mail", "mailMessage", "mailOriginal", "mailDigest", "tripAction", "tripBuffer", "tripScan",
  "mailSummarize", "mailList", "calendarRange", "calendarTargets", "voiceInfo", "voiceSaveKey", "voiceRemoveKey", "voiceSetVoice", "voiceConnect", "voiceHeard", "voiceUsage", "lists", "listCreate", "listAdd", "listUpdate", "listRemove", "eventSave", "eventDelete", "mailCompose", "mailCheck", "mailSend", "mailSaveDraft", "mailWrite", "mailDrafts", "mailDraftOpen", "bills", "billHistory", "billAction",
  "billEdit", "billScan", "billMonth", "billExport", "forgetBills", "reminders", "reminderAction", "memory", "memoryAdd", "memoryEdit",
  "memoryForget", "memoryReview", "memoryUndo", "memoryExport", "pictures", "pictureAction", "settings", "updateSettings", "chooseImagesFolder",
  "doctor", "data", "backup", "exportAll", "openDataFolder", "deleteEverything", "google", "chooseGoogleClient", "connectGoogle", "checkGoogle",
  "disconnectGoogle", "updateAccount", "setDefaultAccount", "openGuide", "finishSetup",
]);

app.on("second-instance", () => {
  win?.show();
  win?.focus();
});

// Clicking the Dock icon brings the window back.
app.on("activate", () => {
  if (app.isReady() && !AUTOMATED) openWindow();
});

app.on("before-quit", () => {
  quitting = true;
  service?.close();
});

app.whenReady().then(async () => {
  handleScheme();
  handleMailScheme();
  // The page needs no camera, location or notifications from Chromium. The microphone, for voice (V),
  // only for Edward's own page and only audio; the email frame never gets it.
  const ownPage = (url: string | undefined) => Boolean(url?.startsWith("file://"));
  electronSession.defaultSession.setPermissionRequestHandler((wc, perm, done, details) => {
    const audioOnly = perm === "media" && "mediaTypes" in details && (details.mediaTypes ?? []).length > 0 && (details.mediaTypes ?? []).every((t) => t === "audio");
    const allowed = audioOnly && wc === win?.webContents && ownPage(details.requestingUrl) && details.isMainFrame !== false;
    // macOS asks the user itself, once, the first time (the reason shown is in the app's Info.plist).
    if (allowed && MAC) void systemPreferences.askForMediaAccess("microphone").then(done, () => done(false));
    else done(allowed);
  });
  electronSession.defaultSession.setPermissionCheckHandler((wc, perm, origin, details) => perm === "media" && details.mediaType !== "video" && wc === win?.webContents && (ownPage(origin) || origin === "file:///" || ownPage(details.requestingUrl)));
  service = new EdwardService(emit, () => win);
  ipcMain.handle("edward:call", async (e, method: string, args: unknown[]) => {
    // Only Edward's own page, and only the listed methods.
    if (!e.senderFrame?.url.startsWith("file://") || !METHODS.has(method as keyof EdwardApi)) throw new Error("not allowed");
    const fn = (service as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!;
    return fn.apply(service, Array.isArray(args) ? args : []);
  });
  const started = service.start().catch((e) => {
    const message = e instanceof Error ? e.message : String(e);
    // The usual first-start problem: Codex isn't installed yet.
    const lines = /ENOENT|not recognized|spawn codex/i.test(message)
      ? ["Edward needs Codex, OpenAI's free app that connects to your ChatGPT account.", `Open ${SHELL_NAME} and run:  ${INSTALL_CODEX}  then open Edward again.`]
      : [`Edward couldn't start: ${message}`];
    emit({ type: "notice", lines });
  });
  ipcMain.handle("edward:ready", () => started.then(() => true));
  createWindow();
  if (RECORD) return makeRecording(RECORD);
  if (SHOTS.length) return takeShots();
  if (MAC) {
    // No menu-bar icon: the Dock icon is there while Edward runs.
    createMacMenu();
    macNotifications();
  } else createTray();
});

app.on("window-all-closed", () => {
  if (AUTOMATED) app.quit();
  // otherwise stay in the tray (Windows) or the Dock (Mac)
});

async function makeRecording(stepsFile: string) {
  const w = win!;
  await new Promise<void>((r) => w.webContents.once("did-finish-load", () => r()));
  await w.webContents.executeJavaScript("window.edward.ready()");
  await new Promise((r) => setTimeout(r, 2500));
  const out = process.env.EDWARD_RECORD_OUT ?? join(app.getPath("temp"), "edward-recording");
  mkdirSync(out, { recursive: true });
  try {
    const steps = JSON.parse(readFileSync(stepsFile, "utf8")) as Step[];
    const r = await record(w, steps, out, { navigate: (to) => emit({ type: "navigate", to }), busy: () => service.session.busy });
    writeFileSync(join(out, "done.json"), JSON.stringify(r));
  } catch (e) {
    writeFileSync(join(out, "error.txt"), e instanceof Error ? (e.stack ?? e.message) : String(e));
  }
  quitting = true;
  app.quit();
}

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
