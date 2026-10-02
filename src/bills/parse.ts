/**
 * Deterministic checks on bill emails, done by Jarvis's own code (not the model): which amounts and
 * dates really appear in the text, who sent it, phishing wording, and — in memory only — whether
 * the payment details differ from the payee's previous bill (D25, O5-A).
 */
import { addressOf } from "../google/gmail.js";

/** Every money-like number in the text, in cents: "1,234.56", "245.30", "89". */
export function amountsIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d|[.,]\d)/g)) {
    const whole = Number(m[1]!.replace(/,/g, ""));
    if (!Number.isFinite(whole) || whole > 10_000_000) continue;
    out.add(whole * 100 + Number((m[2] ?? "0").padEnd(2, "0")));
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

const iso = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1) return null; // 31 Feb etc.
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/** A date without a year belongs to the year that puts it closest to the email's date. */
function nearestYear(m: number, d: number, ref: Date): number {
  const y = ref.getFullYear();
  let best = y;
  let bestGap = Infinity;
  for (const c of [y - 1, y, y + 1]) {
    const gap = Math.abs(new Date(c, m - 1, d).getTime() - ref.getTime());
    if (gap < bestGap) [best, bestGap] = [c, gap];
  }
  return best;
}

/**
 * Every date written in the text, as YYYY-MM-DD. Day-first for numeric dates (Australian usage).
 * `ref` (the email's date) supplies the year when none is written.
 */
export function datesIn(text: string, ref: Date): Set<string> {
  const out = new Set<string>();
  const add = (y: number | undefined, m: number, d: number) => {
    const year = y === undefined ? nearestYear(m, d, ref) : y < 100 ? 2000 + y : y;
    const v = iso(year, m, d);
    if (v) out.add(v);
  };
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g)) add(Number(m[1]), Number(m[2]), Number(m[3]));
  // Sentence punctuation right after the date is fine ("on 12/10/2026."); another numeric part is not.
  for (const m of text.matchAll(/(?<!\d|\d[/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d|[/.-]\d)/g)) add(Number(m[3]), Number(m[2]), Number(m[1]));
  for (const m of text.matchAll(new RegExp(String.raw`(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH_RE})\b\.?,?(?:\s+(\d{4}))?`, "gi"))) {
    add(m[3] ? Number(m[3]) : undefined, MONTHS[m[2]!.toLowerCase()]!, Number(m[1]));
  }
  for (const m of text.matchAll(new RegExp(String.raw`\b(${MONTH_RE})\b\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?!\d)(?:,?\s+(\d{4}))?`, "gi"))) {
    add(m[3] ? Number(m[3]) : undefined, MONTHS[m[1]!.toLowerCase()]!, Number(m[2]));
  }
  for (const m of text.matchAll(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/g)) add(m[1] ? Number(m[1]) : undefined, Number(m[2]), Number(m[3]));
  return out;
}

const SECOND_LEVEL = new Set(["com", "net", "org", "gov", "edu", "co", "id", "asn", "ac"]);

/** "originenergy.com.au" from "Origin <no-reply@billing.originenergy.com.au>"; "" if there's no address. */
export function senderDomain(from: string): string {
  const address = addressOf(from) ?? addressOf(from.split(/[\s,]+/).find((p) => p.includes("@")) ?? "");
  const host = address?.split("@")[1];
  if (!host) return "";
  const labels = host.split(".");
  const n = labels.length >= 3 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-n).join(".");
}

const PHISHING: [RegExp, string][] = [
  [/verify\s+your\s+(account|identity|details|payment)/i, 'asks you to "verify your account"'],
  [/(update|confirm)\s+your\s+(bank|banking|payment|billing|card)\s+(details|information|info)/i, "asks you to update bank or payment details"],
  [/account\s+(has\s+been|will\s+be|is)\s+(suspended|locked|closed|deactivated|restricted)/i, "threatens to suspend the account"],
  [/(our|new)\s+bank(ing)?\s+(account\s+)?details\s+have\s+changed|changed\s+(our\s+)?bank(ing)?\s+details/i, "says their bank details have changed"],
  [/within\s+(24|48)\s+hours|immediate(ly)?\s+(action|payment)\s+required|final\s+warning/i, "pressures you to act immediately"],
  [/验证(您的|你的)?(账户|帐户|身份)|更新(您的|你的)?(银行|付款|支付)(信息|资料)|(账户|帐户)(将被|已被)(冻结|停用|关闭)|银行(账户|帐户|信息)已(变更|更改)/, "有要求验证账户或更新银行信息的字样"],
];

/** Wording typical of phishing or payment-redirection fraud. */
export function phishingSigns(text: string): string[] {
  return PHISHING.filter(([re]) => re.test(text)).map(([, why]) => why);
}

/**
 * Where a bill says to pay: BSB + account and BPAY biller codes, as normalised digit strings.
 * IN MEMORY ONLY — used to compare two emails and then dropped; never stored, logged or sent anywhere.
 * (BPAY reference numbers are left out: many billers change them on every invoice.)
 */
export function paymentDetails(text: string): { accounts: Set<string>; billers: Set<string> } {
  const digits = (s: string) => s.replace(/\D/g, "");
  const accounts = new Set<string>();
  for (const m of text.matchAll(/BSB[^\d\n]{0,15}(\d{3}[- ]?\d{3})[\s\S]{0,80}?(?:acc(?:oun)?t|a\/c)[^\d\n]{0,20}(\d[\d -]{4,14}\d)/gi)) accounts.add(`${digits(m[1]!)}/${digits(m[2]!)}`);
  for (const m of text.matchAll(/(?<!\d)(\d{3}-\d{3})[ ,/]+(\d(?:[ -]?\d){5,9})(?!\d)/g)) accounts.add(`${digits(m[1]!)}/${digits(m[2]!)}`);
  const billers = new Set<string>();
  for (const m of text.matchAll(/biller\s*code[^\d\n]{0,10}(\d{3,10})/gi)) billers.add(digits(m[1]!));
  return { accounts, billers };
}

/**
 * True when both emails state the same kind of payment detail and none of them match — the classic
 * "same supplier, new bank account" fraud. Says nothing when either email has no such detail.
 */
export function paymentDetailsChanged(previous: string, current: string): boolean {
  const a = paymentDetails(previous);
  const b = paymentDetails(current);
  const differs = (x: Set<string>, y: Set<string>) => x.size > 0 && y.size > 0 && ![...y].some((v) => x.has(v));
  return differs(a.accounts, b.accounts) || differs(a.billers, b.billers);
}
