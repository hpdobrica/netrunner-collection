# Netrunner Collection

Catalogue your Netrunner cards, track alt-art copies, and see whether you can build a deck
from what's free, or whether you need to print cards or take apart another deck.
Card data comes from NetrunnerDB.

## Run

```
go build -o netrunner.exe .
netrunner.exe
```

The program opens http://localhost:8765. It's a single exe with the UI built in, so you can copy it anywhere;
it keeps its data in a `data/` folder next to itself.

- `netrunner.exe -lan`: also reachable from your phone on the same Wi-Fi (it prints the address)
- `netrunner.exe -port 9000`: use a different port
- `go run . -dev`: serve `static/` from disk while editing the UI

## Data

- `data/collection.json`: your collection and decks. Plain JSON, safe to commit. Before the first save
  of each day the previous version is copied to `data/backups/`.
- `data/nrdb-cache.json`: cached NetrunnerDB cards, products and cycles. Refresh it from the ⋯ menu when a
  new set comes out.
- `data/icons/`: NetrunnerDB's icon font, for the set symbols.

Owned counts are stored per printing (NetrunnerDB card code), each with how many of those copies are
alt art. Decks are lists of cards. A deck marked **Built** is physically assembled, so its cards are borrowed
and no longer free. Reprints of the same title count together when checking a deck.

## Using it

- **Publisher**: the ⋯ menu (and setup) switches between all products, Null Signal only or FFG only.
  FFG is everything up to Reign and Reverie, Magnum Opus and NAPD Multiplayer. Null Signal is System Core 2019
  onward, and new cycles count as Null Signal automatically. Cards only the hidden publisher printed are hidden too.
  Copies you own of a reprint count no matter which printing they are.
- **Setup**: tick the products you own complete (×1, ×2…) and the ones you only have part of. You can also
  paste starter/printed deck lists. Then you're walked through each partial product.
- **Add by set**: a grid per product in release order. Click or use the keyboard: arrows, `0`–`9`
  for the count, `A` / `Shift+A` for alt art, `Enter` to mark the product done and move on.
- **Collection**: search and filter all titles, adjust counts, open a card for per-printing counts and alt art.
  The set filter has one entry per set symbol, so Downfall and Uprising are both Ashes (cards 1–130).
  **Sort by set number** lists cards by set and then card number, the way they sit in a binder.
- **Lock** (padlock at the top): stops count changes, so a stray tap can't edit your collection. Decks still work.
  The lock is saved with the collection, so it applies on every device.
  **Add cards from a list** adds a new starter deck, trade or booster on top of what you have.
- **Decks**: paste a list or a NetrunnerDB link into *Can I build this?* For each card it shows whether
  it's free, held by another built deck, or has to be printed. Save it as a deck, then **Build** it to
  borrow the cards. **Print list** shows what you're short of, ready to copy. **I printed them** records proxies as part of that deck, so they never count
  against your collection.
