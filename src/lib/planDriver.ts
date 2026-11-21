import { estimateFare, sumFares } from './fares';
import { roadRoute, roadTable, type RoadLeg, type RoadTable } from './osrm';
import { metresToMiles, MIN, todayLondon } from './time';
import { transitTrip, type TransitTrip } from './transit';
import type { DriverPlan, Job, LatLon, Leg, Place } from './types';

export type DriverInput = {
  start: Place;
  /** Where a carryover car goes, and where the day ends. */
  home: Place;
  mode: 'solo' | 'lift';
  leaveMs: number;
  jobs: Job[];
  places: Record<string, Place | null | undefined>;
  /** When false the jobs are planned in the order given. */
  autoOrder: boolean;
  handoverMin: number;
};

export type DriverServices = {
  roadTable: (points: LatLon[]) => Promise<RoadTable>;
  roadRoute: (points: LatLon[]) => Promise<RoadLeg[]>;
  transitTrip: (from: LatLon, to: LatLon, departMs: number) => Promise<TransitTrip | null>;
};

const live: DriverServices = { roadTable, roadRoute, transitTrip };

/** Places closer than this are treated as the same spot, so no leg is drawn between them. */
const SAME_PLACE_METRES = 150;
/** Above this many jobs every order cannot be tried, so a nearest-next order is used. */
const MAX_EXHAUSTIVE = 8;

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));

export type OrderCosts = {
  /** Start to the collection of job i. */
  fromStart: number[];
  /** Delivery of job i to the collection of job j. */
  between: number[][];
  /** Delivery of job i to home. Use 0 for a carryover, which already ends at home. */
  toHome: number[];
  /** Index of the job that must come last (the carryover), or null. */
  last: number | null;
};

/** Finds the job order with the least travel between jobs. */
export function bestJobOrder(c: OrderCosts): { order: number[]; checked: number } {
  const n = c.fromStart.length;
  const free = [...Array(n).keys()].filter((i) => i !== c.last);
  const finish = (order: number[], cost: number) => {
    let prev = order[order.length - 1];
    let total = cost;
    if (c.last != null) {
      total += prev == null ? c.fromStart[c.last] : c.between[prev][c.last];
      prev = c.last;
    }
    return total + (prev == null ? 0 : c.toHome[prev]);
  };

  if (free.length > MAX_EXHAUSTIVE) {
    const order: number[] = [];
    const left = new Set(free);
    while (left.size) {
      const prev = order[order.length - 1];
      let pick = -1;
      let best = Number.POSITIVE_INFINITY;
      for (const j of left) {
        const step = prev == null ? c.fromStart[j] : c.between[prev][j];
        if (step < best) {
          best = step;
          pick = j;
        }
      }
      order.push(pick);
      left.delete(pick);
    }
    return { order: c.last != null ? [...order, c.last] : order, checked: 0 };
  }

  let bestOrder = free;
  let bestCost = Number.POSITIVE_INFINITY;
  const used = new Array<boolean>(n).fill(false);
  const cur: number[] = [];
  const walk = (cost: number) => {
    if (cost >= bestCost) return;
    if (cur.length === free.length) {
      const total = finish(cur, cost);
      if (total < bestCost) {
        bestCost = total;
        bestOrder = [...cur];
      }
      return;
    }
    for (const j of free) {
      if (used[j]) continue;
      const prev = cur[cur.length - 1];
      used[j] = true;
      cur.push(j);
      walk(cost + (prev == null ? c.fromStart[j] : c.between[prev][j]));
      cur.pop();
      used[j] = false;
    }
  };
  walk(0);
  return { order: c.last != null ? [...bestOrder, c.last] : bestOrder, checked: factorial(free.length) };
}

