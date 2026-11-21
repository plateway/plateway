import { describe, expect, it } from 'vitest';
import { busCap, estimateFare, fareText, sumFares } from './fares';
import { navLink } from './links';
import { readBackup } from './backup';
import { DEFAULT_RATES, money, payFor, totals, weekStart } from './pay';
import { isSketch } from '../mapData';
import { allPostcodeOptions, chooseStops, pageFromText, parseJobSheets, postcodeOptions, type SheetPage } from './parseJobs';
import { pageFromBoxes } from './ocrPage';
import { bestJobOrder, planDriver, type DriverServices } from './planDriver';
import { planLift, solveLift } from './planLift';
import { normPostcode } from './postcodes';
import { fmtDate, fmtDur, fmtTime, londonToEpoch } from './time';
import { decodePolyline, pickTrip } from './transit';
import type { Job, LatLon, Leg, Place, TransitPart } from './types';

describe('time', () => {
  it('treats entered times as UK time, winter and summer', () => {
    expect(new Date(londonToEpoch('2026-11-23', '07:30')).toISOString()).toBe('2026-11-23T07:30:00.000Z');
    expect(new Date(londonToEpoch('2026-07-01', '07:30')).toISOString()).toBe('2026-07-01T06:30:00.000Z');
    expect(fmtTime(londonToEpoch('2026-07-01', '07:30'))).toBe('07:30');
  });
  it('formats', () => {
    expect(fmtDur(44)).toBe('44 min');
    expect(fmtDur(84)).toBe('1h 24m');
    expect(fmtDate('2026-11-23')).toBe('Mon 23 Nov');
  });
});

describe('postcodes', () => {
  it('normalises and rejects', () => {
    expect(normPostcode('ts38at')).toBe('TS3 8AT');
    expect(normPostcode(' ne37  3ht ')).toBe('NE37 3HT');
    expect(normPostcode('AB12CDE')).toBeNull();
    expect(normPostcode('hello')).toBeNull();
  });
  it('offers repairs for look-alike characters, as read first', () => {
    expect(postcodeOptions('TS17', 'OEY')[0]).toBe('TS17 0EY');
    expect(postcodeOptions('WE6', '1FL')).toEqual(expect.arrayContaining(['WE6 1FL', 'WF6 1FL']));
    expect(postcodeOptions('WE6', '1FL')[0]).toBe('WE6 1FL');
    expect(postcodeOptions('WES', '1FL')).toContain('WF6 1FL');
    expect(postcodeOptions('WEG', '1FL')).toContain('WF6 1FL');
    expect(postcodeOptions('TS15', '92S')[0]).toBe('TS15 9ZS');
  });
});

describe('transit', () => {
  it('decodes a polyline', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });
  it('picks the earliest arrival and ignores long walks when a ride exists', () => {
    const it0 = (start: string, end: string, mode: string) => ({ startTime: start, endTime: end, duration: 0, legs: [{ mode, from: { name: 'a' }, to: { name: 'b' }, startTime: start, endTime: end }] });
    const ride = it0('2026-11-23T09:10:00Z', '2026-11-23T10:00:00Z', 'BUS');
    const longWalk = it0('2026-11-23T09:00:00Z', '2026-11-23T09:55:00Z', 'WALK');
    const shortWalk = it0('2026-11-23T09:00:00Z', '2026-11-23T09:20:00Z', 'WALK');
    expect(pickTrip({ itineraries: [ride], direct: [longWalk] })?.walkOnly).toBe(false);
    expect(pickTrip({ itineraries: [ride], direct: [shortWalk] })?.walkOnly).toBe(true);
    expect(pickTrip({ itineraries: [], direct: [longWalk] })?.walkOnly).toBe(true);
    expect(pickTrip({})).toBeNull();
  });
});

describe('job order', () => {
  it('finds the order with least travel between jobs and keeps the carryover last', () => {
    // Job 0 ends next to job 2's collection; job 1 is far from everything.
    const costs = {
      fromStart: [10, 50, 40],
      between: [
        [0, 60, 5],
        [30, 0, 30],
        [60, 20, 0],
      ],
      toHome: [40, 10, 40],
      last: null,
    };
    expect(bestJobOrder(costs)).toEqual({ order: [0, 2, 1], checked: 6 });
    expect(bestJobOrder({ ...costs, last: 0 }).order).toEqual([2, 1, 0]);
  });
});

