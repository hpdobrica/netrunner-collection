# Spec: Netrunner Collection as an installable web app (PWA)

Status: draft for review · 2026-11-11

## Why

Today the app is a Go program that serves the UI and saves `data/collection.json` on one PC. To use it on a phone,
that PC has to be on, running `netrunner.exe -lan`, with the firewall open. Other people can't use it without
running their own copy.

As a PWA, the same UI runs from a static website (GitHub Pages). Anyone can open the link, install it to their home
screen, and use it offline. Each person's collection is stored on their own device. No server, no accounts.

## Goals

- Works from a static host: no backend of our own.
- Installable on Android, iPhone and desktop. Works offline after the first visit.
- Each device keeps its own collection, private to that person.
- Data is hard to lose:
  - the browser is asked to keep it permanently
  - backing up is one tap
  - the app reminds you when a backup is due
- Everything the app does today keeps working: collection, set wizard, decks, availability, printing, lock,
  publisher switch, set icons and sort.

## Non-goals (for now)

- Automatic sync between devices or people. Backup files can be moved between devices by hand.
  Cloud sync (Google Drive, Dropbox, or our own backend) can come later on top of the same backup format.
- Accounts, sharing collections, trading.
- A native Android app.

## What changes, at a glance

| Today (Go server) | PWA |
|---|---|
| `GET/PUT /api/state` → `data/collection.json` | IndexedDB in the browser |
| `/api/nrdb` fetches and caches NetrunnerDB data | Browser fetches NetrunnerDB directly and caches it in IndexedDB |
| `/api/decklist/{id}`, `/api/deck/{id}` proxy | Browser calls NetrunnerDB directly |
| `/api/icons.*` downloads the icon font | Font file shipped with the site |
| Daily backup in `data/backups/` | Backup file the user keeps (share menu, download, or auto-saved file on desktop) |
| Only works while the PC runs | Works offline on each device |

Checked on 2026-11-11 that browser access works:

- These endpoints answer cross-origin requests from any site (`Access-Control-Allow-Origin: *`):
  - `/api/2.0/public/cards`, `cycles`, `packs`
  - `/api/2.0/public/decklist/{id}` and `deck/{id}`
  - card images on `card-images.netrunnerdb.com`
- The icon font (`netrunnerdb.com/fonts/netrunner.woff`) is not served cross-origin, so it must be shipped with the site.

## Storage

### Where

IndexedDB, one database `netrunner-collection` with these stores:

