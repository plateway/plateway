import { useState } from 'react';
import { Icon, JobForm, StartField, Toggle, DayAndTime } from '../components/bits';
import { liftGaps, type Places } from '../hooks';
import type { Job, TeamDriver } from '../lib/types';
import { DRIVER_COLOURS, uid, useStore } from '../store';
import { AboutButton } from '../components/About';

type Props = {
  places: Places;
  placesError: string | null;
  onImport: (driverId: string) => void;
};

export function LiftSetup({ places, placesError, onImport }: Props) {
  const day = useStore((s) => s.lift);
  const setLift = useStore((s) => s.setLift);
  const setView = useStore((s) => s.setView);
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const gaps = liftGaps(day, places);
  const jobCount = day.drivers.reduce((s, d) => s + d.jobs.length, 0);
  const patchDriver = (id: string, p: Partial<TeamDriver>) => setLift({ drivers: day.drivers.map((d) => (d.id === id ? { ...d, ...p } : d)) });
  // Only one carryover per driver: they can only take one car home.
  const withJob = (jobs: Job[], job: Job) => {
    const rest = jobs.map((j) => (job.carryover && j.id !== job.id ? { ...j, carryover: false } : j));
    return rest.some((j) => j.id === job.id) ? rest.map((j) => (j.id === job.id ? job : j)) : [...rest, job];
  };

  return (
    <>
      <div className="pad">
        <h1 className="title">Who are you carrying?</h1>
        <p className="muted">
          {day.drivers.length ? `${day.drivers.length} driver${day.drivers.length > 1 ? 's' : ''} · ${jobCount} job${jobCount === 1 ? '' : 's'}` : 'Add each driver and their jobs. The run is planned so everyone gets through their day soonest.'}
        </p>
        <DayAndTime date={day.date} leaveAt={day.leaveAt} onChange={setLift} />
        <StartField label="Start from" value={day.start} onChange={(start) => setLift({ start })} places={places} />
        {placesError && <p className="hint bad">{placesError}</p>}

        <ul className="team">
          {day.drivers.map((d, di) => (
            <li key={d.id} className="drv">
              <div className="drv-h">
                <span className="dot" style={{ background: DRIVER_COLOURS[di % DRIVER_COLOURS.length] }} aria-hidden="true" />
                <label className="inline">
                  <span className="sr">Call sign for driver {di + 1}</span>
                  <input className="sign" value={d.callSign} placeholder="Call sign" maxLength={8} autoCapitalize="characters" spellCheck={false} onChange={(e) => patchDriver(d.id, { callSign: e.target.value.toUpperCase() })} />
                </label>
                <label className="inline grow">
                  <span className="sr">Name for driver {di + 1}</span>
                  <input value={d.name} placeholder="Name (optional)" onChange={(e) => patchDriver(d.id, { name: e.target.value })} />
                </label>
                <button type="button" className="icon-btn small" aria-label={`Remove driver ${d.callSign || di + 1}`} onClick={() => setLift({ drivers: day.drivers.filter((x) => x.id !== d.id) })}>
                  <Icon name="x" size={16} />
                </button>
              </div>

              {d.jobs.map((job, ji) => {
                if (editing === job.id) {
                  return (
                    <div key={job.id} className="jr editing">
                      <JobForm initial={job} saveLabel="Save job" onCancel={() => setEditing(null)} onSave={(j) => (patchDriver(d.id, { jobs: withJob(d.jobs, j) }), setEditing(null))} />
                    </div>
                  );
                }
                const badC = places[job.collect] === null;
                const badD = !job.carryover && places[job.deliver] === null;
                return (
                  <div key={job.id} className="jr">
                    <i aria-hidden="true">{ji + 1}</i>
                    <div className="jr-main">
                      <b>
                        <span className="nw">{job.collect}</span>{' '}
                        <span className="nw">
                          <u>→</u> {job.carryover ? <span className="tag good">Carryover home</span> : job.deliver}
                        </span>
                      </b>
                      {job.ref && <em className="num">#{job.ref}</em>}
                      {(badC || badD) && <span className="bad">We can't find {badC ? job.collect : job.deliver}.</span>}
                    </div>
                    <button type="button" className="icon-btn small" aria-label={`Edit job ${ji + 1} for ${d.callSign || 'driver'}`} onClick={() => setEditing(job.id)}>
                      <Icon name="edit" size={15} />
                    </button>
                    <button type="button" className="icon-btn small" aria-label={`Remove job ${ji + 1} for ${d.callSign || 'driver'}`} onClick={() => patchDriver(d.id, { jobs: d.jobs.filter((j) => j.id !== job.id) })}>
                      <Icon name="x" size={15} />
                    </button>
                  </div>
                );
              })}

              {d.jobs.length > 0 && !d.jobs.some((j) => j.carryover) && (
                <Toggle checked={!d.ownWayHome} onChange={(pick) => patchDriver(d.id, { ownWayHome: !pick })}>
                  Pick them up after their last job
                </Toggle>
              )}

              {adding === d.id ? (
                <div className="jr editing">
                  <JobForm saveLabel="Add job" onCancel={() => setAdding(null)} onSave={(j) => (patchDriver(d.id, { jobs: withJob(d.jobs, j) }), setAdding(null))} />
                </div>
              ) : (
                <div className="drv-acts">
                  <button type="button" className="link" onClick={() => setAdding(d.id)}>
                    + Add job
                  </button>
                  <button type="button" className="link" onClick={() => onImport(d.id)}>
                    Add from screenshots
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        <button type="button" className="add" onClick={() => setLift({ drivers: [...day.drivers, { id: uid(), callSign: '', name: '', jobs: [] }] })}>
          <Icon name="plus" size={16} /> Add a driver
        </button>

        {day.drivers.length > 0 && (
          <div className="opts">
            <Toggle checked={day.returnToStart} onChange={(returnToStart) => setLift({ returnToStart })}>
              I come back to where I start at the end
            </Toggle>
            <Toggle checked={day.keepJobOrder} onChange={(keepJobOrder) => setLift({ keepJobOrder })}>
              Keep each driver's jobs in the order entered
            </Toggle>
          </div>
        )}
        <p className="fine">
          <AboutButton />
        </p>

      </div>

      <div className="bar">
        <button type="button" className="btn green grow" disabled={!!gaps} onClick={() => setView('result')}>
          Plan the run
        </button>
        {gaps && day.drivers.length > 0 && <p className="bar-hint">{gaps}</p>}
      </div>
    </>
  );
}
