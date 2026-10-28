/**
 * @module scripts/release/api-surface
 *
 * The compatibility gate's SURFACE SNAPSHOT (workspace letter H6; `../../cmem/layout-and-packaging.md`
 * § "The compatibility gate", rules 1, 2 and 5). "Backward compatible" is a gate result, never a
 * judgment made at bump time.
 *
 * The surface is what a consumer can depend on, produced by a tool:
 *
 * - **the library** — every export subpath of `jsr.json`, every symbol `deno doc --json` reports for
 *   it (JSR's own documentation engine), and every member of an interface, class, enum or
 *   namespace, each with its kind and a 12-hex fingerprint of its normalised declaration. Docs,
 *   source locations, type-resolution paths and absolute paths are stripped, so moving a type
 *   between files or editing a comment is not a surface change;
 * - **the CLI** — per tool, the flags its usage text names (long and short), and a fingerprint of
 *   that text; plus every pass name `wasm-opt` accepts (`listPasses()`).
 *
 * The floor, between two surfaces: an entry REMOVED or CHANGED is a major; an entry ADDED is a
 * minor; only a usage text's wording changed is a patch. A changed declaration is treated as
 * breaking even when it only widens — the gate is conservative, and the owner may still choose a
 * higher level than the floor, never a lower one.
 *
 * ```sh
 * bun scripts/release/api-surface.ts            # write api-surface.json from this tree
 * bun scripts/release/api-surface.ts --check    # fail if api-surface.json is not this tree's
 * bun scripts/release/api-surface.ts --floor    # the floor against the last release tag
 * bun scripts/release/api-surface.ts --floor v1.14.0
 * bun scripts/release/api-surface.ts --print    # this tree's surface on stdout (used on a tag's tree)
 * bun scripts/release/api-surface.ts --release-check   # CI on a tag: the version jump ≥ the floor
 * ```
 *
 * An intended surface change re-baselines in its OWN commit (rule 5): run the first form and commit
 * `api-surface.json` with the reason; the bump commit never touches it.
 *
 * @license MIT
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The bump levels, lowest first. */
export const LEVELS = ['patch', 'minor', 'major'] as const;
/** A bump level. */
export type Level = (typeof LEVELS)[number];

/** A tree's surface, as committed in `api-surface.json`. */
export interface Surface {
  /** Export subpath → entry name (`Sym`, `Sym.member`) → `kind#fingerprint`. */
  library: Record<string, Record<string, string>>;
  /** CLI tool → its flags (sorted) and a fingerprint of its usage text. */
  cli: Record<string, { flags: string[]; usage: string }>;
  /** Every pass name `wasm-opt` accepts. */
  passes: string[];
}

/** The floor two surfaces imply, and every entry that sets it. */
export interface Floor {
  floor: Level;
  reasons: { level: Level; what: string }[];
}

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SNAPSHOT = join(REPO, 'api-surface.json');

const fingerprint = (v: unknown) =>
  createHash('sha256').update(canonical(v)).digest('hex').slice(0, 12);

/** JSON with sorted keys, so a fingerprint does not depend on property order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${
      Object.keys(v as object).sort().map((k) =>
        `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`
      )
        .join(',')
    }}`;
  }
  return JSON.stringify(v);
}

/** Drops what is not surface — docs, locations, resolution paths — and makes paths tree-relative. */
function normalise(v: unknown, root: string): unknown {
  if (Array.isArray(v)) return v.map((x) => normalise(x, root));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'location' || k === 'jsDoc' || k === 'doc' || k === 'resolution') continue;
      out[k] = normalise(x, root);
    }
    return out;
  }
  return typeof v === 'string' && v.startsWith(root) ? v.slice(root.length) : v;
}

type DocDecl = { kind: string; declarationKind?: string; def?: Record<string, unknown> };
type DocSymbol = { name: string; declarations: DocDecl[] };
/** Member lists split out of a declaration, so adding a member reads as an addition. */
const MEMBER_LISTS: Record<string, string[]> = {
  interface: ['properties', 'methods', 'callSignatures', 'indexSignatures'],
  class: ['properties', 'methods', 'constructors', 'indexSignatures'],
  enum: ['members'],
};
/** A member list's entries' kind, singular. */
const MEMBER_KIND: Record<string, string> = {
  properties: 'property',
  methods: 'method',
  callSignatures: 'callSignature',
  indexSignatures: 'indexSignature',
  constructors: 'constructor',
  members: 'member',
};

