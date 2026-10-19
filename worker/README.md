# Friends service

Lets friends use the app with their library kept in **Matt's Dropbox**. Friends need no Dropbox account and have nothing to share. They open an invite link on their phone, and the setup wizard does the rest.

```
friend's phone ──► friends service (Cloudflare, free) ──► Matt's Dropbox
                    holds the only Dropbox sign-in         Apps/Tamarack Friends/
                    a phone's key opens one library          Smith Library/
                                                             Jones Library/
```

- **One library per key.** A phone's key opens its own library folder and nothing else. It can't open other friends' folders, Railey Library, or anything else in Matt's Dropbox.
- **Only some files.** A phone can read and write its catalog, send photos to `photos/inbox/` and `photos/identify/`, and keep cover photos in `covers/`. It can't read photos back or list folders.
- **A household shares a library.** Each phone gets its own key, so a lost phone can be switched off alone.
- **Matt and Claude work as usual.** Friends' folders sit in Matt's Dropbox on his PC. "Check the photo inbox for the Smith Library" works the same as for Railey Library.

## Try it first, on this computer

```
npm run sandbox
```
Runs the real service code with a pretend Dropbox (`worker/.sandbox/Dropbox/Apps/Tamarack Friends/`, open it in Explorer) and pretend Cloudflare storage. No accounts needed, nothing leaves the PC. It prints an invite link for "Test Library"; open it in a browser (or on a phone on the same Wi-Fi). Type `invite "<Library>"`, `list`, `revoke <phone id>`, `down` / `up` (Dropbox fails / works again) or `reset` in its window. The sandbox has no offline copy (no service worker), and a phone over plain http can't use the live camera scanner; photo picking works.

## One-time setup (about 20 minutes)

You need Node.js on your computer (nodejs.org, the LTS version) and a free Cloudflare account (dash.cloudflare.com/sign-up).

1. **Make a Dropbox app just for this.** Go to [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) → *Create app*:
   - Choose *Scoped access* and *App folder*, and name it `Tamarack Friends`.
   - On **Permissions**, tick `files.content.read` and `files.content.write`, then click *Submit*.
   - Copy the **App key**.
   - Only your own account signs in to this app, so you don't need to enable additional users.

   *App folder* is the point here: even if something went wrong in the service, it could only ever reach `Dropbox/Apps/Tamarack Friends/`.
2. **Open a terminal in this folder** (`worker/`) and sign in to Cloudflare:
   ```
   npx wrangler login
   ```
3. **Make the storage for invite codes and phone keys:**
   ```
   npx wrangler kv namespace create LIBS
   ```
   Paste the `id` it prints into `wrangler.toml`, replacing `PASTE_KV_NAMESPACE_ID_HERE`.
4. **Sign the service in to your Dropbox:**
   ```
   node get-token.mjs <your app key>
   ```
   Open the link, tap *Allow*, and paste the code back into the terminal. It prints a refresh token.
5. **Store the secrets.** Each command asks you to paste a value.
   ```
   npx wrangler secret put DBX_APP_KEY         (the app key)
   npx wrangler secret put DBX_REFRESH_TOKEN   (from step 4)
   npx wrangler secret put ADMIN_SECRET        (make one up: 30+ random characters, keep it somewhere safe)
   ```
6. **Deploy:**
   ```
   npx wrangler deploy
   ```
   It prints the service address, for example `https://tamarack-friends.<you>.workers.dev`.
7. **Build the address into the app.** In `js/core.js`, set `DEFAULT_FRIEND_SERVER` to that address, then commit and push. Until this is set, the wizard doesn't show the invite option.

## Inviting a friend

**The easy way, in the app** (on your own phone or computer): *Epilogue → Data & Sync → Invite a friend*. Type the password once per device (Dashlane can save and fill it; it's the ADMIN_SECRET you stored), type the library's name, tap **Make invite**, then **Share invite**. The same box lists every library's phones, with **Switch off** for a lost one. The box never shows on a friend's phone. *Forget password on this device* removes it.

**Or from a terminal:**

Do this once per computer, in a terminal, then use `admin.mjs` from the `worker/` folder.

Windows:
```
set TAMARACK_SERVICE=https://tamarack-friends.<you>.workers.dev
set TAMARACK_ADMIN=<your ADMIN_SECRET>
```
Mac (use `export` instead of `set`):
```
export TAMARACK_SERVICE=https://tamarack-friends.<you>.workers.dev
export TAMARACK_ADMIN=<your ADMIN_SECRET>
```

Then:
```
node admin.mjs invite "Smith Library" "The Smith Library"
```
- This prints a code like `KX7P-3MWD` and a link. Text them the link.
- It works for two phones (a couple) for 30 days.
- More phones can join later from the app: **Data & Sync → Add another phone** makes a one-time link.

Other commands:
- `node admin.mjs list`: every library, its phones, and open codes.
- `node admin.mjs revoke <phone id>`: switch off one lost or replaced phone. The library keeps working on the others.
- `node admin.mjs revoke-library "Smith Library"`: switch off every phone of a library.

## Reading a friend's shelf photos

Their photos land in `Dropbox/Apps/Tamarack Friends/<Library>/photos/inbox/`. Link that folder (or `Tamarack Friends`) in a Claude session and say *"check the photo inbox for the Smith Library."* It's the same workflow as Railey Library: read the photos, update `tamarack-library.json`, log to `imports/`, delete the photos.

## Costs and limits

- **Cloudflare's free plan:** 100,000 requests a day. A phone syncing all day uses a few hundred.
- **KV writes:** 1,000 a day, used only when a phone joins or an invite is made.
- **Upload size limits:** one photo up to 15 MB, a catalog up to 25 MB.
- **Dropbox:** everything counts against your Dropbox storage. Catalogs are small, and shelf photos are deleted after reading. Cover photos taken in the app add up slowly.

## Known limits (fine for a few friends)

- **Switching off a phone takes about a minute** to reach everywhere, because Cloudflare's storage is shared out with a short delay. Switching it off also cancels any invite links that phone made.
- **A one-time link opened on two phones at the very same moment** could let both in. If that happens, use `list` and `revoke` the extra phone.
- **Upload cap:** a library can send about 600 photos or covers a day, so a lost or misused phone can't fill your Dropbox. A whole shed is about 200 photos.

## Tests

```
node --test test/worker.test.mjs
```
Dropbox and Cloudflare are faked. The app's own tests (`npm test` in the main folder) also run the real service code, with a pretend friend and spouse joining.
