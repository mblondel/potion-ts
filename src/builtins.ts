// Builtin methods, organised by kind. Signatures use Potion's own syntax.

import { builtin, equal, Interp, tupleAt, tuplePut } from "./interp";
import { parse } from "./parser";
import {
  Builtin, BuiltinFn, Closure, Dbl, fmtDouble, isFn, isNum, Kind, Lick, numVal, Obj,
  PotionError, Table, truthy, Tuple, Value,
} from "./values";

export function installBuiltins(I: Interp) {
  const K = I.K;
  const def = (k: Kind, name: string, sig: string, fn: BuiltinFn) => k.methods.set(name, builtin(name, sig, fn));
  const call = (fn: Value, ...args: Value[]) => {
    if (!isFn(fn) && !(fn instanceof Kind)) throw new PotionError(`Expected a block, got ${I.describe(fn)}`);
    return I.callValue(fn, null, args, null);
  };
  const int = (v: Value, what: string): number => {
    if (typeof v === "number") return v;
    if (v instanceof Dbl) return Math.trunc(v.v);
    throw new PotionError(`${what} expects a number, got ${I.describe(v)}`);
  };
  const chars = (s: string) => Array.from(s);
  const printStr = (v: Value): string =>
    v instanceof Tuple ? v.items.map((x) => printStr(x ?? null)).join("") : I.str(v);
  const cmp = (a: Value, b: Value): number => {
    if (isNum(a) && isNum(b)) return numVal(a) - numVal(b);
    const x = I.str(a), y = I.str(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const sorter = (order: Value) => (a: Value, b: Value) => {
    if (isFn(order)) return int(call(order, a, b), "sort block");
    return order === false ? cmp(b, a) : cmp(a, b);
  };

  // ---------- Lobby: the root every kind inherits from ----------
  const L = K.Lobby;
  def(L, "print", "", (self) => (I.out(printStr(self)), ""));
  def(L, "say", "", (self) => (I.out(I.str(self) + "\n"), ""));
  def(L, "string", "", (self) => I.str(self));
  def(L, "kind", "", (self) => I.kindOf(self));
  def(L, "self", "", (self) => self);
  def(L, "isa?", "type=o", (self, [t]) => t instanceof Kind && I.isa(I.kindOf(self), t));
  def(L, "subclass?", "type=o", (self, [t]) => {
    const k = self instanceof Kind ? self : I.kindOf(self);
    return t instanceof Kind && I.isa(k, t);
  });
  def(L, "responds?", "name=S", (self, [n]) => I.lookup(I.kindOf(self), n as string) !== null);
  def(L, "nil?", "", (self) => self === null);
  def(L, "number?", "", (self) => isNum(self));
  def(L, "integer?", "", (self) => typeof self === "number");
  def(L, "double?", "", (self) => self instanceof Dbl);
  def(L, "string?", "", (self) => typeof self === "string");
  def(L, "number", "", (self) => {
    if (self === true) return 1;
    if (self === false || self === null) return 0;
    if (isNum(self)) return self;
    if (typeof self === "string") return strToNum(self);
    return null;
  });
  def(L, "list", "size=N", (_s, [n]) => new Tuple(new Array(int(n, "list")).fill(null)));
  def(L, "def", "name=S,method=o", (self, [n, m]) => {
    const k = self instanceof Kind ? self : I.kindOf(self);
    k.methods.set(n as string, m);
    return m;
  });
  def(L, "meta", "", (self) => (self instanceof Kind ? I.metaOf(self) : I.kindOf(self)));
  def(L, "name", "", (self) => (self instanceof Kind ? self.name : null));
  def(L, "send", "message=S|args=o", (self, [m, args]) => {
    const found = I.lookup(I.kindOf(self), m as string);
    if (!found) return null;
    const pos = args instanceof Tuple ? args.items : args === null ? [] : [args];
    return I.invoke(found.v, self, pos, null, pos.length > 0);
  });
  def(L, "argv", "", () => new Tuple(["potion"]));
  def(L, "here", "", () => {
    throw new PotionError("Continuations (here) aren't supported in this browser clone");
  });

  // ---------- Number ----------
  const N = K.Number;
  def(N, "times", "block=&", (self, [b]) => {
    const n = int(self, "times");
    for (let i = 0; i < n; i++) (I.tick(), call(b, i));
    return self;
  });
  def(N, "to", "end=N,block=&", (self, [end, b]) => {
    const a = int(self, "to"), z = int(end, "to");
    const step = a <= z ? 1 : -1;
    for (let i = a; step > 0 ? i <= z : i >= z; i += step) (I.tick(), call(b, i));
    return end;
  });
  def(N, "step", "end=N,by=N,block=&", (self, [end, by, b]) => {
    const z = numVal(end as number), s = numVal(by as number);
    if (s === 0) throw new PotionError("step can't be 0");
    for (let i = numVal(self as number); s > 0 ? i <= z : i >= z; i += s) (I.tick(), call(b, i));
    return self;
  });
  def(N, "chr", "", (self) => String.fromCodePoint(int(self, "chr")));
  def(N, "integer", "", (self) => int(self, "integer"));
  def(N, "double", "", (self) => new Dbl(numVal(self as number)));
  def(N, "abs", "", (self) => (typeof self === "number" ? Math.abs(self) : new Dbl(Math.abs(numVal(self as Dbl)))));
  def(N, "sqrt", "", (self) => new Dbl(Math.sqrt(numVal(self as number))));
  def(N, "floor", "", (self) => Math.floor(numVal(self as number)));
  def(N, "ceil", "", (self) => Math.ceil(numVal(self as number)));
  def(N, "round", "", (self) => Math.round(numVal(self as number)));
  def(N, "min", "other=N", (self, [o]) => (cmp(self, o) <= 0 ? self : o));
  def(N, "max", "other=N", (self, [o]) => (cmp(self, o) >= 0 ? self : o));
  def(N, "even?", "", (self) => int(self, "even?") % 2 === 0);
  def(N, "odd?", "", (self) => Math.abs(int(self, "odd?") % 2) === 1);
  def(N, "rand", "", (self) =>
    typeof self === "number" ? Math.floor(Math.random() * self) : new Dbl(Math.random() * numVal(self as Dbl)));
  for (const fn of ["sin", "cos", "tan", "log", "exp"] as const)
    def(N, fn, "", (self) => new Dbl(Math[fn](numVal(self as number))));

  // ---------- String ----------
  const S = K.String;
  def(S, "length", "", (self) => chars(self as string).length);
  def(S, "slice", "|start=N,end=N", (self, [a, b]) => {
    const cs = chars(self as string), n = cs.length;
    let s = a === null ? 0 : int(a, "slice"), e = b === null ? n : int(b, "slice");
    if (s < 0) s += n;
    if (e < 0) e += n;
    if (e < s) e = n;
    return cs.slice(Math.max(0, s), Math.min(n, e)).join("");
  });
  def(S, "at", "index=N", (self, [i]) => I.callValue(self, null, [i], null));
  def(S, "ord", "|index=N", (self, [i]) => {
    const c = chars(self as string)[int(i ?? 0, "ord")];
    return c === undefined ? null : c.codePointAt(0)!;
  });
  def(S, "eval", "", (self) => I.run(self as string));
  def(S, "upper", "", (self) => (self as string).toUpperCase());
  def(S, "lower", "", (self) => (self as string).toLowerCase());
  def(S, "trim", "", (self) => (self as string).trim());
  def(S, "split", "|sep=S", (self, [sep]) =>
    new Tuple(sep === null || sep === "" ? chars(self as string) : (self as string).split(sep as string)));
  def(S, "starts?", "prefix=S", (self, [p]) => (self as string).startsWith(p as string));
  def(S, "ends?", "suffix=S", (self, [p]) => (self as string).endsWith(p as string));
  def(S, "find", "str=S", (self, [p]) => {
    const i = (self as string).indexOf(p as string);
    return i < 0 ? null : chars((self as string).slice(0, i)).length;
  });
  def(S, "repeat", "count=N", (self, [n]) => (self as string).repeat(Math.max(0, int(n, "repeat"))));
  def(S, "reverse", "", (self) => chars(self as string).reverse().join(""));

  // ---------- Tuple ----------
  const T = K.Tuple;
  const items = (self: Value) => (self as Tuple).items;
  def(T, "length", "", (self) => items(self).length);
  def(T, "size", "", (self) => items(self).length);
  def(T, "at", "index=N", (self, [i]) => tupleAt(self as Tuple, i));
  def(T, "put", "index=N,value=o", (self, [i, v]) => (tuplePut(self as Tuple, i, v), self));
  def(T, "push", "value=o", (self, [v]) => (items(self).push(v), self));
  def(T, "pop", "", (self) => items(self).pop() ?? null);
  def(T, "shift", "", (self) => items(self).shift() ?? null);
  def(T, "unshift", "value=o", (self, [v]) => (items(self).unshift(v), self));
  def(T, "first", "", (self) => items(self)[0] ?? null);
  def(T, "last", "", (self) => items(self)[items(self).length - 1] ?? null);
  def(T, "clone", "", (self) => new Tuple([...items(self)]));
  def(T, "reverse", "", (self) => new Tuple([...items(self)].reverse()));
  def(T, "each", "block=&", (self, [b]) => {
    items(self).forEach((x, i) => (I.tick(), call(b, x ?? null, i)));
    return self;
  });
  def(T, "map", "block=&", (self, [b]) => new Tuple(items(self).map((x, i) => (I.tick(), call(b, x ?? null, i)))));
  def(T, "filter", "block=&", (self, [b]) => new Tuple(items(self).filter((x, i) => (I.tick(), truthy(call(b, x ?? null, i))))));
  def(T, "reduce", "block=&|init=o", (self, [b, init]) => {
    let acc = init;
    let xs = items(self);
    if (acc === null) [acc, ...xs] = xs.length ? xs : [null];
    for (const x of xs) acc = call(b, acc, x ?? null);
    return acc;
  });
  def(T, "join", "|sep=S", (self, [sep]) => items(self).map((x) => I.str(x ?? null)).join((sep as string) ?? ""));
  def(T, "sort", "|order=o", (self, [o]) => new Tuple([...items(self)].sort(sorter(o))));
  def(T, "ins_sort", "|order=o", (self, [o]) => new Tuple([...items(self)].sort(sorter(o))));
  def(T, "remove", "index=N", (self, [i]) => {
    const xs = [...items(self)];
    const j = int(i, "remove");
    xs.splice(j < 0 ? xs.length + j : j, 1);
    return new Tuple(xs);
  });
  def(T, "delete", "index=N", (self, [i]) => {
    const j = int(i, "delete");
    items(self).splice(j < 0 ? items(self).length + j : j, 1);
    return self;
  });
  def(T, "slice", "|start=N,end=N", (self, [a, b]) => {
    const xs = items(self), n = xs.length;
    let s = a === null ? 0 : int(a, "slice"), e = b === null ? n - 1 : int(b, "slice");
    if (s < 0) s += n;
    if (e < 0) e += n;
    if (e < s) [s, e] = [e, s];
    return new Tuple(xs.slice(Math.max(0, s), e + 1));
  });
  def(T, "contains?", "value=o", (self, [v]) => items(self).some((x) => equal(x ?? null, v)));
  def(T, "sum", "", (self) => items(self).reduce((acc: Value, x) => I.binop("+", acc, x ?? null), 0));

  // ---------- Table ----------
  const Tb = K.Table;
  const tbl = (self: Value) => self as Table;
  def(Tb, "at", "key=o", (self, [k]) => tbl(self).get(k));
  def(Tb, "put", "key=o,value=o", (self, [k, v]) => (tbl(self).set(k, v), self));
  def(Tb, "remove", "key=o", (self, [k]) => (tbl(self).delete(k), self));
  def(Tb, "length", "", (self) => tbl(self).size);
  def(Tb, "keys", "", (self) => new Tuple(tbl(self).entries().map(([k]) => k)));
  def(Tb, "values", "", (self) => new Tuple(tbl(self).entries().map(([, v]) => v)));
  def(Tb, "each", "block=&", (self, [b]) => {
    for (const [k, v] of tbl(self).entries()) (I.tick(), call(b, k, v));
    return self;
  });
  def(Tb, "map", "block=&", (self, [b]) => new Tuple(tbl(self).entries().map(([k, v]) => call(b, k, v))));
  def(Tb, "filter", "block=&", (self, [b]) => {
    const t = new Table();
    for (const [k, v] of tbl(self).entries()) if (truthy(call(b, k, v))) t.set(k, v);
    return t;
  });
  def(Tb, "slice", "|keys=o", (self, [keys]) => {
    const t = new Table();
    if (keys === null) for (const [k, v] of tbl(self).entries()) t.set(k, v);
    else if (keys instanceof Tuple) for (const k of keys.items) if (tbl(self).has(k ?? null)) t.set(k ?? null, tbl(self).get(k ?? null));
    return t;
  });

  // ---------- Function ----------
  const F = K.Function;
  def(F, "arity", "", (self) => (self as Closure | Builtin).params.length);
  def(F, "minargs", "", (self) =>
    (self as Closure | Builtin).params.filter((p) => !p.optional && p.def === undefined).length);
  def(F, "call", "|args=o", (self, [a]) =>
    I.callValue(self, null, a instanceof Tuple ? a.items : a === null ? [] : [a], null));

  // ---------- Lick ----------
  const Lk = K.Lick;
  const lk = (self: Value) => self as Lick;
  def(Lk, "name", "", (self) => lk(self).name);
  def(Lk, "attr", "", (self) => lk(self).attr);
  def(Lk, "licks", "", (self) => (lk(self).inner instanceof Tuple ? lk(self).inner : null));
  def(Lk, "text", "", (self) => (typeof lk(self).inner === "string" ? lk(self).inner : null));
  def(Lk, "inner", "", (self) => lk(self).inner);

  void Obj; void fmtDouble; void parse;
}

function strToNum(s: string): Value {
  const t = s.trim();
  if (t === "") return 0;
  if (/^-?\d+$/.test(t)) {
    const n = parseInt(t, 10);
    return Math.abs(n) > 2147483647 ? new Dbl(n) : n;
  }
  const d = parseFloat(t);
  return Number.isNaN(d) ? 0 : new Dbl(d);
}
