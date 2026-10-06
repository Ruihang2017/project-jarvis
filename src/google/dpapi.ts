/**
 * Secrets at rest: the Google refresh tokens and the OpenAI key.
 *
 * Windows: DPAPI (CurrentUser): only this Windows account on this machine can decrypt. Data passes
 * through stdin/stdout as base64, never the command line.
 * macOS: a key in the login keychain (keychain.ts).
 * Elsewhere there is neither; the file is then only protected by file permissions.
 */
import { execFile } from "node:child_process";
import { isSealed, seal, unseal } from "./keychain.js";

// "Edward.Google" as extra entropy, so other apps under the same account can't decrypt by accident.
const SCRIPT = (op: "Protect" | "Unprotect") => `
Add-Type -AssemblyName System.Security
$in = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$entropy = [Text.Encoding]::ASCII.GetBytes('Jarvis.Google')
$out = [Security.Cryptography.ProtectedData]::${op}($in, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($out))
`;

function run(op: "Protect" | "Unprotect", data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", SCRIPT(op)],
      { windowsHide: true, timeout: 20_000 },
      (err, stdout, stderr) => {
        // Never include stdout in errors: it may hold the secret.
        if (err) reject(new Error(`DPAPI ${op.toLowerCase()} failed: ${stderr.trim().split("\n")[0] || err.message}`));
        else resolve(Buffer.from(stdout.trim(), "base64"));
      },
    );
    child.stdin!.end(data.toString("base64"));
  });
}

// Platforms with neither DPAPI nor a keychain Edward knows.
const PLAIN = Buffer.from("JARVIS-PLAIN1\n");
const isPlain = (blob: Buffer) => blob.subarray(0, PLAIN.length).equals(PLAIN);

export async function protect(secret: string): Promise<Buffer> {
  const data = Buffer.from(secret, "utf8");
  if (process.platform === "win32") return run("Protect", data);
  // On a Mac a keychain that can't be used is an error: the secret is never written unprotected.
  if (process.platform === "darwin") return seal(data);
  return Buffer.concat([PLAIN, data]);
}

export async function unprotect(blob: Buffer): Promise<string> {
  if (isSealed(blob)) return (await unseal(blob)).toString("utf8");
  if (isPlain(blob)) return blob.subarray(PLAIN.length).toString("utf8");
  if (process.platform !== "win32") throw new Error("this sign-in was saved on another computer and can't be opened here; connect again");
  return (await run("Unprotect", blob)).toString("utf8");
}
