import { readFileSync } from "fs";
import { Interp } from "../src/interp";
const src = readFileSync(process.argv[2], "utf8");
let out = "";
const I = new Interp({ out: (s) => (out += s), warn: (s) => console.error("warn: " + s), timeLimit: 20000 });
const t = performance.now();
try { I.run(src); } catch (e: any) { out += `** ${e.message} (line ${e.line})`; }
process.stdout.write(out);
console.error(`[${(performance.now() - t).toFixed(0)}ms]`);
