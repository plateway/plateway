import type { SheetPage, SheetWord } from './parseJobs';

export type BoxedWord = { text: string; x0: number; y0: number; x1: number; y1: number };

/**
 * Rebuilds the visual rows of a screenshot from loose word boxes. Text
 * readers often split a table into columns; grouping by height on the page
 * puts each table row back on one line, left to right.
 */
export function pageFromBoxes(words: BoxedWord[], pageWidth: number): SheetPage {
  const clean = words.filter((w) => w.text.trim() && w.y1 > w.y0);
  if (!clean.length) return { words: [] };
  const heights = clean.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)];
  const sorted = [...clean].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const rows: BoxedWord[][] = [];
  let rowMid = Number.NEGATIVE_INFINITY;
  for (const w of sorted) {
    const mid = (w.y0 + w.y1) / 2;
    if (mid - rowMid > typical * 0.6) {
      rows.push([]);
      rowMid = mid;
    }
    const row = rows[rows.length - 1];
    row.push(w);
    rowMid = row.reduce((s, x) => s + (x.y0 + x.y1) / 2, 0) / row.length;
  }
  const out: SheetWord[] = [];
  rows.forEach((row, line) => {
    for (const w of row.sort((a, b) => a.x0 - b.x0)) out.push({ text: w.text.trim(), line, x: w.x0 / pageWidth });
  });
  return { words: out };
}
