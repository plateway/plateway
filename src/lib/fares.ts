import type { Coords, Leg } from './types';

/**
 * What public transport between jobs is likely to cost.
 *
 * Buses use the Government's single fare cap for England outside London,
 * which is a published rule. Trains have no free source of real ticket prices,
 * so they are a rough guide from distance and are always shown as a range.
 */

export type FareLine = {
  label: string;
  low: number;
  high: number;
  /** "cap" is a published maximum; "guide" is a rough estimate. */
  basis: 'cap' | 'guide';
};

export type FareEstimate = {
  low: number;
  high: number;
  lines: FareLine[];
  /** Parts of the trip with no estimate, such as a ferry. */
  missing: string[];
};

/**
 * Single bus fare cap, England outside London, participating services.
 * Source: Department for Transport statement and press release, 22 July 2026.
 */
export const BUS_CAPS: { from: string; to: string; fare: number }[] = [
  { from: '2025-01-01', to: '2026-12-31', fare: 3 },
  { from: '2027-01-01', to: '2027-12-31', fare: 2 },
];

/** The capped bus single on a date (YYYY-MM-DD), or null when no cap is known for that date. */
export function busCap(date: string): number | null {
  return BUS_CAPS.find((c) => date >= c.from && date <= c.to)?.fare ?? null;
}

/**
 * Rough guide for a walk-up train single: pounds per mile, low to high.
 * A rule of thumb, not fares data. Real prices vary widely by route and time.
 */
export const TRAIN_PER_MILE = { low: 0.3, high: 0.65 };
const TRAIN_MINIMUM = { low: 3, high: 5 };
/** Rough guide for one metro or tram ride. */
const METRO_RIDE = { low: 2, high: 5 };

function pathMiles(coords: Coords): number {
  let metres = 0;
  for (let i = 1; i < coords.length; i++) {
    const [aLon, aLat] = coords[i - 1];
    const [bLon, bLat] = coords[i];
    const k = Math.cos((aLat * Math.PI) / 180);
    metres += Math.hypot((aLon - bLon) * k, aLat - bLat) * 111_320;
  }
  return metres / 1609.344;
}

/** Fares for one public transport leg. Undefined for legs with nothing to pay. */
export function estimateFare(leg: Leg, date: string, inEngland: boolean): FareEstimate | undefined {
  if (leg.kind !== 'transit' || !leg.parts) return undefined;
  const lines: FareLine[] = [];
  const missing: string[] = [];
  // Trains ridden one after another are one through ticket, so they are priced together.
  let train: { names: string[]; miles: number } | null = null;
  const closeTrain = () => {
    if (!train) return;
    lines.push({
      label: `Train (${train.names.join(', ')})`,
      low: Math.floor(Math.max(TRAIN_MINIMUM.low, train.miles * TRAIN_PER_MILE.low)),
      high: Math.ceil(Math.max(TRAIN_MINIMUM.high, train.miles * TRAIN_PER_MILE.high)),
      basis: 'guide',
    });
    train = null;
  };

  for (const part of leg.parts) {
    if (part.mode === 'WALK') continue;
    if (part.mode === 'RAIL') {
      train ??= { names: [], miles: 0 };
      if (!train.names.includes(part.label)) train.names.push(part.label);
      train.miles += pathMiles(part.coords);
      continue;
    }
    closeTrain();
    if (part.mode === 'BUS') {
      const cap = inEngland ? busCap(date) : null;
      if (cap == null) missing.push(part.label);
      else lines.push({ label: part.label, low: cap, high: cap, basis: 'cap' });
    } else if (part.mode === 'METRO' || part.mode === 'TRAM') {
      lines.push({ label: part.label, ...METRO_RIDE, basis: 'guide' });
    } else {
      missing.push(part.label);
    }
  }
  closeTrain();
  if (!lines.length && !missing.length) return undefined;
  return { low: lines.reduce((s, l) => s + l.low, 0), high: lines.reduce((s, l) => s + l.high, 0), lines, missing };
}

/** Adds up the fares for a whole day. */
export function sumFares(fares: (FareEstimate | undefined)[]): FareEstimate | undefined {
  const real = fares.filter((f): f is FareEstimate => !!f);
  if (!real.length) return undefined;
  return { low: real.reduce((s, f) => s + f.low, 0), high: real.reduce((s, f) => s + f.high, 0), lines: real.flatMap((f) => f.lines), missing: real.flatMap((f) => f.missing) };
}

const pounds = (n: number) => (Number.isInteger(n) ? `£${n}` : `£${n.toFixed(2)}`);

/** "up to £6" when every part is a capped fare, "about £16 to £32" when any part is a guide. */
export function fareText(f: { low: number; high: number; lines: FareLine[] }): string {
  if (!f.lines.length) return 'not estimated';
  if (f.lines.every((l) => l.basis === 'cap')) return `up to ${pounds(f.high)}`;
  return f.low === f.high ? `about ${pounds(f.high)}` : `about ${pounds(f.low)} to ${pounds(f.high)}`;
}
