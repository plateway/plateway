import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { NAV_APPS, navLink, type TravelBy } from '../lib/links';
import { nearestPostcode, normPostcode } from '../lib/postcodes';
import type { Coords, Job, Place } from '../lib/types';
import { uid, useStore, type StartPoint } from '../store';
import type { Places } from '../hooks';

/* ---------- icons ---------- */

const paths: Record<string, ReactNode> = {
  back: <path d="M15 5l-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  up: <path d="M6 14l6-6 6 6" />,
  down: <path d="M6 10l6 6 6-6" />,
  swap: <path d="M7 4v16m0 0l-3-3m3 3l3-3M17 20V4m0 0l-3 3m3-3l3 3" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" />,
  locate: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </>
  ),
  nav: <path d="M20 4L4 11l7 2 2 7 7-16z" />,
  share: <path d="M12 15V4m0 0L8 8m4-4l4 4M5 13v6h14v-6" />,
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 16l5-5 4 4 3-3 6 6" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/* ---------- small controls ---------- */

export function Segmented<T extends string>({ options, value, onChange, label, flat, wide }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; flat?: boolean; wide?: boolean }) {
  return (
    <div className={`seg${flat ? ' flat' : ''}${wide ? ' wide' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className={o.id === value ? 'on' : ''} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/* ---------- toast ---------- */

type ToastAction = { label: string; run: () => void };
const useToast = create<{ text: string | null; action?: ToastAction; id: number; show: (text: string, action?: ToastAction) => void; hide: () => void }>((set, get) => ({
  text: null,
  id: 0,
  show: (text, action) => {
    const id = get().id + 1;
    set({ text, action, id });
    // Longer when there is something to undo, so there is time to reach it.
    setTimeout(() => get().id === id && set({ text: null, action: undefined }), action ? 7000 : 3200);
  },
  hide: () => set({ text: null, action: undefined }),
}));
export const toast = (text: string, action?: ToastAction) => useToast.getState().show(text, action);

export function Toast() {
  const { text, action, hide } = useToast();
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {text && (
        <div className="toast">
          <span>{text}</span>
          {action && (
            <button type="button" className="toast-act" onClick={() => (action.run(), hide())}>
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- start point ---------- */

/** What to say under a postcode box. */
export function postcodeStatus(value: string, places: Places): { tone: 'ok' | 'bad' | 'wait' | 'none'; text: string } {
  if (!value.trim()) return { tone: 'none', text: '' };
  const pc = normPostcode(value);
  if (!pc) return { tone: value.trim().length >= 5 ? 'bad' : 'none', text: value.trim().length >= 5 ? "That doesn't look like a full UK postcode." : '' };
  const place = places[pc];
  if (place === undefined) return { tone: 'wait', text: 'Checking…' };
  if (place === null) return { tone: 'bad', text: `We can't find ${pc}. Check it and try again.` };
  return { tone: 'ok', text: place.area ?? 'Found' };
}

export function StartField({ label, value, onChange, places, allowGps = true }: { label: string; value: StartPoint; onChange: (v: StartPoint) => void; places: Places; allowGps?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const id = useRef(`start-${uid()}`).current;
  const status = value.place && !value.postcode ? { tone: 'ok' as const, text: 'Using your current location' } : postcodeStatus(value.postcode, places);

  const locate = () => {
    if (!navigator.geolocation) {
      setGpsError('This device cannot share its location. Type a postcode instead.');
      return;
    }
    setBusy(true);
    setGpsError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        try {
          const near = await nearestPostcode(lat, lon);
          onChange({ postcode: near?.postcode ?? '', place: { postcode: near?.postcode ?? '', lat, lon, area: near?.area } });
        } catch {
          onChange({ postcode: '', place: { postcode: '', lat, lon } });
        }
        setBusy(false);
      },
      (err) => {
        setBusy(false);
        setGpsError(err.code === err.PERMISSION_DENIED ? 'Location is switched off for this site. Allow it in your browser settings, or type a postcode.' : 'Could not get your location. Try again, or type a postcode.');
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  };

  return (
    <div className="field-block">
      <div className={`field start${status.tone === 'bad' ? ' bad' : ''}`}>
        <div className="field-main">
          <label htmlFor={id}>{label}</label>
          <input
            id={id}
            value={value.postcode}
            placeholder={value.place && !value.postcode ? 'My location' : 'Postcode'}
            autoCapitalize="characters"
            autoComplete="postal-code"
            spellCheck={false}
            onChange={(e) => onChange({ postcode: e.target.value.toUpperCase(), place: null })}
            onBlur={() => {
              const pc = normPostcode(value.postcode);
              if (pc && pc !== value.postcode) onChange({ postcode: pc, place: null });
            }}
          />
        </div>
        {allowGps && (
          <button type="button" className="chip-btn" onClick={locate} disabled={busy}>
            <Icon name="locate" size={16} />
            {busy ? 'Finding you…' : 'Use my location'}
          </button>
        )}
      </div>
      {(gpsError || status.text) && <p className={`hint ${gpsError ? 'bad' : status.tone}`}>{gpsError || status.text}</p>}
    </div>
  );
}

/* ---------- job form ---------- */

export function JobForm({ initial, onSave, onCancel, saveLabel, withPay }: { initial?: Job; onSave: (job: Job) => void; onCancel?: () => void; saveLabel: string; withPay?: boolean }) {
  const [collect, setCollect] = useState(initial?.collect ?? '');
  const [deliver, setDeliver] = useState(initial?.deliver ?? '');
  const [ref, setRef] = useState(initial?.ref ?? '');
  const [miles, setMiles] = useState(initial?.sheetMiles != null ? String(initial.sheetMiles) : '');
  const [carryover, setCarryover] = useState(initial?.carryover ?? false);
  const [inspection, setInspection] = useState(initial?.inspection ?? false);
  const [error, setError] = useState('');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const c = normPostcode(collect);
    const d = deliver.trim() ? normPostcode(deliver) : '';
    if (!c) return setError('Enter the full collection postcode, like TS3 8AT.');
    if (!carryover && !d) return setError('Enter the full delivery postcode, or tick carryover if the car is going home with you.');
    if (d === null) return setError('Check the delivery postcode, or leave it empty for now.');
    const sheetMiles = miles.trim() ? Number(miles) : undefined;
    if (sheetMiles != null && !(sheetMiles >= 0 && sheetMiles < 1000)) return setError('Miles should be a number, like 74.');
    onSave({ ...initial, id: initial?.id ?? uid(), ref: ref.trim(), collect: c, deliver: d ?? '', carryover, ...(withPay ? { sheetMiles, inspection } : {}) });
  };

  return (
    <form className="job-form" onSubmit={submit} noValidate>
      <div className="row2">
        <label>
          <span>Collect from</span>
          <input ref={first} value={collect} onChange={(e) => setCollect(e.target.value.toUpperCase())} placeholder="Postcode" autoCapitalize="characters" spellCheck={false} />
        </label>
        <label>
          <span>{carryover ? 'Deliver to, later' : 'Deliver to'}</span>
          <input value={deliver} onChange={(e) => setDeliver(e.target.value.toUpperCase())} placeholder={carryover ? 'Optional' : 'Postcode'} autoCapitalize="characters" spellCheck={false} />
        </label>
      </div>
      <div className={withPay ? 'row2' : undefined}>
        <label>
          <span>Job number (optional)</span>
          <input value={ref} onChange={(e) => setRef(e.target.value)} inputMode="numeric" placeholder="12345678" />
        </label>
        {withPay && (
          <label>
            <span>Miles on sheet (optional)</span>
            <input value={miles} onChange={(e) => setMiles(e.target.value)} inputMode="decimal" placeholder="74" />
          </label>
        )}
      </div>
      <Toggle checked={carryover} onChange={setCarryover}>
        Carryover: the car goes home tonight
      </Toggle>
      {withPay && (
        <Toggle checked={inspection} onChange={setInspection}>
          Inspection job
        </Toggle>
      )}
      {error && <p className="hint bad">{error}</p>}
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn dark">
          {saveLabel}
        </button>
      </div>
    </form>
  );
}

/* ---------- open in another maps app ---------- */

type NavTarget = { to: Place; from?: Place; by: TravelBy; via?: Place[]; title: string };
const useNav = create<{ target: NavTarget | null; open: (t: NavTarget) => void; close: () => void }>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
export const openNav = (t: NavTarget) => useNav.getState().open(t);

export function NavDialog() {
  const { target, close } = useNav();
  const preferred = useStore((s) => s.navApp);
  const setNavApp = useStore((s) => s.setNavApp);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (target && !d.open) d.showModal();
    if (!target && d.open) d.close();
  }, [target]);

  const apps = [...NAV_APPS].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  return (
    <dialog ref={ref} className="sheet-dialog" onClose={close} onClick={(e) => e.target === ref.current && close()}>
      {target && (
        <div className="dialog-body">
          <h2>Open directions</h2>
          <p className="muted">{target.title}</p>
          <div className="nav-list">
            {apps.map((app) => {
              const drivingOnly = app.id === 'waze' && target.by !== 'drive';
              if (drivingOnly) return null;
              return (
                <a
                  key={app.id}
                  className="nav-app"
                  href={navLink(app.id, target.to, { from: target.from, by: target.by, via: target.via })}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    setNavApp(app.id);
                    close();
                  }}
                >
                  <span>{app.name}</span>
                  {app.id === preferred && <em>Last used</em>}
                  <Icon name="nav" size={16} />
                </a>
              );
            })}
            {target.to.postcode && (
              <button
                type="button"
                className="nav-app"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(target.to.postcode);
                    toast(`Copied ${target.to.postcode}`);
                  } catch {
                    toast('Could not copy. The postcode is ' + target.to.postcode);
                  }
                  close();
                }}
              >
                <span>Copy postcode {target.to.postcode}</span>
              </button>
            )}
          </div>
          <button type="button" className="btn ghost wide" onClick={close}>
            Close
          </button>
        </div>
      )}
    </dialog>
  );
}

