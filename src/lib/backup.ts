import type { Rates } from './pay';
import type { Job, TeamDriver } from './types';

export type Backup = { app: 'plateway'; version: 1; savedAt: string; jobs: Job[]; rates: Rates; liftDrivers?: TeamDriver[] };

/** Checks a file really is a Plateway backup. Returns a reason when it is not. */
export function readBackup(text: string): Backup | string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return "That file isn't a Plateway backup.";
  }
  const b = data as Partial<Backup>;
  if (b?.app !== 'plateway' || !Array.isArray(b.jobs) || !b.rates) return "That file isn't a Plateway backup.";
  if (b.version !== 1) return 'That backup is from a newer version of Plateway. Update the app and try again.';
  const ok = b.jobs.every((j) => j && typeof j.id === 'string' && typeof j.collect === 'string');
  if (!ok) return 'That backup looks damaged, so nothing was changed.';
  return b as Backup;
}

