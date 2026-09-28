# Railey Library

A home book catalog: every book in the house, what it is, and exactly where it sits (room → bookcase → shelf → spot). It runs in the browser on a phone or a computer. There is no server: each household's catalog lives in **its own Dropbox**, and nothing is shared between libraries.

- **App:** https://mattrailey.github.io/tamarack-library/tamarack-library
- **Code:** https://github.com/MattRailey/tamarack-library
- **For developers:** [DEVELOPER.md](DEVELOPER.md) · **Changes:** [CHANGELOG.md](CHANGELOG.md)

## What it does

- **Find a book fast.** Search by title, author or keyword, with typo tolerance. Filter by room, genre, status or loans. Browse as a feed, as cards, or as a list.
- **Know where it is.** Each book has a shelf spot. The Shelves tab shows every bookcase in order.
- **Add books three ways.**
  - Scan the barcode with the phone camera.
  - Type the book in.
  - Photograph whole shelves and let Claude read the spines.
- **"Do I own this?"** Check a barcode or a title at a bookstore or sale. It works offline too.
- **Mystery books.** A shelf-by-shelf walk-through for books that couldn't be identified from photos. Scan them, type them, or snap the title page.
- **Collections, loans, reading status and ratings.**
- **Selling.** Mark books to sell, then export eBay and Etsy listing files.
- **Offline.** After the first visit the app opens with no signal. Changes sync when the phone is back online.

## Start your own library

You need a Dropbox account and about ten minutes.

1. **Create a Dropbox app** (one time) at [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps):
   - Choose *Scoped access* and *Full Dropbox*.
   - On the **Permissions** tab, tick `files.content.read` and `files.content.write`, then click *Submit*.
   - On the **Settings** tab, add the app's address as a *Redirect URI*. Use `https://mattrailey.github.io/tamarack-library/tamarack-library`, or your fork's address.
   - Copy the **App key**.
2. **Open the app** and tap **Epilogue → Data & Sync**.
3. Under **Library settings**, set up your library:
   - Give it a name.
   - Type a Dropbox folder for it, for example `/Smith Library`.
   - Tap **Save settings**.
4. Under **Dropbox**, paste the app key, tap **Connect Dropbox**, and sign in.
5. **Fill the library:**
   - **Epilogue → Import & Export → From photos** sends shelf photos to Claude.
   - The **barcode** button scans books.
   - **+** adds a book by hand.
6. On the phone, add the app to the home screen. In Safari, tap **Share → Add to Home Screen**.

**Sharing with family.** A Dropbox app in development mode works for its owner. To let others use it:
- The owner opens **Settings → Development users** and enables up to 50 more people.
- **Copy set-up link** (on Data & Sync) makes a link that sets up a phone with the folder and app key in one tap.

Each person still signs in to their own Dropbox. The app key only lets the app into the account of the person using it.

**Several libraries on one device.** Libraries never mix. Each one keeps its own books, Dropbox sign-in and settings, and you can switch between them under Library settings.

## Claude and the photo inbox

The app sends shelf photos to `photos/inbox/` in the library's Dropbox folder. Title-page photos from the mystery-book walk-through go to `photos/identify/`. File names say where each photo was taken.

With that folder linked, ask Claude to *"check the photo inbox."* Claude then:
- reads the photos;
- adds or corrects the books in `tamarack-library.json`;
- logs the changes in `imports/`;
- deletes the photos it has read.

## What's in the library folder

| File | What it is |
|---|---|
| `tamarack-library.json` | The catalog, in readable text with one entry per book. |
| `covers/` | Cover photos taken in the app. |
| `photos/inbox/`, `photos/identify/` | Photos waiting for Claude. |
| `imports/` | A log of each batch of changes made from photos. |
