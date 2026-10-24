# RatIdle

An idle woodcutting/skilling game with a focus timer.

- `web/` — the game itself, a single `index.html`. Pushes to `main` that touch `web/` deploy it to GitHub Pages.
- `mobile/` — the Expo app that bundles `web/index.html` into a WebView. See `mobile/README.md`.
- `firebase.json`, `firestore.rules` — the cloud-save backend (Firebase project `ratidle-be`, free Spark plan). Pushes to
  `main` that touch them deploy the Firestore rules and indexes. Auth provider settings are deployed by hand with
  `firebase deploy --only auth`.

## Secrets

No keys are committed. `web/index.html` holds the placeholder `'__FIREBASE_API_KEY__'`, which is filled in at build time:

| Where | Name | Used by |
| --- | --- | --- |
| GitHub repository secret | `FIREBASE_API_KEY` | `pages.yml`, when deploying the web game |
| GitHub repository secret | `FIREBASE_SERVICE_ACCOUNT` | `firebase.yml`: the JSON key of `github-firestore-deploy@ratidle-be.iam.gserviceaccount.com`, which can only manage Firestore rules and indexes |
| EAS environment variable (sensitive) | `FIREBASE_API_KEY` | EAS cloud builds of the app |
| `mobile/.env.local` (git-ignored) | `FIREBASE_API_KEY=...` | local app builds |
| EAS environment variables | `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | release builds of the app (RevenueCat public SDK keys, `appl_…` / `goog_…`) |

Development builds use RevenueCat's Test Store key, which is committed in `mobile/src/purchases.ts` because it can't be used to
charge anyone. A release build without a RevenueCat key hides RatIdle Pro.

Without a key the game still runs and simply hides cloud saves. The API key is restricted to the Identity Toolkit, Secure
Token and Firestore APIs. It still ends up in the page players download, as every Firebase web key does; access is
controlled by `firestore.rules`, not by keeping the key hidden.

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

RatIdle Pro (see `mobile/README.md`) is tied to the cloud-save account too: bought in the app or on the website (through
RevenueCat Web Billing and Stripe) while signed in with a verified email, it unlocks on every device signed in to that
account.
