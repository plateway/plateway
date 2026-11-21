import { pageFromBoxes, type BoxedWord } from './ocrPage';
import type { SheetPage } from './parseJobs';

/** Small screenshot text reads far better enlarged. Capped so phones do not run out of canvas memory. */
const TARGET_WIDTH = 2400;
const MAX_SCALE = 3;
const MAX_PIXELS = 12_000_000;

async function enlarge(file: File): Promise<HTMLCanvasElement> {
  const img = await createImageBitmap(file);
  let k = Math.min(MAX_SCALE, Math.max(1, TARGET_WIDTH / img.width));
  k = Math.min(k, Math.sqrt(MAX_PIXELS / (img.width * img.height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * k));
  canvas.height = Math.max(1, Math.round(img.height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not open the screenshot.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close();
  return canvas;
}

type OcrLine = { words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] };
type OcrBlock = { paragraphs: { lines: OcrLine[] }[] };

/**
 * Reads the words off each screenshot, in the order given. The reading runs
 * on this device: the screenshots are not uploaded anywhere.
 */
export async function readScreenshots(files: File[], onProgress: (done: number, total: number) => void): Promise<SheetPage[]> {
  const { createWorker, PSM } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    // Sparse mode finds text wherever it sits, which suits a table better than paragraph mode.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const pages: SheetPage[] = [];
    for (let i = 0; i < files.length; i++) {
      const canvas = await enlarge(files[i]);
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      const words: BoxedWord[] = ((data.blocks ?? []) as OcrBlock[]).flatMap((b) =>
        b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words.map((w) => ({ text: w.text, ...w.bbox })))),
      );
      pages.push(pageFromBoxes(words, canvas.width));
      onProgress(i + 1, files.length);
    }
    return pages;
  } finally {
    await worker.terminate();
  }
}
