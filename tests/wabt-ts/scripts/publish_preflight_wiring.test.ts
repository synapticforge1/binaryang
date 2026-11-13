// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as fsx from '../../test_fs.ts';
import { READ_ONLY_GIT, runRelease } from '../../../scripts/release/release-run.ts';
import { RELEASE_FILES } from '../../../scripts/release/release-guard.ts';
import { releaseBaseProblem } from '../../../scripts/release/version.ts';

// T13.44, then review round 1 (2026-11-13). `release_guard.test.ts` proves `releaseBlockers`
// returns the right answer; it does not prove the release ASKS. That gap is how T13.43 happened:
// two documents described a dirty-tree refusal and the script did not do it. Until 2026-11-13 this
// file read `publish.ts`'s SOURCE for the guards' positions, and removing most refusals left it
// green. Now the release is `runRelease` (scripts/release/release-run.ts) with git, the registries
// and the checks handed in, and these tests RUN every refusal: each must exit 1 and run NO git
// command that changes anything. `publish.ts` only wires in the real ones.

const PUBLISH = await fsx.readTextFile('scripts/release/publish.ts');
const GUARD = await fsx.readTextFile('scripts/release/release-guard.ts');

/** A scripted world for one release: what git, the registries and the checks answer. */
interface World {
  porcelain: string;
  branch: string;
  fetchFails: boolean;
  containsOriginMain: boolean;
  localTag: 0 | 1 | 128;
  remoteTag: string;
  lsRemoteTagsFails: boolean;
  jsr: boolean;
  npm: 'free' | 'published' | 'burned';
  cold: boolean;
  check: boolean;
  entry: string[];
  /** The release files differ from HEAD (a bump not yet committed). */
  bumpPending: boolean;
  head: string;
  originMain: string;
  pushFails: boolean;
  /** What origin's main reads back as after the push (undefined: HEAD). */
  readBack?: string;
}

const READY: World = {
  porcelain: ' M jsr.json\n M main.ts\n',
  branch: 'main',
  fetchFails: false,
  containsOriginMain: true,
  localTag: 1,
  remoteTag: '',
  lsRemoteTagsFails: false,
  jsr: false,
  npm: 'free',
  cold: true,
  check: true,
  entry: [],
  bumpPending: true,
  head: 'a'.repeat(40),
  originMain: 'b'.repeat(40),
  pushFails: false,
};

/** Runs a release in `world`; the exit code, every git command, and what was printed. */
async function release(over: Partial<World> = {}) {
  const w: World = { ...READY, ...over };
  const calls: string[][] = [];
  const out: string[] = [];
  let committed = false;
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const fail = (status = 1) => ({ status, stdout: '', stderr: 'scripted failure' });
  const code = await runRelease({
    version: '9.9.9',
    git(args) {
      calls.push(args);
      const [sub, a1] = args;
      switch (sub) {
        case 'status':
          return ok(w.porcelain);
        case 'rev-parse':
          if (a1 === '--abbrev-ref') return ok(`${w.branch}\n`);
          if (a1 === '-q') return w.localTag === 0 ? ok('t\n') : fail(w.localTag);
          if (a1 === 'origin/main') return ok(`${w.originMain}\n`);
          return ok(`${committed ? 'c'.repeat(40) : w.head}\n`);
        case 'fetch':
          return w.fetchFails ? fail(128) : ok();
        case 'merge-base':
          return w.containsOriginMain ? ok() : fail();
        case 'ls-remote':
          if (a1 === '--tags') return w.lsRemoteTagsFails ? fail(128) : ok(w.remoteTag);
          return ok(`${w.readBack ?? (committed ? 'c'.repeat(40) : w.head)}\trefs/heads/main\n`);
        case 'diff':
          // `diff --quiet HEAD -- files` (the bump pending) and `diff --cached --quiet` (staged).
          return w.bumpPending ? fail(1) : ok();
        case 'add':
          return ok();
        case 'commit':
          committed = true;
          return ok();
        case 'push':
          return w.pushFails ? fail() : ok();
      }
      throw new Error(`unscripted git ${args.join(' ')}`);
    },
    jsrHas: () => Promise.resolve(w.jsr),
    npmState: () => Promise.resolve(w.npm),
    coldDryRun: () => w.cold,
    typeCheck: () => w.check,
    entryProblems: () => Promise.resolve(w.entry),
    log: (l) => out.push(l),
    error: (l) => out.push(l),
  });
  const mutated = calls.filter((c) => !READ_ONLY_GIT.has(c[0]!)).map((c) => c[0]);
  return { code, calls, mutated, out: out.join('\n') };
}

