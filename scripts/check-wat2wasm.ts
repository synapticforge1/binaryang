// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * binaryang's `wat2wasm` against the REAL one (wabt's), on a real corpus: the bytes each writes
 * from the same text (C-R2-1, security review round 4). Until this step nothing in the gate ran
 * upstream `wat2wasm` at all — the byte baseline pins binaryang's OWN output, so it is blind to any
 * divergence older than itself, and the 421-of-421 parity of cmem/testing.md § "Byte parity" was a
 * one-off measurement from a scratch harness.
 *
 * The corpus:
 * - every `.wat` in `tests/wabt-ts/wasmtk/` (the wasmtk-built modules, kept in this repo), whole;
 * - every standalone text `(module …)` in the spec testsuite's `.wast` scripts (`<suite>/*.wast`,
 *   `custom/` and `legacy/`), cut out by this script: a module `wast2json` would hand to a reader.
 *   (`(module binary …)`, `(module quote …)`, `definition` and `instance` forms are not text modules.)
 *
 * Each text is assembled by upstream `wat2wasm` — with the same feature set `spec-prepare.ts` gives
 * `wast2json`, `--no-check` (this library function validates nothing either) and `--debug-names`
 * (binaryang writes the name section) — and by `wat2wasm()` here with `textForm: false` (the plain
 * bytes, as upstream's). The two byte strings are compared SECTION by section.
 *
 * ## The one documented normalisation
 *
 * binaryang writes LABEL names (name subsection 3) and GC FIELD names (subsection 10);
 * upstream `wat2wasm --debug-names` writes neither (cmem/divergences.md N2, a FEATURE, owner
 * 2026-09-11). Those two subsections are removed from binaryang's name section before comparing. Any
 * OTHER byte that differs is a difference, and it fails unless it is listed in
 * {@link KNOWN_DIFFERENCES} with its reason — a RATCHET: a new difference fails, and so does a listed
 * one that no longer occurs.
 *
 * ## What upstream cannot assemble
 *
 * wabt 1.0.41 has no GC text syntax for part of the spec corpus (G2, cmem/divergences.md): a text it
 * REJECTS cannot be compared with wabt. Those are counted ({@link WABT_CANNOT_ASSEMBLE}, a ratchet)
 * and compared with `wasm-tools parse` instead — in every non-custom section (its name section
 * differs by G4). A text no oracle assembles, or one an oracle assembles and binaryang REJECTS, is
 * always a failure.
 *
 * `wat2wasm` and `wasm-tools` are REQUIRED: missing, this fails and says how to install them, never
 * skips.
 *
 * Usage: `bun scripts/check-wat2wasm.ts <testsuite-dir> <work-dir>`
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { wat2wasm } from '../src/tools/wat2wasm.ts';

/** The feature set `spec-prepare.ts` hands `wast2json` (compact imports and wide arithmetic left out). */
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

/**
 * Differences between binaryang's bytes and upstream's that are kept ON PURPOSE, by corpus item and
 * difference key, each with its reason. Empty = binaryang writes upstream's bytes everywhere the
 * corpus reaches, outside the N2 normalisation above.
 */
const BLOCK_TYPE_INDEX =
  'W15 (DESIGN): a block / loop / if written `(type $t)` stays the type INDEX as written (`02 00`); ' +
  'upstream wat2wasm inlines a `[] -> [t]` type as its value type (`02 7f`). wasm-tools writes the index ' +
  'as we do. Both decode to the same block type';
const BRANCH_HINT_FOLDED =
  'a `@metadata.code.branch_hint` on a FOLDED `(if …)` whose condition is an operand: wabt 1.0.41 ' +
  'records the offset where the fold STARTS (the first operand, 2 bytes before the `if` opcode); ' +
  'binaryang records the `if` opcode the annotation is on, and `wasm-tools parse` writes the very same ' +
  'bytes as binaryang (measured 2026-11-20, custom/branch_hint.wast module 0). The three offsets of the ' +
  'last function differ by exactly that; the hints on unfolded `if`s are identical';
const WT_ELEM_FORM =
  '`(table funcref (elem $f …))`: wasm-tools writes the index-form element segment (flags 0); wabt and ' +
  'binaryang write the expression form (flags 4, `ref.func` items) — measured identical to wabt on the ' +
  'non-GC modules of this corpus. Both decode to the same segment';
const WT_IMPLICIT_TYPE =
  'an implicit function type (a `(func $f …)` with no typeuse) equal to a type the module already ' +
  'defines: binaryang reuses the existing type (the testsuite itself says "the implicit type of $f is ' +
  '$ft"), as wabt does for the corpus modules it can assemble; wasm-tools appends an equivalent new ' +
  'type, so its type and function sections differ';
const WT_SUB_FINAL =
  'W17 (DESIGN): an explicit `(sub final …)` with no supertypes is written `0x4f 00` + comptype, as the ' +
  'text wrote it; wasm-tools writes the bare-comptype shorthand. Both decode to the same type';

export const KNOWN_DIFFERENCES: { item: string; key: string; reason: string }[] = [
  { item: 'block.wast#0', key: 'section 10', reason: BLOCK_TYPE_INDEX },
  { item: 'loop.wast#0', key: 'section 10', reason: BLOCK_TYPE_INDEX },
  { item: 'if.wast#0', key: 'section 10', reason: BLOCK_TYPE_INDEX },
  {
    item: 'custom/branch_hint.wast#0',
    key: "custom 'metadata.code.branch_hint'",
    reason: BRANCH_HINT_FOLDED,
  },
  ...[
    'type-equivalence.wast#7',
    'type-equivalence.wast#8',
    'type-rec.wast#7',
    'type-rec.wast#8',
    'type-rec.wast#9',
    'type-subtyping.wast#14',
    'type-subtyping.wast#15',
  ]
    .map((item) => ({ item, key: 'wasm-tools: section 9', reason: WT_ELEM_FORM })),
  ...['type-rec.wast#2', 'type-rec.wast#9', 'type-rec.wast#10'].flatMap((item) => [
    { item, key: 'wasm-tools: section 1', reason: WT_IMPLICIT_TYPE },
    { item, key: 'wasm-tools: section 3', reason: WT_IMPLICIT_TYPE },
  ]),
  ...['type-subtyping.wast#15', 'type-subtyping.wast#16', 'type-subtyping.wast#28']
    .map((item) => ({ item, key: 'wasm-tools: section 1', reason: WT_SUB_FINAL })),
];

/**
 * How many of the corpus's texts upstream wabt 1.0.41 CANNOT assemble: the GC proposal's text syntax
 * (`array`, `i31`, `(rec …)`, `sub`, `br_on_cast` …) is not in it (G2, cmem/divergences.md), and a few
 * annotation forms. Counted, never dropped: those are compared with `wasm-tools parse` instead.
 */
export const WABT_CANNOT_ASSEMBLE = 129;

// --- The corpus ---------------------------------------------------------------------------------

interface Item {
  /** A stable name: `<file>` for a whole `.wat`, `<script>.wast#<n>` for the n-th text module. */
  id: string;
  text: string;
}

/** The balanced S-expressions at the top level of a `.wast` (comments and strings skipped). */
export function topLevelForms(src: string): string[] {
  const forms: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"') {
      for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === '\\') i++;
    } else if (c === ';' && src[i + 1] === ';') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '(' && src[i + 1] === ';') {
      let nest = 1;
      for (i += 2; i < src.length && nest > 0; i++) {
        if (src[i] === '(' && src[i + 1] === ';') {
          nest++;
          i++;
        } else if (src[i] === ';' && src[i + 1] === ')') {
          nest--;
          i++;
        }
      }
      i--;
    } else if (c === '(') {
      if (depth++ === 0) start = i;
    } else if (c === ')') {
      if (--depth === 0) forms.push(src.slice(start, i + 1));
    }
  }
  return forms;
}

