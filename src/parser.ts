// A backtracking recursive-descent port of Potion's PEG grammar (core/syntax.y).

import { Dbl, Param, PotionError, Value } from "./values";

export interface Node {
  k: string;
  line?: number;
  [field: string]: any;
}

const isSpace = (c: string) => c === " " || c === "\t" || c === "\f" || c === "\v";
const isEol = (c: string) => c === "\n" || c === "\r";
const isDigit = (c: string) => c >= "0" && c <= "9";
const isHex = (c: string) => isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
export function isUtff(c: string): boolean {
  if (!c) return false;
  const x = c.charCodeAt(0);
  return (x >= 65 && x <= 90) || (x >= 97 && x <= 122) || c === "_" || c === "$" || c === "@" || x >= 0x80;
}
const isUtfw = (c: string) => isUtff(c) || isDigit(c) || c === ";" || c === "`" || c === "{" || c === "}";

const BINOPS: { [level: string]: string[] } = {
  eqs: ["<=>", "==", "!="],
  cmps: [">=", ">", "<=", "<"],
  bitors: ["|", "^"],
  bitand: ["&"],
  bitshift: ["<<", ">>"],
  sum: ["+", "-"],
  product: ["*", "/", "%"],
  power: ["**"],
};
const COMPOUND = ["||", "&&", "or", "and", "|", "^", "&", "<<", ">>", "+", "-", "**", "*", "/", "%"];

export class Parser {
  i = 0;
  far = 0;
  private memo = new Map<number, { n: Node | null; e: number }>();
  private lineStarts: number[] = [0];

  constructor(public s: string, public cell?: string) {
    for (let j = 0; j < s.length; j++) if (s[j] === "\n") this.lineStarts.push(j + 1);
  }

  lineOf(pos: number): number {
    let lo = 0, hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }

  // ---------- lexical helpers ----------
  ch(o = 0): string {
    return this.s[this.i + o] ?? "";
  }
  touch() {
    if (this.i > this.far) this.far = this.i;
  }
  lit(t: string): boolean {
    this.touch();
    if (this.s.startsWith(t, this.i)) {
      this.i += t.length;
      this.touch();
      return true;
    }
    return false;
  }
  word(t: string): boolean {
    const st = this.i;
    if (this.lit(t) && !isUtfw(this.ch())) return true;
    this.i = st;
    return false;
  }
  skipComment() {
    while (this.i < this.s.length && !isEol(this.ch())) this.i++;
  }
  /** `-` : spaces and comments */
  ws1() {
    for (;;) {
      const c = this.ch();
      if (isSpace(c)) this.i++;
      else if (c === "#") this.skipComment();
      else break;
    }
  }
  /** `--` : spaces, comments and newlines */
  ws2() {
    for (;;) {
      const c = this.ch();
      if (isSpace(c) || isEol(c)) this.i++;
      else if (c === "#") this.skipComment();
      else break;
    }
  }
  eol(): boolean {
    return this.lit("\r\n") || this.lit("\n") || this.lit("\r");
  }
  sep(): boolean {
    const st = this.i;
    if (!(this.eol() || this.lit(","))) {
      this.i = st;
      return false;
    }
    for (;;) {
      const c = this.ch();
      if (isSpace(c) || isEol(c) || c === ",") this.i++;
      else if (c === "#") this.skipComment();
      else break;
    }
    return true;
  }
  node(k: string, pos: number, fields: object): Node {
    return { k, line: this.lineOf(pos), cell: this.cell, ...fields };
  }

  // ---------- program structure ----------
  program(): Node {
    this.ws2();
    const stmts = this.statements();
    this.ws2();
    if (this.i < this.s.length) {
      const pos = Math.max(this.far, this.i);
      const line = this.lineOf(pos);
      const col = pos - this.lineStarts[line - 1] + 1;
      const near = this.s.slice(pos, pos + 12).split("\n")[0];
      throw new PotionError(`Syntax error at line ${line}, column ${col}` + (near ? ` near "${near}"` : ""), line);
    }
    return { k: "code", stmts };
  }

