/** Which computer the page is on, for the few sentences that name the system. The page has no Node. */
export const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);

/** "A small Windows task" / "A small macOS task": what runs the reminders when Edward is closed. */
export const backgroundTask = isMac ? "A small macOS background task" : "A small Windows task";

/** Who keeps the sign-ins encrypted. */
export const secretKeeper = isMac ? "with a key in your Mac's keychain" : "by Windows for your user account";

/** Where Codex keeps an OpenAI API key (P): an encrypted file, its key held by the system. */
export const keyKeeper = isMac ? "encrypted with a key in your Mac's keychain" : "encrypted with a key that Windows keeps for your user account";

export const microphoneSettings = isMac ? "System Settings → Privacy & Security → Microphone" : "Windows Settings → Privacy → Microphone";
