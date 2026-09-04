/**
 * @module scripts/spec-testsuite
 *
 * Run the official WebAssembly spec testsuite against this toolchain.
 *
 * ## Why this exists
 *
 * 🔑 **It tests whether we correctly REJECT, and nothing else here does.** Every
 * other invariant in this project asks "do we accept valid input correctly" —
 * the corpus round trips, the byte comparisons, the upstream oracle. **A tool
 * that accepted everything would score perfectly on all of them.**
 *
 * The suite carries ~4,300 must-reject cases: modules that must fail
 * validation, and text or binaries that must fail to parse at all. Fail-loud is
 * a stated contract of this codebase and had never been measured against a
 * corpus designed to attack it.
 *
 * It is also the first INDEPENDENT conformance corpus used here. The 421-file
 * corpus comes from wasmtk — our own ecosystem — and our two implementations
 * have mostly been checking each other, which is blind to anything they get
 * wrong the same way.
 *
 * ## Usage
 *
 * The `.wast` files are scripts, not modules, so they are split first with
 * upstream `wast2json` into modules plus a JSON manifest of assertions.
 *
 * ```sh
 * deno task spec:prepare   # once — writes manifests under the scratch dir
 * deno task spec           # run the harness over them
 * ```
 *
 * ⚠️ The testsuite lives in a SIBLING repo and is READ ONLY. `wast2json` writes
 * only into the prepared output directory, never next to the sources.
 *
 * ## What each command type means here
 *
 * | manifest type | our obligation |
 * | ------------- | -------------- |
 * | `module` | accept: decode and validate it |
 * | `assert_invalid` | REJECT at validation |
 * | `assert_malformed` (binary) | REJECT at decode |
 * | `assert_malformed` (text) | REJECT at parse |
 *
 * `assert_return` / `assert_trap` are behavioural and need a runner; they are
 * counted and skipped, deliberately, so the first pass measures the axis that
 * has never been measured rather than the one an engine already covers.
 *
 * @license MIT
 */

import { readBinaryIr } from '../src/wabt-ts/reader/binary-reader-ir.ts';
import { validateModule } from '../src/wabt-ts/validator/validator.ts';
import { hasErrors, makeErrorList } from '../src/wabt-ts/core/error.ts';
import { parseWatModule } from '../src/wabt-ts/parser/wast-parser.ts';
import { allFeatures } from '../src/wabt-ts/core/feature.ts';

/**
 * ⚠️ EVERY feature on, and the suite is unusable without it.
 *
 * The first run used the default feature set and reported 464 "valid modules
 * REJECTED" — every one of them a post-MVP proposal the spec suite exercises on
 * purpose: *"only one memory block allowed"*, *"64-bit memory not allowed:
 * enable the memory64 feature"*. That is the harness being wrong, not the
 * validator, and it is exactly the shape of false finding this project keeps
 * catching: a measurement whose setup does not match what it claims to measure.
 *
 * `wast2json` is invoked with `--enable-all` for the same reason, so the two
 * ends agree on what the suite is allowed to contain.
 */
const FEATURES = allFeatures();

const MANIFESTS = Deno.args[0];
if (!MANIFESTS) {
  console.error('usage: spec-testsuite.ts <manifest-dir>   (see deno task spec:prepare)');
  Deno.exit(2);
}

interface Command {
  type: string;
  line: number;
  filename?: string;
  text?: string;
  module_type?: string;
}

/** Decode + validate, the way `wasm-validate` does. Returns null when accepted. */
function rejectReason(bytes: Uint8Array): string | null {
  const errors = makeErrorList();
  try {
    // ⚠️ The READER takes no feature set — gating is validator-only. So a decode
    // failure here is unconditional: the reader does not know that byte at all,
    // whatever features are enabled. Worth distinguishing from a validate
    // failure in the report for exactly that reason.
    const mod = readBinaryIr(bytes, errors);
    if (hasErrors(errors)) return 'decode: ' + String(errors[0]?.message ?? '?');
    validateModule(mod, errors, { features: FEATURES });
    if (hasErrors(errors)) return 'validate: ' + String(errors[0]?.message ?? '?');
    return null;
  } catch (e) {
    // A throw is still a rejection — it is just a less useful one than a typed
    // error, which is worth distinguishing in the report.
    return 'THREW: ' + (e as Error).message;
  }
}

const tally = {
  module: { n: 0, ok: 0 },
  assert_invalid: { n: 0, ok: 0 },
  malformed_binary: { n: 0, ok: 0 },
  malformed_text: { n: 0, ok: 0 },
  skipped: 0,
};
const misses: Record<string, string[]> = {};
const miss = (bucket: string, where: string) => ((misses[bucket] ??= []).push(where));

