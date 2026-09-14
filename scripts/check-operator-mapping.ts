/**
 * @module scripts/check-operator-mapping
 *
 * Prove that binaryen-ts's operator enums and wasm's instruction set map onto
 * each other TOTALLY, in both directions.
 *
 * ## Why this is a gate and not a test
 *
 * The two IRs group arithmetic differently: wabt-ts keeps a node per SHAPE and
 * stores the real `Opcode`, so it is lossless by construction. binaryen-ts keeps
 * a node per shape and stores its own `UnaryOp` / `BinaryOp`, which is lossless
 * only while that re-mapping is COMPLETE.
 *
 * The IR-convergence decision (see `cmem/ir-convergence.md`) chose binaryen-ts's
 * coarser grouping, and the measurement that justified it was exactly this
 * mapping being total. That makes totality a *design premise*, not an
 * incidental property — and a premise nothing checks is a premise that decays.
 *
 * ⚠️ This is the "one fact in two places" shape that has already bitten this
 * codebase repeatedly: `storeBytes` drifted from `loadBytes`, `constExprOperands`
 * from `writeInstrHead`, `isBlockTypeCarrier` from `encodeRegionBody`. Each was
 * found only after it produced wrong output. This gate is the cheap version of
 * finding out.
 *
 * Two directions, and they fail differently:
 *
 * - **an opcode with no operator** — that instruction cannot be represented, so
 *   a module using it cannot round-trip. Fidelity breaks.
 * - **an operator naming no opcode** — an IR value the encoder cannot turn into
 *   wasm. Whatever produces it emits an invalid module, or throws.
 *
 * ```sh
 * deno run --allow-read scripts/check-operator-mapping.ts
 * ```
 *
 * Exit 0 when total, 1 otherwise.
 *
 * @license MIT
 */

const OPCODE_SRC = new URL('../src/wabt-ts/core/opcode.ts', import.meta.url);

/**
 * Every instruction name wabt-ts knows, from BOTH of its name tables.
 *
 * ⚠️ Read from the source rather than through `anyOpcodeName`, because that
 * takes a number and there is no exported way to enumerate the four opcode
 * spaces (base, misc, GC, and the SIMD table keyed by a prefixed value). An
 * earlier version of this check enumerated only the base `Opcode` enum and
 * reported 185 false orphans — every one of them a real SIMD instruction.
 */
/**
 * ExpressionKind members with no interface behind them.
 *
 * ⚠️ `AtomicRMW = 'atomic.rmw'` is an enum member and nothing else — no
 * interface, no factory, no reader case, no encoder case. It reads as atomics
 * support to anything that scans the enum, and binaryen-ts has none: there is
 * not even an atomic load or store KIND.
 *
 * Third instance of this exact shape here, after `TupleExtract` (enum member
 * only — since deleted, S6 decision 6A) and the `compactImports` feature flag
 * ("a feature flag is not an implementation"). Pinned rather than fixed, so the
 * list cannot grow unnoticed.
 *
 * 🔑 This is also what settled S6 stage 1. The gate below proves every
 * binaryen-ts operator names a real instruction; it says nothing about the
 * instructions binaryen-ts CANNOT name, which is the direction that breaks
 * fidelity. Measured: ~116 have no name, atomics and relaxed SIMD among them.
 * So the unified node takes wabt-ts's numeric `Opcode`, which is the wire
 * encoding and therefore total by construction, rather than binaryen-ts's
 * per-family string enums, which would need every missing name authored by hand.
 */
