# Changelog

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
