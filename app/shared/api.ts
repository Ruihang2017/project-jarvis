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
  /** Set until the sign-in is done: a ChatGPT plan, or an OpenAI API key. */
  signedIn: boolean;
  /** Codex is using an OpenAI API key: no plan limits to show, and no image generation. */
  apiKey: boolean;
  /** Edward has an OpenAI API key for voice: the one it runs on, or one added for voice alone. */
  voiceKey: boolean;
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
  /** Lists (Google Tasks) are kept here / could be (permission given). */
  keepsLists: boolean;
  listsWork: boolean;
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
  | ({ kind: "draft"; id: string } & DraftCard)
  | { kind: "image"; id: string; url: string; path: string; prompt: string; revised?: string }
  | { kind: "notice"; id: string; tone: "guard" | "info" | "warn" | "error"; text: string };

/** An email draft Edward wrote in the conversation, shown whole so it can be read, edited and sent here. */
export interface DraftCard {
  /** The handle the model knows it by ("d2"). */
  ref: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  /**
   * "account/draftId": what mailDraftOpen takes. Only while the draft can still be opened from here:
   * not in a conversation reopened later, and not once it was sent or replaced by a newer version.
   */
  draftKey?: string;
  state?: "sent" | "replaced";
}

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

/** A draft in Gmail's Drafts, in the Mail page's list. */
export interface DraftSummary extends Partial<FromAccount> {
  /** "account/draftId": what mailDraftOpen takes. */
  id: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  /** False when it has formatting or attachments from Gmail that Edward's plain-text form would lose. */
  editable: boolean;
}

export interface DraftsView {
  connected: boolean;
  items: DraftSummary[];
  problem?: string;
  manyAccounts?: boolean;
}

/** A Gmail draft opened in the app. */
export interface OpenedDraft {
  /** For the form; its draftId is set, so saving and sending change this same draft. */
  draft: ComposeDraft;
  editable: boolean;
  /** The address it goes from, and where to open it in Gmail when it can't be edited here. */
  from: string;
  gmailUrl: string;
}

/** A page of a mail list; pass `cursor` back to get the next one. */
export interface MailPage {
  connected: boolean;
  items: MailSummary[];
  cursor?: string;
  problem?: string;
  manyAccounts?: boolean;
}

/** Lists in Google Tasks (F3). */
export interface ListsView {
  connected: boolean;
  /** Google is connected but the lists permission hasn't been given yet: sign in again. */
  needsPermission: boolean;
  problem?: string;
  /** The account that keeps the lists. */
  account?: FromAccount;
  lists: { id: string; title: string; open: number }[];
  /** The list shown, and its items (open ones, then those ticked off this week). */
  selected?: string;
  items: TaskItem[];
  /** Usual lists not made yet ("Shopping", "Home"). */
  suggested: string[];
}

export interface TaskItem {
  id: string;
  title: string;
  notes?: string;
  /** YYYY-MM-DD */
  due?: string;
  dueLabel?: string;
  overdue: boolean;
  done: boolean;
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

/** Meeting heads-up (H1): the next event within three hours that has a place, people or related email. */
export interface ComingUp {
  event: EventInfo;
  /** "in 25 min" */
  when: string;
  /** Google Maps search for the place (a link only). */
  mapUrl?: string;
  /** "Alice and Bob" */
  withWhom?: string;
  related: MailSummary[];
  /** From memory, about the people in it. */
  notes: string[];
}

/** Mail summary (H4): new mail sorted by what needs the user. Item ids open in Mail like list ids. */
export interface DigestView {
  /** When it was made ("08:30", "yesterday 18:00") and the mail it covers from. */
  made: string;
  since: string;
  /** Made today. */
  today: boolean;
  /** "3 to act on, 5 worth knowing" */
  headline: string;
  items: (Partial<FromAccount> & { id: string; group: "act" | "know" | "social"; line: string; from: string; subject: string; due?: string })[];
  bills: { id: string; line: string }[];
  /** "The rest: 12 not needed, 23 adverts." */
  rest: string;
  /** Numbers the privacy guard took out before the model read the emails. */
  removed: number;
  problems: string[];
}

/** Weekly review (H3): the seven days from tomorrow. */
export interface WeekView {
  /** "9 events, 2 bills, 3 to-dos" */
  headline: string;
  days: { date: string; label: string; events: string[] }[];
  bills: string[];
  todo: string[];
  reminders: string[];
  problems: string[];
}

/** A trip found in booking emails (H2). */
export interface TripInfo {
  id: number;
  kind: "flight" | "hotel" | "car" | "train";
  title: string;
  /** "Fri 10-09 07:30 → 08:55" */
  when: string;
  where?: string;
  mapUrl?: string;
  status: "new" | "added" | "dismissed";
  /** Found by the model and not confirmed by the email. */
  needsCheck: boolean;
  /** "05:30", for flights and trains. */
  leaveBy?: string;
  bufferMin: number;
  /** Opens in Mail like a list id. */
  mailId: string;
  weather?: string;
}

export interface TodayView {
  greeting: string;
  date: string;
  evening: boolean;
  summary: string;
  comingUp?: ComingUp;
  /** Today's latest mail summary, if one was made. */
  digest?: DigestView;
  /** On the weekly review's day, from its time. */
  week?: WeekView;
  /** Bookings just found, and the next trip within a week. */
  trips?: { found: TripInfo[]; next?: TripInfo };
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
  /** Meeting heads-up (H1): minutes before, or off. */
  meetingLead: MeetingLead;
  /** Mail summary times (H4); empty when off. */
  mailSummaryTimes: string[];
  /** Weekly review (H3): null when off. */
  weeklyReview: { day: number; time: string } | null;
  imagesDir: string;
  limits: { label: string; usedPercent: number; resets: string }[];
}

export type MeetingLead = "15" | "30" | "60" | "off";

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
  meetingLead: MeetingLead;
  mailSummaryTimes: string[] | "off";
  weeklyReview: { day: number; time: string } | "off";
  billSettings: Partial<BillSettings>;
}>;

