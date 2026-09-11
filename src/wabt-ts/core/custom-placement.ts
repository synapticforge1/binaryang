// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The placement of a custom section written in text — `(@custom "n" (after
 * code) "…")` — and its mapping to {@link Custom.precedingSection}, the known
 * section a custom section FOLLOWS in the binary. C2 (cmem/divergences.md).
 *
 * One table, read by the parser (text → anchor) and the WAT writer (anchor →
 * text), so the two cannot drift.
 */

import { BinarySection } from './binary.ts';

/**
 * The known sections in the one order a module lists them — the order the
 * binary writer emits them and custom sections are anchored against. The tag
 * section sits between memory and global; the data count between elem and code.
 */
export const SECTION_ORDER: readonly BinarySection[] = [
  BinarySection.Type,
  BinarySection.Import,
  BinarySection.Function,
  BinarySection.Table,
  BinarySection.Memory,
  BinarySection.Tag,
  BinarySection.Global,
  BinarySection.Export,
  BinarySection.Start,
  BinarySection.Elem,
  BinarySection.DataCount,
  BinarySection.Code,
  BinarySection.Data,
];

/**
 * The section keywords a placement may name. wasm-tools' set, plus wabt's
 * spelling `function` beside `func`; `datacount` is accepted by neither and is
 * not here — the position after it is `(before code)`.
 */
const SECTION_WORDS: ReadonlyMap<string, BinarySection> = new Map([
  ['type', BinarySection.Type],
  ['import', BinarySection.Import],
  ['func', BinarySection.Function],
  ['function', BinarySection.Function],
  ['table', BinarySection.Table],
  ['memory', BinarySection.Memory],
  ['tag', BinarySection.Tag],
  ['global', BinarySection.Global],
  ['export', BinarySection.Export],
  ['start', BinarySection.Start],
  ['elem', BinarySection.Elem],
  ['code', BinarySection.Code],
  ['data', BinarySection.Data],
]);

/**
 * The anchor a placement denotes: `null` for "before every known section",
 * else the known section the custom section follows. `undefined` when the word
 * is not a placement at all.
 *
 * `(before X)` is the position after the section that precedes X in
 * {@link SECTION_ORDER}; `(before first)` and `(before type)` are therefore the
 * same, and so are `(after last)` and `(after data)`.
 */
export function placementAnchor(
  where: 'before' | 'after',
  word: string,
): BinarySection | null | undefined {
  if (word === 'first') return where === 'before' ? null : undefined;
  if (word === 'last') return where === 'after' ? BinarySection.Data : undefined;
  const sec = SECTION_WORDS.get(word);
  if (sec === undefined) return undefined;
  if (where === 'after') return sec;
  const i = SECTION_ORDER.indexOf(sec);
  return i <= 0 ? null : SECTION_ORDER[i - 1]!;
}

/**
 * The text of a placement for `anchor`, spelled so BOTH upstream wat2wasm and
 * wasm-tools read it: each tool rejects some keywords (`first`, `last`, `tag`
 * and `func` / `function` split them), and every position has a spelling both
 * accept — `(before type)` for the very start, `(before table)` after the
 * function section, `(before global)` after tags, `(before code)` after the
 * data count. (Upstream wat2wasm then IGNORES the placement and appends; only
 * wasm-tools, and wabt-ts, put the section back where it was.)
 */
export function placementText(anchor: BinarySection | null): string {
  switch (anchor) {
    case null:
      return '(before type)';
    case BinarySection.Function:
      return '(before table)';
    case BinarySection.Tag:
      return '(before global)';
    case BinarySection.DataCount:
      return '(before code)';
    case BinarySection.Type:
      return '(after type)';
    case BinarySection.Import:
      return '(after import)';
    case BinarySection.Table:
      return '(after table)';
    case BinarySection.Memory:
      return '(after memory)';
    case BinarySection.Global:
      return '(after global)';
    case BinarySection.Export:
      return '(after export)';
    case BinarySection.Start:
      return '(after start)';
    case BinarySection.Elem:
      return '(after elem)';
    case BinarySection.Code:
      return '(after code)';
    case BinarySection.Data:
      return '(after data)';
    case BinarySection.Custom:
      // A custom section is never an anchor; the reader records the last
      // KNOWN section. Fail loud rather than print a placement that lies.
      throw new Error('a custom section cannot anchor another');
  }
}
