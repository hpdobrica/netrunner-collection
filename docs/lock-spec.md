# Spec: The lock protects owned counts only

Status: implemented · 2026-11-17

## Why

The lock at the top was added so a stray tap can't change the collection. Today it also guards some deck
actions (changing a deck's cards, un-printing a proxy, deleting a deck), but not others (saving, building,
deconstructing, renaming, printing). That split is hard to explain, and it's inconsistent. Building and
deconstructing change which cards are reserved far more than editing a deck does, and they're allowed.

Deck cards now have their own guard: they only change after **Edit cards**, and stop on **Stop editing**. So the
lock is a second, weaker guard on the same thing.

## Rule

**The lock protects owned counts, and nothing else.** While it's on, nothing can change how many copies of a
card you own. Decks aren't affected at all.

This rule is about what an action does, not which screen it's on. An action that adds to the collection
stays locked wherever it's started from.

## Actions

| Action | Changes owned counts? | Locked |
|---|---|---|
| `print-n` (owned +/− for a printing, on Collection) | yes | yes, as today |
| `alt` (alt-art stepper) | yes | yes, as today |
| `pack-box`, `pack-clear` (set wizard) | yes | yes, as today |
| `add-list-open`, `add-list` | yes | yes, as today |
| `w-finish` | yes | yes, as today |
| `restore` (backup) | yes | yes, as today |
| `pq-done` (print job done: adds the printed cards to the collection) | yes | yes, as today |
| `deck-q` (deck card +/−) | no | **no** (was yes) |
| `deck-add` (add a card to a deck) | no | **no** (was yes) |
| `unproxy` (stop counting a card as printed) | no | removed (see *Removing deck proxies*) |
| `deck-delete` | no (cards return to the collection) | **no** (was yes) |
| `deck-edit`, building, deconstructing, renaming, notes | no | no, as today |
| Print page (`print-*`), `pq-cancel` | no | no, as today |

## Changes

All of these are in `static/`.

1. **`LOCKED_ACTS`** (`app.js`): remove `deck-q`, `deck-add`, `unproxy` and `deck-delete` (`unproxy` goes away
   entirely, see below). Rewrite the comment
   above it: "Actions that change what you own. A locked collection refuses them; decks aren't affected."
2. **Click guard** (`app.js`, the `LOCKED_ACTS` check in the click handler): drop the deck branch of the toast
   ("Use the lock at the top to change this deck."). Two messages are left: restore, and counts.
3. **`deckEditing`**: drop `!S.locked`, so it becomes `UI.deckEdit === deck.id`. Update the comment above it
   (remove "never while the collection is locked" and "and locking the collection").
4. **`deckTools`**: remove the early return that shows the lock note. Edit cards is always offered.
5. **Deck page Delete button** (`viewDeck`): always show it. It's still behind its `confirm()`.
6. **`lock` action**: remove `if (S.locked) UI.deckEdit = null;` and its comment. Locking no longer ends deck
   editing.
7. **CSS** (`app.css`): the rule `body.locked .deck-page .list.compact td.q { width: 44px; }` narrows the
   quantity column because a locked deck had no steppers. Steppers now depend only on editing, so key the rule
   off editing instead. For example, add an `editing` class to `.deck-page` while editing, make 44px the
   default, and use 120px under `.deck-page.editing`. That also tightens the column for an unlocked deck
   that isn't being edited.

No changes to:
- the lock button, its toast ("Counts can't be changed…" already describes the new rule), or `lockNote` on
  Collection/Sets
- the print queue's disabled "Locked: unlock at the top" button (it is `pq-done`, which stays locked)
- the backup format (`locked` is still saved the same way)

## Removing deck proxies

Older versions kept printed cards in the deck that printed them (`deck.proxies`, keyed by card title). Now
finishing a print job (`pq-done`) adds the printed cards to the collection, and nothing new writes
`deck.proxies`: every new deck starts with it empty. The concept is dead weight, so it goes.

**No migration.** Assume no current user has proxies. The `normalize` step only copies fields it knows, so if it
stops copying `proxies`, an old key is dropped on load and disappears from storage on the next save. Old
backups restore fine, just without the key.

If the assumption is wrong, nothing breaks. A deck with legacy proxies counts those copies as missing: a built
deck shows it's short, and an unbuilt one asks for them to be printed. The fix is to add the copies on
Collection by hand. Before shipping, check that the Stats screen has no line starting "Proxies" and ending
"printed, not counted".

Remove (all in `app.js` unless noted):
1. `normalize`: `proxies: {}` in the deck object, and the loop that copies `d.proxies`.
2. `deckEntries`: the line that sets `e.proxies`.
3. `computeLocks`: use `e.qty` instead of `e.qty - e.proxies`.
4. `planDeck`: use `e.qty` instead of `e.qty - e.proxies` for `need`, and drop `sum.proxies` (the initial value
   and the `+=`).
5. `deckAdjust`: the two lines that trim `deck.proxies`.
6. Deck status text: the "N printed" parts in both the built and the ready messages.
7. `planRow`: the "N printed" badge and its × button.
8. The `unproxy` action, and its entry in `LOCKED_ACTS` and the click-guard toast.
9. Stats: `proxies` in the totals, the `s.proxies +=` line, the "Proxies … printed, not counted" legend item,
   and its swatch style in `app.css` (`.sx-sw.proxy`, plus `.st.proxy` if nothing else uses it).
10. Card modal: the "(N printed)" note after each deck.
11. `proxies: {}` in the other deck objects (the format check, the deck-check result, `addDeck`).
12. The comment on deck proxies above the print queue, and the comment above `loose` that says backups hold
    deck proxies by card key (if that's no longer true, rewrite it to name what still does).

Keep the print-cards page (`#proxies/…`, `viewProxies`, `proxy-open`, `proxy-deck`). It's a different feature
that only shares the name.

## Edge cases

- **Locking while editing a deck:** editing continues. Only owned counts are frozen.
- **Deleting a built deck while locked:** allowed after the confirm. Its reserved cards become free, and owned
  counts don't change.
- **A deck page's print queue:** making a PDF and cancelling a job still work. Marking a job done is refused
  while locked, as today.

## Testing

Lock the collection, then:
- on a deck page: Edit cards, use +/−, add a card, remove a printed mark, Stop editing, and Delete (after the
  confirm). All of these work with no lock toast. No "printed" badge appears anywhere.
- on Collection: +/− and alt-art are hidden or refused, as today.
- in the print menu: marking a job done is disabled, and cancelling works.
- restoring a backup is refused.
- restoring an old backup whose decks have `proxies` works, and the key is gone after the next save.
- on desktop width, the deck quantity column is narrow when not editing and wide while editing, whether locked or
  not.

## Release

Two commits, each with its own `VERSION` bump in `static/sw.js`:
1. The lock change. Proposed changelog line: "The lock now only protects your card counts: decks can be edited and
   deleted while the collection is locked."
2. Removing deck proxies. Proposed: `Changelog: none (removes an old feature no current deck uses)`.
