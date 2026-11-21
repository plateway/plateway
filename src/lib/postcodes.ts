import { getJson, ServiceError } from './http';
import type { Place } from './types';

const API = 'https://api.postcodes.io';
const SHAPE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;

/** Finds UK postcodes inside free text. Does not match inside longer codes such as registrations. */
export const POSTCODE_IN_TEXT = /(?<![A-Za-z0-9])([A-Za-z]{1,2}\d[A-Za-z\d]?)[ \t]*(\d[A-Za-z]{2})(?![A-Za-z0-9])/g;

/** "ts38at" becomes "TS3 8AT". Returns null when the text is not shaped like a postcode. */
export function normPostcode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!SHAPE.test(s)) return null;
  return `${s.slice(0, -3)} ${s.slice(-3)}`;
}

type ApiPostcode = {
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  admin_district?: string | null;
  admin_ward?: string | null;
  country?: string | null;
  parish?: string | null;
};

const known = new Map<string, Place | null>();
const STORE_KEY = 'plateway.postcodes.v1';

function loadStored() {
  if (typeof localStorage === 'undefined' || known.size) return;
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, Place>;
    for (const [k, v] of Object.entries(raw)) known.set(k, v);
  } catch {
    /* a corrupt cache is not worth failing over */
  }
}

function saveStored() {
  if (typeof localStorage === 'undefined') return;
  const out: Record<string, Place> = {};
  for (const [k, v] of known) if (v) out[k] = v;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
  } catch {
    /* storage full or blocked: the lookup still worked */
  }
}

function toPlace(r: ApiPostcode): Place | null {
  if (r.latitude == null || r.longitude == null) return null;
  return { postcode: r.postcode, lat: r.latitude, lon: r.longitude, area: r.admin_district ?? r.parish ?? undefined, country: r.country ?? undefined };
}

/**
 * Looks up postcodes. The result has an entry for every valid-looking input:
 * a Place, or null when the postcode does not exist.
 */
export async function lookupPostcodes(input: string[]): Promise<Record<string, Place | null>> {
  loadStored();
  const wanted = [...new Set(input.map(normPostcode).filter((p): p is string => !!p))];
  const missing = wanted.filter((p) => !known.has(p));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    let data: { result: { query: string; result: ApiPostcode | null }[] };
    try {
      data = await getJson(`${API}/postcodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: batch }),
      });
    } catch {
      throw new ServiceError('postcodes', 'Could not reach the postcode lookup. Check your connection and try again.');
    }
    for (const row of data.result) {
      const pc = normPostcode(row.query);
      if (pc) known.set(pc, row.result ? toPlace(row.result) : null);
    }
  }
  // Postcodes that were retired still have a location on record.
  for (const pc of missing.filter((p) => known.get(p) === null)) {
    try {
      const t = await getJson<{ result: ApiPostcode | null }>(`${API}/terminated_postcodes/${encodeURIComponent(pc)}`, undefined, { retries: 0 });
      if (t.result) known.set(pc, toPlace({ ...t.result, postcode: pc }));
    } catch {
      /* not a retired postcode either */
    }
  }
  if (missing.length) saveStored();
  const out: Record<string, Place | null> = {};
  for (const p of wanted) out[p] = known.get(p) ?? null;
  return out;
}

/** Nearest postcode to a GPS position. */
export async function nearestPostcode(lat: number, lon: number): Promise<Place | null> {
  try {
    const data = await getJson<{ result: ApiPostcode[] | null }>(`${API}/postcodes?lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}&limit=1&radius=2000`);
    const first = data.result?.[0];
    return first ? toPlace(first) : null;
  } catch {
    throw new ServiceError('postcodes', 'Could not reach the postcode lookup. Check your connection and try again.');
  }
}
