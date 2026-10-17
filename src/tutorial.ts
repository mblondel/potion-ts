// The tutorial: prose, live code cells and exercises, chapter by chapter.
// Prose uses `code`, *emphasis* and [links](https://…).
// Cells in a chapter share one session, top to bottom. Cells marked `error`
// and exercises run on top of that session but don't feed into later cells.

export type Block =
  | { t: "p"; text: string }
  | { t: "aside"; text: string }
  | { t: "code"; code: string; error?: boolean }
  | { t: "switch"; label: string; text: string } // turns type checking off for its chapter
  | { t: "exercise"; title: string; prompt: string; code: string; expect: string; hint: string; solution: string };

export interface Chapter { id: string; title: string; blocks: Block[] }

const p = (text: string): Block => ({ t: "p", text });
const aside = (text: string): Block => ({ t: "aside", text });
const code = (src: string, error = false): Block => ({ t: "code", code: src.trim(), error });

export const CHAPTERS: Chapter[] = [
  {
    id: "messages",
    title: "Everything is a message",
    blocks: [
      p("A Potion program is a stream of *messages* sent to values. `\"Hello\" say` sends the message `say` to the string `\"Hello\"`, and the string decides what that means."),
      code(`"Hello, potion!" say`),
      p("`say` prints the value it receives, followed by a new line."),
      p("Not every message prints something, and every cell has a value either way: whatever its last line works out to. It appears after the arrow, with its kind on the right. Here `length` answers with a number and prints nothing."),
      code(`"potion" length`),
      aside("If you know JavaScript or Ruby, unlearn one habit: a period never sends a message here, so you write `\"potion\" length`, not `\"potion\".length`."),
      p("A message can also take a *block*: the code between a colon and a period. Here `times` is sent to `5` together with a block, and runs it five times."),
      code(`5 times: "Odelay! " print.`),
      p("`print` is like `say` without the new line. The cell's value is `5`, because `times` answers with the number it was sent to."),
      p("In Potion, `.` means *end*, the way it ends a sentence. A colon opens a block and a period closes it. A block can span several lines, and nothing ends until the period arrives."),
      code(`
3 times:
  "tick " print
  "tock " print.
"done" say`),
      p("The block holds both `print` lines, so `tick tock` appears three times. The period after the second `print` closes the block, which is why `\"done\"` prints only once. Indentation is only for the reader; Potion doesn't look at it."),
      p("Blocks nest, and each one needs its own period. Here the inner block ends on its own line, and the outer one ends after `\"\" say`."),
      code(`
2 times (i):
  3 times (j): ("[", i, j, "] ") join print.
  "" say.`),
      p("Messages chain from left to right, each one sent to the result of the one before. Here `sort`, `reverse` and `first` are sent in turn."),
      code(`(3, 1, 2) sort reverse first`),
      p("Numbers come in two kinds that look alike. Integers stay integers, so `7 / 2` is `3`. Write a decimal point to get a double."),
      code(`(7 / 2, 7.0 / 2, 2 ** 10, 90 << 4)`),
      {
        t: "exercise",
        title: "Square a length",
        prompt: "Make this cell's value `36`, using only `\"potion\"`, `length` and `*`.",
        code: `"potion" length`,
        expect: "36",
        hint: "Messages bind tighter than operators, so `a length * b length` multiplies two lengths.",
        solution: `"potion" length * "potion" length`,
      },
    ],
  },
  {
    id: "data",
    title: "Tuples and tables",
    blocks: [
      p("`=` gives a name a value. Parentheses with commas build a *tuple*, which is Potion's list."),
      code(`
name = "Odelay"
year = 2009
(name, year)`),
      p("Cells in the same chapter share their names, from top to bottom. The `foods` defined here is still there in the cells that follow, so you can read the chapter as one program."),
      code(`
foods = ("cheese", "bread", "mayo")
(foods length, foods at (1), foods (2), foods (-1))`),
      p("Calling a tuple like a function indexes it, so `foods (2)` and `foods at (2)` mean the same thing. Negative indexes count from the end."),
      code(`
foods push ("pickles")
foods`),
      p("Tuples are mutable: `push` changes `foods` itself instead of making a new tuple, so the cells below see four foods."),
      p("Put `name=value` pairs inside the parentheses and you get a *table* instead."),
      code(`
pantry = (cheese=3, bread=1, mayo=0)
pantry put ("pickles", 12)
(pantry ("cheese"), pantry length)`),
      aside("Lowercase names belong to the block that assigns them. A name that starts with a capital letter, like `Lobby` or `Number`, is global."),
      {
        t: "exercise",
        title: "Reorder the foods",
        prompt: "Using `foods` from above, make this cell's value `(mayo, cheese)`.",
        code: `(foods at (0), foods at (1))`,
        expect: "(mayo, cheese)",
        hint: "`foods` now holds cheese, bread, mayo and pickles. Indexes start at 0.",
        solution: `(foods (2), foods (0))`,
      },
    ],
  },
  {
    id: "closures",
    title: "Blocks and closures",
    blocks: [
      p("A closure is a signature in parentheses followed by a block. You call it by sending it arguments."),
      code(`
add = (x, y): x + y.
add (2, 4)`),
      p("Arguments can also be passed by name, in any order."),
      code(`
minus = (x, y): x - y.
(minus (10, 4), minus (y=10, x=4))`),
      p("`:=` gives an argument a default. The signature is part of the closure's value, so asking for `greet` by itself shows it."),
      code(`
greet = (name, greeting:="Hello"): (greeting, ", ", name, "!") join.
greet ("Ada") say
greet ("Grace", "Odelay") say
greet`),
      p("A closure doesn't need arguments. Empty parentheses before the colon make one that takes none, and empty parentheses after its name call it."),
      code(`
hello = (): "hello" print.
hello ()`),
      p("So `()` does two jobs: before a colon it declares a closure with no arguments, and after a value it calls one."),
      p("Closures remember the names around them. Here `counter` is a closure with no arguments whose last line is another one, `(): n = n + 1.`, so calling `counter` returns that inner closure. Each call to `counter` makes a fresh `n` that only the closure it returns can reach."),
      code(`
counter = ():
  n = 0
  (): n = n + 1.
.
tick = counter ()
tick ()
tick ()
tick ()`),
      p("A block written after a message becomes that message's last argument. A list right before the block names the block's own arguments, here `i`."),
      code(`3 times (i): ("round ", i) join say.`),
      {
        t: "exercise",
        title: "Twice",
        prompt: "Change `twice` so that it applies `f` two times. The cell's value should be `63`.",
        code: `
twice = (f, x): f (x).
twice ((x): x * 3., 7)`.trim(),
        expect: "63",
        hint: "`f (x)` applies `f` once. Pass its result back into `f`.",
        solution: `
twice = (f, x): f (f (x)).
twice ((x): x * 3., 7)`.trim(),
      },
    ],
  },
  {
    id: "flow",
    title: "Deciding and repeating",
    blocks: [
      p("`if` is a message too, so an `if` chain has a value you can return or assign. Each branch is a block that ends with its own period, and an `elsif` or `else` on the next line continues the chain."),
      code(`
size = (n):
  if (n < 10): "small".
  elsif (n < 100): "medium".
  else: "large".
.
(size (3), size (42), size (1000))`),
      p("The last period, alone on its line, closes the block of `size` itself."),
      p("`while` repeats its block for as long as its condition holds. This counts the steps 27 takes to reach 1 in the Collatz sequence."),
      code(`
n = 27, steps = 0
while (n != 1):
  n = if (n % 2 == 0): n / 2. else: 3 * n + 1.
  steps++.
steps`),
      p("Tuples answer `each`, `map` and `filter`, each with a block. Numbers answer `to`, which counts from one number to another."),
      code(`
squares = (1, 2, 3, 4, 5, 6) map (n): n * n.
evens = squares filter (n): n % 2 == 0.
1 to 3 (i): ("pass ", i) join say.
(squares, evens)`),
      p("Blocks are ordinary values, so you can write your own control structures. `repeat` takes a count and a block, and decides when to call the block, just as `times` does."),
      code(`
repeat = (n, block):
  i = 0
  while (i < n):
    block (i)
    i++.
  n.
repeat 3 (i): ("round ", i) join say.`),
      p("A block written after a call is always passed as the last argument, so a closure that takes a block should list it last, as `repeat` does with `block`. Inside, `block (i)` calls it with the round number. Here is a second one, which runs its block only when a condition is false."),
      code(`
unless = (test, block):
  if (not test): block ().
.
unless (3 > 2): "never printed" say.
unless (2 > 3): "two is not bigger than three" say.`),
      {
        t: "exercise",
        title: "FizzBuzz",
        prompt: "Fill in `fizzbuzz` so that it returns `\"Fizz\"` for multiples of 3, `\"Buzz\"` for multiples of 5, `\"FizzBuzz\"` for multiples of both, and the number otherwise.",
        code: `
fizzbuzz = (n):
  # your if chain here
  n.
out = ()
1 to 15 (i): out push (fizzbuzz (i)).
out`.trim(),
        expect: "(1, 2, Fizz, 4, Buzz, Fizz, 7, 8, Fizz, Buzz, 11, Fizz, 13, 14, FizzBuzz)",
        hint: "Check `n % 15 == 0` first, then 3, then 5, with the same `if` and `elsif` shape as `size` above.",
        solution: `
fizzbuzz = (n):
  if (n % 15 == 0): "FizzBuzz".
  elsif (n % 3 == 0): "Fizz".
  elsif (n % 5 == 0): "Buzz".
  else: n.
.
out = ()
1 to 15 (i): out push (fizzbuzz (i)).
out`.trim(),
      },
    ],
  },
  {
    id: "kinds",
    title: "Kinds and mixins",
    blocks: [
      p("Potion has no classes in the usual sense. Every value has a *kind*: a set of methods that you can add to or change at any time. _why called these mixins."),
      code(`(5 kind, "five" kind, (1, 2) kind, nil kind)`),
      p("Assigning to `Kind name` adds a method to every value of that kind. Inside the method, `self` is the value that received the message."),
      code(`
String shout = (): (self upper, "!") join.
"potion" shout`),
      p("A method without arguments reads like a property. A method can end in a question mark too."),
      code(`
Number squared = (): self * self.
Number between? = (lo, hi): self >= lo and self <= hi.
(7 squared, 7 between? (1, 10), 70 between? (1, 10))`),
      p("Put a question mark in front of a message to ask whether a value responds to it, without sending it."),
      code(`(7 ?squared, "seven" ?squared, "seven" ?shout)`),
      p("This is *duck typing*: if it walks like a duck and quacks like a duck, it's a duck. Potion doesn't ask what kind a value is before sending it a message, only whether it answers. So a closure can accept anything that responds to `shout`, and fall back to something else when a value doesn't."),
      code(`
loud = (x):
  if (x ?shout): x shout.
  else: x string.
.
(loud ("potion"), loud (42))`),
      p("A string answers `shout` because of the method added above, so it gets shouted. A number doesn't, so `loud` falls back to `string`. Chapter 8 shows the opposite approach, where a signature names the kind it expects."),
      aside("These methods now exist on every string and number for the rest of this chapter. _why planned to let you scope such changes to one file or one closure, but that part was never built."),
      {
        t: "exercise",
        title: "A second method",
        prompt: "Teach every tuple a `second` method, so that this cell's value is `plum`.",
        code: `
# Tuple second = ...
("ink", "plum", "glass") second`.trim(),
        expect: "plum",
        hint: "Follow the shape of `String shout` above, and use `self at (1)`.",
        solution: `
Tuple second = (): self at (1).
("ink", "plum", "glass") second`.trim(),
      },
    ],
  },
  {
    id: "classes",
    title: "Classes and paths",
    blocks: [
      p("`class` turns a block into a constructor. Inside it, `/life` is an instance variable: a *path* into the object being built."),
      code(`
Creature = class (life, strength):
  /life = life
  /strength = strength.

Creature describe = ():
  ("life ", /life, ", strength ", /strength) join.

Creature (45, 65) describe`),
      p("A method that ends with `self` returns the object, so calls to it can be chained."),
      code(`
Creature hit = (damage):
  /life = /life - damage
  self.

c = Creature (45, 65)
c hit (20) hit (5) describe`),
      p("Send `class` to an existing class to make a subclass. `Rabbit` inherits `describe` and `hit`, and `r /bombs` reads a path from outside the object."),
      code(`
Rabbit = Creature class (bombs):
  /life = 10
  /strength = 44
  /bombs = bombs.

r = Rabbit (3)
(r describe, r /bombs, r isa? (Creature))`),
      {
        t: "exercise",
        title: "Heal",
        prompt: "Give `Creature` a `heal` method that adds to `/life` and returns the creature, so the cell's value is `life 50, strength 65`.",
        code: `
# Creature heal = ...
Creature (45, 65) hit (15) heal (20) describe`.trim(),
        expect: "life 50, strength 65",
        hint: "Copy `hit` and change one character.",
        solution: `
Creature heal = (amount):
  /life = /life + amount
  self.
Creature (45, 65) hit (15) heal (20) describe`.trim(),
      },
    ],
  },
  {
    id: "licks",
    title: "Licks, the data language",
    blocks: [
      p("Square brackets switch Potion into its second language, for data. Each item has a name, optional contents and optional attributes in parentheses. _why wanted something as light as s-expressions that still looks like data rather than code."),
      code(`
app = [window (width=200, height=400) [
  para "Welcome.",
  button "OK", button "Cancel"]]
app`),
      p("A lick answers `name`, `attr`, `text` and `licks`, the items nested inside it."),
      code(`
w = app first
(w name, w attr ("width"), w licks length)`),
      p("Licks are ordinary values, so a few lines of Potion can turn one into HTML."),
      code(`
render = (node):
  out = ("<", node name)
  if (node attr):
    node attr each (k, v): out push ((" ", k, "=\\"", v, "\\"") join).
  .
  out push (">")
  if (node licks):
    node licks each (child): out push (render (child)).
  .
  elsif (node text):
    out push (node text).
  out push (("</", node name, ">") join)
  out join.

render (w)`),
      {
        t: "exercise",
        title: "Count the buttons",
        prompt: "Change the filter so that it keeps only the buttons in `w`. The cell's value should be `2`.",
        code: `
buttons = w licks filter (item): true.
buttons length`.trim(),
        expect: "2",
        hint: "Every lick answers `name`. Compare it with `\"button\"`.",
        solution: `
buttons = w licks filter (item): item name == "button".
buttons length`.trim(),
      },
    ],
  },
  {
    id: "types",
    title: "Typed signatures",
    blocks: [
      p("Potion's grammar has always accepted types in signatures: `x=N` for a number, `s=S` for a string. The original parses them and then ignores them. This version checks them every time a closure is called."),
      code(`
area = (w=N, h=N): w * h.
area (3, 4)`),
      code(`area ("three", 4)`, true),
      p("In the original C Potion, nothing stops that call at `area`. The string goes straight into `*`, and what happens next depends on how you run it: the default JIT build crashes with a segmentation fault, and the bytecode VM quietly prints nothing."),
      {
        t: "switch",
        label: "Check types in this chapter",
        text: "Turn this off to let calls through unchecked, as the original does. The cell above still fails, but later, inside `*`, with a message that doesn't mention `area`. The switch only affects this chapter.",
      },
      p("Kind names work as types too, including your own classes."),
      code(`
Point = class (x=N, y=N): /x = x, /y = y.
norm = (p=Point):
  squares = p /x * p /x + p /y * p /y
  squares sqrt.
norm (Point (3, 4))`),
      code(`norm ((3, 4))`, true),
      aside("Checking also catches missing arguments, which the original quietly fills in with nil, or 0 for an argument typed as a number."),
    ],
  },
  {
    id: "yours",
    title: "Your turn",
    blocks: [
      p("That covers most of the language. This last cell is yours. It starts with two classic recursive functions; raise the numbers to make it work harder, and press Stop if it takes too long."),
      code(`
fib = (n):
  if (n < 2): n.
  else: fib (n - 1) + fib (n - 2).
.
ack = (m, n):
  if (m == 0): n + 1.
  elsif (n == 0): ack (m - 1, 1).
  else: ack (m - 1, ack (m, n - 1)).
.
(fib (20), ack (2, 3))`),
    ],
  },
];