export interface Result {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------- the methods

export interface EdwardApi {
  state(): Promise<AppState>;
  /** Sign in with ChatGPT in the browser; also how to switch back from an API key. */
  signIn(): Promise<Result>;
  /** Switch to an OpenAI API key (P): checked with OpenAI first, then handed to Codex; not kept by the window. */
  aiUseKey(key: string): Promise<Result>;

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
  voiceInfo(): Promise<VoiceInfo>;
  /** Checks the key with OpenAI, then keeps it encrypted on this computer. */
  voiceSaveKey(key: string): Promise<Result>;
  voiceRemoveKey(): Promise<Result>;
  voiceSetVoice(voice: string): Promise<Result>;
  /** Answers the window's WebRTC offer (the key stays in the main process). */
  voiceConnect(offer: string): Promise<Result & { sdp?: string }>;
  /** What the user said, transcribed: goes into the conversation like typed text; the reply comes back as voiceSay. */
  voiceHeard(text: string): Promise<void>;
  /** Usage OpenAI reported on the call (a spoken reply's tokens, a transcription's length), for the spend estimate. */
  voiceUsage(u: { kind: "response" | "transcription"; usage: unknown }): Promise<void>;
  /** The lists, and the items of one (the first when none is named). */
  lists(listId?: string): Promise<ListsView>;
  listCreate(title: string): Promise<Result & { id?: string }>;
  listAdd(listId: string, item: { title: string; due?: string }): Promise<Result>;
  listUpdate(listId: string, itemId: string, patch: { title?: string; done?: boolean; due?: string | null; notes?: string }): Promise<Result>;
  listRemove(listId: string, itemId: string): Promise<Result>;
  /** Creates an event (no id) or changes one; the user filled in the form, so no second confirmation. */
  eventSave(form: EventForm, id?: string): Promise<Result>;
  eventDelete(id: string): Promise<Result>;
  /** A new email, or a reply / reply all / forward of one (id from the list). */
  mailCompose(start?: { id: string; mode: "reply" | "replyAll" | "forward" }): Promise<ComposeDraft>;
  mailCheck(d: ComposeDraft): Promise<ComposeCheck>;
  /** Sends what the user wrote (they confirmed in the window first). */
  mailSend(d: ComposeDraft): Promise<Result>;
  mailSaveDraft(d: ComposeDraft): Promise<Result & { draftId?: string }>;
  /**
   * "Ask Edward to write": the email from the user's notes. The model also gets what Edward remembers
   * about the user and may look up related mail, all through the privacy guard. `fill` is what to put
   * in the form: the text, and a recipient and subject where the user left them empty.
   */
  mailWrite(d: ComposeDraft, notes: string): Promise<Result & { fill?: { to?: string; subject?: string; body: string } }>;
  /** The drafts in Gmail, from every mail account, newest first. */
  mailDrafts(): Promise<DraftsView>;
  /** Opens a Gmail draft (from the Drafts list, or a draft card in the conversation) as it is now. */
  mailDraftOpen(key: string): Promise<Result & { opened?: OpenedDraft }>;
  /** Null when the email has no HTML. `pictures` lets it load pictures and styles from the web. */
  mailOriginal(id: string, pictures: boolean): Promise<MailOriginal | null>;
  /** Trips (H2): add to the calendar, not a trip, the details are right, make a packing list. */
  tripAction(id: number, action: "calendar" | "dismiss" | "confirm" | "packing"): Promise<Result>;
  /** Minutes before departure to leave (60, 90, 120 or 180). */
  tripBuffer(id: number, minutes: number): Promise<Result>;
  tripScan(): Promise<Result>;
  /** The latest mail summary (H4), or null. */
  mailDigest(): Promise<DigestView | null>;
  /** Summarises the mail since the last summary now (the model reads it, through the privacy guard). */
  mailSummarize(): Promise<Result & { digest?: DigestView }>;
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
  setDefaultAccount(feature: "mail" | "calendar" | "tasks", account: string): Promise<Result>;
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
  | { type: "navigate"; to: string }
  /** Voice (V): read this reply aloud. */
  | { type: "voiceSay"; text: string };

/** Voice (V): what Settings and the mic button need to know. */
export interface VoiceInfo {
  /** An OpenAI API key is saved (it is never shown again). */
  hasKey: boolean;
  voice: string;
  voices: string[];
  model: string;
  /** Estimated spend on voice with the user's key: "$0.42", "under 1¢". */
  spentToday: string;
  spent30: string;
}

/** What preload puts on window.edward. */
export interface Bridge {
  call<K extends keyof EdwardApi>(method: K, ...args: Parameters<EdwardApi[K]>): ReturnType<EdwardApi[K]>;
  on(listener: (e: EdwardEvent) => void): () => void;
}
