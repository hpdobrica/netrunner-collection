# Spec: Statistics screen

Status: implemented · 2026-11-12

## Why

The Collection list answers "do I have this card?", one title at a time. It doesn't show the shape of the
collection as a whole:
- how big it is
- which sets are close to a full playset
- how much of it is tied up in built decks
- what to get next

A Stats screen answers these at a glance, with a few simple charts.

## Goals

- One screen, `#stats`, with headline numbers and a handful of charts.
- Every number is computed from what the app already stores: nothing new is saved, and the backup format doesn't
  change.
- Works offline and on a phone (360 px wide). No chart library: bars are plain HTML/CSS (SVG only for the donut),
  so no new dependency, no build step, nothing extra to precache.
- It follows the same settings as the rest of the app: the publisher setting (All / Null Signal / FFG), and a
  *Hide rotated* toggle.
- Tapping a chart takes you to the place where you can act on it, such as the set in *Add by set* or the filtered
  Collection list.

## Non-goals (for now)

- **History.** "Cards added per month" needs a log of changes, which the app doesn't keep. It could be added later
  by recording a dated entry on each count change.
- **Prices or value.** NetrunnerDB has no prices.
- **Comparing with other people's collections.**
- **Exporting charts as images.**

## Definitions

These terms are used the same way in every section below.

- **Card count:** physical copies you own. Three copies of Hedge Fund count as 3. Alt-art copies count like any
  other copy.
- **Printed proxies:** cards marked as printed in a deck. They are never part of your collection, so they are left
  out of every count except *Proxies* (in section 3).
- **Playset:** a title's deck limit (`deck_limit` from NetrunnerDB). That's usually 3, and 1 for identities and
  "limit 1 per deck" cards.
- **Set:** one product as listed in *Add by set*: a data pack, deluxe, big box or core set. Sets are grouped by
  cycle, the same as there.
  The *Draft* product is not counted as a set: its 9 identities are from FFG's draft format and aren't legal in
  normal decks. It's left out of set completion, *Sets complete* and the shopping list. Its cards still count
  in *Cards*.
- **Free / in decks:**
  - *in built decks* is a title's copies held by built decks, the same as the Collection list's *In built decks*;
  - *free* is your copies minus those.
- **Spare:** your copies of a title beyond its playset, counted across all printings. For example, 5 Sure Gamble
  is 2 spare.

## The screen

A new **Stats** link in the top nav, after Decks. A row of options sits at the top:
- side: **All / Runner / Corp**;
- **Hide rotated**;
- the publisher switch, which is the same setting as in the ⋯ menu.

All sections below follow these options. They're remembered like the Collection filters, in local storage.

### 1. Headline numbers

A row of number tiles. On a phone it wraps to two columns.

| Tile | Value |
|---|---|
| **Cards** | total card count |
| **Titles** | titles owned (at least 1 copy) / titles that exist, with a % |
| **Playsets** | titles with a full playset / titles that exist, with a % |
| **Sets complete** | sets at 100% (see section 2) / all sets |
| **Alt art** | alt-art copies, with % of the card count |
| **Spare** | spare copies (useful for trading) |

### 2. Set completion

This answers "how much of each set do I have?". 100% means everything the product came with: one complete box
as it was sold.

