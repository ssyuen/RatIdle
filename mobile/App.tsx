import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Share, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Notifications from 'expo-notifications';
import { GAME_HTML } from './src/gameHtml';
import { initPurchases, onProChange, proState, restorePurchases, setAppUser, showCustomerCenter, showPaywall, type PurchaseOutcome } from './src/purchases';

const LEGACY_KEY = 'timberline-save-v1';
const SLOTS = [1, 2, 3] as const;
const slotKey = (n: number) => `ratidle-save-slot-${n}`;
// Slot keys from before the game was renamed from Timberline; still read so old saves carry over.
const oldSlotKey = (n: number) => `timberline-save-slot-${n}`;
const MAX_SAVE_BYTES = 2_000_000;
const FOCUS_NOTIF_KEY = 'ratidle-focus-notification';
// Cloud-save sign-in and sync bookkeeping. The game owns its shape and re-checks it on load.
const CLOUD_KEY = 'ratidle-cloud';
const MAX_CLOUD_BYTES = 20_000;

// While the app is open the game shows its own "Focus complete" window, so stay quiet in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function cancelFocusNotification() {
  const id = await AsyncStorage.getItem(FOCUS_NOTIF_KEY);
  if (id) await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  await AsyncStorage.removeItem(FOCUS_NOTIF_KEY);
}

async function scheduleFocusNotification(endsAt: number, minutes: number) {
  await cancelFocusNotification();
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted || endsAt <= Date.now()) return;
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Focus complete!',
      body: `You focused for ${minutes} minutes. Open RatIdle to collect your XP and gold.`,
      sound: true,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(endsAt) },
  });
  await AsyncStorage.setItem(FOCUS_NOTIF_KEY, id);
}

const FRAME = '#2a231a';
type Slots = Partial<Record<number, unknown>>;
type GameMessage =
  | { type: 'save'; slot: number; data: unknown }
  | { type: 'deleteSlot'; slot: number }
  | { type: 'cloud'; data: unknown }
  | { type: 'export'; json: string; name: string }
  | { type: 'haptic'; style: 'medium' | 'success' }
  | { type: 'focusStart'; endsAt: number; minutes: number }
  | { type: 'focusEnd'; completed: boolean }
  | { type: 'pro'; action: 'paywall' | 'manage' | 'restore' }
  | { type: 'proUser'; uid: string | null };

