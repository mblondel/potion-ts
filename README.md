# Potion.ts

A small reimplementation of [Potion](https://github.com/perl11/potion), the little
language _why the lucky stiff wrote in 2009, in TypeScript. It runs in the browser as
a literate tutorial: chapters of prose with live, editable code cells and
self-checking exercises.

## Layout

- `src/parser.ts`: a backtracking port of Potion's PEG grammar (`core/syntax.y`)
- `src/interp.ts`: scope resolution (locals and upvalues, as in `compile.c`) and the evaluator
- `src/builtins.ts`: methods for Number, String, Tuple, Table, Function, Lick and the Lobby
- `src/session.ts`: runs a chapter's cells in one shared session
- `src/tutorial.ts`: the tutorial content, one chapter per entry
- `src/book.ts`, `src/worker.ts`, `web/book.html`: the page; code runs in a Web Worker
- `docs/index.html`: the built page (generated, but committed so GitHub Pages can serve it)

## Commands

Needs [Bun](https://bun.sh). `tsc` is only used for type checking.

    bun build.ts                         # writes docs/index.html
    bun test/tutorial.ts                 # runs every tutorial cell and exercise solution

To change the tutorial, edit `src/tutorial.ts`, run `bun test/tutorial.ts`, then
`bun build.ts`.

## Differences from Potion

Not supported: continuations (`here`), files and networking (aio, buffile, database,
load) and the C foreign-function interface. Tables print in insertion order rather
than hash order. Signature types such as `x=N` are always checked; the original
parses them but never checks them. Chapter 8 has a switch that turns checking off
for that chapter, to show the difference.

## Credits

Potion is by _why the lucky stiff and maintained at
[perl11/potion](https://github.com/perl11/potion) under the MIT license. The
bottle drawing on the page comes from its README.