- For each card in the set: **need** = how many copies of it came in the product (NetrunnerDB's `quantity`);
  **have** = your copies *of this printing*, up to that number.
  - In a data pack or expansion that's 3 of most cards and 1 of identities, so 100% is a playset of everything.
  - In a core set it's 1, 2 or 3 depending on the card, so one core set is 100% even though some cards are
    short of a playset. Headline *Playsets* still tells you about those.
  - The set's % is the sum of *have* over the sum of *need*.
  - Extra copies beyond what came in the box don't push it past 100%.
  - Example: a 65-card pack with 62 cards at 3 and 3 identities at 1 is 189 cards. Owning one of each is
    65 / 189 = 34%.
- **Count reprints** toggle, off by default (decided: a set shows the cards of that printing, like a binder page):
  - On, a card's *have* comes from any printing of that title. Example: Hedge Fund from System Gateway fills
    Core Set's Hedge Fund.
  - Off answers "what's in my binder for this set". On answers "can I play everything in this set".
- **Layout:**
  - one horizontal bar per set, grouped under cycle headings with the set symbol;
  - each bar shows owned and missing, with `have / need · %` as text beside it;
  - each cycle heading has its own total bar.
- **Sort:** release order (default), % complete, or most missing.
- Tapping a set opens it in *Add by set*.
- *Hide sets I don't own* is on by default. Turned off, sets you own nothing of are shown, faded, in their usual
  order, so the gaps are visible.

### 3. Free vs in decks

This answers "how much of my collection is tied up in decks?".

- **Donut** of the card count:
  - **Free**;
  - **In built decks**;
  - with **Proxies** (printed copies in decks) as a separate number beside it, since they aren't part of the count.
- **Per built deck:** one bar per built deck showing the cards it borrows from your collection, largest first,
  with the deck's faction colour and name. Tapping one opens the deck.
- **Short for saved decks:** the copies you'd need to print to build every unbuilt deck from free cards. This is
  a sum of each deck's *Print list* that doesn't double-count the same title. Tapping it opens the Collection
  list filtered to those titles.

### 4. By faction

This answers "which factions am I strong in?".

- One bar per faction, in faction colours, with Runner factions first, then Corp, then neutral. Each bar shows the
  card count, and **playset completion** (titles with a full playset / titles in that faction) as a %.
- A mini-faction (Adam, Apex, Sunny Lebeau) appears only when the publisher setting includes FFG.
- Tapping one opens the Collection list filtered to that faction.

### 5. By type

- One bar per card type, split by side the same way as the type filter:
  - Runner: Event, Hardware, Resource, Program;
  - Corp: Agenda, Asset, Upgrade, Operation, Ice;
  - plus Identities for both.
- Each bar shows owned titles / titles that exist and the % with a full playset.
- This shows, for example, "I have most ice but few programs".
- Tapping one opens the Collection list filtered to that type.

### 6. Shopping list (most wanted)

This answers "what would help me most?". Two short lists, top 10 each, with *Show all*:

- **Most needed for your decks:** titles you're short of across all saved decks, counting each title once at the
  most copies any one deck needs. Sorted by how many decks need them.
- **Closest sets:** sets that are 80–99% complete, with how many cards are missing. Tapping one opens it in
  *Add by set*.

## Empty and edge states

- **Nothing owned yet:** the screen shows "Add some cards first" with links to setup and *Add by set*, instead of
  empty charts.
- **No decks:** section 3 shows only the donut (all free), plus a link to Decks. Section 6's first list is hidden.
- **Card data still loading:** the usual loading message.
- **Card data offline and not yet fetched:** the same message the other screens show.
- **A card you own isn't in the current card data:** possible after a restore with old codes. It still counts in
  *Cards*, isn't counted in any per-set, faction or type stat, and a note says "N cards not in the card data".

## Charts: how they look

- **Bars:** a `div` with a background track, coloured fill segments (`width: %`) and a text label. Numbers are
  always shown as text, so nothing depends on hover and screen readers read the label.
- **Donut:** a small inline SVG (circle strokes with `stroke-dasharray`), with the free and in-decks numbers as
  text beside it.
- **Colours:** the existing CSS tokens for track and text, faction colours from `fcolor()`, one accent for "owned"
  and a muted colour for "missing". Both themes are already covered by the tokens.
- **No animation** beyond the existing transitions.

## Implementation notes

- **New code in `app.js`:**
  - `viewStats(app)`;
  - small helpers `bar(segments, label)` and `donut(parts)`;
  - a `statsFor(filters)` function that walks `DB.titleList` / `DB.packs` once and returns all the numbers. It
    uses the existing `titleVisible`, `pubOk`, `own`, `titleOwned`, `computeLocks` and `planDeck`.
- **Wiring:**
  - add `stats` to `route()` and the nav;
  - options go through `data-act` / `data-filter` like the Collection filters;
  - taps on bars use `data-act` with the target filter, then navigate.
- **CSS:** new rules in `app.css` under a `/* stats */` heading.
- **Speed:** about 2,500 printings and a few dozen decks, so the whole screen is computed on each render.
  `planDeck` per saved deck is the only noticeable cost. Compute it once per render, not per section.
- **Live updates:** the screen updates when another tab changes data, because `reloadState()` re-renders.
- **Locked collection:** has no effect, since the screen changes nothing.
- **Deploy:** bump `VERSION` in `sw.js`.

## Testing

Use a test collection on another port, not real data.

1. **Total:**
   - 3× Hedge Fund (any printing) plus one alt-art Sure Gamble shows *Cards 4*, *Alt art 1*;
   - a deck with 2 printed proxies doesn't change *Cards*.
2. **Set %:**
   - every card in one pack at its boxed quantity shows 100%;
   - 1 of each card in a pack shows about 33%; one complete core set shows 100%;
   - a 4th copy of one card doesn't push it past 100%;
   - an identity counts 1/1.
3. **Count reprints:**
   - with the System Gateway Hedge Fund only, Core Set's Hedge Fund counts as 0/3 with the toggle off and 3/3
     with it on.
4. **Free vs in decks:**
   - build a deck that uses 2 of your 3 copies: free goes down by 2 and in-decks up by 2;
   - unbuild it and both go back;
   - proxies show separately.
5. **Filters:**
   - Runner hides Corp sets' Corp cards and Corp factions;
   - *Hide rotated* drops rotated cycles;
   - Null Signal only hides FFG-only sets and mini-factions.
6. **Taps:** each tappable chart opens the right set, deck or filtered list.
7. **Empty states:** a fresh browser, no decks, card data loading.
8. **Phone:**
   - at 360 px nothing scrolls sideways;
   - labels don't overlap bars;
   - dark and light both readable.
9. **Two tabs:** change a count in one and the Stats screen in the other updates.

## Milestones

1. **Numbers and sets:** route, nav, options row, headline tiles, set completion with the *Count reprints* toggle.
2. **Decks:** free vs in decks, per-deck bars, short-for-decks.
3. **Breakdowns:** by faction, by type, shopping list, empty states, phone pass.
