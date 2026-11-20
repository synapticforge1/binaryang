# Divergences — open defect rows

DEFECT rows still open: T2 (not reproduced), the code-lens findings CL7–CL11 and CL14, and CL19 (open-work 50, 52).
Last verified 2026-11-20. The register, its classes and the checklist are in [divergences.md](divergences.md).

## Open defects

- **id:** T2
  - vs: wabt
  - what differs: binaryen-ts's encoder DERIVES the type-section order when no type is declared (signatures, tags, then expression uses), reordering input
  - class: DEFECT
  - status / authority: ⚠️ NOT REPRODUCIBLE on the decode → encode path (re-probed 2026-09-11 doing
    7c): a decoded module keeps the DECODER's type list, order and duplicates included. Three cases
    that would each come back reordered are pinned in `written_type_index.test.ts`. Whatever the
    2026-09-10 probe measured was another path (`parseWat`, or the bridge); open until it is
    reproduced with a case, and do not re-copy the claim without one
- **id:** CL7
  - vs: wabt
  - what differs: `wasm-objdump -d` ("details", upstream's `-x`; upstream's `-d` is disassembly)
    prints wrong values on the lines it has: `func[0] sig=? <env.imp>` (upstream `sig=1 <imp>`),
    `func[1] <$add>` (the `$` left in), exports without `<name>`, results as `-> (i32)` / `-> ()`
    (upstream `-> i32` / `-> nil`), imported limits without the maximum or `i64`; and nothing for
    Table, Memory, Global, Start, Elem, Code, Data, Tag or Custom
  - class: DEFECT
  - status / authority: found 2026-10-28, code lens pass 2. ir-convergence.md recorded the
    `<$func1>` fix for UNNAMED functions only. Open — open-work 50. **2026-10-28, held for the
    owner:** matching upstream means `-x` for details and `-d` for a DISASSEMBLY binaryang does not
    have — what `-d` means changes, a CLI-contract decision; upstream's `-x` covers every section
    (init expressions, elem segments, code sizes, a data hex dump; `binary-reader-objdump.cc` is
    2,535 lines). **2026-11-05, owner: "I agree with your C7 suggested workflow"** — upstream's
    flags, in two steps, after checking nothing in binaryang or any sibling runs our `-d`. ✅ **Step
    1 (a MINOR, on `main`):** `-x` / `--details` is the details flag; `-d` still prints them with a
    deprecation warning; the lines we print are upstream 1.0.41's character for character — Type,
    Import (every kind), Function, Export, the `Section Details:` heading — pinned against the
    oracle by `tests/wabt-ts/tools/objdump_details_upstream.test.ts`. ⬚ **Still open:** the sections
    we do not print (Table, Memory, Global, Start, Elem, Code, Data, Tag, Custom) and upstream's
    leading blank line before `file format`. ✅ **Step 2 LANDED 2026-11-09 for 3.0.0** (owner: "Land
    queued, then 3.0.0"): `-d` and `--disassemble` are upstream's disassembly flag and are REFUSED
    (exit 1, "use -x for the section details") until binaryang has a disassembler;
    `objdump_flags.test.ts` pins it, inverted (`-d` printing details again fails it). ⬚ A
    disassembler itself is not planned work
- **id:** CL8
  - vs: wabt, wasm-tools
  - what differs: ✅ FIXED 2026-10-28 (`ef56a7d32`, `objdump_rec_count.test.ts`; empty `(rec)` groups
    counted too) — `wasm-objdump`'s Type section `count:` is the number of TYPES (5 for a `(rec
    (type) (type))` plus three); the section's own vector counts rec GROUPS (`01 18 04 …`: 4, as
    `wasm-tools objdump` says). `sectionCount` returns `m.types.length`. Also the header layout
    (lowercase names, `"name"` for `Custom … "name"`, no `start: N`, a missing blank line)
  - class: DEFECT
  - status / authority: found 2026-10-28, code lens pass 2. Open — open-work 50
- **id:** CL9
  - vs: binaryen
  - what differs: ✅ FIXED 2026-10-28 (`c246edcc3`: text output keeps the names; a binary without
    `-g` still drops them) — `wasm-opt in.wasm <pass> -S` prints no names (`(func (;0;) …)`);
    upstream keeps them (`$imp`, `$add`). With no pass, `--emit-text` alone keeps them; N4 covers
    `-g` and binary output only
  - class: DEFECT
  - status / authority: found 2026-10-28, code lens pass 2. Open — open-work 50
- **id:** CL10
  - vs: wabt
  - what differs: ✅ FIXED 2026-10-28 (`7170ac901`: no-argument exports only; an unsuppliable import
    refused before anything runs, upstream's words) — `wasm-interp --run-all-exports` also runs
    exports that TAKE parameters, passing zeros (`add(i32:0, i32:0)`); upstream runs only the
    zero-parameter ones. And a module with an unresolved import instantiates (`callh() => stopped:
    host: env.h`, exit 0) where upstream says `error initializing module: invalid import "env.h"`,
    exit 1
  - class: DEFECT
  - status / authority: found 2026-10-28, code lens pass 2. Open — open-work 50
- **id:** CL11
  - vs: wabt
  - what differs: ✅ FIXED 2026-10-28 (`7170ac901`: unsigned, as upstream) — `wasm-interp` prints
    integer results signed (`i32:-1`); upstream prints them unsigned (`i32:4294967295`). (Floats:
    fixed the same day, CL5 — `-0` and NaN payloads now printed)
  - class: DEFECT (cosmetic)
  - status / authority: found 2026-10-28, code lens pass 2. Open — open-work 50
- **id:** CL14
  - vs: wabt
  - what differs: ✅ FIXED 2026-10-28 (`631055f4f`, surface `9817c7d42`: validates by default with
    upstream's defaults, the `--enable-*` / `--disable-*` flags, `--no-check`; the library only on
    request) — `wasm2wat` takes no feature flags and decodes everything: `--disable-simd` on a SIMD
    module now exits 1 as an unknown option (CL2); before CL2 it was skipped and the module printed.
    Upstream accepts the flags and refuses a module using a disabled feature
  - class: DEFECT
  - status / authority: found 2026-10-28, code lens pass 2. Open — open-work 50
- **id:** CL19
  - vs: binaryen.js
  - what differs: the binaryen facade: `getFunction` on an IMPORTED function returns null (upstream:
    a handle whose info has `module` / `base`); `exnref` / `nullexnref` are reported as `externref`
    (upstream 74 / its own ID); `i64.const(low, high)` drops `high` silently (upstream aborts:
    "i64.const now takes a single argument")
  - class: DEFECT
  - status / authority: measured 2026-10-28, code lens pass 3. Not all new: `getFunction`'s import
    gap has been a documented limitation since `455910525` (2026-06-09; binaryen-compat.ts: "this
    surfaces locally-DEFINED functions only"), now given a row. The exnref case is the one the
    2026-08-24 "APPROXIMATION" note (nearest abstract supertype) does not cover: exn has none.
    **2026-10-28:** ✅ `getFunction` hands out imports with `module` / `base` (`61541dff2`); ✅ exnref
    is its own ID, 74 (`a1618195c`); ⬚ **`i64.const(low, high)` still OPEN** — a check was made with
    `arguments` under a `biome-ignore` and REVERTED (`052e8f5fa`; owner: "if it needs an ignore
    statement it is not a fix"); the options are a second parameter in the signature (the surface
    gate: MAJOR) or leaving it — open-work 52 (a). **2026-11-05, owner: "I agree with the clean
    way"** — `const(value, high?: never)`, throwing when `high` is given, as upstream; **queued for
    the next MAJOR** ([unreleased.md](unreleased.md)), not on `main`: it lands when the owner
    decides to cut one, so it does not by itself force 3.0.0. TypeScript callers are already refused
    at compile time ("Expected 1 arguments"). ✅ **LANDED 2026-11-09 for 3.0.0** (owner: "Land
    queued, then 3.0.0"; the floor was already MAJOR for (a)'s `Features` values): `const(value,
    high?: never)` throws upstream's exact message, "i64.const now takes a single argument (which
    can be a bigint)" (`binaryen.js-post.js:1142`); `binaryen_compat.test.ts` pins it at run time
    and, by `@ts-expect-error`, at compile time — both inverted. Upstream asserts the same for
    `f64.const_bits`, which our facade does not have. CL19 is now CLOSED