  statements(): Node[] {
    const out: Node[] = [];
    const first = this.stmt();
    if (!first) return out;
    out.push(first);
    for (;;) {
      const st = this.i;
      if (!this.sep()) break;
      const s = this.stmt();
      if (!s) {
        this.i = st;
        break;
      }
      out.push(s);
    }
    this.sep();
    return out;
  }

  orTok(): boolean {
    if (this.lit("||") || this.word("or")) return this.ws2(), true;
    return false;
  }
  andTok(): boolean {
    if (this.lit("&&") || this.word("and")) return this.ws2(), true;
    return false;
  }

  stmt(): Node | null {
    let s = this.sets();
    if (!s) return null;
    for (;;) {
      const st = this.i, pos = this.i;
      if (this.orTok()) {
        const x = this.sets();
        if (x) { s = this.node("or", pos, { a: s, b: x }); continue; }
      }
      this.i = st;
      if (this.andTok()) {
        const x = this.sets();
        if (x) { s = this.node("and", pos, { a: s, b: x }); continue; }
      }
      this.i = st;
      break;
    }
    return s;
  }

  sets(): Node | null {
    const pos = this.i;
    const e = this.eqs();
    if (!e) return null;
    let st = this.i;
    if (this.ch() === "=" && this.ch(1) !== "=") {
      this.i++;
      this.ws2();
      const s = this.sets();
      if (s) return this.node("assign", pos, { lhs: e, rhs: s });
    }
    this.i = st;
    if (this.lit(":=")) {
      this.ws2();
      const v = this.value();
      if (v) return this.node("assign", pos, { lhs: e, rhs: v });
    }
    this.i = st;
    for (const op of COMPOUND) {
      st = this.i;
      const ok = op === "or" || op === "and" ? this.word(op) : this.lit(op);
      if (ok) {
        this.ws2();
        if (this.ch() === "=" && this.ch(1) !== "=") {
          this.i++;
          this.ws2();
          const s = this.sets();
          if (s) {
            const k = op === "||" || op === "or" ? "or" : op === "&&" || op === "and" ? "and" : "op";
            const rhs = k === "op" ? this.node("op", pos, { op, a: e, b: s }) : this.node(k, pos, { a: e, b: s });
            return this.node("assign", pos, { lhs: e, rhs });
          }
        }
      }
      this.i = st;
    }
    return e;
  }

  private binLevel(level: string, next: () => Node | null): Node | null {
    let a = next();
    if (!a) return null;
    outer: for (;;) {
      for (const op of BINOPS[level]) {
        const st = this.i, pos = this.i;
        if (!this.lit(op)) continue;
        // keep `||`, `|=` and `&&` out of the bitwise operators, and `**` out of `*`
        if ((op === "|" && (this.ch() === "|" || this.ch() === "=")) ||
            (op === "&" && (this.ch() === "&" || this.ch() === "=")) ||
            (op === "*" && this.ch() === "*") ||
            (op !== "==" && op !== "!=" && op !== "<=" && op !== ">=" && op !== "<=>" && this.ch() === "=" )) {
          this.i = st;
          continue;
        }
        this.ws2();
        const b = next();
        if (b) {
          a = this.node("op", pos, { op, a, b });
          continue outer;
        }
        this.i = st;
      }
      break;
    }
    return a;
  }
  eqs = (): Node | null => this.binLevel("eqs", this.cmps);
  cmps = (): Node | null => this.binLevel("cmps", this.bitors);
  bitors = (): Node | null => this.binLevel("bitors", this.bitand);
  bitand = (): Node | null => this.binLevel("bitand", this.bitshift);
  bitshift = (): Node | null => this.binLevel("bitshift", this.sum);
  sum = (): Node | null => this.binLevel("sum", this.product);
  product = (): Node | null => this.binLevel("product", this.power);
  power = (): Node | null => this.binLevel("power", this.expr);