for await (const dir of Deno.readDir(MANIFESTS)) {
  if (!dir.isDirectory) continue;
  const base = `${MANIFESTS}/${dir.name}/${dir.name}.json`;
  let manifest: { commands: Command[] };
  try {
    manifest = JSON.parse(await Deno.readTextFile(base));
  } catch {
    continue;
  }
  const dirOf = `${MANIFESTS}/${dir.name}`;

  for (const cmd of manifest.commands) {
    const where = `${dir.name}.wast:${cmd.line}`;

    if (cmd.type === 'module' && cmd.filename) {
      tally.module.n++;
      const bytes = await Deno.readFile(`${dirOf}/${cmd.filename}`);
      const why = rejectReason(bytes);
      if (why === null) tally.module.ok++;
      else miss('REJECTED a module the spec says is VALID', `${where}  ${why.slice(0, 70)}`);
      continue;
    }

    if (cmd.type === 'assert_invalid' && cmd.filename && cmd.module_type === 'binary') {
      tally.assert_invalid.n++;
      const bytes = await Deno.readFile(`${dirOf}/${cmd.filename}`);
      if (rejectReason(bytes) !== null) tally.assert_invalid.ok++;
      else miss('ACCEPTED a module the spec says is INVALID', `${where}  want: ${cmd.text ?? '?'}`);
      continue;
    }

    if (cmd.type === 'assert_malformed' && cmd.filename) {
      if (cmd.module_type === 'binary') {
        tally.malformed_binary.n++;
        const bytes = await Deno.readFile(`${dirOf}/${cmd.filename}`);
        if (rejectReason(bytes) !== null) tally.malformed_binary.ok++;
        else miss('ACCEPTED a MALFORMED binary', `${where}  want: ${cmd.text ?? '?'}`);
      } else {
        tally.malformed_text.n++;
        const text = await Deno.readTextFile(`${dirOf}/${cmd.filename}`);
        let rejected: boolean;
        try {
          const { errors } = parseWatModule(text);
          rejected = errors.length > 0;
        } catch {
          rejected = true;
        }
        if (rejected) tally.malformed_text.ok++;
        else miss('ACCEPTED MALFORMED text', `${where}  want: ${cmd.text ?? '?'}`);
      }
      continue;
    }

    tally.skipped++;
  }
}

const pct = (a: number, b: number) => (b === 0 ? '   -' : `${((100 * a) / b).toFixed(1)}%`);
const row = (label: string, t: { n: number; ok: number }) =>
  `    ${label.padEnd(34)}${String(t.ok).padStart(6)} / ${String(t.n).padEnd(6)} ${pct(t.ok, t.n)}`;

console.log('  === WebAssembly spec testsuite ===');
console.log(row('modules ACCEPTED (must accept)', tally.module));
console.log(row('assert_invalid REJECTED', tally.assert_invalid));
console.log(row('malformed BINARY rejected', tally.malformed_binary));
console.log(row('malformed TEXT rejected', tally.malformed_text));
console.log(`    behavioural, skipped this pass  ${tally.skipped}`);
console.log();

const buckets = Object.entries(misses).sort((a, b) => b[1].length - a[1].length);
if (buckets.length === 0) {
  console.log('  no misses');
  Deno.exit(0);
}
for (const [bucket, list] of buckets) {
  console.log(`  ${String(list.length).padStart(5)}x  ${bucket}`);
  // Grouped by REASON, not listed one by one: 62 individual lines say much less
  // than "these 40 are the same missing feature". The shape of a failure list is
  // the finding; the roster is only where to look.
  const byReason = new Map<string, string[]>();
  for (const w of list) {
    const reason = (/\s{2}((?:decode|validate|THREW|want):.*)$/.exec(w)?.[1] ?? w)
      .replace(/\b\d+\b/g, 'N')
      .slice(0, 62);
    (byReason.get(reason) ?? byReason.set(reason, []).get(reason)!).push(w);
  }
  for (const [reason, hits] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`      ${String(hits.length).padStart(4)}x  ${reason}`);
    console.log(`              e.g. ${hits[0]!.split('  ')[0]}`);
  }
}

// A full roster, for the cases where the grouping is not enough to act on.
const REPORT = Deno.env.get('SPEC_REPORT');
if (REPORT) {
  const lines: string[] = [];
  for (const [bucket, list] of buckets) {
    lines.push(`## ${bucket} (${list.length})`, ...list, '');
  }
  await Deno.writeTextFile(REPORT, lines.join('\n'));
  console.log(`\n  full roster written to ${REPORT}`);
}
Deno.exit(1);
