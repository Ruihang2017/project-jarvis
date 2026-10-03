/**
 * The page's only door to Edward: window.edward.call(method, ...args) and window.edward.on(listener).
 * The main process checks the method name against its list; nothing else from Electron is exposed.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, EdwardEvent } from "../shared/api.js";

const bridge: Bridge = {
  call: ((method: string, ...args: unknown[]) => ipcRenderer.invoke("edward:call", method, args)) as Bridge["call"],
  on(listener) {
    const handler = (_: unknown, e: EdwardEvent) => listener(e);
    ipcRenderer.on("edward:event", handler);
    return () => ipcRenderer.off("edward:event", handler);
  },
};

contextBridge.exposeInMainWorld("edward", { ...bridge, ready: () => ipcRenderer.invoke("edward:ready") });
