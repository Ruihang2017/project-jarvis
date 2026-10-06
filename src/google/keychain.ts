/**
 * Secrets at rest on macOS. The login keychain holds one random key ("Edward" / "secrets-key"); each
 * secret file (a Google refresh token, the OpenAI key) is AES-256-GCM under that key. So the files
 * keep the same names and places as on Windows, and copying the data folder gives nothing readable.
 *
 * The keychain is reached through /usr/bin/security, which works the same from the app, the terminal
 * version and the background tick (Electron's safeStorage only exists inside the app). Like DPAPI's
 * CurrentUser scope, another program running as the same macOS user can ask for the key too.
 */
import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const SERVICE = "Edward";
const ACCOUNT = "secrets-key";
const SECURITY = "/usr/bin/security";

/** Marks a file sealed with the keychain key: header, 12-byte nonce, 16-byte tag, ciphertext. */
export const SEALED = Buffer.from("EDWARD-KC1\n");

/** Where the key is kept: the keychain, or a stand-in for tests. */
export interface KeyStore {
  /** The key, or null when there is none yet. */
  read(): Promise<Buffer | null>;
  /** Stores a key unless one is already there (never replaces: another Edward may have just made one). */
  create(key: Buffer): Promise<void>;
}

function security(args: string[], input?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = execFile(SECURITY, args, { timeout: 20_000 }, (err, stdout) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, out: stdout });
    });
    if (input !== undefined) child.stdin!.end(input);
  });
}

/**
 * The login keychain (or the keychain file EDWARD_KEYCHAIN names, for tests). The key never goes on a
 * command line, where other programs could see it: it is written through `security -i`, which reads
 * its commands from standard input, and read from standard output.
 */
export function macKeychain(keychain = process.env.EDWARD_KEYCHAIN): KeyStore {
  const where = keychain ? [keychain] : [];
  return {
    async read() {
      const r = await security(["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w", ...where]);
      const hex = r.out.trim();
      return r.code === 0 && /^[0-9a-f]{64}$/.test(hex) ? Buffer.from(hex, "hex") : null;
    },
    async create(key) {
      // No -U: if a key is already there this fails and the existing one stays.
      const quoted = !keychain ? "" : /[\s"\\]/.test(keychain) ? ` "${keychain.replace(/(["\\])/g, "\\$1")}"` : ` ${keychain}`;
      await security(["-i"], `add-generic-password -s ${SERVICE} -a ${ACCOUNT} -w ${key.toString("hex")}${quoted}\n`);
    },
  };
}

/** Removes the key from the keychain, once everything it sealed has been deleted. False when there was none. */
export async function forgetKey(keychain = process.env.EDWARD_KEYCHAIN): Promise<boolean> {
  return (await security(["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT, ...(keychain ? [keychain] : [])])).code === 0;
}

const keys = new WeakMap<KeyStore, Promise<Buffer>>();
let defaultStore: KeyStore | undefined;

/** The key, made on first use. Read back after creating, so two Edwards starting together agree on one. */
function keyFrom(store: KeyStore): Promise<Buffer> {
  let key = keys.get(store);
  if (!key) {
    key = (async () => {
      const had = await store.read();
      if (had) return had;
      await store.create(randomBytes(32));
      const made = await store.read();
      if (!made) throw new Error("couldn't keep Edward's key in the macOS keychain (is the login keychain locked?)");
      return made;
    })();
    keys.set(store, key);
    // A failure isn't remembered: the keychain may be unlocked by the next try.
    key.catch(() => keys.delete(store));
  }
  return key;
}

export async function seal(secret: Buffer, store: KeyStore = (defaultStore ??= macKeychain())): Promise<Buffer> {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await keyFrom(store), nonce);
  cipher.setAAD(SEALED);
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([SEALED, nonce, cipher.getAuthTag(), body]);
}

export const isSealed = (blob: Buffer) => blob.subarray(0, SEALED.length).equals(SEALED);

/** Throws when the file was changed or the key in the keychain isn't the one it was sealed with. */
export async function unseal(blob: Buffer, store: KeyStore = (defaultStore ??= macKeychain())): Promise<Buffer> {
  const at = SEALED.length;
  if (!isSealed(blob) || blob.length < at + 28) throw new Error("not a file Edward sealed");
  const decipher = createDecipheriv("aes-256-gcm", await keyFrom(store), blob.subarray(at, at + 12));
  decipher.setAAD(SEALED);
  decipher.setAuthTag(blob.subarray(at + 12, at + 28));
  try {
    return Buffer.concat([decipher.update(blob.subarray(at + 28)), decipher.final()]);
  } catch {
    // Never the cipher's own message or any bytes: they could hold part of the secret.
    throw new Error("couldn't open a saved sign-in: the file changed, or the key in the macOS keychain is a different one");
  }
}
