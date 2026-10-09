# `wasm-bundle` — open-work item 24, built

**Built 2026-10-08, UNRELEASED — on branch `wasm-bundle`, NOT YET MERGED at the 2026-10-08 pause**
(the gate was started on `6dc5e28c9`; `fmt` / `lint` / `check` green, the rest unread — see the
state line in [open-work.md](open-work.md)). The owner's "perform items 1 through 3", item 3. A new
export, so the release that carries it is a MINOR, **1.10.0, typed by hand, when the owner says**
([unreleased.md](unreleased.md)). wasmtk's letter is drafted as [handoffs.md](handoffs.md) § 27, to
send with that release. The design record as it stood before building is one command away:
`git show d50073001:cmem/open-work.md` (item 24, with § 24 / § 25 of the correspondence).

## What landed, and where it lives

| piece                                         | lives in                                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| the Linking format codec (`linking`, `reloc.*`) | `src/wabt-ts/core/linking.ts` — decode / encode, the type and flag constants, `listSections`                              |
| the bundler, its file entry and its CLI       | `src/binaryen-ts/tools/wasm-bundle.ts` — `bundle(inputs, options)`, `wasmBundle(paths, options)`, `main(args)`              |
| the `(@reloc data)` annotation                | lexer (`reloc` → `LparAnn`), parser (`parseRelocInstr`, `parseDataChunks`), IR (`ConstExpr.reloc`, `DataSegment.relocs`), binary writer (`writeRelocSections`) |
| the reader's one addition                     | `DataSegment.dataLoc` — where a segment's bytes begin; a `reloc.DATA` offset points into them                               |
| the CLI command and the subpath               | `main.ts` `wasm-bundle`; `deno.json` `./tools/wasm-bundle`                                                                  |
| the tests                                     | `tests/binaryen-ts/tools/wasm_bundle.test.ts` (25 steps); fixtures in `tests/binaryen-ts/tools/fixtures/bundle/` (README with the build commands) |

## How it works — the rules as built

- **The image rule.** Each input's whole declared memory — data, stack, heap, all its pages — is laid
  at its own base, inputs in order, bases page-aligned: `base_i = Σ_{j<i} pages_j · 64 KiB`. Every
  address the module could legally touch alone stays inside its own region, so what moves is
  exactly "every address, by `base_i`": the symbol table only says WHICH immediates are addresses
  and proves each entry is not stale (the value the code holds must equal the symbol's address plus
  the addend). The bundle's memory is the sum of the pages; its max the sum of the maxes when every
  input has one.
- **What moves.** `R_WASM_MEMORY_ADDR_SLEB` on `i32.const`; `_LEB` on a load / store / atomic / SIMD
  `offset=`; `_I32` words in data segments; every active data segment's constant offset; the
  linker's address globals (`__stack_pointer`, `__heap_base`, `__heap_end`, `__data_end`,
  `__memory_base` — by symbol-table name, name-section name or export name) and every global a
  `reloc.GLOBAL` entry marks. `_REL_SLEB` (relative to `__memory_base`) moves nothing: the base
  global moves. Index relocations (`FUNCTION_INDEX`, `GLOBAL_INDEX`, `TYPE_INDEX`, `TAG_INDEX`) are
  VERIFIED where a node is found and drive nothing — the IR renumbers by name. `TABLE_INDEX_*` and
  `TABLE_NUMBER` are left alone: each module keeps its tables.
- **Verification.** Every entry is tied to the instruction whose immediate sits at its byte
  (`loc.offset` of the node, which the reader stamps at the opcode; the immediate's distance by
  kind — one byte for `i32.const` / `call` / `global.*`, opcode-length plus the align byte for a
  memarg). An ADDRESS entry with no such node, or a value other than the symbol's, refuses the
  module as stale, naming the entry and what was found. `__heap_base` / `__heap_end` are ABSOLUTE
  data symbols (flag `0x200`; the offset field is the address).
- **Unmarked.** No `linking` section and a memory: refused, with the three ways out named. With
  `unmarked: 'guess'`: wasmtk's range rule (every `i32.const` inside the static data's address
  range), a warning in the report and on the log. No memory: nothing to relocate.
- **The annotation, `(@reloc data)`** — before an `i32.const` (linear or folded, in a body or a
  global's initializer: the code-metadata precedent, the annotation stands before the instruction
  it annotates) or before a data string (every 4-byte word of that string). Optional `$symbol`.
  Elsewhere, or on an `i64.const`, or on a string that is not whole words: a parse ERROR, never a
  dropped mark. The writer emits `reloc.CODE`, `reloc.GLOBAL` (ours — the format's letter allows a
  reloc section per section; wasm-ld never writes one) and `reloc.DATA` against UNDEFINED data
  symbols whose addend is the address (`__memory_image` by default). `wasm-objdump -x` reads them.
- **Exports.** One name from two inputs: `refuse` (default: no prompt here, the prompt stays
  wasmtk's), `prefix` (`<module>_<name>`), `alias` (prefix, and every module involved must have been
  named by `--alias`), `exclude`. `--start=NAME` keeps one `_start`. Memory exports collapse to one
  set and `memory` is always exported.
- **Imports.** Same `(module, field, kind)` in two inputs: declared once, types compared. A module
  name that is another input's name: linked to that input's export (as `wasm-merge`), types
  compared. `env.memory` is the bundle's memory; `env.__memory_base` becomes a defined global at the
  input's base, `env.__table_base` 0, `env.__indirect_function_table` a defined table.
