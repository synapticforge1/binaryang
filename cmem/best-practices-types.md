# Best practices: types and field changes

Rules about changing a field, a union or an enum, and making a defect unrepresentable in the type system. Last verified 2026-11-20. The other rules are in [best-practices.md](best-practices.md).

## 🆕 Changing a field has EIGHT failure modes the compiler cannot see

**Rule: a type change is not finished when it compiles. Sweep for the eight, then let a behavioural
test and a byte gate disagree with you.**

(Seven were paid for in S6 step 4; the eighth — a numeric enum accepting the number it replaced — in
Group 2 decision 4. It has its own section below.)

Paid for across S6 step 4 (2026-09-09), converting five field families in binaryen-ts and wabt-ts to
their as-written forms. Every defect below **compiled clean**, and none was found by reading code.

### Scalar → object (a `number` becomes a `Var`)

- **what breaks:** `a.index === b.index` becomes REFERENCE comparison
  - why the compiler is blind: both sides are still the same type, so the expression is valid
  - what caught it: `SimplifyLocals` silently stopped fusing `set`+`get`→`tee`; a behavioural test
- **what breaks:** `` `${e.index}` `` renders `[object Object]`
  - why the compiler is blind: **every** object stringifies — there is nothing to diagnose
  - what caught it: `LocalCSE` hashed every `local.get` alike and folded unrelated values. A miscompile, in two separate caches
- **what breaks:** `as any` / `as { name: string }` in a fixture
  - why the compiler is blind: the cast is the point; it suppresses exactly this
  - what caught it: 8 asyncify tests, then one more that a sweep for `as any` alone had missed

⚠️ **Three refinements, each learned the hard way later in the same series:**

- **The silent-`===` risk is specific to SAME-TYPED operands.** `a.index === b.index` (number →
  object, both sides) goes quiet. `e.table === '$t'` (string → object) is a type error, so all seven
  such sites surfaced as `TS2367`. **A string-typed field is materially safer to convert than a
  numeric one** — budget the sweep accordingly.
- **A cast hides EVERY field in its literal, not just the one that failed.** `asyncify.test.ts` was
  fixed once for `index: 0` inside an `as any` tree; its sibling `target: '$sleep'` sat in the same
  literal and broke on the next conversion. When a cast surfaces one wrong field, audit the whole
  object.
- **A CHAIN of structural casts reports only the inconsistency between its LINKS.**
  `body as { table?: string }` then `ci as { table?: Var }` errored only because the two disagreed.
  Update both to the same wrong type — or make the intermediate `unknown` — and the assertion
  compiles while comparing a string to an object forever.

### A conditional object SPREAD bypasses excess-property checking

The seventh mode, the only one that corrupts a WRITE, and the only one in this list that changed
emitted bytes.

```ts
...(indexOf(memory) !== 0 ? { memory } : {}),   // after `memory` was renamed to `memidx`
```

TypeScript checks excess properties on a plain object literal — which is why the `array.*`
factories, built from shorthand properties, all failed loudly on their rename. It does **not** check
them through a conditional spread. So after a rename these factories compiled clean while producing
nodes carrying a stray `memory` key and no `memidx` at all, and the encoder read `undefined` and
wrote memory 0.

⚠️ **`deno task baseline` could not see it** — the corpus has no multi-memory modules. A behavioural
test that round-trips `memory.copy` across two memories caught it as a byte difference. That is the
pairing argued for above, working in the direction that is usually the other way round.

**Grep for `\.\.\.\(.*\?\s*\{` in any file that constructs the renamed node.** A spread is the one
write shape that will not tell you.

### A field name used as a VALUE leaves the type system entirely

The sixth mode, and the one that survives even a pure rename — where the other five need a type
change to bite.

```ts
for (const k of ['ref', 'index', 'value', 'size']) assert(node[k] !== undefined);
```

A rename cannot touch a string, so this fails at RUNTIME only. Same for a field name in a map key, a
template, or a serialized shape.

⚠️ **Worse when the string guards a PRESENCE test.** Decision 4 removed `bytes` from Load/Store and
found two:

```ts
nodes.find((n) => n['bytes'] !== undefined)                          // multi_memory.test.ts
if (node.kind === ExpressionKind.Store && node.bytes !== undefined)  // narrow_store_width.test.ts
```

A presence guard converts "the field is gone" into "nothing matched" — an EMPTY result, not an
error. Both tests went red only because something downstream happened to assert non-emptiness
(`assert(store)`, `assertEquals(widths, [1])`). Find nodes by their DISCRIMINANT (`kind`), and when
a walk must read a field, make its absence THROW rather than skip.

