import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NavApp } from './lib/links';
import { DEFAULT_RATES, type Rates } from './lib/pay';
import type { Backup } from './lib/backup';
export { readBackup, type Backup } from './lib/backup';
import { todayLondon } from './lib/time';
import type { Job, Place, TeamDriver } from './lib/types';

/** Where a day starts. `place` is kept when it came from GPS, so it works without a postcode. */
export type StartPoint = { postcode: string; place: Place | null };

export type DriverDay = {
  /** The day being planned. */
  date: string;
  leaveAt: string;
  start: StartPoint;
  homeSame: boolean;
  home: StartPoint;
  mode: 'solo' | 'lift';
  /** Every job the driver has entered, on any day. Each carries its own `date`. */
  jobs: Job[];
  autoOrder: boolean;
};

export type LiftDay = {
  date: string;
  leaveAt: string;
  start: StartPoint;
  drivers: TeamDriver[];
  returnToStart: boolean;
  keepJobOrder: boolean;
};

export type Role = 'driver' | 'lift';
export type View = 'setup' | 'result' | 'history';

type State = {
  role: Role;
  /** False until the person has picked who they are, and again after they tap Switch. */
  chosen: boolean;
  view: View;
  driver: DriverDay;
  lift: LiftDay;
  handoverMin: number;
  navApp: NavApp | null;
  rates: Rates;
  chooseRole: (role: Role) => void;
  switchRole: () => void;
  setView: (view: View) => void;
  setDriver: (patch: Partial<Omit<DriverDay, 'jobs'>>) => void;
  setLift: (patch: Partial<LiftDay>) => void;
  setNavApp: (app: NavApp) => void;
  setRates: (rates: Rates) => void;
  /** Replaces one day's jobs, in the order given, leaving other days alone. */
  setDayJobs: (date: string, jobs: Job[]) => void;
  /** Adds jobs to a day, replacing any job on that day with the same job number. */
  addDriverJobs: (date: string, jobs: Job[]) => void;
  updateJob: (id: string, patch: Partial<Job>) => void;
  /** Marks a job done, failed or still to do, keeping the rate it was settled at. */
  setStatus: (id: string, status: Job['status']) => void;
  /** Removes a job and returns what is needed to put it back. */
  removeJob: (id: string) => (() => void) | undefined;
  /** Replaces the plate driver's jobs and rates with a backup. */
  restoreBackup: (backup: Backup) => void;
  addTeamJobs: (driverId: string, jobs: Job[], who?: { callSign?: string; name?: string }) => void;
  /**
   * Moves a day left on a past date to today, so the planner opens fresh each morning.
   * Days planned ahead are left alone. The lift team is kept, but last time's jobs are cleared.
   * Returns null when nothing changed, else what changed and how to undo it.
   */
  startNewDay: (today: string) => { liftJobsCleared: number; driverJobsBefore: number; undo: () => void } | null;
};

const emptyStart = (): StartPoint => ({ postcode: '', place: null });

export const uid = () => Math.random().toString(36).slice(2, 10);

export function makeBackup(): Backup {
  const s = useStore.getState();
  return { app: 'plateway', version: 1, savedAt: new Date().toISOString(), jobs: s.driver.jobs, rates: s.rates, liftDrivers: s.lift.drivers };
}

export const DRIVER_COLOURS = ['#D9480F', '#7B2CBF', '#0B7285', '#A61E4D', '#5C7C00', '#495057'];

function mergeJobs(existing: Job[], incoming: Job[]): Job[] {
  const out = [...existing];
  for (const job of incoming) {
    const at = job.ref ? out.findIndex((j) => j.ref === job.ref) : -1;
    // Reading a sheet again must not wipe what the driver has since recorded about the job.
    if (at >= 0) out[at] = { ...out[at], ...job, id: out[at].id, status: out[at].status, failedPay: out[at].failedPay, paidMiles: out[at].paidMiles, extraPay: out[at].extraPay, roadMiles: out[at].roadMiles };
    else out.push(job);
  }
  return out;
}