/** The library entries of one symbol: its header, then each member. */
function entriesOf(sym: DocSymbol, prefix: string, out: Record<string, string>): void {
  const name = `${prefix}${sym.name}`;
  const headers: unknown[] = [];
  const members = new Map<string, { kind: string; defs: unknown[] }>();
  for (const decl of sym.declarations) {
    const def = { ...(decl.def ?? {}) };
    if (decl.kind === 'namespace') {
      const elements = (def['elements'] as DocSymbol[] | undefined) ?? [];
      delete def['elements'];
      for (const el of elements) entriesOf(el, `${name}.`, out);
    }
    for (const list of MEMBER_LISTS[decl.kind] ?? []) {
      const items = (def[list] as Record<string, unknown>[] | undefined) ?? [];
      delete def[list];
      for (const item of items) {
        const label = list === 'constructors'
          ? 'constructor'
          : list === 'callSignatures'
          ? '()'
          : list === 'indexSignatures'
          ? '[]'
          : String(item['name'] ?? '?');
        const key = `${name}.${label}`;
        const m = members.get(key) ?? { kind: MEMBER_KIND[list]!, defs: [] };
        m.defs.push(item);
        members.set(key, m);
      }
    }
    headers.push({ kind: decl.kind, def });
  }
  const kinds = [...new Set(sym.declarations.map((d) => d.kind))].sort().join('+');
  out[name] = `${kinds}#${fingerprint(headers)}`;
  for (const [key, m] of members) out[key] = `${m.kind}#${fingerprint(m.defs)}`;
}

