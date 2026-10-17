// Tree-walking interpreter for Potion.

import { Node, Parser, parse } from "./parser";
import {
  Builtin, BuiltinFn, Closure, Dbl, fmtDouble, Fn, Frame, isFn, isNum, Kind, Lick,
  numVal, Obj, Param, PotionError, Table, truthy, Tuple, Value,
} from "./values";

class ReturnSig { constructor(public v: Value) {} }
const BREAK = { sig: "break" };
const CONTINUE = { sig: "continue" };
class Halt extends PotionError {}

const SPECIAL = new Set(["if", "elsif", "else", "while", "loop", "return", "break", "continue", "self", "class"]);

export interface Options {
  out?: (s: string) => void;
  warn?: (s: string) => void;
  /** check argument counts and signature types on user closures */
  strict?: boolean;
  /** abort after this many milliseconds (0 = never) */
  timeLimit?: number;
}

// ---------------------------------------------------------------------------
// Scope resolution: decides at "compile time" whether a name is a local, an
// upvalue (and how many closures up), or a message to self — like compile.c.
// ---------------------------------------------------------------------------
interface Scope { locals: Set<string>; parent: Scope | null }

function depthOf(sc: Scope, name: string): number {
  let d = 0;
  for (let s: Scope | null = sc; s; s = s.parent, d++) if (s.locals.has(name)) return d;
  return -1;
}
function declare(sc: Scope, name: string): number {
  const d = depthOf(sc, name);
  if (d >= 0) return d;
  sc.locals.add(name);
  return 0;
}
const isUpper = (s: string) => s.charCodeAt(0) >= 65 && s.charCodeAt(0) <= 90;
const simpleKey = (n: Node): string | null =>
  n.k === "expr" && n.items.length === 1 && n.items[0].k === "msg" && !n.items[0].q &&
  n.items[0].name !== null && !n.items[0].args && !n.items[0].block ? n.items[0].name : null;

function sigParams(list: Node | null): Param[] {
  if (!list) return [];
  return Parser.parseSig(list.src);
}

export function resolve(n: Node | null, sc: Scope): void {
  if (!n) return;
  switch (n.k) {
    case "code": case "group":
      for (const s of n.stmts) resolve(s, sc);
      return;
    case "expr":
      n.items.forEach((it: Node, i: number) => resolveItem(it, i, sc));
      return;
    case "assign": {
      const lhs: Node = n.lhs;
      if (lhs.k !== "expr") throw new PotionError("Assignment to illegal variable", n.line);
      const c = lhs.items.length - 1;
      for (let i = 0; i < c; i++) resolveItem(lhs.items[i], i, sc);
      const t: Node = lhs.items[c];
      if (t.k === "msg" && t.name !== null) {
        if (t.args) {
          if (c === 0) t.depth = depthOf(sc, t.name);
          resolveArgs(t.args, sc);
        } else if (c === 0 && !isUpper(t.name)) {
          t.depth = declare(sc, t.name);
        }
      } else if (t.k !== "path") {
        throw new PotionError("Assignment to illegal variable", n.line);
      }
      resolve(n.rhs, sc);
      return;
    }
    case "op": case "and": case "or":
      resolve(n.a, sc);
      resolve(n.b, sc);
      return;
    case "not": case "wavy":
      resolve(n.a, sc);
      return;
    case "inc": {
      const t = n.target;
      if (t.k !== "msg" || t.name === null || t.args || t.block)
        throw new PotionError("++/-- needs a variable", n.line);
      n.depth = declare(sc, t.name);
      return;
    }
    case "list":
      for (const it of n.items) {
        if (it.k === "assign" && simpleKey(it.lhs) !== null) resolve(it.rhs, sc);
        else if (it.k === "assign") { resolve(it.lhs, sc); resolve(it.rhs, sc); }
        else resolve(it, sc);
      }
      return;
    case "proto": {
      n.params = sigParams(n.sig);
      resolveBody(n.body, n.params, sc);
      return;
    }
    case "lick":
      for (const it of n.items) resolve(it, sc);
      return;
    case "lickitem":
      resolve(n.nameVal, sc);
      resolve(n.inner, sc);
      resolve(n.attr, sc);
      return;
    case "msg": case "path": case "index":
      resolveItem(n, 0, sc);
      return;
    case "value": case "block":
      if (n.k === "block") for (const s of n.stmts) resolve(s, sc);
      return;
  }
}