/* A straight-line world: places on a grid, one minute and one km per grid unit. */
const P = (postcode: string, x: number, y: number): Place => ({ postcode, lat: y, lon: x });
const dist = (a: LatLon, b: LatLon) => Math.abs(a.lat - b.lat) + Math.abs(a.lon - b.lon);
const fake: DriverServices = {
  roadTable: async (pts) => ({ secs: pts.map((a) => pts.map((b) => dist(a, b) * 60)), metres: pts.map((a) => pts.map((b) => dist(a, b) * 1000)) }),
  roadRoute: async (pts) => pts.slice(1).map((b, i) => ({ secs: dist(pts[i], b) * 60, metres: dist(pts[i], b) * 1000, coords: [[pts[i].lon, pts[i].lat], [b.lon, b.lat]] })),
  transitTrip: async (a, b, t) => ({ start: t + 5 * 60_000, end: t + 5 * 60_000 + dist(a, b) * 2 * 60_000, walkOnly: false, parts: [] }),
};
const job = (id: string, collect: string, deliver: string, carryover = false): Job => ({ id, ref: id, collect, deliver, carryover });

describe('driver plan', () => {
  const places = { S: P('S', 0, 0), A: P('A', 10, 0), B: P('B', 10, 30), C: P('C', 12, 0), D: P('D', 40, 0) };
  const leaveMs = londonToEpoch('2026-11-23', '07:00');
  const base = { start: places.S, home: places.S, leaveMs, places, autoOrder: true, handoverMin: 15 };

  it('plans a lift day: lift legs between jobs and a lift home', async () => {
    const plan = await planDriver({ ...base, mode: 'lift', jobs: [job('1', 'A', 'B')] }, fake);
    expect(plan.legs.map((l) => l.kind)).toEqual(['lift', 'job', 'lift']);
    // 10 min lift, 15 handover, 30 drive, 15 handover, 40 lift home.
    expect(fmtTime(plan.finish)).toBe('08:50');
    expect(plan.legs[2].toHome).toBe(true);
    expect(Math.round(plan.jobMins)).toBe(30);
  });

  it('plans a solo day on public transport, waiting for the first departure', async () => {
    const plan = await planDriver({ ...base, mode: 'solo', jobs: [job('1', 'A', 'B')] }, fake);
    expect(plan.legs.map((l) => l.kind)).toEqual(['transit', 'job', 'transit']);
    expect(fmtTime(plan.legs[0].start)).toBe('07:05');
    expect(fmtTime(plan.legs[1].start)).toBe('07:40');
  });

  it('drives a carryover home and ends the day there', async () => {
    const plan = await planDriver({ ...base, mode: 'lift', jobs: [job('1', 'A', '', true), job('2', 'C', 'D')] }, fake);
    expect(plan.order).toEqual(['2', '1']);
    const last = plan.legs[plan.legs.length - 1];
    expect(last.kind).toBe('job');
    expect(last.to.postcode).toBe('S');
    expect(last.carryover).toBe(true);
  });

  it('falls back to the road when no public transport is found, and says so', async () => {
    const plan = await planDriver({ ...base, mode: 'solo', jobs: [job('1', 'A', 'B')] }, { ...fake, transitTrip: async () => null });
    expect(plan.legs[0].kind).toBe('unknown');
    expect(plan.warnings.join(' ')).toMatch(/No public transport/);
  });

  it('skips the leg when the next collection is where the driver already is', async () => {
    const plan = await planDriver({ ...base, mode: 'lift', autoOrder: false, jobs: [job('1', 'S', 'A'), job('2', 'A', 'S')] }, fake);
    expect(plan.legs.map((l) => l.kind)).toEqual(['job', 'job']);
  });
});

