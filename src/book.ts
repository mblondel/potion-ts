// The tutorial page: renders chapters, wires up live cells, checks exercises.
import type { CellMessage, RunCell } from "./session";
import { Block, CHAPTERS } from "./tutorial";

type ExerciseBlock = Extract<Block, { t: "exercise" }>;

interface Cell {
  id: string;
  ch: number;
  orig: string;
  isolated: boolean;
  exercise?: ExerciseBlock;
  el: HTMLElement;
  ta: HTMLTextAreaElement;
  hl: HTMLElement;
  out: HTMLElement;
  status: HTMLElement;
  runBtn: HTMLButtonElement;
  resetBtn: HTMLButtonElement;
  treeBtn: HTMLButtonElement;
  ast: HTMLElement;
  errLine: number | null;
  /** the cell whose error marked errLine */
  errFrom: string | null;
  ran: boolean;
  badge?: HTMLElement;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const doc = $<HTMLElement>("doc");
const toc = $<HTMLElement>("toc");
const progress = $<HTMLElement>("progress");
const workerUrl = URL.createObjectURL(new Blob([$("worker-src").textContent ?? ""], { type: "text/javascript" }));
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const runKey = isMac ? "⌘↵" : "Ctrl+↵";

// ---------- per-viewer storage ----------
// A draft remembers the code it was edited from, so it is only restored onto
// that same cell even if cells are later added or moved. Exercises are
// remembered by chapter and title for the same reason.
interface Draft { orig: string; code: string }
interface Saved { drafts: { [id: string]: Draft }; solved: string[] }
let saved: Saved = { drafts: {}, solved: [] };

/** Types are always checked, except in a chapter whose own switch turns it off. */
const checking: boolean[] = CHAPTERS.map(() => true);
try {
  const raw = localStorage.getItem("potion-tutorial-v2");
  if (raw) saved = { ...saved, ...JSON.parse(raw) };
} catch { /* storage unavailable: start fresh */ }
const persist = () => {
  try { localStorage.setItem("potion-tutorial-v2", JSON.stringify(saved)); } catch { /* ignore */ }
};

// ---------- text helpers ----------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `code`, *em* and [link](https://…) in prose */
function fmt(s: string): string {
  return s.split("`").map((part, i) => {
    if (i % 2) return `<code>${esc(part)}</code>`;
    return esc(part)
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }).join("");
}

const KW = /^(if|elsif|else|while|loop|return|break|continue|self|class|and|or|not)$/;
const CONST = /^(nil|true|false)$/;
const TOKEN = /(#[^\n]*)|("(?:\\[\s\S]|[^"\\])*"?|'(?:''|[^'])*'?)|(0x[0-9a-fA-F]+|\b\d+(?:\.\d+)?(?:e[-+]?\d+)?\b)|(\/[A-Za-z_$@][\w$@]*)|([A-Za-z_$@][\w$@]*\??)|(=[NS&](?![\w$@]))/g;

function highlight(src: string, errLine: number | null): string {
  const lines: string[] = [""];
  const emit = (text: string, cls: string | null) => {
    text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push("");
      if (part) lines[lines.length - 1] += cls ? `<span class="t-${cls}">${esc(part)}</span>` : esc(part);
    });
  };
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    emit(src.slice(last, m.index), null);
    const [t, comment, str, num, path, word] = m;
    let cls: string | null;
    if (comment) cls = "com";
    else if (str) cls = "str";
    else if (num) cls = "num";
    else if (path) cls = "path";
    else if (word) cls = KW.test(word) ? "kw" : CONST.test(word) ? "num" : /^[A-Z]/.test(word) ? "kind" : null;
    else cls = "kw";
    emit(t, cls);
    last = m.index! + t.length;
  }
  emit(src.slice(last), null);
  return lines.map((l, i) => `<span class="ln${errLine === i + 1 ? " err" : ""}">${l || " "}</span>`).join("");
}

