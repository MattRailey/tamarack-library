# Railey Library

A home book catalog: every book in the house, what it is, and exactly where it sits (room → bookcase → shelf → spot). It runs in the browser on a phone or a computer. There is no server: each household's catalog lives in **its own Dropbox**, and nothing is shared between libraries.

- **App:** https://mattrailey.github.io/tamarack-library/tamarack-library
- **Code:** https://github.com/MattRailey/tamarack-library
- **For developers:** [DEVELOPER.md](DEVELOPER.md) · **Changes:** [CHANGELOG.md](CHANGELOG.md)

## What it does

- **Find a book fast.** Search by title, author or keyword, with typo tolerance. Filter by room, genre, status, loans, or when a book was added ("Added in the last 3 months"). Browse as a feed, as cards, or as a list.
- **Know where it is.** Each book has a shelf spot. The Shelves tab shows every bookcase in order.
- **Add books three ways.**
  - Scan the barcode with the phone camera. **Scan a stack** adds book after book with no tapping, and the shelf can wait ("No shelf yet").
  - Type the book in.
  - Photograph whole shelves, or one pile of new books, and let Claude read the spines.
- **"Do I own this?"** Check a barcode or a title at a bookstore or sale. It works offline too.
- **Mystery books.** A shelf-by-shelf walk-through for books that couldn't be identified from photos. Scan them, type them, or snap the title page.
- **Collections, loans, reading status and ratings.**
- **Tidying up.** Duplicates with where each copy is, series split across the house with where every book is, and recheck photos when books have drifted.
- **Offline.** After the first visit the app opens with no signal. Changes sync when the phone is back online.

## Getting started

The first time the app opens on a phone, a **setup wizard** walks through everything. You can run it again any time from **Epilogue → Data & Sync → Run setup again**.

- **Friends (invite code).** Matt sends a link. Tap it and the wizard opens with the code filled in. Tap *Join the library* and you're in. There's no Dropbox account to make and nothing to share. The library is kept in Matt's Dropbox through a small service, and your phone can only open your own library. See [worker/README.md](worker/README.md).
- **Two phones, one household.** On the first phone, go to **Data & Sync → Add another phone**. That makes a one-time link; open it on the second phone. Both phones see and edit the same books.
- **Your own Dropbox.** Choose *Use my own Dropbox* in the wizard, or follow the manual steps below.

## Start your own library in your own Dropbox

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

**Photo tips.**
- Label each bookcase or bay (*N1*, *N2*…). Type it in **Bookcase or bay**, and photograph a sticky note with the code first.
- Shoot top to bottom, two photos per shelf, in good, even light, with no flash.
- Photos are numbered `01`, `02`… in the order taken. If one doesn't go through, it waits on the phone and sends by itself when the signal is back (or tap *Send them now*), under the same name, so nothing is sent twice.

The app sends shelf photos to `photos/inbox/` in the library's Dropbox folder. Title-page photos from the mystery-book walk-through go to `photos/identify/`. File names say where each photo was taken.

With that folder linked, ask Claude to *"check the photo inbox."* Claude then:
- reads the photos;
- adds or corrects the books in `tamarack-library.json`;
- logs the changes in `imports/`;
- deletes the photos it has read.

**Recheck shelves.** Books wander. Under *Epilogue → Import & Export → Recheck shelves*, photograph a bookcase again. Claude moves each book to the spot it's in now and never adds a second copy; books it doesn't see are flagged "not seen at recheck", never deleted.

## What's in the library folder

| File | What it is |
|---|---|
| `tamarack-library.json` | The catalog, in readable text with one entry per book. |
| `covers/` | Cover photos taken in the app. |
| `photos/inbox/`, `photos/identify/` | Photos waiting for Claude. |
| `imports/` | A log of each batch of changes made from photos. |