  expr = (): Node | null => {
    const st = this.i;
    let a: Node | null = null;
    if (this.lit("!") || this.word("not")) {
      this.ws2();
      const x = this.expr();
      if (x) a = this.node("not", st, { a: x });
      else this.i = st;
    }
    if (!a && this.lit("~")) {
      this.ws2();
      const x = this.expr();
      if (x) a = this.node("wavy", st, { a: x });
      else this.i = st;
    }
    for (const sign of ["-", "+"]) {
      if (a) break;
      if (this.ch() === sign && this.ch(1) !== sign) {
        this.i++;
        this.ws2();
        const x = this.atom();
        if (x) a = this.node("op", st, { op: sign, a: this.node("value", st, { v: 0 }), b: x });
        else this.i = st;
      }
    }
    for (const [tok, delta] of [["--", -1], ["++", 1]] as const) {
      if (a) break;
      if (this.lit(tok)) {
        this.ws1();
        const x = this.atom();
        if (x) a = this.node("inc", st, { target: x, delta, prefix: true });
        else this.i = st;
      }
    }
    if (!a) {
      const x = this.atom();
      if (!x) {
        this.i = st;
        return null;
      }
      a = x;
      if (this.lit("++")) { this.ws1(); a = this.node("inc", st, { target: x, delta: 1, prefix: false }); }
      else if (this.lit("--")) { this.ws1(); a = this.node("inc", st, { target: x, delta: -1, prefix: false }); }
    }
    const items = [a];
    for (;;) {
      const c = this.call();
      if (c) {
        items.push(c);
        continue;
      }
      // `if ...` on one line, `elsif`/`else` on the next: keep it one chain
      if (items.some((x) => x.k === "msg" && (x.name === "if" || x.name === "elsif"))) {
        const s2 = this.i;
        this.ws2();
        if (this.word("elsif") || this.word("else")) {
          this.i = s2;
          this.ws2();
          const c2 = this.call();
          if (c2) {
            items.push(c2);
            continue;
          }
        }
        this.i = s2;
      }
      break;
    }
    return this.node("expr", st, { items });
  };

  atom(): Node | null {
    return this.value() ?? this.closure() ?? this.list() ?? this.call();
  }

  call(): Node | null {
    const st = this.i;
    const n = this.name();
    if (n) {
      n.args = this.value() ?? this.list();
      n.block = this.block() ?? this.closure();
      return n;
    }
    this.i = st;
    const v = this.value() ?? this.list();
    if (v) return this.node("msg", st, { name: null, args: v, block: this.block(), q: false });
    this.i = st;
    return null;
  }

  name(): Node | null {
    const st = this.i;
    const p = this.path();
    if (p) return this.node("path", st, { name: p, q: false });
    if (this.lit("?")) {
      this.ws2();
      const m = this.msgName();
      if (m !== null) {
        this.ws1();
        return this.node("msg", st, { name: m, q: true });
      }
      const p2 = this.path();
      if (p2) return this.node("path", st, { name: p2, q: true });
      this.i = st;
      return null;
    }
    const t = this.tupleIdx();
    if (t) return t;
    if (this.word("and") || this.word("or") || this.word("not")) {
      this.i = st;
      return null;
    }
    const m = this.msgName();
    if (m !== null) {
      this.ws1();
      return this.node("msg", st, { name: m, q: false });
    }
    return null;
  }

  path(): string | null {
    const st = this.i;
    if (this.ch() === "/" && isUtff(this.ch(1))) {
      this.i++;
      const m = this.msgName(false)!;
      this.ws1();
      return m;
    }
    this.i = st;
    return null;
  }

  msgName(allowQ = true): string | null {
    this.touch();
    if (!isUtff(this.ch())) return null;
    const st = this.i;
    this.i++;
    while (isUtfw(this.ch())) this.i++;
    if (allowQ && this.ch() === "?") this.i++;
    return this.s.slice(st, this.i);
  }

  value(): Node | null {
    const st = this.i;
    const v = this.immed();
    if (v !== undefined) {
      this.ws1();
      return this.node("value", st, { v });
    }
    this.i = st;
    return this.tupleIdx() ?? this.lick() ?? this.group();
  }

  /** p[k] */
  tupleIdx(): Node | null {
    const st = this.i;
    const n = this.msgName();
    if (n !== null && this.ch() === "[") {
      const l = this.lick();
      if (l && l.items.length) return this.node("index", st, { name: n, key: l.items[0] });
    }
    this.i = st;
    return null;
  }

