import type { Place } from './types';

export type NavApp = 'google' | 'waze' | 'apple';
export type TravelBy = 'drive' | 'transit' | 'walk';

export const NAV_APPS: { id: NavApp; name: string }[] = [
  { id: 'google', name: 'Google Maps' },
  { id: 'waze', name: 'Waze' },
  { id: 'apple', name: 'Apple Maps' },
];

const spot = (p: Place) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
/** A postcode reads better in the other app's search box; coordinates are the fallback for GPS starts. */
const named = (p: Place) => p.postcode || spot(p);

/**
 * A link that opens turn-by-turn directions in another maps app.
 * With no `from`, the app starts from wherever the phone is.
 */
export function navLink(app: NavApp, to: Place, opts: { from?: Place; by?: TravelBy; via?: Place[] } = {}): string {
  const by = opts.by ?? 'drive';
  if (app === 'waze') {
    // Waze only does driving, to one destination.
    return `https://waze.com/ul?ll=${spot(to)}&navigate=yes`;
  }
  if (app === 'apple') {
    const q = new URLSearchParams({ daddr: named(to), dirflg: by === 'transit' ? 'r' : by === 'walk' ? 'w' : 'd' });
    if (opts.from) q.set('saddr', named(opts.from));
    return `https://maps.apple.com/?${q}`;
  }
  const q = new URLSearchParams({ api: '1', destination: named(to), travelmode: by === 'transit' ? 'transit' : by === 'walk' ? 'walking' : 'driving' });
  if (opts.from) q.set('origin', named(opts.from));
  // Google accepts up to nine stops on the way.
  if (opts.via?.length && by === 'drive') q.set('waypoints', opts.via.slice(0, 9).map(named).join('|'));
  return `https://www.google.com/maps/dir/?${q}`;
}
