import { useEffect, useMemo, useState } from 'react';
import { APP_NAME } from './brand';
import { Icon, NavDialog, Segmented, Toast, toast } from './components/bits';
import { AboutDialog } from './components/About';
import { ImportJobs, type ImportResult } from './components/ImportJobs';
import { InstallCard } from './components/InstallCard';
import { MapView } from './components/MapView';
import { resolveStart, useDriverPlan, useIsPhone, useLiftPlan, usePlaces } from './hooks';
import { dayOf } from './store';
import { fmtDate, todayLondon } from './lib/time';
import type { Coords } from './lib/types';
import { driverMap, legCoords, liftMap } from './mapData';
import { DRIVER_COLOURS, useStore } from './store';
import { DriverResult } from './views/DriverResult';
import { DriverSetup } from './views/DriverSetup';
import { History } from './views/History';
import { LiftResult, type LiftTab } from './views/LiftResult';
import { LiftSetup } from './views/LiftSetup';
import { ROLE_NAME, RoleChooser } from './views/RoleChooser';

export function App() {
  const { role, chosen, view, driver: everyDay, lift, handoverMin, switchRole, setView, setDriver, setLift, addDriverJobs, addTeamJobs, updateJob } = useStore();
  // Planning works on the jobs of the day on screen; history keeps every day.
  const driver = useMemo(() => dayOf(everyDay), [everyDay]);
  const phone = useIsPhone();
  const [sheet, setSheet] = useState<'half' | 'full'>('half');
  const [selected, setSelected] = useState<string | null>(null);
  const [liftTab, setLiftTab] = useState<LiftTab>('stops');
  const [importFor, setImportFor] = useState<{ driverId?: string } | null>(null);

  const postcodes = useMemo(
    () => [driver.start.postcode, driver.home.postcode, ...driver.jobs.flatMap((j) => [j.collect, j.deliver]), lift.start.postcode, ...lift.drivers.flatMap((d) => d.jobs.flatMap((j) => [j.collect, j.deliver]))],
    [driver, lift],
  );
  const { places, error: placesError } = usePlaces(postcodes);

  const solo = useDriverPlan(driver, places, 'solo', handoverMin, chosen && role === 'driver');
  const withLift = useDriverPlan(driver, places, 'lift', handoverMin, chosen && role === 'driver');
  const run = useLiftPlan(lift, places, handoverMin, chosen && role === 'lift');
  const dayPlan = driver.mode === 'solo' ? solo : withLift;

  // Remember each job's road miles, so pay can be worked out when no sheet miles are known.
  useEffect(() => {
    for (const leg of dayPlan.plan?.legs ?? []) {
      if (leg.kind !== 'job' || !leg.jobId) continue;
      const job = driver.jobs.find((j) => j.id === leg.jobId);
      const miles = Math.round(leg.miles * 10) / 10;
      if (job && job.roadMiles !== miles) updateJob(job.id, { roadMiles: miles });
    }
  }, [dayPlan.plan]);

  // A planner left on yesterday opens on today, ready for a fresh day. Checked on opening and whenever the app comes back to the front.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      const changed = useStore.getState().startNewDay(todayLondon());
      if (!changed) return;
      const { role: now, liftJobsCleared: cleared, driverJobsBefore: before } = { ...useStore.getState(), ...changed };
      if (now === 'lift' && cleared) toast(`New day. Your drivers are kept; last run's ${cleared === 1 ? 'job was' : `${cleared} jobs were`} cleared.`, { label: 'Undo', run: changed.undo });
      else if (now === 'driver' && before) toast('New day. Earlier jobs are in History and pay.', { label: 'Undo', run: changed.undo });
    };
    check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  const colours = useMemo(() => Object.fromEntries(lift.drivers.map((d, i) => [d.id, DRIVER_COLOURS[i % DRIVER_COLOURS.length]])), [lift.drivers]);
  const driverStart = resolveStart(driver.start, places);

  useEffect(() => setSelected(null), [role, view, driver.mode]);
  useEffect(() => {
    if (view === 'result') setSheet('half');
  }, [view]);

  const map = useMemo(() => {
    if (role === 'driver' && dayPlan.plan && driverStart) return driverMap(dayPlan.plan, driverStart, selected);
    if (role === 'lift' && run.plan) return liftMap(run.plan, lift.drivers, colours, liftTab === 'drivers', selected);
    return { lines: [], pins: [] };
  }, [role, dayPlan.plan, run.plan, driverStart, selected, liftTab, colours, lift.drivers]);

  const focus: Coords | null = useMemo(() => {
    if (!selected) return null;
    if (role === 'driver') {
      const leg = dayPlan.plan?.legs.find((l) => l.id === selected);
      return leg ? legCoords(leg) : null;
    }
    const stop = run.plan?.stops.find((s) => s.id === selected);
    if (stop) return stop.coords.length > 1 ? stop.coords : [[stop.place.lon, stop.place.lat]];
    const lane = run.plan?.lanes.find((l) => l.driverId === selected);
    return lane ? lane.jobs.flatMap((j) => j.coords) : null;
  }, [selected, role, dayPlan.plan, run.plan]);

  const planKey = role === 'driver' ? `${dayPlan.plan?.mode}-${dayPlan.plan?.finish}-${dayPlan.plan?.legs.length}` : `${run.plan?.finish}-${run.plan?.stops.length}`;
  const sheetOpen = phone && view === 'result';
  const padding = sheetOpen ? { top: 84, bottom: Math.round(window.innerHeight * 0.5) + 24, left: 36, right: 36 } : { top: 60, bottom: 60, left: 60, right: 60 };

  const select = (id: string | null) => {
    setSelected(id);
    if (id && phone) setSheet('half');
  };

  const onImported = (res: ImportResult) => {
    if (importFor?.driverId) {
      addTeamJobs(importFor.driverId, res.jobs, { callSign: res.callSign, name: res.name });
      if (res.date) setLift({ date: res.date });
    } else {
      addDriverJobs(res.date ?? driver.date, res.jobs);
      if (res.date) setDriver({ date: res.date });
    }
    toast(`${res.jobs.length} job${res.jobs.length === 1 ? '' : 's'} added`);
  };

  const importDriver = lift.drivers.find((d) => d.id === importFor?.driverId);
  const date = role === 'driver' ? driver.date : lift.date;

  const resultTop = (
    <div className="result-top">
      <button type="button" className="chip-btn solid" onClick={() => setView('setup')}>
        <Icon name="back" size={16} /> {role === 'driver' ? 'Jobs' : 'Team'}
      </button>
      {role === 'driver' ? (
        <Segmented
          label="How you get between jobs"
          value={driver.mode}
          onChange={(mode) => setDriver({ mode })}
          options={[
            { id: 'solo', label: 'Solo' },
            { id: 'lift', label: 'Lift' },
          ]}
        />
      ) : (
        <span className="chip-btn solid static">{fmtDate(date)}</span>
      )}
    </div>
  );

  if (!chosen)
    return (
      <>
        <RoleChooser />
        <AboutDialog />
      </>
    );

  return (
    <div className="app" data-view={view} data-sheet={sheetOpen ? sheet : undefined}>
      <section className="panel" aria-label={view === 'setup' ? 'Plan the day' : view === 'history' ? 'History and pay' : 'The plan'}>
        {sheetOpen && (
          <button type="button" className="grab" aria-label={sheet === 'half' ? 'Show the full plan' : 'Show the map'} onClick={() => setSheet(sheet === 'half' ? 'full' : 'half')}>
            <i />
          </button>
        )}
        {view !== 'result' && (
          <header className="top">
            <span className="brand">{APP_NAME}</span>
            <button type="button" className="role-chip" onClick={switchRole} aria-label={`Planning as ${ROLE_NAME[role]}. Switch`}>
              <b>{ROLE_NAME[role]}</b>
              <span>Switch</span>
            </button>
          </header>
        )}
        {view !== 'result' && role === 'driver' && (
          <nav className="tabs" aria-label="Sections">
            <Segmented
              flat
              wide
              label="Section"
              value={view === 'history' ? 'history' : 'setup'}
              onChange={setView}
              options={[
                { id: 'setup', label: 'Plan' },
                { id: 'history', label: 'History and pay' },
              ]}
            />
          </nav>
        )}
        {view === 'result' && !phone && resultTop}
        {view !== 'result' && <InstallCard />}
        <div className="panel-scroll" key={`${role}-${view}`}>
          {view === 'setup' && role === 'driver' && <DriverSetup places={places} placesError={placesError} solo={solo} lift={withLift} onImport={() => setImportFor({})} />}
          {view === 'setup' && role === 'lift' && <LiftSetup places={places} placesError={placesError} onImport={(driverId) => setImportFor({ driverId })} />}
          {view === 'result' && role === 'driver' && <DriverResult state={dayPlan} jobs={driver.jobs} start={driverStart} selected={selected} onSelect={select} />}
          {view === 'history' && role === 'driver' && <History />}
          {view === 'history' && role === 'lift' && <LiftSetup places={places} placesError={placesError} onImport={(driverId) => setImportFor({ driverId })} />}
          {view === 'result' && role === 'lift' && <LiftResult state={run} drivers={lift.drivers} colours={colours} date={lift.date} tab={liftTab} onTab={setLiftTab} selected={selected} onSelect={select} />}
        </div>
      </section>

      <main className="mapwrap">
        <MapView lines={map.lines} pins={map.pins} fitKey={`${role}|${view}|${planKey}|${phone}|${liftTab}`} focus={focus} padding={padding} />
        {sheetOpen && resultTop}
        {!map.lines.length && view !== 'result' && !phone && <p className="map-msg quiet">Your route will show here once your start and jobs are in.</p>}
      </main>

      <ImportJobs open={!!importFor} showPay={!importFor?.driverId} forWhom={importDriver ? importDriver.callSign || importDriver.name || undefined : undefined} onClose={() => setImportFor(null)} onAdd={onImported} />
      <NavDialog />
      <AboutDialog />
      <Toast />
    </div>
  );
}
