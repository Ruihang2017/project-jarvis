# Changelog

## Unreleased

- Renamed from Jarvis to Edward, with a new icon. The command is `edward` (`jarvis` still works for now).
  On the first start the data moves from `%LOCALAPPDATA%\Jarvis` to `%LOCALAPPDATA%\Edward`, after a
  backup; the background task and notifications move with it. `JARVIS_*` environment variables still work.
- Desktop app (Electron): every page, the setup flow, tray, Windows installer.
- Several Google accounts: mail, calendars and bills from all of them, labelled by account; replies go
  from the account the email came to; defaults for new emails and events; `/accounts`. Google Workspace
  (work or school) accounts are refused. The existing account moves into `accounts\g1\` on first start.
- Emails show as sent (their own HTML in a sandboxed frame; pictures from the web only when asked), and
  marketing mail with a broken plain-text part reads properly.

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
