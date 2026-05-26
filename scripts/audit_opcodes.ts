/**
 * Audit wabt-ts EXTENDED_OPCODE_NAMES against upstream wabt's opcode.def.
 *
 * Run: deno run -A scripts/audit_opcodes.ts
 *
 * Prints any (prefix, byte, name) discrepancies. Fail-loud: if upstream and
 * wabt-ts disagree on a name, that's almost certainly a stale-draft entry
 * in wabt-ts that needs fixing (see decisions-log bug #10).
 *
 * Limited to prefixed opcodes (0xfc, 0xfd, 0xfe) — the unprefixed core set
 * is small enough that bugs would have been caught long ago.
 */

const UPSTREAM_DEF = new URL("../upstream/include/wabt/opcode.def", import.meta.url);
const WABT_TS_OPCODE = new URL("../src/core/opcode.ts", import.meta.url);

const PREFIX_LABELS: Record<number, string> = { 0xfc: "MISC", 0xfd: "SIMD", 0xfe: "ATOMIC" };

function parseUpstream(src: string): Map<number, string> {
  const out = new Map<number, string>();
  // WABT_OPCODE(... prefix, code, EnumName, "wat.name", ...)
  // We want the prefix-byte + sub-byte + the quoted name. Sub-opcodes >= 0x100
  // (relaxed-SIMD) are LEB128-encoded and don't fit the (prefix << 8) | byte
  // scheme used by wabt-ts's EXTENDED_OPCODE_NAMES; skip them.
  const rx = /WABT_OPCODE\([^)]*?,\s*(0xf[cde]),\s*(0x[0-9a-f]+),\s*\w+,\s*"([^"]+)"/g;
  for (const m of src.matchAll(rx)) {
    const prefix = Number(m[1]);
    const code = Number(m[2]);
    if (code >= 0x100) continue;
    const combined = (prefix << 8) | code;
    out.set(combined, m[3]!);
  }
  return out;
}

function parseWabtTs(src: string): Map<number, string> {
  const out = new Map<number, string>();
  // Numeric literal in the second slot — accepts both `0xNN` (hex) and `NN`
  // (decimal, used by the MISC section). PREFIX_THREADS is wabt-ts's name
  // for the 0xfe atomics block — kept distinct from PREFIX_MISC/PREFIX_SIMD.
  const rx = /\[\(PREFIX_(SIMD|MISC|THREADS)\s*<<\s*8\)\s*\|\s*(0x[0-9a-f]+|\d+),\s*'([^']+)'\]/gi;
  const prefixMap = { SIMD: 0xfd, MISC: 0xfc, THREADS: 0xfe } as const;
  for (const m of src.matchAll(rx)) {
    const prefix = prefixMap[m[1]!.toUpperCase() as keyof typeof prefixMap];
    const code = Number(m[2]);
    const combined = (prefix << 8) | code;
    if (out.has(combined)) {
      console.log(
        `DUPLICATE KEY: ${PREFIX_LABELS[prefix]} 0x${code.toString(16).padStart(2, "0")} ` +
          `— "${out.get(combined)}" then "${m[3]}"`,
      );
    }
    out.set(combined, m[3]!);
  }
  return out;
}

const upstream = parseUpstream(await Deno.readTextFile(UPSTREAM_DEF));
const wabtTs = parseWabtTs(await Deno.readTextFile(WABT_TS_OPCODE));

console.log(`upstream: ${upstream.size} prefixed opcodes`);
console.log(`wabt-ts:  ${wabtTs.size} prefixed opcodes\n`);

let mismatches = 0;
let missing = 0;
let extras = 0;

for (const [combined, upstreamName] of upstream.entries()) {
  const wabtName = wabtTs.get(combined);
  const prefix = (combined >> 8) & 0xff;
  const code = combined & 0xff;
  const tag = `${PREFIX_LABELS[prefix]} 0x${code.toString(16).padStart(2, "0")}`;
  if (wabtName === undefined) {
    console.log(`MISSING: ${tag} — upstream "${upstreamName}", wabt-ts has no entry`);
    missing++;
  } else if (wabtName !== upstreamName) {
    console.log(`MISMATCH: ${tag} — upstream "${upstreamName}", wabt-ts "${wabtName}"`);
    mismatches++;
  }
}
for (const [combined, wabtName] of wabtTs.entries()) {
  if (!upstream.has(combined)) {
    const prefix = (combined >> 8) & 0xff;
    const code = combined & 0xff;
    const tag = `${PREFIX_LABELS[prefix]} 0x${code.toString(16).padStart(2, "0")}`;
    console.log(`EXTRA: ${tag} — wabt-ts "${wabtName}", no upstream entry`);
    extras++;
  }
}

console.log(
  `\nSummary: ${mismatches} mismatches, ${missing} missing, ${extras} extra ` +
    `(wabt-ts entries with no upstream counterpart)`,
);
Deno.exit(mismatches > 0 ? 1 : 0);
