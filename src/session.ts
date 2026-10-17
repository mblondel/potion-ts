// Runs a sequence of notebook cells in one interpreter session, reporting per cell.
import { Interp } from "./interp";
import { PotionError } from "./values";

export interface RunCell { id: string; code: string }

export type CellMessage =
  | { type: "out"; id: string; text: string }
  | { type: "cell"; id: string; value: string; kind: string; ms: number; warnings: string[] }
  | { type: "error"; id: string; message: string; line: number | null; src: string; ms: number; warnings: string[] }
  | { type: "skipped"; id: string }
  | { type: "done" };

const MAX_OUT = 100_000;

export function runCells(cells: RunCell[], strict: boolean, post: (m: CellMessage) => void) {
  let id = "", buf = "", total = 0, truncated = false, last = Date.now();
  const flush = () => {
    if (buf) post({ type: "out", id, text: buf });
    buf = "";
    last = Date.now();
  };
  const out = (s: string) => {
    if (truncated) return;
    total += s.length;
    if (total > MAX_OUT) {
      truncated = true;
      buf += "\n… output truncated at 100,000 characters\n";
      flush();
      return;
    }
    buf += s;
    if (buf.length > 8192 || Date.now() - last > 40) flush();
  };
  let warnings: string[] = [];
  const I = new Interp({ out, strict, timeLimit: 30_000, warn: (w) => void (warnings.length < 12 && warnings.push(w)) });

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    id = c.id;
    total = 0;
    truncated = false;
    warnings = [];
    const t0 = performance.now();
    try {
      const v = I.run(c.code, c.id);
      flush();
      post({ type: "cell", id, value: I.str(v), kind: I.kindOf(v).name || "object", ms: performance.now() - t0, warnings });
    } catch (err) {
      flush();
      const pe = err as PotionError;
      const message = err instanceof PotionError ? pe.message : `Internal error: ${(err as Error).message}`;
      post({ type: "error", id, message, line: pe.line ?? null, src: pe.cell ?? id, ms: performance.now() - t0, warnings });
      for (const rest of cells.slice(i + 1)) post({ type: "skipped", id: rest.id });
      break;
    }
  }
  post({ type: "done" });
}
