# Railey Library — developer guide

A static single-page app. It is plain HTML, CSS and JavaScript with no framework, no build step and no server of its own. GitHub Pages hosts the files. Each library's data lives in the user's Dropbox, which the browser talks to directly.

```
tamarack-library.html   the page: markup only, loads css/app.css and js/*.js
index.html              redirects to tamarack-library.html (keeps ?query for set-up links)
css/app.css             all styles
js/*.js                 the app, in load order (below)
icons/, manifest.webmanifest
sw.js                   service worker: offline copy of the app files
tests/                  Playwright tests, a sample library, visual comparison script
```

Run it locally with `npm start`, then open http://localhost:4173/tamarack-library.html. Dropbox sign-in needs that URL added as a redirect URI on your Dropbox app.

## Scripts and scope

The files in `js/` are **classic scripts loaded with `defer`, in a fixed order**. They share one global scope: a function or top-level `const` in one file is visible to the others. We chose this over ES modules to keep "open the folder and it runs" hosting, with no bundler.

The price is that load order matters for **top-level statements**, meaning code that runs as the file loads. Function bodies only run later.

- Declaring functions and wiring `$('id').onclick = …` is fine anywhere.
- Code that must run once everything exists goes in `app.js`, which loads last.

| File | What's in it |
|---|---|
| `core.js` | Helpers (`$`, `esc`, `lsGet`, `natCmp`…). Which library is open and the storage keys derived from it. The on-device store (IndexedDB with a localStorage fallback). Per-field change stamps and the book-by-book merge. `commit()`. |
| `dropbox.js` | OAuth PKCE sign-in with refresh tokens. Download and upload guarded by revision. `syncNow()`. The readable JSON writer. |
| `covers.js` | Cover images: web covers, photos stored in Dropbox (`dbx:` paths, blob-cached in IndexedDB), and cloth-colour placeholders. |
| `search.js` | The search index (word-start matching, weighted fields, one-typo fallback) and `filtered()`. |
| `library.js` | Drop-down and datalist values, the three list views, paging, and batch select and edit. |
| `book.js` | The book window: view mode, page-turn navigation, edit form, save and delete. |
| `lookup.js` | Open Library and Google Books search, title and author matching, automatic cover and detail lookups. |
| `shelves.js` | The Shelves tab. |
| `import.js` | Paste or upload CSV and JSON lists, preview, duplicate handling, undo of the last import. |
| `series.js` | Series split across locations, and possible duplicates. |
| `sell.js` | The Sell & value list, eBay and Etsy export. |
| `data.js` | Stats, CSV and JSON export, restore from a backup. |
| `collections.js` | Collections bar, rename and remove, the chip editor in the book form. |
| `scanner.js` | Camera barcode reading (the native `BarcodeDetector`, else ZXing from jsDelivr). Add, check ("Do I own this?") and fill modes. Offline save-for-later. |
| `mystery.js` | The unidentified-books list and the shelf-by-shelf walk-through, including "add a book we missed". |
| `photos.js` | Uploading shelf and title-page photos to the Dropbox photo inbox. |
| `settings.js` | Library name and tagline, switching libraries, set-up links. |
| `app.js` | Panels (tabs), `refreshAll()`, start-up. |

**The one rule for changes to data:** mutate `store.books`, give each changed book a new `updatedAt`, then call `commit()`. `commit()` stamps the changed fields, saves on the device, schedules a Dropbox sync and redraws.

## Data format

`tamarack-library.json` (and the device copy) looks like this:

```js
{
  format: 'tamarack-library', version: 1, updatedAt,   // ms timestamps throughout
  books: [ Book | Tombstone ],
  imports: [ { id, at, added, label, undone? } ],     // last 20 imports, for undo
  settings: { library: { title, tag }, ship, ret, pay, cond, footer, updatedAt }
}
```

A **book** has these fields. All are optional except `id`, and each is written in this order (`KEY_ORDER` in `dropbox.js`) so the file reads well.

- **What it is:** `title`, `author`, `series`, `seriesNo`, `genre`, `format`, `isbn`, `year`, `publisher`, `pages`, `about`, `subjects`, `coverUrl`.
- **Where it is:** `room`, `bookcase`, `shelf`, `position`. `position` is a number in left-to-right order, with an optional letter for a book squeezed in (`12a`). The app shows it as "#3 from left" or "#2 from right", counting only the books on that shelf, not sold ones.
- **Its state:** `status` (`unread`, `reading` or `read`), `rating` (0–5), `loanedTo`, `loanedDate`, `collections` (an array of names), `notes`, `needsReview`.
- **Selling:** `saleStatus` (`consider`, `ebay`, `etsy`, `listed`, `sold` or `keep`), `salePrice`, `saleCondition`, `saleListedAt`, `saleSoldPrice`, `saleSoldAt`, `saleEst`, `saleEstNote`, `saleCondNote`.
- **Bookkeeping:** `addedAt`, `updatedAt`, `ft` (per-field change times, below), `source`, `importBatch`, `lookupV`, `pendingIsbn`, `idPhoto`, `idPhotoAt`.

