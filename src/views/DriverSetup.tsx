import { useState } from 'react';
import { Icon, JobForm, RouteThumb, StartField, toast, Toggle } from '../components/bits';
import { driverGaps, type Places, type PlanState } from '../hooks';
import { fareText } from '../lib/fares';
import { money, payFor, totals } from '../lib/pay';
import { normPostcode } from '../lib/postcodes';
import { fmtDate, fmtDur, fmtMiles, fmtTime, MIN } from '../lib/time';
import type { DriverPlan, Job } from '../lib/types';
import { dayOf, uid, useStore } from '../store';
import { AboutButton } from '../components/About';

type Props = {
  places: Places;
  placesError: string | null;
  solo: PlanState<DriverPlan> & { retry: () => void };
  lift: PlanState<DriverPlan> & { retry: () => void };
  onImport: () => void;
};

function ModeTile({ title, on, state, detail, onPick }: { title: string; on: boolean; state: Props['solo']; detail: (p: DriverPlan) => string; onPick: () => void }) {
  const p = state.plan;
  return (
    <button type="button" className={`opt${on ? ' on' : ''}`} aria-pressed={on} onClick={onPick}>
      <span className="opt-k">
        {title}
        <i aria-hidden="true" />
      </span>
      {state.status === 'error' ? (
        <span className="opt-msg">Couldn't work this out. {state.error}</span>
      ) : p ? (
        <>
          <small>Done by</small>
          <b className={`num${state.status === 'loading' ? ' stale' : ''}`}>{fmtTime(p.finish)}</b>
          <span className="opt-d num">
            Leave {fmtTime(p.leave)} · {fmtDur((p.finish - p.leave) / MIN)}
            <br />
            {detail(p)}
          </span>
        </>
      ) : (
        <span className="opt-msg">{state.status === 'loading' ? 'Working it out…' : 'Add your start and jobs to see the day.'}</span>
      )}
    </button>
  );
}

