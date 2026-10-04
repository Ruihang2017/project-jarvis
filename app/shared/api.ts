/**
 * The only connection between the window and Edward. The window has no Node and no access to
 * Codex: it calls these methods (main/service.ts implements them) and listens for events.
 * Everything here is plain data; text from outside (mail, calendar, the model) was cleaned of
 * terminal control characters in the main process, and the window shows all of it as text, never HTML.
 */

export type Mode = "chat" | "manual" | "semi-auto" | "auto";
export type Tone = "ok" | "warn" | "fail";

export interface AppState {
  ready: boolean;
  /** Set until the ChatGPT sign-in is done. */
  signedIn: boolean;
  email?: string;
  plan?: string;
  model: string;
  effort: string;
  mode: Mode;
  threadId: string | null;
  /** Shown once after the data moved from the old Jarvis folder, or if the move failed. */
  renameNotice: string[];
  firstRun: boolean;
  google: GoogleInfo;
  background: boolean;
  webSearch: boolean;
  dataDir: string;
  version: string;
  attachments: Attachment[];
}

/** All connected Google accounts together (A1); `accounts` has each one. */
export interface GoogleInfo {
  connected: boolean;
  /** Every connected address, comma-separated. */
  email?: string;
  permissions: string[];
  /** Some connection stopped working (revoked or expired). */
  expired: boolean;
  missing: string[];
  connectedAt?: string;
  checkedAt?: string;
  /** A client to sign in with: the user's own Google Cloud file, or the one built into the app. */
  clientFile: boolean;
  accounts: AccountInfo[];
}

export interface AccountInfo {
  id: string;
  email?: string;
  name?: string;
  /** The name, or the address. */
  label: string;
  color: string;
  /** Switched on by the user. */
  mail: boolean;
  calendar: boolean;
  /** Switched on, permitted and signed in. */
  mailWorks: boolean;
  calendarWorks: boolean;
  expired: boolean;
  missing: string[];
  permissions: string[];
  connectedAt?: string;
  checkedAt?: string;
  /** New emails go from here / new events go here. */
  sendsMail: boolean;
  getsEvents: boolean;
}

/** Which account something came from, for its label and colour. */
export interface FromAccount {
  account: string;
  accountLabel: string;
  color: string;
}

export interface Attachment {
  path: string;
  name: string;
  /** edward-img:// address the window can show. */
  url: string;
}

// ---------------------------------------------------------------- conversation

export type ChatEntry =
  | { kind: "user"; id: string; text: string; images: Attachment[] }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | { kind: "activity"; id: string; icon: string; text: string; detail?: string[] }
  | { kind: "image"; id: string; url: string; path: string; prompt: string; revised?: string }
  | { kind: "notice"; id: string; tone: "guard" | "info" | "warn" | "error"; text: string };

export interface ThreadInfo {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
}

/** Something the model or Codex wants to do that needs a yes or no. */
export interface Ask {
  id: string;
  kind: "command" | "file" | "tool" | "permissions" | "question";
  title: string;
  summary: string;
  /** Command line, file list, or the exact thing that would be sent. */
  preview?: string;
  /** For Edward's own tools: whether "always allow" is offered. */
  allowAlways?: boolean;
  /** For questions: the questions and their options. */
  questions?: { id: string; header: string; question: string; options: string[] }[];
}

export type AskAnswer =
  | { decision: "accept" | "acceptForSession" | "decline" | "cancel" }
  | { answers: Record<string, string> };

// ---------------------------------------------------------------- today and the things Edward looks after

export interface EventInfo extends Partial<FromAccount> {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  calendar: string;
  guests: number;
  declined: boolean;
  /** Local day it starts, YYYY-MM-DD. */
  date: string;
  /** For the form and the week grid: "YYYY-MM-DDTHH:MM", or "YYYY-MM-DD" for all-day (end inclusive). */
  startAt: string;
  endAt: string;
  notes?: string;
  recurring: boolean;
  /** Edward may change it: a calendar you can write to, and no other guests (D22). */
  editable: boolean;
}

