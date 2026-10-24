// RevenueCat: the one-time RatIdle Pro purchase, which unlocks the game's twelve Pro skills. The product, offering and
// paywall's look are set up in the RevenueCat dashboard; this file only configures the SDK, tracks the entitlement and
// opens the native screens.
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, PURCHASES_ERROR_CODE, type CustomerInfo, type PurchasesError } from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';

export const PRO_ENTITLEMENT = 'ratidle_pro';
// The dashboard's current offering holds one package: the lifetime product.
const LIFETIME_PACKAGE = '$rc_lifetime';

// Test Store key: purchases are simulated, nothing is charged. The SDK alerts and crashes if a release build is
// configured with it, so release builds use the store keys from EAS environment variables instead.
const TEST_STORE_KEY = 'test_lgfblNqEgddndKaDtAsbffHESIB';
const API_KEY = __DEV__
  ? TEST_STORE_KEY
  : Platform.select({ ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY, android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY });

// `price` is the store's localized price of the lifetime product, for the game to show before the paywall opens.
export type ProState = { available: boolean; pro: boolean; price: string | null };

let configured = false;
let current: ProState = { available: false, pro: false, price: null };
const listeners = new Set<(s: ProState) => void>();

function update(next: Partial<ProState>) {
  current = { ...current, ...next };
  listeners.forEach(l => l(current));
}

const publish = (info: CustomerInfo) => update({ available: true, pro: !!info.entitlements.active[PRO_ENTITLEMENT] });

export const proState = () => current;

/** Calls `fn` with every change to the Pro entitlement. Returns an unsubscribe function. */
export function onProChange(fn: (s: ProState) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Configures the SDK once and loads the cached customer info. Without a key for this build, purchases stay hidden. */
export async function initPurchases() {
  if (configured) return;
  if (!API_KEY) {
    console.warn('No RevenueCat API key for this build: RatIdle Pro is unavailable.');
    return;
  }
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  Purchases.configure({ apiKey: API_KEY });
  configured = true;
  // Fires after purchases, restores, renewals and expirations, including ones made outside the app.
  Purchases.addCustomerInfoUpdateListener(publish);
  try {
    publish(await Purchases.getCustomerInfo());
  } catch (e) {
    // Offline with nothing cached: still offer the paywall, and the listener catches up once online.
    update({ available: true });
    console.warn('RevenueCat getCustomerInfo failed', e);
  }
  loadPrice().catch(e => console.warn('RevenueCat getOfferings failed', e));
}

// The lifetime product's price, and in development a warning when the dashboard setup is missing.
async function loadPrice() {
  const offering = (await Purchases.getOfferings()).current;
  const lifetime = offering?.availablePackages.find(p => p.identifier === LIFETIME_PACKAGE);
  if (lifetime) update({ price: lifetime.product.priceString });
  else if (__DEV__) console.warn(offering ? `RevenueCat: offering "${offering.identifier}" has no ${LIFETIME_PACKAGE} package.` : 'RevenueCat: no current offering. Create one in the dashboard and mark it as current.');
}

const errorText = (e: unknown) => {
  const err = e as Partial<PurchasesError>;
  if (err?.code === PURCHASES_ERROR_CODE.NETWORK_ERROR) return 'No connection. Try again when you are online.';
  if (err?.code === PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR) return 'Purchases are not allowed on this device.';
  if (err?.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) return 'Your payment is pending. Pro unlocks once it goes through.';
  return 'Something went wrong with the store. Please try again.';
};

/** Result of a purchase screen, as a short message for the game to show. Null means nothing to say. */
export type PurchaseOutcome = { ok: boolean; text: string | null };

/** Shows the RevenueCat paywall for the current offering, unless the player already has Pro. */
export async function showPaywall(): Promise<PurchaseOutcome> {
  if (!configured) return { ok: false, text: 'Purchases are not available in this build.' };
  try {
    const result = await RevenueCatUI.presentPaywallIfNeeded({ requiredEntitlementIdentifier: PRO_ENTITLEMENT, displayCloseButton: true });
    // The update listener usually beats this, but refresh in case it didn't fire.
    if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) publish(await Purchases.getCustomerInfo());
    switch (result) {
      case PAYWALL_RESULT.PURCHASED: return { ok: true, text: 'Thank you! RatIdle Pro is unlocked.' };
      case PAYWALL_RESULT.RESTORED: return { ok: true, text: 'Purchases restored. RatIdle Pro is unlocked.' };
      case PAYWALL_RESULT.NOT_PRESENTED: return { ok: true, text: 'You already have RatIdle Pro.' };
      case PAYWALL_RESULT.ERROR: return { ok: false, text: 'The store could not be opened. Please try again.' };
      default: return { ok: false, text: null }; // Cancelled.
    }
  } catch (e) {
    return { ok: false, text: errorText(e) };
  }
}

/** Customer Center: restore the purchase or ask for a refund. */
export async function showCustomerCenter(): Promise<PurchaseOutcome> {
  if (!configured) return { ok: false, text: 'Purchases are not available in this build.' };
  try {
    await RevenueCatUI.presentCustomerCenter({
      callbacks: { onRestoreCompleted: ({ customerInfo }) => publish(customerInfo) },
    });
    publish(await Purchases.getCustomerInfo());
    return { ok: true, text: null };
  } catch (e) {
    return { ok: false, text: errorText(e) };
  }
}

export async function restorePurchases(): Promise<PurchaseOutcome> {
  if (!configured) return { ok: false, text: 'Purchases are not available in this build.' };
  try {
    const info = await Purchases.restorePurchases();
    publish(info);
    return current.pro
      ? { ok: true, text: 'Purchases restored. RatIdle Pro is unlocked.' }
      : { ok: true, text: 'No RatIdle Pro purchase was found for this account.' };
  } catch (e) {
    return { ok: false, text: errorText(e) };
  }
}