🔑 **The through-line for all six: the compiler sees a field name used as SYNTAX.** The moment the
name becomes data, it is outside the type system, and no rename, retype or arm-widening will make it
speak up. Sweep for `'<field>'` as a string literal in tests before believing a rename is done — and
sweep for the PATTERN, not the failures: `wide_arithmetic.test.ts` carries the same construct,
untouched by the rename that exposed it and waiting for the next one.

### Widening a union (adding an arm), which is worse

Adding an arm is **not a type change to existing code at all** — the old arm stays legal, so nothing
the compiler checks changes.

- **what breaks:** `x.kind === '<existing arm>'` silently NARROWS
  - why the compiler is blind: testing an arm that still exists is still valid
  - what caught it: three sites, including the `(ref null func)` → one-byte `funcref` collapse. Behavioural tests
- **what breaks:** `{ kind: '<existing arm>', … }` literals keep building the OLD shape
  - why the compiler is blind: the literal is a valid member of the widened union
  - what caught it: six sites. **Only `deno task baseline` saw one**; five were latent in validators

⚠️ **No rename protects against the union pair.** Renaming a field converts a scalar→object silent
break into a compile error — that is real, and it is why `typeIndex`→`typeVar` and `name`→`var` were
cheaper than `memory`, which kept its name and got no such protection. But the arm being tested or
built still exists under any name.

🛑 **Adding a KIND is the same widening, one level up — and every private `switch` finds it first.**
Decision 5 added `ExpressionKind.Region` for what used to be unnamed wrapper `Block`s. DCE, Vacuum,
LocalCSE, SimplifyLocals and asyncify's flow each handled `Block` and let `default` return anything
else untouched — so every loop, if, try and function body would have quietly stopped being
optimized. The compiler flagged **none** of the five; a test caught one. `walk.ts` was safe only
because its `default` THROWS.

**How to apply:** before adding a kind, list every `switch (x.kind)` outside the central walker and
read each `default` — `throw` is safe, `return x` / `break` / `return false` must be judged one by
one — and grep `kind === <the kind it replaces>` and `kind !== <…>`. Both lists went into the
decision record before the code; the sweep then found exactly what they predicted.

### A numeric ENUM parameter accepts the number it replaced

The eighth mode, and the one that defeats a signature change — the move usually relied on to make
the compiler list every call site.

```ts
makeStore(bytes: 1 | 2 | 4 | 8 | 16, offset, align, ptr, value, memidx?)   // before
makeStore(opcode: Opcode,            offset, align, ptr, value, memidx?)   // after
makeStore(4, offset, align, ptr, value)   // unconverted — COMPILES
```

A numeric enum admits any number literal equal to one of its member values, and `Opcode` has members
at 1, 2, 4, 8 and 16 (`nop`, `block`, `if`, `throw`, `call`) — every width a store can have. So the
old calls type-checked as a request for a store whose opcode was `if`. A `number`-typed argument is
accepted too: asyncify's `makeStore(loadOpBytes(t), …)` passed a width straight into the opcode
slot.

`makeLoad` did NOT hide its sites — its arity changed (7 → 5 arguments), and arity is checked. **The
trial count the compiler gave (54 errors) was therefore complete for loads and blind for stores**,
and the two looked identical in the output: 15 wasm-parser errors, all loads, none of its ten
stores. The tell was an absence — a file with ten store sites reporting zero of them.

**How to apply:** when a parameter's type changes to a numeric enum (or a `number`-backed brand),
either change the ARITY or the POSITION so every old call becomes a type error, or grep every call
site of the function by name — and add a runtime check at construction (`makeStore` now validates
its opcode through `storeShape`), so any site that slipped through fails the first test that reaches
it. **Look at which files report errors, not just how many.**

### How to apply

- **Grep the five patterns before running the suite**, on the changed field: `\.<field> (===|!==)`,
  `\$\{[^}]*\.<field>\}`, `as any` / `as unknown as` / `as \{ <field>:`, `\.kind === '<arm>'`, and
  `\{ kind: '<arm>'`. Plus, for a changed PARAMETER, every call of the function by name when its new
  type is a numeric enum; and `'<field>'` / `\.<field> !== undefined` in tests.
- **Give every union arm a CONSTRUCTOR** (`varIndex`, `varName`, `heapAbstract`) and an equality
  helper (`sameVar`, `sameHeap`). A bare literal makes the wrong arm easy to build; a constructor
  makes it hard. Put the failure that motivated the helper in its doc comment.
- **Rename the field when its type changes meaningfully.** It buys the compile error for the
  scalar→object half.
- **Assert the invariant in a test that walks the IR**, not one that checks the sites you happened
  to fix — then confirm it FAILS when the old shape is reintroduced. Both invariant tests written
  here were verified that way.

## 🆕 Let the COMPILER name the sites — and know exactly where it stops

**Rule: for a mechanical type change, drive the edit from the compiler's own error stream rather
than from a search. Then treat everything it cannot see as the real work.**

