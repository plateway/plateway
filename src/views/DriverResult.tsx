import { Icon, openNav } from '../components/bits';
import type { PlanState } from '../hooks';
import { busCap, fareText, TRAIN_PER_MILE } from '../lib/fares';
import { money, payFor, totals } from '../lib/pay';
import { fmtDur, fmtMiles, fmtTime, MIN, todayLondon } from '../lib/time';
import type { DriverPlan, Job, Leg, Place, TransitPart } from '../lib/types';
import { TRANSIT_COLOUR } from '../mapData';
import { useStore } from '../store';

type Props = {
  state: PlanState<DriverPlan> & { retry: () => void };
  jobs: Job[];
  start: Place | null;
  selected: string | null;
  onSelect: (legId: string | null) => void;
};

const where = (p: Place) => p.postcode || 'your location';

function Pill({ part }: { part: TransitPart }) {
  if (part.mode === 'WALK') return <span className="pill walk">Walk {Math.max(1, Math.round((part.end - part.start) / MIN))} min</span>;
  return (
    <span className="pill" style={{ background: TRANSIT_COLOUR[part.mode] }}>
      {part.label}
    </span>
  );
}

function LegActions({ leg, selected, onSelect, by }: { leg: Leg; selected: boolean; onSelect: Props['onSelect']; by: 'drive' | 'transit' }) {
  return (
    <div className="leg-acts">
      <button type="button" className={`chip-btn${selected ? ' on' : ''}`} aria-pressed={selected} onClick={() => onSelect(selected ? null : leg.id)}>
        {selected ? 'Show whole day' : 'Show on map'}
      </button>
      <button type="button" className="chip-btn" onClick={() => openNav({ to: leg.to, from: leg.from, by, title: `${where(leg.from)} to ${where(leg.to)}` })}>
        <Icon name="nav" size={14} /> Directions
      </button>
    </div>
  );
}