function resolveBody(block: Node, params: Param[], sc: Scope) {
  const inner: Scope = { locals: new Set(params.map((p) => p.name)), parent: sc };
  for (const s of block.stmts) resolve(s, inner);
}

function resolveArgs(args: Node | null, sc: Scope) {
  if (args) resolve(args, sc);
}

function resolveItem(it: Node, i: number, sc: Scope) {
  if (it.k === "index") {
    it.depth = depthOf(sc, it.name);
    const key: Node = it.key;
    if (key.name !== null && !key.inner && !key.attr) key.depth = depthOf(sc, key.name);
    else resolve(key, sc);
    return;
  }
  if (it.k === "path") {
    resolveArgs(it.args, sc);
    if (it.block) resolveBlock(it, sc);
    return;
  }
  if (it.k !== "msg") {
    resolve(it, sc);
    return;
  }
  const name: string | null = it.name;
  if (!it.q && name !== null && SPECIAL.has(name)) {
    const inline = name === "if" || name === "elsif" || name === "else" || name === "while" ||
      (name === "loop" && !it.args && it.block);
    if (inline) {
      it.special = true;
      if (it.args) resolveArgs(it.args, sc);
      if (it.block?.k === "block") for (const s of it.block.stmts) resolve(s, sc);
      else if (it.block) resolve(it.block, sc);
      return;
    }
    if (name !== "loop") {
      it.special = true;
      if (name === "class") {
        it.blockParams = it.args?.k === "list" ? sigParams(it.args) : [];
        if (it.block?.k === "block") resolveBody(it.block, it.blockParams, sc);
        else if (it.block) resolve(it.block, sc);
        return;
      }
      resolveArgs(it.args, sc);
      return;
    }
  }
  if (i === 0 && !it.q && name !== null) it.depth = depthOf(sc, name);
  // `x times (i): ...` — a list followed by a block is the block's signature
  if (it.block?.k === "block" && it.args?.k === "list" && !(it.depth >= 0) && name !== null) {
    it.blockParams = sigParams(it.args);
    it.argsAreSig = true;
    resolveBody(it.block, it.blockParams, sc);
    return;
  }
  resolveArgs(it.args, sc);
  resolveBlock(it, sc);
}

