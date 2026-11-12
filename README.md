# Netrunner Collection

Catalogue your Netrunner cards, track alt-art copies, and see whether you can build a deck
from what's free, or whether you need to print cards or take apart another deck.
Card data comes from NetrunnerDB.

The app is a static web page (`static/`): no server of its own, no build step. It keeps your collection in
your browser, fetches card data from NetrunnerDB directly, and can be installed to a phone's home screen or a
desktop and used offline. The plan is in [docs/pwa-spec.md](docs/pwa-spec.md).

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

Its `/api/*` endpoints and `data/` folder are from the earlier version, which kept the collection on the PC.
The current UI doesn't use them.

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
  paste starter/printed deck lists. Then you're walked through each partial product.
- **Add by set**: a grid per product in release order. Click or use the keyboard: arrows, `0`–`9`
  for the count, `A` / `Shift+A` for alt art, `Enter` to mark the product done and move on.
- **Collection**: a list of all titles (no images, so it's quick on a phone). Search and filter, adjust counts,
  open a card to see it and set per-printing counts and alt art.
  The set filter has one entry per set symbol, so Downfall and Uprising are both Ashes (cards 1–130).
  **Sort by set number** lists cards by set and then card number, the way they sit in a binder.
- **Lock** (padlock at the top): stops count changes, so a stray tap can't edit your collection. Decks still work.
  The lock is saved with the collection, so it's still on next time and is part of backups.
  **Add cards from a list** adds a new starter deck, trade or booster on top of what you have.
- **Decks**: paste a list or a NetrunnerDB link into *Can I build this?* For each card it shows whether
  it's free, held by another built deck, or has to be printed. Save it as a deck, then **Build** it to
  borrow the cards. **Print list** shows what you're short of, ready to copy. **I printed them** records proxies as part of that deck, so they never count
  against your collection.
- **Several tabs**: a change in one tab shows up in the others. A tab that somehow missed it reloads instead
  of overwriting the newer data.