A name-based search finds what it is looking for, not what is there. It missed a factory reached
through a local alias —

```ts
const make = head === 'array.init_data' ? makeArrayInitData : makeArrayInitElem;
```

— because the name is not at the call site. `deno check` names every site with `file:line:col` plus
a caret run giving the exact token width, so an edit anchored on that is anchored on the compiler's
view instead of a guess. It found 19 test sites a search would have had to guess at.

### The five traps in doing it

- ⚠️ **Compare the two counts.** The first run fixed 11 of 18 and reported success on all 11: the
  script required a `~` run and TypeScript underlines a **single-character** token with `^`. "11
  wrapped" alone reads like a clean pass. **Always print "N of M".**
- ⚠️ **A property assignment underlines the KEY, not the value.** `{ index: e.index }` reports at
  `index`, so a naive wrap produces `{ requireIndex(index, …): e.index }` — a `SyntaxError`, and
  once a file will not parse the check stops reporting anything real. Skip any token followed by
  `:`, and say so in the output.
- ⚠️ **Assert on the command's FAILURE, not on a string in its output.** A loop that counted `TS`
  errors reported "0 errors" for four rounds while a file was syntactically broken.
  `deno task test
  | tail` likewise exits 0 from `tail`. It happened again in decision 5 — "0
  errors (exit 1)" was a `SyntaxError` the error parser did not recognise.
- ⚠️ **A scanner that balances brackets must skip COMMENTS, not just strings.** The decision-5
  wrapper tracked quotes; the apostrophe in `// (otherwise it's a dead drop …)` opened a phantom
  string and the closing paren landed lines away. Restore the files and re-run — a patched-up
  partial result is not trustworthy.
- ⚠️ **`String.replace` / `replaceAll` with a STRING replacement is a template.** `$$` becomes `$`,
  `$&` the match, `` $` `` / `$'` the surrounding text. A replacement holding
  `` `$${ASYNCIFY_START_UNWIND}` `` wrote `` `${ASYNCIFY_START_UNWIND}` `` — a different function
  name, no error, and a test failing far from the cause. **Pass a function (`() => to`)**, which is
  literal; and after any scripted edit, audit the changed files for HEAD lines holding `$` sequences
  that no longer appear verbatim. The same family as the heredoc rule: a tool interpreting
  characters meant literally.

### Where it stops

`as any`, structural casts, and old-arm literals are invisible to it, as is anything the type
checker cannot reach. **The technique converts everything the compiler can see and nothing it
cannot** — so the sweep above is not optional cleanup, it is the other half of the method.

⚠️ **When a value of the wrong shape reaches an accessor, instrument the accessor to dump the
VALUE.** The stack names only the read site, never where the bad node was built. Dumping it returned
`0` — a number, not a var — which pointed straight at a literal that had bypassed type checking.
Reading more code would not have found it.

## 🆕 TypeScript does NOT flag `stringValued === null` — a nullability change is a silent one

Comparisons against `null` and `undefined` are exempt from the "no overlap" rule (TS2367). Measured
directly, as its own two-line file, because the whole conversion depended on it:

```ts
export interface B { label: string }
export function f(b: B): boolean { return b.label === null; } // deno check: CLEAN
```

So S6 step 5's stage L2 — `name: string | null` → `label: string`, `''` for none — renamed the
field, which the compiler caught at 68 sites, and changed its EMPTY VALUE, which the compiler
caught at none. Ten `=== null` / `?? null` sites compiled clean as constants: a pass that strips
unused labels that never fires, an `asRegion` that never collapses, an encoder that pushes `''`
where it meant "no label".

**When a field loses `null` from its type, the type checker stops helping.** List every null test
against that field BEFORE the rename (`grep` for the field beside `null`/`undefined`/`??`), convert
them by reading, and then MUTATE EACH ONE BACK and require a failure. Of ten, six failed, three
were equivalent for reasons worth writing down, and the last one found a missing test — see below.
The same exemption applies to `?? `: `x ?? y` on a non-nullable `x` is not an error either.

## 🆕 A wrapper that satisfies the type checker is not evidence the value survived

**Rule: when a type is widened, fix the SOURCE of the value. A conversion at the use site that makes
the compiler quiet can carry the exact loss the change existed to remove.**

Converting memarg offsets from `number` to `bigint`, the compiler-driven pass produced — twice —
code that type-checked and preserved the truncation:

```ts
BigInt(bigintOffsetToNumber(ld.offset, 'load')); // bigint → number → bigint, through a check that
// THROWS above MAX_SAFE_INTEGER
BigInt(offset); // ×45, where `offset` came from readU32()
```

Both were right about types and wrong about values. The real fixes were one line each, at the
source: `readMemArg` calls `readU64` — which the reader already had — and the bridge passes the
bigint straight through.