describe('lift run', () => {
  it('drops both drivers, then collects them, rather than waiting on one', () => {
    // Points: 0 start, 1 and 2 collections close together, 3 the shared delivery an hour away.
    const secs = [
      [0, 600, 900, 4200],
      [600, 0, 300, 3600],
      [900, 300, 0, 3600],
      [4200, 3600, 3600, 0],
    ];
    const sol = solveLift({
      secs,
      start: 0,
      drivers: [{ jobs: [{ c: 1, d: 3, driveSecs: 3600 }] }, { jobs: [{ c: 2, d: 3, driveSecs: 3600 }] }],
      handoverSecs: 900,
      stopSecs: 120,
      returnToStart: true,
      keepJobOrder: false,
    });
    expect(sol.proven).toBe(true);
    expect(sol.actions.map((a) => `${a.kind}${a.driver}`)).toEqual(['drop0', 'drop1', 'pick0', 'pick1']);
    expect(sol.returns).toBe(true);
  });

  it('does not come back for a driver on a carryover', async () => {
    const places = { S: P('S', 0, 0), A: P('A', 10, 0), B: P('B', 10, 30), C: P('C', 20, 0) };
    const plan = await planLift(
      {
        start: places.S,
        leaveMs: londonToEpoch('2026-11-23', '07:00'),
        places,
        handoverMin: 15,
        returnToStart: false,
        keepJobOrder: false,
        drivers: [
          { id: 'd1', callSign: 'AA111', name: '', jobs: [job('1', 'A', 'B'), job('2', 'C', '', true)] },
          { id: 'd2', callSign: 'BB222', name: '', jobs: [job('3', 'C', '', true)] },
        ],
      },
      fake,
    );
    expect(plan.stops.map((s) => s.kind)).toEqual(['start', 'drop', 'drop', 'pick', 'drop']);
    expect(plan.stops[plan.stops.length - 1].onBoard).toEqual([]);
    const lane = plan.lanes[0];
    expect(lane.jobs.map((j) => j.carryover)).toEqual([false, true]);
    expect(lane.finish).toBeLessThan(plan.finish + 16 * 60_000);
  });
});

