import { getJson, ServiceError } from './http';
import type { Coords, LatLon } from './types';

/**
 * Road routing on OpenStreetMap data. Both hosts run the same free OSRM
 * engine; the second is used when the first is busy or down.
 */
const CAR_HOSTS = ['https://router.project-osrm.org', 'https://routing.openstreetmap.de/routed-car'];

export type RoadLeg = { metres: number; secs: number; coords: Coords };
export type RoadTable = { secs: number[][]; metres: number[][] };

/** Both servers ask for at most one request a second. */
const GAP_MS = 1100;
const nextSlot = new Map<string, number>();
async function turn(host: string) {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + GAP_MS);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

const pts = (points: LatLon[]) => points.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');

async function fromHosts<T extends { code: string }>(path: string): Promise<T> {
  let lastErr: unknown;
  for (const host of CAR_HOSTS) {
    try {
      await turn(host);
      const data = await getJson<T>(host + path, undefined, { retries: 0, timeoutMs: 25_000 });
      if (data.code === 'Ok') return data;
      lastErr = new Error(data.code);
    } catch (err) {
      lastErr = err;
    }
  }
  const code = lastErr instanceof Error ? lastErr.message : '';
  throw new ServiceError(
    'roads',
    code === 'NoRoute' || code === 'NoSegment'
      ? 'No road route was found between two of these places. Check the postcodes.'
      : 'Could not reach the road routing service. Check your connection and try again.',
  );
}

/** Drive time and distance between every pair of points. */
export async function roadTable(points: LatLon[]): Promise<RoadTable> {
  if (points.length < 2) return { secs: [[0]], metres: [[0]] };
  const data = await fromHosts<{ code: string; durations: (number | null)[][]; distances: (number | null)[][] }>(
    `/table/v1/driving/${pts(points)}?annotations=duration,distance`,
  );
  const fill = (rows: (number | null)[][]) => rows.map((r) => r.map((v) => v ?? Number.POSITIVE_INFINITY));
  return { secs: fill(data.durations), metres: fill(data.distances) };
}

type OsrmStep = { geometry: { coordinates: [number, number][] } };
type OsrmRoute = { code: string; routes: { legs: { distance: number; duration: number; steps: OsrmStep[] }[] }[] };

/**
 * Road route through the points in order. Each leg carries the full
 * road geometry, so a line drawn from it stays on the carriageway.
 */
export async function roadRoute(points: LatLon[]): Promise<RoadLeg[]> {
  if (points.length < 2) return [];
  const data = await fromHosts<OsrmRoute>(`/route/v1/driving/${pts(points)}?steps=true&geometries=geojson&overview=false`);
  return data.routes[0].legs.map((leg) => {
    const coords: Coords = [];
    for (const step of leg.steps) {
      for (const c of step.geometry.coordinates) {
        const last = coords[coords.length - 1];
        if (!last || last[0] !== c[0] || last[1] !== c[1]) coords.push([c[0], c[1]]);
      }
    }
    return { metres: leg.distance, secs: leg.duration, coords };
  });
}
