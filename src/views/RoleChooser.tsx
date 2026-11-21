import { APP_NAME } from '../brand';
import { AboutButton } from '../components/About';
import { InstallCard } from '../components/InstallCard';
import { useStore, type Role } from '../store';

export const ROLE_NAME: Record<Role, string> = { driver: 'Plate driver', lift: 'Lift driver' };

const CHOICES: { id: Role; about: string }[] = [
  { id: 'driver', about: 'Plan your own jobs: the best order, the times, and how you get between them.' },
  { id: 'lift', about: 'Plan a run for the drivers you carry: who to drop and collect, in the best order.' },
];

/** One road for a plate driver; one car calling at several drivers for a lift driver. */
function Picture({ role }: { role: Role }) {
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#0B0B0B" />
      {role === 'driver' ? (
        <>
          <path d="M20 20C20 38 44 28 44 44" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
          <circle cx="20" cy="20" r="5" fill="#0B0B0B" stroke="#fff" strokeWidth="3.5" />
          <circle cx="44" cy="44" r="6.5" fill="#06C167" />
        </>
      ) : (
        <>
          <path d="M16 46L26 22L40 40L48 18" fill="none" stroke="#276EF1" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="16" cy="46" r="5.5" fill="#06C167" />
          <circle cx="26" cy="22" r="5" fill="#fff" />
          <circle cx="40" cy="40" r="5" fill="#fff" />
          <circle cx="48" cy="18" r="5" fill="#fff" />
        </>
      )}
    </svg>
  );
}

export function RoleChooser() {
  const chooseRole = useStore((s) => s.chooseRole);
  const current = useStore((s) => s.role);
  const returning = useStore((s) => s.driver.jobs.length > 0 || s.lift.drivers.length > 0);
  return (
    <main className="chooser">
      <p className="brand">{APP_NAME}</p>
      <h1>Who's planning today?</h1>
      <div className="choices">
        {CHOICES.map((c) => (
          <button key={c.id} type="button" className="choice" onClick={() => chooseRole(c.id)}>
            <Picture role={c.id} />
            <span className="choice-text">
              <b>{ROLE_NAME[c.id]}</b>
              <span>{c.about}</span>
              {returning && current === c.id && <em>Last time</em>}
            </span>
            <svg className="choice-go" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
      <p className="muted">You can switch at any time. Your jobs are kept for each.</p>
      <InstallCard />
      <p className="muted">
        Not connected to any logistics company. <AboutButton />
      </p>
    </main>
  );
}