/** A calendar a new event can go into. */
export interface CalendarTarget extends FromAccount {
  id: string;
  name: string;
  primary: boolean;
  /** The default for new events. */
  isDefault: boolean;
}

/** The new-event / edit form. Times are local: "YYYY-MM-DDTHH:MM", or dates for all-day (end inclusive). */
export interface EventForm {
  /** CalendarTarget id (new events only). */
  target?: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  notes?: string;
}

export interface CalendarView {
  connected: boolean;
  problem?: string;
  days: { date: string; label: string; events: EventInfo[] }[];
  free: { date: string; label: string; slots: string[] }[];
  calendars: ({ name: string; primary: boolean } & Partial<FromAccount>)[];
  /** More than one calendar account: show which account each event is in. */
  manyAccounts?: boolean;
}

export interface MailSummary extends Partial<FromAccount> {
  /** "account/messageId": what mailMessage and mailOriginal take. */
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  looksLikeBill: boolean;
  unread: boolean;
}

export interface MailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  removed: string[];
  /** The email has its own HTML, so it can be shown as designed (mailOriginal). */
  hasHtml: boolean;
}

/** The email as designed, in a sandboxed frame. */
export interface MailOriginal {
  url: string;
  /** It loads pictures or styles from the web, which are blocked unless `pictures` was asked for. */
  remote: boolean;
  /** Web content is shown (asked for, or the user chose to always show it). */
  shown: boolean;
}

export type MailListView = "inbox" | "unread" | "search";

/** An email being written in the app (F1b). Addresses are comma-separated as typed. */
export interface ComposeDraft {
  mode: "new" | "reply" | "replyAll" | "forward";
  /** Account id it goes from. */
  from: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  /** Set once it has been saved as a Gmail draft. */
  draftId?: string;
}

/** What to tell the user before sending. */
export interface ComposeCheck {
  /** Reasons it can't be sent as it is. */
  problems: string[];
  /** Addresses never emailed from this account before. */
  firstTime: string[];
  /** The address it goes from. */
  from: string;
}

/** A page of a mail list; pass `cursor` back to get the next one. */
export interface MailPage {
  connected: boolean;
  items: MailSummary[];
  cursor?: string;
  problem?: string;
  manyAccounts?: boolean;
}

export interface MailView {
  connected: boolean;
  problem?: string;
  unread: MailSummary[];
  /** More than one mail account: show which account each email is in. */
  manyAccounts?: boolean;
}

export interface BillInfo {
  id: number;
  payee: string;
  category: string;
  amount: string;
  amountCents: number | null;
  dueDate: string | null;
  due: string;
  status: "pending" | "tracked" | "paid" | "autopay" | "dismissed";
  autopay: boolean;
  flags: string[];
  needsCheck: boolean;
  title: string;
  senderDomain: string;
  messageId: string;
  paidAt: string | null;
  /** Days until due; negative when overdue. */
  daysLeft: number | null;
}

export interface BillsView {
  pending: BillInfo[];
  toPay: BillInfo[];
  autopay: BillInfo[];
  paidThisMonth: BillInfo[];
  toPayTotal: string;
  paidTotal: string;
  settings: BillSettings;
  canScan: boolean;
}

export interface BillSettings {
  scan: "daily" | "manual";
  confirm: "always" | "known";
  remind: number[] | "off";
}

export interface BillHistory {
  bill: BillInfo;
  earlier: BillInfo[];
  usualDomains: string[];
}

export interface MonthView {
  month: string;
  label: string;
  total: string;
  paid: string;
  toPay: string;
  byCategory: { category: string; amount: string; share: number }[];
  bills: BillInfo[];
}

export interface ReminderInfo {
  id: number;
  text: string;
  due: string;
  dueAt: string;
  repeat: string | null;
  status: "scheduled" | "fired" | "done" | "cancelled";
}

