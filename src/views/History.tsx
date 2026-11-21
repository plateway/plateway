import { useEffect, useRef, useState } from 'react';
import { Icon, Segmented, toast, Toggle } from '../components/bits';
import { DEFAULT_RATES, money, paidMiles, payFor, totals, weekStart, type Rates } from '../lib/pay';
import { addDays, fmtDate, todayLondon } from '../lib/time';
import type { Job } from '../lib/types';
import { makeBackup, readBackup, useStore } from '../store';
import { AboutButton } from '../components/About';

type Status = 'todo' | 'done' | 'failed';
const STATUS_LABEL: Record<Status, string> = { todo: 'To do', done: 'Done', failed: 'Failed' };
const statusOf = (job: Job): Status => job.status ?? 'todo';

/** A number box that keeps what is typed, and reports a number only when it is one. */
function NumField({ label, value, onChange, placeholder, hint }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; hint?: string }) {
  const [text, setText] = useState(value != null ? String(value) : '');
  const bad = text.trim() !== '' && !Number.isFinite(Number(text));
  return (
    <label className="mini">
      <span>{label}</span>
      <input
        value={text}
        inputMode="decimal"
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.trim();
          if (t === '') onChange(undefined);
          else if (Number.isFinite(Number(t))) onChange(Number(t));
        }}
      />
      <em className={bad ? 'bad' : ''}>{bad ? 'Use a number, like 25.' : (hint ?? '')}</em>
    </label>
  );
}

function RatesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rates = useStore((s) => s.rates);
  const setRates = useStore((s) => s.setRates);
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Rates>(rates);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setDraft(rates);
      setRound((r) => r + 1);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);
  const set = (p: Partial<Rates>) => setDraft((r) => ({ ...r, ...p }));
  const ok = [draft.perMove, draft.includedMiles, draft.perMileAfter, draft.inspection].every((n) => Number.isFinite(n) && n >= 0);
  return (
    <dialog ref={ref} className="sheet-dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby="rates-title">
      <div className="dialog-body" key={round}>
        <h2 id="rates-title">What a job pays</h2>
        <p className="muted">Used for jobs still to do. Jobs already marked done or failed keep the rates they were paid at.</p>
        <div className="rates">
          <NumField label="Each move (£)" value={draft.perMove} onChange={(v) => set({ perMove: v ?? NaN })} />
          <NumField label="Miles covered by that" value={draft.includedMiles} onChange={(v) => set({ includedMiles: v ?? NaN })} />
          <NumField label="Each mile after (pence)" value={Math.round(draft.perMileAfter * 1000) / 10} onChange={(v) => set({ perMileAfter: v == null ? NaN : v / 100 })} />
          <NumField label="Inspection extra (£)" value={draft.inspection} onChange={(v) => set({ inspection: v ?? NaN })} />
        </div>
        <p className="muted">A failed job has no fixed rate. You type in what you were offered, usually {money(rates.failedMin)} to {money(rates.failedMax)}.</p>
        {!ok && <p className="hint bad">Fill in every rate with a number.</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={() => (setDraft(DEFAULT_RATES), setRound((r) => r + 1))}>
            Back to standard
          </button>
          <button type="button" className="btn dark grow" disabled={!ok} onClick={() => (setRates(draft), onClose())}>
            Save rates
          </button>
        </div>
      </div>
    </dialog>
  );
}

