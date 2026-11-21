import { normPostcode } from './postcodes';

/**
 * Reads "Driver Work and StartTimes" job sheets, the daily job email some
 * vehicle logistics firms send their drivers, from pasted email text
 * or from words read off screenshots. Screenshots are passed in order, so a
 * job cut off at the bottom of one carries on at the top of the next.
 */

export type SheetWord = {
  text: string;
  /** Row on the page, top to bottom. */
  line: number;
  /** Left edge as a share of the page width. Only known for screenshots. */
  x?: number;
};

export type SheetPage = { words: SheetWord[] };

export type StopGuess = {
  /** The text as read, without spaces. */
  raw: string;
  /** Postcodes this could be, most likely first. Misread letters give more than one. */
  options: string[];
  column?: 'collect' | 'deliver' | 'other';
};

export type ParsedJob = {
  ref: string;
  /** Every postcode seen in this job's part of the sheet, in reading order. */
  stops: StopGuess[];
  reg?: string;
  startTime?: string;
  liftFrom?: string;
  /** The distance column, when it is on the job's row. */
  miles?: number;
  /** True when the sheet names an inspector to meet. */
  inspection?: boolean;
};

export type ParsedSheet = {
  date?: string;
  callSign?: string;
  driverName?: string;
  jobs: ParsedJob[];
};

export function pageFromText(text: string): SheetPage {
  const words: SheetWord[] = [];
  text.split(/\r?\n/).forEach((row, line) => {
    for (const w of row.split(/\s+/)) if (w) words.push({ text: w, line });
  });
  return { words };
}

// "Job1 12000001" or "16:00:00 12000004". Screenshot reading can turn the 1 in Job1 into l, I or !.
const ANCHOR = /(?:\bJob\s?[0-9lIi!|]{1,2}|(?<![\d:])(\d{1,2}:\d{2}(?::\d{2})?))\s+(\d{7,9})(?![\d/])/g;
const BARE_ANCHOR = /(?:^|\n)\s*()(\d{8})(?![\d/])/g;
const REG = /\b([A-Z]{2}\d{2}\s?[A-Z]{3})\b/;
const LIFT = /Lift\s*from\s*:?\s*([A-Za-z][A-Za-z .'&]{0,28}[A-Za-z])/i;
const MEET_INSPECTOR = /Meet\s*Insp\w*\s*:?[ \t]*([^\s:-][^\n]*)/i;
const MILES = /^\d{1,3}\.\d$/;
const COLUMN_SLACK = 0.03;
// Anything shaped roughly like a postcode, including ones a screenshot reader got slightly wrong ("WE6 1FL", "TS17 OEY").
const POSTCODE_LIKE = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,3})[ \t]?([0-9OIlSBZ][A-Z01258]{2})(?![A-Za-z0-9])/g;

const LOOKALIKES: Record<string, string[]> = {
  O: ['0'], '0': ['O'], I: ['1'], '1': ['I'], L: ['1'], S: ['5', '6'], '5': ['S'], '6': ['G', 'S'], G: ['6'],
  E: ['F'], F: ['E'], B: ['8'], '8': ['B'], Z: ['2'], '2': ['Z'], Q: ['0'], D: ['0'], U: ['V'], V: ['U'],
};
const TO_DIGIT: Record<string, string> = { O: '0', I: '1', L: '1', l: '1', S: '5', B: '8', Z: '2' };
const TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z' };

/**
 * Postcodes a piece of text could be, allowing for look-alike characters
 * being misread. The text as read comes first when it is a valid shape.
 */
export function postcodeOptions(outward: string, inward: string): string[] {
  const inFixed = (TO_DIGIT[inward[0]] ?? inward[0]) + (TO_LETTER[inward[1]] ?? inward[1]) + (TO_LETTER[inward[2]] ?? inward[2]);
  const outs: string[] = [outward];
  const swapAt = (base: string, from: number) => {
    const made: [string, number][] = [];
    for (let i = from; i < base.length; i++) for (const alt of LOOKALIKES[base[i]] ?? []) made.push([base.slice(0, i) + alt + base.slice(i + 1), i]);
    return made;
  };
  const singles = swapAt(outward, 0);
  outs.push(...singles.map(([o]) => o));
  for (const [o, i] of singles) outs.push(...swapAt(o, i + 1).map(([x]) => x));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of outs) {
    const pc = normPostcode(o + inFixed);
    if (pc && !seen.has(pc)) {
      seen.add(pc);
      out.push(pc);
    }
  }
  return out.slice(0, 40);
}

type Flat = { text: string; starts: number[]; words: (SheetWord & { page: number })[] };

function flatten(pages: SheetPage[]): Flat {
  const words: Flat['words'] = [];
  const starts: number[] = [];
  let text = '';
  pages.forEach((page, p) => {
    let prevLine = -1;
    for (const w of page.words) {
      if (words.length) text += prevLine === w.line && words[words.length - 1].page === p ? ' ' : '\n';
      starts.push(text.length);
      text += w.text;
      words.push({ ...w, page: p });
      prevLine = w.line;
    }
  });
  return { text, starts, words };
}

