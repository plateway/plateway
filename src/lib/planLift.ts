import { roadRoute, roadTable, type RoadLeg, type RoadTable } from './osrm';
import { metresToMiles, MIN } from './time';
import type { DriverLane, LaneJob, LaneSegment, LatLon, LiftPlan, LiftStop, Place, TeamDriver } from './types';

/* ---------- the search ---------- */

export type LiftModel = {
  /** Drive time in seconds between every pair of points. */
  secs: number[][];
  /** Point index the lift car starts from, with every driver on board. */
  start: number;
  drivers: {
    /** `d` is null for a carryover: the driver keeps the car, so there is no pick-up. */
    jobs: { c: number; d: number | null; driveSecs: number }[];
    /** No pick-up after this driver's last job: they make their own way home. */
    ownWayHome?: boolean;
  }[];
  handoverSecs: number;
  /** Time the lift car spends stopped to let a driver out or in. */
  stopSecs: number;
  returnToStart: boolean;
  /** When true each driver's jobs are done in the order entered. */
  keepJobOrder: boolean;
  maxNodes?: number;
};

export type LiftAction = {
  kind: 'drop' | 'pick';
  driver: number;
  job: number;
  arrive: number;
  depart: number;
  /** When the driver reaches the delivery point and is free to be picked up. */
  ready: number;
  carWait: number;
  driverWait: number;
};

export type LiftSolution = {
  actions: LiftAction[];
  /** Seconds from leaving until the lift car's day is done. */
  finish: number;
  returns: boolean;
  proven: boolean;
  nodes: number;
};

/** How much one second of a driver standing waiting counts against one second of the whole run. */
const WAIT_WEIGHT = 0.25;

/**
 * Orders the lift car's drops and pick-ups. Tries every sensible order,
 * skipping any that cannot beat the best found so far.
 */
export function solveLift(m: LiftModel): LiftSolution {
  const n = m.drivers.length;
  const maxNodes = m.maxNodes ?? 400_000;
  const remaining = m.drivers.map((d) => (1 << d.jobs.length) - 1);
  const away: ({ job: number; ready: number; point: number } | null)[] = new Array(n).fill(null);
  const endsInCar = m.drivers.map((d) => !d.ownWayHome && d.jobs.length > 0 && d.jobs.every((j) => j.d != null));
  const returns = m.returnToStart || endsInCar.some(Boolean);

  let best = null as LiftAction[] | null;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestFinish = 0;
  let nodes = 0;
  let cutShort = false;
  const path: LiftAction[] = [];

  const isLastJob = (d: number, j: number) => remaining[d] === 1 << j;

  const walk = (pos: number, t: number, waited: number) => {
    if (++nodes > maxNodes) {
      cutShort = true;
      return;
    }
    // Earliest the run could possibly end from here.
    let bound = t;
    let pending = false;
    const options: LiftAction[] = [];
    for (let d = 0; d < n; d++) {
      const a = away[d];
      if (a) {
        pending = true;
        const arrive = t + m.secs[pos][a.point];
        bound = Math.max(bound, arrive, a.ready);
        options.push({
          kind: 'pick',
          driver: d,
          job: a.job,
          arrive,
          ready: a.ready,
          carWait: Math.max(0, a.ready - arrive),
          driverWait: Math.max(0, arrive - a.ready),
          depart: Math.max(arrive, a.ready) + m.stopSecs,
        });
        continue;
      }
      if (!remaining[d]) continue;
      pending = true;
      const jobs = m.drivers[d].jobs;
      let firstOnly = m.keepJobOrder;
      for (let j = 0; j < jobs.length; j++) {
        if (!(remaining[d] & (1 << j))) continue;
        const job = jobs[j];
        const arrive = t + m.secs[pos][job.c];
        bound = Math.max(bound, arrive);
        const allowed = job.d != null || isLastJob(d, j);
        if (allowed && (!m.keepJobOrder || firstOnly)) {
          options.push({
            kind: 'drop',
            driver: d,
            job: j,
            arrive,
            depart: arrive + m.stopSecs,
            ready: arrive + m.handoverSecs + job.driveSecs + (job.d != null ? m.handoverSecs : 0),
            carWait: 0,
            driverWait: 0,
          });
        }
        firstOnly = false;
      }
    }

    if (!pending) {
      const finish = t + (returns ? m.secs[pos][m.start] : 0);
      const cost = finish + WAIT_WEIGHT * waited;
      if (cost < bestCost) {
        bestCost = cost;
        bestFinish = finish;
        best = [...path];
      }
      return;
    }
    if (bound + WAIT_WEIGHT * waited >= bestCost) return;

    options.sort((a, b) => a.depart - b.depart);
    for (const o of options) {
      const d = o.driver;
      const job = m.drivers[d].jobs[o.job];
      path.push(o);
      if (o.kind === 'drop') {
        const goesHomeAlone = !!m.drivers[d].ownWayHome && isLastJob(d, o.job);
        remaining[d] &= ~(1 << o.job);
        if (job.d != null && !goesHomeAlone) away[d] = { job: o.job, ready: o.ready, point: job.d };
        walk(job.c, o.depart, waited);
        away[d] = null;
        remaining[d] |= 1 << o.job;
      } else {
        const was = away[d];
        away[d] = null;
        walk(job.d as number, o.depart, waited + o.driverWait);
        away[d] = was;
      }
      path.pop();
      if (cutShort) return;
    }
  };

  walk(m.start, 0, 0);
  return { actions: best ?? [], finish: bestFinish, returns, proven: !cutShort, nodes };
}

