/**
 * Demo recordings (D44) can run at a made-up time of day (EDWARD_DEMO_TIME=HH:MM), so a video made
 * in the evening still shows a morning: "Good morning", a site visit at ten, a reminder for 5pm
 * today. Only the clock Edward's own code reads is moved, in this process and in the page; timers,
 * Codex and the network keep the real time. Never used outside demo mode.
 */
import type { WebContents } from "electron";

/** A Date that is `offset` ms ahead: `new Date()` and `Date.now()` move, everything else is the real Date. */
function shiftedDate(Real: DateConstructor, offset: number): DateConstructor {
  function Shifted(this: unknown, ...args: unknown[]) {
    if (!new.target) return new Real(Real.now() + offset).toString();
    return Reflect.construct(Real, args.length ? args : [Real.now() + offset], new.target);
  }
  Shifted.prototype = Real.prototype;
  Object.setPrototypeOf(Shifted, Real);
  Shifted.now = () => Real.now() + offset;
  return Shifted as unknown as DateConstructor;
}

/** Moves this process's clock to `hours:minutes` today; returns the offset in ms, for the page. */
export function shiftClock(hours: number, minutes: number): number {
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  const offset = target.getTime() - Date.now();
  globalThis.Date = shiftedDate(Date, offset);
  return offset;
}

/** Gives every document the window loads the same shifted clock, before any of the page's code runs. */
export async function shiftPageClock(contents: WebContents, offset: number): Promise<void> {
  contents.debugger.attach("1.3");
  await contents.debugger.sendCommand("Page.enable");
  await contents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: `globalThis.Date = (${shiftedDate.toString()})(Date, ${Math.round(offset)});` });
}
