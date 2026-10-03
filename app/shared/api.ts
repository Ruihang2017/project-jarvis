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

export interface GoogleInfo {
  connected: boolean;
  email?: string;
  permissions: string[];
  /** The connection stopped working (revoked or expired). */
  expired: boolean;
  missing: string[];
  connectedAt?: string;
  checkedAt?: string;
  /** Whether the user's own Google Cloud client file is in place. */
  clientFile: boolean;
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

export interface EventInfo {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  calendar: string;
  guests: number;
  declined: boolean;
}

export interface CalendarView {
  connected: boolean;
  problem?: string;
  days: { date: string; label: string; events: EventInfo[] }[];
  free: { date: string; label: string; slots: string[] }[];
  calendars: { name: string; primary: boolean }[];
}

export interface MailSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  looksLikeBill: boolean;
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
}

export interface MailView {
  connected: boolean;
  problem?: string;
  unread: MailSummary[];
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
  connectGoogle(): Promise<Result>;
  checkGoogle(): Promise<Result>;
  disconnectGoogle(): Promise<Result>;
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
