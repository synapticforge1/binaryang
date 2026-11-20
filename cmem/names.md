# N1 — names: the scope

The scope, the owner rules and the decisions for internal names (the name section, labels, field names), what upstream keeps, and what optimization does with names.
Last verified 2026-11-20.

Scoped 2026-09-11, owner-requested ("so that this is not skipped"; "a fidelity issue that we need to
scope"). Every number below is MEASURED — scripts in the session scratchpad, re-runnable by their
description. The register entry is N1 in [divergences.md](divergences.md).

## The rule being implemented (owner, 2026-09-10)

- **wabt-ts ALWAYS keeps names** — it is the fidelity half and never optimizes. Acceptance: **WAT →
  `wat2wasm` → `wasm2wat` reconstitutes the WAT, names included.** No opt-out; removal is the
  separate, explicit `wasm-strip`.
- **Reading and writing without optimization keeps names** (binaryen-ts decode → encode too).
- **Optimized output follows a `-g`-style `debugInfo` option** (default off, as upstream).
- **Export and import names are the interface, not N1** — inviolable, already pinned. They live in
  the export and import sections, not the `name` section, and survive the WAT route and `-Oz`
  exactly, including aliases and a late `(export …)` field (probed against upstream `wat2wasm`).
  Owner: an exported name must absolutely be preserved, "or we have name mangling" — pinned by
  `wat_input.test.ts` (`aeb94ab95`), verified to fail when one export name is altered. N1 is the
  INTERNAL identifiers: before it, `$internal_name` came back `$func1`.
- How optimization treats internal vs exported names is a **future owner discussion**; not here.

### 1a. The data types that carry a name — what a minifier would face (owner's list, 2026-09-28)

Asked for by the owner (2026-09-19) as the prerequisite to any minification: every kind of thing
that carries a name, whether that name costs BYTES, what REFERENCES it (what must move in
lock-step), and what would PROVE a rename broke nothing. Measured, not assumed:

- **name:** the twelve name-section kinds above (module, function, local, label, type, table, memory, global, elem, data, field, tag)
  - bytes in a `-Oz` module?: **none** — every reference in a binary is an INDEX; the names live in the `name` section, which `-Oz` does not write (0 of 421)
  - referenced by (must move with it): inside the module only: the entity's `name`, `explicitNames` (which names are REAL, decision 4), the name-section and WAT writers; a label's branch targets
  - a rename is proven by: the round trip (`wat2wasm` → `wasm2wat` keeps every name, 63,930/63,930) and behaviour (`direct-behaviour`) — renaming saves nothing, so there is nothing to prove
- **name:** **export name**
  - bytes in a `-Oz` module?: **yes** — 8,888 bytes over the corpus
  - referenced by (must move with it): OUTSIDE: every host that calls or reads it BY NAME (the export section maps a string to a kind and an INDEX; nothing inside refers to the string)
  - a rename is proven by: the host's side: a rename is correct only if every caller is updated from
    the old→new map. `direct-behaviour` calls exports by name (1953 calls / 651 exports), the
    natural oracle for a map; the `wat_input.test.ts` export-name pin guards the default
- **name:** **import `field` name**
  - bytes in a `-Oz` module?: **yes** — 7,822 bytes
  - referenced by (must move with it): OUTSIDE: every host that SUPPLIES it under that name
  - a rename is proven by: the same map, applied to the host's import object
- **name:** **import `module` name**
  - bytes in a `-Oz` module?: **yes** — 18,296 bytes, the largest: it repeats per import ENTRY (20 WASI imports write `wasi_snapshot_preview1` 20 times)
  - referenced by (must move with it): OUTSIDE: every host, per namespace
  - a rename is proven by: the same map; one string per namespace to update

**The ceiling — the most ANY renaming could save** (every export and import field the shortest
unused name, every import module one byte), over the 421 corpus modules at `-Oz` (915,103 bytes):
**29,668 bytes, 3.24%** (interface strings in all: 35,006, 3.83%). For small modules that talk to a
host it is half the file — up to 52.9% (`40_ExternalReturnValue`, 176 of 333 bytes). Measured
2026-09-28 (`scratchpad/iface.ts`, re-derive before quoting).

What the list says, before any build: **the whole prize is the interface**, which the owner fenced
off ("an exported name must absolutely be preserved, or we have name mangling"). So a minifier here
is OPT-IN only, with a map the host applies — upstream's `--minify-imports-and-exports` shape — and
its error surface is entirely outside the module, where our byte gates cannot see (the renamed bytes
are self-consistent). Internal names can be renamed freely and collect nothing. The discussion the
owner asked for — upstream's way or better, measured — has its numbers now.

## 2. What upstream keeps (probed, wabt 1.0.41 / binaryen 132)

| tool                             | kinds written                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `wat2wasm` (default)             | none                                                                                                |
| `wat2wasm --debug-names`         | module, function (imports too), local, type, table, memory, global, elem, data, tag — **NOT label** |
| `wasm-opt` (no flags, no passes) | none — strips even a plain round trip                                                               |
| `wasm-opt -g`                    | everything it was given                                                                             |
| `wasm-opt -O2 -g`                | only what survives: functions left, type; locals gone                                               |

**Upstream cannot reconstitute its own labels**: `wat2wasm --debug-names` → `wasm2wat` gives back 13
of 15 names on the probe module — `$the_block` and `$the_loop` are lost. Field names cannot be
probed at all (upstream cannot parse GC text — oracle gap G1). So under the owner's rule, **label
and field names go BEYOND upstream: a FEATURE row.** Cost of keeping names, re-measured after P2 as
the size with the name section minus the size without, per module: upstream's `--debug-names` adds
**359,868 bytes (+23.8%)** over the corpus; ours adds **446,858 (+29.5%)** — the difference is the
13,611 labels. (The scope first said 311,456 / +20.2%; that did not survive a direct measurement.
The owner accepted the cost, decision 3.)

## 4. What depends on names — the constraints on the design

- **binaryen-ts refers BY NAME.** Calls, `global.get`, exports, elements name their targets, so a
  name read from the section must be the name EVERY reference site uses: one index→name table per
  namespace, built before any section that refers to it. The name section comes AFTER the code, so
  the decoder must pre-scan for it (the bytes are in memory).
- **Uniqueness.** Name-section names are arbitrary UTF-8 and may repeat; binaryen-ts needs them
  unique as keys. Upstream binaryen uniquifies. Whether the ORIGINAL spelling must still be
  re-emitted (fidelity) is an owner question below.
- **Block-parameter lowering (7b(i))** re-decoded `encodeWasm(module)` and refused a module whose
  names no longer matched its bytes. Once the decoder read real names, the encoder had to write
  them — at least in that re-encode — or every named module with block parameters failed. **Decoder
  and encoder landed together.** ⟶ Since R15 (2026-09-28) the lowering is a tree pass and never
  re-derives a name: a renamed module lowers like any other (`lower_block_params.test.ts`).
- **Identifiers in text.** A name from a foreign binary may not be a valid WAT identifier; the WAT
  writer must spell it so the text re-reads (probe upstream `wasm2wat` on odd names first).
- **The baseline moves.** Our `wat2wasm` output gains a name section in every corpus module (~+20%,
  more with labels): a deliberate re-baseline, in its own commit, saying why. Byte parity with
  upstream is then measured against `wat2wasm --debug-names`, with the label subsection as a
  documented FEATURE difference.
- **Optimization** drops names unless `debugInfo` — decided at the encode after `PassRunner`, never
  in the fidelity path.
- **Other consumers** start seeing names once the reader works: `wasm2wat`, `wasm-objdump`, the
  wabt-compat `readWasm` (all default `readDebugNames: true`). Their outputs change for named input.

§ 5. The plan — six steps, each its own gated commit: moved to [archive/names-to-4.1.1.md](archive/names-to-4.1.1.md)
§ P4–P6 as built (2026-09-11): moved to [archive/names-to-4.1.1.md](archive/names-to-4.1.1.md)

## ✅ wasm-tools as the oracle for what upstream wabt cannot judge (2026-09-11)

`wasm-tools parse` writes labels and field names, so it judges exactly the N2 half. Over the corpus
(422 inputs; 10 legacy-EH modules it cannot PARSE, see below):

| check                                                                                   | result                                                          |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| WRITER — our name section vs `wasm-tools parse`'s, every subsection, decoded            | **agree in every module**, all eleven subsections either writes |
| labels, byte for byte                                                                   | **406 / 406**                                                   |
| READER — `wasm-tools parse` bytes → our `wasm2wat`: every source label comes back       | **412 / 412**                                                   |
| CROSS — our bytes → `wasm-tools print` → `parse`: our label subsection survives         | **412 / 412**                                                   |
| the 10 it cannot parse (`(try (do …))`): our bytes validate, and cross-read identically | **10 / 10**                                                     |
| GC field names (a probe: struct, `sub`, `rec`, array)                                   | agree — except inside `(rec …)`, where wasm-tools writes none   |

Differences that are wasm-tools', not ours (register G4): it omits field names for struct types in
an explicit `(rec …)` group (with `sub` alone it writes them), and its local subsection lists only
functions with named locals, and never an import's param names — upstream wabt lists every function,
and we follow wabt there. Scripts: `wt-oracle.ts`, `wt-legacy.ts` in the session scratchpad.

- Found beside it, not N1: the WAT writer prints custom sections as `(@custom …)` and the parser
  cannot read that, so `wasm2wat` → `wat2wasm` drops every custom section (register C2, DEFECT). And
  the folded writer drifted two columns left per block (fixed; hidden while every block had a
  generated label).

**Follow-ups, cosmetic** — they change text, never bytes, and never lose a name:
- ✅ `wasm2wat` printed REFERENCES by index (`call 0`, `br_if 1 (;@1;)`) where upstream prints
  `call $foo`. Branches: named since N8. Every other reference: named since 2026-09-29
  (`941e09a24`, register N10) — resolved through the same `shown` rule as its definition, never a
  name two entities share.
- ✅ folded siblings shared a line (`…)))) (if`) — each starts its own line since 2026-09-29
  (`0068b723e`, register W18), as upstream and wasm-tools print them.

## ✅ Owner decisions (2026-09-11)

1. **Label and GC field names are kept — a new FEATURE**, a deliberate divergence from upstream,
   which writes neither. Register row N2 in divergences.md.
2. **Names are kept as written.** Duplicates should not arise in practice — code with them would
   fault anyway, and the wasmtk bundler already resolves them when it merges modules into one. So no
   side table of original spellings: the name section's names ARE the names. Where a duplicate does
   arrive in a foreign binary, binaryen-ts disambiguates it (as upstream binaryen does) so it can
   use it as a key; that case is not a fidelity target.
3. **The size is accepted** for fidelity's sake: "when we send it through the optimization it just
   goes away" — optimized output follows `debugInfo`, default off. No opt-out beyond `wasm-strip`.

## ✅ Owner decision (2026-09-18) — the one module names every entity

4. **binaryen-ts's naming practice** (S6 step 5 item 6, M7c3): in the one module every entity a
   reference can name carries a name — the name section's where it gave one, a made-up one
   (`$func3`, disambiguated `.N`) where it did not — and a record (`explicitNames`) says which names
   are REAL. Only real names are ever written: to a name section, and to text. Asked with the
   alternative (wabt-ts's `name: ''`, names assigned on entry to a pass run) in
   [ir-convergence.md](ir-convergence.md) § "Item 6 — the MODULE half", the M7c3 record. ⚠️ The
   consequence for wabt-ts: its reader makes names up, so every writer that asked `name !== ''`
   must ask the record instead — the fault N1 removed from `wasm2wat` (`generateNames` printing
   invented names) must not come back through that door.
   **Types and fields too** (owner, 2026-09-18: "yes names should cover types and fields"): every
   type entry and every struct / array field carries a name, made up where the section gave none,
   and the record lists the real ones. This reverses M5a's `name: ''` for a decoded type — which was
   right while nothing recorded which names were real, and is not once something does.

## ✅ Names under optimization, priced (2026-09-19) — the discussion N4 deferred

N4 recorded that our `-O2 -g` keeps local and label names upstream drops, and left "what
optimization may do with names" to the owner. Measured before discussing it: 421 corpus modules,
ours at `optimizeLevel: 2, shrinkLevel: 2` through `PassRunner`, upstream
`wasm-opt -Oz --all-features`, each run twice (with `debugInfo` / `-g` and without).
`scratchpad/names/size.ts`, `match.ts`.

| at `-Oz`                        | ours        | upstream |
| ------------------------------- | ----------- | -------- |
| without `-g`                    | 893.7 KB    | 784.2 KB |
| with `-g`                       | 1088.7 KB   | 836.5 KB |
| the name section itself (`-g`)  | 193.9 KB    | 51.3 KB  |
| modules carrying names, no `-g` | **0 / 421** | 0 / 421  |

- **The default path agrees with upstream exactly**: neither side writes a name section without
  `-g`, on all 421 modules. The two-phase rule in `PassRunner` (`pass.ts` ~325) behaves as intended.
- **What our extra 142.6 KB of names buys**, by subsection: local **90.0 KB** and label **37.4 KB**
  that upstream writes nothing for (ids 2 and 3 — upstream writes 1, 4, 5, 6, 7, 8, 9, 11 only),
  plus **14.8 KB** more function names because we keep more functions (below). So the name gap is
  exactly the N4 divergence, priced: locals + labels = 127.4 KB, +18.5% over our own no-`-g` output.
- **Names are NOT the size story.** Without names at all we are still **109.5 KB (+14.0%)** bigger,
  and bigger on **418 of 421** modules (smaller on 2, equal on 1 — the two wins are 3 bytes each).
  Any "our optimizer is worse for size" conclusion must be argued on the no-`-g` column.

**Where those 109.5 KB actually go** — same input, four columns (`match.ts`):

| column                                               | total     | attributes                             |
| ---------------------------------------------------- | --------- | -------------------------------------- |
| unoptimized input                                    | 1915.2 KB | —                                      |
| ours `-Oz`                                           | 893.7 KB  | −53.3% from input                      |
| our `-Oz` output re-encoded by `wasm-opt`, no passes | 886.6 KB  | **our encoder: 7.1 KB (6%)**           |
| `wasm-opt` running ONLY our 12-pass `-Oz` list       | 844.5 KB  | **weaker passes: 42.1 KB (38%)**       |
| `wasm-opt -Oz` in full                               | 784.2 KB  | **passes we never run: 60.3 KB (55%)** |

So over half the gap is coverage — upstream's `-O2`/`-Oz` also runs Inlining, DAE,
DuplicateFunctionElimination, Precompute, MergeBlocks and SimplifyGlobals, where our list stops at
12 passes and schedules Inlining at `-O3` only. It shows in what survives: without `-g` we keep
**3,943 functions to upstream's 2,663** (code section 770.3 KB vs 684.7 KB). The other 38% is our
own passes leaving bytes on the floor where upstream's same-named pass does not — 417 of 421 modules
are bigger under an identical pass list, which is the honest measure of pass quality and the number
the open LocalCSE / scheduling items in [open-work.md](open-work.md) are eating into. Our encoder is
within 0.8%.

## ✅ Does optimization RENAME things to shrink them? (owner's question, 2026-09-19)

Asked directly: "what name does the optimization give to the variables and functions that makes it
smaller and do we currently do the same?" Probed on a module written for it (long module / field /
export / function / local / label names, one uncalled function), `scratchpad/names/probe.wat`.

**Neither side renames anything to save bytes, because internal names cost nothing to begin with.**
In a binary a function, local, label, type or global is referenced by INDEX. The only names that
occupy bytes in a stripped module are the import `module` / `field` strings and the export strings —
the interface, which is inviolable (N1's first rule). Everything else lives in the `name` custom
section or nowhere. So shortening `$a_long_local_variable` to `$0` saves nothing at all unless a name
section is being written.

| on the probe (312 bytes in, `--debug-names`)    | bytes | what it did to names                                                      |
| ----------------------------------------------- | ----- | -------------------------------------------------------------------------- |
| `wasm-opt -Oz`                                  |   139 | no name section; import and export strings kept EXACTLY                    |
| `wasm-opt -Oz -g`                               |   203 | function names only, the originals unshortened — no locals, no labels       |
| `wasm-opt -Oz --minify-imports-and-exports`     |   106 | the 33-char export became `a`; prints the map as JSON                       |
| `wasm-opt -Oz -g --minify-imports-and-exports`  |   170 | both of the above                                                          |
| ours `-Oz`                                      |   152 | no name section; import and export strings kept EXACTLY                    |
| ours `-Oz` + `debugInfo`                        |   263 | function names AND local names (params too), the originals unshortened      |

Three conclusions, each probed:

1. **Upstream's smaller `-g` section is achieved by DROPPING categories, never by shortening.** The
   names it keeps are byte-for-byte the ones it was given; it simply writes no local and no label
   subsection. We keep those — the N4 divergence, priced in the section above.
2. **The one place upstream renames for size is opt-in and not part of `-O`/`-Oz`:**
   `--minify-imports-and-exports` (also `--minify-imports`, `--minify-exports`) rewrites the interface
   strings to `a`, `b`, `c`… and emits the old→new map as JSON so the host can be updated. On the probe
   it took a stripped module from 139 to **106 bytes, −24%**, all of it one long export name. ✅ **We
   have it since 1.7.0** (merge `d795cef7d`), map for map with `wasm-opt` 132. ⚠️ Under the owner's rule ("an exported name must
   absolutely be preserved, or we have name mangling") it can only ever be opt-in, which is exactly how
   upstream ships it.
3. **We never write an INVENTED name into a binary, and upstream nearly does.** Fed a module with no
   name section at all, our `debugInfo` output is byte-identical to our default output — 152 bytes, no
   `name` section — so decision 4's "made-up names are for the IR, only REAL names are written" holds
   end to end through `PassRunner`. Upstream in that same case still emits a 5-byte name-section stub.
   In TEXT the two differ in style and neither costs binary bytes: upstream prints its invented short
   names (`$0` for a param, `$label` for a loop), our `wasm2wat` prints indices (`(;0;)`, `local.get 1`)
   and invents nothing unless asked (N2, `generateNames` opt-in).

🗓️ **The owner's principle for minification (2026-09-19), which settled its shape:** the EXPORT
side keeps fidelity with the names consumers reference; everything not referenced from outside "can
be minified without restraint as long as they maintain programmatic fidelity in process, not
necessarily in name". Two consequences, both measured: no back-reference step is needed (an export
maps a STRING to a kind and an INDEX, never to an internal name, so renaming internals cannot break
one); and renaming internals collects ZERO bytes (no name section at `-Oz` on any of 421 modules;
only `-g` writes one, where shortening defeats `-g`). So the whole prize is the interface — the
strings the owner fenced off — which is why the passes are opt-in and always print the map. The
full scoping as written (the three minifier columns: occupies bytes? / what references it / what
proves it did not break): `git show 3bd64ece7:cmem/open-work.md`, the `MinifyImportsAndExports`
item.

✅ **Is the minified name scheme optimal? — owner, 2026-09-29: yes, and the question is CLOSED.**
The pass takes upstream's generator (`a`…`z`, `A`…`Z`, `_`, `$`, then two characters, JS reserved
words and `env` skipped). Every name is written once per import or export entry behind a one-byte
length, so the first 54 are already the one-character minimum; ranking names by use gains nothing
(each is used once, bar a repeated (module, field) pair). The one lever left was REJECTED: separate
sequences for imports and exports (two namespaces in wasm) saves at most 1 byte per name past the
54th, only in modules with more than 54 of both together — unmeasured, likely tens to low hundreds of
bytes over the corpus against −29,674 already taken — and it gives up map-for-map parity with
`wasm-opt`, and breaks a JS host that keeps both in one object. The large repeated string (a
`wasi_*` module name per import) is already `…-and-modules`' job.
