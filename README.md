# Netrunner Collection

Catalogue your Netrunner cards, track alt-art copies, and see whether you can build a deck
from what's free, or whether you need to print cards or take apart another deck.
Card data comes from NetrunnerDB.

The app is a static web page (`static/`): no server of its own, no build step. It keeps your collection in
your browser, fetches card data from NetrunnerDB directly, and can be installed to a phone's home screen or a
desktop and used offline. The plan is in [docs/pwa-spec.md](docs/pwa-spec.md); the statistics screen in
[docs/stats-spec.md](docs/stats-spec.md).

**Use it at https://netrunner-collection.dobrica.sh/**

## Run

Serve `static/` with any static file server and open it in a browser. It works under a sub-path too
(e.g. `https://example.com/netrunner/`). Opening `index.html` as a file does not work, because browsers
don't allow storage or NetrunnerDB requests from `file://` pages.

The Go program in this folder is one such server:

```
go run . -dev
```

It opens http://localhost:8765 and serves `static/` from disk. `go build -o netrunner.exe .` builds a single exe
with the UI built in.

- `-lan`: also reachable from your phone on the same Wi-Fi (it prints the address)
- `-port 9000`: use a different port
- `-no-open`: don't open a browser tab

It only serves files. The earlier version also had `/api/*` endpoints that kept the collection in `data/` on the
PC; they are gone, because anyone on the network could read or overwrite it through them. An old
`data/collection.json` loads with *Restore from backup*.

## Install and offline

- **Install**: Android Chrome and desktop Chrome/Edge offer *Install* in the browser menu; on iPhone use
  Share → *Add to Home Screen*. Installing also makes it much less likely the browser clears your data.
  The ⋯ menu shows whether storage is protected.
- **Offline**: after the first visit the app opens without a connection. Card images you've looked at are kept
  (up to about 600); others show the card title. Deck links need a connection; pasted lists don't.
- Offline use and installing need https or `localhost`. Over plain http on a LAN address (`-lan` on your
  phone) the app works, but only while the PC is reachable.

## Deploying a change

Every push to `main` publishes `static/` to GitHub Pages (`.github/workflows/pages.yml`).

The service worker (`static/sw.js`) serves the app from its cache, so a changed file reaches people only when
**`VERSION` in `sw.js` changes**. Bump it with every deploy. Open copies then show *New version available*
with a Reload button; the app never reloads by itself.

While editing with a service worker installed, either bump `VERSION`, or tick *Update on reload* under
DevTools → Application → Service workers.

## Your data

- Your collection and decks live in the browser you use the app in (IndexedDB), tied to the address you
  opened it at: `localhost:8765`, your PC's LAN address and a hosted copy are three separate collections.
- **Download backup** in the ⋯ menu saves everything as `netrunner-collection-<date>.json`. Keep it somewhere
  safe (cloud folder, email to yourself): clearing the browser's site data deletes the collection.
  The menu shows when you last backed up and how many changes you've made since.
- **Restore from backup…** loads a backup file. It also takes the exports and `data/collection.json` of the
  earlier version. It shows the backup's date and size, warns if this browser has newer changes, and downloads
  the current collection as a `…-before-restore.json` safety copy before replacing it. It's refused while the
  collection is locked.
- To move to another device or browser: download a backup on the old one, restore it on the new one.
- **Coming from the earlier version** (collection in `data/collection.json`): restore that file, or an export
  from it, once in each browser you use.
- Card data from NetrunnerDB is cached in the browser and refreshed in the background once it's a week old.
  **Refresh card data** in the ⋯ menu fetches it now, e.g. when a new set comes out.

**The backup format is in use: people have backup files and rely on restoring them.** Any change to the stored
collection or the backup file must keep it compatible: every existing backup must still restore
(extend `migrate()`, never drop a field it reads), and a new field must be optional. Breaking compatibility is not
an option.

Owned counts are stored per printing (NetrunnerDB card code), each with how many of those copies are
alt art. Decks are lists of cards. A deck marked **Built** is physically assembled, so its cards are borrowed
and no longer free. Reprints of the same title count together when checking a deck.

## Set icons

The set symbols come from NetrunnerDB's icon font (MIT licence, © Cédric Bertolini), shipped in `static/icons/`.
When a new cycle comes out, regenerate the files and commit them:

```
go run ./tools/icons
```

Until then the new set shows without a symbol. Bump `VERSION` in `sw.js` too.

The home-screen icons in `static/icons/` are drawn by `go run ./tools/appicon`.

## Using it

- **Publisher**: the ⋯ menu (and setup) switches between all products, Null Signal only or FFG only.
  FFG is everything up to Reign and Reverie, Magnum Opus and NAPD Multiplayer. Null Signal is System Core 2019
  onward, and new cycles count as Null Signal automatically. Cards only the hidden publisher printed are hidden too.
  Copies you own of a reprint count no matter which printing they are.
- **Setup**: tick the products you own complete (×1, ×2…) and the ones you only have part of. You can also
  paste starter/printed deck lists. Then the cards of the partial products open in the Collection list, to set
  one by one. Setup is shown on the first run only; later, add products on *Add by set*.
- **Add by set** (*Add cards: By set* on Collection): whole products only. Each shows the complete boxes you own
  and how far you are into the next one (*1 box + 204/205 of another*). **+** adds a box's worth of every card;
  **−** removes one, if you own a complete box; **Clear** sets every card to 0. Removing asks first if a built deck
  would be left short or alt-art copies would go. A product's name opens its cards in the Collection list, and
  *N missing* only the cards short of the next box.
