// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module core/printable
 *
 * A name from a module, safe to print. A module's names are any UTF-8 the producer chose, and
 * printed raw they reach a terminal or a text file as instructions: an ESC starts a terminal
 * control sequence (clear the screen, recolour, rewrite a line), a line break forges a line of
 * the tool's own output, and a bidi override (U+202E) or a zero-width character shows text other
 * than what is there ("Trojan Source"). `wasm-objdump -x` printed five ESC bytes and a U+202E
 * from one hostile module (security review round 2, 2026-11-13); `wasm-interp` echoed an import's
 * name the same way, and `commentSafe` (WIT comments) let the bidi and zero-width ones through.
 *
 * Each such character is written `\uXXXX`: the name stays readable and unambiguous, and nothing
 * in it acts. A name without them is returned unchanged, so ordinary output is upstream's.
 *
 * @license MIT
 */

/** Whether code point `u` acts when printed instead of showing: what {@link printable} escapes. */
export function actsWhenPrinted(u: number): boolean {
  return u <= 0x1f || // C0, line breaks and ESC included
    (u >= 0x7f && u <= 0x9f) || // DEL and C1
    (u >= 0x200b && u <= 0x200f) || // zero-width space / joiners, LRM, RLM
    (u >= 0x2028 && u <= 0x202e) || // line and paragraph separators, bidi embeddings / overrides
    (u >= 0x2060 && u <= 0x2069) || // word joiner, invisible operators, bidi isolates
    u === 0xfeff; // zero-width no-break space (BOM)
}

/**
 * `name` with every character that acts when printed ({@link actsWhenPrinted}) written as a
 * `\uXXXX` escape. With `backslash`, a backslash is escaped too, so an escape in the output can
 * only have come from here (WIT comments need that; a listing does not).
 */
export function printable(
  name: string,
  opts: { backslash?: boolean; keepLines?: boolean } = {},
): string {
  let out = '';
  for (const c of name) {
    const u = c.codePointAt(0)!;
    const kept = opts.keepLines === true && (c === '\n' || c === '\t');
    const inert = kept || !(actsWhenPrinted(u) || (opts.backslash === true && c === '\\'));
    out += inert ? c : `\\u${u.toString(16).padStart(4, '0')}`;
  }
  return out;
}
