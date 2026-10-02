/**
 * Region (P2): the two regional habits that change what Jarvis concludes — whether "10/12" is
 * 10 December or October 12, and which currency a bare amount is in. Detected from the system
 * locale; the user can override both (/region).
 */
import { loadSettings } from "./settings.js";

export type DateOrder = "dmy" | "mdy";

export interface Region {
  dateOrder: DateOrder;
  /** ISO 4217 code. */
  currency: string;
}

// Countries that write the month first. Everywhere else numeric dates are day-first (or ISO).
const MONTH_FIRST = new Set(["US", "PH"]);

const CURRENCY: Record<string, string> = {
  AU: "AUD", US: "USD", GB: "GBP", NZ: "NZD", CA: "CAD", SG: "SGD", HK: "HKD", CN: "CNY", JP: "JPY", IN: "INR", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", ZA: "ZAR", KR: "KRW", PH: "PHP", MY: "MYR", TW: "TWD",
  IE: "EUR", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR", PT: "EUR", FI: "EUR", GR: "EUR",
};

/** Country code from a locale tag: "en-AU" → "AU", "zh-Hans-CN" → "CN". */
const countryOf = (locale: string) => locale.split(/[-_]/).find((p, i) => i > 0 && /^[A-Z]{2}$/.test(p)) ?? "";

export function detectRegion(locale = Intl.DateTimeFormat().resolvedOptions().locale): Region {
  const country = countryOf(locale);
  return { dateOrder: MONTH_FIRST.has(country) ? "mdy" : "dmy", currency: CURRENCY[country] ?? "USD" };
}

/** The region in effect: settings where set, otherwise detected. */
export function region(): Region {
  const s = loadSettings();
  const detected = detectRegion();
  return { dateOrder: s.dateOrder ?? detected.dateOrder, currency: s.currency ?? detected.currency };
}

const SYMBOL: Record<string, string> = { AUD: "$", USD: "$", CAD: "$", NZD: "$", SGD: "$", HKD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", INR: "₹" };
const PREFIX: Record<string, string> = { AUD: "A$", USD: "US$", CAD: "C$", NZD: "NZ$", SGD: "S$", HKD: "HK$", CNY: "CN¥", JPY: "JP¥" };

/**
 * "$245.30" in the home currency; another currency is marked so two kinds of dollar can't be
 * confused ("US$2.49" at home in AUD, "A$2.49" at home in USD).
 */
export function money(amountCents: number, currency: string, home = region().currency): string {
  const sign = currency === home ? (SYMBOL[currency] ?? `${currency} `) : (PREFIX[currency] ?? SYMBOL[currency] ?? `${currency} `);
  return `${sign}${(amountCents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