function phantomKinds(exprSrc: string): string[] {
  const block = exprSrc.match(/export enum ExpressionKind \{([\s\S]*?)\n\}/)?.[1] ?? '';
  // A kind is backed when some interface declares it — alone
  // (`kind: ExpressionKind.X;`) OR as one arm of a union
  // (`kind: ExpressionKind.A | ExpressionKind.X;`). The single-literal form was
  // the only one recognised, so the extern conversions — one node, the
  // direction in the kind, exactly wabt-ts's shape — were reported as phantoms
  // while fully implemented. A union-typed `kind` was already a recorded blind
  // spot of the kind counts in cmem/ir-convergence.md.
  const arm = String.raw`ExpressionKind\.[A-Za-z0-9_]+`;
  return [...block.matchAll(/^\s+([A-Za-z0-9_]+) = '[^']+',/gm)]
    .map((m) => m[1]!)
    .filter((name) =>
      !new RegExp(
        String.raw`kind:\s*(?:${arm}\s*\|\s*)*ExpressionKind\.${name}\s*(?:\|\s*${arm}\s*)*;`,
      ).test(exprSrc)
    )
    .sort();
}

/**
 * The six that exist today. Any addition fails the gate, and so does a pinned
 * name that stops being a phantom (see `retired` below). `TupleExtract` left
 * with S6 decision 6A, deleted rather than implemented — nothing built it.
 */
const PHANTOM_BUDGET = [
  'AtomicCmpxchg',
  'AtomicFence',
  'AtomicNotify',
  'AtomicRMW',
  'AtomicWait',
  'CallRef',
];

async function knownInstructionNames(): Promise<Set<string>> {
  const src = await Deno.readTextFile(OPCODE_SRC);
  const names = new Set<string>();
  // Table entries are `[value, 'name']`; instruction names are the quoted
  // strings containing a dot (`i32.add`) or one of the bare control forms.
  for (const m of src.matchAll(/'([a-z][a-z0-9_]*\.[a-z0-9_.]+)'/g)) names.add(m[1]!);
  for (
    const m of src.matchAll(
      /'(nop|unreachable|drop|select|return|block|loop|if|else|end|br|br_if|br_table|call|call_indirect)'/g,
    )
  ) {
    names.add(m[1]!);
  }
  return names;
}

const known = await knownInstructionNames();

/**
 * Every opcode VALUE wabt-ts assigns to an instruction.
 *
 * Read from the same tables as the names, and by the same rule: a bare number
 * or `Opcode.X` below 0x100, or `(PREFIX << 16) | sub` above. That second form
 * is why this cannot just scan the `Opcode` enum — SIMD, MISC, THREADS and GC
 * instructions have no enum member at all, only a table row.
 */
async function knownOpcodeValues(): Promise<Set<number>> {
  const src = await Deno.readTextFile(OPCODE_SRC);
  const out = new Set<number>();
  const members = new Map<string, number>();
  const enumBody = src.match(/export enum [A-Za-z]*Opcode \{([\s\S]*?)\n\}/g) ?? [];
  for (const blk of enumBody) {
    for (const m of blk.matchAll(/^\s+([A-Za-z0-9_]+) = (0x[0-9a-fA-F]+|\d+),/gm)) {
      members.set(m[1]!, Number(m[2]));
      out.add(Number(m[2]));
    }
  }
  for (const m of src.matchAll(/\((PREFIX_[A-Z]+) << 16\) \| (0x[0-9a-fA-F]+|\d+)/g)) {
    const p =
      { PREFIX_MISC: 0xfc, PREFIX_SIMD: 0xfd, PREFIX_THREADS: 0xfe, PREFIX_GC: 0xfb }[m[1]!];
    if (p !== undefined) out.add((p << 16) | Number(m[2]));
  }
  for (const m of src.matchAll(/\((PREFIX_[A-Z]+) << 16\) \| [A-Za-z]+Opcode\.([A-Za-z0-9_]+)/g)) {
    const p =
      { PREFIX_MISC: 0xfc, PREFIX_SIMD: 0xfd, PREFIX_THREADS: 0xfe, PREFIX_GC: 0xfb }[m[1]!];
    const sub = members.get(m[2]!);
    if (p !== undefined && sub !== undefined) out.add((p << 16) | sub);
  }
  return out;
}

const knownOpcodes = await knownOpcodeValues();
if (known.size < 100) {
  console.error(
    `check-operator-mapping: only ${known.size} instruction names found — the name ` +
      `tables in opcode.ts have probably moved, so this check is not measuring what ` +
      `it claims. Failing rather than passing vacuously.`,
  );
  Deno.exit(1);
}

// ⚠️ **The invariant changed with S6 stage 1, and so did this check.**
//
// Operators used to be instruction-name STRINGS, and the question was whether
// each named a real instruction. They are now numeric OPCODES, so the question
// is whether each equals the opcode wabt-ts assigns — which is the same premise,
// checked against the value rather than the label, and strictly stronger: a
// wrong number is caught where a right name with a wrong mapping was not.
//
// It also covers ALL ELEVEN operator enums. The previous version imported only
// UnaryOp and BinaryOp, checking 315 of 371 members, which is why two BrOnOp
// members with no resolvable name went unnoticed until the conversion.
const exprSrc = await Deno.readTextFile(
  new URL('../src/binaryen-ts/ir/expressions.ts', import.meta.url),
);

/** Every operator constant, as `EnumName.Member` -> numeric value. */
function operatorConstants(src: string): Map<string, number> {
  const out = new Map<string, number>();
  const enumRe = new RegExp('export const ([A-Za-z]+Op) = \\{([\\s\\S]*?)\\n\\} as const;', 'g');
  for (const e of src.matchAll(enumRe)) {
    for (const m of e[2]!.matchAll(/^\s+([A-Za-z0-9_]+): ([^,]+),/gm)) {
      const expr = m[2]!.trim();
      let v: number | null = null;
      const pre = expr.match(/^\(0x([0-9a-f]+) << 16\) \| (0x[0-9a-f]+|\d+)$/);
      if (pre) v = (parseInt(pre[1]!, 16) << 16) | Number(pre[2]);
      else if (/^(0x[0-9a-fA-F]+|\d+)$/.test(expr)) v = Number(expr);
      if (v !== null) out.set(`${e[1]}.${m[1]}`, v);
    }
  }
  return out;
}

const constants = operatorConstants(exprSrc);
const orphans = [...constants].filter(([, v]) => !knownOpcodes.has(v)).map(([k]) => k).sort();

console.log(`instruction names known to wabt-ts : ${known.size}`);
console.log(`operator constants checked         : ${constants.size} across all operator enums`);

const phantoms = phantomKinds(exprSrc);
const added = phantoms.filter((p) => !PHANTOM_BUDGET.includes(p));
if (added.length > 0) {
  console.error(`\n${added.length} NEW declared-but-unimplemented kind(s):`);
  for (const p of added) console.error(`  ${p}`);
  console.error(
    '\nA declared kind with nothing behind it reads as support in every count that ' +
      'scans the enum. Implement it or remove it; the pinned list must not grow.',
  );
  Deno.exit(1);
}
// A RATCHET, not only a ceiling: a pinned name that is no longer a phantom must
// leave the list, or it would let that same phantom come back unnoticed. Found
// when S6 decision 6A deleted `TupleExtract` and the gate stayed green with it
// still pinned.
const retired = PHANTOM_BUDGET.filter((p) => !phantoms.includes(p));
if (retired.length > 0) {
  console.error(`\n${retired.length} pinned kind(s) no longer declared-but-unimplemented:`);
  for (const p of retired) console.error(`  ${p}`);
  console.error('\nRemove them from PHANTOM_BUDGET so the list only ever shrinks.');
  Deno.exit(1);
}
console.log(`declared-but-unimplemented kinds   : ${phantoms.length} (pinned)`);

// ---------------------------------------------------------------------------
// The one-sided kinds (S5) — pinned, and only ever allowed to shrink
// ---------------------------------------------------------------------------

/**
 * Every kind in wabt-ts's `Expr` union, by its discriminant string.
 *
 * ⚠️ The union is the authority, NOT every `readonly kind:` in `ir.ts`. That
 * file also declares non-expression nodes — `RefValueType` has `kind: 'ref'`
 * — and counting those reports a TYPE as a missing instruction.
 */
function wabtExprKinds(irSrc: string): Set<string> {
  const kindOf = new Map<string, string[]>();
  for (const m of irSrc.matchAll(/export interface (\w+)\s*(?:extends [^{]+)?\{([\s\S]*?)\n\}/g)) {
    const k = m[2]!.match(/^\s*readonly kind:\s*((?:'[^']+'\s*\|\s*)*'[^']+')/m);
    if (k) kindOf.set(m[1]!, [...k[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!));
  }
  const union = irSrc.match(/export type Expr =([\s\S]*?);/);
  if (!union) {
    console.error('check-operator-mapping: no `export type Expr =` union in ir.ts — failing.');
    Deno.exit(1);
  }
  const out = new Set<string>();
  const missing: string[] = [];
  for (const m of union[1]!.matchAll(/\|?\s*(\w+)/g)) {
    const ks = kindOf.get(m[1]!);
    if (!ks) missing.push(m[1]!);
    else for (const k of ks) out.add(k);
  }
  // A union member whose interface we could not read would silently shrink the
  // wabt-ts side and manufacture agreement. Refuse to report instead.
  if (missing.length > 0) {
    console.error(
      `check-operator-mapping: no kind found for ${missing.length} Expr member(s): ` +
        `${missing.join(', ')} — the shapes in ir.ts have moved. Failing rather than ` +
        `passing vacuously.`,
    );
    Deno.exit(1);
  }
  return out;
}

/**
 * The kinds each tree has and the other does not — pinned at what S5 left.
 *
 * ⚠️ Compare the enum's VALUES, never its identifiers. `ExpressionKind` is a
 * string enum whose values already ARE wabt-ts's kind strings (`Break = 'br'`,
 * `Switch = 'br_table'`), so an identifier diff reports `br` and `Break` as two
 * one-sided kinds when they are one shared kind spelled for two audiences. A
 * scrape that did exactly that is what kept the stale "27 outstanding" alive.
 *
 * What is left is not renames. It is three facts:
 *
 * - **the atomics and `call_ref`** — binaryen-ts cannot represent them at all;
 *   six of the eight are the `PHANTOM_BUDGET` above, and `atomic.load` /
 *   `atomic.store` are not even declared. A capability gap, registered.
 * - **`code_metadata`** — wabt-ts's annotation pseudo-instruction.
 * - **`region`** — divergence R1, S6 decision 5. Intended, and permanent.
 *
 * `simd.shift` was a fourth until K3 (owner decision 2026-09-14) merged it into
 * `binary`, wabt-ts's shape. Should a `simd.shift` kind come back, this fails.
 */
const ONE_SIDED_BUDGET = {
  wabt: [
    'atomic.cmpxchg',
    'atomic.fence',
    'atomic.load',
    'atomic.notify',
    'atomic.rmw',
    'atomic.store',
    'atomic.wait',
    'call_ref',
    'code_metadata',
  ],
  binaryen: ['region'],
};

const wabtKinds = wabtExprKinds(
  await Deno.readTextFile(new URL('../src/wabt-ts/ir/ir.ts', import.meta.url)),
);
const binKinds = new Set(
  [...exprSrc.matchAll(/^\s{2}([A-Za-z0-9_]+) = '([^']+)',/gm)]
    .filter((m) => !phantoms.includes(m[1]!))
    .map((m) => m[2]!),
);

const oneSided = {
  wabt: [...wabtKinds].filter((k) => !binKinds.has(k)).sort(),
  binaryen: [...binKinds].filter((k) => !wabtKinds.has(k)).sort(),
};
let oneSidedFailed = false;
for (const side of ['wabt', 'binaryen'] as const) {
  const pinned = ONE_SIDED_BUDGET[side];
  const grew = oneSided[side].filter((k) => !pinned.includes(k));
  // Same ratchet as PHANTOM_BUDGET: a pinned kind that became shared must leave
  // the list, or it silently buys back room for a future divergence.
  const gone = pinned.filter((k) => !oneSided[side].includes(k));
  if (grew.length > 0) {
    console.error(`\n${grew.length} NEW kind(s) only ${side} has: ${grew.join(', ')}`);
    console.error(
      'A kind on one side only is a capability the other cannot represent. ' +
        'Implement it on both, or add it here with its row in cmem/divergences.md.',
    );
    oneSidedFailed = true;
  }
  if (gone.length > 0) {
    console.error(
      `\n${gone.length} pinned ${side}-only kind(s) now on both sides: ${gone.join(', ')}`,
    );
    console.error('Remove them from ONE_SIDED_BUDGET so the list only ever shrinks.');
    oneSidedFailed = true;
  }
}
if (oneSidedFailed) Deno.exit(1);
console.log(
  `kinds shared by both IRs           : ${
    [...wabtKinds].filter((k) => binKinds.has(k)).length
  } (${oneSided.wabt.length} wabt-only, ${oneSided.binaryen.length} binaryen-only, pinned)`,
);

if (orphans.length === 0) {
  console.log('TOTAL — every operator constant is an opcode wabt-ts names.');
  Deno.exit(0);
}

console.error(`\n${orphans.length} operator(s) name NO known instruction:`);
for (const o of orphans.slice(0, 30)) console.error(`  ${o}`);
if (orphans.length > 30) console.error(`  ... and ${orphans.length - 30} more`);
console.error(
  '\nEither the operator is misspelled, or wabt-ts learned an instruction under a ' +
    'different name. Both break the grouping premise in cmem/ir-convergence.md.',
);
Deno.exit(1);
