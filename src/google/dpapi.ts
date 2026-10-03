/**
 * Windows DPAPI (CurrentUser): only this Windows account on this machine can decrypt. Used for the
 * Google refresh token. Data passes through stdin/stdout as base64, never the command line.
 */
import { execFile } from "node:child_process";

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

// Other platforms have no DPAPI; the token file is then only protected by file permissions (0600).
const PLAIN = Buffer.from("JARVIS-PLAIN1\n");

export async function protect(secret: string): Promise<Buffer> {
  const data = Buffer.from(secret, "utf8");
  return process.platform === "win32" ? run("Protect", data) : Buffer.concat([PLAIN, data]);
}

export async function unprotect(blob: Buffer): Promise<string> {
  if (blob.subarray(0, PLAIN.length).equals(PLAIN)) return blob.subarray(PLAIN.length).toString("utf8");
  return (await run("Unprotect", blob)).toString("utf8");
}
