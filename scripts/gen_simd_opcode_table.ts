/**
 * Regenerate the SIMD section of EXTENDED_OPCODE_NAMES from upstream
 * wabt's opcode.def. Run, then paste the output into src/core/opcode.ts
 * between `--- 0xfd: SIMD ---` and `--- 0xfe: atomics ---`.
 *
 *   deno run -A scripts/gen_simd_opcode_table.ts > /tmp/simd_table.ts
 */

const UPSTREAM_DEF = new URL("../upstream/include/wabt/opcode.def", import.meta.url);

const src = await Deno.readTextFile(UPSTREAM_DEF);

// WABT_OPCODE(...., prefix, code, EnumName, "wat.name", "")
// We only emit 0xfd entries (SIMD).
const rx = /WABT_OPCODE\([^)]*?,\s*(0xfd),\s*(0x[0-9a-f]+),\s*\w+,\s*"([^"]+)"/g;

console.log("  // --- 0xfd: SIMD / v128 instructions (regenerated from upstream wabt opcode.def) ---");
console.log("  // Note: SIMD sub-opcodes >= 0x100 (the relaxed-SIMD set) are LEB128-encoded");
console.log("  // and don't fit in the (prefix << 8) | byte key scheme used here. Tracked as");
console.log("  // a separate todo; the bridge/writer/reader handle them via the explicit opcode.");
for (const m of src.matchAll(rx)) {
  const code = parseInt(m[2]!, 16);
  const name = m[3]!;
  if (code >= 0x100) continue;
  console.log(`  [(PREFIX_SIMD << 8) | 0x${code.toString(16).padStart(2, "0")}, '${name}'],`);
}