function JobEditor({ job }: { job: Job }) {
  const rates = useStore((s) => s.rates);
  const updateJob = useStore((s) => s.updateJob);
  const setStatus = useStore((s) => s.setStatus);
  const removeJob = useStore((s) => s.removeJob);
  const pay = payFor(job, rates);
  const status = statusOf(job);
  const source = job.paidMiles != null ? 'You typed this' : job.sheetMiles != null ? 'From the job sheet' : job.roadMiles != null ? 'From the road distance' : 'Not known yet';
  return (
    <div className="job-edit">
      <Segmented
        flat
        wide
        label="What happened"
        value={status}
        onChange={(s) => setStatus(job.id, s === 'todo' ? undefined : s)}
        options={(['todo', 'done', 'failed'] as Status[]).map((id) => ({ id, label: STATUS_LABEL[id] }))}
      />
      {status === 'failed' ? (
        <NumField key="failed" label="What you were offered (£)" value={job.failedPay} placeholder={`${rates.failedMin} to ${rates.failedMax}`} onChange={(v) => updateJob(job.id, { failedPay: v })} hint={`Usually ${money(rates.failedMin)} to ${money(rates.failedMax)}`} />
      ) : (
        !job.carryover && (
          <>
            <NumField key="miles" label="Miles paid" value={job.paidMiles} placeholder={paidMiles(job) != null ? String(paidMiles(job)) : 'e.g. 74'} onChange={(v) => updateJob(job.id, { paidMiles: v })} hint={source} />
            <Toggle checked={!!job.inspection} onChange={(inspection) => updateJob(job.id, { inspection })}>
              Inspection job (+{money(rates.inspection)})
            </Toggle>
          </>
        )
      )}
      <NumField key="other" label="Other pay (£)" value={job.extraPay} placeholder="0" onChange={(v) => updateJob(job.id, { extraPay: v })} hint="Anything else added or taken off" />
      <div className="breakdown num">
        {pay.waiting === 'carryover' && <p>A carryover is paid when you deliver it, on the day you deliver it.</p>}
        {pay.waiting === 'failed-amount' && <p>Add what you were offered for this failed job.</p>}
        {pay.waiting === 'miles' && <p>Miles are not known yet, so this is the move only.</p>}
        {pay.lines.map((l) => (
          <div key={l.label}>
            <span>{l.label}</span>
            <span>{money(l.amount)}</span>
          </div>
        ))}
        <div className="sum-line">
          <span>This job</span>
          <span>{money(pay.total)}</span>
        </div>
      </div>
      {job.rates && (job.rates.perMove !== rates.perMove || job.rates.perMileAfter !== rates.perMileAfter || job.rates.includedMiles !== rates.includedMiles || job.rates.inspection !== rates.inspection) && (
        <p className="hint">Paid at the rates in force when it was marked, not today's rates.</p>
      )}
      <button
        type="button"
        className="link danger"
        onClick={() => {
          const undo = removeJob(job.id);
          if (undo) toast('Job removed', { label: 'Undo', run: undo });
        }}
      >
        Remove this job
      </button>
    </div>
  );
}

