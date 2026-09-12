/**
 * @module scripts/spec-prepare
 *
 * Split the WebAssembly spec testsuite's `.wast` scripts into modules plus JSON
 * assertion manifests, ready for `scripts/spec-testsuite.ts`.
 *
 * `.wast` files are SCRIPTS — modules interleaved with assertions — so they
 * cannot be fed to a module reader directly. Upstream `wast2json` does the
 * split, which is also why it must be on PATH.
 *
 * ```sh
 * deno task spec:prepare            # uses the default suite path
 * deno task spec:prepare <src> <out>
 * ```
 *
 * ⚠️ The suite lives in a SIBLING repo and is READ ONLY. Output goes only to
 * `<out>`, never beside the sources.
 *
 * ## The feature set is the whole design of this script
 *
 * 🔑 **`--enable-all` is WRONG here, and not for the reason it looks.** It does
 * not merely permit more — it changes what `wast2json` EMITS. With it, the
 * splitter produced binaries using the experimental *compact imports* proposal,
 * whose import-kind byte is `0x7F`. Those are not standard wasm: V8 rejects them
 * outright with *"Invalid import kind 127, enable with
 * --experimental-wasm-compact-imports"*.
 *
 * The harness then reported 58 "valid modules REJECTED" that were nothing of the
 * kind — our reader was right and the corpus was wrong. **A test corpus built
 * with the wrong flags measures the flags, not the code.**
 *
 * Going the other way is just as wrong: with the DEFAULT feature set only 157 of
 * 257 files convert, silently dropping SIMD, GC, threads, tail calls and more —
 * proposals this toolchain does support. That looks like a pass because the
 * failures never enter the corpus at all.
 *
 * So the set below is explicit: every proposal wabt-ts's `Features` claims,
 * MINUS the two it declares but its binary reader does not implement. Those are
 * tracked as a finding rather than hidden by a flag.
 */

/**
 * ⚠️ Deliberately NOT `--enable-all`.
 *
 * Excluded, and why:
 * - `compact-imports` — emits a `0x7F` import kind that is not standard wasm.
 *   wabt-ts declares `Features.compactImports` but the binary reader does not
 *   implement it (`unknown import kind: 127`). A declared flag is not an
 *   implementation; enabling it here would hide that gap behind 58 fake
 *   failures.
 * - `wide-arithmetic` — same shape: declared in `Features`, unimplemented.
 */
const FEATURES = [
  '--enable-exceptions',
  '--enable-threads',
  '--enable-function-references',
  '--enable-tail-call',
  '--enable-annotations',
  '--enable-code-metadata',
  '--enable-gc',
  '--enable-memory64',
  '--enable-multi-memory',
  '--enable-extended-const',
  '--enable-relaxed-simd',
  '--enable-custom-page-sizes',
];

const DEFAULT_SRC =
  '<workspace>/wasmtk/tests/module/wasm_wast/testsuite-main';

// `||` not `??`: an EMPTY argument is a caller saying "use the default", and
// `??` passes it straight through to `readDir`, which fails with the unhelpful
// "Empty path is not allowed".
const src = Deno.args[0] || DEFAULT_SRC;
const out = Deno.args[1] || Deno.env.get('SPEC_OUT');
if (!out) {
  console.error('usage: spec-prepare.ts [srcDir] <outDir>   (or set SPEC_OUT)');
  Deno.exit(2);
}

const wasts: string[] = [];
for await (const e of Deno.readDir(src)) {
  if (e.isFile && e.name.endsWith('.wast')) wasts.push(e.name);
}
wasts.sort();
if (wasts.length === 0) {
  console.error(`spec-prepare: no .wast files under ${src}`);
  Deno.exit(1);
}

await Deno.mkdir(out, { recursive: true });
let ok = 0;
const failed: string[] = [];

let viaWasmTools = 0;

for (const name of wasts) {
  const base = name.replace(/\.wast$/, '');
  const dir = `${out}/${base}`;
  await Deno.mkdir(dir, { recursive: true });
  const cmd = new Deno.Command('wast2json', {
    args: [...FEATURES, '-o', `${dir}/${base}.json`, `${src}/${name}`],
    stdout: 'null',
    stderr: 'piped',
  });
  const { code } = await cmd.output();
  if (code === 0) {
    ok++;
    continue;
  }
  // G2: `wast2json` 1.0.41 cannot split the 30 GC-proposal files — the very
  // files that test the proposal this toolchain implements and upstream wabt
  // does not, so they were the LEAST safe thirty to be missing. `wasm-tools`
  // splits all of them, into the same layout with a few command types of its
  // own (`module_definition`, `module_instance`, modules given as TEXT); the
  // harness reads those.
  await Deno.remove(dir, { recursive: true }).catch(() => {});
  await Deno.mkdir(dir, { recursive: true });
  const wt = new Deno.Command('wasm-tools', {
    args: [
      'json-from-wast',
      `${src}/${name}`,
      '--wasm-dir',
      dir,
      '-o',
      `${dir}/${base}.json`,
      '--pretty',
    ],
    stdout: 'null',
    stderr: 'piped',
  });
  const wtOut = await wt.output();
  if (wtOut.success) {
    ok++;
    viaWasmTools++;
  } else {
    failed.push(base);
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

console.log(`prepared ${ok} of ${wasts.length} .wast files into ${out}`);
if (viaWasmTools > 0) {
  console.log(`  ${viaWasmTools} of them via wasm-tools json-from-wast (wast2json could not)`);
}
if (failed.length > 0) {
  // Not an error: neither splitter could take these. Named so the harness's
  // coverage is never mistaken for the suite's.
  console.log(`skipped ${failed.length} (neither wast2json nor wasm-tools could split them):`);
  console.log('  ' + failed.join(' '));
}
