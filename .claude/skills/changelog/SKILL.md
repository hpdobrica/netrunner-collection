---
name: changelog
description: Write the user-facing changelog line for a change to the Netrunner Collection app, and show it to the user before committing. Use for every commit that bumps VERSION in static/sw.js, i.e. any change to static/.
---

# Changelog lines

`static/changelog.json` is what people see under **What's new** in the app's menu, and in the toast after an
update. Every commit that bumps `VERSION` in `static/sw.js` either adds a line for it or says why not. The Pages
workflow refuses the deploy otherwise (`tools/changelog`).

## Steps, for every commit that bumps VERSION

1. Bump `VERSION` to today's date and the next number: `2026-11-14.3` follows `2026-11-14.2`; the first change
   of a new day is `.1`. One bump per commit.
2. Decide whether people using the app can notice the change. Refactors, reviews, tests, CI, docs, security
   hardening with no visible effect: no.
3. **Visible:** add one line per noticeable change, tagged `"v": "<the new VERSION>"`, under the entry for
   today's date (create it at the top of `entries` if needed). Put it at the top of its group: newest first.
   **Not visible:** add no line; the commit message gets a line `Changelog: none (reason)`, e.g.
   `Changelog: none (refactor of the print queue code)`.
4. Set `"checked"` to the new `VERSION` either way.
5. Run `go run ./tools/changelog`.
6. **Show the user before committing**, and wait for their OK or edits. Show exactly what will appear in the
   app, rendered, with the group it goes under:

   > **What's new, November 14, 2026** (`2026-11-14.3`)
   > *New:* **Deck tags.** Tag your decks and filter the Decks page by tag.
   > Toast: "Updated: **Deck tags**"

   Or, for an invisible change: `Changelog: none (refactor of the print queue code)`, and ask whether they
   agree nothing visible changed.

Several commits in one go: show all their lines together before the first commit, each with its version.

## Groups

- `new`: something you couldn't do before.
- `improved`: something you could do, now easier, clearer or broader.
- `fixed`: something that didn't work and now does.

## Writing a line

- Describe what the user can now do, not what the code does.
- Start `new` and `improved` lines with a short bold lead-in naming the feature, ending in a full stop:
  `**Print queue.** Each proxy PDF you make waits…`. The toast shows the lead-in, so make it stand alone.
  `fixed` lines usually have no lead-in; then the toast shows the first 60 characters.
- Second person, present tense: "You can now…", "X now shows Y".
- Use the UI's names, as on screen: "Print cards", "Add by set", "Hide rotated", "Collection list". Never
  function, variable or CSS names.
- Write a fix as what works now, not as the bug: "Deck names and notes are saved as you type", not
  "Fixed a bug where notes were lost".
- One line, optionally one short second sentence. No "we", no exclamation marks, no "simply".
- Several small things in one commit can share a line if they belong together; unrelated ones get a line each.
- A later commit that changes a line still in the same day's entry may edit it; tag it with the new version
  only if users who saw the old one should see it again.

## Format

```json
{
  "checked": "2026-11-14.3",
  "entries": [
    {
      "date": "2026-11-14",
      "new": [{ "v": "2026-11-14.3", "text": "**Deck tags.** Tag your decks and filter the Decks page by tag." }],
      "improved": [],
      "fixed": []
    }
  ]
}
```

Entries are newest first, one per date. Each line's `v` must be on its entry's date and not newer than
`VERSION`. The text is plain text: only `**bold**` is formatted, everything else is shown as typed.