- **Start.** One stays; several run in input order from a synthesized `$__wasm_bundle_start`.
- **Dropped.** Every custom section of the inputs (`linking`, `reloc.*`, `.debug_*`, `producers`,
  `target_features`); the log counts the DWARF sections. The name section is regenerated.
- **Refused.** GC types; a second memory; memory64; shared memory; custom page sizes; TLS /
  locally-relative / 64-bit address relocations; `FUNCTION_INDEX_I32` / `GLOBAL_INDEX_I32` in data.

## Decisions

- **`./tools/wasm-bundle`, not `./wasm-bundle`** (the plan said the latter): 1.9.0 put every tool
  under `./tools/*`; one convention.
- **No allocator unification.** wasmtk's merge drops each library's `$__malloc` / `$__heap_ptr` and
  routes every call to one shared pair, because their relocation stacked every module's DATA into
  one region and the heaps collided. Under the image rule each module's bump heap runs over its own
  pages, as it did alone; values cross modules by address in the one memory regardless of which
  allocator made them. Their `sharedheap_bundle` case needs nothing from us. (A `memory.grow`-based
  allocator grows ABOVE everything, which is also fine. The one allocator shape that is not: one
  whose heap END is `memory.size` at run time — TinyGo's runtime — claims every module laid after
  it. Put such a module LAST; the letter says so.)
- **Tables stay per module.** Exact by construction, no slot arithmetic, every engine has multiple
  tables (reference types). The cost: a function pointer made in one module and called through
  another's `call_indirect` is not supported. Merging the `__indirect_function_table`s through the
  `TABLE_INDEX_*` entries is the obvious next step if wasmtk ever needs it.
- **Bundle before optimising**, as agreed in § 25: the Linking sections are consumed here and not
  carried over, so `wasm-opt` on the result is safe and the result is an ordinary module.
- **`wasm-merge` is not the oracle.** Upstream's links by import name only and relocates nothing;
  it was the reference for the index-space half (imports resolved across inputs, start functions,
  the export namespace). The oracle for the memory half is V8 RUNNING the bundle: the fixtures'
  programs must compute, print and read back what they do alone.

## Measured, 2026-10-08

| fixture (producer)                                  | entries verified              | runs relocated, both orders                                       |
| --------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| `strbin_rust.wasm` (rustc std, `_start`, 17 pages)  | 1,049 code + 110 data         | `_start` prints "hello from strlib"; strings, a pointer table in data, `.bss` through a memarg |
| `mathlib_zig.wasm` (zig object + `wasm-ld`, 2 pages) | 5 code                        | table reads, a string, a counter                                  |
| `strlib_rust.wasm` (rustc `no_std` cdylib)          | 9 code, `__memory_base`-relative beside absolute | `_initialize`, then every export                 |
| two marked WAT libraries (our assembler)            | 5 each (2 code, 2 data words, 1 global) | 7 sites moved each; the second's string, words and heap at `65536 + …` |

Stale relocations are refused: our own writer re-encoding `strbin_rust.wasm` (the padded LEBs
shrink, the sections stay) is refused at its second entry, which is exactly TinyGo's situation.

## Defects found while building (fixed in the same commit)

- **The writer recorded a mark's offset before the body's size was patched.** A function body's size
  is reserved at five bytes and patched after, which slides the body down; a site measured during
  the body was four bytes high. The first assembler test found it: the bundler refused our own
  output as stale — the verification doing its job on us. Fixed by moving the body's sites by the
  gap the patch closed.
- **A mark after a data field's offset expression was taken for an instruction mark** ("it belongs
  before an i32.const"). The instruction list now checks what FOLLOWS the mark before claiming it.

## Known gaps

- `wasm2wat` prints a marked module's marks as the `(@custom "linking" …)` / `(@custom "reloc.*" …)`
  sections, not as `(@reloc data)` annotations. The round trip is byte-exact for a valid module, so
  the entries stay right; a text edited by hand leaves them stale, which the bundler then refuses.
- Not measured on wasmtk's own bundle / merge projects: they are built by `wasic`, which emits no
  marks yet. The letter asks for that measurement once wasic marks its addresses.
- Cross-module function pointers; GC; memory64; threads.

## For the owner

- **Release:** a MINOR, 1.10.0, by hand, when you say. The CHANGELOG's "Unreleased" section has the
  public note.
- **No `.wit` beside the output** (owner's question, 2026-10-08). By § 24 / § 25, `witgen` stays
  wasmtk's: their wrapper calls `wasmBundle` and emits the `.wit` as `wasmbundle` does today
  (`emitWitBeside`, core signatures → `s32` / `s64` / `float32` / `float64`, from the written
  file). If the owner wants our CLI to write one, that is a scope decision: the core-type floor is
  small to add (`--wit`), the richer one from TS source types is theirs by nature.
- **The letter (§ 27)** tells wasmtk: the subpath and the CLI, the exact annotation spelling for
  wasic, what their side drops (`wasmbundle.ts`, the regex relocation for bundling) and keeps
  (`witgen`, the prompt, `wasmmerge.ts`'s wasic path if they want it), and the TinyGo / last-module
  caveat. Their three test files do not move verbatim (they drive the `wasmtk` binary); the cases
  are ours in `wasm_bundle.test.ts`.