function resolveBlock(it: Node, sc: Scope) {
  if (!it.block) return;
  if (it.block.k === "block") {
    it.blockParams = [];
    resolveBody(it.block, [], sc);
  } else resolve(it.block, sc);
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------
export class Interp {
  K: { [name: string]: Kind } = {};
  lobby: Obj;
  out: (s: string) => void;
  warn: (s: string) => void;
  strict: boolean;
  private steps = 0;
  private deadline = 0;
  private depth = 0;

  constructor(opts: Options = {}) {
    this.out = opts.out ?? ((s) => (globalThis as any).process?.stdout.write(s));
    this.warn = opts.warn ?? (() => {});
    this.strict = opts.strict ?? false;
    if (opts.timeLimit) this.deadline = Date.now() + opts.timeLimit;
    const root = this.kind("Lobby", null);
    for (const n of ["Number", "String", "Tuple", "Table", "Function", "NilKind", "Boolean", "Lick"]) this.kind(n, root);
    this.lobby = new Obj(root);
    root.methods.set("Lobby", this.lobby);
    installBuiltins(this);
  }

  private kind(name: string, parent: Kind | null): Kind {
    const k = new Kind(name, parent);
    k.builtin = true;
    this.K[name] = k;
    if (parent) parent.methods.set(name, k);
    else k.methods.set(name, k);
    return k;
  }

  // ---------- running code ----------
  /** Runs source in this interpreter's session: names defined by one run
   *  stay visible to the next, like cells in a notebook. */
  run(src: string, cell?: string): Value {
    let ast: Node;
    try {
      ast = new Parser(src, cell).program();
    } catch (e) {
      if (e instanceof PotionError && e.cell === undefined) e.cell = cell;
      throw e;
    }
    return this.runAst(ast);
  }

  private topScope: Scope = { locals: new Set(), parent: null };
  private topFrame: Frame | null = null;

  runAst(ast: Node): Value {
    resolve(ast, this.topScope);
    const frame = (this.topFrame ??= new Frame(null, this.lobby));
    try {
      return this.execStmts(ast.stmts, frame);
    } catch (e) {
      if (e instanceof ReturnSig) return e.v;
      if (e === BREAK || e === CONTINUE) throw new PotionError(`'${(e as any).sig}' outside of a loop`);
      if (e instanceof RangeError) throw new PotionError("Stack overflow (recursion too deep)");
      throw e;
    }
  }

  tick() {
    if (++this.steps % 4096 === 0 && this.deadline && Date.now() > this.deadline)
      throw new Halt("Stopped: the program ran too long");
  }

  execStmts(stmts: Node[], f: Frame): Value {
    const ctx = { cond: null as Value };
    let v: Value = null;
    for (const s of stmts) v = this.eval(s, f, ctx);
    return v;
  }

  eval(n: Node, f: Frame, ctx = { cond: null as Value }): Value {
    try {
      return this.evalNode(n, f, ctx);
    } catch (e) {
      // pin the error to the line and cell it came from
      if (e instanceof PotionError && e.cell === undefined) {
        if (e.line === undefined) e.line = n.line;
        e.cell = n.cell;
      }
      throw e;
    }
  }

  private evalNode(n: Node, f: Frame, ctx: { cond: Value }): Value {
    switch (n.k) {
      case "value": return n.v;
      case "expr": return this.chain(n.items, f, ctx);
      case "msg": case "path": case "index": return this.chain([n], f, ctx);
      case "group": case "code": return this.execStmts(n.stmts, f);
      case "list": return this.evalList(n, f);
      case "proto": return new Closure(n.params, Parser.sigText(n.params), n.body.stmts, f, f.self);
      case "lick": return new Tuple(n.items.map((it: Node) => this.evalLickItem(it, f)));
      case "lickitem": return this.evalLickItem(n, f);
      case "op": return this.binop(n.op, this.operand(n.a, f), this.operand(n.b, f), n.line);
      case "and": { const a = this.operand(n.a, f); return truthy(a) ? this.operand(n.b, f) : a; }
      case "or": { const a = this.operand(n.a, f); return truthy(a) ? a : this.operand(n.b, f); }
      case "not": return !truthy(this.operand(n.a, f));
      case "wavy": {
        const a = this.operand(n.a, f);
        if (typeof a !== "number") throw new PotionError(`~ expects an integer, got ${this.describe(a)}`, n.line);
        return ~a;
      }
      case "inc": {
        const name = n.target.name;
        const old = this.getVar(f, n.depth, name);
        const nv = this.binop("+", old ?? 0, n.delta, n.line);
        this.setVar(f, n.depth, name, nv);
        return n.prefix ? nv : old;
      }
      case "assign": return this.assign(n, f);
      case "block": return this.execStmts(n.stmts, f);
    }
    throw new PotionError(`Internal error: unknown node ${n.k}`, n.line);
  }

  /** Operands of operators: `(a + b) * c` — a lone parenthesised list
   *  evaluates to its last item rather than a tuple (PN_ARG in compile.c). */
  private operand(n: Node, f: Frame): Value {
    if (n.k === "expr" && n.items.length === 1 && n.items[0].k === "list" &&
        !n.items[0].items.some((x: Node) => x.k === "assign")) {
      let v: Value = null;
      for (const x of n.items[0].items) v = this.eval(x, f);
      return v;
    }
    return this.eval(n, f);
  }

  // ---------- variables ----------
  private frameAt(f: Frame, depth: number): Frame {
    let fr = f;
    for (let d = 0; d < depth && fr.parent; d++) fr = fr.parent;
    return fr;
  }
  getVar(f: Frame, depth: number, name: string): Value {
    return this.frameAt(f, depth).vars.get(name) ?? null;
  }
  setVar(f: Frame, depth: number, name: string, v: Value) {
    this.frameAt(f, depth).vars.set(name, v);
  }
  /** runtime fallback for names used before their (outer) definition */
  private dynVar(f: Frame, name: string): { v: Value } | null {
    for (let fr: Frame | null = f; fr; fr = fr.parent) if (fr.vars.has(name)) return { v: fr.vars.get(name)! };
    return null;
  }

  // ---------- expression chains: a b c(1) d: ... ----------
  chain(items: Node[], f: Frame, ctx: { cond: Value }): Value {
    let cur: Value = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      this.tick();
      try {
        if (it.special) {
          cur = this.special(it, i, cur, f, ctx);
          continue;
        }
        switch (it.k) {
          case "msg": cur = this.message(it, i, cur, f); break;
          case "path": {
            const obj: Value = i === 0 ? f.self : cur;
            const v: Value = obj instanceof Obj ? obj.ivars.get(it.name) ?? null : null;
            cur = it.q ? truthy(v) : v;
            break;
          }
          case "index": cur = this.index(it, f); break;
          default: cur = this.eval(it, f);
        }
      } catch (e) {
        if (e instanceof PotionError && e.cell === undefined) {
          if (e.line === undefined) e.line = it.line;
          e.cell = it.cell;
        }
        throw e;
      }
    }
    return cur;
  }

  private condOf(args: Node | null, f: Frame): Value {
    if (!args) return null;
    if (args.k === "list") {
      let v: Value = null;
      for (const x of args.items) v = this.eval(x, f);
      return v;
    }
    return this.eval(args, f);
  }

  private special(it: Node, i: number, cur: Value, f: Frame, ctx: { cond: Value }): Value {
    switch (it.name) {
      case "if": {
        if (!it.args) throw new PotionError("Missing if clause");
        if (!it.block) throw new PotionError("Missing if body");
        ctx.cond = this.condOf(it.args, f);
        return truthy(ctx.cond) ? this.inline(it.block, f) : cur;
      }
      case "elsif": {
        if (truthy(ctx.cond)) return cur;
        ctx.cond = this.condOf(it.args, f);
        return truthy(ctx.cond) ? this.inline(it.block, f) : cur;
      }
      case "else":
        if (truthy(ctx.cond)) return cur;
        if (!it.block) throw new PotionError("Missing else body");
        return this.inline(it.block, f);
      case "while": case "loop": {
        if (!it.block) throw new PotionError(`Missing ${it.name} body`);
        for (;;) {
          this.tick();
          if (it.name === "while" && !truthy(this.condOf(it.args, f))) break;
          try {
            this.inline(it.block, f);
          } catch (e) {
            if (e === BREAK) break;
            if (e === CONTINUE) continue;
            throw e;
          }
        }
        return null;
      }
      case "return": throw new ReturnSig(this.condOf(it.args, f));
      case "break": throw BREAK;
      case "continue": throw CONTINUE;
      case "self": return f.self;
      case "class": {
        let parent: Kind = this.K.Lobby;
        if (i > 0) {
          if (!(cur instanceof Kind)) throw new PotionError(`Can't subclass ${this.describe(cur)}`);
          parent = cur;
        }
        const k = new Kind("", parent);
        if (it.block) {
          const params: Param[] = it.blockParams ?? [];
          k.ctor = new Closure(params, Parser.sigText(params), it.block.stmts, f, f.self);
        }
        return k;
      }
    }
    return null;
  }

  private inline(block: Node, f: Frame): Value {
    if (block.k === "block") return this.execStmts(block.stmts, f);
    return this.eval(block, f);
  }

  private evalArgs(args: Node | null, f: Frame): { pos: Value[]; named: Map<string, Value> | null } {
    const pos: Value[] = [];
    let named: Map<string, Value> | null = null;
    if (!args) return { pos, named };
    if (args.k === "list") {
      for (const it of args.items) {
        const key = it.k === "assign" ? simpleKey(it.lhs) : null;
        if (key !== null) (named ??= new Map()).set(key, this.eval(it.rhs, f));
        else pos.push(this.eval(it, f));
      }
    } else if (args.k === "lick") {
      for (const it of args.items) pos.push(this.evalLickItem(it, f));
    } else pos.push(this.eval(args, f));
    return { pos, named };
  }

  private blockArg(it: Node, f: Frame): Closure {
    const b = it.block;
    if (b.k === "proto") return this.eval(b, f) as Closure;
    const params: Param[] = it.blockParams ?? [];
    return new Closure(params, Parser.sigText(params), b.stmts, f, f.self);
  }

  private message(it: Node, i: number, cur: Value, f: Frame): Value {
    const name: string | null = it.name;
    // a local or upvalue at the head of the chain
    if (i === 0 && !it.q && name !== null && it.depth >= 0) {
      const v = this.getVar(f, it.depth, name);
      if (!it.args && !it.block) return v;
      const { pos, named } = this.evalArgs(it.args, f);
      if (it.block) pos.push(this.blockArg(it, f));
      return this.callValue(v, f.self, pos, named);
    }
    // anonymous call: `x (1)`
    if (name === null) {
      const { pos, named } = this.evalArgs(it.args, f);
      if (it.block) pos.push(this.blockArg(it, f));
      return this.callValue(cur, f.self, pos, named);
    }
    const recv = i === 0 ? f.self : cur;
    let pos: Value[] = [], named: Map<string, Value> | null = null;
    if (!it.argsAreSig) ({ pos, named } = this.evalArgs(it.args, f));
    if (it.block) pos.push(this.blockArg(it, f));
    const hasArgs = !!(it.args || it.block);
    const m = this.lookup(this.kindOf(recv), name);
    if (it.q) {
      if (!m) return hasArgs ? null : false;
      return hasArgs ? this.invoke(m.v, recv, pos, named, true) : true;
    }
    if (!m) {
      if (i === 0) {
        const dv = this.dynVar(f, name);
        if (dv) return hasArgs ? this.callValue(dv.v, f.self, pos, named) : dv.v;
      }
      this.warn(`${this.describe(recv)} doesn't respond to '${name}' (line ${it.line}), returning nil`);
      return null;
    }
    return this.invoke(m.v, recv, pos, named, hasArgs);
  }

  private index(it: Node, f: Frame): Value {
    const base = it.depth >= 0 ? this.getVar(f, it.depth, it.name) : this.dynVar(f, it.name)?.v ?? null;
    const k: Node = it.key;
    const key = k.name !== null && !k.inner && !k.attr
      ? (k.depth >= 0 ? this.getVar(f, k.depth, k.name) : this.dynVar(f, k.name)?.v ?? null)
      : this.eval(k.nameVal, f);
    return this.callValue(base, f.self, [key], null);
  }

  lookup(kind: Kind, name: string): { v: Value } | null {
    for (let k: Kind | null = kind; k; k = k.parent) if (k.methods.has(name)) return { v: k.methods.get(name)! };
    return null;
  }

  /** Methods with no parameters act like properties: they run on lookup,
   *  and any arguments are then applied to the result (Potion's bind). */
  invoke(m: Value, recv: Value, pos: Value[], named: Map<string, Value> | null, hasArgs: boolean): Value {
    if (isFn(m)) {
      if (m.params.length === 0) {
        const r = this.callFn(m, recv, [], null);
        return hasArgs && (pos.length || named) ? this.callValue(r, recv, pos, named) : r;
      }
      return this.callFn(m, recv, pos, named);
    }
    return hasArgs ? this.callValue(m, recv, pos, named) : m;
  }

  /** What happens when a value is "called": obj(args) */
  callValue(v: Value, self: Value, pos: Value[], named: Map<string, Value> | null): Value {
    if (v instanceof Closure) return this.callFn(v, v.self, pos, named);
    if (v instanceof Builtin) return this.callFn(v, self, pos, named);
    if (v instanceof Kind) return this.construct(v, pos, named);
    const a = pos[0] ?? (named ? [...named.values()][0] : null);
    if (v instanceof Tuple) return tupleAt(v, a);
    if (v instanceof Table) return v.get(a);
    if (typeof v === "string") {
      if (typeof a !== "number") return v;
      const cs = Array.from(v);
      return cs[a < 0 ? cs.length + a : a] ?? null;
    }
    return v; // numbers, booleans, nil and objects return themselves
  }

  construct(k: Kind, pos: Value[], named: Map<string, Value> | null): Value {
    if (k.builtin) throw new PotionError(`Can't construct a ${k.name} this way`);
    const o = new Obj(k);
    for (let c: Kind | null = k; c; c = c.parent) {
      if (c.ctor) {
        this.callFn(c.ctor, o, pos, named);
        break;
      }
    }
    return o;
  }

  callFn(fn: Fn, self: Value, pos: Value[], named: Map<string, Value> | null): Value {
    const args = this.bind(fn, pos, named);
    if (fn instanceof Builtin) return fn.fn(self, args);
    if (++this.depth > 3000) {
      this.depth = 0;
      throw new PotionError("Stack overflow (recursion too deep)");
    }
    const frame = new Frame(fn.env, self);
    fn.params.forEach((p, i) => frame.vars.set(p.name, args[i]));
    try {
      return this.execStmts(fn.body, frame);
    } catch (e) {
      if (e instanceof ReturnSig) return e.v;
      if (e === BREAK || e === CONTINUE) throw new PotionError(`'${(e as any).sig}' outside of a loop`);
      throw e;
    } finally {
      this.depth--;
    }
  }

  fnLabel(fn: Fn): string {
    return `${fn.name || "function"}(${fn.sigText})`;
  }

  private bind(fn: Fn, pos: Value[], named: Map<string, Value> | null): Value[] {
    const ps = fn.params;
    const strict = this.strict || fn instanceof Builtin;
    const out: Value[] = new Array(ps.length).fill(null);
    const filled: boolean[] = new Array(ps.length).fill(false);
    if (named) {
      for (const [k, v] of named) {
        const idx = ps.findIndex((p) => p.name === k);
        if (idx < 0) {
          if (strict) throw new PotionError(`${this.fnLabel(fn)} has no argument named '${k}'`);
          continue;
        }
        out[idx] = v;
        filled[idx] = true;
      }
    }
    if (fn instanceof Builtin && pos.length + (named?.size ?? 0) > ps.length)
      throw new PotionError(`Too many arguments to ${this.fnLabel(fn)}. It takes ${ps.length}, given ${pos.length + (named?.size ?? 0)}`);
    let j = 0;
    for (const v of pos) {
      while (j < ps.length && filled[j]) j++;
      if (j >= ps.length) break;
      out[j] = v;
      filled[j++] = true;
    }
    const required = ps.filter((p) => !p.optional && p.def === undefined).length;
    ps.forEach((p, i) => {
      if (filled[i]) {
        if (strict && p.type && !(out[i] === null && (p.optional || p.def !== undefined)) && !this.typeOk(out[i], p.type))
          throw new PotionError(
            `Type error: ${fn.name || "this function"} expects ${p.name} to be ${article(this.typeName(p.type))}, but got ${this.describe(out[i])}`);
        return;
      }
      if (p.def !== undefined) out[i] = p.def;
      else if (p.optional || !strict) out[i] = p.type === "N" || p.type === "I" ? 0 : null;
      else {
        const given = filled.filter(Boolean).length;
        throw new PotionError(`Not enough arguments to ${this.fnLabel(fn)}. Required ${required}, given ${given}`);
      }
    });
    return out;
  }

  typeName(t: string): string {
    const m: { [c: string]: string } = {
      N: "Number", I: "Integer", D: "Double", S: "String", B: "Boolean", "&": "Function",
      u: "Tuple", T: "Table", k: "Lick", o: "anything", n: "nil",
    };
    return m[t] ?? t;
  }

  typeOk(v: Value, t: string): boolean {
    switch (t) {
      case "o": case "a": return true;
      case "N": return isNum(v);
      case "I": return typeof v === "number";
      case "D": return v instanceof Dbl;
      case "S": return typeof v === "string";
      case "B": return typeof v === "boolean";
      case "&": return isFn(v) || v instanceof Kind;
      case "u": return v instanceof Tuple;
      case "T": return v instanceof Table;
      case "k": return v instanceof Lick;
      case "n": return v === null;
    }
    if (t === "Integer") return typeof v === "number";
    if (t === "Double") return v instanceof Dbl;
    const k = this.lookup(this.K.Lobby, t);
    if (!k || !(k.v instanceof Kind)) throw new PotionError(`Unknown type '${t}' in signature`);
    return this.isa(this.kindOf(v), k.v);
  }

  isa(k: Kind, target: Kind): boolean {
    for (let c: Kind | null = k; c; c = c.parent) if (c === target) return true;
    return false;
  }

  // ---------- assignment ----------
  private assign(n: Node, f: Frame): Value {
    const items: Node[] = n.lhs.items;
    const c = items.length - 1;
    const cur = c > 0 ? this.chain(items.slice(0, c), f, { cond: null }) : f.self;
    const t = items[c];
    if (t.k === "path") {
      const v = this.eval(n.rhs, f);
      const obj = c === 0 ? f.self : cur;
      if (!(obj instanceof Obj)) throw new PotionError(`Can't set /${t.name} on ${this.describe(obj)}`, n.line);
      obj.ivars.set(t.name, v);
      return v;
    }
    const name: string = t.name;
    if (t.args) {
      // callset: x(1) = v
      let obj: Value;
      const bare: Node = { ...t, args: null, block: null };
      if (c === 0) obj = t.depth >= 0 ? this.getVar(f, t.depth, name) : this.message(bare, 0, null, f);
      else obj = this.message(bare, 1, cur, f);
      const { pos } = this.evalArgs(t.args, f);
      const v: Value = this.eval(n.rhs, f);
      if (obj instanceof Tuple) tuplePut(obj, pos[0], v);
      else if (obj instanceof Table) obj.set(pos[0], v);
      return v;
    }
    const v = this.eval(n.rhs, f);
    if (v instanceof Closure && !v.name) v.name = name;
    if (isUpper(name)) {
      this.K.Lobby.methods.set(name, v);
      if (v instanceof Kind && !v.name) v.name = name;
    } else if (c === 0) {
      this.setVar(f, t.depth, name, v);
    } else {
      const k = cur instanceof Kind ? cur : this.kindOf(cur);
      k.methods.set(name, v);
    }
    return v;
  }

  // ---------- data ----------
  private evalList(n: Node, f: Frame): Value {
    const isTable = n.items.some((it: Node) => it.k === "assign");
    if (!isTable) return new Tuple(n.items.map((it: Node) => this.eval(it, f)));
    const t = new Table();
    let idx = 0;
    for (const it of n.items) {
      if (it.k === "assign") {
        const sk = simpleKey(it.lhs);
        const key = sk !== null ? sk : this.eval(it.lhs, f);
        t.set(key, this.eval(it.rhs, f));
      } else t.set(idx++, this.eval(it, f));
    }
    return t;
  }

  private evalLickItem(it: Node, f: Frame): Lick {
    const name = it.name !== null ? it.name : this.eval(it.nameVal, f);
    return new Lick(name, it.inner ? this.eval(it.inner, f) : null, it.attr ? this.eval(it.attr, f) : null);
  }

  // ---------- operators ----------
  binop(op: string, a: Value, b: Value, line?: number): Value {
    switch (op) {
      case "==": return equal(a, b);
      case "!=": return !equal(a, b);
    }
    if (op === "<" || op === ">" || op === "<=" || op === ">=" || op === "<=>") {
      let c: number;
      if (isNum(a) && isNum(b)) c = numVal(a) - numVal(b);
      else if (typeof a === "string" && typeof b === "string") c = a < b ? -1 : a > b ? 1 : 0;
      else throw new PotionError(`Can't compare ${this.describe(a)} ${op} ${this.describe(b)}`, line);
      switch (op) {
        case "<": return c < 0;
        case ">": return c > 0;
        case "<=": return c <= 0;
        case ">=": return c >= 0;
        default: return c < 0 ? -1 : c > 0 ? 1 : 0;
      }
    }
    if (!isNum(a) || !isNum(b))
      throw new PotionError(`Can't apply ${op} to ${this.describe(a)} and ${this.describe(b)}`, line);
    const ints = typeof a === "number" && typeof b === "number";
    const x = numVal(a), y = numVal(b);
    const num = (r: number) => (Number.isSafeInteger(r) ? r : new Dbl(r));
    if (ints) {
      switch (op) {
        case "+": return num(x + y);
        case "-": return num(x - y);
        case "*": return num(x * y);
        case "/":
          if (y === 0) throw new PotionError("Division by zero", line);
          return Math.trunc(x / y);
        case "%":
          if (y === 0) throw new PotionError("Division by zero", line);
          return x % y;
        case "**": return y >= 0 ? num(x ** y) : new Dbl(x ** y);
        case "<<": return num(x * 2 ** y);
        case ">>": return Math.floor(x / 2 ** y);
        case "&": return x & y;
        case "|": return x | y;
        case "^": return x ^ y;
      }
    }
    switch (op) {
      case "+": return new Dbl(x + y);
      case "-": return new Dbl(x - y);
      case "*": return new Dbl(x * y);
      case "/": return new Dbl(x / y);
      case "%": return new Dbl(x % y);
      case "**": return new Dbl(x ** y);
    }
    throw new PotionError(`${op} needs integers, got ${this.describe(a)} and ${this.describe(b)}`, line);
  }

  // ---------- reflection & printing ----------
  kindOf(v: Value): Kind {
    const K = this.K;
    if (v === null) return K.NilKind;
    if (typeof v === "boolean") return K.Boolean;
    if (typeof v === "number" || v instanceof Dbl) return K.Number;
    if (typeof v === "string") return K.String;
    if (v instanceof Tuple) return K.Tuple;
    if (v instanceof Table) return K.Table;
    if (v instanceof Lick) return K.Lick;
    if (v instanceof Obj) return v.kind;
    if (v instanceof Kind) return this.metaOf(v);
    return K.Function;
  }

  metaOf(k: Kind): Kind {
    if (!k.meta) {
      k.meta = new Kind(`${k.name || "class"} meta`, k.parent ? this.metaOf(k.parent) : this.K.Lobby);
      if (k === this.K.Lobby) k.meta.parent = this.K.Lobby;
    }
    return k.meta;
  }

  str(v: Value): string {
    if (v === null) return "nil";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    if (typeof v === "string") return v;
    if (v instanceof Dbl) return fmtDouble(v.v);
    if (v instanceof Tuple) {
      const items = Array.from(v.items, (x) => this.str(x ?? null));
      if (v.items.length && v.items.every((x) => x instanceof Lick)) return "[" + items.join(", ") + "]";
      return "(" + items.join(", ") + ")";
    }
    if (v instanceof Table) return "(" + v.entries().map(([k, x]) => `${this.str(k)}=${this.str(x)}`).join(", ") + ")";
    if (v instanceof Lick) {
      const parts = [this.str(v.name)];
      if (v.inner !== null) parts.push(this.str(v.inner));
      if (v.attr !== null) parts.push(this.str(v.attr));
      return parts.join(" ");
    }
    if (v instanceof Kind) return v.name || "class";
    if (v instanceof Obj) {
      if (v === this.lobby) return "Lobby";
      const ivars = [...v.ivars].map(([k, x]) => ` /${k}=${this.str(x)}`).join("");
      return `<${v.kind.name || "object"}${ivars}>`;
    }
    if (v instanceof Builtin) return `function(${v.sigText})`;
    return `function(${v.sigText})`;
  }

  describe(v: Value): string {
    const k = this.kindOf(v);
    if (v === null) return "nil";
    if (v === this.lobby) return "Lobby";
    let s = this.str(v);
    if (s.length > 24) s = s.slice(0, 21) + "...";
    if (typeof v === "string") s = JSON.stringify(s);
    return v instanceof Kind ? s : `${k.name || "object"} ${s}`;
  }
}

