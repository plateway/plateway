import { addDays } from './time';
import type { Job } from './types';

/**
 * What a job pays. The defaults are rates a UK trade-plate driver described;
 * every figure can be changed in the app, because rates differ and change.
 */
export type Rates = {
  /** Pounds for each move, covering the first `includedMiles`. */
  perMove: number;
  includedMiles: number;
  /** Pounds for each mile beyond `includedMiles`. */
  perMileAfter: number;
  /** Pounds added when the job is an inspection. */
  inspection: number;
  /** The usual range offered for a failed job. The driver types the actual figure. */
  failedMin: number;
  failedMax: number;
};

/** Checked against a real job: 221 miles paid £52.20, which is £20 + 161 miles × 20p. */
export const DEFAULT_RATES: Rates = { perMove: 20, includedMiles: 60, perMileAfter: 0.2, inspection: 8, failedMin: 10, failedMax: 35 };

export type PayLine = { label: string; amount: number };

export type Pay = {
  total: number;
  lines: PayLine[];
  /** Set when the figure is not final, with the reason. */
  waiting?: 'carryover' | 'failed-amount' | 'miles';
};

const pence = (n: number) => Math.round(n * 100) / 100;

/** The miles a job is paid on: what the driver typed, else the job sheet, else the road distance. */
export function paidMiles(job: Job): number | null {
  return job.paidMiles ?? job.sheetMiles ?? job.roadMiles ?? null;
}

/** Pays a job at the rate it was settled at, or at the current rate if it is still to do. */
export function payFor(job: Job, current: Rates): Pay {
  const rates = job.rates ?? current;
  const extra: PayLine[] = job.extraPay ? [{ label: 'Other', amount: job.extraPay }] : [];
  const finish = (lines: PayLine[], waiting?: Pay['waiting']): Pay => ({ lines, total: pence(lines.reduce((s, l) => s + l.amount, 0)), waiting });

  if (job.status === 'failed') {
    if (job.failedPay == null) return finish(extra, 'failed-amount');
    return finish([{ label: 'Failed job', amount: job.failedPay }, ...extra]);
  }
  // A carryover is paid when the car is delivered, not on the day it goes home.
  if (job.carryover) return finish(extra, 'carryover');

  const lines: PayLine[] = [{ label: 'Move', amount: rates.perMove }];
  const miles = paidMiles(job);
  if (miles != null && miles > rates.includedMiles) {
    const over = Math.round((miles - rates.includedMiles) * 10) / 10;
    lines.push({ label: `${over} mi over ${rates.includedMiles}`, amount: pence(over * rates.perMileAfter) });
  }
  if (job.inspection) lines.push({ label: 'Inspection', amount: rates.inspection });
  return finish([...lines, ...extra], miles == null ? 'miles' : undefined);
}

export function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}£${Math.abs(n).toFixed(2)}`;
}

/** The Monday of the week a date falls in. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

export type Totals = {
  jobs: number;
  done: number;
  failed: number;
  todo: number;
  /** Pay for jobs marked done or failed. */
  earned: number;
  /** Pay still to come from jobs not yet marked. */
  toCome: number;
  /** Miles on jobs marked done. */
  miles: number;
};

export function totals(jobs: Job[], rates: Rates): Totals {
  const t: Totals = { jobs: jobs.length, done: 0, failed: 0, todo: 0, earned: 0, toCome: 0, miles: 0 };
  for (const job of jobs) {
    const pay = payFor(job, rates).total;
    if (job.status === 'done') {
      t.done++;
      t.earned += pay;
      t.miles += paidMiles(job) ?? 0;
    } else if (job.status === 'failed') {
      t.failed++;
      t.earned += pay;
    } else {
      t.todo++;
      t.toCome += pay;
    }
  }
  t.earned = pence(t.earned);
  t.toCome = pence(t.toCome);
  t.miles = Math.round(t.miles * 10) / 10;
  return t;
}
