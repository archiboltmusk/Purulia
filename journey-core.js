/* Device-only movement estimate. Remaining route distance is supplied by the passenger. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Journey = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function distance(a, b) {
    const rad = x => x * Math.PI / 180, dlat = rad(b.lat - a.lat), dlon = rad(b.lon - a.lon);
    const h = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlon / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  function valid(p) { return p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lon) && Math.abs(p.lon) <= 180 && Number.isFinite(p.accuracy) && p.accuracy > 0 && p.accuracy <= 50 && Number.isFinite(p.at); }
  function estimate(samples, remainingKm, now = Date.now()) {
    if (!Number.isFinite(remainingKm) || remainingKm <= 0 || remainingKm > 2000) return { status: 'distance_needed' };
    const recent = samples.filter(p => valid(p) && p.at <= now && now - p.at <= 120000);
    if (recent.length < 3 || now - recent[recent.length - 1].at > 30000 || recent[recent.length - 1].at - recent[0].at < 30000) return { status: 'collecting' };
    const speeds = []; let travelled = 0, accuracy = 0;
    for (let i = 1; i < recent.length; i++) {
      const a = recent[i - 1], b = recent[i], seconds = (b.at - a.at) / 1000, metres = distance(a, b);
      if (seconds < 5 || seconds > 60 || metres / seconds > 50) return { status: 'unstable' };
      travelled += metres; accuracy += b.accuracy;
      speeds.push(metres / seconds);
    }
    const averageAccuracy = accuracy / speeds.length;
    if (travelled < Math.max(100, averageAccuracy * 3) || distance(recent[0], recent[recent.length - 1]) < Math.max(50, averageAccuracy * 2)) return { status: 'stationary' };
    speeds.sort((a, b) => a - b);
    const speed = speeds[Math.floor(speeds.length / 2)];
    if (speed < 1 || speeds[speeds.length - 1] > speed * 3) return { status: 'unstable' };
    return { status: 'estimate', minutes: Math.ceil(remainingKm * 1000 / speed / 60), speed_kmh: Math.round(speed * 3.6), remaining_km: remainingKm };
  }
  return { distance, valid, estimate };
});
