import AsyncStorage from 'expo-sqlite/kv-store';

/* Stale-while-revalidate over the on-device store: show what was last seen at once,
   then replace it with fresh data. A screen never starts blank after the first visit. */
export async function swr<T>(key: string, load: () => Promise<T>, onData: (v: T, fresh: boolean) => void): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem('cache:' + key);
    if (raw) onData(JSON.parse(raw) as T, false);
  } catch { /* unreadable cache: fall through to the network */ }
  const v = await load();
  onData(v, true);
  AsyncStorage.setItem('cache:' + key, JSON.stringify(v)).catch(() => {});
}
