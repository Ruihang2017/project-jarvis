# Security and privacy

Edward is a personal assistant that runs on your own computer (Windows or macOS). It talks to an AI model through
the Codex CLI and your own ChatGPT account, and — if you connect them — to your own Google Calendar,
Gmail and Google Tasks. Two more only when used: OpenAI's realtime voice service (with your own API key)
and Open-Meteo for the weather where a trip goes (a place name and a date). There is no Edward server:
nothing is sent anywhere else.

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
| `auto` | Run commands and edit files without asking. Edward doesn't put Codex in a sandbox in this mode (Windows has no effective one), so this is your full user account | As `manual` |

The prompt always shows the mode when it is not `chat`. Entering `auto` asks first.

## Actions need your approval

| Action | Approval |
|---|---|
| Send an email | Every time. Only drafts Edward wrote in this session can be sent; the prompt shows the draft as it is in Gmail now, warns about a first-time recipient, and says if text continues past what it shows |
| Create or change a calendar event | Asked, with a before/after preview. Events with other guests are never changed, and Edward never sends invitations |
| Delete a calendar event, mark a bill paid | Every time |
| Read the clipboard, open a file or link | Asked. Programs and scripts are never "opened" |
| Write a draft, save a memory or reminder, copy to the clipboard | Done without asking, and shown as it happens |

The table is about what the model asks to do. In the desktop app you can also write and send email and
add, change or delete events yourself, in forms. Those don't involve the model unless you press "Ask
Edward to write" (below): sending still shows a confirmation with the sender, recipients and a
first-time-recipient warning, deleting an event asks first, and events with other guests stay read-only.

- **A draft the model wrote** is shown whole in the conversation, with Edit and Send. Send is you sending
  it: the same confirmation as the form, for the draft as it is in Gmail at that moment (if it changed
  since Edward wrote it, the confirmation shows the text).
- **"Ask Edward to write"** in the email form gives the model your notes, what Edward remembers about
  you, and three tools that only read: search your mail, read an email, search memory. It uses them to
  find the person and what was last said, as it would in a conversation, and everything it reads passes
  the guard. It has no tool that writes, sends or changes anything, and Edward's code refuses any other
  tool it might ask for. A recipient it proposes is put in the form only if you have exchanged email with
  that address (it is in the From, To or Cc of your mail) or typed it yourself; an address that appears
  only inside some email's text is left out.
- **Drafts** (Mail → Drafts) lists the drafts in Gmail as they are now. Edward keeps no copy. A draft
  with formatting or attachments from Gmail is shown but not changed here, because Edward writes plain
  text and saving it would lose them.

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

## Heads-ups and the mail summary

- **Before events** Edward's code, not the model, looks at the next events every five minutes (the
  background task, or Edward while it is open) and, for an event with a place or other people, searches
  your Gmail for related email. The notification shows what it found; nothing goes to the model. Edward
  keeps only which notices it has shown (ids and times, for two months).
- **The mail summary** is a model call. At the times set in Settings (08:30 and 18:00 unless you change
  them; only while Edward is open) and whenever you press Summarize, the model reads the new mail in your
  inbox since the last summary: at most 40 emails, the first 800 characters of each, through the privacy
  guard and marked as data. Adverts and forum mail are only counted, and emails Edward already knows as
  bills aren't sent again. Edward's code keeps a line only if it names one of the emails it was given and
  holds nothing Edward never stores; the last three summaries are kept in `memory.db`. Switch it off in
  Settings → Your day.