const STORE_KEY = 'plateway.v1';
// Saved data used to live under an older name. Move it across once so nobody loses their jobs.
try {
  const OLD_KEY = ['bc', 'argo.planner.v1'].join('');
  const old = localStorage.getItem(OLD_KEY);
  if (old && !localStorage.getItem(STORE_KEY)) localStorage.setItem(STORE_KEY, old);
  if (old) localStorage.removeItem(OLD_KEY);
} catch {
  /* storage blocked: nothing to move */
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      role: 'driver',
      chosen: false,
      view: 'setup',
      driver: { date: todayLondon(), leaveAt: '07:00', start: emptyStart(), homeSame: true, home: emptyStart(), mode: 'solo', jobs: [], autoOrder: true },
      lift: { date: todayLondon(), leaveAt: '07:00', start: emptyStart(), drivers: [], returnToStart: true, keepJobOrder: false },
      handoverMin: 15,
      navApp: null,
      rates: DEFAULT_RATES,
      chooseRole: (role) => set({ role, chosen: true, view: 'setup' }),
      switchRole: () => set({ chosen: false, view: 'setup' }),
      setView: (view) => set({ view }),
      setDriver: (patch) => set((s) => ({ driver: { ...s.driver, ...patch } })),
      setLift: (patch) => set((s) => ({ lift: { ...s.lift, ...patch } })),
      setNavApp: (navApp) => set({ navApp }),
      setRates: (rates) => set({ rates }),
      setDayJobs: (date, jobs) =>
        set((s) => ({ driver: { ...s.driver, jobs: [...s.driver.jobs.filter((j) => j.date !== date), ...jobs.map((j) => ({ ...j, date }))] } })),
      addDriverJobs: (date, jobs) =>
        set((s) => {
          const others = s.driver.jobs.filter((j) => j.date !== date);
          const sameDay = s.driver.jobs.filter((j) => j.date === date);
          return { driver: { ...s.driver, jobs: [...others, ...mergeJobs(sameDay, jobs.map((j) => ({ ...j, date })))] } };
        }),
      setStatus: (id, status) => set((s) => ({ driver: { ...s.driver, jobs: s.driver.jobs.map((j) => (j.id === id ? { ...j, status, rates: status ? (j.rates ?? s.rates) : undefined } : j)) } })),
      restoreBackup: (b) => set((s) => ({ driver: { ...s.driver, jobs: b.jobs }, rates: b.rates, lift: b.liftDrivers ? { ...s.lift, drivers: b.liftDrivers } : s.lift })),
      updateJob: (id, patch) => set((s) => ({ driver: { ...s.driver, jobs: s.driver.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) } })),
      removeJob: (id) => {
        const before = get().driver.jobs;
        const gone = before.find((j) => j.id === id);
        if (!gone) return undefined;
        set((s) => ({
          driver: {
            ...s.driver,
            // Removing a delivery puts its carryover back on offer.
            jobs: s.driver.jobs.filter((j) => j.id !== id).map((j) => (gone.carriedFrom && j.id === gone.carriedFrom ? { ...j, deliveredOn: undefined } : j)),
          },
        }));
        // Undo puts back exactly what was there, in the same place.
        return () => set((s) => ({ driver: { ...s.driver, jobs: before.map((j) => s.driver.jobs.find((x) => x.id === j.id) ?? j).concat(s.driver.jobs.filter((x) => !before.some((j) => j.id === x.id))) } }));
      },
      startNewDay: (today) => {
        const { driver, lift, view } = get();
        const driverOld = driver.date < today;
        const liftOld = lift.date < today;
        if (!driverOld && !liftOld) return null;
        const liftJobsCleared = liftOld ? lift.drivers.reduce((n, d) => n + d.jobs.length, 0) : 0;
        set((s) => ({
          driver: driverOld ? { ...s.driver, date: today } : s.driver,
          lift: liftOld ? { ...s.lift, date: today, drivers: s.lift.drivers.map((d) => ({ ...d, jobs: [], ownWayHome: false })) } : s.lift,
          view: view === 'result' ? 'setup' : view,
        }));
        return {
          liftJobsCleared,
          driverJobsBefore: driverOld ? driver.jobs.filter((j) => j.date === driver.date).length : 0,
          undo: () => set((s) => ({ driver: driverOld ? { ...s.driver, date: driver.date } : s.driver, lift: liftOld ? lift : s.lift })),
        };
      },
      addTeamJobs: (driverId, jobs, who) =>
        set((s) => ({
          lift: {
            ...s.lift,
            drivers: s.lift.drivers.map((d) =>
              d.id === driverId ? { ...d, callSign: d.callSign || who?.callSign || '', name: d.name || who?.name || '', jobs: mergeJobs(d.jobs, jobs) } : d,
            ),
          },
        })),
    }),
    {
      name: STORE_KEY,
      version: 2,
      // Before version 1 jobs had no day of their own: they belonged to whichever day was on screen.
      migrate: (stored, version) => {
        const s = stored as Partial<State>;
        if (version < 1 && s.driver) s.driver = { ...s.driver, jobs: (s.driver.jobs ?? []).map((j) => ({ ...j, date: j.date ?? s.driver!.date })) };
        // Version 1 shipped with 10p a mile by mistake; the real rate is 20p. Keep any rate the driver set themselves.
        if (version < 2 && s.rates && s.rates.perMileAfter === 0.1) s.rates = { ...s.rates, perMileAfter: 0.2 };
        return s as State;
      },
      partialize: (s) => ({ role: s.role, chosen: s.chosen, driver: s.driver, lift: s.lift, handoverMin: s.handoverMin, navApp: s.navApp, rates: s.rates }),
    },
  ),
);

/** The driver's day with only that day's jobs, which is what planning works on. */
export function dayOf(driver: DriverDay): DriverDay {
  return { ...driver, jobs: driver.jobs.filter((j) => j.date === driver.date) };
}