// ---------- building the document ----------
const cells: Cell[] = [];
const byId = new Map<string, Cell>();
const chapterCells: Cell[][] = CHAPTERS.map(() => []);
const exerciseCells: Cell[] = [];

function makeCell(id: string, ch: number, code: string, opts: { isolated: boolean; exercise?: ExerciseBlock; label: string }): Cell {
  const el = document.createElement("figure");
  el.className = "cell";
  el.id = `cell-${id}`;
  el.innerHTML = `
    <div class="code">
      <pre class="hl" aria-hidden="true"></pre>
      <textarea id="code-${id}" rows="1" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="${esc(opts.label)}"></textarea>
    </div>
    <div class="cell-bar">
      <button type="button" class="run">Run</button>
      <span class="key" aria-hidden="true">${runKey}</span>
      <button type="button" class="link reset" hidden>Reset</button>
      <button type="button" class="link tree" aria-expanded="false">Syntax tree</button>
      <span class="status" role="status" aria-live="polite"></span>
    </div>
    <div class="cell-out"></div>
    <pre class="cell-ast" hidden></pre>`;
  const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
  const cell: Cell = {
    id, ch, orig: code, isolated: opts.isolated, exercise: opts.exercise, el,
    ta: q("textarea"), hl: q(".hl"), out: q(".cell-out"), status: q(".status"),
    runBtn: q(".run"), resetBtn: q(".reset"), treeBtn: q(".tree"), ast: q(".cell-ast"),
    errLine: null, errFrom: null, ran: false,
  };
  const draft = saved.drafts[id];
  cell.ta.value = draft && draft.orig === code ? draft.code : code;
  cell.resetBtn.hidden = cell.ta.value === code;
  renderCode(cell);
  wireCell(cell);
  cells.push(cell);
  byId.set(id, cell);
  chapterCells[ch].push(cell);
  return cell;
}

function renderCode(c: Cell) {
  c.hl.innerHTML = highlight(c.ta.value, c.errLine);
}

function build() {
  const tocItems: string[] = [];
  CHAPTERS.forEach((chapter, ci) => {
    const sec = document.createElement("section");
    sec.className = "chapter";
    sec.id = chapter.id;
    sec.setAttribute("aria-labelledby", `h-${chapter.id}`);
    sec.innerHTML = `<header class="ch-head"><span class="eyebrow">Chapter ${ci + 1}</span><h2 id="h-${chapter.id}">${esc(chapter.title)}</h2></header>`;
    let codeN = 0;
    let exId: string | null = null;
    chapter.blocks.forEach((b, bi) => {
      const id = `${chapter.id}-${bi}`;
      if (b.t === "p") {
        const el = document.createElement("p");
        el.innerHTML = fmt(b.text);
        sec.appendChild(el);
      } else if (b.t === "aside") {
        const el = document.createElement("aside");
        el.className = "aside";
        el.innerHTML = `<span class="eyebrow">Note</span><p>${fmt(b.text)}</p>`;
        sec.appendChild(el);
      } else if (b.t === "switch") {
        const el = document.createElement("div");
        el.className = "chapter-switch";
        el.innerHTML = `<label class="toggle"><input type="checkbox" id="switch-${chapter.id}" checked> ${esc(b.label)}</label><p>${fmt(b.text)}</p>`;
        const box = el.querySelector("input") as HTMLInputElement;
        box.addEventListener("change", () => {
          checking[ci] = box.checked;
          runChapter(ci);
        });
        sec.appendChild(el);
      } else if (b.t === "code") {
        codeN++;
        const c = makeCell(id, ci, b.code, { isolated: !!b.error, label: `Code, chapter ${ci + 1}, cell ${codeN}` });
        if (b.error) c.el.classList.add("expects-error");
        sec.appendChild(c.el);
      } else {
        exId = id;
        const box = document.createElement("div");
        box.className = "exercise";
        box.innerHTML = `
          <div class="ex-head">
            <span class="eyebrow">Exercise</span>
            <h3>${esc(b.title)}</h3>
            <span class="badge" data-state="todo">Not solved yet</span>
          </div>
          <p>${fmt(b.prompt)}</p>`;
        const c = makeCell(id, ci, b.code, { isolated: true, exercise: b, label: `Exercise: ${b.title}` });
        c.badge = box.querySelector(".badge") as HTMLElement;
        box.appendChild(c.el);
        const help = document.createElement("div");
        help.className = "ex-help";
        help.innerHTML = `<details><summary>Hint</summary><p>${fmt(b.hint)}</p></details>
          <button type="button" class="link solution">Use the solution</button>`;
        (help.querySelector(".solution") as HTMLElement).addEventListener("click", () => {
          c.ta.value = b.solution;
          onEdit(c);
          run(c);
        });
        box.appendChild(help);
        c.out.innerHTML = `<p class="placeholder">Run this cell to check your answer.</p>`;
        exerciseCells.push(c);
        sec.appendChild(box);
        if (saved.solved.includes(exKey(c))) setBadge(c, true);
      }
    });
    doc.appendChild(sec);
    tocItems.push(`<li><a href="#${chapter.id}" data-ch="${chapter.id}"><span class="num">${ci + 1}</span><span class="t">${esc(chapter.title)}</span>${exId ? `<span class="mark" data-ex="${exId}" aria-label="exercise not solved"></span>` : ""}</a></li>`);
  });
  toc.innerHTML = `<ol>${tocItems.join("")}</ol>`;
  toc.querySelectorAll<HTMLAnchorElement>("a").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById(a.dataset.ch!)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }));
  updateProgress();
}

