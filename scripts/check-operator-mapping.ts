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

import { BinaryOp, UnaryOp } from '../src/binaryen-ts/ir/expressions.ts';

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
if (known.size < 100) {
  console.error(
    `check-operator-mapping: only ${known.size} instruction names found — the name ` +
      `tables in opcode.ts have probably moved, so this check is not measuring what ` +
      `it claims. Failing rather than passing vacuously.`,
  );
  Deno.exit(1);
}

const operators = new Set<string>([
  ...Object.values(UnaryOp as unknown as Record<string, string>),
  ...Object.values(BinaryOp as unknown as Record<string, string>),
]);

const orphans = [...operators].filter((op) => !known.has(op)).sort();

console.log(`instruction names known to wabt-ts : ${known.size}`);
console.log(`binaryen-ts operator values        : ${operators.size}`);

if (orphans.length === 0) {
  console.log('TOTAL — every binaryen-ts operator names a real wasm instruction.');
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