  immed(): Value | undefined {
    const st = this.i;
    if (this.word("nil")) return null;
    if (this.word("true")) return true;
    if (this.word("false")) return false;
    if (this.lit("0x") && isHex(this.ch())) {
      const a = this.i;
      while (isHex(this.ch())) this.i++;
      return parseInt(this.s.slice(a, this.i), 16);
    }
    this.i = st;
    // dec = ('0' | '-'? [1-9][0-9]*) ('.' [0-9]+)? ('e' [-+]? [0-9]+)?
    if (this.ch() === "0") this.i++;
    else {
      if (this.ch() === "-") this.i++;
      if (this.ch() >= "1" && this.ch() <= "9") {
        while (isDigit(this.ch())) this.i++;
      } else {
        this.i = st;
        return this.str1() ?? this.str2();
      }
    }
    let dbl = false;
    if (this.ch() === "." && isDigit(this.ch(1))) {
      this.i++;
      while (isDigit(this.ch())) this.i++;
      dbl = true;
    }
    if (this.ch() === "e" && (isDigit(this.ch(1)) || ((this.ch(1) === "-" || this.ch(1) === "+") && isDigit(this.ch(2))))) {
      this.i += 2;
      while (isDigit(this.ch())) this.i++;
      dbl = true;
    }
    const text = this.s.slice(st, this.i);
    this.touch();
    return dbl ? new Dbl(parseFloat(text)) : parseInt(text, 10);
  }

  str1(): string | undefined {
    if (this.ch() !== "'") return undefined;
    const st = this.i;
    this.i++;
    let out = "";
    for (;;) {
      if (this.i >= this.s.length) { this.i = st; return undefined; }
      const c = this.ch();
      if (c === "'") {
        if (this.ch(1) === "'") { out += "'"; this.i += 2; continue; }
        this.i++;
        return out;
      }
      out += c;
      this.i++;
    }
  }

  str2(): string | undefined {
    if (this.ch() !== '"') return undefined;
    const st = this.i;
    this.i++;
    let out = "";
    for (;;) {
      if (this.i >= this.s.length) { this.i = st; return undefined; }
      const c = this.ch();
      if (c === '"') { this.i++; return out; }
      if (c === "\\") {
        const e = this.ch(1);
        this.i += 2;
        if (e === "n") out += "\n";
        else if (e === "t") out += "\t";
        else if (e === "r") out += "\r";
        else if (e === "b") out += "\b";
        else if (e === "f") out += "\f";
        else if (e === "u" && [0, 1, 2, 3].every((k) => isHex(this.ch(k)))) {
          out += String.fromCodePoint(parseInt(this.s.slice(this.i, this.i + 4), 16));
          this.i += 4;
        } else if (e === "U" && this.ch() === "{") {
          const end = this.s.indexOf("}", this.i);
          out += String.fromCodePoint(parseInt(this.s.slice(this.i + 1, end), 16));
          this.i = end + 1;
        } else out += e;
        continue;
      }
      out += c;
      this.i++;
    }
  }

  closure(): Node | null {
    const st = this.i;
    const l = this.list();
    const b = this.block();
    if (b) return this.node("proto", st, { sig: l, body: b });
    this.i = st;
    return null;
  }

  list(): Node | null {
    const st = this.i;
    const hit = this.memo.get(st);
    if (hit) {
      this.i = hit.e;
      return hit.n;
    }
    let n: Node | null = null;
    if (this.lit("(")) {
      this.ws2();
      const a = this.i;
      const items = this.statements();
      const b = this.i;
      if (this.lit(")")) {
        this.ws1();
        n = this.node("list", st, { items, src: this.s.slice(a, b) });
      }
    }
    if (!n) this.i = st;
    this.memo.set(st, { n, e: this.i });
    return n;
  }

  block(): Node | null {
    const st = this.i;
    if (!this.lit(":")) return null;
    this.ws2();
    const stmts = this.statements();
    if (this.lit(".")) {
      this.ws1();
      return this.node("block", st, { stmts });
    }
    this.i = st;
    return null;
  }

  group(): Node | null {
    const st = this.i;
    if (!this.lit("|")) return null;
    this.ws2();
    const stmts = this.statements();
    if (this.lit(".")) {
      this.ws1();
      return this.node("group", st, { stmts });
    }
    this.i = st;
    return null;
  }

