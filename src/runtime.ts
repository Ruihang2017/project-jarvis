/**
 * Paths that depend on how Edward is running. The terminal version finds everything relative to
 * its own files; the desktop app is bundled into one file inside Electron and sets these instead.
 */
export interface TickCommand {
  /** The program the background task starts. */
  exe: string;
  args: string[];
  /** Extra environment for it (the app runs its own executable as plain Node). */
  env?: Record<string, string>;
}

export const runtime: {
  /** PNG shown in notifications. */
  iconPath?: string;
  /** What the background task runs every minute. */
  tick?: TickCommand;
  /** No desktop notifications (automated checks). */
  silent?: boolean;
  /** No background work at start (memory learning, tidying, bill scan): automated checks only look. */
  noBackgroundWork?: boolean;
  /** Google desktop client built into the app at packaging time (D37); a google-client.json in the data folder wins. */
  googleClient?: { clientId: string; clientSecret: string };
} = {};