### How to apply

- **After widening, grep for round trips through the old type**: `BigInt(Number(`, `Number(BigInt(`,
  a narrowing helper wrapped in the widening constructor, a `readU32` feeding a `bigint`.
- **Count the wraps.** Forty-five identical wraps of one variable means the variable is wrong, not
  the forty-five sites — the same "fix it upstream of all of them" signal as the memory-index
  conversion, where 50 errors collapsed to one change in `readMemArg`.
- **Prove the value, not the type**: a test that round-trips a value the OLD type could not hold.
  `memory64_offset.test.ts` uses 2³²+8, which `number`-via-`writeU32` maps to 8.

## 🆕 Make the defect UNREPRESENTABLE — and find where to do it by its compensating mechanism

**Rule: when a representation can hold an invalid state, change the representation rather than
guarding against the state. The places that need it announce themselves: look for the code that
exists only to compensate.**

Every structural decision in S6 Group 2 went this way, and the finding was the same each time — the
defect had already been caught once, and the fix had been a MECHANISM around the shape rather than a
change to it:

| representation                               | compensating mechanism                                                                | what replaced both                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| parallel `catchTags[]` / `catchBodies[]`     | an encoder length guard, whose comment names the corruption it caught                 | a record per clause — a tag cannot come apart from its body |
| `''` as the `catch_all` tag                  | none — and the parser and encoder had **disagreed** about it (`$__catch_all` vs `''`) | `tag?: Var`; absence IS catch_all                           |
| same                                         | `cfg.ts`: "the two are the same length by construction"                               | the type carries it                                         |
| `RefAsOp`, one member but typed `Opcode`     | an encoder `throw` for every value the type admitted and the kind forbade             | no field: the kind is the operator                          |
| `number` memarg offset                       | the bridge's `throw 'memory64 not supported yet'`                                     | `bigint`, and a `writeU64`                                  |
| a `Var` whose name arm meant keyword OR `$T` | four keyword-table lookups re-deriving which                                          | an `abstract` arm                                           |
| load/store as `bytes` + `signed` (+ type)    | FIVE width tables re-deriving the opcode; two of them INVERSELY rotated               | the opcode on the node, and one table deriving the rest     |
| a store opcode read off its OPERAND's type   | an encoder `throw` for an untyped operand — 5 of the bridge's 24 failures             | same                                                        |
| WAT mnemonic matched by a PATTERN            | none — `f32.load8_s` was accepted and became `f32.load`                               | exact lookup in the same table                              |

🔑 **Each mechanism was correct and each one was the problem.** A guard proves someone met the
invalid state; it does not stop the next author from producing it, and it costs every reader the
reasoning to see why it cannot fire.

### The tells — grep for these

- a length or count check comparing **two collections that are meant to move together**
- a comment saying **"by construction"**, "cannot happen", or "keep indices aligned"
- a **sentinel**: `=== ''`, `=== -1`, `'$__x'`, a well-formed value standing for "none"
- a **`not yet supported` / `unsupported`** throw on a value the type admits
- a field the code **always sets to the same value**, or tests only against one
- a value **re-derived from a DIFFERENT field** at every use (`loadOpcode(e)` switching on `e.type`)
  — each re-derivation is a copy of a table, and copies drift
- a **pattern** (regex, `includes`, `startsWith`) routing input into code that then needs a table —
  the pattern admits whatever it matches, and the table was never asked

### ⚠️ The rule already existed, and the code violated it anyway

The binaryen-ts wing already said it ([binaryen-ts.md](binaryen-ts.md), its best-practices § 2c), reached independently from `funcTypes`: _"Use
a sentinel the domain cannot produce (`null`), or throw — never a well-formed value of the same
type… Then put the sentinel in the TYPE and let the compiler do the audit."_ The `catch_all` `''`
violated that for the life of the file, and a test pinned the violation as a requirement.

**A rule in a wing file is not enforced at the code sites it governs.** Nothing connects them except
someone reading both. That is the argument for the grep list above: it turns a principle into a
search that can be run.

## 🆕 A node LITERAL beside its factory is a second copy of the factory's rules

The WAT parser built `br_if` as `{ kind: Break, type: conditional ? None : Unreachable, … }` while
`makeBreak` — used by the binary decoder for the same instruction — computed the type from the
values. The literal was wrong for every `br_if` that carries a value; the factory never was. It
surfaced only because decision 6A changed the node's fields and the literal stopped compiling.

**The tell is grep-able: `kind: ExpressionKind\.X,` outside `ir/expressions.ts`.** 43 such literals
exist. Each hand-computes a type the factory computes; each is a place the two can disagree. Prefer
the factory; where a literal must stay, the factory's rule is the one to match.
