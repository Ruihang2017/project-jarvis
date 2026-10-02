# Changelog

## 0.1.0 — developer preview

First public version.

- Terminal assistant on `codex app-server` with your own ChatGPT account: streaming replies, web search,
  image generation with inline previews, conversation history.
- Memory: what you tell Jarvis, kept as short- or long-term facts, recalled when relevant.
- Reminders with repeat rules, Windows notifications, and a background task so they fire when Jarvis is
  closed; a daily brief.
- Google Calendar: read, find free time, create / change / delete events with confirmation.
- Gmail: search, read, draft; send only drafts Jarvis wrote, after approval every time.
- Bills: found in Gmail, verified against the email, checked for impostor senders, changed payment
  details and unusual amounts; due reminders; monthly summary and CSV export.
- Privacy guard: card, account and ID numbers and passwords removed before anything reaches the model,
  and never stored. Permission modes `chat`, `manual`, `semi-auto`, `auto`.
- `jarvis setup`, `jarvis doctor`, `jarvis delete-data`, `jarvis uninstall`; data versioning, backups and
  export; region settings for date order and currency.