describe('the release: every refusal runs, and changes nothing', () => {
  it('a ready tree: commits the bump, pushes main ONLY, reads it back; no tag anywhere', async () => {
    const r = await release();
    expect(r.code).toBe(0);
    expect(r.mutated).toEqual(['add', 'commit', 'push']);
    expect(r.calls).toContainEqual(['add', ...RELEASE_FILES]);
    expect(r.calls).toContainEqual(['commit', '-m', 'bump to v9.9.9']);
    expect(r.calls.filter((c) => c[0] === 'push')).toEqual([['push', 'origin', 'main']]);
    expect(r.calls.some((c) => c[0] === 'tag' || c.includes('v9.9.9') && c[0] === 'push'))
      .toBe(false);
    expect(r.calls.at(-1)).toEqual(['ls-remote', 'origin', 'refs/heads/main']);
  });

  it("fetches GitHub's main AND its tags (CI makes the tags) before reading any tag", async () => {
    const r = await release();
    const fetch = r.calls.findIndex((c) => c[0] === 'fetch');
    expect(r.calls[fetch]).toEqual(['fetch', '-q', '--tags', 'origin', 'main']);
    expect(fetch).toBeLessThan(r.calls.findIndex((c) => c[0] === 'rev-parse' && c[1] === '-q'));
  });

  const refusals: [string, Partial<World>, string][] = [
    ['an untracked file', { porcelain: '?? new.ts\n M jsr.json\n' }, 'not clean'],
    ['a modified file outside the release files', { porcelain: ' M src/x.ts\n' }, 'not clean'],
    ['a branch other than main', { branch: 'feature' }, "not 'main'"],
    ['a detached HEAD', { branch: 'HEAD' }, "not 'main'"],
    ['a failed fetch', { fetchFails: true }, 'could not fetch'],
    ['a main that lacks origin/main', { containsOriginMain: false }, 'does not contain'],
    ['a local tag', { localTag: 0 }, 'LOCAL tag'],
    ['an unreadable local tag list', { localTag: 128 }, 'could not read the local tags'],
    ['a tag on origin', { remoteTag: 'x\trefs/tags/v9.9.9\n' }, 'already exists on origin'],
    ["a failed read of origin's tags", { lsRemoteTagsFails: true }, "could not read origin's tags"],
    ['a version JSR has', { jsr: true }, 'JSR has it'],
    ['a version npm serves', { npm: 'published' }, 'npm published'],
    ['a number npm burned', { npm: 'burned' }, 'npm burned'],
    ['a failed cold dry run', { cold: false }, 'cold publish dry run failed'],
    ['a failed type check', { check: false }, 'type check failed'],
    ['a root that is not a CLI', { entry: ['--help printed nothing'] }, 'not a working CLI'],
    [
      'nothing to push (the bump committed and already on GitHub)',
      { porcelain: '', bumpPending: false, head: 'b'.repeat(40) },
      'nothing to push',
    ],
  ];
  for (const [what, world, says] of refusals) {
    it(`refuses ${what}, changing nothing`, async () => {
      const r = await release(world);
      expect(r.code).toBe(1);
      expect(r.mutated).toEqual([]);
      expect(r.out).toContain(says);
    });
  }

  it('a refused push, or a push that does not read back, is a failure, not a release', async () => {
    expect((await release({ pushFails: true })).code).toBe(1);
    const r = await release({ readBack: 'd'.repeat(40) });
    expect(r.code).toBe(1);
    expect(r.out).toContain('did not read back');
  });

  it('a bump committed but not yet pushed is released without a second commit', async () => {
    const r = await release({ porcelain: '', bumpPending: false });
    expect(r.code).toBe(0);
    expect(r.mutated).toEqual(['add', 'push']);
  });
});

