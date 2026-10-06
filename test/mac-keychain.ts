// On a Mac, tests seal their made-up sign-ins with a key in a throwaway keychain file in the test's
// own folder, never the user's login keychain. Call it before anything is saved. Nothing to do elsewhere.
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export function testKeychain(dir: string): void {
  if (process.platform !== "darwin") return;
  const file = join(dir, "test.keychain-db");
  for (const args of [["create-keychain", "-p", "", file], ["unlock-keychain", "-p", "", file], ["set-keychain-settings", file]]) {
    execFileSync("/usr/bin/security", args, { stdio: "ignore" });
  }
  process.env.EDWARD_KEYCHAIN = file;
}
