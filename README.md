# RatIdle

An idle woodcutting/skilling game with a focus timer.

- `web/` — the game itself, a single `index.html`. Pushes to `main` that touch `web/` deploy it to GitHub Pages.
- `mobile/` — the Expo app that bundles `web/index.html` into a WebView. See `mobile/README.md`.
- `firebase.json`, `firestore.rules` — the cloud-save backend (Firebase project `ratidle-be`, free Spark plan). Deploy with
  `firebase deploy --only firestore,auth`.

## Cloud saves

Cloud saves are optional. The slot screen asks once: set up cloud saves, or keep saves on this device. Choosing local-only
means the game never contacts the cloud; it can be turned on later from Options › Cloud save.

Players sign in with an email and password and must verify the address (via the emailed link) before anything is backed
up. Each slot is stored as its export JSON at `users/{uid}/saves/{slot}` in Firestore. The rules only let a player with a
verified email reach their own three slots, cap a save at 100 KB, and allow one write per slot per minute.

Turning cloud saves off either keeps the cloud copies (just signs out of this device) or, after re-entering the password,
deletes every cloud copy and the account.

The game backs up the slot being played at most once every 8 hours, and only while it is in the foreground. It never
uploads from the background; if the 8 hours ran out while it was away, it uploads when the player comes back. Uploads are
skipped during a focus timer. Each upload only goes through if the cloud copy is the one this device last wrote or
restored, so a second device never silently overwrites the first; the player picks which to keep in the Cloud window.
Restores are sanitized like any import.