// ---------- editing ----------
function onEdit(c: Cell) {
  c.errLine = c.errFrom = null;
  if (c.ta.value === c.orig) delete saved.drafts[c.id];
  else saved.drafts[c.id] = { orig: c.orig, code: c.ta.value };
  c.resetBtn.hidden = c.ta.value === c.orig;
  persist();
  renderCode(c);
  if (!c.ast.hidden) requestAst(c);
}

function wireCell(c: Cell) {
  c.ta.addEventListener("input", () => onEdit(c));
  c.ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || e.shiftKey)) {
      e.preventDefault();
      run(c);
      if (e.shiftKey) {
        const next = cells[cells.indexOf(c) + 1];
        next?.ta.focus();
        next?.el.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    if (e.key === "Escape") return c.ta.blur();
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      c.ta.setRangeText("  ", c.ta.selectionStart, c.ta.selectionEnd, "end");
      onEdit(c);
    } else if (e.key === "Enter") {
      const before = c.ta.value.slice(0, c.ta.selectionStart);
      const line = before.slice(before.lastIndexOf("\n") + 1);
      let indent = line.match(/^\s*/)![0];
      if (/:\s*(#.*)?$/.test(line)) indent += "  ";
      e.preventDefault();
      c.ta.setRangeText("\n" + indent, c.ta.selectionStart, c.ta.selectionEnd, "end");
      onEdit(c);
    }
  });
  c.runBtn.addEventListener("click", () => (active[c.ch]?.target === c ? stop(c) : run(c)));
  c.resetBtn.addEventListener("click", () => {
    c.ta.value = c.orig;
    onEdit(c);
    run(c);
  });
  c.treeBtn.addEventListener("click", () => {
    const show = c.ast.hidden;
    c.ast.hidden = !show;
    c.treeBtn.setAttribute("aria-expanded", String(show));
    c.treeBtn.textContent = show ? "Hide tree" : "Syntax tree";
    if (show) requestAst(c);
  });
}

// ---------- running ----------
interface Active { worker: Worker; target: Cell | null; list: Cell[]; done: () => void }
const active: (Active | undefined)[] = [];

/** Earlier cells in the chapter that later cells build on, plus this one. */
function contextFor(c: Cell): Cell[] {
  const list = chapterCells[c.ch];
  return list.slice(0, list.indexOf(c)).filter((x) => !x.isolated).concat(c);
}

