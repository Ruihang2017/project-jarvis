/**
 * Privacy guard (S1, D24): removes account numbers, card numbers, passwords/PINs/codes and ID
 * numbers — even partial ones — before anything reaches Codex, and refuses to store them.
 *
 * Mechanical, not a prompt: CodexClient runs every outgoing message through redact(). Detection is
 * "by context" (user's choice): unmistakable formats always, other numbers only next to a keyword
 * ("card ending", "账号", "TFN" …). A bare "4409" with no keyword can't be told from a house number.
 */

export type Category = "card" | "bank" | "secret" | "tfn" | "medicare" | "passport" | "licence";

export const LABEL: Record<Category, string> = {
  card: "card number",
  bank: "bank/account number",
  secret: "password/PIN/code",
  tfn: "tax file number",
  medicare: "Medicare number",
  passport: "passport number",
  licence: "driver licence number",
};

interface Span {
  start: number;
  end: number;
  category: Category;
}

// Full-width digits (０-９) count as digits, and invisible characters that can sit inside a copied
// number (zero-width spaces and joiners, no-break spaces, BOM) count as a space. Every replacement
// is one UTF-16 unit for one, so match offsets stay valid for the original text.
const normalise = (s: string) =>
  s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/[\u200B-\u200D\u2060\uFEFF\u00A0\u202F\u2007]/g, " ");

const digitsOf = (s: string) => s.replace(/\D/g, "");

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
  return sum % 10 === 0;
}

const TFN_WEIGHTS = [1, 4, 3, 7, 5, 8, 6, 9, 10];
const tfnValid = (d: string) => d.length === 9 && TFN_WEIGHTS.reduce((s, w, i) => s + w * Number(d[i]), 0) % 11 === 0;

const MEDICARE_WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9];
const medicareValid = (d: string) =>
  (d.length === 10 || d.length === 11) && /^[2-6]/.test(d) && MEDICARE_WEIGHTS.reduce((s, w, i) => s + w * Number(d[i]), 0) % 10 === Number(d[8]);

/** Formats that are sensitive wherever they appear. */
const CERTAIN: { re: RegExp; category: Category; check?: (m: string) => boolean }[] = [
  // Card numbers: 13–19 digits (spaces/hyphens allowed) passing Luhn.
  { re: /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g, category: "card", check: (m) => luhn(digitsOf(m)) },
  // Masked cards: "**** **** **** 4409", "XXXX-XXXX-XXXX-4409".
  { re: /(?:[*xX•]{4}[ -]?){2,3}\d{4}(?!\d)/g, category: "card" },
  // BSB + account: "062-000 12345678", "062 000, 1234 5678".
  { re: /(?<!\d)\d{3}-\d{3}[ ,/]+\d(?:[ -]?\d){5,9}(?!\d)/g, category: "bank" },
  // TFN written in its usual 3-3-3 grouping and passing the check digit.
  { re: /(?<!\d)\d{3} \d{3} \d{3}(?![\d ]\d)/g, category: "tfn", check: (m) => tfnValid(digitsOf(m)) },
  // Medicare in its usual 4-5-1(-1) grouping and passing the check digit.
  { re: /(?<!\d)[2-6]\d{3} \d{5} \d(?:[ -/]?\d)?(?!\d)/g, category: "medicare", check: (m) => medicareValid(digitsOf(m)) },
  // Credentials with a recognisable shape.
  { re: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, category: "secret" },
  { re: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, category: "secret" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, category: "secret" },
  { re: /\bxox[abpr]-[A-Za-z0-9-]{10,}/g, category: "secret" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, category: "secret" },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, category: "secret" },
];