export function DriverResult({ state, jobs, start, selected, onSelect }: Props) {
  const rates = useStore((s) => s.rates);
  const setStatus = useStore((s) => s.setStatus);
  const dayPay = totals(jobs, rates);
  const plan = state.plan;
  if (!plan) {
    return (
      <div className="pad center">
        {state.status === 'error' ? (
          <>
            <p className="hint bad">{state.error}</p>
            <button type="button" className="btn dark" onClick={state.retry}>
              Try again
            </button>
          </>
        ) : (
          <>
            <div className="spinner" aria-hidden="true" />
            <p role="status">Working out the roads{state.status === 'loading' ? ' and timetables' : ''}…</p>
          </>
        )}
      </div>
    );
  }

  const last = plan.legs[plan.legs.length - 1];
  const first = plan.legs[0];
  const cap = busCap(todayLondon(plan.leave));
  const capNote = cap != null ? `Buses use the £${cap} single fare cap for England, which covers most buses but not coaches.` : 'No bus fare cap is published for this date, so buses are left out.';
  return (
    <div className={`pad${state.status === 'loading' ? ' stale' : ''}`}>
      <div className="sum">
        <div>
          <small>Leave</small>
          <b className="num">{fmtTime(plan.leave)}</b>
        </div>
        <span className="arr" aria-hidden="true">
          →
        </span>
        <div>
          <small>{last?.toHome ? 'Home' : 'Done'}</small>
          <b className="num">{fmtTime(plan.finish)}</b>
        </div>
        <div className="tot num">
          <strong>{money(dayPay.earned + dayPay.toCome)} for the day</strong>
          <span>{fmtMiles(plan.jobMiles)} on jobs</span>
          <span>{fmtDur(plan.jobMins)} driving</span>
          <span>{plan.mode === 'solo' ? `${fmtDur(plan.gapMins)} bus, train, foot` : `${fmtDur(plan.gapMins)} in the lift car`}</span>
          {plan.fare && plan.fare.lines.length > 0 && <span className="fare-sum">Fares {fareText(plan.fare)}</span>}
        </div>
      </div>

      {state.status === 'loading' && <p className="hint wait" role="status">Updating…</p>}
      {state.savedAt && (
        <p className="note">
          <b>Showing the plan saved at {fmtTime(state.savedAt)}</b>
          {state.error ? 'There is no connection right now, so this is the last plan worked out on this phone.' : 'Checking for an update…'}
        </p>
      )}
      {state.status === 'error' && !state.savedAt && (
        <p className="hint bad">
          {state.error}{' '}
          <button type="button" className="link" onClick={state.retry}>
            Try again
          </button>
        </p>
      )}
      {plan.warnings.map((w) => (
        <p key={w} className="note">
          {w}
        </p>
      ))}

      {first && (
        <button type="button" className="btn dark wide" onClick={() => openNav({ to: first.to, from: first.from, by: first.kind === 'transit' ? 'transit' : 'drive', title: `First stop: ${where(first.to)}` })}>
          <Icon name="nav" size={18} /> Directions to {where(first.to)}
        </button>
      )}

      <ol className="tl">
        <li className="tl-node">
          <time className="num">{fmtTime(plan.leave)}</time>
          <i className="dot" aria-hidden="true" />
          <div>
            <b>Set off</b>
            <span>{start ? where(start) : ''}</span>
          </div>
        </li>
        {plan.legs.map((leg) => {
          const isSel = selected === leg.id;
          if (leg.kind === 'job') {
            const job = jobs.find((j) => j.id === leg.jobId);
            return (
              <li key={leg.id} className={`tl-job${isSel ? ' sel' : ''}`}>
                <time className="num">
                  <span>{fmtTime(leg.start)}</span>
                  <small>{fmtTime(leg.end)}</small>
                </time>
                <i className="rail solid" aria-hidden="true" />
                <div className="card">
                  <div className="card-h">
                    <b>Job {leg.jobNo}</b>
                    {job?.ref && <span className="num">#{job.ref}</span>}
                  </div>
                  <div className="ab">
                    <span>Collect</span>
                    <b>{where(leg.from)}</b>
                  </div>
                  <div className="ab">
                    <span>{leg.carryover ? 'Take home' : 'Deliver'}</span>
                    <b>{where(leg.to)}</b>
                  </div>
                  <div className="card-f num">
                    <strong>{fmtMiles(leg.miles)}</strong> · {fmtDur(leg.mins)} drive
                    {job && <span className="pay-chip">{job.carryover ? 'Paid when delivered' : money(payFor(job, rates).total)}</span>}
                    {leg.carryover && <span className="tag good">Carryover</span>}
                  </div>
                  <LegActions leg={leg} selected={isSel} onSelect={onSelect} by="drive" />
                  {job && job.status !== 'failed' && (
                    <button type="button" className={`chip-btn done-btn${job.status === 'done' ? ' on' : ''}`} aria-pressed={job.status === 'done'} onClick={() => setStatus(job.id, job.status === 'done' ? undefined : 'done')}>
                      {job.status === 'done' ? 'Done' : 'Mark as done'}
                    </button>
                  )}
                </div>
              </li>
            );
          }
          const firstRide = leg.parts?.find((p) => p.mode !== 'WALK');
          return (
            <li key={leg.id} className={`tl-gap${isSel ? ' sel' : ''}`}>
              <time className="num">{fmtTime(leg.start)}</time>
              <i className={`rail ${leg.kind === 'lift' ? 'lift' : 'dashed'}`} aria-hidden="true" />
              <div>
                {leg.kind === 'transit' && (
                  <>
                    <div className="pills">{leg.parts?.map((p, i) => <Pill key={i} part={p} />)}</div>
                    <span>
                      {fmtDur(leg.mins)} to {leg.toHome ? 'home' : where(leg.to)}
                      {firstRide ? ` · ${firstRide.label} leaves ${firstRide.from} at ${fmtTime(firstRide.start)}` : ' · on foot all the way'}
                    </span>
                    {leg.fare && (
                      <span className="fare num">
                        {leg.fare.lines.length > 0 && <b>Fares {fareText(leg.fare)}</b>}
                        {leg.fare.lines.length > 1 && `: ${leg.fare.lines.map((l) => `${l.label} ${fareText({ ...l, lines: [l] })}`).join(', ')}`}
                        {leg.fare.missing.length > 0 && ` ${leg.fare.lines.length ? 'No estimate for' : 'No fare estimate for'} ${leg.fare.missing.join(', ')}.`}
                      </span>
                    )}
                  </>
                )}
                {leg.kind === 'lift' && (
                  <>
                    <b>Lift to {leg.toHome ? 'home' : where(leg.to)}</b>
                    <span className="num">
                      {fmtMiles(leg.miles)} · {fmtDur(leg.mins)}
                    </span>
                  </>
                )}
                {leg.kind === 'unknown' && (
                  <>
                    <b>No public transport found to {leg.toHome ? 'home' : where(leg.to)}</b>
                    <span className="num">
                      {fmtMiles(leg.miles)} by road, about {fmtDur(leg.mins)} in a taxi or a lift
                    </span>
                  </>
                )}
                <LegActions leg={leg} selected={isSel} onSelect={onSelect} by={leg.kind === 'lift' ? 'drive' : 'transit'} />
              </div>
            </li>
          );
        })}
        <li className="tl-node">
          <time className="num">{fmtTime(plan.finish)}</time>
          <i className="dot" aria-hidden="true" />
          <div>
            <b>{last?.toHome ? 'Home' : 'Day done'}</b>
            <span>{last ? where(last.to) : ''}</span>
          </div>
        </li>
      </ol>
      {plan.mode === 'solo' && (
        <p className="fine">
          Buses and trains:{' '}
          <a href="https://transitous.org" target="_blank" rel="noopener noreferrer">
            Transitous
          </a>{' '}
          (
          <a href="https://transitous.org/sources/" target="_blank" rel="noopener noreferrer">
            timetable sources
          </a>
          ).
        </p>
      )}
      <p className="fine">
        Times use normal road speeds and published timetables. Allow extra for traffic and handovers.
        {plan.mode === 'solo' && ' Driving lines follow the road. A dashed line is a train or bus whose exact path is not published, drawn straight between stops.'}
        {plan.mode === 'solo' && plan.fare && ` Fares are estimates. ${capNote} Trains are a rough guide of ${Math.round(TRAIN_PER_MILE.low * 100)}p to ${Math.round(TRAIN_PER_MILE.high * 100)}p a mile, not real ticket prices. Check the price before you travel.`}
      </p>
    </div>
  );
}
