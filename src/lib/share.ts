import { fmtDate, fmtDur, fmtMiles, fmtTime } from './time';
import type { DriverLane, LiftPlan, TeamDriver } from './types';

/** A plain-text plan a lift driver can send to one of their drivers. */
export function lanePlanText(driver: TeamDriver, lane: DriverLane, plan: LiftPlan, date: string): string {
  const who = [driver.callSign, driver.name].filter(Boolean).join(' ') || 'Driver';
  const lines = [`${who}: lift plan for ${fmtDate(date)}`, `${fmtTime(plan.leave)} Leave ${plan.stops[0].place.postcode || 'the start'} in the lift car`];
  for (const j of lane.jobs) {
    const ref = driver.jobs.find((x) => x.id === j.jobId)?.ref;
    const tag = ref ? ` (job ${ref})` : '';
    if (j.carryover) {
      lines.push(`${fmtTime(j.droppedAt)} Dropped at ${j.from.postcode}${tag}. Carryover: take it home.`);
      continue;
    }
    lines.push(`${fmtTime(j.droppedAt)} Dropped at ${j.from.postcode}${tag}. Drive to ${j.to?.postcode}, ${fmtMiles(j.miles)}, about ${fmtDur(j.mins)}.`);
    if (j.pickedAt != null) {
      const wait = (j.pickedAt - j.readyAt) / 60_000;
      lines.push(`${fmtTime(j.pickedAt)} Picked up at ${j.to?.postcode}${wait >= 10 ? ` (about ${fmtDur(wait)} wait)` : ''}.`);
    }
    if (j.ownWay) lines.push(`${fmtTime(j.readyAt)} Done at ${j.to?.postcode}. Make your own way home from there.`);
  }
  const last = lane.jobs[lane.jobs.length - 1];
  if (last && !last.carryover && !last.ownWay) lines.push(`${fmtTime(plan.finish)} Back at the start.`);
  lines.push('Times are estimates from normal road speeds.');
  return lines.join('\n');
}

/** Opens the phone's share sheet, or copies the text where there is none. Returns what happened. */
export async function shareText(text: string, title: string): Promise<'shared' | 'copied' | 'failed'> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'shared';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
