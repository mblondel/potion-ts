// Runtime values for the Potion interpreter.
// Integers are plain JS numbers; doubles are boxed in Dbl so `1` and `1.0`
// stay distinct, as they are in Potion.

import type { Node } from "./parser";

export class Dbl {
  constructor(public v: number) {}
}

export class Tuple {
  constructor(public items: Value[] = []) {}
}

/** Tables keep insertion order (Potion uses hash order). */
export class Table {
  m = new Map<unknown, [Value, Value]>();
  static keyOf(k: Value): unknown {
    if (k instanceof Dbl) return "\u0002" + k.v;
    return k;
  }
  get(k: Value): Value {
    const e = this.m.get(Table.keyOf(k));
    return e ? e[1] : null;
  }
  has(k: Value): boolean {
    return this.m.has(Table.keyOf(k));
  }
  set(k: Value, v: Value) {
    this.m.set(Table.keyOf(k), [k, v]);
  }
  delete(k: Value) {
    this.m.delete(Table.keyOf(k));
  }
  entries(): [Value, Value][] {
    return [...this.m.values()];
  }
  get size() {
    return this.m.size;
  }
}

/** An item of Potion's data language: [name inner (attrs)] */
export class Lick {
  constructor(public name: Value, public inner: Value, public attr: Value) {}
}

/** A kind (vtable / mixin): a named, swappable set of methods. */
export class Kind {
  methods = new Map<string, Value>();
  ctor: Closure | null = null;
  meta: Kind | null = null;
  builtin = false;
  constructor(public name: string, public parent: Kind | null) {}
}

export class Obj {
  ivars = new Map<string, Value>();
  constructor(public kind: Kind) {}
}

export interface Param {
  name: string;
  type: string | null; // "N", "S", "&", "Number", ...
  def?: Value; // value from x:=default
  defSrc?: string;
  optional: boolean;
}

export class Frame {
  vars = new Map<string, Value>();
  constructor(public parent: Frame | null, public self: Value) {}
}

export class Closure {
  constructor(
    public params: Param[],
    public sigText: string,
    public body: Node[],
    public env: Frame,
    public self: Value,
    public name = "",
  ) {}
}

export type BuiltinFn = (self: Value, args: Value[]) => Value;

export class Builtin {
  constructor(
    public name: string,
    public params: Param[],
    public sigText: string,
    public fn: BuiltinFn,
  ) {}
}

export type Value =
  | null
  | boolean
  | number
  | string
  | Dbl
  | Tuple
  | Table
  | Lick
  | Kind
  | Obj
  | Closure
  | Builtin;

export type Fn = Closure | Builtin;
export const isFn = (v: Value): v is Fn => v instanceof Closure || v instanceof Builtin;
export const isNum = (v: Value): v is number | Dbl => typeof v === "number" || v instanceof Dbl;
export const numVal = (v: number | Dbl) => (typeof v === "number" ? v : v.v);
export const truthy = (v: Value) => v !== null && v !== false;

export function fmtDouble(d: number): string {
  if (Number.isNaN(d)) return "nan";
  if (!Number.isFinite(d)) return d > 0 ? "inf" : "-inf";
  if (Number.isInteger(d) && Math.abs(d) < 1e21) return d.toFixed(0) + ".0";
  return String(Number(d.toPrecision(16)));
}

export class PotionError extends Error {
  line?: number;
  /** id of the code cell the failing line belongs to */
  cell?: string;
  constructor(msg: string, line?: number) {
    super(msg);
    this.line = line;
  }
}
