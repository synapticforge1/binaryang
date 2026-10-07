// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * Diagnostic usefulness — "can a user ACT on the message?" — measured over the
 * spec testsuite's must-reject cases, as the CLI would print them.
 *
 * ## Why this exists
 *
 * Two diagnostic axes were measured before it: WORDING (does our message
 * match the spec's expected text — `deno task spec`'s agreement counts) and
 * OFFSETS (A3, `deno task offsets`: where the binary reader points). Neither
 * asks whether the printed line tells a user what to fix, and the first probe
 * of that (2026-09-29) found every binary diagnostic printed at `file:0:0`,
 * because the renderer chose text coordinates whenever a filename was set —
 * with both earlier measurements green. They read `loc` fields; a user reads
 * the RENDERED line. So this reads the rendered line.
 *
 * ## Method
 *
 * Every must-reject case goes through the tool a user would run, with a
 * filename, exactly as the CLI renders it (`formatErrors`):
 *
 * | case                                | tool                                   |
 * | ----------------------------------- | -------------------------------------- |
 * | `assert_malformed` text             | `wat2wasm`                             |
 * | `assert_invalid` / malformed binary | `wasm-validate`                        |
 * | `assert_invalid` given as TEXT      | `wat2wasm`, then `wasm-validate`       |
 *
 * and the FIRST error line is scored on four mechanical properties:
 *
 * - **located** — the rendered location points somewhere: `line:col` not
 *   `0:0` for text, a non-zero offset for a binary. A diagnostic with no
 *   position makes the user bisect the input by hand.
 * - **named** — the message names its subject rather than a placeholder
 *   (`type mismatch in opcode` where the instruction was `i32.add`).
 * - **clean** — no implementation detail leaks into it: `undefined`,
 *   `[object …]`, a JS error class, an `<opcode:0x…>` fallback name.
 * - **alone** — after a DECODE failure, nothing further is reported. The
 *   validator run over a half-decoded module invents errors about code that
 *   was never read, and the real one scrolls away.
 *
 * Plus two outcomes that are worse than any message: the tool THREW instead of
 * reporting, or a text module the spec calls invalid went through `wat2wasm`
 * with NO diagnostic (it does not validate — a known, separate question).
 *
 * ## What this does NOT measure
 *
 * Whether the message is RIGHT (the spec harness's agreement counts), or
 * whether its wording is the clearest one possible — that needs a person. The
 * `--templates` roster groups messages by shape (numbers, quoted tokens and
 * type lists normalised) so a person can read 2,000 messages as ~200.
 * Reported, not gated.
 *
 * ```sh
 * deno task diagnostics <manifest-dir>               # summary (see deno task spec:prepare)
 * deno task diagnostics <manifest-dir> --templates   # plus every message shape, by count
 * ```
 */

import { formatErrors, hasErrors, makeErrorList } from '../src/wabt-ts/core/error.ts';
import { readBinaryIr } from '../src/wabt-ts/reader/binary-reader-ir.ts';
import type { ErrorList } from '../src/wabt-ts/core/error.ts';
import { suiteFeatures } from './proposals.ts';
import { wat2wasm } from '../src/wabt-ts/tools/wat2wasm.ts';
import { wasmValidate } from '../src/wabt-ts/tools/wasm-validate.ts';

/** The spec harness's feature set, for the same reason (see spec-testsuite.ts). */
const FEATURES = suiteFeatures('');

/** A subject the message should have named, standing in for it. */
const PLACEHOLDER = /\bin (opcode|ternary|quaternary|load_splat|load_zero)\b|<opcode:0x/;

/**
 * Implementation detail that means nothing to a user. A bare `undefined` is a
 * JS value printed; `undefined label $l` is the wording, so an `undefined`
 * followed by a word is not a leak.
 */
const LEAK =
  /\bundefined\b(?! [a-z$])|\[object |\bNaN\b|TypeError|RangeError|ReferenceError|Cannot read prop|is not a function|<opcode:0x/;

type Stage = 'parse' | 'decode' | 'validate' | 'threw' | 'silent';

interface Scored {
  where: string;
  stage: Stage;
  line: string;
  located: boolean;
  named: boolean;
  clean: boolean;
  /** Errors reported after a decode failure; 0 when the first error was not a decode one. */
  cascade: number;
  /** The first message CONTAINS the spec's expected text (wording agreement, T13.37/38). */
  agrees?: boolean;
}

/**
 * Whether the rendered header `<file>:<loc>: error: …` carries a position.
 * Text renders `line:col`; a binary renders a hex offset (upstream's
 * `file:0000025:`) or, with no filename, `<binary>:0x…`.
 */
export function isLocated(rendered: string): boolean {
  const m = /:(?:(\d+):(\d+)|(?:0x)?([0-9a-f]+)): (?:error|warning): /.exec(rendered);
  if (m === null) return false;
  if (m[1] !== undefined) return Number(m[1]) > 0 && Number(m[2]) > 0;
  return parseInt(m[3]!, 16) > 0;
}

function score(where: string, stage: Stage, errors: ErrorList, decodeFailed: boolean): Scored {
  const rendered = formatErrors(errors).split('\n').filter((l) => / error: /.test(l));
  const line = rendered[0] ?? '';
  const message = line.replace(/^.*? error: /, '');
  return {
    where,
    stage,
    line,
    located: isLocated(line),
    named: !PLACEHOLDER.test(message),
    clean: !LEAK.test(message),
    cascade: decodeFailed ? rendered.length - 1 : 0,
  };
}

function viaValidate(where: string, bytes: Uint8Array, name: string): Scored {
  try {
    const { errors } = wasmValidate(bytes, { filename: name, features: FEATURES });
    // The reader runs first, so the tool's output leads with the reader's
    // errors whenever there are any: that is a decode failure.
    const decodeErrors = makeErrorList();
    readBinaryIr(bytes, decodeErrors);
    const decodeFailed = hasErrors(decodeErrors);
    return score(where, decodeFailed ? 'decode' : 'validate', errors, decodeFailed);
  } catch (e) {
    return threw(where, e);
  }
}

function threw(where: string, e: unknown): Scored {
  const line = `THREW: ${e instanceof Error ? e.message : String(e)}`;
  return { where, stage: 'threw', line, located: false, named: false, clean: false, cascade: 0 };
}

function viaWat2wasm(where: string, text: string, thenValidate: boolean): Scored {
  try {
    const r = wat2wasm(text, { filename: 'm.wat' });
    if (hasErrors(r.errors)) return score(where, 'parse', r.errors, false);
    if (!thenValidate) {
      return {
        where,
        stage: 'silent',
        line: '',
        located: false,
        named: false,
        clean: false,
        cascade: 0,
      };
    }
    const v = viaValidate(where, r.binary, 'm.wasm');
    // wat2wasm said nothing; the user needed a second tool to hear about it.
    return v.stage === 'validate' ? { ...v, stage: 'silent' } : v;
  } catch (e) {
    return threw(where, e);
  }
}

interface Command {
  type: string;
  line: number;
  filename?: string;
  module_type?: string;
  /** The spec's expected message. */
  text?: string;
}

if (import.meta.main) {
  const dirArg = Deno.args.find((a) => !a.startsWith('--'));
  const templates = Deno.args.includes('--templates');
  if (dirArg === undefined) {
    console.error('usage: measure-diagnostics.ts <manifest-dir> [--templates]');
    Deno.exit(2);
  }

  const rows: Scored[] = [];
  for await (const dir of Deno.readDir(dirArg)) {
    if (!dir.isDirectory) continue;
    const dirOf = `${dirArg}/${dir.name}`;
    let manifest: { commands: Command[] };
    try {
      manifest = JSON.parse(await Deno.readTextFile(`${dirOf}/${dir.name}.json`));
    } catch {
      continue;
    }
    for (const cmd of manifest.commands) {
      if (!cmd.filename) continue;
      const where = `${dir.name}.wast:${cmd.line}`;
      const path = `${dirOf}/${cmd.filename}`;
      let row: Scored;
      if (cmd.type === 'assert_invalid') {
        row = cmd.module_type === 'text'
          ? viaWat2wasm(where, await Deno.readTextFile(path), true)
          : viaValidate(where, await Deno.readFile(path), 'm.wasm');
      } else if (cmd.type === 'assert_malformed') {
        row = cmd.module_type === 'binary'
          ? viaValidate(where, await Deno.readFile(path), 'm.wasm')
          : viaWat2wasm(where, await Deno.readTextFile(path), false);
      } else {
        continue;
      }
      if (cmd.text !== undefined) row.agrees = row.line.includes(cmd.text);
      rows.push(row);
    }
  }

  report(rows, templates);
}

function report(rows: Scored[], templates: boolean): void {
  const stages: Stage[] = ['parse', 'decode', 'validate', 'silent', 'threw'];
  const pct = (a: number, b: number) => (b === 0 ? '    -' : `${((100 * a) / b).toFixed(1)}%`);
  console.log(
    `\n  Diagnostic usefulness — ${rows.length} must-reject cases, as the CLI prints them\n`,
  );
  console.log('  stage       cases   located   named   clean   cascades   spec wording');
  for (const s of stages) {
    const r = rows.filter((x) => x.stage === s);
    if (r.length === 0) continue;
    const n = (f: (x: Scored) => boolean) => r.filter(f).length;
    const worded = r.filter((x) => x.agrees !== undefined);
    console.log(
      `  ${s.padEnd(10)}${String(r.length).padStart(6)}  ${
        pct(n((x) => x.located), r.length).padStart(7)
      }` +
        `  ${pct(n((x) => x.named), r.length).padStart(6)}  ${
          pct(n((x) => x.clean), r.length).padStart(6)
        }` +
        `  ${String(n((x) => x.cascade > 0)).padStart(8)}` +
        `   ${String(n((x) => x.agrees === true)).padStart(5)} / ${worded.length}`,
    );
  }

  const flagged: [string, Scored[]][] = [
    ['NOT LOCATED', rows.filter((x) => !x.located && x.stage !== 'silent' && x.stage !== 'threw')],
    [
      'PLACEHOLDER subject',
      rows.filter((x) => !x.named && x.stage !== 'silent' && x.stage !== 'threw'),
    ],
    [
      'LEAKS internals',
      rows.filter((x) => !x.clean && x.stage !== 'silent' && x.stage !== 'threw'),
    ],
    ['CASCADE after a decode error', rows.filter((x) => x.cascade > 0)],
    ['THREW instead of reporting', rows.filter((x) => x.stage === 'threw')],
    ['SILENT at wat2wasm (spec: invalid)', rows.filter((x) => x.stage === 'silent')],
  ];
  console.log();
  for (const [label, list] of flagged) {
    console.log(`  ${String(list.length).padStart(5)}  ${label}`);
    for (const [shape, hits] of byShape(list).slice(0, 4)) {
      console.log(`           ${String(hits.length).padStart(4)}x ${shape.slice(0, 80)}`);
      console.log(`                 e.g. ${hits[0]!.where}`);
    }
  }

  if (templates) {
    for (const s of stages) {
      const shapes = byShape(rows.filter((x) => x.stage === s && x.line !== ''));
      if (shapes.length === 0) continue;
      console.log(`\n  ${s}: ${shapes.length} message shapes`);
      for (const [shape, hits] of shapes) {
        console.log(`    ${String(hits.length).padStart(4)}x ${shape.slice(0, 110)}`);
      }
    }
  }
  console.log('\n  Reported, not gated. Mechanical properties only: wording needs a person.\n');
}

/** Rows grouped by message SHAPE — numbers, quoted tokens and type lists normalised. */
export function shapeOf(line: string): string {
  return line
    .replace(/^.*? error: /, '')
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\[[^\]]*\]/g, '[…]')
    .replace(/\b0x[0-9a-f]+\b/gi, 'N')
    .replace(/\b\d+\b/g, 'N');
}

function byShape(rows: Scored[]): [string, Scored[]][] {
  const m = new Map<string, Scored[]>();
  for (const r of rows) {
    const k = shapeOf(r.line);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return [...m].sort((a, b) => b[1].length - a[1].length);
}
