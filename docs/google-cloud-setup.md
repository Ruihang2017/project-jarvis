# Setting up your Google Cloud project

Google requires every program that reads your calendar or mail to be registered as an "app". For Jarvis
that app is yours: you register it once in your own Google account, and Jarvis uses it only on your
computer. It takes about 15 minutes, is free, and needs no payment card.

Google rearranges its console often. The steps say what to look for; if a name or place differs, go by
the meaning.

## 1. Sign in

Open <https://console.cloud.google.com/> with the Google account whose calendar and mail Jarvis should
use. Accept the terms if asked. Do not start a free trial or add a card.

## 2. Create a project

Project picker (top left) → **New project** → name it `Jarvis` → **Create**, then switch to it.

## 3. Enable two APIs

**APIs & Services → Library**: search for **Google Calendar API** → **Enable**; then **Gmail API** →
**Enable**.

## 4. Configure the consent screen

Open **Google Auth Platform** (older consoles: **OAuth consent screen**) → **Get started**:

| Field | Value |
|---|---|
| App name | `Jarvis` |
| User support email | your address |
| Audience | **External** |
| Contact information | your address |

On **Branding**: do **not** upload a logo (a logo forces Google's verification). Save.

## 5. Choose how long sign-in lasts

On **Audience** you have two choices:

| Publishing status | What it means |
|---|---|
| **Testing** (simplest) | Add your own address under **Test users**. Works at once, but Google ends the sign-in every 7 days; Jarvis then asks you to run `/connect google` again |
| **In production** | Sign-in does not expire. Google asks for a home page and a privacy policy link first. Any page you control works: for example, publish a copy of the `site/` folder of this repository with GitHub Pages, enter the two links under **Branding → App domain**, add the domain under **Authorized domains**, then **Publish app**. If Google offers verification, you can skip it for personal use: the only effects are a warning screen at sign-in and a limit of 100 users |

If you stay in **Testing** and forget to add yourself as a test user, sign-in fails with "Access blocked".

## 6. Create the desktop client

**Clients** (older consoles: **APIs & Services → Credentials → Create credentials → OAuth client ID**) →
**Create client**:

- Application type: **Desktop app**
- Name: `Jarvis desktop`
- Leave "This client will be used by an AI-powered agent" unticked, if it is shown.

**Create**, then **Download JSON**.

## 7. Put the file where Jarvis looks for it

Rename the downloaded file to `google-client.json` and move it to `%LOCALAPPDATA%\Jarvis` (paste that
into the File Explorer address bar). `jarvis setup` prints the exact path.

This file identifies your app. Don't share it and don't commit it to a repository.

## 8. Connect

Run `jarvis setup` again, or `/connect google` inside Jarvis. Your browser opens:

1. Choose your account.
2. "Google hasn't verified this app" is expected — it is your own app. **Advanced → Go to Jarvis**.
3. Tick the calendar and Gmail permissions and continue.

`/google` then shows the connected account and whether the connection works. `/disconnect google` revokes
it; you can also remove it at <https://myaccount.google.com/connections>.

## What Jarvis asks for

| Permission | Used for |
|---|---|
| See and edit calendar events | Reading your schedule; adding, moving or deleting an event after you approve it |
| See the list of your calendars | Knowing which calendars you show |
| Read Gmail | Searching and reading mail, finding bills |
| Create drafts and send | Writing drafts; sending one after you approve it |

Jarvis cannot delete, archive or label mail, and never invites guests or changes events that have other
guests.
