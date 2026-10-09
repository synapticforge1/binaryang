# One source tree, one IR subpath — open-work item 21, closed

**Closed 2026-10-09, unreleased** (owner: "proceed with item 21"; phase 4 shape agreed the same day:
"I agree with your suggestion. Proceed"). Scoped 2026-09-30 ("phase a merge of the binaryen-ts and
wabt-ts folders into the src folder … after our IR work is completed"). The record as it stood while
open: `git show 799599710:cmem/open-work.md` (item 21). What is left is open-work item 25: remove the
deprecated names in a later minor.

## What landed

| phase | what | merged |
| --- | --- | --- |
| 1 — one tree | `src/binaryen-ts/` and `src/wabt-ts/` → `src/` by concept: 105 files by `git mv`; 2,162 relative path literals rewritten by a resolver (each resolved from its file's OLD place); 19 `deno.json` exports retargeted, every subpath kept; the orphan `src/wabt-ts/index.ts` barrel and 7 `.gitkeep`s removed; 62 `@module` tags. The layout: [project.md](project.md) § "Layout". | `3e9d03b88` |
| 2 — one name each | duplicate exported type names **88 → 3**: 78 proven the same type name by name and made re-exports of the one declaration in `ir/ir.ts`; `RefType` made the IR's read-only `RefValueType`, after which `ValueType`, `StorageType`, `FuncSignature`, `BlockParams`, `Catch`, `TableCatch` were the same types too | `efde502fc` |
| 3 — logic twice | core's unused `LiteralType` enum removed; `funcAt` / `funcSignature` in `ir/ir.ts` replace three private copies of one walk (`wasm-interp`, `witgen`, `wasm-bundle`) | `efde502fc` |
| 4 — one subpath | **`./ir`** exports everything `./ir/wabt-ts`, `./ir/binaryen-ts` and `./core/wabt-ts` did; the three stay one release, DEPRECATED. binaryen-ts's `Type` union is `ExprType` everywhere in the code; `./ir/binaryen-ts` and `./api` still offer `Type` as a deprecated alias of it. Duplicate names **3 → 2**, then **0** with the compat rename. | this file's commit |

Every phase: the full gate on its committed tree (21 / 21), the suite from a fresh clone, `baseline`
IDENTICAL (421 / 421) — no output byte moved anywhere in the item.

## Decisions

- **Decision 1 ("two IRs are retained") re-decided** — [project.md](project.md): the premise had
  stopped describing the code (binaryen-ts's `ir/` already aliased wabt-ts's).
- **`RefType` tightened to the IR's read-only record**, not the IR loosened: a reference record may
  be shared between nodes, so the IR's `readonly` is a guard worth keeping; nothing in the repo
  assigned the fields. ⚠️ Type-level BREAKING for an outside caller that did — in the release note.
- **The compat layer's `WasmModule` and `Features`: kept, then RENAMED the same day** (owner,
  2026-10-09). First kept as upstream-shaped names. Then, weighed: they never met ours on one import
  surface, but `./compat/wabt` IS public, so a plain rename would have broken anyone who named those
  types; wasmtk declares its own local types and does not. Done as `Type` was: the declarations
  became `WabtFeatures` / `WabtWasmModule`, the old names deprecated re-exports for one release
  (`compat_type_names.test.ts`). The collision count went 2 → **0**.
- **`Type` in `./ir` is core's enum; the union is `ExprType`** — measured before deciding: the three
  subpaths exported 288 / 195 / 20 names, 88 shared ones all from ONE declaration, and the only clash
  was `Type`; binaryen-ts's union was proven EXACTLY `ExprType` (a compile-time identity with a
  failing negative control), so no new name was needed. The enum is the value used throughout the
  reader, writer and validator (`Type.I32`); renaming it would have been the larger break.
- **Thin public wrappers stay** (`heapTypeToString`, `isAbstractHeapType`): binaryen-ts's public
  names over one implementation, not logic twice.
- **The promotion rule is retired** with the two trees; `deno task collisions` counts across one tree.

## Found along the way

- **The `operators` gate step read node kinds from alias TEXT.** Phase 2 removed the aliases and the
  step went red with every kind "unimplemented"; it now reads the `readonly kind:` arms in
  `ir/ir.ts`, and a planted orphan kind still fails it. A check that greps source for a SHAPE breaks
  when a refactor changes the shape while the property holds — read the declaration, not its spelling.
- **A test pin turned vacuous under a rename** (`same<ExprType, ExprType>`): `node_type_base.test.ts`
  pinned "binaryen-ts's `Type` is `ExprType`"; after the rename it compared a type with itself. It now
  pins the deprecated public alias. Read every pin a mechanical rename touched.
- **The one-tree count found two duplicates the per-tree count could not see** (`Features`,
  `LiteralType`, both inside wabt-ts).

## Tests that hold it

- `tests/ir/ir_subpath.test.ts` — every name the three deprecated subpaths export (from `deno doc`,
  types included) is exported by `./ir` from the same declaration, `Type` the one exception; every
  runtime value is the identical object; `Type` is the enum and `ExprType` the union.
- `tests/ir/func_lookup.test.ts` — `funcAt` / `funcSignature`.
- `tests/wabt-ts/ir/table_catch_shape.test.ts`, `tests/ir/node_type_base.test.ts` — identity pins.
