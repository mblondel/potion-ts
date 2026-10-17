// Runs Potion's own test suite (test/**/*.pn, "#=>" lines hold the expected output).
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { Interp } from "../src/interp";

const root = process.argv[2];
if (!root) {
  console.error("usage: bun test/run.ts <path to potion/test> [filter]\n(clone https://github.com/perl11/potion for its test suite)");
  process.exit(2);
}
const only = process.argv[3];
const strict = process.env.STRICT === "1";
const skip = /misc\/(aio|buffile|database|load)\.pn$/;
const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d).sort()) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".pn") && !skip.test(p) && (!only || p.includes(only))) files.push(p);
  }
};
walk(root);

let pass = 0;
const fails: string[] = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const expected = src.split("\n").filter((l) => l.includes("#=>")).map((l) => l.replace(/.*#=> ?/, "")).join("\n");
  let out = "";
  const I = new Interp({ out: (s) => (out += s), strict, timeLimit: 5000 });
  try {
    const v = I.run(src);
    out += I.str(v) + "\n";
  } catch (e: any) {
    out += `** ${e.message}${e.line ? ` (line ${e.line})` : ""}\n`;
  }
  const got = out.replace(/\n+$/, "");
  if (got === expected) pass++;
  else fails.push(`${f.replace(root + "/", "")}\n   expected <${expected}>\n   got      <${got}>`);
}
for (const x of fails) console.log("FAIL " + x);
console.log(`\n${pass}/${files.length} passed${strict ? " (strict)" : ""}`);
