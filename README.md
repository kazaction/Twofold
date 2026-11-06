# Twofold

A private, end-to-end encrypted archive for two people, with Discord-style chats, photos, files,
a shared calendar, timelines, and PIN-locked chats.
It runs as a web app on iPhone, Android and desktop. There is no server: your data lives
**encrypted** in a private GitHub repo that you own, and every device keeps a local copy.

## How it works

- **Two repos.** The *app* (this folder) is hosted for free on GitHub Pages. Your *data* goes
  into a separate **private** repo.
- **Everything is encrypted on your device** (AES-256-GCM) before upload. GitHub only ever sees
  random-looking `.bin` files. The key never leaves your devices except inside a setup code.
- **Sync button = pull + push.** The app **always pulls when you open it** or switch back to it.
  Uploading after you post (and every 2 min) is on by default and can be turned off in Settings.
- **Shared everything.** Both of you can post in every chat, change any chat's name, icon,
  description or lock, and add, edit or delete calendar events.
- **Conflicts: the last push wins.** If you both change the same thing, the version that was
  **synced last** becomes the master version on both devices. This applies even if it was edited
  earlier, for example offline. Different fields merge: if one of you renames a chat and the other
  changes its icon, both changes are kept.
- **Messages:** only the author can edit or delete their own message. Everyone signs their changes
  with a personal key, and every device checks this.
- **Photos** are compressed (which also removes GPS/EXIF data) and get a small thumbnail stored inside
  the message, so chats load instantly. The full image downloads when you open it.

## 1. Host the app (one time, ~5 min)

1. On GitHub create a new **public** repo, e.g. `twofold-app`. (The app code holds no data or secrets.
   Free GitHub Pages needs a public repo.)
2. Upload **all files from this folder** to it, keeping the folders (`css/`, `js/`, `icons/`, `vendor/`).
   On the repo page: *Add file → Upload files* → drag the folder contents in → *Commit*.
3. Repo **Settings → Pages** → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save.
4. After a minute the app is live at `https://YOUR-USERNAME.github.io/twofold-app/`.

## 2. Create the data repo and token

1. Create a second repo, **private**, e.g. `our-vault`, and tick **Add a README**.
2. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
   - Repository access: **Only select repositories** → `our-vault`
   - Permissions → Repository permissions → **Contents: Read and write**
   - Pick a long expiration. When it expires, generate a new one and paste it in *Settings → Change token*.

## 3. Install on each device

> **iPhone: set up inside the installed app, not in Safari.** iOS keeps home-screen apps' storage
> separate from Safari's.

- **iPhone/iPad:** open the URL in **Safari** → Share → **Add to Home Screen**, then open it from the home screen.
- **Android:** open in **Chrome** → ⋮ menu → **Install app** / Add to Home screen.
- **Desktop:** open in Chrome or Edge → click the install icon in the address bar. Or just use it as a website.

## 4. First device → "Start a new vault"

Enter your name, `username/our-vault`, branch `main`, and the token.

## 5. Other devices → "Join with a setup code"

On a device that already has the vault: **Settings → Devices**
- **Add another of my devices**: for your own laptop/tablet. You stay the same person and can edit your old messages.
- **Invite the other person**: for your partner. They choose their name on their device.

On the new device tap **Join with a setup code → Scan QR code** (or paste the code).

⚠️ A setup code contains the vault key (and optionally the token). Show it in person, or send it
only through something you trust (e.g. Signal), then delete that message.

## Calendar

Tap **Calendar** at the top of the sidebar. Pick a day, type a title, then press **Add**. Tap an event
to rename it, move it to another day, or delete it. Event colours show who added them.

## Timelines

Tap **+** next to Twofold in the sidebar, then choose **Timeline** instead of Chat. A timeline is one
long horizontal line. Scroll it sideways: swipe on a phone, or use the mouse wheel or drag on a computer.

- Tap **+** (the round button at the end of the line, or the big one in the corner) to add an event:
  a title, a description and a colour. New events are added to the end of the line.
- Boxes show only the title. Tap one to read the full description and edit the title, description
  or colour, or to delete it.
- Both of you can add and edit events. If you both edit the same event, the one synced last wins.
- Timeline events show up in search, and a timeline can be locked with the PIN like any chat.

## Locked chats

- Open a chat → **ⓘ** → tick **Lock this chat with the shared PIN** → Save.
- The first time, you choose a **4-digit PIN**. It's shared by both of you, syncs automatically, and
  unlocks every locked chat. Change it in Settings → Locked chats (you need the current PIN).
- A locked chat shows only as 🔒 *Locked chat*. Its name, icon and messages are hidden, and it's left
  out of search. Tap it to get the keypad.
- It locks again as soon as you leave the chat or the app goes to the background.
- To unlock it permanently, open it, then **ⓘ** → untick the lock → Save.

> The PIN is a **privacy screen**, not extra encryption. It stops someone holding your unlocked
> phone from reading those chats. It doesn't add protection against someone who already has the
> vault key, since there are only 10,000 possible PINs. For protection on the device itself, use
> **App lock** (a full passphrase) as well.

## Security notes

- **App lock** (Settings → Security): adds a passphrase. While locked, nothing on the device can be
  read, because the local copy is encrypted too. It locks again after 5 minutes in the background.
- **Lose every device = lose the archive.** The repo is useless without the key. Keep at least two
  devices set up, or store a setup code somewhere safe offline (e.g. printed).
- **Deleting a message** removes it for both of you, but old encrypted copies stay in the git history.
  They are still encrypted.
- Whoever holds the token can delete or overwrite repo files but can't read them. Keep the token private.
- Hiding a chat never deletes anything; it moves to "Hidden chats" and the creator can unhide it.

## Limits

- GitHub prefers repos under a few GB. With photo compression on, a photo is roughly 200–600 KB,
  so a couple of GB holds thousands of photos. Attachments are capped at 50 MB each.
- There are no push notifications; this is an archive, not a live messenger.
- **Export:** Settings → Data → *Export text archive (JSON)* saves all messages as readable JSON.

## Updating the app

Edit the files in the app repo, then change `VERSION` in `sw.js` (e.g. `twofold-v2`). Devices pick
up the update the next time they open the app (sometimes it takes a second launch).

## Files

| File | What it does |
|---|---|
| `js/vault.js` | event log, ownership rules, sync logic |
| `js/github.js` | GitHub Git Data API client (one commit per sync) |
| `js/crypto.js` | AES-GCM encryption, ECDSA signatures, passphrase lock |
| `js/db.js` | local storage (IndexedDB) |
| `js/media.js` | photo compression and thumbnails |
| `js/app.js` | the interface |
| `sw.js` | offline support |
| `vendor/` | QR code generator (MIT) and scanner jsQR (Apache-2.0) |