- **The weekly review** is code only, like the daily brief.
- **Trips.** Once a day Edward searches your Gmail for booking confirmations from the last 60 days. Most
  carry booking data (schema.org) that Edward's code reads; only emails without it go to the model, through
  the guard, and what it finds must match the email (flight number or hotel name, and the date) or it is
  marked "please check" and stays quiet. Booking references, ticket, membership and passport numbers are
  not kept: the `trips` table has no column for them and every field is checked like a memory. Adding a
  trip to your calendar is a button you press. For the weather at the destination Edward asks
  [Open-Meteo](https://open-meteo.com) (free, no account) with only the place's name and the date.

## Bills

Bills are found in your Gmail and reduced to payee, category, amount, due date and status. Account and
reference numbers are removed before the model sees the email and there is no column to store them in.
Each bill is checked in code, not by the model: the amount and date must appear in the email; a sender
domain that differs from the payee's earlier bills, phishing wording, an unusually high amount, and
payment details that differ from the previous bill are flagged. That last comparison happens in memory and
is discarded.

## Where your data is

Everything is in one folder on your computer, `%LOCALAPPDATA%\Edward` on Windows and
`~/Library/Application Support/Edward` on a Mac: memories, reminders, bills, mail summaries and trips (`memory.db`),
settings, generated images, and Codex's conversation history (`codex-home`). These files are not
encrypted; they are protected by your user account on the computer.

Each Google sign-in token (one per account, in `accounts\<id>\`) and the OpenAI key for voice are
encrypted, and never logged:

- **Windows:** with Windows DPAPI, for your Windows account on this computer.
- **macOS:** with a random key that Edward keeps in your login keychain (the item is called "Edward"). The
  files themselves are AES-256-GCM. If the keychain can't be used, saving fails; the token is never
  written unprotected.

Both protect against someone copying the files, a backup that leaks, or another user of the computer.
Neither protects against a program running as you: it can ask Windows, or the keychain, the same way
Edward does.

Reminders while Edward is closed come from a small per-user background job that runs every minute and
then ends: a scheduled task on Windows, a launchd agent on a Mac (`~/Library/LaunchAgents/com.edward.tick.plist`).
Neither needs administrator rights, and "Reminders when Edward is closed" in Settings removes it.

- `/data export` writes everything Edward stores as readable files.
- `edward delete-data` deletes it (on a Mac, the key in the keychain too); `edward uninstall` also removes the background job and revokes Google access.
- `/disconnect google <account>` revokes Edward's access to one Google account.

## Google

Edward asks for: reading and writing calendar events, reading the calendar list, reading Gmail,
creating and sending drafts, and your lists in Google Tasks (shopping list, to-dos). It cannot delete,
archive or label mail. List items the model adds are checked like memories: card, account and ID numbers
and passwords are refused. Sign-in uses the loopback redirect
with PKCE on `127.0.0.1`.

- **Several accounts.** You can connect more than one personal Google account. Edward reads mail and
  calendars from all of them, labels what comes from which, replies from the account an email came to,
  and shows the "from" address in every send preview.
- **Personal accounts only, enforced in code.** A Google Workspace (work or school) account is refused
  when it signs in: Edward sees the workspace domain in Google's answer, revokes that sign-in at Google
  and keeps nothing. You can also list domains Edward must never connect (`blockedDomains` in
  `settings.json`, kept on your computer only).
- **The OAuth client.** Running from source, you register your own Google Cloud project. The desktop
  installer can carry a client built in for testers. A desktop app's client secret isn't really secret:
  Google treats installed apps as public clients, and anyone could take it out of the installer. What
  protects your data is that each person signs in with their own account and the tokens stay on their
  own computer.

## Voice (desktop app)

Voice is off until you add your own OpenAI API key (Settings → Voice). It uses OpenAI's realtime model
directly, billed to that key.

- **What you say goes to OpenAI as sound, before the privacy guard can see it.** The guard works on text,
  so it can't take a card number out of your voice. The app says so in Settings and on the bar shown while
  voice is on. Don't say card or account numbers or passwords.
- The realtime model only hears and speaks. What you said comes back as text and goes into the
  conversation like typed text, through the guard, to Codex; Edward's answer is then read aloud. The
  realtime model never answers on its own and has no tools.
- The key is encrypted on your computer like the Google sign-ins (see "Where your data is"), never shown again, never logged and never sent
  to Codex. The window never has it: the main process makes the connection. `edward delete-data` deletes it.
- What voice costs is estimated from the token counts OpenAI reports during a call; only those numbers are
  kept (`voice_spend` in `memory.db`), never what was said. Edward doesn't ask for an OpenAI admin key.
- The microphone is allowed only for Edward's own page and only for sound (no camera); the email frame
  can't use it. A call stops after five quiet minutes.

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
- Closing the window keeps Edward running so reminders still appear: in the tray on Windows (Quit is in
  the tray menu), in the Dock on a Mac (Cmd+Q quits).
- **Notifications.** On Windows, and on a Mac while the app is open, they come from Edward. On a Mac
  while the app is closed, the background job shows them through macOS's own script runner, so they are
  labelled "Script Editor"; their text is handed to it directly, not on a command line that other users
  of the computer could read.
- **The macOS app isn't signed with an Apple Developer ID yet.** macOS therefore asks you to allow it the
  first time (System Settings → Privacy & Security → Open Anyway). The download is built from this
  repository by GitHub Actions; the build log is public.

## Demo mode

The tutorial videos are recorded with a demo mode (`EDWARD_DEMO`) in which Google is answered from
made-up data built into Edward; it refuses every other address. It only starts together with its own
separate data folder, so it can't mix with real accounts, and it is never on otherwise.

## Dependencies

The core and the terminal version have no runtime dependencies beyond Node.js and the Codex CLI. The
desktop app adds Electron and, in the window, React; they are bundled into the app at build time.

## Reporting a problem

Please open an issue on the repository. If the problem would put users at risk before it is fixed, say so
in the issue title without the details and ask for a private channel.
