/**
 * @module
 * Branch hints are only for branches. A `metadata.code.branch_hint` section
 * lists, per function, the byte offset of each hinted instruction; the
 * instruction there must be an `if` or a `br_if`. The testsuite's
 * `custom/branch_hint.wast` calls a hint on anything else INVALID
 * (`assert_invalid_custom`, "invalid target").
 *
 * 🔧 Nothing checked it: `(@metadata.code.branch_hint "\01") i32.eq` assembled
 * and validated, its hint written into the section as if it meant something
 * (wasmtk, 2026-09-28, item 4). The reader keeps the section RAW, so the check
 * reads the bytes the hints point into: an offset is measured from the start
 * of the function body, just after its size (upstream's convention, and the
 * writer's). Only section framing and body sizes are read here — everything
 * else about the module comes from the reader (`funcImports`).
 *
 * @license MIT
 */

import { addError, type ErrorList } from '../core/error.ts';
import { CUSTOM_SECTION_NAME_CODE_METADATA } from '../core/binary.ts';

const BRANCH_HINT = `${CUSTOM_SECTION_NAME_CODE_METADATA}branch_hint`;
const IF = 0x04;
const BR_IF = 0x0d;
const CODE_SECTION = 10;
const CUSTOM_SECTION = 0;

/** A LEB128 u32 at `p`: its value and the position after it. */
function leb(b: Uint8Array, p: number): [value: number, next: number] {
  let r = 0, s = 0, x: number;
  do {
    if (p >= b.length) throw new RangeError('truncated LEB128');
    x = b[p++]!;
    r += (x & 0x7f) * 2 ** s;
    s += 7;
  } while (x & 0x80);
  return [r, p];
}

const at = (offset: number) => ({ filename: '', line: 0, column: 0, offset });

/**
 * Report every branch hint in `binary` whose instruction is not an `if` or a
 * `br_if`. `funcImports` is the number of imported functions (the reader's
 * count), so a hint's function index finds its body. A binary with no such
 * section is left alone; framing this cannot follow is the reader's to report.
 */
export function checkBranchHints(binary: Uint8Array, funcImports: number, errors: ErrorList): void {
  const bodies: { start: number; end: number }[] = [];
  const hints: { section: number; data: Uint8Array }[] = [];
  try {
    for (let p = 8; p < binary.length;) {
      const id = binary[p]!;
      const [size, body] = leb(binary, p + 1);
      const end = body + size;
      if (id === CODE_SECTION) {
        let [n, q] = leb(binary, body);
        for (; n > 0; n--) {
          const [len, r] = leb(binary, q);
          bodies.push({ start: r, end: r + len });
          q = r + len;
        }
      } else if (id === CUSTOM_SECTION) {
        const [nameLen, r] = leb(binary, body);
        const name = new TextDecoder().decode(binary.subarray(r, r + nameLen));
        if (name === BRANCH_HINT) {
          hints.push({ section: p, data: binary.subarray(r + nameLen, end) });
        }
      }
      p = end;
    }
  } catch {
    return;
  }

  for (const { section, data } of hints) {
    try {
      let [groups, q] = leb(data, 0);
      for (; groups > 0; groups--) {
        const [func, r] = leb(data, q);
        let [count, s] = leb(data, r);
        const body = bodies[func - funcImports];
        for (; count > 0; count--) {
          const [offset, t] = leb(data, s);
          const [len, u] = leb(data, t);
          s = u + len;
          const pos = body === undefined ? undefined : body.start + offset;
          const op = pos !== undefined && pos < body!.end ? binary[pos] : undefined;
          if (op !== IF && op !== BR_IF) {
            addError(
              errors,
              at(pos ?? section),
              `@${BRANCH_HINT} annotation: invalid target — function ${func}, offset ${offset} ` +
                'is not an `if` or a `br_if`',
            );
          }
        }
        q = s;
      }
    } catch {
      addError(errors, at(section), `${BRANCH_HINT} section: malformed`);
    }
  }
}