/* ---------- a job's road shape as a small picture ---------- */

export function RouteThumb({ coords, label }: { coords: Coords | undefined; label: string }) {
  if (!coords || coords.length < 2) return <div className="thumb empty">{label}</div>;
  const lat0 = coords[0][1];
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = coords.map((c) => c[0] * kx);
  const ys = coords.map((c) => -c[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const pad = 9;
  const size = 56 - pad * 2;
  const ox = pad + (size - ((Math.max(...xs) - minX) / span) * size) / 2;
  const oy = pad + (size - ((Math.max(...ys) - minY) / span) * size) / 2;
  const step = Math.max(1, Math.floor(coords.length / 60));
  const pts = coords
    .filter((_, i) => i % step === 0 || i === coords.length - 1)
    .map((c) => `${(ox + ((c[0] * kx - minX) / span) * size).toFixed(1)},${(oy + ((-c[1] - minY) / span) * size).toFixed(1)}`);
  const [sx, sy] = pts[0].split(',');
  const [ex, ey] = pts[pts.length - 1].split(',');
  return (
    <svg className="thumb" viewBox="0 0 56 56" role="img" aria-label={`Road shape of job ${label}`}>
      <polyline points={pts.join(' ')} fill="none" stroke="#0B0B0B" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={sx} cy={sy} r="3.4" fill="#fff" stroke="#0B0B0B" strokeWidth="2" />
      <circle cx={ex} cy={ey} r="4" fill="#0B0B0B" />
    </svg>
  );
}
