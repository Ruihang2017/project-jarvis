/**
 * Demo mode (L, D44): a made-up Google for the tutorial videos and screenshots. Everything here is
 * invented: the people, the addresses (.example domains), the bookings. It answers the same calls
 * the real Google does (Calendar, Gmail, Tasks, the token refresh), so the real Edward runs on it
 * unchanged. Only used when the desktop app is started with EDWARD_DEMO set; never otherwise.
 */
import { localDate, nextDate } from "../google/calendar.js";
import { buildRaw } from "../google/gmail.js";
import { toLocal } from "../reminders/schedule.js";

export const DEMO_EMAIL = "alex.morgan.demo@gmail.com";

type Category = "primary" | "promotions" | "social" | "updates" | "forums";
interface Mail {
  id: string;
  from: string;
  to?: string;
  subject: string;
  /** Hours ago. */
  ago: number;
  body: string;
  html?: string;
  category?: Category;
  unread?: boolean;
  sent?: boolean;
  /** Matches the bill or booking searches. */
  bill?: boolean;
  booking?: boolean;
}

const ld = (o: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(o)}</script></head><body style="font-family:Arial,sans-serif;color:#222">`;

/** The made-up mailbox, calendar and lists, with times relative to `now`. */
export function demoData(now = new Date()) {
  const today = localDate(now);
  const at = (day: number, hhmm: string) => `${nextDate(today, day)}T${hhmm}`;
  // About 40 minutes from now, on a quarter hour; never past today, because its email says "today".
  const soon = Math.ceil((now.getTime() + 40 * 60_000) / (15 * 60_000)) * 15 * 60_000;
  const visit = new Date(Math.min(soon, new Date(`${today}T23:45`).getTime()));
  const visitAt = toLocal(visit).slice(11, 16);
  const flightDay = nextDate(today, 2);
  const zone = (() => {
    const m = -new Date(`${flightDay}T07:30`).getTimezoneOffset();
    return `${m >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}:${String(Math.abs(m) % 60).padStart(2, "0")}`;
  })();

  const mail: Mail[] = [
    {
      id: "d01",
      from: "Sam Carter <sam@carterbuilding.example>",
      subject: "Site visit today: tiles and benchtop",
      ago: 2,
      unread: true,
      body: `Hi Alex,\n\nSee you at 14 Wattle St at ${visitAt} for the site visit.\n\nCan you let me know which benchtop colour you want, Snow White or Ash Grey? I need to order it by Thursday so the install stays on Monday.\n\nThanks,\nSam\nCarter Building`,
    },
    {
      id: "d02",
      from: "Priya Shah <priya.shah@mailbox.example>",
      subject: "Dinner tonight?",
      ago: 3,
      unread: true,
      body: "Hey! Still on for 6:30 at Harbour Bistro tonight? I booked a table for two near the window. Let me know if you're running late.\n\nPriya",
    },
    {
      id: "d03",
      from: "Southern Cross Air <bookings@southerncrossair.example>",
      subject: "Your booking confirmation: Sydney to Melbourne",
      ago: 20,
      category: "updates",
      booking: true,
      body: `Thanks for booking with Southern Cross Air.\n\nFlight SX 412, Sydney to Melbourne\nDeparts ${flightDay} 07:30, arrives 09:05\nBooking reference: KQ7ZPL\n\nCheck-in opens 24 hours before departure.`,
      html: `${ld({
        "@context": "http://schema.org",
        "@type": "FlightReservation",
        reservationNumber: "KQ7ZPL",
        reservationFor: {
          "@type": "Flight",
          flightNumber: "412",
          airline: { "@type": "Airline", name: "Southern Cross Air", iataCode: "SX" },
          departureAirport: { "@type": "Airport", name: "Sydney Airport", iataCode: "SYD" },
          departureTime: `${flightDay}T07:30:00${zone}`,
          arrivalAirport: { "@type": "Airport", name: "Melbourne Airport", iataCode: "MEL" },
          arrivalTime: `${flightDay}T09:05:00${zone}`,
        },
      })}<h2>Your trip to Melbourne</h2><p>Flight SX 412 · ${flightDay} 07:30 → 09:05</p></body></html>`,
    },
    {
      id: "d04",
      from: "Collins Lane Hotel <stay@collinslane.example>",
      subject: "Your reservation is confirmed",
      ago: 19,
      category: "updates",
      booking: true,
      body: `Dear Alex,\n\nWe look forward to welcoming you to Collins Lane Hotel, 210 Collins St, Melbourne VIC 3000.\nCheck-in ${flightDay}, check-out ${nextDate(today, 5)}.`,
      html: `${ld({
        "@context": "http://schema.org",
        "@type": "LodgingReservation",
        reservationNumber: "CL-55102",
        checkinDate: flightDay,
        checkoutDate: nextDate(today, 5),
        reservationFor: { "@type": "LodgingBusiness", name: "Collins Lane Hotel", address: { "@type": "PostalAddress", streetAddress: "210 Collins St", addressLocality: "Melbourne", addressRegion: "VIC", postalCode: "3000", addressCountry: "AU" } },
      })}<h2>See you soon in Melbourne</h2><p>Collins Lane Hotel · 3 nights</p></body></html>`,
    },
    {
      id: "d05",
      from: "Northwind Energy <billing@northwindenergy.example>",
      subject: "Your electricity bill is ready",
      ago: 26,
      category: "updates",
      bill: true,
      body: `Hi Alex,\n\nYour electricity bill for September is ready.\nAmount due: $245.30\nDue date: ${nextDate(today, 3)}\n\nPay in the Northwind app or by direct debit.`,
    },
    {
      id: "d06",
      from: "Harbour Water <accounts@harbourwater.example>",
      subject: "Your October water bill",
      ago: 30,
      category: "updates",
      bill: true,
      body: `Amount due: $86.50\nDue date: ${nextDate(today, 21)}\nCustomer number 4451 2290 18`,
    },
    {
      id: "d07",
      from: "Northside Dental <reminders@northsidedental.example>",
      subject: "Appointment reminder: tomorrow at 10:00",
      ago: 6,
      category: "updates",
      body: "Hi Alex, a reminder of your check-up with Dr Wong tomorrow at 10:00 at 88 Miller St, North Sydney. Reply C to confirm.",
    },
    {
      id: "d08",
      from: "Parcel Express <tracking@parcelexpress.example>",
      subject: "Your parcel arrives tomorrow",
      ago: 5,
      category: "updates",
      body: "Good news: your parcel from Homewares Co is out for delivery tomorrow between 9am and 1pm.",
    },
    {
      id: "d09",
      from: "Wattle Primary School <office@wattleprimary.example>",
      subject: "Term 4 newsletter",
      ago: 9,
      category: "updates",
      body: "Welcome back to Term 4. The swimming carnival is on Friday 23 October; please return the permission note by Wednesday.",
    },
    { id: "d10", from: "LinkedIn <messages-noreply@linkedin.example>", subject: "You have 2 new messages", ago: 4, category: "social", body: "Jordan Lee and Mia Chen sent you messages." },
    { id: "d11", from: "LinkedIn <invitations@linkedin.example>", subject: "Mia Chen wants to connect", ago: 7, category: "social", body: "Mia Chen, Product designer, wants to connect." },
    { id: "d12", from: "Homewares Co <deals@homewaresco.example>", subject: "40% off everything this weekend", ago: 10, category: "promotions", body: "Huge sale." },
    { id: "d13", from: "Fresh Grocer <hello@freshgrocer.example>", subject: "Your weekly specials", ago: 12, category: "promotions", body: "Specials." },
    { id: "d14", from: "Sneaker Hub <news@sneakerhub.example>", subject: "New arrivals", ago: 13, category: "promotions", body: "New." },
    { id: "d15", from: "Travel Deals <offers@traveldeals.example>", subject: "Bali from $299", ago: 15, category: "promotions", body: "Fly." },
    {
      id: "d16",
      from: "Fibreline Internet <billing@fibreline.example>",
      subject: "Your invoice",
      ago: 50,
      category: "updates",
      bill: true,
      body: `Your invoice of $79.00 will be paid by direct debit on ${nextDate(today, 11)}. Account number 12345678.`,
    },
    // Sent mail, so a reply to these people isn't "first time".
    { id: "s01", from: `Alex Morgan <${DEMO_EMAIL}>`, to: "sam@carterbuilding.example", subject: "Re: Quote for the kitchen", ago: 200, sent: true, body: "Thanks Sam, let's go ahead." },
    { id: "s02", from: `Alex Morgan <${DEMO_EMAIL}>`, to: "priya.shah@mailbox.example", subject: "Re: Saturday", ago: 120, sent: true, body: "Sounds good!" },
  ];

  const calendars = [
    { id: DEMO_EMAIL, summary: DEMO_EMAIL, primary: true, accessRole: "owner" },
    { id: "en.australian#holiday@group.v.calendar.google.com", summary: "Holidays in Australia", selected: true, accessRole: "reader" },
  ];
  type Ev = { id: string; cal: string; summary: string; start: string; end: string; location?: string; description?: string; attendees?: { email: string; displayName?: string; self?: boolean }[] };
  const events: Ev[] = [
    { id: "e01", cal: DEMO_EMAIL, summary: "Gym", start: at(0, "07:00"), end: at(0, "08:00") },
    {
      id: "e02",
      cal: DEMO_EMAIL,
      summary: "Kitchen renovation site visit",
      start: toLocal(visit).slice(0, 16),
      end: toLocal(new Date(visit.getTime() + 45 * 60_000)).slice(0, 16),
      location: "14 Wattle St, Marrickville NSW",
      attendees: [{ email: DEMO_EMAIL, self: true }, { email: "sam@carterbuilding.example", displayName: "Sam Carter" }],
    },
    { id: "e03", cal: DEMO_EMAIL, summary: "Dinner with Priya", start: at(0, "18:30"), end: at(0, "20:30"), location: "Harbour Bistro, Circular Quay" },
    { id: "e04", cal: DEMO_EMAIL, summary: "Dentist: Dr Wong", start: at(1, "10:00"), end: at(1, "10:45"), location: "88 Miller St, North Sydney" },
    { id: "e05", cal: DEMO_EMAIL, summary: "Team planning", start: at(1, "13:00"), end: at(1, "14:30") },
    { id: "e06", cal: DEMO_EMAIL, summary: "School pick-up", start: at(1, "15:15"), end: at(1, "15:45") },
    { id: "e07", cal: DEMO_EMAIL, summary: "Ella's birthday", start: nextDate(today, 4), end: nextDate(today, 5) },
    { id: "e08", cal: DEMO_EMAIL, summary: "Car service", start: at(6, "08:30"), end: at(6, "10:00"), location: "Inner West Auto, 5 Parramatta Rd" },
    { id: "e09", cal: DEMO_EMAIL, summary: "Kitchen install", start: at(7, "08:00"), end: at(7, "16:00"), location: "Home" },
    { id: "e10", cal: DEMO_EMAIL, summary: "Swimming lesson", start: at(-1, "17:00"), end: at(-1, "17:45") },
    { id: "h01", cal: "en.australian#holiday@group.v.calendar.google.com", summary: "Labour Day (NSW)", start: nextDate(today, 8), end: nextDate(today, 9) },
  ];

  const lists = [
    { id: "L1", title: "Shopping", tasks: ["Milk", "Eggs", "Sourdough", "Coffee beans", "Dishwasher tablets"].map((t) => ({ title: t })) },
    { id: "L2", title: "Home", tasks: [{ title: "Fix the leaking tap", due: nextDate(today, 5) }, { title: "Replace smoke alarm battery", due: nextDate(today, -2) }, { title: "Clean the gutters" }] },
    { id: "L3", title: "Packing", tasks: ["Phone charger", "Headphones", "Running shoes", "Rain jacket"].map((t) => ({ title: t })) },
  ];
  return { mail, calendars, events, lists, today };
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

/** Rough Gmail search over the made-up mailbox: enough for Edward's own queries and simple searches. */
function search(all: Mail[], q: string, now: Date): Mail[] {
  const after = /after:(\d+)/.exec(q);
  const newer = /newer_than:(\d+)d/.exec(q);
  const since = after ? Number(after[1]) * 1000 : newer ? now.getTime() - Number(newer[1]) * 86_400_000 : 0;
  const time = (m: Mail) => now.getTime() - m.ago * 3_600_000;
  let list = all.filter((m) => time(m) >= since);
  if (q.includes("in:sent")) {
    const to = /to:(\S+)/.exec(q)?.[1];
    return list.filter((m) => m.sent && (!to || m.to === to));
  }
  list = list.filter((m) => !m.sent);
  if (q.includes('"amount due"')) return list.filter((m) => m.bill);
  if (q.includes("subject:itinerary")) return list.filter((m) => m.booking);
  const cat = (m: Mail) => m.category ?? "primary";
  for (const c of ["primary", "promotions", "social", "updates", "forums"]) {
    if (q.includes(`-category:${c}`)) list = list.filter((m) => cat(m) !== c);
    else if (q.includes(`category:${c}`)) list = list.filter((m) => cat(m) === c);
  }
  if (q.includes("is:unread")) list = list.filter((m) => m.unread);
  const people = [...q.matchAll(/(?:from|to):([^\s{}]+@[^\s{}]+)/g)].map((m) => m[1]!.toLowerCase());
  if (people.length) list = list.filter((m) => people.some((p) => m.from.toLowerCase().includes(p)));
  const subject = /subject:"([^"]+)"/.exec(q)?.[1];
  if (subject) list = list.filter((m) => m.subject.toLowerCase().includes(subject.toLowerCase()));
  // Plain words: all must appear somewhere.
  const words = q
    .replace(/\{[^}]*\}|-?\w+:("[^"]*"|\([^)]*\)|\S+)/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
  if (words.length) list = list.filter((m) => words.every((w) => `${m.from} ${m.subject} ${m.body}`.toLowerCase().includes(w.toLowerCase())));
  return list.sort((a, b) => a.ago - b.ago);
}

function message(m: Mail, now: Date, full: boolean) {
  const labels = [...(m.unread ? ["UNREAD"] : []), ...(m.sent ? ["SENT"] : ["INBOX"]), `CATEGORY_${(m.category ?? "primary").toUpperCase()}`];
  const headers = [
    { name: "From", value: m.from },
    { name: "To", value: m.to ?? `Alex Morgan <${DEMO_EMAIL}>` },
    { name: "Subject", value: m.subject },
    { name: "Date", value: new Date(now.getTime() - m.ago * 3_600_000).toUTCString() },
    { name: "Message-ID", value: `<${m.id}@demo.example>` },
  ];
  const base = { id: m.id, threadId: `t-${m.id}`, labelIds: labels, snippet: m.body.slice(0, 120).replace(/\s+/g, " "), internalDate: String(now.getTime() - m.ago * 3_600_000) };
  if (!full) return { ...base, payload: { headers } };
  const parts = [{ mimeType: "text/plain", headers: [], body: { data: b64(m.body) } }, ...(m.html ? [{ mimeType: "text/html", headers: [], body: { data: b64(m.html) } }] : [])];
  return { ...base, payload: { mimeType: "multipart/alternative", headers, parts } };
}

interface DemoDraft {
  /** The email as Edward built it (base64url RFC 2822, plain text). */
  raw: string;
  threadId: string;
  at: number;
}

/** A kept draft, read back as a message: its headers and its text. */
function draftMessage(id: string, d: DemoDraft) {
  const text = Buffer.from(d.raw, "base64url").toString("utf8");
  const split = text.indexOf("\r\n\r\n");
  const headers = (split < 0 ? text : text.slice(0, split)).split("\r\n").filter(Boolean).map((l) => ({ name: l.slice(0, l.indexOf(":")), value: l.slice(l.indexOf(":") + 1).trim() }));
  const body = split < 0 ? "" : Buffer.from(text.slice(split + 4).replace(/\r\n/g, ""), "base64").toString("utf8");
  return { id: `m-${id}`, threadId: d.threadId, labelIds: ["DRAFT"], snippet: body.slice(0, 120).replace(/\s+/g, " "), internalDate: String(d.at), payload: { mimeType: "text/plain", headers, body: { data: b64(body) } } };
}

/**
 * A fetch that answers Google's endpoints from the made-up data (and refuses anything else, so
 * nothing leaves the computer by mistake). Changes (new events, ticked items, drafts) last until quit.
 */
export function demoGoogle(now = () => new Date()): typeof fetch {
  const data = demoData(now());
  let n = 100;
  // One draft waiting from earlier, so the Drafts list has something to show.
  const drafts = new Map<string, DemoDraft>([
    [
      "dr1",
      {
        raw: buildRaw({ to: ["Priya Shah <priya.shah@mailbox.example>"], cc: [], subject: "Weekend at the coast?", body: "Hi Priya,\n\nAre you free the weekend of the 24th? I was thinking of the coast house again.\n\nAlex" }),
        threadId: "t-dr1",
        at: now().getTime() - 26 * 3_600_000,
      },
    ],
  ]);
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return {}; } })() : {};
    const path = u.pathname;
    const t = now();

    if (u.host === "oauth2.googleapis.com") return path.endsWith("/token") ? json({ access_token: "demo", expires_in: 3600, scope: "", token_type: "Bearer" }) : json({});

    if (u.host === "gmail.googleapis.com") {
      const rest = path.replace("/gmail/v1/users/me", "");
      if (rest === "/messages") {
        const hits = search(data.mail, u.searchParams.get("q") ?? "", t);
        const max = Number(u.searchParams.get("maxResults") ?? 25);
        return json({ messages: hits.slice(0, max).map((m) => ({ id: m.id, threadId: `t-${m.id}` })), resultSizeEstimate: hits.length });
      }
      const msg = /^\/messages\/([^/]+)$/.exec(rest);
      if (msg) {
        const m = data.mail.find((x) => x.id === decodeURIComponent(msg[1]!));
        return m ? json(message(m, t, u.searchParams.get("format") === "full")) : json({ error: { message: "Not found" } }, 404);
      }
      const thread = /^\/threads\/t-(.+)$/.exec(rest);
      if (thread) {
        const m = data.mail.find((x) => x.id === decodeURIComponent(thread[1]!));
        return m ? json({ id: `t-${m.id}`, messages: [message(m, t, true)] }) : json({ error: { message: "Not found" } }, 404);
      }
      // Drafts are kept as they were given (the raw email) and read back the way Gmail's format=full does.
      if (rest === "/drafts" && method === "GET") return json({ drafts: [...drafts.keys()].reverse().map((id) => ({ id })) });
      if (rest === "/drafts" && method === "POST") {
        const id = `dr${++n}`;
        drafts.set(id, { raw: String(body.message?.raw ?? ""), threadId: body.message?.threadId ?? `t${n}`, at: t.getTime() });
        return json({ id, message: { id: `m-${id}`, threadId: drafts.get(id)!.threadId } });
      }
      if (rest === "/drafts/send") {
        drafts.delete(String(body.id));
        return json({ id: `m${++n}`, threadId: `t${n}`, labelIds: ["SENT"] });
      }
      const draft = /^\/drafts\/([^/]+)$/.exec(rest);
      const kept = draft ? drafts.get(draft[1]!) : undefined;
      if (draft && !kept) return json({ error: { message: "Not found" } }, 404);
      if (draft && kept && method === "PUT") {
        drafts.set(draft[1]!, { ...kept, raw: String(body.message?.raw ?? ""), at: t.getTime() });
        return json({ id: draft[1], message: { id: `m-${draft[1]}`, threadId: kept.threadId } });
      }
      if (draft && kept) return json({ id: draft[1], message: draftMessage(draft[1]!, kept) });
      return json({});
    }

    if (u.host === "www.googleapis.com" && path.startsWith("/calendar/v3")) {
      const rest = path.replace("/calendar/v3", "");
      if (rest === "/users/me/calendarList") return json({ items: data.calendars });
      const ev = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(rest);
      if (ev) {
        const cal = decodeURIComponent(ev[1]!);
        const id = ev[2] ? decodeURIComponent(ev[2]) : undefined;
        const toApi = (e: (typeof data.events)[number]) => ({
          id: e.id,
          summary: e.summary,
          location: e.location,
          description: e.description,
          attendees: e.attendees,
          start: e.start.length === 10 ? { date: e.start } : { dateTime: new Date(e.start).toISOString() },
          end: e.end.length === 10 ? { date: e.end } : { dateTime: new Date(e.end).toISOString() },
        });
        const time = (x: { date?: string; dateTime?: string }) => (x.date ? x.date : toLocal(new Date(x.dateTime!)).replace(" ", "T").slice(0, 16));
        if (method === "POST") {
          const e = { id: `e${++n}`, cal, summary: body.summary ?? "", location: body.location, description: body.description, start: time(body.start), end: time(body.end) };
          data.events.push(e);
          return json(toApi(e));
        }
        const e = id ? data.events.find((x) => x.id === id && x.cal === cal) : undefined;
        if (id && !e) return json({ error: { message: "Not found" } }, 404);
        if (e && method === "DELETE") {
          data.events.splice(data.events.indexOf(e), 1);
          return new Response(null, { status: 204 });
        }
        if (e && method === "PATCH") {
          if (body.summary !== undefined) e.summary = body.summary;
          if (body.location !== undefined) e.location = body.location;
          if (body.description !== undefined) e.description = body.description;
          if (body.start) e.start = time(body.start);
          if (body.end) e.end = time(body.end);
          return json(toApi(e));
        }
        if (e) return json(toApi(e));
        const min = new Date(u.searchParams.get("timeMin") ?? 0).getTime();
        const max = new Date(u.searchParams.get("timeMax") ?? 8.64e15).getTime();
        const ms = (s: string) => new Date(s.length === 10 ? `${s}T00:00` : s).getTime();
        const q = u.searchParams.get("q")?.toLowerCase();
        return json({ items: data.events.filter((x) => x.cal === cal && ms(x.start) < max && ms(x.end) > min && (!q || x.summary.toLowerCase().includes(q))).sort((a, b) => ms(a.start) - ms(b.start)).map(toApi) });
      }
      return json({});
    }

    if (u.host === "tasks.googleapis.com") {
      const rest = path.replace("/tasks/v1", "");
      if (rest === "/users/@me/lists" || rest === "/users/%40me/lists") {
        if (method === "POST") {
          const l = { id: `L${++n}`, title: body.title ?? "List", tasks: [] as { title: string; due?: string; done?: boolean; id?: string; notes?: string }[] };
          data.lists.push(l);
          return json({ id: l.id, title: l.title });
        }
        return json({ items: data.lists.map((l) => ({ id: l.id, title: l.title })) });
      }
      const tk = /^\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/.exec(rest);
      if (tk) {
        const list = data.lists.find((l) => l.id === decodeURIComponent(tk[1]!));
        if (!list) return json({ error: { message: "Not found" } }, 404);
        type T = { title: string; due?: string; done?: boolean; id?: string; notes?: string };
        const items = list.tasks as T[];
        items.forEach((x, i) => (x.id ??= `${list.id}-${i}`));
        const toApi = (x: T) => ({ id: x.id, title: x.title, notes: x.notes, due: x.due ? `${x.due}T00:00:00.000Z` : undefined, status: x.done ? "completed" : "needsAction", completed: x.done ? new Date().toISOString() : undefined });
        if (method === "POST") {
          const x: T = { id: `${list.id}-${++n}`, title: body.title, notes: body.notes, due: body.due?.slice(0, 10) };
          items.push(x);
          return json(toApi(x));
        }
        const x = tk[2] ? items.find((i) => i.id === decodeURIComponent(tk[2]!)) : undefined;
        if (x && method === "DELETE") {
          items.splice(items.indexOf(x), 1);
          return new Response(null, { status: 204 });
        }
        if (x && method === "PATCH") {
          if (body.title !== undefined) x.title = body.title;
          if (body.notes !== undefined) x.notes = body.notes;
          if (body.due !== undefined) x.due = body.due ? String(body.due).slice(0, 10) : undefined;
          if (body.status) x.done = body.status === "completed";
          return json(toApi(x));
        }
        return json({ items: items.map(toApi) });
      }
      return json({});
    }
    return json({ error: { message: `demo mode: ${u.host} isn't part of the demo` } }, 400);
  }) as typeof fetch;
}