export interface RemindersView {
  ringing: ReminderInfo[];
  upcoming: ReminderInfo[];
  brief: { time: string; days: "weekdays" | "daily" | "off"; next: string | null };
}

export interface MemoryInfo {
  id: number;
  text: string;
  kind: string;
  tier: string;
  source: string;
  status: string;
  createdAt: string;
}

export interface MemoryView {
  learning: boolean;
  core: MemoryInfo[];
  long: MemoryInfo[];
  short: MemoryInfo[];
  pending: MemoryInfo[];
}

export interface PictureInfo {
  path: string;
  url: string;
  prompt: string;
  createdAt: string;
  size?: string;
}

export interface PicturesView {
  pictures: PictureInfo[];
  folder: string;
  autoOpen: boolean;
}

export interface TodayView {
  greeting: string;
  date: string;
  evening: boolean;
  summary: string;
  events: EventInfo[];
  tomorrow: EventInfo[];
  calendarProblem?: string;
  bills: BillInfo[];
  newBills: number;
  mail: MailSummary[];
  mailCount: number;
  mailProblem?: string;
  reminders: ReminderInfo[];
  google: boolean;
}

// ---------------------------------------------------------------- care and settings

export interface Check {
  name: string;
  status: Tone;
  detail: string;
}

export interface DataView {
  dir: string;
  version: number;
  parts: { name: string; what: string; size: string }[];
  total: string;
  backups: { name: string; at: string }[];
}

export interface Settings {
  model: string;
  models: { id: string; description: string; efforts: string[] }[];
  effort: string;
  webSearch: boolean;
  learning: boolean;
  briefTime: string;
  briefDays: "weekdays" | "daily" | "off";
  background: boolean;
  dateOrder: "dmy" | "mdy";
  dateOrderDetected: boolean;
  currency: string;
  currencyDetected: boolean;
  autoOpenImages: boolean;
  /** Load pictures from the web in emails without asking. */
  mailPictures: boolean;
  imagesDir: string;
  limits: { label: string; usedPercent: number; resets: string }[];
}

export type SettingsPatch = Partial<{
  model: string;
  effort: string;
  webSearch: boolean;
  learning: boolean;
  briefTime: string;
  briefDays: "weekdays" | "daily" | "off";
  background: boolean;
  dateOrder: "dmy" | "mdy" | null;
  currency: string | null;
  autoOpenImages: boolean;
  mailPictures: boolean;
  billSettings: Partial<BillSettings>;
}>;

export interface Result {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------- the methods

export interface EdwardApi {
  state(): Promise<AppState>;
  signIn(): Promise<Result>;

  // conversation
  send(text: string): Promise<void>;
  interrupt(): Promise<void>;
  newConversation(): Promise<void>;
  conversations(): Promise<ThreadInfo[]>;
  openConversation(id: string): Promise<ChatEntry[]>;
  transcript(): Promise<ChatEntry[]>;
  setMode(mode: Mode): Promise<Result>;
  answer(id: string, answer: AskAnswer): Promise<void>;
  attachFiles(): Promise<Attachment[]>;
  attachClipboard(): Promise<Attachment[]>;
  removeAttachment(path: string): Promise<Attachment[]>;