function cancel(ch: number) {
  const a = active[ch];
  if (!a) return;
  a.worker.terminate();
  active[ch] = undefined;
  for (const c of a.list) setRunning(c, false);
  a.done();
}

function setRunning(c: Cell, on: boolean) {
  c.el.classList.toggle("running", on);
  if (active[c.ch]?.target === c || !on) {
    c.runBtn.textContent = on ? "Stop" : "Run";
    c.runBtn.classList.toggle("stop", on);
  }
}

function startRun(ch: number, list: Cell[], target: Cell | null): Promise<void> {
  cancel(ch);
  return new Promise((resolve) => {
    const worker = new Worker(workerUrl);
    const a: Active = { worker, target, list, done: resolve };
    active[ch] = a;
    const fresh = new Set<string>();
    const begin = (c: Cell) => {
      if (fresh.has(c.id)) return;
      fresh.add(c.id);
      c.out.textContent = "";
      // clear the line marks this cell's previous error left, here or in an earlier cell
      for (const x of chapterCells[ch]) {
        if (x.errFrom === c.id) {
          x.errLine = x.errFrom = null;
          renderCode(x);
        }
      }
    };
    for (const c of list) setRunning(c, true);
    if (target) {
      begin(target);
      target.status.textContent = "Running…";
    }
    worker.onmessage = (e: MessageEvent<CellMessage>) => {
      if (active[ch] !== a) return;
      const m = e.data;
      if (m.type === "done") {
        worker.terminate();
        active[ch] = undefined;
        for (const c of list) setRunning(c, false);
        resolve();
        return;
      }
      const c = byId.get(m.id);
      if (!c) return;
      begin(c);
      if (m.type === "out") {
        appendText(c, m.text);
        return;
      }
      setRunning(c, false);
      c.ran = true;
      if (m.type === "skipped") {
        addLine(c, "o-skip", "Not run: a cell above stopped with an error.");
        c.status.textContent = "";
        return;
      }
      for (const w of m.warnings) addLine(c, "o-warn", "Note: " + w);
      const ms = m.ms < 10 ? m.ms.toFixed(1) : String(Math.round(m.ms));
      if (m.type === "cell") {
        const hasOut = c.out.querySelector(".o-text") !== null;
        if (!(m.value === "" && hasOut)) {
          const row = document.createElement("div");
          row.className = "o-value";
          row.innerHTML = `<span class="o-arrow" aria-hidden="true">⇒</span><span class="o-v"></span><span class="o-kind"></span>`;
          (row.querySelector(".o-v") as HTMLElement).textContent = m.value === "" ? '""' : m.value;
          (row.querySelector(".o-kind") as HTMLElement).textContent = m.kind;
          c.out.appendChild(row);
        }
        c.status.textContent = `${ms} ms`;
        if (c.exercise) checkExercise(c, m.value);
      } else {
        const src = byId.get(m.src) ?? c;
        const oneLine = !c.ta.value.trim().includes("\n");
        const where = !m.line ? "" : src !== c ? `Line ${m.line} of an earlier cell · ` : oneLine ? "" : `Line ${m.line} · `;
        if (c.el.classList.contains("expects-error")) addLine(c, "o-intent", "This cell fails on purpose:");
        addLine(c, "o-error", where + m.message);
        if (m.line) {
          src.errLine = m.line;
          src.errFrom = c.id;
          renderCode(src);
        }
        c.status.textContent = c.el.classList.contains("expects-error") ? "Fails, as intended" : "Error";
        if (c.exercise) checkExercise(c, null);
      }
    };
    worker.postMessage({ kind: "cells", cells: list.map((c): RunCell => ({ id: c.id, code: c.ta.value })), strict: checking[ch] });
  });
}

function appendText(c: Cell, text: string) {
  let pre = c.out.lastElementChild as HTMLElement | null;
  if (!pre || !pre.classList.contains("o-text")) {
    pre = document.createElement("pre");
    pre.className = "o-text";
    c.out.appendChild(pre);
  }
  pre.textContent += text;
}

