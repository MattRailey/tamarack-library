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
| `series.js` | Duplicates and series split across locations (Epilogue tabs). |
| `data.js` | Stats, CSV and JSON export, restore from a backup. |
| `collections.js` | Collections bar, rename and remove, the chip editor in the book form. |
| `scanner.js` | Camera barcode reading (the native `BarcodeDetector`, else ZXing from jsDelivr). Add, check ("Do I own this?") and fill modes. Offline save-for-later. |
| `mystery.js` | The unidentified-books list and the shelf-by-shelf walk-through, including "add a book we missed". |
| `photos.js` | Uploading shelf and title-page photos to the Dropbox photo inbox. |
| `admin.js` | Invite a friend (Data & Sync, Matt's devices only): invites, phones (last used), last photos per library, switch off, through the service's `/admin/*`. The password (ADMIN_SECRET) is kept in sessionStorage only (`tamarack_library_admin`): the github.io origin is shared with Matt's other apps, and the password can get into any library. |
| `shelfcam.js` | The shelf camera: stays open, one tap per photo, sends in the background, Redo last, next bookcase. `optional:true` (Send photos) lets it run with no room/bookcase. |
| `recipes.js` | The Recipes tab: `recipes.json` (device copy, sync, merge), search, list, recipe window, edit form, adding (camera in recipe mode, links, typing), grocery list, "recipes from this book" in the book window. |
| `diet.js` | Dairy-free / corn-free / gluten-free: `dietScan` checks ingredient lines against rules (with swaps; hidden corn as "check the label"; some with no easy swap), `r.diet` marks a recipe fine as it is, the filter row, list badges, "Show options" in the recipe window. |
| `mealplan.js` | Meal plan (Recipes → 📅 Meal plan): seven days from today, meals per day, recipes or notes for a number of people, the week's ingredients added up and scaled (tick what you need → shopping list), "Plan it" from a recipe, today's meals above the recipe list. |
| `cooking.js` | Timers (found in step text, docked at the bottom of every screen, kept on the phone) and the cooking view (one step at a time, Screen Wake Lock). |
| `recheck.js` | Recheck shelves tab: bookcases by when they were last photographed, recheck photos. |
| `settings.js` | Library name and tagline, switching libraries, set-up links. |
| `wizard.js` | First-run setup wizard (invite code, own Dropbox, or this device only; photo tips; home screen). "Add another phone" links. |
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
- **Selling (no longer in the app; kept in old catalogs):** `saleStatus` `sold` still hides a book from the library. Other fields: `saleStatus` (`consider`, `ebay`, `etsy`, `listed`, `sold` or `keep`), `salePrice`, `saleCondition`, `saleListedAt`, `saleSoldPrice`, `saleSoldAt`, `saleEst`, `saleEstNote`, `saleCondNote`.
- **Recheck:** `checkedAt` (`YYYY-MM-DD`) is the last day a recheck photo showed the book in its place. "Not seen at recheck YYYY-MM-DD" in `notes`, with `needsReview`, marks one a recheck missed.
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

## Where a library is kept: own Dropbox or friends service

There are two ways a library can be kept, and nothing else in the app knows the difference. Every read and write of a library file goes through `cloudGet(path)` / `cloudPut(path, body, {rev, autorename})` in `dropbox.js`. Use them for any new file access. `cloudOn()` says whether this library is connected at all.

- **Own Dropbox:** straight to the Dropbox API with this device's sign-in (`DBX_TOKENS_KEY`).
- **Friend library:** through the friends service in `worker/`, with this phone's device key (`FRIEND_KEY`, `{ server, token, lib, device }`).
  - The service holds the only Dropbox sign-in. It checks that every path is `/<this phone's library>/` plus an allowed file: the catalog, `recipes.json`, `covers/*`, `photos/inbox/*` or `photos/identify/*` (and, read only, `recipes/*`).
  - It keeps the same never-overwrite rules: `add`, or `update:<rev>`.
  - Paths look the same to the app either way, so `dbx:` cover paths and `idPhoto` work unchanged.
- **Joining:** `?join=CODE` (parsed in `core.js`) opens the wizard. `/join` returns a device key. The wizard stores it under the library's namespace, sets the folder, and reloads.
- **The service address** is `DEFAULT_FRIEND_SERVER` in `core.js`. It is never taken from a link. Until it is set, the wizard hides the invite option.
- **Setup and admin:** see `worker/README.md`.

**Photos waiting to send.** A photo that fails to upload is kept in IndexedDB (`photoq:<path>`) and retried on `online`, at start-up, or with *Send them now*.
- Retries go to the same name with no autorename. A name that is already taken means an earlier try did arrive, so it counts as sent. That way a retry never makes a duplicate.
- Shelf and spine photos are sent at 3600 px and JPEG quality 0.9 (`PHOTO_SIZE` in `photos.js`) so small spine print stays readable.

## Photo inbox (the Claude workflow)

The app only uploads. Claude does the reading, with the library's Dropbox folder linked.

- **Shelf photos** go to `photos/inbox/` as `YYYY-MM-DD HHMMSS <Room> <Bookcase> shelf-<n> <kind> [note] [NN].jpg`. `NN` is the order taken, zero-padded, when several photos are sent together. `kind` is `shelf`, `spines`, `recheck`, `new-books`, `book` or `other`. A note, if any, is also saved beside the photos as `… NOTE.txt`. From the shelf camera (`shelfcam.js`) the number is three digits and counts through one bookcase (`001`, `002`…). `NNN redo.jpg` replaces photo `NNN` (a retake that couldn't overwrite it).
- **Title-page photos** from the walk-through go to `photos/identify/` as `<Room> <Bookcase> shelf-<n> pos-<p> <bookId>.jpg`. That book gets `idPhoto` so the list shows 📷.
- **Reading them: `tools/photo-merge.mjs`**, so every run follows the same rules. With the library's folder on the PC (e.g. `D:\Dropbox\Apps\Tamarack Friends\Smith Library`):
  1. `node tools/photo-merge.mjs "<folder>"` lists the photos waiting (and any already in the ledger).
  2. Claude looks at the photos in order and writes a **readings file** in the compact format, one book per line, `title | author | spot from left | high/medium/low [| note]`, under an `@ <photo name> [| shelf=n]` line per photo (or per shelf of a photo). `?` = can't be read. Title-page photos: `@ identify/<name>`, one line, `-` for the spot. The full format is at the top of the script.
  3. `node tools/photo-merge.mjs "<folder>" readings.txt` is a dry run: what would be added, moved, flagged.
  4. `… --apply` writes it:
     - the catalog: each change stamped like an edit in the app (`updatedAt`, `ft`), so a phone's own edits survive the merge;
     - a log (`imports/<date> photos <batch>.md`) and the readings as JSON beside it;
     - the ledger `photos/inbox/_processed.json` (the library's existing list: file, time, batch, checksum): a photo in it is never processed twice (`--force` to redo one);
     - then it deletes the photos (`--keep-photos` to keep them).
  - The books it adds share one `importBatch`, so **Undo last import** in the app takes them out again.
  - Matching: normalized title + author surname (as Duplicates). A book with no place yet is placed; a book already on this bookcase is moved within it; a book on **another** bookcase is added only as a flagged "Possible second copy". Low-confidence readings are flagged "Partly identified" (the walk-through visits them).
  - It never force-overwrites the JSON: if the catalog changes while it works (a phone synced), it starts again on the new version. A Dropbox "conflicted copy" of the catalog is merged in (as the app merges) and moved to `imports/conflicts/`.
  - Tests: `node --test tests/photo-merge.test.mjs`.

### Recheck photos (`kind` = `recheck`)

Sent from **Epilogue → Import & Export → Recheck shelves** when books have drifted. The file name gives the room, the bookcase and, if typed, the shelf. A recheck only **moves** books; it must never create a second copy.

1. Read the spines, shelf by shelf, top shelf = 1, spots counted from the left.
2. Match each spine to a book **already in the catalog**, anywhere in the house: normalized title + author surname (as `dupGroups` in `series.js` does), series + volume for sets. Prefer a match on this bookcase, then this room, then anywhere. If the library has several copies, move the one closest to this place, and never the same book twice.
3. Matched: set `room`, `bookcase`, `shelf`, `position` to where it is now, `checkedAt` = today (`YYYY-MM-DD`), `updatedAt` = now. Change nothing else.
4. Not in the catalog at all: add it where it was seen, with `needsReview: true` and a note `Found at recheck YYYY-MM-DD`. A spine that can't be read becomes a mystery book only if no unread mystery book already sits on that shelf at that spot.
5. In the catalog on this bookcase (or this shelf, if one was given) but not seen in the photos: leave its place, set `needsReview: true` and add to its notes `Not seen at recheck YYYY-MM-DD`. Never delete it.
6. A book that later turns up in a recheck clears that note and the flag (if nothing else set it).

`tools/photo-merge.mjs` applies these rules; "not seen" covers what the photo name says (the bookcase, or the one shelf typed in the app).
7. The change log in `imports/` lists moved / added / not seen, with counts.

The Recheck tab lists bookcases by the latest `checkedAt` (or `addedAt`), oldest first, and counts the "not seen" ones.

## Recipes

Each library keeps its recipes in **`<library folder>/recipes.json`**, private to that library like its catalog (the friends service lets a phone reach only its own library's `recipes.json` and `recipes/`). Original card / page photos live in `<library folder>/recipes/`.

```js
{ format: 'tamarack-recipes', version: 1, updatedAt,
  recipes: [ Recipe | { id, deleted: true, updatedAt } ],
  plan: [ { id, date: 'YYYY-MM-DD', meal: 'breakfast|lunch|dinner|snack', recipeId | text, people, at, updatedAt } | tombstone ],
  settings: { people, updatedAt } }        // the household's number ("Cooking for 5")
```

The meal plan merges like the recipes (per entry, newer `updatedAt` wins, deletes as tombstones); `settings` as a whole, newer wins. A planned recipe opens scaled by `people / servings` (the first number in `servings`; "2 dozen" = 24; no number = not scaled). The week's ingredients (`combineIngredients`) add up the same ingredient and unit ("1 cup flour" + "2 cups flour"), then round up for buying: counted things to whole ones, measures to ¼ ⅓ ½ ⅔ ¾. `tools/recipe-merge.mjs` keeps `plan` and `settings` untouched.

A **recipe** (written in this order, blanks left out): `id` (`r…`), `title`, `from` (who: "Grandma Railey"), `source` (`card`, `family`, `cookbook`, `web`, `magazine`, `other`), `bookId` (a book in this library) or `bookTitle` (not in the library), `page`, `url` (http/https only), `author`, `servings`, `prep`, `cook`, `total` (text: "20 min"), `category`, `cuisine`, `tags` [], `about`, `diet` ['dairy','corn','gluten']: marked fine as it is (overrides the check), `ingredients` [], `steps` [] (one line each; a line starting `## ` is a section heading, e.g. `## For the crust`), `notes`, `favorite`, `want`, `rating`, `made` [{ date `YYYY-MM-DD`, note }], `photos` [paths relative to the library folder, `recipes/<id>-<n>.jpg`], `image` (https only), `pending` (`'link'`: waiting for Claude), `needsReview`, `addedAt`, `updatedAt`, `importBatch`.

- **Sync** (`syncRecipes` in `recipes.js`) runs after each catalog sync and 1.5 s after a change: download with its revision, merge, upload with `update:<rev>` (or `add` when there's no file yet), retry on a conflict. Never a blind overwrite; nothing is uploaded while both sides are empty. **Merge is per recipe: the newer `updatedAt` wins** (recipes are edited rarely; no per-field stamps). A delete is a tombstone.
- **Device copy**: IndexedDB key `tamarack_library_recipes_v1<LIB_NS>` (localStorage fallback). The grocery list (`tamarack_library_grocery<LIB_NS>`) and timers (`tamarack_library_timers`) stay on the phone.
- **Adding** (has to be quick): **+** opens the shelf camera in recipe mode at once (`openShelfCam({ kind:'recipe', recipe:true, optional:true })`): photo names `<stamp> <from or cookbook | no-room> Recipe-<n> recipe <NNN>.jpg`, pages of one recipe share `Recipe-<n>`, **Next recipe →** counts up. 📚 Cookbook / the scan form also write `<stamp> recipe-info NOTE.txt` (JSON: source, from, bookId, bookTitle, page). A link goes to the friends service's `/recipe/fetch` (schema.org Recipe JSON-LD); if that gives nothing, the recipe is saved with `pending:'link'` for Claude. A link pasted in the search box offers *Add this recipe*.
- **Timers** (`findTimes`): "25 minutes", "1 hour 15 minutes", "20–25 min" (starts at 20, **+5** adds the rest), "1 1/2 hours", "½ hour", "half an hour", "one and a half hours". Each keeps its end time, so one that ran out while the phone slept shows done on return.

### Reading recipe photos and waiting links (Claude)

Use **`tools/recipe-merge.mjs`** (the book tool, `photo-merge.mjs`, skips recipe photos):

1. `node tools/recipe-merge.mjs "<folder>"` lists recipe photos waiting (grouped by `Recipe-<n>`), any `recipe-info` notes, and the links waiting (`pending`), with their ids.
2. Read the photos (all pages of a recipe together) and open the waiting links. Write **`recipes-in.json`**: one entry per recipe, `photos` in page order, `fill:<id>` for a waiting link, the fields above, `book` (title; matched to the library), `unsure` for words that couldn't be read. Keep the recipe's own wording; split ingredients and steps one per line, with `## ` headings where the recipe has sections. Copy cookbook recipes in full (Matt, 2026-10-24).
3. `node tools/recipe-merge.mjs "<folder>" recipes-in.json` (dry run), then `--apply`: originals copied to `recipes/<id>-<n>.jpg`, `recipes.json` written (re-applied if a phone saved meanwhile), log in `imports/`, the ledger `photos/inbox/_processed.json`, inbox photos and recipe notes deleted. A same-name recipe is added flagged "Possible duplicate", never merged. Tests: `node --test tests/recipe-merge.test.mjs`.

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
