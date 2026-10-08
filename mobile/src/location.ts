import * as Location from 'expo-location';
import type { Fix } from './api';

/* GPS starts with the camera so a fix is ready by the time the shutter is tapped.
   The best recent fix wins; a mocked one is kept (so the screen can say why) but never sent. */
export function watchFix(onFix: (f: Fix) => void): () => void {
  let sub: Location.LocationSubscription | null = null;
  let stopped = false;
  Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
    (p) => onFix({
      lat: p.coords.latitude,
      lng: p.coords.longitude,
      accuracy: p.coords.accuracy ?? 9999,
      mocked: p.mocked === true,
      at: p.timestamp,
    }),
  ).then((s) => { if (stopped) s.remove(); else sub = s; }).catch(() => {});
  return () => { stopped = true; sub?.remove(); };
}

// A fix older than this is not "where you stand now".
export const FIX_MAX_AGE_MS = 30_000;

export function fixUsable(f: Fix | null, maxAccuracy: number) {
  return !!f && !f.mocked && f.accuracy <= maxAccuracy && Date.now() - f.at <= FIX_MAX_AGE_MS;
}