- **Collection**: a list with a row per printing (no images, so it's quick on a phone). The first column is the
  set symbol and card number, so you know which box a card is filed in. Sorted by name, a card's printings sit
  together; *N printings* lists the others. Click a column heading to sort, again to reverse; *Set* sorts the way
  cards sit in a binder. Owned and Alt art are per printing. In decks and Free are per card (decks don't record
  which printing went in): sorted by name they span the card's rows, otherwise they show muted as *3 of 10*.
  The set filter has one entry per set symbol, so Downfall and Uprising are both Ashes (cards 1–130).
  To type counts, click a row, then `↑`/`↓` move, `0`–`9` set the count, `+`/`−` adjust, `A` / `Shift+A` alt art.
- **Card details** (click a card's name anywhere): image, text, copies per printing and decks. `←`/`→` or the
  ‹ › buttons either side of it go to the previous / next card of the page it was opened from, in the order shown
  (the whole filtered Collection list, not just the rows loaded so far).
- **Lock** (padlock at the top): stops count changes, so a stray tap can't edit your collection or a saved deck's
  cards (a deck's +/−, adding cards and Delete are hidden). New decks can still be saved, and decks built,
  deconstructed, renamed and printed.
  The lock is saved with the collection, so it's still on next time and is part of backups.
  **Add cards: From a list** adds a new starter deck, trade or booster on top of what you have.
- **Decks**: paste a list or a NetrunnerDB link into *Can I build this?* For each card it shows whether
  it's free, held by another built deck, or has to be printed. Save it as a deck, then **Build** it to
  borrow the cards. A deck short of cards you don't own offers **Print cards** instead: printed cards become cards you
  own, so it's built once they're printed. **Print list** shows what you're short of, ready to copy. (Decks saved by
  earlier versions may still hold printed copies of their own, shown as *N printed* on the deck; × removes them.)
  Next to each card are the set symbol and card number of each printing you own, most copies first (decks record
  cards, not printings), else of its newest printing. **By set** groups a deck's cards by the first one's product in
  binder order, to gather them for building; **By type** (the default) groups them as deck lists do. The choice is
  remembered on the device.
- **Print cards** (on a deck): makes a PDF to print and cut out, laid out like NetrunnerDB's print-and-play: cards at
  63.5 × 88.9 mm, nine to a page, with NetrunnerDB's 300 dpi images. Choose the cards not owned, not free or the whole
  deck; paper (A4 or Letter; the first time, Letter in the US, Canada and a few other countries, else A4); cut marks
  (none, lines across the page, or short marks in the margin); and bleed (a 3 or 6 mm gap between cards, which shrink
  a little to make room). The choices are remembered on the device. Double-faced identities (Hoshiko, Earth Station,
  Dewi, Nebula, Méliès U) also print their other faces. Print at 100%, not "fit to page".
  **Only Null Signal Games cards are printed**: a card only Fantasy Flight Games published is greyed out, listed above
  the preview and left out of the PDF. Each card uses the image of its
  newest Null Signal printing that has one at 300 dpi; cards printed only in System Core 2019 or System Update 2021
  have just a 300 × 420 image on NetrunnerDB and come out less sharp. If an image can't be loaded (say offline, when no PDF
  with that card was made on this device before), it says which and offers to try again or leave them out.
  **Print cards for several decks** (a button on Decks, and in the print queue) does the same for any decks you tick,
  deck after deck in one PDF, each deck counted as on its own page; *Each deck: New page* starts every deck on a fresh
  page.
- **Print queue** (the printer button at the top, with a dot while something waits): every PDF you download becomes a
  print job listing its cards. **Printed: add to collection** adds them to your collection, as copies of the printing
  whose image the PDF used (while the collection is locked, the button says *Locked: unlock at the top* and can't
  be used); **Cancel** drops the job. Until then the cards show as *printing* on decks: they aren't
  asked for again by Not owned or Not free, but a deck waiting for them can't be built yet. The same PDF made twice
  doesn't make a second job. The queue is saved with the collection and in backups. The PDF library ([jsPDF](https://github.com/parallax/jsPDF)
  4.2.1, MIT licence) is in `static/vendor/`, loaded only when making a PDF and precached for offline use.
- **Find on NetrunnerDB** (a tab on Decks): fetches decklists published on NetrunnerDB over the last 1 to 24 months,
  keeps them in the browser, and ranks them by how many cards you'd be missing. Filter by side, faction, how many
  missing, tournament decks, and **Legal in Standard** or **Legal in Startup**, judged from each deck's cards (card
  pool and current ban list), not from the ban list its author picked. **Save as deck** adds one to your decks.
- **Stats**: the shape of the collection at a glance: totals, how complete each set is (one box as sold is 100%,
  counting only that set's printings), how much is tied up in built decks, breakdowns by
  faction and type, and a shopping list. Tap a bar to go to that set, deck or filtered list. Nothing new is stored.
- **Several tabs**: a change in one tab shows up in the others. A tab that somehow missed it reloads instead
  of overwriting the newer data.

## Disclaimer

This is an unofficial fan tool. It is not affiliated with, endorsed by or sponsored by Fantasy Flight Games,
Wizards of the Coast, Null Signal Games or NetrunnerDB. Netrunner and Android are trademarks of Fantasy Flight
Publishing, Inc. and/or Wizards of the Coast LLC. Card names, text, images and set symbols belong to their
respective owners. Card data and images are loaded from NetrunnerDB at runtime and are not part of this repository.
