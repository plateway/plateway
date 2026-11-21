import { getJson, ServiceError } from './http';
import type { Coords, LatLon, TransitMode, TransitPart } from './types';

/** Transitous: a free, community-run public transport router covering UK bus and rail. */
const API = 'https://api.transitous.org/api/v5/plan';

type ApiLeg = {
  mode: string;
  from: { name: string };
  to: { name: string };
  startTime: string;
  endTime: string;
  routeShortName?: string;
  agencyName?: string;
  headsign?: string;
  legGeometry?: { points: string; precision?: number };
};
type ApiItinerary = { startTime: string; endTime: string; duration: number; legs: ApiLeg[] };
type ApiPlan = { itineraries?: ApiItinerary[]; direct?: ApiItinerary[] };

export type TransitTrip = { start: number; end: number; parts: TransitPart[]; walkOnly: boolean };

export function decodePolyline(str: string, precision: number): Coords {
  const factor = 10 ** precision;
  const out: Coords = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  while (i < str.length) {
    for (let k = 0; k < 2; k++) {
      let shift = 0;
      let result = 0;
      let b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 31) << shift;
        shift += 5;
      } while (b >= 32);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += delta;
      else lon += delta;
    }
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

const RAIL = new Set(['RAIL', 'REGIONAL_RAIL', 'REGIONAL_FAST_RAIL', 'LONG_DISTANCE', 'HIGHSPEED_RAIL', 'NIGHT_RAIL', 'SUBURBAN']);
const SHORT_NAMES: Record<string, string> = { 'TransPennine Express': 'TPE', 'London North Eastern Railway': 'LNER', 'Tyne and Wear Metro': 'Metro' };

function modeOf(m: string): TransitMode {
  if (m === 'WALK') return 'WALK';
  if (m === 'BUS' || m === 'COACH') return 'BUS';
  if (RAIL.has(m)) return 'RAIL';
  if (m === 'METRO' || m === 'SUBWAY') return 'METRO';
  if (m === 'TRAM') return 'TRAM';
  if (m === 'FERRY') return 'FERRY';
  return 'OTHER';
}

function labelOf(leg: ApiLeg, mode: TransitMode): string {
  const agency = leg.agencyName ? (SHORT_NAMES[leg.agencyName] ?? leg.agencyName) : '';
  const line = leg.routeShortName ?? '';
  switch (mode) {
    case 'WALK':
      return 'Walk';
    case 'BUS':
      return line ? `Bus ${line}` : 'Bus';
    case 'RAIL':
      return agency || 'Train';
    case 'METRO':
      return agency || 'Metro';
    case 'TRAM':
      return line ? `Tram ${line}` : 'Tram';
    case 'FERRY':
      return 'Ferry';
    default:
      return agency || line || 'Other';
  }
}

function toTrip(it: ApiItinerary): TransitTrip {
  const parts = it.legs.map((leg): TransitPart => {
    const mode = modeOf(leg.mode);
    return {
      mode,
      label: labelOf(leg, mode),
      from: leg.from.name,
      to: leg.to.name,
      start: Date.parse(leg.startTime),
      end: Date.parse(leg.endTime),
      headsign: leg.headsign,
      coords: leg.legGeometry?.points ? decodePolyline(leg.legGeometry.points, leg.legGeometry.precision ?? 6) : [],
    };
  });
  return { start: Date.parse(it.startTime), end: Date.parse(it.endTime), parts, walkOnly: parts.every((p) => p.mode === 'WALK') };
}

/** Picks the trip that arrives first. A walk only competes when it is under 45 minutes. */
export function pickTrip(plan: ApiPlan): TransitTrip | null {
  const rides = (plan.itineraries ?? []).map(toTrip);
  const walks = (plan.direct ?? []).map(toTrip);
  const shortWalks = walks.filter((w) => w.end - w.start <= 45 * 60_000);
  const pool = rides.length ? [...rides, ...shortWalks] : walks;
  if (!pool.length) return null;
  return pool.reduce((best, t) => (t.end < best.end ? t : best));
}

/** Earliest-arriving public transport trip leaving at or after `departMs`. Null when nothing was found. */
export async function transitTrip(from: LatLon, to: LatLon, departMs: number): Promise<TransitTrip | null> {
  const q = new URLSearchParams({
    fromPlace: `${from.lat.toFixed(5)},${from.lon.toFixed(5)}`,
    toPlace: `${to.lat.toFixed(5)},${to.lon.toFixed(5)}`,
    time: new Date(departMs).toISOString().replace(/\.\d+Z$/, 'Z'),
    directModes: 'WALK',
    maxDirectTime: '3600',
    searchWindow: '3600',
  });
  let plan: ApiPlan;
  try {
    plan = await getJson<ApiPlan>(`${API}?${q}`, undefined, { timeoutMs: 40_000 });
  } catch {
    throw new ServiceError('transit', 'Could not reach the public transport service. Check your connection and try again.');
  }
  return pickTrip(plan);
}
