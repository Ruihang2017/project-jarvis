# Edward

A personal assistant for your terminal that does things: keeps your calendar, reads and drafts email,
tracks bills, reminds you — and removes account numbers, card numbers and passwords before anything
reaches the AI.

Edward runs on your own Windows computer. It uses your own ChatGPT account through the
[Codex CLI](https://github.com/openai/codex) and, if you connect them, your own Google Calendar and Gmail.
There is no Edward server.

> **Status: developer preview.** Windows only. You bring your own ChatGPT account, Codex CLI and (for
> calendar and mail) Google Cloud project. Expect rough edges.

```
you › what's on tomorrow, and is anything due this week?
  📅 checked calendar 2026-10-03 → 2026-10-03
  💳 checked bills
edward › Tomorrow: dentist at 15:00. Your electricity bill ($245.30) is due Sunday.

you › reply to Sam's update and ask whether the energy account is set up
  ✉ searched mail "Weekly update"
  ✉ read conversation m2
  ✉ drafted reply to m2
⚠ Allow gmail_send?
  send email to Sam Taylor: RE: Weekly update
  [y] yes  [n] no
```

## What it does

| | |
|---|---|
| **Chat** | Answers, web search, image generation, with memory of what you tell it |
| **Reminders** | "Remind me at 5pm to call the dentist" — a Windows notification, even when Edward is closed |
| **Calendar** | What's on, when you're free, add / move / delete events (each one confirmed) — across all your Google accounts |
| **Gmail** | Search, read, summarise; draft replies; send only after you approve the draft — one or several personal Gmail accounts |
| **Lists** | Shopping list, things to fix at home, to-dos, in Google Tasks so they are on your phone too |
| **Voice** (desktop app) | Talk to Edward and hear the reply, with your own OpenAI API key |
| **Bills** | Finds bills in your email, checks them for signs of fraud, reminds you before they are due |
| **Daily brief** | Today's events, reminders, bills and unread mail in one glance |
| **Heads-ups** | Before an event with a place or people (and the related emails); a mail summary twice a day; the week ahead on Sunday evening; trips from booking emails, with when to leave |

## Privacy guard

Before anything is sent to the model, Edward's own code removes card numbers, bank and account numbers,
passwords, PINs, one-time codes and ID numbers — partial ones too ("card ending 1234"). They are never
stored. This is a filter at the process boundary, not an instruction to the model.

Edward cannot pay anything or sign in to a bank. Sending an email, changing your calendar and marking a
bill paid all need your approval.

What it does not catch, and the rest of the security model, is in [SECURITY.md](SECURITY.md). Read it
before you rely on Edward.

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org) 24 or newer
- The Codex CLI (`npm install -g @openai/codex`) and a ChatGPT plan that includes it
- Optional, for calendar and mail: a Google account and your own free Google Cloud project
  ([15-minute guide](docs/google-cloud-setup.md))

## Install

**Desktop app (Windows):** download `Edward-Setup-0.2.0.exe` from the
[releases](https://github.com/Ruihang2017/project-jarvis/releases) and follow the
[install steps](https://ruihang2017.github.io/project-jarvis/#install) (Codex first:
`winget install -e --id OpenAI.Codex`).

**Terminal version:**

```
npm install -g github:Ruihang2017/project-jarvis
edward setup
edward
```

`edward setup` walks through signing in to ChatGPT, background reminders, Google and your region. Every
step can be skipped and it can be run again. `edward doctor` checks that everything works.

## Using it

Just type. Slash commands cover the rest — `/help` lists them in three groups:

| Conversation | What Edward looks after | Setup and care |
|---|---|---|
| `/new` `/resume` `/image` `/model` `/effort` `/usage` `/mode` | `/brief` `/calendar` `/mail` `/lists` `/trips` `/bills` `/remind` `/memory` `/images` | `/start` `/connect` `/accounts` `/google` `/disconnect` `/background` `/region` `/web` `/data` `/doctor` |

### The desktop app

The same Edward in a window: Today, Chat, Calendar, Mail, Bills, Reminders, Memory and Pictures pages,
cards for everything that needs your OK, the permission mode always at the top right, and a tray icon
that keeps reminders coming when the window is closed. It shares the data folder with the terminal
version. To run it from a checkout, or build the Windows installer (`app/dist/Edward Setup <version>.exe`,
not code-signed yet, so Windows warns about an unknown publisher):

```
cd app
npm install
npm start         # build and run
npm run dist      # build the installer
```

The installed app runs its background reminders with its own executable, so it needs no separate Node;
it still needs the Codex CLI.

### Permission modes

`chat` (the default) keeps Codex's own shell and file access switched off, so everything the model sees
has passed the privacy guard. `manual`, `semi-auto` and `auto` let Codex run commands and edit files; what
it reads that way is outside the guard. Shift+Tab switches, and the prompt always shows the mode.

## Your data

Everything is in `%LOCALAPPDATA%\Edward`. `/data` shows what is there, `/data backup` copies it,
`/data export` writes it out as readable files, `edward delete-data` deletes it, and `edward uninstall`
removes the background task, revokes Google access and offers to delete the data.

## Known limitations

- Windows only (encrypted token storage, background reminders and notifications use Windows features).
- Calendar and mail need your own Google Cloud project.
- Bills are read from the email text; an amount that is only in a PDF attachment is left for you to fill in.
- The privacy guard recognises numbers by context and knows Australian ID formats only — see
  [SECURITY.md](SECURITY.md).
- No phone app: reminders appear on the computer Edward runs on.
- Built on Codex's `app-server` interface, including its experimental dynamic-tool support. A Codex
  update can change it; `edward doctor` reports the Codex version Edward was verified with.

## Development

```
git clone https://github.com/Ruihang2017/project-jarvis
cd project-jarvis
npm install
npm test          # unit tests; no network, no Codex needed
npm run dev       # run from source
```

TypeScript, Node 24, no runtime dependencies. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

Edward is an independent project. It is not affiliated with OpenAI, Google, or Marvel.