// A number-ish value after a keyword: digits with spaces/hyphens/masks, at least 3 digits or masks.
// Commas and dots end it, so "$12,345.67" isn't mistaken for an account.
const NUMBER = String.raw`[\d*xX•](?:[\d*xX• -]*[\d*xX•])?`;
// The number must stand on its own: "account: alex2017@example.com" has no account number in it.
// (Glued to Chinese is fine: "尾号4409".)
const VALUE = String.raw`(?<![A-Za-z0-9_])(${NUMBER})(?![A-Za-z0-9_@])`;
// Short filler allowed between keyword and value: "number is", "：", "ending in", "是", "号码为" …
const GAP = String.raw`[^\d\n$¥€£]{0,14}?`;

/** Keyword → value rules. The value group is what gets removed; the keyword stays for readability. */
const CONTEXT: { re: RegExp; category: Category; minDigits: number; skipIf?: RegExp }[] = [
  {
    re: new RegExp(String.raw`(?:卡号|银行卡|信用卡|借记卡|储蓄卡|尾号|后四位|末四位|后4位|末4位|\bcard\b|\bending(?:\s+in)?\b|\blast\s*(?:4|four)\b)${GAP}${VALUE}`, "gi"),
    category: "card",
    minDigits: 3,
  },
  {
    re: new RegExp(String.raw`(?:\b(?:cvv|cvc|cvv2|csc)\b|安全码)${GAP}(\d{3,4})(?!\d)`, "gi"),
    category: "card",
    minDigits: 3,
  },
  {
    re: new RegExp(String.raw`(?:\b(?:exp(?:iry|iration)?(?:\s*date)?|valid\s*thru)\b|有效期)${GAP}((?:0[1-9]|1[0-2])\s*/\s*(?:\d{2}|\d{4}))(?!\d)`, "gi"),
    category: "card",
    minDigits: 4,
  },
  {
    re: new RegExp(
      String.raw`(?:账号|帐号|账户|帐户|户口|客户号|客户编号|会员号|\bBSB\b|\bacc(?:oun)?t\b|\ba/c\b|\bcustomer\s*(?:no|number|id|ref(?:erence)?)\b|\bmember\s*(?:no|number)\b|\b(?:payment|bpay|customer)\s*ref(?:erence)?\b|\bCRN\b|\bNMI\b|\bMIRN\b)${GAP}${VALUE}`,
      "gi",
    ),
    category: "bank",
    minDigits: 4,
    // "账户余额 12345", "account balance 5000": amounts, not account numbers.
    skipIf: /余额|金额|balance|amount|total|余|元/i,
  },
  {
    re: new RegExp(String.raw`(?:\b(?:passwords?|passwd|pwd|passcode|passphrase)\b|密码|口令)\s*(?:is|was|=|:|：|是|为|：)\s*([^\s，。,;；、]{1,64})`, "gi"),
    category: "secret",
    minDigits: 0,
  },
  {
    // PINs and one-time codes: the value must contain a digit ("the code is fine" stays).
    re: new RegExp(String.raw`(?:\bPIN\b|验证码|校验码|动态码|\bOTP\b|\b(?:one[- ]time|verification|security|access|login|auth(?:entication)?)\s*(?:pass)?code\b|\bcode\s+is\b)${GAP}([A-Za-z0-9-]*\d[A-Za-z0-9-]*)`, "gi"),
    category: "secret",
    minDigits: 1,
  },
  {
    re: new RegExp(String.raw`(?:\bTFN\b|\btax\s*file\s*(?:no|number)?\b|税号|税务号|税务编号)${GAP}(\d(?:[ -]?\d){7,8})(?!\d)`, "gi"),
    category: "tfn",
    minDigits: 8,
  },
  {
    re: new RegExp(String.raw`(?:\bmedicare\b|医保卡|医保号)${GAP}(\d(?:[ -/]?\d){8,10})(?!\d)`, "gi"),
    category: "medicare",
    minDigits: 9,
  },
  {
    re: new RegExp(String.raw`(?:\bpassport\b|护照)${GAP}([A-Za-z]{0,2}\d(?:[ -]?[A-Za-z0-9]){5,9})`, "gi"),
    category: "passport",
    minDigits: 5,
  },
  {
    re: new RegExp(
      String.raw`(?:\bdriver'?s?\s*licen[cs]e\b|\blicen[cs]e\s*(?:no|number|#)|驾照|驾驶证|驾驶执照)${GAP}([A-Za-z]{0,3}\d(?:[ -]?[A-Za-z0-9]){3,11})`,
      "gi",
    ),
    category: "licence",
    minDigits: 4,
  },
];

