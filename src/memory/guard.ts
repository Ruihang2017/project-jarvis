import { sensitiveReason } from "../privacy/guard.js";

/**
 * Last line of defence against storing secrets, independent of what the model decides.
 * Returns a reason when text looks like it contains a credential, account/card/ID number (S1 guard)
 * or another secret shape.
 */
export function secretReason(text: string): string | null {
  const sensitive = sensitiveReason(text);
  if (sensitive) return sensitive;
  const patterns: [RegExp, string][] = [
    [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/, "API key"],
    [/\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/, "GitHub token"],
    [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
    [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, "Slack token"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
    [/(password|passwd|pwd|passcode|pin|密码|口令)\s*(is|是|为|:|：|=)\s*\S+/i, "password"],
    [/\b[A-Fa-f0-9]{40,}\b/, "long hex secret"],
  ];
  for (const [re, label] of patterns) if (re.test(text)) return label;
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    if (luhn(m[0].replace(/\D/g, ""))) return "card number";
  }
  return null;
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

/** Categories that need the user's OK before saving (the model classifies; see memory_save). */
export const ASK_FIRST = new Set(["health", "finance", "work_confidential"]);
