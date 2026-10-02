# Contributing

Thanks for looking. Jarvis is a small project with a few rules that are not negotiable, because they are
what make it safe to point at someone's mailbox.

## Rules that every change must keep

1. **One path to Codex.** Everything sent to the Codex process goes through `CodexClient` and its
   `OutgoingFilter` (`src/privacy/outgoing.ts`). Do not add another way to write to the process.
2. **The filter is fail-closed.** Every string in every request is redacted unless its key is listed in
   `STRUCTURAL`. Add a key there only for identifiers, paths or fixed definitions — never for a field that
   can hold text from the user, an email or a calendar.
3. **Nothing guarded is stored.** Anything written to disk that could hold user or email text calls
   `refuseSensitive()` first (`src/privacy/guard.ts`). There is no column, file or log for account, card
   or ID numbers, not even part of one.
4. **Text from outside is cleaned.** Email, calendar and model text passes through `stripControl()` before
   it is shown or stored.
5. **No tools that pay, sign in to banks, or act on instructions found in content.** Tools that change
   something outside Jarvis ask the user first, with a preview of exactly what will happen.
6. **`SECURITY.md` is updated in the same change** whenever any of the above behaviour changes.

## Working on it

```
npm install
npm run typecheck
npm test
npm run dev
```

- TypeScript, Node 24, no runtime dependencies. Please keep it that way.
- Tests are plain scripts in `test/`, one per area, run with `tsx`. They need no network and no Codex.
  Tests must not touch real user data: set `JARVIS_DATA_DIR` to a scratch folder, as the existing ones do.
- Behaviour that only shows in a real terminal (Shift+Tab, inline image previews) has a simulated-terminal
  test where possible; say in the pull request what you checked by hand.
- `src/protocol/` is generated (`npm run gen:protocol`) from the installed Codex; don't edit it.
- Examples and tests use made-up names and numbers — never real ones, not even your own.

## Reporting bugs

`jarvis doctor` output and the Codex version help a lot. Leave out anything private: Jarvis's own output
already has account numbers removed, but subjects and names are yours to trim.