function addLine(c: Cell, cls: string, text: string) {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  c.out.appendChild(d);
}

function run(c: Cell) {
  return startRun(c.ch, contextFor(c), c);
}

function stop(c: Cell) {
  cancel(c.ch);
  addLine(c, "o-skip", "Stopped.");
  c.status.textContent = "Stopped";
}

/** Runs a chapter so every cell shows its result: the shared cells in one
 *  pass, then each cell that is meant to fail. Exercises wait for the reader. */
async function runChapter(ch: number) {
  const list = chapterCells[ch];
  await startRun(ch, list.filter((c) => !c.isolated), null);
  for (const c of list) {
    if (c.isolated && (!c.exercise || c.ran || c.ta.value !== c.orig)) await startRun(ch, contextFor(c), null);
  }
}

// ---------- exercises ----------
function exKey(c: Cell): string {
  return `${CHAPTERS[c.ch].id}:${c.exercise!.title}`;
}

function setBadge(c: Cell, solved: boolean) {
  if (!c.badge) return;
  c.badge.dataset.state = solved ? "solved" : "todo";
  c.badge.textContent = solved ? "Solved" : "Not solved yet";
  c.el.parentElement?.classList.toggle("solved", solved);
  const mark = toc.querySelector<HTMLElement>(`[data-ex="${c.id}"]`);
  if (mark) {
    mark.dataset.state = solved ? "solved" : "todo";
    mark.setAttribute("aria-label", solved ? "exercise solved" : "exercise not solved");
  }
}

function checkExercise(c: Cell, value: string | null) {
  const ex = c.exercise!;
  const ok = value === ex.expect;
  const was = saved.solved.includes(exKey(c));
  if (ok && !was) saved.solved.push(exKey(c));
  persist();
  setBadge(c, ok || was);
  if (!ok && value !== null) addLine(c, "o-check", `Not yet: the value should be ${ex.expect}.`);
  if (ok) addLine(c, "o-ok", "That's it.");
  updateProgress();
}

function updateProgress() {
  const n = exerciseCells.filter((c) => saved.solved.includes(exKey(c))).length;
  progress.innerHTML = `<b>${n}</b> of ${exerciseCells.length} exercises solved`;
  progress.style.setProperty("--p", String(exerciseCells.length ? n / exerciseCells.length : 0));
}

// ---------- syntax trees ----------
let astWorker: Worker | null = null;
const astTimers = new Map<string, number>();
function requestAst(c: Cell) {
  clearTimeout(astTimers.get(c.id));
  astTimers.set(c.id, window.setTimeout(() => {
    if (!astWorker) {
      astWorker = new Worker(workerUrl);
      astWorker.onmessage = (e) => {
        const m = e.data as { id: string; text: string; error?: string; line?: number | null };
        const t = byId.get(m.id);
        if (!t) return;
        t.ast.textContent = m.error ? (m.line ? `Line ${m.line} · ` : "") + m.error : m.text;
        t.ast.classList.toggle("is-error", !!m.error);
      };
    }
    astWorker.postMessage({ kind: "ast", id: c.id, code: c.ta.value });
  }, 120));
}

// ---------- contents highlighting ----------
function watchChapters() {
  const links = new Map<string, HTMLElement>();
  toc.querySelectorAll<HTMLElement>("a").forEach((a) => links.set(a.dataset.ch!, a));
  const seen = new Map<string, boolean>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) seen.set(e.target.id, e.isIntersecting);
    const current = CHAPTERS.find((c) => seen.get(c.id));
    links.forEach((a, id) => a.toggleAttribute("aria-current", id === current?.id));
  }, { rootMargin: "-20% 0px -70% 0px" });
  document.querySelectorAll(".chapter").forEach((s) => io.observe(s));
}

// ---------- boot ----------
document.querySelectorAll(".runkey").forEach((k) => (k.textContent = runKey));
build();
watchChapters();
CHAPTERS.forEach((_, i) => runChapter(i));
