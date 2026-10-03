/**
 * Bills (N5, D25): what Edward tracks is payee, category, amount, due date and status — never an
 * account, card or reference number (no such column exists, and text fields pass the privacy guard).
 * Edward reminds; paying is the user's business.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { memoryDbPath } from "../memory/store.js";
import { redact, refuseSensitive } from "../privacy/guard.js";
import { money } from "../region.js";
import { stripControl } from "../util.js";

export type BillKind = "bill" | "autopay" | "statement" | "receipt";
/** pending: waiting for the user's OK. tracked: reminders on. autopay: recorded, no reminders. */
export type BillStatus = "pending" | "tracked" | "paid" | "autopay" | "dismissed";

export const CATEGORIES = ["electricity", "gas", "water", "internet", "phone", "insurance", "council", "strata", "rent", "subscription", "tax", "medical", "education", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Bill {
  id: number;
  payee: string;
  category: Category;
  kind: BillKind;
  /** Minor units (cents); null when the email doesn't state it (e.g. only in a PDF). */
  amountCents: number | null;
  currency: string;
  /** YYYY-MM-DD, or null when not stated. */
  dueDate: string | null;
  status: BillStatus;
  /** Gmail message id the bill came from. */
  messageId: string;
  /** Connected account (mailbox) the email is in (A1); unset for bills found before A1 (the first account). */
  mailbox?: string;
  senderDomain: string;
  /** Email subject with guarded data removed, for display. */
  title: string;
  /** Warnings from the safety checks, shown with ⚠. */
  flags: string[];
  /** Amount or due date couldn't be verified against the email: no automatic reminders. */
  needsCheck: boolean;
  detectedAt: string;
  paidAt: string | null;
}

export type NewBill = Omit<Bill, "id" | "detectedAt" | "paidAt">;

/**
 * The same company under slightly different names: the model wrote "Harbour Builders Pty Ltd"
 * for one email and "Harbour Builders" for the next (2026-10-02). Case, punctuation and
 * company suffixes don't count.
 */
export function payeeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|inc|incorporated|llc|corp|corporation|p\/l)\b\.?/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

interface Row {
  id: number;
  payee: string;
  category: string;
  kind: string;
  amount_cents: number | null;
  currency: string;
  due_date: string | null;
  status: string;
  message_id: string;
  sender_domain: string;
  title: string;
  flags: string;
  needs_check: number;
  detected_at: string;
  paid_at: string | null;
  mailbox: string | null;
}

const toBill = (r: Row): Bill => ({
  id: r.id,
  payee: r.payee,
  category: r.category as Category,
  kind: r.kind as BillKind,
  amountCents: r.amount_cents,
  currency: r.currency,
  dueDate: r.due_date,
  status: r.status as BillStatus,
  messageId: r.message_id,
  senderDomain: r.sender_domain,
  title: r.title,
  flags: JSON.parse(r.flags) as string[],
  needsCheck: r.needs_check === 1,
  detectedAt: r.detected_at,
  paidAt: r.paid_at,
  mailbox: r.mailbox ?? undefined,
});

export class BillStore {
  private db: DatabaseSync;