export async function planDriver(input: DriverInput, services: DriverServices = live): Promise<DriverPlan> {
  const warnings: string[] = [];
  const { start, home } = input;
  const handover = input.handoverMin * MIN;

  const jobs = input.jobs.map((job) => {
    const c = input.places[job.collect];
    const d = job.carryover ? home : input.places[job.deliver];
    if (!c || !d) throw new Error(`Job ${job.ref || job.collect} has a postcode that could not be found.`);
    return { job, c, d };
  });
  if (!jobs.length) throw new Error('Add at least one job to plan the day.');

  const carryovers = jobs.map((j, i) => (j.job.carryover ? i : -1)).filter((i) => i >= 0);
  if (carryovers.length > 1) warnings.push('Only one job can be a carryover. The last one marked is planned as the carryover.');
  const lastIdx = carryovers.length ? carryovers[carryovers.length - 1] : null;

  // Point 0 is the start, 1 is home, then collection and delivery for each job.
  const points: Place[] = [start, home, ...jobs.flatMap((j) => [j.c, j.d])];
  const table = await services.roadTable(points);
  const cIdx = (i: number) => 2 + i * 2;
  const dIdx = (i: number) => 3 + i * 2;

  let order = jobs.map((_, i) => i);
  let ordersChecked = 0;
  if (input.autoOrder) {
    const res = bestJobOrder({
      fromStart: jobs.map((_, i) => table.secs[0][cIdx(i)]),
      between: jobs.map((_, i) => jobs.map((__, j) => table.secs[dIdx(i)][cIdx(j)])),
      toHome: jobs.map((j, i) => (j.job.carryover ? 0 : table.secs[dIdx(i)][1])),
      last: lastIdx,
    });
    order = res.order;
    ordersChecked = res.checked;
  } else if (lastIdx != null && order[order.length - 1] !== lastIdx) {
    order = [...order.filter((i) => i !== lastIdx), lastIdx];
  }

  const seq = order.map((i) => jobs[i]);
  const endsAtHome = seq[seq.length - 1].job.carryover;
  const waypoints: Place[] = [start, ...seq.flatMap((j) => [j.c, j.d]), ...(endsAtHome ? [] : [home])];
  const road = await services.roadRoute(waypoints);

  const legs: Leg[] = [];
  let t = input.leaveMs;

  const gap = async (roadLeg: RoadLeg, from: Place, to: Place, id: string, toHome: boolean) => {
    if (roadLeg.metres < SAME_PLACE_METRES) return;
    const miles = metresToMiles(roadLeg.metres);
    if (input.mode === 'lift') {
      const end = t + roadLeg.secs * 1000;
      legs.push({ id, kind: 'lift', from, to, toHome, start: t, end, miles, mins: roadLeg.secs / 60, coords: roadLeg.coords });
      t = end;
      return;
    }
    const trip = await services.transitTrip(from, to, t);
    if (trip) {
      legs.push({ id, kind: 'transit', from, to, toHome, start: trip.start, end: trip.end, miles, mins: (trip.end - trip.start) / MIN, coords: [], parts: trip.parts });
      t = trip.end;
    } else {
      const end = t + roadLeg.secs * 1000;
      legs.push({ id, kind: 'unknown', from, to, toHome, start: t, end, miles, mins: roadLeg.secs / 60, coords: roadLeg.coords });
      t = end;
    }
  };

  for (let k = 0; k < seq.length; k++) {
    const { job, c, d } = seq[k];
    const from = k === 0 ? start : seq[k - 1].d;
    await gap(road[k * 2], from, c, `gap-${job.id}`, false);
    t += handover;
    const drive = road[k * 2 + 1];
    const end = t + drive.secs * 1000;
    legs.push({
      id: `job-${job.id}`,
      kind: 'job',
      jobId: job.id,
      jobNo: k + 1,
      carryover: job.carryover,
      from: c,
      to: d,
      toHome: job.carryover,
      start: t,
      end,
      miles: metresToMiles(drive.metres),
      mins: drive.secs / 60,
      coords: drive.coords,
    });
    t = end;
    if (!job.carryover) t += handover;
  }
  if (!endsAtHome) await gap(road[road.length - 1], seq[seq.length - 1].d, home, 'gap-home', true);

  // The bus fare cap is for England, so a leg that starts or ends elsewhere is not given one.
  const english = (p: Place) => !p.country || p.country === 'England';
  for (const leg of legs) leg.fare = estimateFare(leg, todayLondon(leg.start), english(leg.from) && english(leg.to));

  const jobLegs = legs.filter((l) => l.kind === 'job');
  const gapLegs = legs.filter((l) => l.kind !== 'job');
  if (gapLegs.some((l) => l.kind === 'unknown')) {
    warnings.push('No public transport was found for part of the day. That part is shown by road, so allow for a taxi or a lift.');
  }
  return {
    mode: input.mode,
    order: seq.map((j) => j.job.id),
    legs,
    leave: input.leaveMs,
    finish: t,
    jobMiles: jobLegs.reduce((s, l) => s + l.miles, 0),
    jobMins: jobLegs.reduce((s, l) => s + l.mins, 0),
    gapMins: gapLegs.reduce((s, l) => s + l.mins, 0),
    gapMiles: gapLegs.reduce((s, l) => s + l.miles, 0),
    ordersChecked,
    warnings,
    fare: sumFares(legs.map((l) => l.fare)),
  };
}
