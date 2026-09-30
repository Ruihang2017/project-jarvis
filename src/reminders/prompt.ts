const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Per-message clock note: thread instructions are written once, but "in 20 minutes" needs the
 * time now. Tiny, and stripped from transcripts before memory learning.
 */
export function nowNote(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  return `[Jarvis] Now: ${DAY_NAMES[now.getDay()]} ${date} ${p(now.getHours())}:${p(now.getMinutes())} (${timeZone()})`;
}

export const REMINDER_INSTRUCTIONS = `
## Reminders
When the user asks to be reminded, call reminder_create with an absolute local time (YYYY-MM-DDTHH:MM), computed from the current time given in the "[Jarvis] Now:" note. If they give a day but no time, use 09:00 and mention it. Confirm the exact date and time back in one short line.
Use reminder_list / reminder_cancel to review or cancel. A reminder is separate from memory: don't also memory_save it unless they ask you to remember something.`;