  // ---------- licks: the data language ----------
  lick(): Node | null {
    const st = this.i;
    if (!this.lit("[")) return null;
    this.ws2();
    const items: Node[] = [];
    const first = this.lickItem();
    if (first) {
      items.push(first);
      for (;;) {
        const s2 = this.i;
        if (!this.sep()) break;
        const it = this.lickItem();
        if (!it) { this.i = s2; break; }
        items.push(it);
      }
      this.sep();
    }
    if (this.lit("]")) {
      this.ws1();
      return this.node("lick", st, { items });
    }
    this.i = st;
    return null;
  }

  lickItem(): Node | null {
    const st = this.i;
    const mk = (name: string | null, inner: Node | null, attr: Node | null, nameVal: Node | null = null) =>
      this.node("lickitem", st, { name, inner, attr, nameVal });
    const n = this.msgName();
    if (n !== null) {
      this.ws1();
      const after = this.i;
      let l = this.list();
      if (l) {
        const lv = this.loose();
        if (lv) return mk(n, lv, l);
        return mk(n, null, l);
      }
      this.i = after;
      const lv = this.loose();
      if (lv) {
        const s2 = this.i;
        l = this.list();
        if (l) return mk(n, lv, l);
        this.i = s2;
        return mk(n, lv, null);
      }
      this.i = after;
      return mk(n, null, null);
    }
    this.i = st;
    const lv = this.loose();
    if (lv) {
      this.ws1();
      return mk(null, null, null, lv);
    }
    return null;
  }

  loose(): Node | null {
    const st = this.i;
    const v = this.value();
    if (v) return v;
    const u = this.unquoted();
    if (u !== null) return this.node("value", st, { v: u });
    return null;
  }

  private isUnqSep(): boolean {
    const st = this.i;
    const r = this.sep() && !"{[(".includes(this.ch() || "x");
    this.i = st;
    return r;
  }

  private unqChar(): boolean {
    const c = this.ch();
    if (!c) return false;
    const pairs: { [o: string]: string } = { "{": "}", "[": "]", "(": ")" };
    if (pairs[c]) {
      const st = this.i;
      this.i++;
      let n = 0;
      while (this.unqChar()) n++;
      if (n === 0 || this.ch() !== pairs[c]) {
        this.i = st;
        return false;
      }
      this.i++;
      return true;
    }
    if ("}])".includes(c)) return false;
    this.i++;
    return true;
  }

  unquoted(): string | null {
    const st = this.i;
    while (this.i < this.s.length) {
      if (this.isUnqSep() || this.ch() === "]") break;
      if (!this.unqChar()) break;
    }
    if (this.i === st) return null;
    return this.s.slice(st, this.i);
  }

  // ---------- signatures: (x, y=N | z:=1) ----------
  static parseSig(text: string): Param[] {
    const p = new Parser(text);
    const params: Param[] = [];
    let optional = false;
    const bad = () => new PotionError(`Bad signature "(${text})"`);
    for (;;) {
      p.ws2();
      if (p.i >= text.length) break;
      if (p.lit("|")) { optional = true; continue; }
      if (p.lit(",") || p.lit("...") || p.lit(".")) continue;
      if ("-\\*".includes(p.ch())) p.i++;
      const name = p.msgName(false);
      if (name === null) throw bad();
      p.ws1();
      const param: Param = { name, type: null, optional };
      if (p.lit(":=")) {
        p.ws1();
        const a = p.i;
        const v = p.immed();
        if (v === undefined) throw bad();
        param.def = v;
        param.defSrc = text.slice(a, p.i);
      } else if (p.lit("=")) {
        p.ws1();
        const t = p.msgName(false) ?? (p.ch() === "&" ? (p.i++, "&") : null);
        if (t === null) throw bad();
        param.type = t;
      }
      params.push(param);
    }
    return params;
  }

  static sigText(params: Param[]): string {
    return params
      .map((p, i) => {
        const sep = i === 0 ? (p.optional ? "|" : "") : p.optional && !params[i - 1].optional ? "|" : ",";
        return sep + p.name + (p.type ? "=" + p.type : "") + (p.defSrc !== undefined ? ":=" + p.defSrc : "");
      })
      .join("");
  }
}

export function parse(src: string): Node {
  return new Parser(src).program();
}
