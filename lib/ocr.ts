"use client";
// The KOT printer's eyes: tesseract.js v5 in its own worker, fed one band of the bill at a time so lines really
// arrive in order while it reads. Everything here stays on the phone; the photo and its crops are never uploaded.

export interface OcrLine {
  text: string;
  /** the lowest confidence of any number on the line, 0-100 */
  numConf: number;
  /** the line's box on the prepared photo */
  box: { x: number; y: number; w: number; h: number };
}
export interface OcrPhoto {
  canvas: HTMLCanvasElement;
  lines: OcrLine[];
  /** share of letters outside ASCII, and the mean confidence: together they hint at a Hindi bill */
  nonAscii: number;
  meanConf: number;
}

type TWord = { text: string; confidence: number };
type TLine = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number }; words?: TWord[] };
type TResult = { data: { text: string; confidence: number; lines?: TLine[] } };
type TWorker = { recognize: (img: HTMLCanvasElement) => Promise<TResult>; terminate: () => Promise<void> };
type TLog = { status: string; progress: number };
type TesseractNS = { createWorker: (langs: string, oem: number, o: { logger: (m: TLog) => void }) => Promise<TWorker> };

const SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

function loadScript(): Promise<TesseractNS> {
  const w = window as unknown as { Tesseract?: TesseractNS };
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => (w.Tesseract ? res(w.Tesseract) : rej(new Error("ocr")));
    s.onerror = () => rej(new Error("ocr"));
    document.head.appendChild(s);
  });
}

/** Rotate by EXIF, scale the long edge to 1600 px, grey it and stretch contrast between the 2nd and 98th percentile. */
export async function preparePhoto(file: Blob): Promise<HTMLCanvasElement> {
  let src: CanvasImageSource & { width: number; height: number };
  try {
    src = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    src = await new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("image"));
      img.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, 1600 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(src, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = y;
    hist[d[i]]++;
  }
  const n = w * h;
  let lo = 0;
  let hi = 255;
  for (let v = 0, acc = 0; v < 256; v++) if ((acc += hist[v]) >= n * 0.02) { lo = v; break; }
  for (let v = 255, acc = 0; v >= 0; v--) if ((acc += hist[v]) >= n * 0.02) { hi = v; break; }
  const span = Math.max(24, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Split the prepared photo into at most 8 horizontal bands of text by counting dark pixels per row. */
export function textBands(c: HTMLCanvasElement): { top: number; height: number }[] {
  const { width: w, height: h } = c;
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const ink: boolean[] = [];
  for (let y = 0; y < h; y++) {
    let dark = 0;
    for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4] < 110) dark++;
    ink.push(dark / Math.ceil(w / 2) > 0.008);
  }
  const rows: [number, number][] = [];
  let start = -1;
  let gap = 0;
  for (let y = 0; y < h; y++) {
    if (ink[y]) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0 && ++gap >= 3) {
      if (y - gap - start >= 5) rows.push([start, y - gap]);
      start = -1;
      gap = 0;
    }
  }
  if (start >= 0 && h - start >= 5) rows.push([start, h - 1]);
  if (rows.length < 2) return [{ top: 0, height: h }];
  const per = Math.ceil(rows.length / 8);
  const groups: [number, number][] = [];
  for (let k = 0; k < rows.length; k += per) groups.push([rows[k][0], rows[Math.min(rows.length - 1, k + per - 1)][1]]);
  // cut halfway between groups so no line is sliced
  return groups.map(([a, b], k) => {
    const top = k === 0 ? 0 : Math.floor((groups[k - 1][1] + a) / 2);
    const bottom = k === groups.length - 1 ? h : Math.floor((b + groups[k + 1][0]) / 2);
    return { top, height: Math.max(8, bottom - top) };
  });
}

/** A line's box from the prepared photo, padded 6 px, as a small image held in memory. */
export function cropLine(c: HTMLCanvasElement, box: OcrLine["box"]): string {
  const pad = 6;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const w = Math.min(c.width - x, box.w + pad * 2);
  const h = Math.min(c.height - y, box.h + pad * 2);
  if (w < 4 || h < 4) return "";
  const out = document.createElement("canvas");
  const s = Math.min(1, 640 / w);
  out.width = Math.round(w * s);
  out.height = Math.round(h * s);
  out.getContext("2d")!.drawImage(c, x, y, w, h, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.72);
}

const NUMERIC = /\d/;

/**
 * Read one photo. `onWarm` gets the real load progress of the OCR engine and language data (0-1),
 * `onBand` fires after each band with every line read so far, so the strip can print them as they come.
 */
export async function readPhoto(
  file: Blob,
  langs: "eng" | "eng+hin",
  cb: { onWarm: (p: number) => void; onBand: (lines: OcrLine[], done: number, of: number) => void },
  timeoutMs = 60000,
): Promise<OcrPhoto> {
  const T = await loadScript();
  const canvas = await preparePhoto(file);
  const bands = textBands(canvas);
  let worker: TWorker | null = null;
  const deadline = Date.now() + timeoutMs;
  const race = <X,>(p: Promise<X>) =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), Math.max(1, deadline - Date.now())))]);
  try {
    worker = await race(
      T.createWorker(langs, 1, {
        logger: (m) => {
          if (m.status.startsWith("loading") || m.status.startsWith("initializing")) {
            const stage = m.status.includes("core") ? 0 : m.status.includes("traineddata") ? 1 : 2;
            cb.onWarm(Math.min(1, (stage + (m.progress || 0)) / 3));
          }
        },
      }),
    );
    cb.onWarm(1);
    const lines: OcrLine[] = [];
    let confSum = 0;
    let confN = 0;
    let letters = 0;
    let nonAscii = 0;
    for (let k = 0; k < bands.length; k++) {
      const b = bands[k];
      const part = document.createElement("canvas");
      part.width = canvas.width;
      part.height = b.height;
      part.getContext("2d")!.drawImage(canvas, 0, b.top, canvas.width, b.height, 0, 0, canvas.width, b.height);
      const res = await race(worker.recognize(part));
      const got = res.data.lines?.length
        ? res.data.lines
        : res.data.text.split("\n").map((text) => ({ text, confidence: res.data.confidence, bbox: { x0: 0, y0: 0, x1: canvas.width, y1: b.height }, words: [] as TWord[] }));
      for (const l of got) {
        const text = l.text.replace(/\s+/g, " ").trim();
        if (!text) continue;
        const nums = (l.words ?? []).filter((wd) => NUMERIC.test(wd.text));
        const numConf = nums.length ? Math.min(...nums.map((wd) => wd.confidence)) : l.confidence;
        for (const ch of text) if (/\S/.test(ch)) { letters++; if (ch.charCodeAt(0) > 127) nonAscii++; }
        confSum += l.confidence;
        confN++;
        lines.push({ text, numConf, box: { x: l.bbox.x0, y: l.bbox.y0 + b.top, w: l.bbox.x1 - l.bbox.x0, h: l.bbox.y1 - l.bbox.y0 } });
      }
      cb.onBand([...lines], k + 1, bands.length);
    }
    return { canvas, lines, nonAscii: letters ? nonAscii / letters : 0, meanConf: confN ? confSum / confN : 0 };
  } finally {
    worker?.terminate().catch(() => {});
  }
}