export function DriverSetup({ places, placesError, solo, lift, onImport }: Props) {
  const all = useStore((s) => s.driver);
  const rates = useStore((s) => s.rates);
  const setDriver = useStore((s) => s.setDriver);
  const setDayJobs = useStore((s) => s.setDayJobs);
  const updateJob = useStore((s) => s.updateJob);
  const removeJob = useStore((s) => s.removeJob);
  const setView = useStore((s) => s.setView);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const day = dayOf(all);
  const current = day.mode === 'solo' ? solo : lift;
  const anyPlan = current.plan ?? solo.plan ?? lift.plan;
  // In best-order mode the list follows the plan; otherwise it is the order the driver set.
  const ordered: Job[] = day.autoOrder && anyPlan ? [...anyPlan.order.map((id) => day.jobs.find((j) => j.id === id)).filter((j): j is Job => !!j), ...day.jobs.filter((j) => !anyPlan.order.includes(j.id))] : day.jobs;
  const gaps = driverGaps(day, places);
  const dayPay = totals(day.jobs, rates);
  // Cars taken home on an earlier day and not yet given a delivery.
  const waiting = all.jobs.filter((j) => j.carryover && j.date && j.date < day.date && !j.deliveredOn && j.status !== 'failed');

  const saveJobs = (jobs: Job[], autoOrder = day.autoOrder) => {
    setDayJobs(day.date, jobs);
    if (autoOrder !== day.autoOrder) setDriver({ autoOrder });
  };
  const move = (id: string, by: number) => {
    const list = [...ordered];
    const i = list.findIndex((j) => j.id === id);
    const to = i + by;
    if (to < 0 || to >= list.length) return;
    [list[i], list[to]] = [list[to], list[i]];
    saveJobs(list, false);
  };
  const setCarryover = (id: string, on: boolean) => saveJobs(ordered.map((j) => (j.id === id ? { ...j, carryover: on } : on ? { ...j, carryover: false } : j)));
  const patch = (id: string, p: Partial<Job>) => saveJobs(ordered.map((j) => (j.id === id ? { ...j, ...p } : j)));

  const deliverToday = (carry: Job) => {
    const from = normPostcode(day.start.postcode) ?? '';
    const delivery: Job = { id: uid(), ref: carry.ref, collect: from, deliver: carry.deliver, carryover: false, reg: carry.reg, inspection: carry.inspection, sheetMiles: carry.sheetMiles, carriedFrom: carry.id };
    saveJobs([...ordered, delivery]);
    updateJob(carry.id, { deliveredOn: day.date });
    // Without both ends it cannot be planned, so open it for the driver to finish.
    if (!delivery.collect || !delivery.deliver) setEditing(delivery.id);
  };

  return (
    <>
      <div className="pad">
        <div className="day-row">
          <label className="mini">
            <span>Day</span>
            <input type="date" value={day.date} onChange={(e) => e.target.value && setDriver({ date: e.target.value })} />
          </label>
          <label className="mini">
            <span>Leave at</span>
            <input type="time" value={day.leaveAt} onChange={(e) => e.target.value && setDriver({ leaveAt: e.target.value })} />
          </label>
        </div>

        <StartField label="Start from" value={day.start} onChange={(start) => setDriver({ start })} places={places} />
        <Toggle checked={day.homeSame} onChange={(homeSame) => setDriver({ homeSame })}>
          I finish the day back where I start
        </Toggle>
        {!day.homeSame && <StartField label="Home" value={day.home} onChange={(home) => setDriver({ home })} places={places} allowGps={false} />}
        {placesError && <p className="hint bad">{placesError}</p>}

        <h2 className="sec">How are you getting between jobs?</h2>
        <div className="cmp">
          <ModeTile title="Solo" on={day.mode === 'solo'} state={solo} onPick={() => setDriver({ mode: 'solo' })} detail={(p) => `${fmtDur(p.gapMins)} bus, train and foot${p.fare?.lines.length ? ` · fares ${fareText(p.fare)}` : ''}`} />
          <ModeTile title="With a lift" on={day.mode === 'lift'} state={lift} onPick={() => setDriver({ mode: 'lift' })} detail={(p) => `${Math.round(p.gapMiles)} miles in the lift car`} />
        </div>

        <div className="sec-row">
          <h2 className="sec">
            Jobs
            {day.jobs.length > 0 && <span className="sec-pay num"> · {money(dayPay.earned + dayPay.toCome)} for the day</span>}
          </h2>
          {day.jobs.length > 1 &&
            (day.autoOrder ? (
              <span className="tag good">{anyPlan?.ordersChecked ? `Shortest of ${anyPlan.ordersChecked} orders` : 'Best order'}</span>
            ) : (
              <button type="button" className="link" onClick={() => setDriver({ autoOrder: true })}>
                Your order. Use the best order
              </button>
            ))}
        </div>

        {waiting.map((carry) => (
          <div key={carry.id} className="carry">
            <div>
              <b>
                You took {carry.ref ? `#${carry.ref}` : 'a car'} home on {fmtDate(carry.date as string)}
              </b>
              <span>
                {carry.collect}
                {carry.deliver ? ` → ${carry.deliver}` : ''}. It is paid when you deliver it.
              </span>
            </div>
            <button type="button" className="btn dark" onClick={() => deliverToday(carry)}>
              Deliver it this day
            </button>
          </div>
        ))}

        {!day.jobs.length && !adding && <p className="empty">No jobs yet. Add them from screenshots of your job email, or type in the postcodes.</p>}

        <ol className="jobs">
          {ordered.map((job, i) => {
            const leg = anyPlan?.legs.find((l) => l.jobId === job.id);
            const badC = places[job.collect] === null;
            const badD = !job.carryover && places[job.deliver] === null;
            const pay = payFor(job, rates);
            if (editing === job.id) {
              return (
                <li key={job.id} className="job editing">
                  <JobForm withPay initial={job} saveLabel="Save job" onCancel={() => setEditing(null)} onSave={(j) => (saveJobs(ordered.map((x) => (x.id === j.id ? j : j.carryover ? { ...x, carryover: false } : x))), setEditing(null))} />
                </li>
              );
            }
            return (
              <li key={job.id} className="job">
                <RouteThumb coords={leg?.coords} label={String(i + 1)} />
                <div className="job-main">
                  <div className="job-h">
                    <b>Job {i + 1}</b>
                    {job.ref && <span className="num">#{job.ref}</span>}
                    {job.reg && <span>{job.reg}</span>}
                  </div>
                  <div className="job-rt">
                    <span className="nw">{job.collect || 'Collect from?'}</span>{' '}
                    <span className="nw">
                      <i>→</i> {job.carryover ? 'home' : job.deliver || 'deliver to?'}
                    </span>
                  </div>
                  <div className="job-m num">
                    {leg ? (
                      <>
                        <strong>{fmtMiles(leg.miles)}</strong> · {fmtDur(leg.mins)}
                      </>
                    ) : badC || badD ? (
                      <span className="bad">We can't find {badC ? job.collect : job.deliver}. Edit this job.</span>
                    ) : !job.collect || (!job.carryover && !job.deliver) ? (
                      <span className="bad">Add the missing postcode. Edit this job.</span>
                    ) : (
                      'Working out the road…'
                    )}
                    {job.liftFrom && <span> · lift from {job.liftFrom}</span>}
                  </div>
                  <div className="job-pay num">
                    {pay.waiting === 'carryover' ? <span>Paid when delivered</span> : <b>{money(pay.total)}</b>}
                    {pay.waiting !== 'carryover' && pay.lines.length > 1 && <span>{pay.lines.map((l) => `${l.label} ${money(l.amount)}`).join(' + ')}</span>}
                  </div>
                  <div className="job-tags">
                    <button type="button" className={`tag toggle-tag${job.carryover ? ' good' : ''}`} aria-pressed={job.carryover} onClick={() => setCarryover(job.id, !job.carryover)}>
                      {job.carryover ? 'Carryover: going home with you' : 'Mark as carryover'}
                    </button>
                    <button type="button" className={`tag toggle-tag${job.inspection ? ' good' : ''}`} aria-pressed={!!job.inspection} onClick={() => patch(job.id, { inspection: !job.inspection })}>
                      {job.inspection ? `Inspection +${money(rates.inspection)}` : 'Inspection?'}
                    </button>
                  </div>
                </div>
                <div className="job-acts">
                  <button type="button" className="icon-btn small" aria-label={`Move job ${i + 1} up`} disabled={i === 0} onClick={() => move(job.id, -1)}>
                    <Icon name="up" size={16} />
                  </button>
                  <button type="button" className="icon-btn small" aria-label={`Move job ${i + 1} down`} disabled={i === ordered.length - 1} onClick={() => move(job.id, 1)}>
                    <Icon name="down" size={16} />
                  </button>
                  <button type="button" className="icon-btn small" aria-label={`Edit job ${i + 1}`} onClick={() => setEditing(job.id)}>
                    <Icon name="edit" size={16} />
                  </button>
                  <button type="button" className="icon-btn small" aria-label={`Remove job ${i + 1}`} onClick={() => {
                    const undo = removeJob(job.id);
                    if (undo) toast(`Job ${i + 1} removed`, { label: 'Undo', run: undo });
                  }}>
                    <Icon name="x" size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>

        {adding ? (
          <div className="job editing">
            <JobForm withPay saveLabel="Add job" onCancel={() => setAdding(false)} onSave={(j) => (saveJobs([...ordered.map((x) => (j.carryover ? { ...x, carryover: false } : x)), j]), setAdding(false))} />
          </div>
        ) : (
          <button type="button" className="add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Add a job by postcode
          </button>
        )}
        <p className="fine">
          <AboutButton />
        </p>
      </div>

      <div className="bar">
        <button type="button" className="btn soft" onClick={onImport}>
          <Icon name="image" size={18} /> Screenshots
        </button>
        <button type="button" className="btn green grow" disabled={!!gaps} onClick={() => setView('result')}>
          See route
        </button>
        {gaps && day.jobs.length > 0 && <p className="bar-hint">{gaps}</p>}
      </div>
    </>
  );
}