/** Runs a command in `cwd`; its stdout, or throws with its stderr. */
function run(cmd: string, args: string[], cwd: string): string {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.error) throw r.error;
  if (r.status !== 0 && !r.stdout) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}: ${r.stderr.slice(0, 400)}`);
  }
  return r.stdout;
}

/** The CLI tools `main.ts` dispatches, read from its COMMANDS table. */
function cliTools(root: string): string[] {
  const main = readFileSync(join(root, 'main.ts'), 'utf8');
  return [...main.matchAll(/^\s+'([a-z0-9-]+)': \w+Main,$/gm)].map((m) => m[1]!);
}

/** The surface of the tree at `root` (the repository, or a release tag's extracted tree). */
/**
 * A tool's usage text as the surface records it: line endings normalised, and the tree's OWN version
 * replaced by `<version>`. The root usage names the version ("binaryang 1.16.0 — …"), so without
 * this every bump read as "usage text changed" and failed `surface:check` on the bump commit —
 * found by 1.16.0, the gate's first release (2026-10-24).
 */
export function usageText(raw: string, version: string): string {
  return raw.replace(/\r\n/g, '\n').trim().replaceAll(version, '<version>');
}

/**
 * The flags a usage text names. A token ending in `-` is a TEMPLATE's stem, not a flag: the old
 * usage text's `--enable-<feature>` read as a flag `--enable-`, so the help that lists every real
 * `--enable-gc` … read as that "flag" removed — a false major (2026-10-24, open-work 36).
 */
export function flagsIn(text: string): string[] {
  return [...new Set(text.match(/(?<![\w-])--?[a-zA-Z][a-zA-Z0-9-]*/g) ?? [])]
    .filter((f) => !f.endsWith('-'))
    .sort();
}

export async function surfaceOf(root: string): Promise<Surface> {
  const exportsMap = JSON.parse(readFileSync(join(root, 'jsr.json'), 'utf8')).exports as Record<
    string,
    string
  >;
  // Deno from npm, pinned as in publish.ts: no installed Deno needed (owner, 2026-10-28). Its
  // output was byte-identical to an installed Deno 2.9.8's on all 19 entries, measured.
  const docArgs = ['x', 'deno@2.9.6', 'doc', '--json', ...Object.values(exportsMap)];
  const doc = JSON.parse(run('bun', docArgs, root)) as {
    nodes: Record<string, { symbols?: DocSymbol[] }>;
  };
  const rootUrl = pathToFileURL(root.endsWith('/') || root.endsWith('\\') ? root : `${root}/`).href;
  // A re-export documented at once with its target module is a `reference` whose target is a
  // file / LINE / column — so a line added above the target (an attribution header did it) would
  // read as a changed symbol. Resolve each reference to the declaration it points at instead: a
  // real change to the re-exported type still shows, a line shift does not.
  type Loc = { filename: string; line: number; col: number };
  const at = new Map<string, RawDecl>();
  type RawDecl = DocDecl & { location?: Loc };
  for (const node of Object.values(doc.nodes)) {
    for (const s of node.symbols ?? []) {
      for (const d of s.declarations as RawDecl[]) {
        if (d.location) at.set(`${d.location.filename}:${d.location.line}:${d.location.col}`, d);
      }
    }
  }
  const resolveRefs = (d: RawDecl, depth = 0): RawDecl => {
    if (d.kind !== 'reference' || depth > 8) return d;
    const t = d.def?.['target'] as Loc | undefined;
    const target = t ? at.get(`${t.filename}:${t.line}:${t.col}`) : undefined;
    return target
      ? { kind: 'reference', def: { refersTo: resolveRefs(target, depth + 1) } }
      : { kind: 'reference', def: { refersTo: t?.filename ?? '?' } };
  };
  const library: Surface['library'] = {};
  for (const [sub, file] of Object.entries(exportsMap)) {
    const url = new URL(file, rootUrl).href;
    // deno doc also documents a NON-exported type an exported signature uses, as `private`. It is not
    // surface: dropping `export` from a type must read as a removal (the inversion caught this).
    const symbols = (doc.nodes[url]?.symbols ?? [])
      .map((s) => ({
        ...s,
        declarations: (s.declarations as RawDecl[]).filter((d) => d.declarationKind !== 'private'),
      }))
      .filter((s) => s.declarations.length > 0)
      .map((s) =>
        normalise(
          { ...s, declarations: s.declarations.map((d) => resolveRefs(d)) },
          rootUrl,
        ) as DocSymbol
      );
    const entries: Record<string, string> = {};
    for (const sym of symbols) entriesOf(sym, '', entries);
    library[sub] = Object.fromEntries(
      Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  const cli: Surface['cli'] = {};
  const version = (JSON.parse(readFileSync(join(root, 'jsr.json'), 'utf8')) as { version: string })
    .version;
  for (const tool of ['', ...cliTools(root)]) {
    const r = spawnSync('bun', ['main.ts', ...(tool ? [tool] : []), '--help'], {
      cwd: root,
      encoding: 'utf8',
    });
    const text = usageText(`${r.stdout}${r.stderr}`, version);
    cli[tool || 'binaryang'] = { flags: flagsIn(text), usage: fingerprint(text) };
  }
  const passesUrl = pathToFileURL(join(root, 'src', 'passes', 'index.ts')).href;
  const passes = ((await import(passesUrl)) as { listPasses: () => string[] }).listPasses().slice()
    .sort();
  return { library, cli, passes };
}

/** The floor from `before` to `after`, with every entry that sets it. */
export function floorOf(before: Surface, after: Surface): Floor {
  const reasons: Floor['reasons'] = [];
  const subs = new Set([...Object.keys(before.library), ...Object.keys(after.library)]);
  for (const sub of [...subs].sort()) {
    const a = before.library[sub];
    const b = after.library[sub];
    if (!a) {
      reasons.push({ level: 'minor', what: `export ${sub} added` });
      continue;
    }
    if (!b) {
      reasons.push({ level: 'major', what: `export ${sub} removed` });
      continue;
    }
    for (const k of Object.keys(a).sort()) {
      if (!(k in b)) reasons.push({ level: 'major', what: `${sub}: ${k} removed` });
      else if (a[k] !== b[k]) {
        reasons.push({ level: 'major', what: `${sub}: ${k} changed (${a[k]} → ${b[k]})` });
      }
    }
    for (const k of Object.keys(b).sort()) {
      if (!(k in a)) reasons.push({ level: 'minor', what: `${sub}: ${k} added` });
    }
  }
  const tools = new Set([...Object.keys(before.cli), ...Object.keys(after.cli)]);
  for (const t of [...tools].sort()) {
    const a = before.cli[t];
    const b = after.cli[t];
    if (!a) reasons.push({ level: 'minor', what: `CLI ${t} added` });
    else if (!b) reasons.push({ level: 'major', what: `CLI ${t} removed` });
    else {
      for (const f of a.flags) {
        if (!b.flags.includes(f)) {
          reasons.push({ level: 'major', what: `CLI ${t}: ${f} removed` });
        }
      }
      for (const f of b.flags) {
        if (!a.flags.includes(f)) reasons.push({ level: 'minor', what: `CLI ${t}: ${f} added` });
      }
      if (a.usage !== b.usage) {
        reasons.push({ level: 'patch', what: `CLI ${t}: usage text changed` });
      }
    }
  }
  for (const p of before.passes) {
    if (!after.passes.includes(p)) reasons.push({ level: 'major', what: `pass ${p} removed` });
  }
  for (const p of after.passes) {
    if (!before.passes.includes(p)) reasons.push({ level: 'minor', what: `pass ${p} added` });
  }
  const floor = reasons.reduce<Level>(
    (f, r) => (LEVELS.indexOf(r.level) > LEVELS.indexOf(f) ? r.level : f),
    'patch',
  );
  return { floor, reasons };
}

/** The latest release tag reachable from HEAD (`v<semver>`). */
export function lastReleaseTag(): string {
  return run('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'], REPO).trim();
}

/** The surface of a git ref, from its tree extracted into a temporary directory. */
export function surfaceOfRef(ref: string): Surface {
  const dir = mkdtempSync(join(tmpdir(), 'binaryang-surface-'));
  try {
    const tar = spawnSync('git', ['archive', '--format=tar', ref], {
      cwd: REPO,
      maxBuffer: 1 << 30,
    });
    if (tar.status !== 0) {
      throw new Error(`git archive ${ref}: ${tar.stderr.toString().slice(0, 300)}`);
    }
    // `tar -x` with cwd, never `-C <drive path>`: Windows tar reads `C:` as a remote host (local env note).
    const x = spawnSync('tar', ['-x'], { cwd: dir, input: tar.stdout, maxBuffer: 1 << 30 });
    if (x.status !== 0) throw new Error(`tar -x: ${x.stderr.toString().slice(0, 300)}`);
    // THIS script, run inside the tag's tree, so both surfaces come from the same generator.
    const out = run('bun', [fileURLToPath(import.meta.url), '--print'], dir);
    return JSON.parse(out) as Surface;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The level of the jump between two `major.minor.patch` versions. */
export function jumpOf(from: string, to: string): Level | 'none' {
  const [a, b] = [from, to].map((v) => v.replace(/^v/, '').split('.').map(Number));
  if (a![0] !== b![0]) return 'major';
  if (a![1] !== b![1]) return 'minor';
  if (a![2] !== b![2]) return 'patch';
  return 'none';
}

/** The floor from the last release tag (or `ref`) to this tree, as the bump uses it. */
export async function floorSinceRelease(ref = lastReleaseTag()): Promise<Floor & { ref: string }> {
  return { ref, ...floorOf(surfaceOfRef(ref), await surfaceOf(REPO)) };
}

const serialise = (s: Surface) => `${JSON.stringify(s, null, 1)}\n`;

/**
 * Whether the committed `api-surface.json` is this tree's surface (rule 5: an intended change is
 * re-baselined in its own commit BEFORE a bump), and if not, what differs.
 */
export async function snapshotDrift(): Promise<Floor['reasons']> {
  const now = serialise(await surfaceOf(REPO));
  const committed = readFileSync(SNAPSHOT, 'utf8').replace(/\r\n/g, '\n');
  return now === committed
    ? []
    : floorOf(JSON.parse(committed) as Surface, JSON.parse(now) as Surface).reasons;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === '--print') {
    process.stdout.write(serialise(await surfaceOf(resolve('.'))));
  } else if (args[0] === '--check') {
    const drift = await snapshotDrift();
    if (drift.length === 0) {
      console.log('api-surface.json matches this tree');
    } else {
      console.error('api-surface.json does NOT match this tree. Differences (committed → now):');
      for (const r of drift) console.error(`  [${r.level}] ${r.what}`);
      console.error(
        'An intended surface change re-baselines in its OWN commit: bun scripts/release/api-surface.ts',
      );
      process.exit(1);
    }
  } else if (args[0] === '--release-check') {
    // CI, on a release tag (rule 2): the version in jsr.json against the PREVIOUS release tag must
    // jump at least as far as the surface diff between them demands. Needs the tags (fetch-depth 0).
    const version =
      (JSON.parse(readFileSync(join(REPO, 'jsr.json'), 'utf8')) as { version: string }).version;
    const prev = run(
      'git',
      ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD^'],
      REPO,
    ).trim();
    const f = await floorSinceRelease(prev);
    const jump = jumpOf(prev, version);
    console.log(
      `release ${version} after ${prev}: the version jumps ${jump}; the surface demands ${f.floor}`,
    );
    for (const r of f.reasons) console.log(`  [${r.level}] ${r.what}`);
    if (jump === 'none' || LEVELS.indexOf(jump) < LEVELS.indexOf(f.floor)) {
      console.error(`release check FAILED: a ${f.floor} change released as ${jump}`);
      process.exit(1);
    }
  } else if (args[0] === '--floor') {
    const f = await floorSinceRelease(args[1]);
    console.log(`floor since ${f.ref}: ${f.floor}`);
    for (const r of f.reasons) console.log(`  [${r.level}] ${r.what}`);
  } else if (args.length === 0) {
    const s = await surfaceOf(REPO);
    writeFileSync(SNAPSHOT, serialise(s));
    const n = Object.values(s.library).reduce((t, e) => t + Object.keys(e).length, 0);
    console.log(
      `api-surface.json: ${Object.keys(s.library).length} exports, ${n} entries, ${
        Object.keys(s.cli).length
      } CLIs, ${s.passes.length} passes`,
    );
  } else {
    console.error(
      'usage: bun scripts/release/api-surface.ts [--check | --floor [<ref>] | --release-check | --print]',
    );
    process.exit(2);
  }
}