function wordAt(flat: Flat, offset: number): number {
  let lo = 0;
  let hi = flat.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (flat.starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

type Columns = { collect: number; deliver: number; distance?: number };

/** Finds where the "Collection From" and "Deliver To" columns start on each screenshot. */
function findColumns(flat: Flat, pageCount: number): (Columns | null)[] {
  const out: (Columns | null)[] = new Array(pageCount).fill(null);
  for (let i = 0; i < flat.words.length - 1; i++) {
    const w = flat.words[i];
    const next = flat.words[i + 1];
    if (w.x == null || next.page !== w.page || next.line !== w.line) continue;
    if (/^Collect(ion)?$/i.test(w.text) && /^From$/i.test(next.text)) {
      const rest = flat.words.filter((o) => o.page === w.page && o.line === w.line && o.x != null);
      const deliver = rest.find((o) => /^Deliver(y)?$/i.test(o.text) && (o.x as number) > (w.x as number));
      const distance = rest.find((o) => /^Distance$/i.test(o.text));
      if (deliver) out[w.page] = { collect: w.x, deliver: deliver.x as number, distance: distance?.x };
    }
  }
  return out;
}

function header(text: string): Pick<ParsedSheet, 'date' | 'callSign' | 'driverName'> {
  const out: Pick<ParsedSheet, 'date' | 'callSign' | 'driverName'> = {};
  const date = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (date) out.date = `${date[3]}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}`;
  const sign = /(?<![A-Za-z0-9])([A-Z]{2}\d{3})(?![A-Za-z0-9])/.exec(text);
  if (sign) {
    out.callSign = sign[1];
    const after = text.slice(sign.index + sign[0].length, sign.index + sign[0].length + 60);
    const name = after.match(/^\s*((?:[A-Z][a-zA-Z'-]+\s?){1,3})/);
    if (name) out.driverName = name[1].trim();
  }
  return out;
}

export function parseJobSheets(pages: SheetPage[]): ParsedSheet {
  const flat = flatten(pages);
  const columns = findColumns(flat, pages.length);

  let anchors = [...flat.text.matchAll(ANCHOR)];
  if (!anchors.length) anchors = [...flat.text.matchAll(BARE_ANCHOR)];

  const sheet: ParsedSheet = { ...header(anchors.length ? flat.text.slice(0, anchors[0].index) : flat.text), jobs: [] };
  const byRef = new Map<string, ParsedJob>();

  anchors.forEach((m, i) => {
    const from = m.index as number;
    const to = i + 1 < anchors.length ? (anchors[i + 1].index as number) : flat.text.length;
    const segment = flat.text.slice(from, to);
    const ref = m[2];
    let job = byRef.get(ref);
    if (!job) {
      job = { ref, stops: [] };
      byRef.set(ref, job);
      sheet.jobs.push(job);
    }
    if (m[1] && !job.startTime) job.startTime = m[1].slice(0, 5);

    for (const pc of segment.matchAll(POSTCODE_LIKE)) {
      const options = postcodeOptions(pc[1], pc[2]);
      if (!options.length) continue;
      const raw = pc[1] + pc[2];
      const word = flat.words[wordAt(flat, from + (pc.index as number))];
      const cols = columns[word.page];
      let column: StopGuess['column'];
      if (cols && word.x != null) {
        if (cols.distance != null && word.x >= cols.distance - COLUMN_SLACK) column = 'other';
        else if (word.x >= cols.deliver - COLUMN_SLACK) column = 'deliver';
        else if (word.x >= cols.collect - COLUMN_SLACK) column = 'collect';
        else column = 'other';
      }
      if (!job.stops.some((s) => s.raw === raw && s.column === column)) job.stops.push({ raw, options, column });
    }

    if (!job.reg) {
      const reg = segment.slice(m[0].length, m[0].length + 40).match(REG);
      if (reg) job.reg = reg[1].replace(/\s/g, '');
    }
    if (!job.liftFrom) {
      const lift = segment.match(LIFT);
      if (lift) job.liftFrom = lift[1].trim();
    }
    if (job.miles == null) {
      // The distance is the last "74.0"-shaped figure on the job's own row.
      const first = wordAt(flat, from);
      const row = flat.words.filter((w, i) => i > first && w.page === flat.words[first].page && w.line === flat.words[first].line && i <= wordAt(flat, to - 1));
      const figure = row.filter((w) => MILES.test(w.text)).pop();
      if (figure) job.miles = Number(figure.text);
    }
    if (MEET_INSPECTOR.test(segment)) job.inspection = true;
  });
  return sheet;
}

/** Every postcode the sheet might contain, for checking against the postcode lookup in one go. */
export function allPostcodeOptions(sheet: ParsedSheet): string[] {
  return [...new Set(sheet.jobs.flatMap((j) => j.stops.flatMap((s) => s.options)))];
}

/**
 * Picks the collection and delivery postcode for a job. `exists` says whether
 * a postcode is real, which settles misread letters and weeds out look-alikes
 * such as model names.
 */
export function chooseStops(job: ParsedJob, exists: (postcode: string) => boolean): { collect: string; deliver: string; reg?: string } {
  const real = job.stops
    .filter((s) => s.column !== 'other')
    .map((s) => ({ ...s, postcode: s.options.find(exists) }))
    .filter((s): s is StopGuess & { postcode: string } => !!s.postcode);
  const collect = real.find((s) => s.column === 'collect') ?? real.find((s) => s.column == null);
  const others = real.filter((s) => s !== collect && s.postcode !== collect?.postcode);
  const deliver = others.find((s) => s.column === 'deliver') ?? others.find((s) => s.column == null) ?? others[0];
  // A postcode with its space missing can look like a registration; do not report it as both.
  const used = new Set([collect?.raw, deliver?.raw]);
  const reg = job.reg && !used.has(job.reg) ? job.reg : undefined;
  return { collect: collect?.postcode ?? '', deliver: deliver?.postcode ?? '', reg };
}
