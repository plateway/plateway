import { Icon, openNav, Segmented, toast } from '../components/bits';
import type { PlanState } from '../hooks';
import { navLink } from '../lib/links';
import { lanePlanText, shareText } from '../lib/share';
import { fmtDur, fmtMiles, fmtTime, MIN } from '../lib/time';
import type { LiftPlan, TeamDriver } from '../lib/types';

export type LiftTab = 'stops' | 'drivers';

type Props = {
  state: PlanState<LiftPlan> & { retry: () => void };
  drivers: TeamDriver[];
  colours: Record<string, string>;
  date: string;
  tab: LiftTab;
  onTab: (t: LiftTab) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
};

const SEGMENT_LABEL = { car: 'In your car', job: 'Driving a job', handover: 'Handover', wait: 'Waiting for you' } as const;

export function LiftResult({ state, drivers, colours, date, tab, onTab, selected, onSelect }: Props) {
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
            <p role="status">Working out the best run…</p>
          </>
        )}
      </div>
    );
  }

  const sign = (id?: string) => {
    const d = drivers.find((x) => x.id === id);
    return d?.callSign || d?.name || 'Driver';
  };
  const calls = plan.stops.filter((s) => s.kind === 'drop' || s.kind === 'pick');
  const ends = plan.stops[plan.stops.length - 1];
  const returns = ends.kind === 'end';
  const total = (plan.finish - plan.leave) / MIN;
  // Google Maps takes a start, an end and up to nine stops between.
  const between = returns ? calls : calls.slice(0, -1);
  const wholeRun = between.length <= 9 && calls.length ? navLink('google', ends.place, { from: plan.stops[0].place, via: between.map((s) => s.place) }) : null;

  const worst = plan.lanes
    .flatMap((l) => l.jobs.filter((j) => j.pickedAt != null && j.to).map((j) => ({ lane: l, job: j, wait: ((j.pickedAt as number) - j.readyAt) / MIN })))
    .sort((a, b) => b.wait - a.wait)[0];
  const span = Math.max(1, plan.finish + 20 * MIN - plan.leave);
  const pct = (ms: number) => `${(((ms - plan.leave) / span) * 100).toFixed(2)}%`;
  const hours: number[] = [];
  for (let t = Math.ceil(plan.leave / (60 * MIN)) * 60 * MIN; t < plan.leave + span; t += 60 * MIN) hours.push(t);

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
          <small>{returns ? 'Back' : 'Done'}</small>
          <b className="num">{fmtTime(plan.finish)}</b>
        </div>
        <div className="tot num">
          <strong>{calls.length} stops</strong>
          <span>{fmtDur(total)}</span>
          <span>{fmtMiles(plan.carMiles)} driven</span>
        </div>
      </div>

      {state.status === 'loading' && <p className="hint wait" role="status">Updating…</p>}
      {plan.warnings.map((w) => (
        <p key={w} className="note">
          {w}
        </p>
      ))}

      <Segmented
        flat
        label="What to show"
        value={tab}
        onChange={(t) => (onSelect(null), onTab(t))}
        options={[
          { id: 'stops', label: 'Stops' },
          { id: 'drivers', label: 'Drivers' },
        ]}
      />

      {tab === 'stops' && (
        <>
          <ol className="stops-list">
            {plan.stops.map((s, n) => {
              if (s.kind === 'start') return null;
              const isSel = selected === s.id;
              const label = s.kind === 'end' ? 'Back at the start' : `${s.kind === 'pick' ? 'Pick up' : 'Drop'} ${sign(s.driverId)}`;
              return (
                <li key={s.id} className={isSel ? 'sel' : ''}>
                  <span className="n" style={{ background: s.kind === 'end' ? undefined : colours[s.driverId ?? ''] }}>
                    {s.kind === 'end' ? '' : n}
                  </span>
                  <time className="num">{fmtTime(s.arrive)}</time>
                  <div className="stop-main">
                    <b>{label}</b>
                    <span className="num">
                      {s.place.postcode || 'your start'} · {fmtMiles(s.miles)} · {fmtDur(s.mins)}
                      {s.kind !== 'end' && ` · ${s.onBoard.length ? `${s.onBoard.length} in the car after` : 'car empty after'}`}
                    </span>
                    {s.driverWaitMin >= 10 && (
                      <span className="flag warn">
                        {sign(s.driverId)} waits {fmtDur(s.driverWaitMin)}
                      </span>
                    )}
                    {s.carWaitMin >= 5 && <span className="flag hold">You wait {fmtDur(s.carWaitMin)}</span>}
                    <div className="leg-acts">
                      <button type="button" className={`chip-btn${isSel ? ' on' : ''}`} aria-pressed={isSel} onClick={() => onSelect(isSel ? null : s.id)}>
                        {isSel ? 'Show whole run' : 'Show on map'}
                      </button>
                      <button type="button" className="chip-btn" onClick={() => openNav({ to: s.place, by: 'drive', title: `${label} at ${s.place.postcode || 'your start'}` })}>
                        <Icon name="nav" size={14} /> Directions
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          {wholeRun && (
            <a className="btn soft wide" href={wholeRun} target="_blank" rel="noopener noreferrer">
              <Icon name="nav" size={16} /> Open the whole run in Google Maps
            </a>
          )}
        </>
      )}

      {tab === 'drivers' && (
        <>
          {worst && worst.wait >= 10 && (
            <p className="note">
              <b>
                {sign(worst.lane.driverId)} waits {fmtDur(worst.wait)} at {worst.job.to?.postcode}
              </b>
              Free from {fmtTime(worst.job.readyAt)}.{plan.proven ? ' Collecting them sooner would make the whole run longer.' : ''}
            </p>
          )}
          <div className="legend">
            <span>
              <i className="sw k-car" />
              {SEGMENT_LABEL.car}
            </span>
            <span>
              <i className="sw k-job" />
              {SEGMENT_LABEL.job}
            </span>
            <span>
              <i className="sw k-handover" />
              {SEGMENT_LABEL.handover}
            </span>
            <span>
              <i className="sw k-wait" />
              {SEGMENT_LABEL.wait}
            </span>
          </div>
          <div className="axis" aria-hidden="true">
            {hours.map((h) => (
              <span key={h} style={{ left: pct(h) }}>
                {fmtTime(h)}
              </span>
            ))}
          </div>
          <ul className="lanes">
            {plan.lanes.map((lane) => {
              const d = drivers.find((x) => x.id === lane.driverId);
              if (!d) return null;
              const isSel = selected === lane.driverId;
              return (
                <li key={lane.driverId} className={isSel ? 'sel' : ''}>
                  <div className="lane-h">
                    <span className="dot" style={{ background: colours[lane.driverId] }} aria-hidden="true" />
                    <b className="sign">{sign(lane.driverId)}</b>
                    {d.callSign && d.name && <span>{d.name}</span>}
                    <em className="num">done {fmtTime(lane.finish)}</em>
                  </div>
                  <div className="track" role="img" aria-label={`${sign(lane.driverId)}: ${lane.segments.map((s) => `${SEGMENT_LABEL[s.kind]} ${fmtTime(s.start)} to ${fmtTime(s.end)}`).join(', ')}`}>
                    {lane.segments.map((s, i) => (
                      <i key={i} className={`sw k-${s.kind}`} style={{ left: pct(s.start), width: `max(2px, calc(${pct(s.end)} - ${pct(s.start)}))` }} />
                    ))}
                  </div>
                  {lane.jobs.map((j) => (
                    <p key={j.jobId} className="num">
                      {j.carryover ? (
                        <>
                          <b>Carryover</b> {j.from.postcode} · dropped {fmtTime(j.droppedAt)}, takes it home
                        </>
                      ) : (
                        <>
                          <b>Job {j.jobNo}</b> {j.from.postcode} → {j.to?.postcode} · {fmtTime(j.setOffAt)} to {fmtTime(j.arriveAt)} · {fmtMiles(j.miles)}
                          {j.pickedAt != null && j.pickedAt - j.readyAt >= 10 * MIN && (
                            <span className="waits">
                              Waits {fmtDur((j.pickedAt - j.readyAt) / MIN)} at {j.to?.postcode} from {fmtTime(j.readyAt)}
                            </span>
                          )}
                        </>
                      )}
                    </p>
                  ))}
                  <div className="leg-acts">
                    <button type="button" className={`chip-btn${isSel ? ' on' : ''}`} aria-pressed={isSel} onClick={() => onSelect(isSel ? null : lane.driverId)}>
                      {isSel ? 'Show everyone' : 'Show on map'}
                    </button>
                    <button
                      type="button"
                      className="chip-btn"
                      onClick={async () => {
                        const res = await shareText(lanePlanText(d, lane, plan, date), `Lift plan for ${sign(lane.driverId)}`);
                        if (res === 'copied') toast(`Plan for ${sign(lane.driverId)} copied. Paste it into a message.`);
                        if (res === 'failed') toast('Could not share or copy the plan on this device.');
                      }}
                    >
                      <Icon name="share" size={14} /> Send plan
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="fine">Times use normal road speeds. Allow extra for traffic and handovers.</p>
    </div>
  );
}