describe('job sheet reading', () => {
  const exists = () => true;

  it('reads a pasted multi-job sheet', () => {
    const text = `Driver Work and StartTimes for 17/11/2026
Note: Full details of your Job will be on your EVO Device.
Job # Registration Description Collection From Deliver To Distance (miles)
ZZ999
Sam Sample ( Your Start Time is --:--:-- )
Job1 12000001 "ON EVO" "ON EVO" TS3 8AT Example Auctions Ltd ( 74.0
Unit 1-2
WF6 1FL
Lift from :ALEX - 07000000000
Job Number :12000001/1
TelePOD Ref 158000000 TelePOD to 01210000000 J12000001/1
Job2 12000002 TS17 0EY NE37 3HT
Job3 12000003 TS15 9ZS NE37 3HT`;
    const sheet = parseJobSheets([pageFromText(text)]);
    expect(sheet.date).toBe('2026-11-17');
    expect(sheet.callSign).toBe('ZZ999');
    expect(sheet.driverName).toBe('Sam Sample');
    expect(sheet.jobs.map((j) => j.ref)).toEqual(['12000001', '12000002', '12000003']);
    expect(chooseStops(sheet.jobs[0], exists)).toMatchObject({ collect: 'TS3 8AT', deliver: 'WF6 1FL' });
    expect(chooseStops(sheet.jobs[2], exists)).toMatchObject({ collect: 'TS15 9ZS', deliver: 'NE37 3HT' });
    expect(sheet.jobs[0].liftFrom).toBe('ALEX');
    expect(sheet.jobs.map((j) => j.miles)).toEqual([74, undefined, undefined]);
    expect(sheet.jobs[0].inspection).toBeUndefined();
  });

  it('reads a single timed job with a registration, ignoring look-alike codes', () => {
    const text = `Driver Work and StartTimes for 18/11/2026
16:00:00 12000004 AB12CDE VOLVO EX40 34 Example Drive Example Hub 35.0
TS5 5QG Yard 1
NE37 3HT`;
    const sheet = parseJobSheets([pageFromText(text)]);
    expect(sheet.jobs).toHaveLength(1);
    expect(sheet.jobs[0]).toMatchObject({ ref: '12000004', reg: 'AB12CDE', startTime: '16:00', miles: 35 });
    expect(chooseStops(sheet.jobs[0], exists)).toEqual({ collect: 'TS5 5QG', deliver: 'NE37 3HT', reg: 'AB12CDE' });
  });

  it('uses the column a postcode sits under when the delivery is read first', () => {
    const page: SheetPage = {
      words: [
        { text: 'Collection', line: 0, x: 0.4 },
        { text: 'From', line: 0, x: 0.47 },
        { text: 'Deliver', line: 0, x: 0.6 },
        { text: 'To', line: 0, x: 0.66 },
        { text: 'Distance', line: 0, x: 0.8 },
        { text: '09:00:00', line: 1, x: 0.05 },
        { text: '12000005', line: 1, x: 0.15 },
        { text: 'NE37', line: 1, x: 0.6 },
        { text: '3HT', line: 1, x: 0.65 },
        { text: 'TS5', line: 2, x: 0.4 },
        { text: '5QG', line: 2, x: 0.44 },
      ],
    };
    const sheet = parseJobSheets([page]);
    expect(chooseStops(sheet.jobs[0], exists)).toMatchObject({ collect: 'TS5 5QG', deliver: 'NE37 3HT' });
  });

  it('joins a job that runs over two screenshots and merges repeats', () => {
    const first = pageFromText('Job1 12000006 "ON EVO" TS3 8AT Example Auctions\nUnit 1-2');
    const second = pageFromText('Normanton Industrial Estate\nWF6 1FL\nJob2 12000007 TS17 0EY NE37 3HT');
    const overlap = pageFromText('Job2 12000007 TS17 0EY NE37 3HT');
    const sheet = parseJobSheets([first, second, overlap]);
    expect(sheet.jobs).toHaveLength(2);
    expect(chooseStops(sheet.jobs[0], exists)).toMatchObject({ collect: 'TS3 8AT', deliver: 'WF6 1FL' });
  });

  it('drops postcodes that do not exist', () => {
    const sheet = parseJobSheets([pageFromText('Job1 12000008 BMW X5 4DR TS3 8AT WF6 1FL')]);
    expect(chooseStops(sheet.jobs[0], (p) => p === 'TS3 8AT' || p === 'WF6 1FL')).toMatchObject({ collect: 'TS3 8AT', deliver: 'WF6 1FL' });
  });

  it('repairs postcodes a screenshot reader got slightly wrong', () => {
    const real = new Set(['TS3 8AT', 'WF6 1FL', 'TS17 0EY', 'NE37 3HT']);
    const sheet = parseJobSheets([pageFromText('Job1 12000009 "ON EVO" TS3 8AT Example Auctions\nWE6 1FL\nJob2 12000010 TS17OEY NE37 3HT')]);
    expect(allPostcodeOptions(sheet)).toEqual(expect.arrayContaining(['WF6 1FL', 'TS17 0EY']));
    expect(chooseStops(sheet.jobs[0], (p) => real.has(p))).toMatchObject({ collect: 'TS3 8AT', deliver: 'WF6 1FL' });
    const z = parseJobSheets([pageFromText('Job3 12000012 TS15 92S NE37 3HT')]);
    expect(chooseStops(z.jobs[0], (p) => p === 'TS15 9ZS' || p === 'NE37 3HT')).toMatchObject({ collect: 'TS15 9ZS', deliver: 'NE37 3HT' });
    // "TS17OEY" also looks like a registration, so it must not be reported as one.
    expect(chooseStops(sheet.jobs[1], (p) => real.has(p))).toEqual({ collect: 'TS17 0EY', deliver: 'NE37 3HT', reg: undefined });
  });

  it('rebuilds table rows from loose word boxes', () => {
    const page = pageFromBoxes(
      [
        { text: 'NE37', x0: 600, y0: 101, x1: 650, y1: 119 },
        { text: 'Job2', x0: 50, y0: 100, x1: 90, y1: 118 },
        { text: '3HT', x0: 655, y0: 100, x1: 690, y1: 118 },
        { text: '12000011', x0: 120, y0: 102, x1: 200, y1: 120 },
        { text: 'Job3', x0: 50, y0: 140, x1: 90, y1: 158 },
      ],
      1000,
    );
    expect(page.words.map((w) => `${w.line}:${w.text}`)).toEqual(['0:Job2', '0:12000011', '0:NE37', '0:3HT', '1:Job3']);
  });
});