/** Most specific first. */
const SPECIFICITY: Category[] = ["tfn", "medicare", "passport", "licence", "bank", "card", "secret"];

const countDigits = (s: string) => (s.match(/[\d*xX•]/g) ?? []).length;

function findSpans(text: string): Span[] {
  const t = normalise(text);
  const spans: Span[] = [];
  for (const rule of CERTAIN) {
    for (const m of t.matchAll(rule.re)) {
      if (rule.check && !rule.check(m[0])) continue;
      spans.push({ start: m.index!, end: m.index! + m[0].length, category: rule.category });
    }
  }
  for (const rule of CONTEXT) {
    for (const m of t.matchAll(rule.re)) {
      const value = m[1];
      if (!value) continue;
      if (rule.minDigits && countDigits(value) < rule.minDigits) continue;
      const valueStart = m.index! + m[0].length - value.length;
      if (rule.skipIf && rule.skipIf.test(m[0].slice(0, m[0].length - value.length))) continue;
      spans.push({ start: valueStart, end: valueStart + value.length, category: rule.category });
    }
  }
  // Merge overlaps, naming the merged span after the most specific category ("医保卡号" is Medicare, not a card).
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged.at(-1);
    if (last && s.start < last.end) {
      last.end = Math.max(last.end, s.end);
      if (SPECIFICITY.indexOf(s.category) < SPECIFICITY.indexOf(last.category)) last.category = s.category;
    } else merged.push({ ...s });
  }
  return merged;
}

export interface Redaction {
  text: string;
  /** One entry per removed item. */
  removed: Category[];
}

/** Replaces sensitive values with "[removed: card number]" etc. */
export function redact(text: string): Redaction {
  if (!text) return { text, removed: [] };
  const spans = findSpans(text);
  if (!spans.length) return { text, removed: [] };
  let out = text;
  for (const s of [...spans].reverse()) out = `${out.slice(0, s.start)}[removed: ${LABEL[s.category]}]${out.slice(s.end)}`;
  return { text: out, removed: spans.map((s) => s.category) };
}

/** The first sensitive category found, for refusing to store something. */
export function sensitiveReason(text: string): string | null {
  const s = findSpans(text)[0];
  return s ? LABEL[s.category] : null;
}

/** "1 card number and 2 bank/account numbers". */
export function describeRemoved(removed: Category[]): string {
  const counts = new Map<Category, number>();
  for (const c of removed) counts.set(c, (counts.get(c) ?? 0) + 1);
  const parts = [...counts].map(([c, n]) => `${n} ${LABEL[c]}${n > 1 ? "s" : ""}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
}

/**
 * Deep copy of a JSON value with every string redacted. Used for replies to Codex (tool results,
 * answers to questions), where any string may carry user or email text.
 */
export function redactDeep<T>(value: T, removed: Category[] = [], skipKeys: ReadonlySet<string> = new Set()): { value: T; removed: Category[] } {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = redact(v);
      removed.push(...r.removed);
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, skipKeys.has(k) ? x : walk(x)]));
    return v;
  };
  return { value: walk(value) as T, removed };
}

export class SensitiveDataError extends Error {}

/** Storage-side guard: throws instead of writing an account/card/ID number or secret to disk. */
export function refuseSensitive(text: string): void {
  const reason = sensitiveReason(text);
  if (reason) throw new SensitiveDataError(`not saved: it contains a ${reason}, and Edward never stores those`);
}