// ---------------------------------------------------------------------------
// helpers shared with builtins
// ---------------------------------------------------------------------------
export function equal(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (a instanceof Dbl && b instanceof Dbl) return a.v === b.v;
  if (a instanceof Tuple && b instanceof Tuple)
    return a.items.length === b.items.length && a.items.every((x, i) => equal(x ?? null, b.items[i] ?? null));
  return false;
}

/** "a Number", "an Integer" */
function article(noun: string): string {
  return (/^[AEIOU]/i.test(noun) ? "an " : "a ") + noun;
}

export function tupleAt(t: Tuple, i: Value): Value {
  if (typeof i !== "number") return null;
  const n = t.items.length;
  return t.items[i < 0 ? n + i : i] ?? null;
}

export function tuplePut(t: Tuple, i: Value, v: Value) {
  if (typeof i !== "number") throw new PotionError("Tuple index must be an integer");
  const n = t.items.length;
  const j = i < 0 ? n + i : i;
  while (t.items.length < j) t.items.push(null);
  t.items[j] = v;
}

export function builtin(name: string, sig: string, fn: BuiltinFn): Builtin {
  const params = Parser.parseSig(sig);
  return new Builtin(name, params, Parser.sigText(params), fn);
}

import { installBuiltins } from "./builtins";