  // views
  today(): Promise<TodayView>;
  calendar(days: number): Promise<CalendarView>;
  mail(): Promise<MailView>;
  mailMessage(id: string): Promise<MailMessage>;
  /** Inbox (30 days), Unread (24 hours, Primary) or a Gmail search, every account, a page at a time. */
  mailList(o: { view: MailListView; query?: string; cursor?: string }): Promise<MailPage>;
  /** Events from `from` up to (not including) `to`, YYYY-MM-DD, every calendar account (week and month views). */
  calendarRange(from: string, to: string): Promise<CalendarView>;
  calendarTargets(): Promise<CalendarTarget[]>;
  /** Creates an event (no id) or changes one; the user filled in the form, so no second confirmation. */
  eventSave(form: EventForm, id?: string): Promise<Result>;
  eventDelete(id: string): Promise<Result>;
  /** A new email, or a reply / reply all / forward of one (id from the list). */
  mailCompose(start?: { id: string; mode: "reply" | "replyAll" | "forward" }): Promise<ComposeDraft>;
  mailCheck(d: ComposeDraft): Promise<ComposeCheck>;
  /** Sends what the user wrote (they confirmed in the window first). */
  mailSend(d: ComposeDraft): Promise<Result>;
  mailSaveDraft(d: ComposeDraft): Promise<Result & { draftId?: string }>;
  /** "Ask Edward to write": a body from the user's notes (through the privacy guard). */
  mailWrite(d: ComposeDraft, notes: string): Promise<Result & { body?: string }>;
  /** Null when the email has no HTML. `pictures` lets it load pictures and styles from the web. */
  mailOriginal(id: string, pictures: boolean): Promise<MailOriginal | null>;
  bills(): Promise<BillsView>;
  billHistory(id: number): Promise<BillHistory>;
  billAction(id: number, action: "accept" | "ignore" | "paid"): Promise<Result>;
  billEdit(id: number, field: "amount" | "due" | "payee", value: string): Promise<Result>;
  billScan(): Promise<Result>;
  billMonth(month?: string): Promise<MonthView>;
  billExport(month: string): Promise<Result>;
  forgetBills(): Promise<Result>;
  reminders(): Promise<RemindersView>;
  reminderAction(id: number, action: "done" | "cancel" | "snooze10" | "snooze60"): Promise<Result>;
  memory(query?: string): Promise<MemoryView>;
  memoryAdd(text: string): Promise<Result>;
  memoryEdit(id: number, text: string): Promise<Result>;
  memoryForget(id: number): Promise<Result>;
  memoryReview(id: number, keep: boolean): Promise<Result>;
  memoryUndo(): Promise<Result>;
  memoryExport(): Promise<Result>;
  pictures(): Promise<PicturesView>;
  pictureAction(path: string, action: "open" | "copy" | "folder"): Promise<Result>;

  // care and settings
  settings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  chooseImagesFolder(): Promise<Settings>;
  doctor(): Promise<Check[]>;
  data(): Promise<DataView>;
  backup(): Promise<Result>;
  exportAll(): Promise<Result>;
  openDataFolder(): Promise<void>;
  deleteEverything(): Promise<Result>;
  google(): Promise<GoogleInfo>;
  chooseGoogleClient(): Promise<Result>;
  /** Adds an account (none given), or signs in to that one again. */
  connectGoogle(account?: string): Promise<Result>;
  /** Tests one account's sign-in, or all of them. */
  checkGoogle(account?: string): Promise<Result>;
  /** The only account when there is one. */
  disconnectGoogle(account?: string): Promise<Result>;
  updateAccount(account: string, patch: { name?: string; color?: string; mail?: boolean; calendar?: boolean }): Promise<Result>;
  setDefaultAccount(feature: "mail" | "calendar", account: string): Promise<Result>;
  openGuide(): Promise<void>;
  finishSetup(): Promise<void>;
}

/** Things that happen without being asked for. */
export type EdwardEvent =
  | { type: "state"; state: AppState }
  | { type: "entry"; entry: ChatEntry }
  | { type: "delta"; id: string; text: string }
  | { type: "turn"; busy: boolean; label?: string }
  | { type: "ask"; ask: Ask }
  | { type: "askDone"; id: string }
  | { type: "notice"; lines: string[] }
  | { type: "navigate"; to: string };

/** What preload puts on window.edward. */
export interface Bridge {
  call<K extends keyof EdwardApi>(method: K, ...args: Parameters<EdwardApi[K]>): ReturnType<EdwardApi[K]>;
  on(listener: (e: EdwardEvent) => void): () => void;
}
