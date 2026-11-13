/**
 * @module scripts/release/release-run
 *
 * What `bun run release` DOES, with everything it touches handed in — git, the two registries,
 * the cold checks — so the tests run every refusal and count what was mutated (review round 1,
 * 2026-11-13: the guards were held by reading `publish.ts`'s source, and removing most refusals
 * left every test green). `publish.ts` wires in the real ones.
 *
 * 🔒 The owner's order (2026-11-10, workspace letter H33, D1): this pushes `main` ONLY and makes
 * no tag; CI checks the commit, then tags it, then makes the page, then publishes.
 *
 * Every guard runs before the first mutation (`git add`). A command that fails is a refusal,
 * never "nothing there".
 *
 * @license MIT
 */

import { RELEASE_FILES, releaseBlockers } from './release-guard.ts';

/** What one git command answered. */
export interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Everything a release touches. */
export interface ReleaseDeps {
  /** The version `jsr.json` (and `main.ts`) now carry. */
  version: string;
  git(args: string[]): GitResult;
  jsrHas(version: string): Promise<boolean>;
  npmState(version: string): Promise<'free' | 'published' | 'burned'>;
  /** `deno publish --dry-run` in an EMPTY `DENO_DIR`: true when it passed. */
  coldDryRun(): boolean;
  /** `bun run check`: true when it passed. */
  typeCheck(): boolean;
  /** The package root as a working CLI: the problems found (none = fine). */
  entryProblems(): Promise<string[]>;
  log(line: string): void;
  error(line: string): void;
}

/** The git subcommands that change nothing but remote-tracking refs (`fetch`). */
export const READ_ONLY_GIT: ReadonlySet<string> = new Set([
  'status',
  'rev-parse',
  'fetch',
  'merge-base',
  'ls-remote',
  'diff',
]);

