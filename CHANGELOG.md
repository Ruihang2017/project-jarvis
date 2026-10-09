# Changelog

## Unreleased

- **Codex comes with Edward.** The desktop app's installer now carries OpenAI's Codex, so there is one
  thing to install and no PowerShell or Terminal step. It is the version Edward was verified with,
  OpenAI's own release package, checked against its SHA-256 when the installer is built. A Codex you
  installed yourself is neither used nor touched, and your sign-in stays. The installers are bigger for
  it. The terminal version still uses the Codex you install.
- **Two Mac downloads instead of one**, to keep them small: one for Macs with Apple silicon (M1 and
  later), one for Macs with an Intel processor. Apple menu → About This Mac says which you have.

- **Choose what Edward runs on.** Besides a ChatGPT plan, Edward can now use your own OpenAI API key: no
  ChatGPT plan needed, OpenAI bills the key for what Edward uses. The first start asks which, and
  Settings → The assistant → **Change** switches later (one at a time; conversations, memory and Google
  accounts stay). A key is checked with OpenAI before anything is switched, so a wrong one changes
  nothing. With a key there are no plan limits to show, and no pictures yet. Voice uses the same key:
  there is no second one to enter. The terminal version follows
  the choice made in the app (they share the sign-in), and `/usage` and `/doctor` say which is in use.
- **Experimental: another AI service.** Settings → Change → "Another AI service" runs Edward on a service
  that speaks OpenAI's Responses format instead of on OpenAI: OpenRouter (Claude, Qwen, Gemini and more),
  Qwen on Alibaba Cloud, or any other with its address, a model name and your key. Edward tries it once
  before switching, so a wrong address, key or model changes nothing. What Edward sends then goes to that
  service, still through the privacy guard. There is no web search and no pictures, the model's name is
  typed rather than picked, and how well the calendar, mail and reminder tools work depends on the model.
  The form links to the service's model list, and says so when the service refuses the model. Tried so
  far with OpenRouter and one of its free models; other services are untried.
- Two drawings in the README show how Edward is built and how a message reaches the AI.
- The sign-in to the AI is now kept encrypted, with its key in the Windows credential store or the Mac
  keychain. A sign-in from an earlier version keeps working as it is, and is replaced by an encrypted one
  the next time you sign in or switch.

## 0.3.1 — 2026-10-07

Writing email.

- A draft Edward writes in a conversation is shown there, whole, with **Edit** (opens it in the Mail form,
  the same Gmail draft) and **Send** (asks first, like the form). Before, the conversation only said
  "drafted email to …" and you had to open Gmail to read it. Tell Edward what to change and the new
  version appears below the old one. The terminal prints the draft too.
- "Ask Edward to write" in the email form now writes as well as a conversation does: it knows what
  Edward remembers about you and looks in your mail for the person and what was last said. It fills in
  the recipient and subject when you left them empty (the recipient only if you have exchanged email with
  that address), and signs with your name.
- Mail → **Drafts**: the drafts in Gmail, yours and Edward's. Plain-text drafts open in the form; one with
  formatting or attachments from Gmail is shown and left for Gmail to change.

## 0.3.0 — 2026-10-07

Edward for Mac.

- macOS, Intel and Apple silicon, in one download (`Edward-0.3.0-mac.dmg`, macOS 12 or newer). The app
  isn't signed with an Apple Developer ID yet: the first time, macOS asks you to allow it in System
  Settings → Privacy & Security → Open Anyway. The Intel half has only been run by the automated tests.
  - Google sign-ins and the OpenAI key are sealed with a key in your login keychain (AES-256-GCM files);
    if the keychain can't be used, saving fails rather than writing them unprotected.
  - Reminders while Edward is closed: a per-user launchd agent, every minute, like the scheduled task on
    Windows.
  - Edward finds Codex when it is started from the Dock (OpenAI's installer, Homebrew, npm), and Codex
    gets a PATH it can run with.
  - The usual Mac menu and shortcuts; closing the window keeps Edward in the Dock, Cmd+Q quits.
  - Notifications say Edward while the app is open. While it is closed they come from the background
    agent and are labelled "Script Editor". There is no snooze button on a Mac.
  - The terminal version (`edward`) works on a Mac too.
- Every push is now tested on Windows, macOS on Apple silicon and macOS on Intel, and both installers are
  built and started once by GitHub Actions. A version tag puts them in a draft release.
- Fixed: Edward stopping with an error when Codex isn't installed, instead of saying how to install it.
- Fixed: "Gmail's query quota is temporarily exceeded" on the morning Edward is opened. Gmail allows
  about 300 emails a minute per account, and the mail summary, the daily bill and booking scans and the
  Today page all started at once.
  - When Google says "slow down" (429, or 403 with a rate-limit reason) Edward waits and tries again, up
    to three times and 30 seconds, instead of passing the error on. The same for Calendar and Tasks.
  - The mail summary reads each email once instead of twice, and doesn't read emails already known as bills.
  - An email read in the last five minutes isn't fetched again (kept in memory only, never on disk), so
    Today, Mail, the summary and the heads-ups share what they read. An unread dot can be up to five
    minutes behind Gmail.
  - At most five Gmail requests at a time per account.
  - The automatic bill scan, booking scan and mail summary take turns, a minute apart. What you ask for
    yourself still runs at once.
- The mail summary says when an email couldn't be read, instead of summarising its preview line.
- Demo mode: the made-up site visit stays on today when the demo is started late in the evening.

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