describe('publish.ts wires in the real checks', () => {
  // The cold type check (2026-09-28): publish.yml checks with no cache, so a stale local cache
  // passed what CI then failed — after the tag was public (binaryen-ts v1.2.4). It must run in a
  // FRESH `DENO_DIR`, with the parent environment spread in, and never with `--no-check`.
  it('the cold dry run: a fresh DENO_DIR, the environment kept, never --no-check', () => {
    expect(PUBLISH).toContain("denoCommand(['publish', '--dry-run', '--allow-dirty'])");
    expect(PUBLISH).toContain('env: { ...process.env, DENO_DIR: coldDir }');
    expect(PUBLISH).toContain('mkdtempSync(');
    expect(PUBLISH).not.toContain("'--no-check'");
    expect(PUBLISH).toContain("spawnSync('bun', ['run', 'check']");
    expect(PUBLISH).toContain('checkEntry(process.cwd())');
    expect(PUBLISH).toContain('runRelease({');
    // publish.ts itself runs no git command of its own.
    expect(PUBLISH).not.toMatch(/\[\s*'(add|commit|push|tag)'/);
  });

  // The property that made `publish.ts` untestable in the first place. If the guard module ever
  // gains a side effect, importing it from a test starts doing something.
  it('keeps release-guard.ts free of side effects', () => {
    expect(GUARD).not.toContain('Deno.Command');
    expect(GUARD).not.toContain('Deno.exit');
    expect(GUARD).not.toContain('child_process');
    expect(GUARD).not.toContain('process.exit');
    expect(/^await /m.test(GUARD)).toBe(false);
    expect(/^const \w+ = await/m.test(GUARD)).toBe(false);
  });

  it('keeps scripts/ inside the gate', () => {
    // T13.43 found `scripts/` type-checked, linted and formatted by nothing -- including the file
    // that publishes immutable artifacts. Each config's scope must name scripts/.
    const jsonc = (path: string) =>
      JSON.parse(
        fsx.readTextFileSync(path).replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'),
      );
    const biome = jsonc('biome.jsonc') as { files: { includes: string[] } };
    expect(biome.files.includes).toContain('scripts/**');
    const dprint = jsonc('dprint.json') as { includes: string[] };
    expect(dprint.includes).toContain('scripts/**');
    const ts = jsonc('tsconfig.json') as { include: string[] };
    expect(ts.include).toContain('scripts/**/*.ts');
  });

  it('documents where the guards live, so the docs cannot drift silently', async () => {
    const doc = await fsx.readTextFile('cmem/publishing.md');
    expect(doc).toContain('release-guard.ts');
  });
});

// The bump's base (review round 1, 2026-11-13): CI makes the tags, so a clone that has not fetched
// them would gate a bump against an older release.
describe('the bump gates against the release jsr.json names', () => {
  it('the base must be v<current>; anything else is a refusal that says why', () => {
    expect(releaseBaseProblem('v3.0.4', '3.0.4')).toBe(null);
    expect(releaseBaseProblem('v3.0.3', '3.0.4')).toContain('fetch the tags');
    expect(releaseBaseProblem('', '3.0.4')).toContain('(none)');
  });

  it('bump_version.ts fetches the tags, then refuses a wrong base, before the floor is used', () => {
    const bump = fsx.readTextFileSync('scripts/release/bump_version.ts');
    const fetch = bump.indexOf("['fetch', '-q', '--tags', 'origin']");
    const base = bump.indexOf('releaseBaseProblem(f.ref, current)');
    expect(fetch).toBeGreaterThan(-1);
    expect(base).toBeGreaterThan(fetch);
    expect(base).toBeLessThan(bump.indexOf('compatibility floor since'));
    expect(bump.slice(fetch, base)).toContain('process.exit(1)');
  });
});

// The release path off Deno (Bun migration B6, 2026-10-13). Provenance is the reason for the shape:
// `deno publish` must be called DIRECTLY by publish.yml (an indirection such as `bunx jsr publish`,
// which downloads Deno and runs it as a subprocess, is the kind this repo has lost provenance
// through), and everything before it is the CI gate's tooling, so a release is judged as CI is.
describe('the release workflows, off Deno except for the publish itself', () => {
  const PUBLISH_YML = fsx.readTextFileSync('.github/workflows/publish.yml');
  /**
   * `run:` commands, in order — a block scalar (`run: |`) expanded into each of its lines, so
   * nothing in a block escapes the checks below (review round 1, 2026-11-13: a block read as the
   * one token `|`, and `curl … | sh` inside the `jsr` job's block passed the credential test).
   */
  const runs = (yml: string): string[] => {
    const out: string[] = [];
    const lines = yml.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]!);
      if (!m) continue;
      const value = m[2]!.trim();
      if (!/^[|>][+-]?$/.test(value)) {
        out.push(value);
        continue;
      }
      const indent = m[1]!.length;
      for (i++; i < lines.length; i++) {
        const l = lines[i]!;
        if (l.trim() !== '' && l.length - l.trimStart().length <= indent) break;
        if (l.trim() !== '' && !/^\s*#/.test(l)) out.push(l.trim());
      }
      i--;
    }
    return out;
  };

  it('reads a run: block line by line (the parser the credential checks rely on)', () => {
    const yml =
      '      - run: |\n          a b\n          # c\n\n          d\n      - run: e\n    f:\n';
    expect(runs(yml)).toEqual(['a b', 'd', 'e']);
  });
  /** The lines that are not YAML comments. */
  const code = (yml: string) => yml.split('\n').filter((l) => !/^\s*#/.test(l));

  it('publishes with deno publish, directly, from jsr.json', () => {
    // Bare since B7: with no deno.json, Deno finds jsr.json itself, and a `--config` naming any
    // other file would publish from it. The one other form is the checks job's dry run.
    expect(runs(PUBLISH_YML)).toContain('deno publish');
    expect(
      runs(PUBLISH_YML).filter((r) =>
        /^deno publish\b/.test(r) && r !== 'deno publish' && r !== 'deno publish --dry-run'
      ),
    ).toEqual([]);
    expect(code(PUBLISH_YML).filter((l) => /\b(bunx|npx) jsr\b/.test(l))).toEqual([]);
    expect(code(PUBLISH_YML).filter((l) => /\b(deno task|bun run) release\b/.test(l))).toEqual([]);
  });

  it('runs both type checks and both test legs BEFORE publishing', () => {
    const r = runs(PUBLISH_YML);
    const publish = r.indexOf('deno publish');
    for (const cmd of ['bun run check', 'bun run test', 'bun run test:bun']) {
      const at = r.indexOf(cmd);
      expect(at >= 0 && at < publish, `${cmd} runs before the publish`).toBe(true);
    }
    expect(r).not.toContain('deno task test');
  });

  // Workspace letter H6, rule 2: the compatibility gate is repeated on the tagged commit, before
  // anything is published, and it needs the release tags to find the previous one.
  it('runs the compatibility gate on the tag BEFORE publishing, with the tags fetched', () => {
    const r = runs(PUBLISH_YML);
    const gate = r.indexOf('bun scripts/release/api-surface.ts --release-check');
    expect(
      gate >= 0 && gate < r.indexOf('deno publish'),
      'the release check runs before the publish',
    ).toBe(true);
    expect(jobs['checks']).toMatch(
      /uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n(?:\s+#[^\n]*\n)*\s+fetch-depth: 0/,
    );
  });

  // 🔒 The owner's order (2026-11-10, workspace letter H33, D1): "the CI to check first, then push
  // the tag, and then create the release page from the tag, then publish the package to the
  // registry". publish.yml runs on a push of `main` (never on a tag), CI makes the tag, and
  // auto-tag.yml — which tagged from a separate run — is retired.
  it('runs on a push of main only; auto-tag.yml is gone', () => {
    expect(PUBLISH_YML).toMatch(/\non:\n {2}push:\n {4}branches:\n {6}- main\n\n/);
    expect(code(PUBLISH_YML).filter((l) => /\btags:|workflow_dispatch|workflow_call/.test(l)))
      .toEqual([]);
    expect(existsSync('.github/workflows/auto-tag.yml')).toBe(false);
    expect(PUBLISH_YML).toMatch(/\npermissions: \{\}\n/);
  });

  it('orders the jobs checks → tag → release → jsr → npm', () => {
    const needs = (job: string) => /\n {4}needs: ([^\n]+)/.exec(jobs[job]!)?.[1];
    /** A job's `if:` — the expression inside its `${{ … }}`. */
    const cond = (job: string) => /\n {4}if: \$\{\{ ([^\n]+) \}\}\n/.exec(jobs[job]!)?.[1];
    // The npm package is proven BEFORE CI tags (review round 1, 2026-11-13); `npm-build` may be
    // skipped only while npm publishing is off.
    expect(needs('tag')).toBe('[checks, npm-build]');
    expect(cond('tag')).toBe(
      "!cancelled() && needs.checks.result == 'success' && needs.checks.outputs.release == 'true' && (needs.npm-build.result == 'success' || (vars.NPM_PUBLISH != 'true' && needs.npm-build.result == 'skipped'))",
    );
    expect(needs('release')).toBe('[checks, tag]');
    // Explicit, because a default condition skips a job when ANY job upstream was skipped.
    expect(cond('release')).toBe("!cancelled() && needs.tag.result == 'success'");
    expect(needs('jsr')).toBe('[checks, release]');
    expect(cond('jsr')).toBe("!cancelled() && needs.release.result == 'success'");
    expect(needs('npm')).toBe('[checks, jsr, npm-build]');
    // Each write is its own script call, and the tag is made by CI, through the REST API.
    expect(runs(jobs['tag']!)).toEqual(['bun scripts/release/github.ts tag "$TAG"']);
    expect(runs(jobs['release']!)).toEqual(['bun scripts/release/github.ts release "$TAG"']);
    for (const job of ['tag', 'release']) {
      expect(jobs[job]).toMatch(/permissions:\n\s+contents: write\n/);
      expect(sparse(job)).toEqual([['/jsr.json', '/scripts/release/github.ts']]);
    }
    // `checks` decides first, and holds no write.
    expect(runs(jobs['checks']!)[0]).toBe('bun scripts/release/workflow.ts release-state');
    expect(jobs['checks']).not.toMatch(/: write/);
  });

  // Open-work 54 (2026-11-09; workspace correspondence C30 / C34). `id-token: write` IS the
  // publishing credential, and every step of a job that holds it can mint one, so those jobs
  // install nothing and run nothing from the dependency tree.
  /** Each job's text, by its key under `jobs:`. */
  const jobs: Record<string, string> = {};
  {
    const body = PUBLISH_YML.slice(PUBLISH_YML.indexOf('\njobs:\n') + 7);
    const parts = body.split(/^ {2}(?=[A-Za-z0-9_-]+:\s*$)/m).filter((p) => p.trim() !== '');
    for (const p of parts) {
      const key = /^([A-Za-z0-9_-]+):/.exec(p)?.[1];
      if (key !== undefined) jobs[key] = p;
    }
  }
  const credentialed = Object.keys(jobs).filter((k) => /id-token:\s*['"]?write/.test(jobs[k]!));
  /** One job's checkout steps' `sparse-checkout` path lists. */
  const sparse = (job: string) =>
    [...jobs[job]!.matchAll(/sparse-checkout: \|\n((?:\s+\/[^\n]*\n)+)/g)].map((m) =>
      m[1]!.trim().split(/\s+/)
    );

  it('reads the six jobs, two of them holding the credential', () => {
    expect(Object.keys(jobs).sort()).toEqual([
      'checks',
      'jsr',
      'npm',
      'npm-build',
      'release',
      'tag',
    ]);
    expect(credentialed.sort()).toEqual(['jsr', 'npm']);
  });

  it('a credentialed job installs nothing and runs only the registry script and the publish', () => {
    for (const job of credentialed) {
      // Every command, block lines included; anything not on this list fails.
      const r = runs(jobs[job]!);
      const allowed = (cmd: string) =>
        cmd === 'deno publish' ||
        /^bun scripts\/release\/registry\.ts [a-z-]+( |$)/.test(cmd) ||
        /^echo "uploaded=true" >> "\$GITHUB_OUTPUT"$/.test(cmd) ||
        /^npm publish "\$TARBALL" --ignore-scripts$/.test(cmd) ||
        // npm itself, an EXACT version, its install scripts off (review round 1, 2026-11-13)
        (job === 'npm' && /^npm install -g npm@\d+\.\d+\.\d+ --ignore-scripts$/.test(cmd)) ||
        (job === 'npm' && cmd === 'npm --version');
      expect(r.filter((c) => !allowed(c)), `${job}: run lines`).toEqual([]);
      // Only these actions run beside the credential, each pinned (checked below).
      const uses = [...jobs[job]!.matchAll(/uses: ([\w./-]+)@/g)].map((m) => m[1]);
      const ok = [
        'actions/checkout',
        'actions/setup-node',
        'actions/download-artifact',
        'denoland/setup-deno',
        'oven-sh/setup-bun',
      ];
      expect(uses.filter((u) => !ok.includes(u!)), `${job}: actions`).toEqual([]);
      // Every checkout is sparse and keeps no credential.
      const checkouts = jobs[job]!.split('uses: actions/checkout@').slice(1);
      expect(checkouts.length, `${job}: one checkout`).toBe(1);
      expect(checkouts[0]).toContain('persist-credentials: false');
      expect(checkouts[0]).toContain('sparse-checkout: |');
    }
  });

  it('the jsr job checks out exactly what jsr.json publishes, plus the registry script', () => {
    const include = (JSON.parse(fsx.readTextFileSync('jsr.json')) as {
      publish: { include: string[] };
    }).publish.include.map((p) => `/${p.replace(/\/\*\*.*$/, '/').replace(/\/\*\.json$/, '/')}`);
    // A directory already listed covers what is under it (`src/definitions/*.json` under `src/`).
    const want = [...new Set(include)].filter((p, _, all) =>
      !all.some((q) => q !== p && q.endsWith('/') && p.startsWith(q))
    ).sort();
    expect([...sparse('jsr')[0]!].sort()).toEqual(
      [...want, '/scripts/release/registry.ts'].sort(),
    );
    // …and the checks job rehearses `deno publish --dry-run` on that same tree.
    expect([...sparse('checks')[0]!].sort()).toEqual(want);
  });

  it('runs on uploaded, not on the publish exit, and writes uploaded BEFORE the upload', () => {
    const r = runs(jobs['jsr']!);
    const record = r.indexOf('echo "uploaded=true" >> "$GITHUB_OUTPUT"');
    expect(record, 'the jsr job records the upload attempt').toBeGreaterThanOrEqual(0);
    expect(record).toBeLessThan(r.indexOf('deno publish'));
    expect(jobs['jsr']).toMatch(/uploaded: \$\{\{ steps\.attempt\.outputs\.uploaded \}\}/);
    // npm runs on it, and the first thing it asks is whether JSR serves the version. (The page
    // comes BEFORE the publish since D1, so `release` no longer waits for JSR.)
    expect(jobs['npm']).toContain("needs.jsr.outputs.uploaded == 'true'");
    const acts = runs(jobs['npm']!).filter((c) => /registry\.ts|npm publish/.test(c));
    expect(acts[0], 'npm waits for JSR first').toMatch(/registry\.ts jsr-wait /);
  });

  it("asks both registries whether a NEW number is free BEFORE the tag and JSR's immutable step", () => {
    expect(runs(jobs['checks']!)).toContain('bun scripts/release/registry.ts free "$VERSION"');
    expect(jobs['checks']).toContain("if: steps.release.outputs.state == 'new'");
  });

  // The ref is `main` now, so no step may read a version out of GITHUB_REF_NAME.
  it('takes the version from checks, never from the ref name', () => {
    expect(code(PUBLISH_YML).filter((l) => /GITHUB_REF_NAME|github\.ref_name/.test(l)))
      .toEqual([]);
  });

  // 3.0.0's npm-build failed here on GitHub: npm does not create `--pack-destination`.
  it('npm-build creates the pack destination before npm pack writes into it', () => {
    const job = jobs['npm-build']!;
    const dest = /npm pack --pack-destination (\S+)/.exec(job)?.[1];
    expect(dest, 'npm pack names its destination').toBeDefined();
    const mk = job.indexOf(`mkdir -p ${dest}`);
    expect(mk, `mkdir -p ${dest}`).toBeGreaterThanOrEqual(0);
    expect(mk).toBeLessThan(job.indexOf('npm pack --pack-destination'));
  });

  // Review round 1 (2026-11-13): each of these could be removed with every test still green.
  /** One job's lines that are not comments, joined. */
  const live = (job: string) => code(jobs[job]!).join('\n');

  it('the jsr job: skips an upload JSR has, and reads provenance back AFTER the publish', () => {
    const r = runs(jobs['jsr']!);
    expect(r.indexOf('bun scripts/release/registry.ts jsr-has "$VERSION"')).toBeLessThan(
      r.indexOf('deno publish'),
    );
    expect(live('jsr')).toMatch(
      /if: steps\.jsr\.outputs\.present == 'false'\n\s+run: deno publish\n/,
    );
    expect(r.indexOf('bun scripts/release/registry.ts provenance jsr "$VERSION"'))
      .toBeGreaterThan(r.indexOf('deno publish'));
  });

  it('the npm job: checks the tarball, skips a version npm serves, reads provenance back', () => {
    const r = runs(jobs['npm']!);
    const at = (c: string) => r.indexOf(c);
    const tgz = at('bun scripts/release/registry.ts npm-tarball npm-pack "$VERSION"');
    const state = at('bun scripts/release/registry.ts npm-state "$VERSION"');
    const publish = at('npm publish "$TARBALL" --ignore-scripts');
    const prov = at('bun scripts/release/registry.ts provenance npm "$VERSION"');
    expect([tgz >= 0, tgz < publish, state < publish, prov > publish]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(live('npm')).toMatch(
      /if: steps\.state\.outputs\.state == 'free'\n(?:\s+env:\n\s+TARBALL: [^\n]+\n)?\s+run: npm publish/,
    );
  });

  it('checks: after release-state, every step runs only for a release', () => {
    const steps = live('checks').split(/\n\s+- name: /).slice(1);
    const after = steps.slice(steps.findIndex((s) => s.includes('release-state')) + 1);
    expect(after.length).toBeGreaterThan(5);
    for (const s of after) {
      expect(s, s.split('\n')[0]).toMatch(
        /\n\s+if: steps\.release\.outputs\.(release == 'true'|state == 'new')\n/,
      );
    }
    expect(runs(jobs['checks']!)).toContain('deno publish --dry-run');
  });

  it('no checkout keeps a credential; every job has a time limit; runs queue, never cancel', () => {
    const checkouts = PUBLISH_YML.split('uses: actions/checkout@').slice(1);
    expect(checkouts.length).toBeGreaterThan(5);
    for (const c of checkouts) {
      expect(c.split(/\n\s+- name: /)[0]).toContain('persist-credentials: false');
    }
    for (const job of Object.keys(jobs)) {
      expect(live(job), `${job}: timeout-minutes`).toMatch(/\n {4}timeout-minutes: \d+\n/);
    }
    expect(PUBLISH_YML).toMatch(
      /\nconcurrency:\n {2}group: publish-\$\{\{ github\.sha \}\}\n {2}cancel-in-progress: false\n/,
    );
  });

  it('the tools are exact versions: Bun as the repo pins it, Deno as scripts/deno.ts pins it', () => {
    const deno = /DENO = 'deno@(\d+\.\d+\.\d+)'/.exec(fsx.readTextFileSync('scripts/deno.ts'))?.[1];
    expect(deno).toBeDefined();
    const denoPins = [...PUBLISH_YML.matchAll(/deno-version: (\S+)/g)].map((m) => m[1]);
    expect(denoPins.length).toBe(2);
    expect(denoPins.every((p) => p === `v${deno}`)).toBe(true);
    const bunPins = [...PUBLISH_YML.matchAll(/bun-version: (\S+)/g)].map((m) => m[1]);
    expect(bunPins.length).toBeGreaterThan(4);
    expect(new Set(bunPins)).toEqual(new Set(["'1.4.4'"]));
  });

  it('pins every action to a commit hash', () => {
    const uses = [...PUBLISH_YML.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(10);
    expect(uses.filter((u) => !/@[0-9a-f]{40}$/.test(u))).toEqual([]);
  });
});
