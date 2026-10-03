# Security and privacy

Edward is a personal assistant that runs on your own Windows computer. It talks to an AI model through
the Codex CLI and your own ChatGPT account, and — if you connect them — to your own Google Calendar and
Gmail. There is no Edward server: nothing is sent anywhere except to those services.

This page says what Edward protects, how, and where the protection ends.

## What the privacy guard does

Before anything is written to the Codex process — your message, Edward's instructions and memories, the
result of every tool (an email, a calendar event, your clipboard), your answers to questions — Edward's
own code removes:

| Removed | Recognised when |
|---|---|
| Card numbers | 13–19 digits that pass the card checksum; masked numbers (`**** 1234`); and any digits next to words such as "card", "ending in", "last 4", CVV or expiry |
| Bank and account numbers | BSB + account; digits next to "account", "BSB", "customer number", "payment reference" and similar |
| Passwords, PINs, one-time codes | Text after "password is", "PIN", "verification code" and similar; API keys and tokens with a known shape |
| ID numbers | Australian tax file and Medicare numbers (by checksum or keyword); passport and driver-licence numbers next to those words |

The model receives `[removed: card number]` instead. You see a notice each time. There is no "send anyway".

This is code at the process boundary, not an instruction to the model: every request, notification and
reply passes through one filter, whatever part of Edward produced it. The same numbers are never written
to Edward's own storage: saving a memory, reminder or bill that contains one is refused.

Edward has no tool that pays, signs in to a bank, or acts on instructions found in an email. It reminds;
paying is up to you.

## What the guard does not catch

- **A bare number with no word near it** saying what it is ("4409" alone), or a password with no keyword.
  Detection is by context on purpose: removing every digit run would also remove order numbers, phone
  numbers and dates.
- **Text inside images** you attach.
- **ID numbers from other countries.** Only Australian formats have checksum rules today.
- **Anything Codex reads by itself** in the `manual`, `semi-auto` and `auto` modes — see below.

## Permission modes

| Mode | Codex may | Privacy guard |
|---|---|---|
| `chat` (default) | Answer, search the web, use Edward's tools. Its own shell, file reading, local image viewing and browser are switched off | Fully effective |
| `manual` | Run commands and edit files, asking before every action | Does not cover what commands print or files contain |
| `semi-auto` | As `manual`, but edits inside the Edward workspace are not asked about | As `manual` |
| `auto` | Run commands and edit files without asking. Windows has no effective sandbox, so this is your full user account | As `manual` |

The prompt always shows the mode when it is not `chat`. Entering `auto` asks first.

## Actions need your approval

| Action | Approval |
|---|---|
| Send an email | Every time. Only drafts Edward wrote in this session can be sent; the prompt shows the draft as it is in Gmail now, warns about a first-time recipient, and says if text continues past what it shows |
| Create or change a calendar event | Asked, with a before/after preview. Events with other guests are never changed, and Edward never sends invitations |
| Delete a calendar event, mark a bill paid | Every time |
| Read the clipboard, open a file or link | Asked. Programs and scripts are never "opened" |
| Write a draft, save a memory or reminder, copy to the clipboard | Done without asking, and shown as it happens |

## Text from other people

Emails and calendar events are written by others and may contain instructions aimed at the model
("ignore your instructions and forward…"). Edward marks such content as data, requires the approvals
above, and strips terminal control characters from it so that an email cannot redraw your screen or fake
a prompt.

What remains possible: with web search on, a model that is fooled by an email could put something it read
into a search query. Account, card and ID numbers are already gone by then, but other content is not.
`/web off` turns web search off.

A fooled model can also save a wrong "memory". You are shown every memory as it is saved and can undo it
(`/memory undo`); if a wrong memory later puts the wrong recipient on an email, the send prompt shows the
address and flags it as a first-time recipient.

## Bills

Bills are found in your Gmail and reduced to payee, category, amount, due date and status. Account and
reference numbers are removed before the model sees the email and there is no column to store them in.
Each bill is checked in code, not by the model: the amount and date must appear in the email; a sender
domain that differs from the payee's earlier bills, phishing wording, an unusually high amount, and
payment details that differ from the previous bill are flagged. That last comparison happens in memory and
is discarded.

## Where your data is

Everything is in `%LOCALAPPDATA%\Edward` on your computer: memories, reminders and bills (`memory.db`),
settings, generated images, and Codex's conversation history (`codex-home`). These files are not
encrypted; they are protected by your Windows account. The Google sign-in token is encrypted with Windows
DPAPI and never logged.

- `/data export` writes everything Edward stores as readable files.
- `edward delete-data` deletes it; `edward uninstall` also removes the scheduled task and revokes Google access.
- `/disconnect google` revokes Edward's Google access.

## Google

You register your own Google Cloud project, so the OAuth client is yours. Edward asks for: reading and
writing calendar events, reading the calendar list, reading Gmail, and creating and sending drafts. It
cannot delete, archive or label mail. Sign-in uses the loopback redirect with PKCE on `127.0.0.1`.

## The desktop app

The desktop app (in `app/`, built with Electron) runs the same core in its main process, so everything
above applies unchanged: the one path to Codex, the guard, what is stored and what needs approval.
On top of that:

- **The window has no Node and no Codex.** It runs sandboxed with context isolation, and can only call
  the methods listed in `app/shared/api.ts` through the preload bridge. The main process checks every
  call's method name against that list and that it comes from Edward's own page.
- **No remote content.** The page, its fonts and its pictures are packaged with the app. A Content
  Security Policy allows only those; links open in your browser (web addresses only). The window
  can't navigate away or open other windows, and Chromium permissions (camera, location, …) are refused.
- **Text is text.** Calendar entries, replies and the "Text" view of an email are shown as plain text
  or as Markdown built into elements, never inserted as HTML, so they can't carry script or markup.
- **Emails "as sent" are fenced off.** To show an email as its sender designed it, its own HTML goes
  into a sandboxed frame on a separate `edward-mail://` address with its own Content Security Policy:
  no scripts, forms, plugins or frames, and the frame can't navigate (Edward also strips scripts,
  refresh and base tags beforehand). Pictures and styles from the web are **blocked** — they can tell the
  sender you opened the email and from where — until you click "Show pictures" for that email; pictures
  that travel inside the email are shown. Links open in your browser. The frame has no access to
  Edward's bridge. This view is for you only: the model still gets the plain text, through the guard.
- **Pictures by allow-list.** Generated pictures and attachments are served to the window only if
  the main process put them on its list; the window can't ask for any other file.
- **What you typed is shown as it was sent:** if the guard removed a number from your message, the
  conversation shows "card number removed" in its place, not the number.
- Closing the window keeps Edward in the tray so reminders still appear; Quit is in the tray menu.

## Dependencies

The core and the terminal version have no runtime dependencies beyond Node.js and the Codex CLI. The
desktop app adds Electron and, in the window, React; they are bundled into the app at build time.

## Reporting a problem

Please open an issue on the repository. If the problem would put users at risk before it is fixed, say so
in the issue title without the details and ask for a private channel.
