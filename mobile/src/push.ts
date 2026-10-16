import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import AsyncStorage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';
import type { Fix } from './api';
import { spotRpc } from './api';
import { getLang } from './i18n';

/* "Alerts near me" for the app. It reuses the site's alert tables: the Expo push token is
   stored as a subscription whose endpoint is the Expo push URL, so kasa_notify_targets hands
   it out like any browser, and kasa-notify sends it through Expo's push service. */
const KEY = 'push_on';
const ENDPOINT = 'https://exp.host/--/expo-push/';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export type PushResult = 'on' | 'denied' | 'unavailable';

export const pushEnabled = () => AsyncStorage.getItem(KEY).then((v) => v === '1').catch(() => false);

async function token(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  try { return (await Notifications.getExpoPushTokenAsync({ projectId })).data; } catch { return null; }
}

export async function enablePush(fix: Fix): Promise<PushResult> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('nearby', { name: 'Nearby reports', importance: Notifications.AndroidImportance.DEFAULT });
  }
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return 'denied';
  const t = await token();
  if (!t) return 'unavailable';
  await spotRpc('kasa_push_subscribe', {
    p_endpoint: ENDPOINT + encodeURIComponent(t), p_p256dh: 'expo-push-token-v1-placeholder', p_auth: 'expo-push',
    p_lat: fix.lat, p_lng: fix.lng, p_radius: null, p_lang: getLang(),
  });
  await AsyncStorage.setItem(KEY, '1').catch(() => {});
  return 'on';
}

export async function disablePush(): Promise<void> {
  const t = await token();
  if (t) await spotRpc('kasa_push_unsubscribe', { p_endpoint: ENDPOINT + encodeURIComponent(t) }).catch(() => {});
  await AsyncStorage.setItem(KEY, '0').catch(() => {});
}

/* Tapping an alert opens that report. */
export function onAlertTap(open: (reportId: string) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const id = r.notification.request.content.data?.report_id;
    if (id) open(String(id));
  });
  return () => sub.remove();
}