/* ---------- the plan around the search ---------- */

export type LiftInput = {
  start: Place;
  leaveMs: number;
  drivers: TeamDriver[];
  places: Record<string, Place | null | undefined>;
  handoverMin: number;
  returnToStart: boolean;
  keepJobOrder: boolean;
};

export type LiftServices = {
  roadTable: (points: LatLon[]) => Promise<RoadTable>;
  roadRoute: (points: LatLon[]) => Promise<RoadLeg[]>;
};

const live: LiftServices = { roadTable, roadRoute };
const STOP_SECS = 120;

export async function planLift(input: LiftInput, services: LiftServices = live): Promise<LiftPlan> {
  const warnings: string[] = [];
  const team = input.drivers.filter((d) => d.jobs.length > 0);
  if (!team.length) throw new Error('Add a driver with at least one job to plan the run.');

  const points: Place[] = [input.start];
  const indexOf = (p: Place) => {
    const i = points.findIndex((q) => q.lat === p.lat && q.lon === p.lon);
    if (i >= 0) return i;
    points.push(p);
    return points.length - 1;
  };

  const resolved = team.map((driver) => {
    // A carryover is always the driver's last job.
    const jobs = [...driver.jobs.filter((j) => !j.carryover), ...driver.jobs.filter((j) => j.carryover)];
    if (jobs.filter((j) => j.carryover).length > 1) {
      warnings.push(`${driver.callSign || driver.name || 'A driver'} has more than one carryover. Only one car can go home with them.`);
    }
    return {
      driver,
      jobs: jobs.map((job) => {
        const c = input.places[job.collect];
        const d = job.carryover ? null : input.places[job.deliver];
        if (!c || (!job.carryover && !d)) throw new Error(`Job ${job.ref || job.collect} has a postcode that could not be found.`);
        return { job, c, d: d ?? null, ci: indexOf(c), di: d ? indexOf(d) : null };
      }),
    };
  });

  const table = await services.roadTable(points);
  const handoverSecs = input.handoverMin * 60;
  const solution = solveLift({
    secs: table.secs,
    start: 0,
    drivers: resolved.map((r) => ({ ownWayHome: !!r.driver.ownWayHome, jobs: r.jobs.map((j) => ({ c: j.ci, d: j.di, driveSecs: j.di == null ? 0 : table.secs[j.ci][j.di] })) })),
    handoverSecs,
    stopSecs: STOP_SECS,
    returnToStart: input.returnToStart,
    keepJobOrder: input.keepJobOrder,
  });
  if (!solution.proven) warnings.push('This is a big run, so the order shown is a good one but may not be the very shortest.');

  // Road geometry: one request for the lift car, one for all the job drives.
  const carPoints: Place[] = [input.start, ...solution.actions.map((a) => {
    const j = resolved[a.driver].jobs[a.job];
    return a.kind === 'drop' ? j.c : (j.d as Place);
  })];
  if (solution.returns) carPoints.push(input.start);
  const carLegs = carPoints.length > 1 ? await services.roadRoute(carPoints) : [];
  const driven = resolved.flatMap((r, di) => r.jobs.map((j, ji) => ({ di, ji, j })).filter((x) => x.j.d));
  const jobLegs = driven.length ? await services.roadRoute(driven.flatMap((x) => [x.j.c, x.j.d as Place])) : [];
  const jobRoad = new Map<string, RoadLeg>();
  driven.forEach((x, i) => jobRoad.set(`${x.di}:${x.ji}`, jobLegs[i * 2]));

  const at = (secs: number) => input.leaveMs + secs * 1000;
  const onBoard = new Set(resolved.map((r) => r.driver.id));
  const stops: LiftStop[] = [
    { id: 'start', kind: 'start', place: input.start, arrive: input.leaveMs, depart: input.leaveMs, carWaitMin: 0, driverWaitMin: 0, onBoard: [...onBoard], miles: 0, mins: 0, coords: [] },
  ];
  const laneJobs: LaneJob[][] = resolved.map(() => []);
  const jobCount = resolved.map(() => 0);

  solution.actions.forEach((a, i) => {
    const r = resolved[a.driver];
    const j = r.jobs[a.job];
    const leg = carLegs[i];
    if (a.kind === 'drop') onBoard.delete(r.driver.id);
    else onBoard.add(r.driver.id);
    stops.push({
      id: `${a.kind}-${j.job.id}`,
      kind: a.kind,
      driverId: r.driver.id,
      jobId: j.job.id,
      place: a.kind === 'drop' ? j.c : (j.d as Place),
      arrive: at(a.arrive),
      depart: at(a.depart),
      carWaitMin: a.carWait / 60,
      driverWaitMin: a.driverWait / 60,
      onBoard: [...onBoard],
      miles: metresToMiles(leg.metres),
      mins: leg.secs / 60,
      coords: leg.coords,
    });
    if (a.kind === 'drop') {
      const road = jobRoad.get(`${a.driver}:${a.job}`);
      const setOff = a.arrive + handoverSecs;
      const driveSecs = road ? table.secs[j.ci][j.di as number] : 0;
      laneJobs[a.driver].push({
        jobId: j.job.id,
        jobNo: ++jobCount[a.driver],
        carryover: j.job.carryover,
        from: j.c,
        to: j.d,
        droppedAt: at(a.arrive),
        setOffAt: at(setOff),
        arriveAt: at(setOff + driveSecs),
        readyAt: at(a.ready),
        pickedAt: null,
        ownWay: false,
        miles: road ? metresToMiles(road.metres) : 0,
        mins: driveSecs / 60,
        coords: road?.coords ?? [],
      });
    } else {
      const lj = laneJobs[a.driver].find((x) => x.jobId === j.job.id);
      if (lj) lj.pickedAt = at(Math.max(a.arrive, a.ready));
    }
  });

  // A delivered job nobody came back for is the last job of a driver going home on their own.
  for (const lane of laneJobs) for (const lj of lane) lj.ownWay = !lj.carryover && lj.pickedAt == null;

  const finish = at(solution.finish);
  if (solution.returns) {
    const leg = carLegs[carLegs.length - 1];
    stops.push({ id: 'end', kind: 'end', place: input.start, arrive: finish, depart: finish, carWaitMin: 0, driverWaitMin: 0, onBoard: [...onBoard], miles: metresToMiles(leg.metres), mins: leg.secs / 60, coords: leg.coords });
  }

  const lanes: DriverLane[] = resolved.map((r, di) => {
    const segments: LaneSegment[] = [];
    let cursor = input.leaveMs;
    let waitMin = 0;
    let end = finish;
    for (const lj of laneJobs[di]) {
      segments.push({ kind: 'car', start: cursor, end: lj.droppedAt });
      segments.push({ kind: 'handover', start: lj.droppedAt, end: lj.setOffAt, jobId: lj.jobId });
      if (lj.carryover) {
        cursor = lj.setOffAt;
        end = lj.setOffAt;
        continue;
      }
      segments.push({ kind: 'job', start: lj.setOffAt, end: lj.arriveAt, jobId: lj.jobId });
      segments.push({ kind: 'handover', start: lj.arriveAt, end: lj.readyAt, jobId: lj.jobId });
      if (lj.ownWay) {
        cursor = lj.readyAt;
        end = lj.readyAt;
        continue;
      }
      const picked = lj.pickedAt ?? lj.readyAt;
      if (picked > lj.readyAt) {
        segments.push({ kind: 'wait', start: lj.readyAt, end: picked, jobId: lj.jobId });
        waitMin += (picked - lj.readyAt) / MIN;
      }
      cursor = picked;
      end = finish;
    }
    if (end === finish && cursor < finish) segments.push({ kind: 'car', start: cursor, end: finish });
    return { driverId: r.driver.id, segments: segments.filter((s) => s.end > s.start), jobs: laneJobs[di], finish: end, waitMin };
  });

  return {
    stops,
    lanes,
    leave: input.leaveMs,
    finish,
    carMiles: stops.reduce((s, x) => s + x.miles, 0),
    carDriveMins: stops.reduce((s, x) => s + x.mins, 0),
    carWaitMin: stops.reduce((s, x) => s + x.carWaitMin, 0),
    driverWaitMin: lanes.reduce((s, l) => s + l.waitMin, 0),
    proven: solution.proven,
    warnings,
  };
}
