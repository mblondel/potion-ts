// Runs Potion off the main thread so a runaway loop never freezes the page.
import { Node, parse } from "./parser";
import { runCells, RunCell } from "./session";
import { PotionError } from "./values";

declare const self: { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown): void };

function astText(n: Node | null, depth = 0, out: string[] = []): string[] {
  if (!n) return out;
  const pad = "  ".repeat(depth);
  const line = (s: string) => out.push(pad + s);
  const kids = (xs: Node[]) => xs.forEach((s) => astText(s, depth + 1, out));
  switch (n.k) {
    case "code": case "block": case "group": line(n.k); kids(n.stmts); break;
    case "expr":
      if (n.items.length === 1) return astText(n.items[0], depth, out);
      line("expr");
      kids(n.items);
      break;
    case "value": line(`value ${JSON.stringify(n.v?.v !== undefined ? n.v.v : n.v)}`); break;
    case "msg":
      line(`${n.q ? "query" : "message"} ${n.name ?? "(call)"}`);
      if (n.args) { out.push(pad + "  args"); astText(n.args, depth + 2, out); }
      if (n.block) astText(n.block, depth + 1, out);
      break;
    case "path": line(`path /${n.name}`); break;
    case "index": line(`index ${n.name}[…]`); break;
    case "assign": line("assign"); kids([n.lhs, n.rhs]); break;
    case "op": line(`op ${n.op}`); kids([n.a, n.b]); break;
    case "and": case "or": line(n.k); kids([n.a, n.b]); break;
    case "not": case "wavy": line(n.k); kids([n.a]); break;
    case "inc": line(`inc ${n.target.name} ${n.delta > 0 ? "+" : "-"}1${n.prefix ? " (prefix)" : ""}`); break;
    case "list": line(`list (${n.items.length})`); kids(n.items); break;
    case "proto": line(`closure (${n.sig ? n.sig.src : ""})`); astText(n.body, depth + 1, out); break;
    case "lick": line("lick"); kids(n.items); break;
    case "lickitem":
      line(`item ${n.name ?? ""}`);
      kids([n.nameVal, n.inner, n.attr].filter(Boolean));
      break;
    default: line(n.k);
  }
  return out;
}

self.onmessage = (e: MessageEvent) => {
  const d = e.data as { kind: "ast"; id: string; code: string } | { kind: "cells"; cells: RunCell[]; strict: boolean };
  if (d.kind === "ast") {
    try {
      self.postMessage({ id: d.id, text: astText(parse(d.code)).join("\n") });
    } catch (err) {
      const pe = err as PotionError;
      self.postMessage({ id: d.id, text: "", error: pe.message, line: pe.line ?? null });
    }
    return;
  }
  runCells(d.cells, d.strict, (m) => self.postMessage(m));
};
