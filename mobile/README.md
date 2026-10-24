# RatIdle (mobile)

The RatIdle woodcutting game wrapped in an Expo app. The app is locked to portrait.

The game itself lives in `../web/index.html`. `npm run build:game` bundles it, together with three.js and the
pixel font, into `src/gameHtml.ts`. The app then shows that file in a full-screen `WebView`, so the game works offline.

## Run it

This app uses native modules (WebView, AsyncStorage, haptics, notifications, screen orientation, RevenueCat), so it needs a development build.
Expo Go won't run it.

```bash
npm install
npm run ios        # needs Xcode
npm run android    # needs Android Studio / an emulator or device
```

No local toolchain? Build in the cloud with `npx eas-cli@latest build --profile development`.

After you edit `../web/index.html`, run `npm run build:game` (or restart `npm start`, which does it for you).
For cloud saves, put the Firebase web API key in `mobile/.env.local` as `FIREBASE_API_KEY=...` first. That file and the
generated `src/gameHtml.ts` are git-ignored. EAS builds read the key from the `FIREBASE_API_KEY` EAS environment
variable and generate the file in the `eas-build-post-install` step.

## Controls

- Tap: walk, or chop a tree.
- Long-press (about half a second, a yellow ring shrinks to your finger): open the options menu. This works on
  trees, the ground, the bank chest and items in your pack or bank.
- Drag: turn the camera. Pinch: zoom.

## Focus timer

Start a focus timer (5–120 minutes) from the Focus tab or the FOCUS orb. While it runs:

- Auto-chop is locked on and tapping the world does nothing. The woodcutter chops, banks and repeats on their own,
  with +50% Woodcutting XP.
- Giving up rewinds the save to the moment the timer started.
- When it ends you get character XP and gold. Longer sessions pay more per minute.
- On the phone, a local notification fires when the timer ends, even if the app is closed.

Pick the skill to focus on (Woodcutting, Mining, Fishing, Smithing, Cooking or Construction). Smithing, Cooking and Construction pay 25% more
gold and gather their own ore, fish or logs when they run out. Construction builds a hut on each isle from that isle's
own logs; its level follows overall hut progress and only reaches 99 when every hut is finished.

While a timer runs, the buttons under it switch the camera between Follow, Orbit (slowly circles the rat from
further out) Island (the whole island from above, with the rat drawn larger) and Eyes (a steady first-person view). When a timer ends you can repeat it with any skill.

You play as a rat. Each skill has its own rare pet (Beaver, Rock golem, Heron, Ember salamander, Sous-chef
hedgehog); pick which one follows you in the Pets tab.

When the app goes to the background, the rat walks to the campfire to read, and walks back to its work when you return. READ does the same on demand; books for it are sold in the Shop. Progress keeps adding up while
you're away and is caught up when you return.

Character level (from focus XP) plus Woodcutting, Mining or Fishing at the island's level unlock the five islands.
Hazel the trader has the same stall on every island and pays far more for jewellery and cooked fish than for raw
materials. Gold buys outfits, cabin
upgrades and wood styles for the cabin walls and floor. Logs build furniture inside the cabin, in the wood they came
from.

## RatIdle Pro (RevenueCat)

RatIdle Pro is one $4.99 lifetime purchase (the `ratidle_pro` entitlement). The six base skills and everything that was
in the game before stay free. Pro adds twelve skills:

- **Combat:** Attack, Strength, Block, Health, Ranged and Magic. Every isle has an arena north of the bank with
  monsters of its two tiers. Swords, gauntlets, armour, amulets, shortbows and staffs upgrade by themselves as each
  level rises. Ranged shoots arrows; Magic casts spells with runes. Cooked fish and crops heal you, and being knocked
  out just sends you back to the bank chest.
- **Alchemy:** ore and raw fish of the same tier make a potion at the alchemy table. Potions buff every skill for 5 to
  20 minutes; AUTO drinks the ones that help what it's doing.
- **Farming:** three patches by each isle's hut. Crops grow in real time and heal you in fights. Seeds come from the
  Shop, monsters, travellers and harvests.
- **Agility:** each isle's course can be built one of three ways, for gold and resources from the bank. Running it trains
  Agility, and every built course gives a passive bonus on every isle.
- **Thieving:** pickpocket the traveller, the villagers or Hazel. Harder targets pay more. Gloves, Fortune and Shadow
  potions and some courses raise your success rate.
- **Runecrafting:** rune essence from the essence rocks in each mine becomes runes at the runic altar. Runes power
  combat spells, or Magic's non-combat side: enchanting jewellery for Hazel.
- **Fletching:** ore smithed into arrowtips at the furnace, fletched onto logs at the fletching bench, makes arrows.

Without Pro, the arena, stations, patches and courses are still on every isle; using them shows the paywall. The
website can't sell Pro, so there it says to get the app.

Options › RatIdle Pro opens RevenueCat's paywall, the Customer Center (restores and refund requests) or a restore.
The app holds the entitlement and passes it to the game, see `src/purchases.ts`; the game reads it as `PRO.pro`.

Development builds use the Test Store, so purchases are simulated. Release builds read the store keys from the
`EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` EAS environment variables. RevenueCat makes a
release build crash if it's given a Test Store key, so `__DEV__` decides which key is used.

Set up in the RevenueCat dashboard:

1. Product `lifetime`: a non-consumable at $4.99. Create it in App Store Connect too for the real store.
2. Entitlement `ratidle_pro`, with the product attached.
3. Offering `default`, marked current, with one Lifetime package (`$rc_lifetime`). Its price is shown in the game.
   Debug builds warn in the console if it's missing.
4. A paywall for that offering (Paywalls tab), and the Customer Center (Pro plan and up).

The paywall's Terms and Privacy links, and the product's App Store privacy URL, point to `web/terms.html` and
`web/privacy.html`, published with the website at https://ssyuen.github.io/RatIdle/terms.html and `/privacy.html`.

## How the app and game talk

The game posts messages through `window.ReactNativeWebView`:

- `save` stores a save slot (1–3) in AsyncStorage. The app passes all slots back in as `window.__RATIDLE_SLOTS__` when the game loads.
- `cloud` stores the cloud-save sign-in and sync state in AsyncStorage, passed back in as `window.__RATIDLE_CLOUD__`.
- `deleteSlot` removes a slot. `export` opens the system Share sheet with the save's JSON.
- `haptic` triggers a buzz on long-press, level-ups and rare drops.
- `focusStart` / `focusEnd` schedule and cancel the "Focus complete" notification.
- `pro` (`paywall`, `manage` or `restore`) opens the paywall, the Customer Center, or restores purchases. The app sends
  the entitlement back through `window.__RATIDLE_PRO__` on load and `window.__ratidlePro(state, message)` on changes.

When the app goes to the background, it asks the game to save, and tells it (`__ratidleActive`) so cloud saves pause until
the app is back in front.

## Save slots and import

The game opens on a save-slot screen with three slots. Each slot can be played, exported as JSON, imported into or
deleted. Imports must be under 512 KB and be a RatIdle export. They are rebuilt field by field: unknown fields are
dropped, numbers are clamped, and a running focus timer is never imported.
