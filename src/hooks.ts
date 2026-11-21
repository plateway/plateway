import { useEffect, useMemo, useRef, useState } from 'react';
import { planDriver } from './lib/planDriver';
import { planLift } from './lib/planLift';
import { lookupPostcodes, normPostcode } from './lib/postcodes';
import { londonToEpoch } from './lib/time';
import type { DriverPlan, LiftPlan, Place } from './lib/types';
import type { DriverDay, LiftDay, StartPoint } from './store';

export type Places = Record<string, Place | null | undefined>;

/**
 * Looks up every postcode on screen. A postcode maps to a Place once found,
 * to null when it does not exist, and is missing while it is being checked.
 */
export function usePlaces(postcodes: string[]): { places: Places; error: string | null } {
  const wanted = useMemo(() => [...new Set(postcodes.map(normPostcode).filter((p): p is string => !!p))].sort(), [postcodes.join('|')]);
  const [places, setPlaces] = useState<Places>({});
  const [error, setError] = useState<string | null>(null);
  const key = wanted.join('|');
  useEffect(() => {
    if (!wanted.length) return;
    let live = true;
    const timer = setTimeout(() => {
      lookupPostcodes(wanted)
        .then((found) => {
          if (!live) return;
          setError(null);
          setPlaces((prev) => ({ ...prev, ...found }));
        })
        .catch((err: Error) => live && setError(err.message));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);
  return { places, error };
}

/** The place a start box points at: its GPS fix, or its postcode once looked up. */
export function resolveStart(start: StartPoint, places: Places): Place | null {
  if (start.place) return start.place;
  const pc = normPostcode(start.postcode);
  return (pc && places[pc]) || null;
}

export type PlanState<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; plan?: T; error?: string; /** When the plan shown was worked out, if it came from the phone's saved copy. */ savedAt?: number };

const SAVED = 'plateway.plans.v1';
const KEEP = 4;
type SavedPlan = { key: string; at: number; plan: unknown };

function loadSaved(key: string): SavedPlan | undefined {
  try {
    return (JSON.parse(localStorage.getItem(SAVED) ?? '[]') as SavedPlan[]).find((p) => p.key === key);
  } catch {
    return undefined;
  }
}

function save(key: string, plan: unknown) {
  try {
    const list = (JSON.parse(localStorage.getItem(SAVED) ?? '[]') as SavedPlan[]).filter((p) => p.key !== key);
    localStorage.setItem(SAVED, JSON.stringify([{ key, at: Date.now(), plan }, ...list].slice(0, KEEP)));
  } catch {
    /* storage full: the plan still shows, it just is not kept */
  }
}

function useAsyncPlan<T>(key: string | null, run: () => Promise<T>): PlanState<T> & { retry: () => void } {
  const [state, setState] = useState<PlanState<T>>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    if (!key) {
      setState({ status: 'idle' });
      return;
    }
    const mine = ++latest.current;
    // Show the saved copy straight away, then refresh it when there is a connection.
    const saved = loadSaved(key);
    setState((s) => (saved ? { status: 'loading', plan: saved.plan as T, savedAt: saved.at } : { status: 'loading', plan: s.plan }));
    const timer = setTimeout(() => {
      run()
        .then((plan) => {
          if (mine !== latest.current) return;
          save(key, plan);
          setState({ status: 'ready', plan });
        })
        .catch((err: Error) => {
          if (mine !== latest.current) return;
          const error = err.message || 'Something went wrong working out the route.';
          setState(saved ? { status: 'ready', plan: saved.plan as T, savedAt: saved.at, error } : { status: 'error', error });
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [key, attempt]);
  return { ...state, retry: () => setAttempt((a) => a + 1) };
}

/** What is still missing before a driver's day can be planned. Null when it is ready. */
export function driverGaps(day: DriverDay, places: Places): string | null {
  if (!resolveStart(day.start, places)) return 'Enter the postcode you are starting from.';
  if (!day.homeSame && !resolveStart(day.home, places)) return 'Enter your home postcode.';
  if (!day.jobs.length) return 'Add at least one job.';
  for (const j of day.jobs) {
    if (!places[j.collect]) return `Check the collection postcode ${j.collect || 'on a job'}.`;
    if (!j.carryover && !places[j.deliver]) return `Check the delivery postcode ${j.deliver || 'on a job'}.`;
  }
  return null;
}

export function useDriverPlan(day: DriverDay, places: Places, mode: 'solo' | 'lift', handoverMin: number, enabled: boolean) {
  const ready = enabled && !driverGaps(day, places);
  const start = resolveStart(day.start, places);
  const home = day.homeSame ? start : resolveStart(day.home, places);
  const key = ready ? JSON.stringify([mode, day.date, day.leaveAt, start, home, day.autoOrder, handoverMin, day.jobs.map((j) => [j.id, j.collect, j.deliver, j.carryover])]) : null;
  return useAsyncPlan<DriverPlan>(key, () =>
    planDriver({
      start: start as Place,
      home: home as Place,
      mode,
      leaveMs: londonToEpoch(day.date, day.leaveAt),
      jobs: day.jobs,
      places,
      autoOrder: day.autoOrder,
      handoverMin,
    }),
  );
}

export function liftGaps(day: LiftDay, places: Places): string | null {
  if (!resolveStart(day.start, places)) return 'Enter the postcode you are starting from.';
  const team = day.drivers.filter((d) => d.jobs.length);
  if (!team.length) return 'Add a driver and their jobs.';
  for (const d of team) {
    for (const j of d.jobs) {
      if (!places[j.collect]) return `Check the collection postcode ${j.collect || 'on a job'}.`;
      if (!j.carryover && !places[j.deliver]) return `Check the delivery postcode ${j.deliver || 'on a job'}.`;
    }
  }
  return null;
}

export function useLiftPlan(day: LiftDay, places: Places, handoverMin: number, enabled: boolean) {
  const ready = enabled && !liftGaps(day, places);
  const start = resolveStart(day.start, places);
  const key = ready
    ? JSON.stringify([day.date, day.leaveAt, start, day.returnToStart, day.keepJobOrder, handoverMin, day.drivers.map((d) => [d.id, d.jobs.map((j) => [j.id, j.collect, j.deliver, j.carryover])])])
    : null;
  return useAsyncPlan<LiftPlan>(key, () =>
    planLift({
      start: start as Place,
      leaveMs: londonToEpoch(day.date, day.leaveAt),
      drivers: day.drivers,
      places,
      handoverMin,
      returnToStart: day.returnToStart,
      keepJobOrder: day.keepJobOrder,
    }),
  );
}

/** True when the map and the panel are stacked: a phone held upright. Must match the phone block in styles.css. */
export function useIsPhone(): boolean {
  const query = '(max-width: 559px), (max-width: 699px) and (orientation: portrait)';
  const [phone, setPhone] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}