/** Runs the release; its exit code. */
export async function runRelease(d: ReleaseDeps): Promise<number> {
  const tag = `v${d.version}`;
  const refuse = (...lines: string[]): number => {
    for (const l of lines) d.error(l);
    return 1;
  };
  const git = (args: string[]): GitResult | null => {
    const r = d.git(args);
    if (r.status !== 0) {
      d.error(`git ${args.join(' ')} failed (exit ${r.status}): ${r.stderr.trim()}`);
      return null;
    }
    return r;
  };

  d.log(`Releasing ${tag}`);

  // 0. A clean tree, untracked files counted: the release commits RELEASE_FILES and nothing else,
  // and a JSR version cannot be replaced (T13.43).
  const status = git(['status', '--porcelain']);
  if (!status) return refuse(`Refusing to release ${tag}: git status failed.`);
  const dirty = releaseBlockers(status.stdout);
  if (dirty.length > 0) {
    return refuse(
      `Refusing to release ${tag}: the working tree is not clean.`,
      `  ${dirty.length} path(s) would be LEFT OUT of the release:`,
      ...dirty.slice(0, 10).map((l) => `    ${l}`),
      `  This script commits ${RELEASE_FILES.join(' and ')} only. Commit or stash the rest first.`,
    );
  }

  // 1. On `main`, holding everything GitHub's `main` has — and GitHub's TAGS, which CI makes now.
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch || branch.stdout.trim() !== 'main') {
    return refuse(
      `Refusing to release ${tag}: on '${branch?.stdout.trim() ?? '?'}', not 'main'. Merge first.`,
    );
  }
  // Not `-q`: git's reason for a refusal (a tag that moved upstream: "would clobber existing
  // tag") is printed only without it (review round 2, 2026-11-13: the message ended empty).
  if (!git(['fetch', '--tags', 'origin', 'main'])) {
    return refuse(`Refusing to release ${tag}: could not fetch main and the tags from origin.`);
  }
  if (d.git(['merge-base', '--is-ancestor', 'origin/main', 'HEAD']).status !== 0) {
    return refuse(
      `Refusing to release ${tag}: local main does not contain origin/main.`,
      '  Bring main up to date with GitHub first; a push here would be refused.',
    );
  }

  // 2. The tag exists NOWHERE: CI makes it (D1); one on origin means the version was released.
  const local = d.git(['rev-parse', '-q', '--verify', `refs/tags/${tag}`]);
  if (local.status === 0) {
    return refuse(
      `Refusing to release ${tag}: a LOCAL tag ${tag} exists. CI makes the tag;`,
      `  delete the local one (git tag -d ${tag}) if it was never pushed.`,
    );
  }
  if (local.status !== 1) {
    return refuse(`Refusing to release ${tag}: git could not read the local tags.`);
  }
  const remote = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  if (!remote) return refuse(`Refusing to release ${tag}: could not read origin's tags.`);
  if (remote.stdout.trim() !== '') {
    return refuse(
      `Refusing to release ${tag}: that tag already exists on origin.`,
      '  The version was released, or its run failed for a reason a new push will not change',
      '  ("Re-run failed jobs" on that run). Run `bun run bump <level>` for the next version.',
    );
  }

  // 3. Neither registry knows the number (npm never reuses one, C34 (2)). A failed read throws.
  const onJsr = await d.jsrHas(d.version);
  const onNpm = await d.npmState(d.version);
  if (onJsr || onNpm !== 'free') {
    return refuse(
      `Refusing to release ${tag}: JSR ${onJsr ? 'has it' : 'free'}, npm ${onNpm}. Bump again.`,
    );
  }

  // 4. COLD checks, as CI runs them, before anything is committed (binaryen-ts v1.2.4).
  if (!d.coldDryRun()) {
    return refuse(`Refusing to release ${tag}: the cold publish dry run failed.`);
  }
  if (!d.typeCheck()) return refuse(`Refusing to release ${tag}: the type check failed.`);
  const problems = await d.entryProblems();
  if (problems.length > 0) {
    return refuse(
      `Refusing to release ${tag}: the package root is not a working CLI.`,
      ...problems.map((p) => `  ${p}`),
    );
  }

  // 5. Something to push (review round 1, 2026-11-13): with the bump already committed AND on
  // GitHub, `git push` says "Everything up-to-date", the read-back equals HEAD, and the script
  // used to report a release that CI never received.
  const bumpPending = d.git(['diff', '--quiet', 'HEAD', '--', ...RELEASE_FILES]).status !== 0;
  const head = git(['rev-parse', 'HEAD']);
  const originMain = git(['rev-parse', 'origin/main']);
  if (!head || !originMain) return refuse(`Refusing to release ${tag}: git rev-parse failed.`);
  if (!bumpPending && head.stdout.trim() === originMain.stdout.trim()) {
    return refuse(
      `Refusing to release ${tag}: nothing to push — GitHub's main is already this commit.`,
      '  If its publish run failed, use "Re-run failed jobs" on that run; a push of nothing',
      '  starts no run.',
    );
  }

  // 6. Commit the bump (RELEASE_FILES, nothing else), push `main` ONLY, read it back.
  if (!git(['add', ...RELEASE_FILES])) return refuse(`Refusing to release ${tag}: git add failed.`);
  if (d.git(['diff', '--cached', '--quiet']).status !== 0) {
    if (!git(['commit', '-m', `bump to ${tag}`])) {
      return refuse(`Refusing to release ${tag}: git commit failed.`);
    }
  } else {
    d.log('(the bump is already committed — skipping commit)');
  }
  if (!git(['push', 'origin', 'main'])) return refuse(`The push of main was refused.`);
  const pushed = git(['rev-parse', 'HEAD'])?.stdout.trim();
  const back = git(['ls-remote', 'origin', 'refs/heads/main'])?.stdout.split(/\s/)[0];
  if (!pushed || back !== pushed) {
    return refuse(`The push did not read back: origin main is ${back}, HEAD is ${pushed}.`);
  }
  d.log(`Pushed main = ${pushed} (read back). publish.yml releases ${tag} from it.`);
  return 0;
}
