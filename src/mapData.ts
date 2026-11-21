import type { MapLine, MapPin } from './components/MapView';
import type { Coords, DriverPlan, Leg, LiftPlan, Place, TeamDriver, TransitMode } from './lib/types';

export const INK = '#0B0B0B';
export const BLUE = '#276EF1';
export const ORANGE = '#D9480F';
export const GREY = '#6B6B6B';
export const GREEN = '#06C167';

export const TRANSIT_COLOUR: Record<TransitMode, string> = { WALK: GREY, BUS: ORANGE, RAIL: BLUE, METRO: '#7B2CBF', TRAM: '#7B2CBF', FERRY: '#0B7285', OTHER: '#0B7285' };

/** Metres between two points, near enough for judging how detailed a line is. */
function metres(a: [number, number], b: [number, number]): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111_320;
}

/**
 * True when a line is only a few points over a long distance: straight hops
 * between stations rather than the real track. Timetable data has no track
 * shape for many UK trains.
 */
export function isSketch(coords: Coords): boolean {
  if (coords.length < 2) return false;
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += metres(coords[i - 1], coords[i]);
  return total / (coords.length - 1) > 1500;
}

export function legCoords(leg: Leg): Coords {
  return leg.kind === 'transit' ? (leg.parts ?? []).flatMap((p) => p.coords) : leg.coords;
}

/** Pins that share a spot are merged into one, so "D2" and "D3" at the same yard read "D2·D3". */
function mergePins(pins: MapPin[]): MapPin[] {
  const out: MapPin[] = [];
  for (const p of pins) {
    const same = out.find((o) => Math.abs(o.lat - p.lat) < 1e-5 && Math.abs(o.lon - p.lon) < 1e-5);
    if (same) {
      same.label += `·${p.label}`;
      same.title += `, ${p.title}`;
      same.solid = same.solid || p.solid;
    } else out.push({ ...p });
  }
  return out;
}

export function driverMap(plan: DriverPlan, start: Place, selected: string | null): { lines: MapLine[]; pins: MapPin[] } {
  const lines: MapLine[] = [];
  for (const leg of plan.legs) {
    const dim = selected != null && selected !== leg.id;
    if (leg.kind === 'job') lines.push({ id: leg.id, coords: leg.coords, color: INK, width: 4.5, order: 3, dim });
    // The lift line is wider than the job line so both show where they share a road.
    else if (leg.kind === 'lift') lines.push({ id: leg.id, coords: leg.coords, color: BLUE, width: 9, order: 1, dim });
    else if (leg.kind === 'unknown') lines.push({ id: leg.id, coords: leg.coords, color: GREY, width: 4, order: 1, dim });
    else {
      (leg.parts ?? []).forEach((part, i) => {
        lines.push({ id: `${leg.id}-${i}`, coords: part.coords, color: TRANSIT_COLOUR[part.mode], width: part.mode === 'WALK' ? 4 : 4.5, dotted: part.mode === 'WALK', dashed: part.mode !== 'WALK' && isSketch(part.coords), order: 2, dim });
      });
    }
  }
  const pins: MapPin[] = [{ id: 'start', lon: start.lon, lat: start.lat, label: 'S', title: 'Start', color: GREEN, solid: true }];
  for (const leg of plan.legs) {
    if (leg.kind !== 'job') continue;
    pins.push({ id: `c-${leg.id}`, lon: leg.from.lon, lat: leg.from.lat, label: `C${leg.jobNo}`, title: `Collect job ${leg.jobNo}` });
    pins.push(
      leg.carryover
        ? { id: `d-${leg.id}`, lon: leg.to.lon, lat: leg.to.lat, label: 'H', title: `Home with job ${leg.jobNo}`, color: GREEN, solid: true }
        : { id: `d-${leg.id}`, lon: leg.to.lon, lat: leg.to.lat, label: `D${leg.jobNo}`, title: `Deliver job ${leg.jobNo}`, solid: true },
    );
  }
  const last = plan.legs[plan.legs.length - 1];
  if (last?.toHome && last.kind !== 'job') pins.push({ id: 'home', lon: last.to.lon, lat: last.to.lat, label: 'H', title: 'Home', color: GREEN, solid: true });
  return { lines, pins: mergePins(pins) };
}

export function liftMap(plan: LiftPlan, drivers: TeamDriver[], colours: Record<string, string>, showJobs: boolean, selected: string | null): { lines: MapLine[]; pins: MapPin[] } {
  const lines: MapLine[] = plan.stops
    .filter((s) => s.coords.length > 1)
    .map((s) => ({ id: s.id, coords: s.coords, color: BLUE, width: 6, order: 1, dim: showJobs || (selected != null && selected !== s.id) }));
  if (showJobs) {
    for (const lane of plan.lanes) {
      for (const j of lane.jobs) {
        if (j.coords.length > 1) lines.push({ id: `job-${j.jobId}`, coords: j.coords, color: colours[lane.driverId] ?? INK, width: 4.5, order: 2, dim: selected != null && selected !== lane.driverId });
      }
    }
  }
  const sign = (id?: string) => {
    const d = drivers.find((x) => x.id === id);
    return d?.callSign || d?.name || 'driver';
  };
  const pins: MapPin[] = [{ id: 'start', lon: plan.stops[0].place.lon, lat: plan.stops[0].place.lat, label: 'S', title: 'Start', color: GREEN, solid: true }];
  plan.stops.forEach((s, n) => {
    if (s.kind === 'start' || s.kind === 'end') return;
    pins.push({ id: s.id, lon: s.place.lon, lat: s.place.lat, label: String(n), title: `Stop ${n}: ${s.kind === 'pick' ? 'pick up' : 'drop'} ${sign(s.driverId)}`, color: colours[s.driverId ?? ''] ?? INK, solid: s.kind === 'pick' });
  });
  return { lines, pins: mergePins(pins) };
}
