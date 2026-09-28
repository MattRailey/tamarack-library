# Railey Library — a home book catalog

A web app for cataloging every book in a house: what it is and exactly where it sits (room → bookcase → shelf → spot). It runs in the browser on a phone or computer, with no server, and each household's books live in **their own Dropbox**.

**App:** https://mattrailey.github.io/tamarack-library/tamarack-library
**Code:** https://github.com/MattRailey/tamarack-library

## Start your own library

1. Open the app link above and tap **Epilogue → Data & Sync**.
2. Under **Library settings**, give your library a name and type a Dropbox folder for it, for example `/Smith Library`. Tap **Save settings**.
3. Under **Dropbox**, paste the app key, or open a set-up link from someone who has one. Then tap **Connect Dropbox** and sign in to *your* Dropbox.
4. Fill the library:
   - **Epilogue → Import & Export → From photos** to photograph your shelves.
   - The barcode button to scan books.
   - **+** to type books in by hand.
5. On the phone, add it to the home screen: in Safari, **Share → Add to Home Screen**.

Libraries never mix. Each one has its own Dropbox folder, and on a shared device each keeps its own books, login and settings. **Epilogue → How it works** explains everyday use.

### Dropbox app key

The app talks to Dropbox through a Dropbox "app" you create once at dropbox.com/developers/apps:
- Access type: **Full Dropbox**.
- Permissions: `files.content.read` and `files.content.write`.
- Redirect URI: the app link above.

An app still in development works for its owner. Under **Settings → Development users**, the owner can enable up to 50 more people, such as family, who can then use the same key. Each person still signs in to their own Dropbox, and the key only lets the app into the account of the person using it.

## What's in the library folder

| File | What it is |
|---|---|
| `tamarack-library.json` | The catalog. Readable text, one entry per book. |
| `covers/` | Cover photos taken in the app. |
| `photos/inbox/` | Shelf photos sent from the app for Claude to read. They are deleted once read. |
| `photos/identify/` | Title-page photos from the mystery-book walk-through. They are deleted once read. |
| `imports/` | A log of every batch of changes made from photos. |
| `tamarack-library.html`, `sw.js` | A copy of the app files (the live copy is on GitHub). |

## How it works (technical)

- **Front end only:** plain HTML, CSS and JavaScript in one file, plus `sw.js` for offline use. It is hosted as static files on GitHub Pages.
- **Storage:** each device keeps a copy of the catalog in the browser (IndexedDB). The copy in Dropbox is shared between devices. Syncing merges book by book and field by field, so edits on two devices don't overwrite each other.
- **Book details:** from Open Library and Google Books. Barcode reading uses the phone's built-in reader or ZXing.
