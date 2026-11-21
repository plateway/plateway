import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlaces } from '../hooks';
import { allPostcodeOptions, chooseStops, pageFromText, parseJobSheets, type ParsedSheet, type SheetPage } from '../lib/parseJobs';
import { lookupPostcodes, normPostcode } from '../lib/postcodes';
import { fmtDate, todayLondon } from '../lib/time';
import type { Job } from '../lib/types';
import { uid } from '../store';
import { Icon, postcodeStatus, Toggle } from './bits';

type Row = { key: string; include: boolean; ref: string; collect: string; deliver: string; carryover: boolean; inspection: boolean; sheetMiles?: number; reg?: string; startTime?: string; liftFrom?: string };

export type ImportResult = { jobs: Job[]; date?: string; callSign?: string; name?: string };

type Props = {
  open: boolean;
  /** Who the jobs are for, shown in the heading. */
  forWhom?: string;
  /** Show pay details. Only a plate driver's own jobs have pay. */
  showPay?: boolean;
  onClose: () => void;
  onAdd: (result: ImportResult) => void;
};

export function ImportJobs({ open, forWhom, showPay, onClose, onAdd }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'pick' | 'reading' | 'confirm'>('pick');
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [text, setText] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [useDate, setUseDate] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) {
      for (const f of files) URL.revokeObjectURL(f.url);
      setStep('pick');
      setFiles([]);
      setText('');
      setError('');
      setRows([]);
      setSheet(null);
    }
  }, [open]);

  const { places } = usePlaces(useMemo(() => rows.flatMap((r) => [r.collect, r.deliver]), [rows]));

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const images = [...list].filter((f) => f.type.startsWith('image/'));
    if (images.length < list.length) setError('Only pictures can be read. Other files were left out.');
    else setError('');
    setFiles((prev) => [...prev, ...images.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };

  const read = async () => {
    setError('');
    setStep('reading');
    try {
      const pages: SheetPage[] = [];
      if (files.length) {
        setProgress(`Reading screenshot 1 of ${files.length}…`);
        const { readScreenshots } = await import('../lib/ocr');
        pages.push(...(await readScreenshots(files.map((f) => f.file), (done, total) => setProgress(done < total ? `Reading screenshot ${done + 1} of ${total}…` : 'Checking postcodes…'))));
      }
      if (text.trim()) pages.push(pageFromText(text));
      const parsed = parseJobSheets(pages);
      if (!parsed.jobs.length) {
        setError(files.length ? 'No jobs were found in these screenshots. Make sure the job number and postcodes are in the picture, or type the job in by hand.' : 'No jobs were found in that text. Paste the whole email, or type the job in by hand.');
        setStep('pick');
        return;
      }
      setProgress('Checking postcodes…');
      const found = await lookupPostcodes(allPostcodeOptions(parsed));
      setRows(
        parsed.jobs.map((j) => {
          const stops = chooseStops(j, (p) => !!found[p]);
          return { key: uid(), include: true, ref: j.ref, collect: stops.collect, deliver: stops.deliver, carryover: false, inspection: !!j.inspection, sheetMiles: j.miles, reg: stops.reg, startTime: j.startTime, liftFrom: j.liftFrom };
        }),
      );
      setSheet(parsed);
      setUseDate(!!parsed.date && parsed.date >= todayLondon());
      setStep('confirm');
    } catch (err) {
      setError((err as Error).message || 'Something went wrong reading that. Try again, or type the job in by hand.');
      setStep('pick');
    }
  };

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const chosen = rows.filter((r) => r.include);
  const rowOk = (r: Row) => {
    const c = normPostcode(r.collect);
    const d = normPostcode(r.deliver);
    const deliverOk = !!d && !!places[d];
    return !!c && !!places[c] && (deliverOk || (r.carryover && !r.deliver.trim()));
  };
  const allOk = chosen.length > 0 && chosen.every(rowOk);

  const add = () => {
    onAdd({
      jobs: chosen.map((r) => ({ id: uid(), ref: r.ref.trim(), collect: normPostcode(r.collect) as string, deliver: normPostcode(r.deliver) ?? '', carryover: r.carryover, inspection: r.inspection, sheetMiles: r.sheetMiles, reg: r.reg, startTime: r.startTime, liftFrom: r.liftFrom })),
      date: useDate ? sheet?.date : undefined,
      callSign: sheet?.callSign,
      name: sheet?.driverName,
    });
    onClose();
  };

  return (
    <dialog ref={dialog} className="full-dialog" onClose={onClose} aria-labelledby="import-title">
      <div className="dialog-head">
        <h2 id="import-title">{step === 'confirm' ? 'Check these jobs' : `Add jobs${forWhom ? ` for ${forWhom}` : ''}`}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>

      {step === 'pick' && (
        <div className="dialog-scroll">
          <p className="muted">Add screenshots of your job email. If the jobs don't fit in one picture, add two, three or more, in order from top to bottom. They are read on this phone and are not uploaded.</p>
          <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
          {files.length > 0 && (
            <ul className="shots">
              {files.map((f, i) => (
                <li key={f.url}>
                  <img src={f.url} alt={`Screenshot ${i + 1}`} />
                  <span>{i + 1}</span>
                  <button type="button" className="icon-btn small" aria-label={`Remove screenshot ${i + 1}`} onClick={() => (URL.revokeObjectURL(f.url), setFiles((p) => p.filter((x) => x !== f)))}>
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="drop" onClick={() => picker.current?.click()}>
            <Icon name="image" size={20} />
            {files.length ? 'Add another screenshot' : 'Choose screenshots'}
          </button>
          <label className="paste">
            <span>Or paste the email text</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Paste the whole job email here" />
          </label>
          {error && <p className="hint bad">{error}</p>}
        </div>
      )}

      {step === 'reading' && (
        <div className="dialog-scroll center">
          <div className="spinner" aria-hidden="true" />
          <p role="status">{progress || 'Reading…'}</p>
          <p className="muted">The first read takes a little longer while the reader loads.</p>
        </div>
      )}

      {step === 'confirm' && (
        <div className="dialog-scroll">
          <p className="muted">
            {sheet?.date ? `Job sheet for ${fmtDate(sheet.date)}` : 'Job sheet'}
            {sheet?.callSign ? ` · ${sheet.callSign}` : ''}
            {sheet?.driverName ? ` ${sheet.driverName}` : ''}. Check each postcode against your sheet before adding.
          </p>
          {rows.map((r, i) => {
            const c = postcodeStatus(r.collect, places);
            const d = postcodeStatus(r.deliver, places);
            return (
              <fieldset key={r.key} className={`confirm-row${r.include ? '' : ' off'}`}>
                <legend>
                  <label className="toggle">
                    <input type="checkbox" checked={r.include} onChange={(e) => patch(r.key, { include: e.target.checked })} />
                    <span>
                      Job {i + 1}
                      {r.reg ? ` · ${r.reg}` : ''}
                      {r.startTime ? ` · start ${r.startTime}` : ''}
                      {r.liftFrom ? ` · lift from ${r.liftFrom}` : ''}
                      {r.sheetMiles != null ? ` · ${r.sheetMiles} mi` : ''}
                    </span>
                  </label>
                </legend>
                <label className="mini">
                  <span>Job number</span>
                  <input value={r.ref} onChange={(e) => patch(r.key, { ref: e.target.value })} inputMode="numeric" disabled={!r.include} />
                </label>
                <div className="stops">
                  <label className="mini">
                    <span>Collect from</span>
                    <input value={r.collect} onChange={(e) => patch(r.key, { collect: e.target.value.toUpperCase() })} disabled={!r.include} placeholder="Postcode" autoCapitalize="characters" spellCheck={false} />
                    <em className={c.tone}>{r.collect ? c.text : 'Not found on the sheet. Type it in.'}</em>
                  </label>
                  <button type="button" className="icon-btn" aria-label={`Swap collection and delivery for job ${i + 1}`} disabled={!r.include} onClick={() => patch(r.key, { collect: r.deliver, deliver: r.collect })}>
                    <Icon name="swap" />
                  </button>
                  <label className="mini">
                    <span>Deliver to</span>
                    <input value={r.deliver} onChange={(e) => patch(r.key, { deliver: e.target.value.toUpperCase() })} disabled={!r.include} placeholder={r.carryover ? 'Optional' : 'Postcode'} autoCapitalize="characters" spellCheck={false} />
                    <em className={d.tone}>{r.deliver ? d.text : r.carryover ? 'Delivered another day' : 'Not found on the sheet. Type it in.'}</em>
                  </label>
                </div>
                {r.include && (
                  <Toggle checked={r.carryover} onChange={(v) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, carryover: v } : v ? { ...x, carryover: false } : x)))}>
                    Carryover: the car goes home tonight
                  </Toggle>
                )}
                {r.include && showPay && (
                  <Toggle checked={r.inspection} onChange={(v) => patch(r.key, { inspection: v })}>
                    Inspection job
                  </Toggle>
                )}
              </fieldset>
            );
          })}
          {sheet?.date && (
            <Toggle checked={useDate} onChange={setUseDate}>
              Plan this for {fmtDate(sheet.date)}
              {sheet.date < todayLondon() ? ' (this date has passed)' : ''}
            </Toggle>
          )}
          {!allOk && chosen.length > 0 && <p className="hint bad">Fix the postcodes marked above, or untick a job to leave it out.</p>}
        </div>
      )}

      <div className="dialog-foot">
        {step === 'pick' && (
          <button type="button" className="btn dark wide" disabled={!files.length && !text.trim()} onClick={read}>
            {files.length ? `Read ${files.length} screenshot${files.length > 1 ? 's' : ''}` : 'Read jobs'}
          </button>
        )}
        {step === 'confirm' && (
          <>
            <button type="button" className="btn ghost" onClick={() => setStep('pick')}>
              Back
            </button>
            <button type="button" className="btn green grow" disabled={!allOk} onClick={add}>
              {chosen.length ? `Add ${chosen.length} job${chosen.length > 1 ? 's' : ''}` : 'Nothing ticked'}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
