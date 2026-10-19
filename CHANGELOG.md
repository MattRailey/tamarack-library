# Changelog

## 2.1 — 2026-10 · Friends' libraries and setup wizard

**New**
- **Setup wizard.** It opens by itself the first time the app runs on a phone. You pick one of three ways in (invite code, your own Dropbox, or just this device), then get shelf-photo tips and how to add the app to the home screen. Run it again from Data & Sync.
- **Friends' libraries.** Friends can keep their library in Matt's Dropbox through a small service (`worker/`), with no Dropbox account of their own. Each phone's key opens only its own library.
- **Add another phone.** A one-time link brings a second phone in the household into the same library.
- **Setup goes straight into photographing.** After joining, the wizard asks for the room and bookcase and takes the photos right there, then shows how the walk-through finds the books Claude couldn't read.
- **Recheck shelves.** Photograph a bookcase again when books have moved: Claude only moves books to their new spots, never adds second copies, and flags books it didn't see. Bookcases are listed oldest-checked first.
- **Duplicates and Series are tabs** in Import & Export. Series lists every book of a split-up series under the place it sits, volumes in order, and can be narrowed to one room.
- **Removed: Sell & value** (eBay / Etsy listings). Books already marked sold stay hidden from the library.
- **Invite a friend, in the app.** On Matt's devices, *Data & Sync → Invite a friend* makes invites, shares the link, lists each library's phones and switches one off. The admin secret is pasted once per device and kept in that browser only. No terminal needed.
- **The friends service is live** at `tamarack-friends.railey.workers.dev`, so the invite option now shows in the setup wizard.

**Fixes**
- **Photos that fail to send are no longer lost.** They wait on the phone and send by themselves later, without duplicates.
- **Photo order:** photos are numbered `01`, `02`… so 10 no longer sorts before 2.
- **Sharper shelf photos:** shelf and spine photos are now sent at 3600 px and higher quality (was 2600 px), so small spine print stays readable.

## 2.2.1 — 2026-10-12 · Safer offline copy

**Fixes**
- **Previous save:** the device keeps the save before the last one in case the main copy is damaged, but the first save of each visit kept none, so a copy damaged after one change opened with no books (until Dropbox filled it back in). The copy on the device is now kept as the previous save on the first save too. This is what failed the automated tests on GitHub.

## 2.2 — 2026-10-11 · Recently added

**New**
- **Filters → Added:** last week, last month, last 3 months, or "New since the library was catalogued" (leaves out the first big import). Choosing one sorts newest first and shows each book's added date.
- **Filters → Room → "No shelf yet":** books with no room, such as a scanned stack not put away yet.

## 2.1 — 2026-10-11 · Scanning many books

**Fixes**
- **Scanner only read one book:** once a book's card was up, the camera ignored every other barcode until a button was tapped. It now keeps reading: a new book replaces the card, and the same book held in view is not read twice.
- **Camera that stopped:** the reading loop could die on a frame that failed to draw, and the camera stayed off after the screen locked, after another app took it, or after the photo picker was cancelled. A watchdog now restarts it whenever the scanner is open. The barcode reader keeps its settings between frames.

**New**
- **Scan a stack** (the scanner's first mode): scan one barcode after another and each book goes in by itself, with a beep and a green flash. Books already in the library are flagged, not added ("Add another copy" if you want it). A repeat scan is ignored. Each row has Undo. Where the books go is optional: left blank, they're listed as "No shelf yet". Offline, books go in by ISBN and fill in later.
- **One photo of the whole stack for Claude:** in Scan a stack, the photo button sends a picture of new books to the inbox marked "New books, not shelved yet".
- Tests: the camera is tested with a fake video of two barcodes, so the real reading loop runs.

## 2.0 — 2026-09-28 · Cleanup release

**Fixes**
- **Sync (loans):** a loan or other edit made on one device while another device changed a *different* field of the same book was kept only on that device and never uploaded. The merged version of the book is now uploaded.
- **Sync (edit form):** saving the edit form counted every blank field as changed, so an untouched field could overwrite a real change from another device. Only fields you actually change now count.

**Under the hood**
- The single 286 KB file is now a page, a stylesheet and 18 small scripts, one per feature. There is still no build step.
- Collection features are built directly into the book form, the list and the filters, instead of being patched on afterwards.
- The stylesheet is consolidated: 23 duplicate rules and about 180 dead declarations are gone. Screenshots of every screen, at phone and desktop sizes, are pixel-identical before and after.
- Icons are separate files instead of being embedded in the page. A web app manifest adds Android home-screen install.
- The service worker keeps every app file for offline use.
- An automated test suite of 40 Playwright tests covers the library, the book window, collections, sync and merging, offline use, the scanner, the walk-through, photos, settings, multiple libraries, import and export. It runs on every push.
- New docs: README (users), DEVELOPER.md (architecture, data format, sync, testing, releasing), and this changelog.

## 1.x — 2026 · Before the cleanup

The app grew in one file, feature by feature:
- **Catalog:** shelf-photo catalog, search with typo tolerance, feed, card and list views, book window with page-turn navigation.
- **Sync and storage:** Dropbox sync with per-field merging, IndexedDB storage.
- **Getting books in:** barcode scanner with "Do I own this?" and offline save-for-later, the mystery-book walk-through (shelf by shelf, with a shelf picker), the photo inbox for Claude.
- **Organizing:** collections, series and duplicate finders, selling tools (eBay and Etsy export).
- **Setup:** offline support, separate libraries per Dropbox folder with set-up links, library name and tagline, the Epilogue appendix pages, and the How it works guide.