function BackupBox() {
  const restoreBackup = useStore((s) => s.restoreBackup);
  const count = useStore((s) => s.driver.jobs.length);
  const picker = useRef<HTMLInputElement>(null);
  const download = () => {
    const blob = new Blob([JSON.stringify(makeBackup())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `plateway-backup-${todayLondon()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup saved. Keep it somewhere safe, like Files or iCloud Drive.');
  };
  const restore = async (file: File | undefined) => {
    if (!file) return;
    const backup = readBackup(await file.text());
    if (typeof backup === 'string') return toast(backup);
    const when = new Date(backup.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    if (count && !window.confirm(`Replace the ${count} jobs on this phone with the ${backup.jobs.length} jobs in the backup from ${when}?`)) return;
    restoreBackup(backup);
    toast(`Restored ${backup.jobs.length} jobs from ${when}.`);
  };
  return (
    <div className="backup">
      <div>
        <b>Keep a copy</b>
        <span>Your history is only on this phone. Save a backup now and then, and restore it on a new phone.</span>
      </div>
      <div className="backup-acts">
        <button type="button" className="chip-btn" onClick={download} disabled={!count}>
          Save backup
        </button>
        <button type="button" className="chip-btn" onClick={() => picker.current?.click()}>
          Restore
        </button>
        <input ref={picker} type="file" accept="application/json,.json" hidden aria-label="Choose a backup file" onChange={(e) => (restore(e.target.files?.[0]), (e.target.value = ''))} />
      </div>
    </div>
  );
}

export function History() {
  const driver = useStore((s) => s.driver);
  const rates = useStore((s) => s.rates);
  const setDriver = useStore((s) => s.setDriver);
  const setView = useStore((s) => s.setView);
  const [week, setWeek] = useState(() => weekStart(driver.date));
  const [open, setOpen] = useState<string | null>(null);
  const [ratesOpen, setRatesOpen] = useState(false);

  const end = addDays(week, 6);
  const inWeek = driver.jobs.filter((j) => j.date && j.date >= week && j.date <= end);
  const t = totals(inWeek, rates);
  const all = totals(driver.jobs, rates);
  const days = [...new Set(inWeek.map((j) => j.date as string))].sort();
  const thisWeek = weekStart(todayLondon());
  const plan = (date: string) => (setDriver({ date }), setView('setup'));

  return (
    <div className="pad">
      <div className="band">
        <div className="band-nav">
          <button type="button" className="icon-btn small" aria-label="Earlier week" onClick={() => (setWeek(addDays(week, -7)), setOpen(null))}>
            <Icon name="back" size={16} />
          </button>
          <span>
            {week === thisWeek ? 'This week' : `Week of ${fmtDate(week)}`}
            {week !== thisWeek && (
              <small>
                {fmtDate(week)} to {fmtDate(end)}
              </small>
            )}
          </span>
          <button type="button" className="icon-btn small flip" aria-label="Later week" onClick={() => (setWeek(addDays(week, 7)), setOpen(null))}>
            <Icon name="back" size={16} />
          </button>
        </div>
        <div className="band-main">
          <div>
            <small>Earned</small>
            <b className="num">{money(t.earned)}</b>
          </div>
          <div>
            <small>Still to do</small>
            <b className="num dim">{money(t.toCome)}</b>
          </div>
        </div>
        <p className="num">
          {t.jobs === 0 ? 'No jobs in this week' : `${t.done} done · ${t.failed} failed · ${t.todo} to do · ${Math.round(t.miles)} miles done`}
        </p>
      </div>

      {driver.jobs.length === 0 && (
        <div className="empty-block">
          <p className="empty">No jobs yet. Every job you plan is kept here, with what it pays.</p>
          <button type="button" className="btn dark" onClick={() => setView('setup')}>
            Plan a day
          </button>
        </div>
      )}
      {driver.jobs.length > 0 && inWeek.length === 0 && <p className="empty">Nothing planned in this week. Use the arrows to look at another week.</p>}

      {days.map((date) => {
        const jobs = inWeek.filter((j) => j.date === date);
        const dt = totals(jobs, rates);
        return (
          <section key={date} className="hday">
            <header>
              <h2>{fmtDate(date)}</h2>
              <span className="num">{money(dt.earned + dt.toCome)}</span>
              <button type="button" className="chip-btn" onClick={() => plan(date)}>
                Plan
              </button>
            </header>
            <ul>
              {jobs.map((job) => {
                const pay = payFor(job, rates);
                const status = statusOf(job);
                const isOpen = open === job.id;
                const miles = paidMiles(job);
                return (
                  <li key={job.id} className={isOpen ? 'open' : ''}>
                    <button type="button" className="hjob" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : job.id)}>
                      <i className={`st ${status}`} aria-hidden="true" />
                      <span className="hjob-main">
                        <b>
                          <span className="nw">{job.collect || '?'}</span>{' '}
                          <span className="nw">→ {job.carryover ? 'home' : job.deliver || '?'}</span>
                        </b>
                        <span className="num">
                          {STATUS_LABEL[status]}
                          {job.ref ? ` · #${job.ref}` : ''}
                          {miles != null && !job.carryover ? ` · ${Math.round(miles * 10) / 10} mi` : ''}
                          {job.inspection ? ' · inspection' : ''}
                          {job.carryover ? ' · carryover' : ''}
                        </span>
                      </span>
                      <span className={`hjob-pay num${pay.waiting === 'carryover' || pay.waiting === 'failed-amount' ? ' soft' : ''}`}>
                        {pay.waiting === 'carryover' ? 'When delivered' : pay.waiting === 'failed-amount' ? 'Add amount' : money(pay.total)}
                      </span>
                      <span className={`chev${isOpen ? ' up' : ''}`} aria-hidden="true">
                        <Icon name="down" size={16} />
                      </span>
                    </button>
                    {isOpen && <JobEditor job={job} />}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="rates-line">
        <p className="num">
          {money(rates.perMove)} a move · {Math.round(rates.perMileAfter * 1000) / 10}p a mile over {rates.includedMiles} · {money(rates.inspection)} inspection
        </p>
        <button type="button" className="chip-btn" onClick={() => setRatesOpen(true)}>
          Change rates
        </button>
      </div>
      <BackupBox />
      <p className="fine">
        <AboutButton />
      </p>
      {driver.jobs.length > 0 && (
        <p className="fine num">
          All time: {money(all.earned)} earned from {all.done + all.failed} jobs, {money(all.toCome)} still to do. These figures are worked out from the rates above, not taken from your payslip.
        </p>
      )}
      <RatesDialog open={ratesOpen} onClose={() => setRatesOpen(false)} />
    </div>
  );
}
