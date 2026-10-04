# Changelog

## 0.2.0 — 2026-10-05

The desktop app, with a Windows installer.


- Renamed from Jarvis to Edward, with a new icon. The command is `edward` (`jarvis` still works for now).
  On the first start the data moves from `%LOCALAPPDATA%\Jarvis` to `%LOCALAPPDATA%\Edward`, after a
  backup; the background task and notifications move with it. `JARVIS_*` environment variables still work.
- Desktop app (Electron): every page, the setup flow, tray, Windows installer.
- Several Google accounts: mail, calendars and bills from all of them, labelled by account; replies go
  from the account the email came to; defaults for new emails and events; `/accounts`. Google Workspace
  (work or school) accounts are refused. The existing account moves into `accounts\g1\` on first start.
- Emails show as sent (their own HTML in a sandboxed frame; pictures from the web only when asked), and
  marketing mail with a broken plain-text part reads properly.
- Desktop app: an Inbox of the last 30 days with search, writing, replying and forwarding email; Week
  and Month calendar views with a form to add, change and delete events.
- Lists in Google Tasks: shopping list, home jobs, to-dos, on the Lists page, in conversation and in the
  morning brief (new Google permission: sign in again).
- Heads-up before events that have a place, other people or related email (default 30 minutes; the
  evening before for early starts): where, who, the related emails, a map link. Code only, no model.
- Mail summary: new mail sorted into "to act on", "worth knowing" and "social", twice a day while Edward
  is open (08:30 and 18:00) or on request (Mail → Summary, `/mail summary`). Adverts and forums are only
  counted; the model reads the rest through the privacy guard.
- Weekly review: the next seven days (events, bills, to-dos, reminders) on Sunday at 19:00, with "Plan
  my week". Code only.
- Trips: flights, hotels, car hire and trains from booking emails (`/trips`, the Today page): add to the
  calendar, the evening before, when to leave (2 hours before by default), the weather there (Open-Meteo),
  a packing list in Lists. Booking references and ticket, member or passport numbers are never kept.
- Voice in the desktop app with OpenAI's realtime model and your own OpenAI API key: talk, and hear the
  reply. Spoken words aren't checked by the privacy guard; the app says so. Settings → Voice shows an
  estimate of what voice has cost on your key today and in the last 30 days.
- Edward finds Codex where OpenAI's installer puts it, and says how to install it when it is missing.
- Fixed: an error box when quitting the desktop app; the voice indicator turning into an oval; page
  titles folding up in a narrow window.

## 0.1.0 — developer preview

First public version.

- Terminal assistant on `codex app-server` with your own ChatGPT account: streaming replies, web search,
  image generation with inline previews, conversation history.
- Memory: what you tell Edward, kept as short- or long-term facts, recalled when relevant.
- Reminders with repeat rules, Windows notifications, and a background task so they fire when Edward is
  closed; a daily brief.
- Google Calendar: read, find free time, create / change / delete events with confirmation.
- Gmail: search, read, draft; send only drafts Edward wrote, after approval every time.
- Bills: found in Gmail, verified against the email, checked for impostor senders, changed payment
  details and unusual amounts; due reminders; monthly summary and CSV export.
- Privacy guard: card, account and ID numbers and passwords removed before anything reaches the model,
  and never stored. Permission modes `chat`, `manual`, `semi-auto`, `auto`.
- `edward setup`, `edward doctor`, `edward delete-data`, `edward uninstall`; data versioning, backups and
  export; region settings for date order and currency.