describe('pay', () => {
  const j = (extra: Partial<Job>): Job => ({ id: 'x', ref: '', collect: 'A', deliver: 'B', carryover: false, ...extra });

  it('matches a real job: 221 miles paid £52.20', () => {
    const real = payFor(j({ sheetMiles: 221 }), DEFAULT_RATES);
    expect(real.total).toBe(52.2);
    expect(real.lines).toEqual([
      { label: 'Move', amount: 20 },
      { label: '161 mi over 60', amount: 32.2 },
    ]);
  });

  it('pays £20 up to sixty miles, then 20p for each mile over', () => {
    expect(payFor(j({ sheetMiles: 35 }), DEFAULT_RATES).total).toBe(20);
    expect(payFor(j({ sheetMiles: 60 }), DEFAULT_RATES).total).toBe(20);
    expect(payFor(j({ sheetMiles: 74 }), DEFAULT_RATES).total).toBe(22.8);
  });

  it('adds the inspection and any other amount', () => {
    expect(payFor(j({ sheetMiles: 74, inspection: true }), DEFAULT_RATES).total).toBe(30.8);
    expect(payFor(j({ sheetMiles: 30, inspection: true, extraPay: 5 }), DEFAULT_RATES).total).toBe(33);
  });

  it('uses typed miles over sheet miles over road miles', () => {
    expect(payFor(j({ roadMiles: 80 }), DEFAULT_RATES).total).toBe(24);
    expect(payFor(j({ roadMiles: 80, sheetMiles: 70 }), DEFAULT_RATES).total).toBe(22);
    expect(payFor(j({ roadMiles: 80, sheetMiles: 70, paidMiles: 100 }), DEFAULT_RATES).total).toBe(28);
    expect(payFor(j({}), DEFAULT_RATES)).toMatchObject({ total: 20, waiting: 'miles' });
  });

  it('pays a failed job what the driver was offered, and nothing until they say', () => {
    expect(payFor(j({ status: 'failed', sheetMiles: 74 }), DEFAULT_RATES)).toMatchObject({ total: 0, waiting: 'failed-amount' });
    expect(payFor(j({ status: 'failed', failedPay: 25, inspection: true }), DEFAULT_RATES).total).toBe(25);
  });

  it('does not pay a carryover until it is delivered', () => {
    expect(payFor(j({ carryover: true, sheetMiles: 221 }), DEFAULT_RATES)).toMatchObject({ total: 0, waiting: 'carryover' });
  });

  it('follows changed rates', () => {
    const rates = { ...DEFAULT_RATES, perMove: 25, includedMiles: 50, perMileAfter: 0.1, inspection: 10 };
    expect(payFor(j({ sheetMiles: 74, inspection: true }), rates).total).toBe(37.4);
  });

  it('adds up a week', () => {
    const week = [j({ sheetMiles: 74, status: 'done' }), j({ sheetMiles: 30, status: 'done', inspection: true }), j({ status: 'failed', failedPay: 15 }), j({ sheetMiles: 40 })];
    expect(totals(week, DEFAULT_RATES)).toEqual({ jobs: 4, done: 2, failed: 1, todo: 1, earned: 65.8, toCome: 20, miles: 104 });
  });

  it('keeps the rate a job was settled at when rates change later', () => {
    const settled = j({ sheetMiles: 221, status: 'done', rates: DEFAULT_RATES });
    const raised = { ...DEFAULT_RATES, perMove: 25, perMileAfter: 0.3 };
    expect(payFor(settled, raised).total).toBe(52.2);
    expect(payFor(j({ sheetMiles: 221 }), raised).total).toBe(73.3);
  });

  it('formats money and finds the Monday of a week', () => {
    expect(money(21.4)).toBe('£21.40');
    expect(money(-5)).toBe('-£5.00');
    expect(weekStart('2026-11-20')).toBe('2026-11-16');
    expect(weekStart('2026-11-22')).toBe('2026-11-16');
    expect(weekStart('2026-11-23')).toBe('2026-11-23');
  });
});