/** Is this top-level form a text `(module …)` — not `binary`, `quote`, `definition` or `instance`? */
export function isTextModule(form: string): boolean {
  const m = /^\(module(?![^\s()])\s*(\$[^\s()]*)?\s*([^\s()]*)/.exec(form);
  if (m === null) return false;
  return !['binary', 'quote', 'definition', 'instance'].includes(m[2]!);
}

function collect(suite: string): Item[] {
  const items: Item[] = [];
  const own = fileURLToPath(new URL('../tests/wabt-ts/wasmtk/', import.meta.url));
  for (const f of readdirSync(own).filter((f) => f.endsWith('.wat')).sort()) {
    items.push({ id: `wasmtk/${f}`, text: readFileSync(join(own, f), 'utf8') });
  }
  for (const sub of ['', 'custom', 'legacy']) {
    const dir = sub === '' ? suite : join(suite, sub);
    const wasts = readdirSync(dir, { withFileTypes: true }).filter((e) =>
      e.isFile() && e.name.endsWith('.wast')
    ).map((e) => e.name).sort();
    for (const f of wasts) {
      let n = 0;
      for (const form of topLevelForms(readFileSync(join(dir, f), 'utf8'))) {
        if (isTextModule(form)) {
          items.push({ id: `${sub === '' ? '' : sub + '/'}${f}#${n++}`, text: form });
        }
      }
    }
  }
  return items;
}

// --- Binary comparison --------------------------------------------------------------------------

class Reader {
  declare readonly b: Uint8Array;
  declare p: number;
  constructor(b: Uint8Array, p: number) {
    this.b = b;
    this.p = p;
  }
  u8(): number {
    if (this.p >= this.b.length) throw new Error('truncated');
    return this.b[this.p++]!;
  }
  uleb(): number {
    let r = 0, s = 0, x;
    do {
      x = this.u8();
      r += (x & 0x7f) * 2 ** s;
      s += 7;
    } while (x & 0x80);
    return r;
  }
}

interface Section {
  id: number;
  /** A custom section's name; empty otherwise. */
  name: string;
  payload: Uint8Array;
}

export function sectionsOf(b: Uint8Array): Section[] {
  const out: Section[] = [];
  const r = new Reader(b, 8);
  while (r.p < b.length) {
    const id = r.u8();
    const size = r.uleb();
    const end = r.p + size;
    let name = '';
    let payload = b.subarray(r.p, end);
    if (id === 0) {
      const n = r.uleb();
      name = new TextDecoder().decode(b.subarray(r.p, r.p + n));
      payload = b.subarray(r.p + n, end);
    }
    out.push({ id, name, payload });
    r.p = end;
  }
  return out;
}

/** A name section's subsections: id → bytes. */
function nameSubsections(payload: Uint8Array): Map<number, Uint8Array> {
  const m = new Map<number, Uint8Array>();
  const r = new Reader(payload, 0);
  while (r.p < payload.length) {
    const id = r.u8();
    const size = r.uleb();
    m.set(id, payload.subarray(r.p, r.p + size));
    r.p += size;
  }
  return m;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** The name subsections binaryang writes that upstream `--debug-names` does not (N2). */
const N2_SUBSECTIONS = new Set([3, 10]);

/** The keys of every difference between upstream's bytes and binaryang's, after the N2 normalisation. */
export function differences(wabt: Uint8Array, ours: Uint8Array): string[] {
  const diffs: string[] = [];
  const a = sectionsOf(wabt);
  const b = sectionsOf(ours);
  const plain = (s: Section[]) => s.filter((x) => x.id !== 0);
  const pa = plain(a), pb = plain(b);
  if (pa.map((s) => s.id).join() !== pb.map((s) => s.id).join()) {
    diffs.push(`section order: wabt [${pa.map((s) => s.id)}] ours [${pb.map((s) => s.id)}]`);
  } else {
    for (const [i, s] of pa.entries()) {
      if (hex(s.payload) !== hex(pb[i]!.payload)) diffs.push(`section ${s.id}`);
    }
  }
  const customs = (s: Section[]) => s.filter((x) => x.id === 0);
  const ca = new Map(customs(a).map((s) => [s.name, s.payload]));
  const cb = new Map(customs(b).map((s) => [s.name, s.payload]));
  for (const name of new Set([...ca.keys(), ...cb.keys()])) {
    const x = ca.get(name), y = cb.get(name);
    if (name === 'name') {
      const sa = x === undefined ? new Map() : nameSubsections(x);
      const sb = y === undefined ? new Map() : nameSubsections(y);
      for (const id of N2_SUBSECTIONS) sb.delete(id);
      for (const id of new Set([...sa.keys(), ...sb.keys()])) {
        const p = sa.get(id), q = sb.get(id);
        if (p === undefined) diffs.push(`name subsection ${id}: only in ours`);
        else if (q === undefined) diffs.push(`name subsection ${id}: only in wabt`);
        else if (hex(p) !== hex(q)) diffs.push(`name subsection ${id}`);
      }
    } else if (x === undefined) diffs.push(`custom '${name}': only in ours`);
    else if (y === undefined) diffs.push(`custom '${name}': only in wabt`);
    else if (hex(x) !== hex(y)) diffs.push(`custom '${name}'`);
  }
  return diffs;
}

/**
 * Non-custom sections only: what `wasm-tools parse` writes, against binaryang's (its name section
 * differs by G4, cmem/divergences.md — no field names for a `(rec …)` group, no import parameter names).
 */
export function differencesPlain(other: Uint8Array, ours: Uint8Array): string[] {
  const pa = sectionsOf(other).filter((s) => s.id !== 0);
  const pb = sectionsOf(ours).filter((s) => s.id !== 0);
  if (pa.map((s) => s.id).join() !== pb.map((s) => s.id).join()) {
    return [`section order: wasm-tools [${pa.map((s) => s.id)}] ours [${pb.map((s) => s.id)}]`];
  }
  return pa.flatMap((s, i) => (hex(s.payload) === hex(pb[i]!.payload) ? [] : [`section ${s.id}`]));
}

// --- Running upstream ---------------------------------------------------------------------------

const INSTALL =
  'install wabt 1.0.41+ (it ships wat2wasm, wasm2wat, wast2json): Windows `scoop install wabt`, ' +
  'macOS `brew install wabt`, Debian/Ubuntu `apt install wabt` (or a release from ' +
  'https://github.com/WebAssembly/wabt/releases) — then `wat2wasm --version` must work';

function requireWat2wasm(): string {
  const r = spawnSync('wat2wasm', ['--version'], { encoding: 'utf8' });
  if (r.error !== undefined || r.status !== 0) {
    console.error(`check-wat2wasm: upstream wat2wasm is REQUIRED and is not on PATH — ${INSTALL}`);
    process.exit(1);
  }
  return r.stdout.trim();
}

/** Runs `wasm-tools parse` (the second oracle, for what wabt cannot assemble) on `file`. */
function wasmTools(file: string, out: string): { bytes: Uint8Array } | { error: string } {
  const r = spawnSync('wasm-tools', ['parse', file, '-o', out], { encoding: 'utf8' });
  if (r.error !== undefined) return { error: `could not run wasm-tools: ${r.error.message}` };
  if (r.status !== 0) {
    return { error: (r.stderr.trim().split('\n')[0] ?? `exit ${r.status}`).slice(0, 160) };
  }
  return { bytes: new Uint8Array(readFileSync(out)) };
}

/** Runs upstream `wat2wasm` on `file`: its bytes, or why it refused. */
function upstream(file: string, out: string): Promise<{ bytes: Uint8Array } | { error: string }> {
  return new Promise((resolve) => {
    const p = spawn('wat2wasm', [...FEATURES, '--no-check', '--debug-names', file, '-o', out], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => resolve({ error: `could not run wat2wasm: ${e.message}` }));
    p.on('close', (code) => {
      if (code === 0) resolve({ bytes: new Uint8Array(readFileSync(out)) });
      else resolve({ error: err.trim().split('\n')[0] ?? `exit ${code}` });
    });
  });
}

/** How one text came out. */
type Outcome =
  | 'same' // upstream wat2wasm assembles it; the bytes are equal (after N2)
  | 'differs' // ... and the bytes differ
  | 'wt-same' // wabt cannot; wasm-tools parse assembles it, equal in every non-custom section
  | 'wt-differs' // ... and differs
  | 'neither' // neither oracle assembles it, and we do
  | 'nobody' // neither oracle assembles it, and we do not either
  | 'OURS-REJECTS'; // an oracle assembles it and we do not

async function main(): Promise<number> {
  const [suite, work] = process.argv.slice(2);
  if (!suite || !work) {
    console.error('usage: check-wat2wasm.ts <testsuite-dir> <work-dir>');
    return 2;
  }
  const version = requireWat2wasm();
  const wt = spawnSync('wasm-tools', ['--version'], { encoding: 'utf8' });
  if (wt.error !== undefined || wt.status !== 0) {
    console.error(
      'check-wat2wasm: wasm-tools is REQUIRED (the second oracle for the GC text wabt cannot ' +
        'assemble) and is not on PATH — install it: `cargo install wasm-tools`, `scoop install ' +
        'wasm-tools`, `brew install wasm-tools`, or a release from ' +
        'https://github.com/bytecodealliance/wasm-tools/releases',
    );
    process.exit(1);
  }
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const items = collect(suite);

  const results: { item: Item; outcome: Outcome; detail: string[]; wabtRejected: boolean }[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i]!;
      // One file per item: a stale output from an earlier run can never be read back as this one's.
      const file = join(work, `${i}.wat`);
      writeFileSync(file, item.text);
      const theirs = await upstream(file, join(work, `${i}.wasm`));
      let ours: ReturnType<typeof wat2wasm> | undefined;
      let oursWhy = '';
      try {
        ours = wat2wasm(item.text, { textForm: false, filename: item.id });
        if (ours.errors.length > 0 || ours.binary.length === 0) {
          oursWhy = String(ours.errors[0]?.message ?? '?').slice(0, 160);
          ours = undefined;
        }
      } catch (e) {
        oursWhy = `THREW: ${(e as Error).message}`;
      }
      const wabtRejected = 'error' in theirs;
      // Upstream wabt is the oracle; for what it cannot assemble, wasm-tools.
      const second = wabtRejected ? wasmTools(file, join(work, `${i}.wt.wasm`)) : undefined;
      const ref = !wabtRejected
        ? theirs
        : second !== undefined && 'bytes' in second
        ? second
        : undefined;
      let outcome: Outcome;
      let detail: string[] = [];
      if (ref === undefined) {
        outcome = ours === undefined ? 'nobody' : 'neither';
        detail = [
          (theirs as { error: string }).error.slice(0, 100),
          (second as { error: string }).error.slice(0, 100),
        ];
      } else if (ours === undefined) {
        outcome = 'OURS-REJECTS';
        detail = [oursWhy];
      } else if (!wabtRejected) {
        detail = differences(ref.bytes, ours.binary);
        outcome = detail.length === 0 ? 'same' : 'differs';
      } else {
        detail = differencesPlain(ref.bytes, ours.binary).map((k) => `wasm-tools: ${k}`);
        outcome = detail.length === 0 ? 'wt-same' : 'wt-differs';
      }
      results.push({ item, outcome, detail, wabtRejected });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(availableParallelism(), 8) }, () => worker()),
  );
  rmSync(work, { recursive: true, force: true });
  results.sort((x, y) => x.item.id.localeCompare(y.item.id, 'en', { numeric: true }));

  const count = (o: Outcome) => results.filter((r) => r.outcome === o).length;
  const wabtRejects = results.filter((r) => r.wabtRejected).length;
  const row = (label: string, n: number, note = '') =>
    console.log(
      `    ${label.padEnd(32)}${String(n).padStart(6)}${note === '' ? '' : `   ${note}`}`,
    );
  console.log(
    `  === binaryang wat2wasm vs upstream wat2wasm ${version}: ${items.length} texts ===`,
  );
  row('byte-identical to wabt', count('same'), '(N2 label / field names normalised)');
  row('DIFFER from wabt', count('differs'));
  row('wabt cannot assemble', wabtRejects, '(the GC text syntax, G2): then wasm-tools:');
  row('  identical to wasm-tools', count('wt-same'), '(every non-custom section)');
  row('  DIFFER from wasm-tools', count('wt-differs'));
  row('  neither assembles, we do', count('neither'));
  row('  nobody assembles', count('nobody'));
  row('WE REJECT what an oracle takes', count('OURS-REJECTS'));

  let failed = false;
  const list = (title: string, lines: string[]) => {
    console.log(`\n  ✗ ${title} (first 40):`);
    for (const l of lines.slice(0, 40)) console.log(`    ${l}`);
    failed = true;
  };
  // Differences, against the checked-in list.
  const found = results.flatMap((r) =>
    r.outcome === 'differs' || r.outcome === 'wt-differs'
      ? r.detail.map((key) => ({ item: r.item.id, key }))
      : []
  );
  const same = (a: { item: string; key: string }, b: { item: string; key: string }) =>
    a.item === b.item && a.key === b.key;
  const fresh = found.filter((f) => !KNOWN_DIFFERENCES.some((k) => same(k, f)));
  if (fresh.length > 0) {
    list(
      `${fresh.length} NEW difference(s): fix, or list in KNOWN_DIFFERENCES with why`,
      fresh.map((f) => `${f.item}: ${f.key}`),
    );
  }
  const stale = KNOWN_DIFFERENCES.filter((k) => !found.some((f) => same(k, f)));
  if (stale.length > 0) {
    list(
      `${stale.length} KNOWN_DIFFERENCES entr(ies) no longer occur: remove`,
      stale.map((k) => `${k.item}: ${k.key}`),
    );
  }
  // The reach of the oracle: how many texts wabt cannot assemble (a ratchet, both ways).
  if (wabtRejects !== WABT_CANNOT_ASSEMBLE) {
    list(
      `wabt cannot assemble ${wabtRejects} text(s), WABT_CANNOT_ASSEMBLE is ${WABT_CANNOT_ASSEMBLE}: ` +
        'more is the oracle reaching less (or a corpus change), fewer a newer wabt reaching more: set it with why',
      results.filter((r) => r.wabtRejected).map((r) => r.item.id),
    );
  }
  const nobody = results.filter((r) => r.outcome === 'neither' || r.outcome === 'nobody');
  if (nobody.length > 0) {
    list(
      `${nobody.length} text(s) NO oracle assembles`,
      nobody.map((r) => `${r.item.id} [${r.outcome}]: ${r.detail.join(' | ')}`),
    );
  }
  const bad = results.filter((r) => r.outcome === 'OURS-REJECTS');
  if (bad.length > 0) {
    list(
      `${bad.length} text(s) an oracle assembles and binaryang REJECTS`,
      bad.map((r) => `${r.item.id}: ${r.detail[0]}`),
    );
  }
  if (items.length === 0 || count('same') === 0) {
    console.log('\n  ✗ nothing compared');
    failed = true;
  }
  if (!failed) {
    console.log(
      `\n  TOTAL — ${count('same')} texts byte-identical to upstream wat2wasm, ${
        count('wt-same')
      } to ` +
        `wasm-tools (where wabt cannot assemble); ${KNOWN_DIFFERENCES.length} listed difference(s).`,
    );
  }
  return failed ? 1 : 0;
}

if (import.meta.main) process.exit(await main());