const validSlot = (n: unknown): n is number => typeof n === 'number' && (SLOTS as readonly number[]).includes(n);
const parseSave = (raw: string | null) => {
  if (!raw || raw.length > MAX_SAVE_BYTES) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

export default function App() {
  // WebView's typings default its generic to `undefined`, which collapses the props to `never`.
  const webRef = useRef<WebView<object>>(null);
  // Latest copy of every save slot, handed to the game whenever the web view (re)loads.
  const slotsRef = useRef<Slots>({});
  const cloudRef = useRef<unknown>(null);
  const [ready, setReady] = useState(false);
  const [gameKey, setGameKey] = useState(0);

  // RatIdle Pro: the game reads the entitlement from window.__RATIDLE_PRO__ on load and window.__ratidlePro on changes.
  const sendPro = useCallback((text: string | null = null) => {
    webRef.current?.injectJavaScript(`window.__ratidlePro && window.__ratidlePro(${JSON.stringify(proState())}, ${JSON.stringify(text)}); true;`);
  }, []);

  useEffect(() => {
    initPurchases().catch(e => console.warn('RevenueCat setup failed', e));
    const off = onProChange(() => sendPro());
    return () => { off(); };
  }, [sendPro]);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    (async () => {
      try {
        const pairs = await AsyncStorage.multiGet([...SLOTS.map(slotKey), ...SLOTS.map(oldSlotKey), LEGACY_KEY, CLOUD_KEY]);
        const slots: Slots = {};
        SLOTS.forEach((n, i) => {
          const v = parseSave(pairs[i][1]) ?? parseSave(pairs[SLOTS.length + i][1]);
          if (v) slots[n] = v;
        });
        // Saves from before save slots existed become slot 1.
        if (!slots[1]) {
          const legacy = parseSave(pairs[2 * SLOTS.length][1]);
          if (legacy) slots[1] = legacy;
        }
        slotsRef.current = slots;
        const cloud = pairs[2 * SLOTS.length + 1][1];
        cloudRef.current = cloud && cloud.length <= MAX_CLOUD_BYTES ? parseSave(cloud) : null;
      } catch {
        slotsRef.current = {};
      }
      setReady(true);
    })();
  }, []);

  // When the app leaves the foreground the rat walks to the campfire to read (and the game saves).
  // 'inactive' fires first on iOS, so the walk starts before the app is suspended.
  // __ratidleActive tells the game's cloud sync it's in the background, so it never uploads from there.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      const web = webRef.current;
      if (!web) return;
      if (s === 'active') web.injectJavaScript('window.__ratidleActive && window.__ratidleActive(true); window.__ratidleRest && window.__ratidleRest(false); true;');
      else web.injectJavaScript('window.__ratidleActive && window.__ratidleActive(false); window.__ratidleRest && window.__ratidleRest(true); window.__ratidleSave && window.__ratidleSave(); true;');
    });
    return () => sub.remove();
  }, []);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    const raw = e.nativeEvent.data;
    if (typeof raw !== 'string' || raw.length > MAX_SAVE_BYTES) return;
    let msg: GameMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'save') {
      if (!validSlot(msg.slot) || !msg.data || typeof msg.data !== 'object') return;
      slotsRef.current[msg.slot] = msg.data;
      AsyncStorage.setItem(slotKey(msg.slot), JSON.stringify(msg.data)).catch(() => {});
    } else if (msg.type === 'deleteSlot') {
      if (!validSlot(msg.slot)) return;
      delete slotsRef.current[msg.slot];
      AsyncStorage.multiRemove([slotKey(msg.slot), oldSlotKey(msg.slot)]).catch(() => {});
      if (msg.slot === 1) AsyncStorage.removeItem(LEGACY_KEY).catch(() => {});
    } else if (msg.type === 'cloud') {
      const json = JSON.stringify(msg.data ?? null);
      if (!msg.data || typeof msg.data !== 'object' || json.length > MAX_CLOUD_BYTES) return;
      cloudRef.current = msg.data;
      AsyncStorage.setItem(CLOUD_KEY, json).catch(() => {});
    } else if (msg.type === 'export') {
      if (typeof msg.json !== 'string') return;
      Share.share({ message: msg.json, title: typeof msg.name === 'string' ? msg.name : 'RatIdle save' }).catch(() => {});
    } else if (msg.type === 'focusStart') {
      scheduleFocusNotification(msg.endsAt, msg.minutes).catch(() => {});
    } else if (msg.type === 'focusEnd') {
      cancelFocusNotification().catch(() => {});
    } else if (msg.type === 'pro') {
      const run: Record<string, () => Promise<PurchaseOutcome>> = { paywall: showPaywall, manage: showCustomerCenter, restore: restorePurchases };
      const fn = run[msg.action];
      if (fn) fn().then(r => sendPro(r.text)).catch(() => sendPro('Something went wrong with the store. Please try again.'));
    } else if (msg.type === 'proUser') {
      // The verified cloud-save account; RatIdle Pro bought here then belongs to it.
      if (typeof msg.uid === 'string' && /^[A-Za-z0-9]{6,128}$/.test(msg.uid)) setAppUser(msg.uid).catch(() => {});
    } else if (msg.type === 'haptic') {
      if (msg.style === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  }, [sendPro]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar style="light" />
        {!ready ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#ff981f" />
          </View>
        ) : (
          <WebView<object>
            key={gameKey}
            ref={webRef}
            style={styles.web}
            source={{ html: GAME_HTML, baseUrl: 'https://ratidle.local/' }}
            originWhitelist={['*']}
            injectedJavaScriptBeforeContentLoaded={`window.__RATIDLE_SLOTS__ = ${JSON.stringify(slotsRef.current)}; window.__RATIDLE_CLOUD__ = ${JSON.stringify(cloudRef.current)}; window.__RATIDLE_PRO__ = ${JSON.stringify(proState())}; true;`}
            onMessage={onMessage}
            onLoadEnd={() => sendPro()}
            // iOS can kill a backgrounded web view; reload it with the latest saves.
            onContentProcessDidTerminate={() => setGameKey(k => k + 1)}
            onRenderProcessGone={() => setGameKey(k => k + 1)}
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            textZoom={100}
            setBuiltInZoomControls={false}
            allowsBackForwardNavigationGestures={false}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            allowFileAccess={false}
            contentInsetAdjustmentBehavior="never"
            automaticallyAdjustContentInsets={false}
            webviewDebuggingEnabled={__DEV__}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: FRAME },
  web: { flex: 1, backgroundColor: '#9fd3f2' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