  constructor(path = memoryDbPath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY,
        payee TEXT NOT NULL,
        category TEXT NOT NULL,
        kind TEXT NOT NULL,
        amount_cents INTEGER,
        currency TEXT NOT NULL DEFAULT 'AUD',
        due_date TEXT,
        status TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        sender_domain TEXT NOT NULL,
        title TEXT NOT NULL,
        flags TEXT NOT NULL DEFAULT '[]',
        needs_check INTEGER NOT NULL DEFAULT 0,
        detected_at TEXT NOT NULL,
        paid_at TEXT,
        mailbox TEXT
      );
      CREATE INDEX IF NOT EXISTS bills_status_due ON bills (status, due_date);
      -- Payees the user has confirmed, with the sender domains their bills came from.
      CREATE TABLE IF NOT EXISTS payees (name TEXT PRIMARY KEY, domains TEXT NOT NULL DEFAULT '[]', confirmed_at TEXT NOT NULL);
      -- Every email already looked at (bill or not), so a scan never re-sends it to the model.
      CREATE TABLE IF NOT EXISTS bill_scanned (message_id TEXT PRIMARY KEY, scanned_at TEXT NOT NULL, is_bill INTEGER NOT NULL);
      -- Due reminders already shown (per bill, due date and lead time), so each shows once.
      CREATE TABLE IF NOT EXISTS bill_reminders (bill_id INTEGER NOT NULL, due_date TEXT NOT NULL, days_before INTEGER NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (bill_id, due_date, days_before));
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    // Bills from before A1 have no mailbox column: add it (nullable, so nothing changes for them).
    const cols = this.db.prepare("PRAGMA table_info(bills)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "mailbox")) {
      try {
        this.db.exec("ALTER TABLE bills ADD COLUMN mailbox TEXT");
      } catch {
        // the background tick added it at the same moment
      }
    }
  }

  close() {
    this.db.close();
  }

  /** Adds a bill; text fields are checked by the privacy guard (the title is stored redacted). */
  add(b: NewBill): Bill {
    refuseSensitive(b.payee);
    for (const f of b.flags) refuseSensitive(f);
    const res = this.db
      .prepare(
        "INSERT INTO bills (payee, category, kind, amount_cents, currency, due_date, status, message_id, sender_domain, title, flags, needs_check, detected_at, mailbox) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        stripControl(b.payee).trim(),
        b.category,
        b.kind,
        b.amountCents,
        b.currency,
        b.dueDate,
        b.status,
        b.messageId,
        b.senderDomain,
        redact(stripControl(b.title)).text.slice(0, 200),
        JSON.stringify(b.flags),
        b.needsCheck ? 1 : 0,
        new Date().toISOString(),
        b.mailbox ?? null,
      );
    return this.get(Number(res.lastInsertRowid))!;
  }

  get(id: number): Bill | undefined {
    const r = this.db.prepare("SELECT * FROM bills WHERE id = ?").get(id) as Row | undefined;
    return r && toBill(r);
  }

  byMessage(messageId: string): Bill | undefined {
    const r = this.db.prepare("SELECT * FROM bills WHERE message_id = ?").get(messageId) as Row | undefined;
    return r && toBill(r);
  }

  list(status?: BillStatus | BillStatus[]): Bill[] {
    const want = status === undefined ? null : Array.isArray(status) ? status : [status];
    const rows = (
      want
        ? this.db.prepare(`SELECT * FROM bills WHERE status IN (${want.map(() => "?").join(",")}) ORDER BY due_date IS NULL, due_date, id`).all(...want)
        : this.db.prepare("SELECT * FROM bills ORDER BY due_date IS NULL, due_date, id").all()
    ) as unknown as Row[];
    return rows.map(toBill);
  }

  /** The payee's earlier bills (any status but dismissed), newest first: amount history and the previous email. */
  history(payee: string, excludeId?: number): Bill[] {
    const key = payeeKey(payee);
    return (this.db.prepare("SELECT * FROM bills WHERE status != 'dismissed' AND id != ? ORDER BY detected_at DESC, id DESC").all(excludeId ?? -1) as unknown as Row[])
      .map(toBill)
      .filter((b) => payeeKey(b.payee) === key);
  }

  update(id: number, patch: Partial<Pick<Bill, "payee" | "category" | "amountCents" | "dueDate" | "status" | "needsCheck" | "flags">>): Bill | undefined {
    const cols: Record<string, string> = { payee: "payee", category: "category", amountCents: "amount_cents", dueDate: "due_date", status: "status", needsCheck: "needs_check", flags: "flags" };
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (k === "payee") refuseSensitive(String(v));
      sets.push(`${cols[k]} = ?`);
      params.push(k === "flags" ? JSON.stringify(v) : k === "needsCheck" ? (v ? 1 : 0) : (v as string | number | null));
    }
    if (patch.status === "paid") {
      sets.push("paid_at = ?");
      params.push(new Date().toISOString());
    }
    if (sets.length) this.db.prepare(`UPDATE bills SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    return this.get(id);
  }

  /** Remembers that the user confirmed this payee, and which domain its bill came from. */
  confirmPayee(name: string, domain: string) {
    refuseSensitive(name);
    const key = payeeKey(name);
    const domains = new Set(this.payeeDomains(name));
    if (domain) domains.add(domain);
    this.db
      .prepare("INSERT INTO payees (name, domains, confirmed_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET domains = excluded.domains")
      .run(key, JSON.stringify([...domains]), new Date().toISOString());
  }

  /** Sender domains of a confirmed payee; empty when the payee isn't known yet. */
  payeeDomains(name: string): string[] {
    const r = this.db.prepare("SELECT domains FROM payees WHERE name = ?").get(payeeKey(name)) as { domains: string } | undefined;
    return r ? (JSON.parse(r.domains) as string[]) : [];
  }

  knownPayee(name: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM payees WHERE name = ?").get(payeeKey(name)));
  }

  /** Days left when the latest reminder for this bill and due date was shown; undefined if none was. */
  lastReminder(billId: number, dueDate: string): number | undefined {
    const r = this.db.prepare("SELECT MIN(days_before) AS d FROM bill_reminders WHERE bill_id = ? AND due_date = ?").get(billId, dueDate) as { d: number | null };
    return r.d ?? undefined;
  }

  /** Records a reminder shown with `daysBefore` days left; true only for the first caller (the REPL and the background tick may race). */
  claimReminder(billId: number, dueDate: string, daysBefore: number): boolean {
    const res = this.db.prepare("INSERT OR IGNORE INTO bill_reminders (bill_id, due_date, days_before, sent_at) VALUES (?, ?, ?, ?)").run(billId, dueDate, daysBefore, new Date().toISOString());
    return Number(res.changes) === 1;
  }

  markScanned(messageId: string, isBill: boolean) {
    this.db.prepare("INSERT OR REPLACE INTO bill_scanned (message_id, scanned_at, is_bill) VALUES (?, ?, ?)").run(messageId, new Date().toISOString(), isBill ? 1 : 0);
  }

  wasScanned(messageId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM bill_scanned WHERE message_id = ?").get(messageId));
  }

  getMeta(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  }

  setMeta(key: string, value: string) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  /** Deletes every bill, payee and scan record (/bills forget all). Returns how many bills were removed. */
  forgetAll(): number {
    const n = (this.db.prepare("SELECT COUNT(*) AS n FROM bills").get() as { n: number }).n;
    this.db.exec("DELETE FROM bills; DELETE FROM payees; DELETE FROM bill_scanned; DELETE FROM bill_reminders; DELETE FROM meta WHERE key LIKE 'bills:%';");
    return n;
  }
}

/** "$245.30" in the home currency, "US$2.49" for another one, or a note when the email had no amount. */
export function formatAmount(b: Pick<Bill, "amountCents" | "currency">): string {
  return b.amountCents === null ? "amount not in the email" : money(b.amountCents, b.currency);
}
