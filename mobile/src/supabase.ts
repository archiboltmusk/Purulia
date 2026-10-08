import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

AppState.addEventListener('change', (s) => {
  if (s === 'active') sb.auth.startAutoRefresh();
  else sb.auth.stopAutoRefresh();
});

/* Same anonymous account the website uses: every server cap (reports per hour/day,
   capture tokens, photo ownership) keys off this user id, so the app gets no extra room. */
export async function ensureSession(): Promise<string> {
  const { data: { session } } = await sb.auth.getSession();
  if (session) return session.user.id;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data?.user) throw new AppError('session');
  return data.user.id;
}

export class AppError extends Error {
  constructor(public key: string, public vars: Record<string, string | number> = {}) { super(key); }
}
