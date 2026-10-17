// Runs every chapter like the page does and checks cells, error demos and exercises.
import { CHAPTERS } from "../src/tutorial";
import { runCells, CellMessage, RunCell } from "../src/session";

const exec = (cells: RunCell[], strict: boolean) => {
  const msgs: CellMessage[] = [];
  runCells(cells, strict, (m) => msgs.push(m));
  const last = cells[cells.length - 1].id;
  const out = msgs.filter((m) => m.type === "out" && m.id === last).map((m: any) => m.text).join("");
  const res = msgs.find((m) => m.type !== "out" && m.type !== "done" && (m as any).id === last) as any;
  return { out, res, msgs };
};

let problems = 0;
const bad = (s: string) => (problems++, console.log("  !! " + s));
for (const strict of [true, false]) {
  console.log(`\n######## strict=${strict}`);
  for (const ch of CHAPTERS) {
    console.log(`\n== ${ch.id}`);
    const ctx: RunCell[] = [];
    ch.blocks.forEach((b, i) => {
      const id = `${ch.id}-${i}`;
      if (b.t === "code") {
        const { out, res } = exec([...ctx, { id, code: b.code }], strict);
        const shown = res.type === "cell" ? `=> ${res.value}  [${res.kind}]` : `${res.type}: ${res.message ?? ""} (line ${res.line}, src ${res.src})`;
        console.log(`-- ${id}${b.error ? " (error demo)" : ""}\n${out}${shown}${res.warnings?.length ? "\n   warn: " + res.warnings.join(" | ") : ""}`);
        if (b.error && res.type !== "error") bad(`${id} should fail`);
        if (!b.error && res.type !== "cell") bad(`${id} failed`);
        if (!b.error) ctx.push({ id, code: b.code });
      } else if (b.t === "exercise") {
        const a = exec([...ctx, { id, code: b.code }], strict).res;
        const s = exec([...ctx, { id, code: b.solution }], strict).res;
        console.log(`-- ${id} exercise: scaffold => ${a.value ?? a.message} | solution => ${s.value ?? s.message}`);
        if (a.type === "cell" && a.value === b.expect) bad(`${id} scaffold already solves it`);
        if (s.type !== "cell" || s.value !== b.expect) bad(`${id} solution gives ${s.value ?? s.message}, expected ${b.expect}`);
      }
    });
  }
}
console.log(`\n${problems ? problems + " PROBLEMS" : "all chapters OK"}`);