A few conventions:

- A title in parentheses means the book is not identified yet, for example `(green hardcover — title not visible)`.
- Sold books stay in the file but are left out of the library views and the shelf positions.
- A deleted book becomes a **tombstone**, `{ id, deleted: true, updatedAt }`, so the delete reaches other devices instead of the book coming back.

`coverUrl` can hold any of three things:

- a web URL;
- `dbx:<path>`, for a photo stored in the library's `covers/` folder;
- a `data:` URL, only until it has been migrated to Dropbox.

## Sync and merging

Every device keeps a full copy. `syncNow()` works like this:

1. Download the Dropbox file and remember its `rev`.
2. Merge it with the device copy.
3. Upload with `mode: update(rev)`, so the upload fails if someone else saved in between.
4. On that conflict, download, merge and retry, up to 4 times.

`mergeStores(a, b)` works book by book:
- If only one side has a book, keep it.
- If both sides have it, the version with the newer `updatedAt` wins, **except for fields the older version changed more recently**.
- Those field changes are tracked in `ft`, a map of field name to time. `stampFields()` fills it in by comparing each book with a snapshot taken at the last save.
- Blank-ish values (`''`, `0`, `false`, `[]`, missing) count as equal, so saving the edit form doesn't claim fields the user never touched.
- When the merge takes fields from both sides, the result gets a newer `updatedAt` than either side, so the combined version is uploaded.

The result: a loan marked on the phone and an author fixed on the desktop both survive. `sync.spec.js` covers these cases.

## Several libraries

A library is a Dropbox folder. The folder name is kept per device in localStorage (`tamarack_library_folder`).

- Every device key is namespaced: `LIB_NS` is `''` for the original `/Railey Library` and `'@' + folder` for any other library. This covers the store, the previous save, UI state, the Dropbox app key, tokens and PKCE.
- Switching libraries reloads the page.
- A **set-up link**, `tamarack-library.html?folder=/Smith%20Library&appkey=…`, is handled in `core.js` before any key is computed. The query is then removed from the address bar.
- The library name and tagline are stored in the catalog (`settings.library`), so they sync. The folder and app key are per device, because they are how a device finds the catalog in the first place.

## Photo inbox (the Claude workflow)

The app only uploads. Claude does the reading, with the library's Dropbox folder linked.

- **Shelf photos** go to `photos/inbox/` as `YYYY-MM-DD HHMMSS <Room> <Bookcase> shelf-<n> <kind> [note] [i].jpg`. `kind` is `shelf`, `spines`, `book` or `other`. A note, if any, is also saved beside the photos as `… NOTE.txt`.
- **Title-page photos** from the walk-through go to `photos/identify/` as `<Room> <Bookcase> shelf-<n> pos-<p> <bookId>.jpg`. That book gets `idPhoto` so the list shows 📷.
- **After reading**, Claude does four things:
  - edits the catalog, matching books that have no location to the shelf they were seen on instead of adding duplicates;
  - clears `idPhoto`;
  - writes a change log to `imports/`;
  - deletes the photos.

  It never force-overwrites the JSON. If the app synced in between, Claude reloads the file and applies its changes again.

## Offline

`sw.js` gives app files (listed in `APP_FILES`) network first, with a 6-second timeout, then falls back to the saved copy. The ZXing script and the fonts are cache first. Dropbox and the lookup APIs are never intercepted. Edits made offline are saved on the device, and sync runs on the `online` event.

**When you add, rename or remove an app file,** update `APP_FILES` and bump `VERSION`. A test checks that every file the page loads is in the list.

## Tests

```
npm install
npm test                      # Playwright (Chromium), about 40 s
APP_DIR=../old-build npm test # the same tests against another copy of the app
npm run visual -- dirA dirB   # screenshot-compare two builds (all screens, phone + desktop)
```

- The tests serve the folder on :4173 and run in a phone-sized window.
- `tests/helpers.js` fakes the network: Dropbox download and upload (uploads are recorded), Open Library for a few ISBNs, and everything else blocked. Nothing real is contacted.
- `openApp()` seeds a device with `tests/fixtures/library.json`, a sample library of about 370 books with generic rooms. It includes a loaned book, collections, a sold book, a book with no shelf and several mystery books.
- The camera can't run in tests, so the scanner tests type the ISBN into the box under the camera. That box runs the same code path.
- CI runs the suite on every push (`.github/workflows/test.yml`).

## Releasing

1. `npm test` passes. For style changes, also run `npm run visual` against the last release.
2. If app files were added or removed, update `sw.js` (`APP_FILES`, `VERSION`).
3. Add a line to `CHANGELOG.md`, commit and push. GitHub Pages serves the new version within a minute or two.
4. Phones pick it up on the next open, because app files are fetched network first.