describe('fares', () => {
  const part = (mode: TransitPart['mode'], label: string, miles = 0): TransitPart => ({ mode, label, from: 'a', to: 'b', start: 0, end: 0, coords: [[0, 54], [0, 54 + miles / 69.17]] });
  const leg = (parts: TransitPart[]): Leg => ({ id: 'g', kind: 'transit', from: P('A', 0, 0), to: P('B', 0, 0), start: 0, end: 0, miles: 0, mins: 0, coords: [], parts });

  it('follows the published bus fare cap by date', () => {
    expect(busCap('2026-11-23')).toBe(3);
    expect(busCap('2026-12-31')).toBe(3);
    expect(busCap('2027-01-01')).toBe(2);
    expect(busCap('2027-12-31')).toBe(2);
    expect(busCap('2028-01-01')).toBeNull();
  });

  it('prices each bus at the cap and says "up to"', () => {
    const f = estimateFare(leg([part('WALK', 'Walk'), part('BUS', 'Bus 4'), part('WALK', 'Walk'), part('BUS', 'Bus 15')]), '2026-11-23', true);
    expect(f).toMatchObject({ low: 6, high: 6, missing: [] });
    expect(fareText(f!)).toBe('up to £6');
    expect(estimateFare(leg([part('BUS', 'Bus 4')]), '2027-02-01', true)?.high).toBe(2);
  });

  it('prices trains ridden back to back as one ticket, as a range', () => {
    const f = estimateFare(leg([part('BUS', 'Bus 157'), part('RAIL', 'Northern', 9.9), part('WALK', 'Walk'), part('RAIL', 'TPE', 49.9), part('BUS', 'Bus 15')]), '2026-11-23', true)!;
    expect(f.lines.map((l) => l.label)).toEqual(['Bus 157', 'Train (Northern, TPE)', 'Bus 15']);
    // Just under 60 miles of train at 30p to 65p a mile (£17 to £39), plus two £3 buses.
    expect(f).toMatchObject({ low: 23, high: 45 });
    expect(fareText(f)).toBe('about £23 to £45');
  });

  it('never prices a short train below a minimum fare', () => {
    const f = estimateFare(leg([part('RAIL', 'Northern', 2)]), '2026-11-23', true)!;
    expect(f).toMatchObject({ low: 3, high: 5 });
  });

  it('gives no bus fare outside England or once no cap is known, and says what is missing', () => {
    expect(estimateFare(leg([part('BUS', 'Bus 4')]), '2026-11-23', false)).toMatchObject({ low: 0, high: 0, lines: [], missing: ['Bus 4'] });
    expect(estimateFare(leg([part('BUS', 'Bus 4')]), '2028-03-01', true)?.missing).toEqual(['Bus 4']);
    expect(estimateFare(leg([part('FERRY', 'Ferry')]), '2026-11-23', true)?.missing).toEqual(['Ferry']);
  });

  it('has nothing to say about a walk, a lift or a drive', () => {
    expect(estimateFare(leg([part('WALK', 'Walk')]), '2026-11-23', true)).toBeUndefined();
    expect(estimateFare({ ...leg([]), kind: 'lift', parts: undefined }, '2026-11-23', true)).toBeUndefined();
    expect(sumFares([undefined, undefined])).toBeUndefined();
  });
});

describe('backup', () => {
  const good = { app: 'plateway', version: 1, savedAt: '2026-11-20T20:00:00Z', jobs: [{ id: 'a', ref: '1', collect: 'TS3 8AT', deliver: 'WF6 1FL', carryover: false }], rates: DEFAULT_RATES };
  it('reads a good backup', () => {
    expect(readBackup(JSON.stringify(good))).toMatchObject({ jobs: [{ id: 'a' }] });
  });
  it('refuses anything else with a plain reason', () => {
    expect(readBackup('not json')).toBe("That file isn't a Plateway backup.");
    expect(readBackup(JSON.stringify({ hello: 1 }))).toBe("That file isn't a Plateway backup.");
    expect(readBackup(JSON.stringify({ ...good, version: 9 }))).toMatch(/newer version/);
    expect(readBackup(JSON.stringify({ ...good, jobs: [{ nope: true }] }))).toMatch(/damaged/);
  });
});

describe('map lines', () => {
  it('spots a train line that is only straight hops between stations', () => {
    expect(isSketch([[-1.08, 53.96], [-1.55, 54.52], [-1.23, 54.58]])).toBe(true);
    const road: [number, number][] = Array.from({ length: 200 }, (_, i) => [-1.2 - i * 0.0005, 54.5 + i * 0.0005]);
    expect(isSketch(road)).toBe(false);
  });
});

describe('map links', () => {
  const to: Place = { postcode: 'NE37 3HT', lat: 54.923578, lon: -1.514865 };
  it('builds links for each app', () => {
    expect(navLink('google', to)).toBe('https://www.google.com/maps/dir/?api=1&destination=NE37+3HT&travelmode=driving');
    expect(navLink('google', to, { by: 'transit' })).toContain('travelmode=transit');
    expect(navLink('waze', to)).toBe('https://waze.com/ul?ll=54.923578,-1.514865&navigate=yes');
    expect(navLink('apple', to)).toBe('https://maps.apple.com/?daddr=NE37+3HT&dirflg=d');
  });
});