| Store | Key | Contents |
|---|---|---|
| `state` | `"collection"` | The collection object (same shape as today's `collection.json`, plus `meta`) |
| `nrdb` | `"data"` | Cached NetrunnerDB cards, packs and cycles, plus fetch time |
| `settings` | name | Backup file handle (desktop), dismissed reminders |

Filters and view preferences stay in `localStorage`. Losing them doesn't matter.

Why IndexedDB rather than localStorage:

- The card data is several MB, which is more than localStorage reliably holds.
- File handles for desktop auto-save can only be kept in IndexedDB.

### Collection format

The format is unchanged from today, with one new `meta` block:

```json
{
  "version": 2,
  "owned": { "33001": { "n": 3, "custom": 1 } },
  "decks": [ ... ],
  "packStatus": { ... },
  "onboarded": true,
  "publisher": "nsg",
  "locked": true,
  "meta": {
    "updated": "2026-11-11T17:05:00Z",
    "changesSinceBackup": 12,
    "lastBackup": "2026-11-01T09:00:00Z",
    "firstUnbackedChange": "2026-11-03T20:11:00Z"
  }
}
```

- `version` goes from 1 to 2. Loading a version 1 file (today's export or `collection.json`) adds an empty `meta`.
- Every save sets `meta.updated`. A save that changes the collection or decks increments `changesSinceBackup`.
  Saves that only change filters, lock or publisher don't count.

### Saving

- Saves are debounced, as today (about 400 ms).
- A save is also flushed when the page is hidden (`visibilitychange`), because phones kill backgrounded tabs.
  `beforeunload` is not reliable on mobile.
- **Several tabs:** after each save, a `BroadcastChannel` tells other open tabs to reload the state from IndexedDB.
  This avoids an old tab overwriting newer data, which happened during testing of the Go version.

### Keeping data from being cleared

- On start, call `navigator.storage.persist()`. Show the result in the ⋯ menu:
  - "Storage: protected ✓"
  - "Storage: not protected", with a short explanation and a nudge to install the app
- Chrome usually grants persistence to installed apps, Firefox asks the user, and Safari 17+ supports it.
- iPhone: Safari can delete data of sites not opened for 7 days. Installed home-screen apps are exempt.
  When running in Safari without being installed, setup shows a one-line "Add to Home Screen" hint.
- Nothing protects against the user clearing site data or uninstalling. That is what backups are for.

## Card data, images, icons

- **Card data:**
  - First start fetches `cards`, `cycles` and `packs` from NetrunnerDB and stores them in IndexedDB.
  - Later starts use the cache immediately.
  - If the cache is older than 7 days and the device is online, it refreshes in the background.
  - "Refresh card data" in the menu forces a refresh.
- **Deck links:** fetched directly from NetrunnerDB, with the same parsing as today.
- **Images:**
  - Card images load from NetrunnerDB's image server.
  - The service worker caches images as they're viewed (cache-first), capped at about 1,500 images, oldest removed first.
  - Offline, images that were never seen show the existing title placeholder.
- **Set icons:**
  - NetrunnerDB's `netrunner.woff` and the cycle-to-symbol map (`icons.css`) are generated once by a small script
    and committed under `static/icons/`.
  - A new cycle needs the script re-run and a redeploy. Until then the set shows without a symbol.
  - Licensing: the NetrunnerDB repository is MIT-licensed (© Cédric Bertolini). The symbols themselves are game
    publishers' marks, used here as a fan tool, as NetrunnerDB does. Credit NetrunnerDB in the About text.
    See *Open questions*.

## Offline and installing

- `manifest.webmanifest`:
  - name "Netrunner Collection", short name "Netrunner"
  - `display: standalone`
  - dark theme colour
  - 192 px, 512 px and maskable icons
  - `start_url: "./"`, `scope: "./"`
- **Service worker:**
  - Precache the app shell: `index.html`, `app.js`, `app.css`, the icon font and CSS, the manifest and the app icons.
  - Images use runtime caching, as above.
  - NetrunnerDB API calls are not cached by the service worker. The app stores that data in IndexedDB itself.
- **Updates:**
  - A new deploy changes the service worker's version string.
  - The app shows a toast "New version available" with a Reload button.
  - It never reloads on its own, so nothing unsaved is lost.
- **Paths:** all paths are relative, so the site works under a GitHub Pages sub-path (`/<repo>/`). Hash routing
  already works without server support.

## Backup and restore

All backup files use the same format: the collection object plus a header.

```json
{ "app": "netrunner-collection", "exportedAt": "2026-11-11T17:05:00Z", "collection": { ... } }
```

File name: `netrunner-collection-2026-11-11.json`.

### Ways to back up

1. **Back up (share).** This is the default on phones.
   - Uses the Web Share API with a file. The system share menu opens.
   - The user can pick Google Drive, Files, email, chat, and so on. On iPhone, "Save to Files" works.
   - The app never gets access to the user's Drive; the user chooses where the file goes.
   - When file sharing isn't available, it falls back to a download.
2. **Download backup.** Always available: a normal file download.
3. **Automatic backup file.** Desktop Chrome and Edge only, using the File System Access API.
   - The user picks a file once, ideally inside a Google Drive, OneDrive or Dropbox folder on their PC.
   - After each save (debounced, at most every 10 s) the app writes the backup to it. The cloud folder then syncs it.
   - The file handle is kept in IndexedDB. After a browser restart, writing needs permission again, which the
     browser only allows after a tap. Show "Backup file needs reconnecting: tap to resume" until the user does.
   - Hidden on browsers without the API, including Android and iPhone.

A successful backup by any of these sets `lastBackup = now` and `changesSinceBackup = 0`.

For a share, the app can't know whether the user completed it, beyond the share promise resolving. Treat a
resolved share as done and a cancelled share as not done.

### Reminders

A small banner at the top, never a pop-up, appears when either is true:

- there are 10 or more changes since the last backup, or
- there are changes and the first of them is at least 7 days old.

Text: "12 changes since your last backup", with two buttons: **Back up now** and **Later**.

- **Later** hides it for 3 days, or until another 20 changes.
- Right after a big change, the banner shows at once with "Back up your new collection?". Big changes are:
  finishing setup, "Add cards from a list", completing a whole product, or importing.
- With desktop auto-backup working, no reminders are shown.

### Restore (import)

1. Accepts the new backup format and today's v1 exports and `collection.json`.
2. Shows what's in the file: date, number of cards, number of decks.
3. If the device has changes made after the backup was taken (`meta.updated` > `exportedAt`), warns:
   "This backup is from 3 Nov. This device has newer changes (12 since). Replace them anyway?"
4. Before replacing, the current collection is downloaded automatically as a safety copy
   (`…-before-restore.json`), so a mistaken restore can be undone.
5. Restoring is refused while the collection is locked, as today.

### Moving to another device

On the old device, back up (share to yourself, or to Drive). On the new device, use Restore. Spelled out in the
⋯ menu under "Move to another device".

## First run

The setup wizard is the same as today, with one extra choice at the top:

- **Restore from a backup:** for an existing user or a second device.
- **Start a new collection:** the current wizard.

After setup finishes, show the backup prompt (see Reminders) and the persistence status.

## Moving off the Go version

- Your data: use **Export collection** in the current Go version, then **Restore** in the PWA. Version 1 files
  are accepted.
- The Go program stays in the repo. It is only useful for development, as a local static server
  (`go run . -dev`). The `/api/*` endpoints are removed once the PWA is in use.
  - Data in the browser belongs to the address it was opened at, so `localhost:8765` and the GitHub Pages
    address are separate collections. Use the Pages address day to day.
- `README.md` is updated: the hosted link, how to install, how to back up.

## Hosting

- GitHub Pages, deployed by a GitHub Actions workflow that publishes `netrunner-collection/static/`.
- The repo `ai-home` holds other projects, so either:
  - **(a)** a Pages workflow in this repo that publishes only that folder, or
  - **(b)** move the app into its own repository.
- Pages needs a public repository on the free plan. See *Open questions*.
- No build step: the files are served as they are.

## Browser support

| | Android Chrome | iPhone Safari | Desktop Chrome/Edge | Desktop Firefox |
|---|---|---|---|---|
| Install | ✓ | ✓ (Add to Home Screen) | ✓ | – (use as a site) |
| Offline | ✓ | ✓ | ✓ | ✓ |
| Persistent storage | ✓ (installed) | ✓ 17+ | ✓ | asks user |
| Back up via share menu | ✓ | ✓ | Windows/ChromeOS mostly ✓, else download | download |
| Automatic backup file | – | – | ✓ | – |

## Testing

These are the earlier mobile scenarios, run again on the PWA:

- new collection
- adding cards
- building a deck
- deconstructing a deck for another one
- printing missing cards
- editing a built deck

Plus:

1. **Offline:** load once, turn on airplane mode, reload. The app works with cached images, and deck checks work
   for pasted text. Pasted links give a clear "offline" message.
2. **Persistence:** the ⋯ menu shows the real `persist()` result. Installed on Android, it shows "protected".
3. **Backup on Android:** the share menu opens, saving to Drive works, and the reminder counter resets.
   Cancelling the share leaves the counter as it was.
4. **Automatic backup on desktop:** pick a file, change some counts, and the file updates within 10 s.
   After a browser restart, the reconnect prompt appears and works.
5. **Restore:**
   - a version 1 export from the Go version loads correctly
   - an older backup triggers the warning
   - a safety copy is downloaded first
   - restore is refused while locked
6. **Wipe and recover:** clear site data, reopen, restore from backup, and everything is back.
7. **Two tabs:** change a count in one tab, and the other tab shows it without overwriting it.
8. **Update:** deploy a change, see the "New version" toast, reload, and the data is intact.
9. **GitHub Pages sub-path:** everything loads from `/<repo>/`, including the service worker scope.

## Milestones

1. **Static app:**
   - IndexedDB storage layer
   - direct NetrunnerDB calls
   - bundled set icons
   - backup format, download and restore
   - runs from any static server
2. **Installable and offline:** manifest, service worker, image cache, update toast, persistent storage and its status.
3. **Backup flows:** share backup, reminders, desktop automatic backup file, restore safety checks, first-run choice.
4. **Ship:** GitHub Pages workflow, README, migrating your own data, the test pass above on a real phone.

## Open questions

1. **Hosting:** publish from this repo with a workflow, or move the app into its own repository?
   Either way, Pages on the free plan needs a public repository.
2. **Set icons:** OK to ship NetrunnerDB's icon font, credited, as described? The fallback is Null Signal's
   official visual assets (CC BY-ND). I haven't checked whether those include set symbols.
3. **Image cache size:** 1,500 images is about 130 MB. Is that fine on your phone, or should it be smaller or a setting?
4. **Reminder thresholds:** are 10 changes or 7 days right? Since the collection is usually locked, reminders will
   mostly follow setup and new purchases.
