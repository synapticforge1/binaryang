/**
 * @module scripts/verify-baseline
 *
 * Prove that a refactor did not change what the toolchain EMITS.
 *
 * Written for the binaryang merge (`cmem/pre-merge-known-issues.md`). A merge
 * is a large move-refactor, and the conformance harnesses that would otherwise
 * catch a regression live in a session scratchpad rather than the repo — they
 * do not survive it. This does: `scripts/pre-merge-baseline.tsv` records, for
 * every file in the wasmtk corpus, the byte length and hash of the `wat2wasm`
 * output and the hash of the `wasm2wat` disassembly.
 *
 * Re-run it after the merge. A pure relocation of files must produce an
 * identical manifest; anything else is a behaviour change that needs a reason.
 *
 * ```sh
 * deno run --allow-read scripts/verify-baseline.ts            # verify
 * deno run --allow-read --allow-write scripts/verify-baseline.ts --write   # re-baseline
 * ```
 *
 * Exit 0 when identical, 1 on any difference (with the first 20 named).
 *
 * ⚠️ The `deno task baseline` shortcut deliberately does NOT carry
 * `--allow-write`: verifying should not be able to rewrite the thing it checks
 * against, or a failing gate can be "fixed" by rerunning it. Re-baselining is
 * the longer command above, on purpose.
 *
 * NOT a test. It pins output bytes, so a deliberate encoder improvement — the
 * minimal section-size fix (T13.40) changed every byte in the corpus — is
 * SUPPOSED to fail it. Re-baseline in the same commit as such a change, and say
 * so in the message.
 *
 * @license MIT
 */

import { wasm2wat } from '../../src/wabt-ts/tools/wasm2wat.ts';
import { wat2wasm } from '../../src/wabt-ts/tools/wat2wasm.ts';

const CORPUS = new URL('../../tests/wabt-ts/wasmtk/', import.meta.url);
const MANIFEST = new URL('./pre-merge-baseline.tsv', import.meta.url);
const TEXT_ENCODER = new TextEncoder();
/** Written rather than escaped: the shell layer eats backslashes in this repo. */
const TAB = String.fromCharCode(9);

/** First 16 hex chars of the SHA-256 — enough to separate, short enough to read. */
async function sha(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/**
 * `file -> "bytes<TAB>hash<TAB>foldedHash<TAB>linearHash"` for the corpus as it
 * stands right now.
 *
 * ⚠️ BOTH text forms are recorded, and neither is taken from the default. When
 * folded became the default in 1.5.4 a single default-sourced text column would
 * have silently changed meaning — pinning the new default while quietly
 * dropping all coverage of linear, which is still a supported output. Naming
 * both explicitly makes the flip a one-time re-baseline instead of a permanent
 * hole, and either form regressing now shows up as a differing line.
 */
async function current(): Promise<Map<string, string>> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(CORPUS)) {
    if (entry.isFile && entry.name.endsWith('.wat')) names.push(entry.name);
  }
  names.sort();

  const out = new Map<string, string>();
  for (const name of names) {
    const src = await Deno.readTextFile(new URL(name, CORPUS));
    const r = wat2wasm(src);
    if (!r.binary || r.binary.length === 0) {
      out.set(name, 'ENCODE-FAIL');
      continue;
    }
    const folded = wasm2wat(r.binary, { fold: true }).text ?? '';
    const linear = wasm2wat(r.binary, { fold: false }).text ?? '';
    const cols = [
      String(r.binary.length),
      await sha(r.binary),
      await sha(TEXT_ENCODER.encode(folded)),
      await sha(TEXT_ENCODER.encode(linear)),
    ];
    out.set(name, cols.join(TAB));
  }
  return out;
}

/** The recorded manifest, ignoring `#` comment lines. */
async function recorded(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const text = await Deno.readTextFile(MANIFEST);
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const tab = line.indexOf('\t');
    if (tab > 0) out.set(line.slice(0, tab), line.slice(tab + 1));
  }
  return out;
}

const now = await current();

// Re-baselining used to be an ad-hoc step described in prose, which is how a
// manifest drifts from the thing it pins. `--write` makes it the same code path
// that verifies, so the recorded columns cannot disagree with the checked ones.
if (Deno.args.includes('--write')) {
  const names = [...now.keys()].sort();
  const totalBytes = names.reduce((sum, n) => sum + (Number(now.get(n)?.split(TAB)[0]) || 0), 0);
  const lines = [
    '# wabt-ts corpus output baseline',
    `# files=${names.length} totalBytes=${totalBytes}`,
    '# columns: file <tab> wasmBytes <tab> sha256-16(wasm) <tab> sha256-16(wasm2wat FOLDED)' +
    ' <tab> sha256-16(wasm2wat LINEAR)',
    ...names.map((n) => `${n}${TAB}${now.get(n)}`),
  ];
  await Deno.writeTextFile(MANIFEST, lines.join('\n') + '\n');
  console.log(`re-baselined: ${names.length} files, ${totalBytes} bytes`);
  Deno.exit(0);
}

const then = await recorded();
const differing: string[] = [];
const missing: string[] = [];
const added: string[] = [];

for (const [name, value] of then) {
  if (!now.has(name)) missing.push(name);
  else if (now.get(name) !== value) differing.push(name);
}
for (const name of now.keys()) if (!then.has(name)) added.push(name);

console.log(`baseline: ${then.size} files   current: ${now.size} files`);
if (differing.length === 0 && missing.length === 0 && added.length === 0) {
  console.log('IDENTICAL — the refactor changed no emitted bytes.');
  Deno.exit(0);
}
if (differing.length > 0) {
  console.error(`\nOUTPUT CHANGED for ${differing.length} file(s):`);
  for (const n of differing.slice(0, 20)) {
    console.error(`  ${n}\n     was ${then.get(n)}\n     now ${now.get(n)}`);
  }
  if (differing.length > 20) console.error(`  ... and ${differing.length - 20} more`);
}
if (missing.length > 0) {
  console.error(`\nGONE from the corpus (${missing.length}): ${missing.slice(0, 10).join(' ')}`);
}
if (added.length > 0) {
  console.error(`\nNEW in the corpus (${added.length}): ${added.slice(0, 10).join(' ')}`);
}
console.error('\nIf the change was deliberate, re-baseline in the same commit and say why.');
Deno.exit(1);
