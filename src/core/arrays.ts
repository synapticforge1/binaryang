// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module core/arrays
 *
 * Appending one array to another without a spread.
 *
 * `dst.push(...src)` passes every element as an ARGUMENT, and V8 (Node, Deno) runs out of call
 * stack at some tens of thousands of them; JavaScriptCore (Bun) goes further. So on Node and Deno
 * one flat function of 300,000 instructions was refused as "nests deeper than this tool can
 * follow" — though it nests not at all — while Bun read it (security review round 1,
 * 2026-11-13; the parser spread a block's statements into its parent). Every append whose length
 * the input decides goes through {@link pushAll}; `tests/.../no_argument_spread.test.ts` keeps
 * `.push(...)` and `.splice(…, ...)` out of `src/`.
 *
 * @license MIT
 */

/** Appends every element of `src` to `dst`, in order, with no limit on how many. */
export function pushAll<T>(dst: T[], src: readonly T[]): void {
  for (let i = 0; i < src.length; i++) dst.push(src[i]!);
}

/** Replaces the whole contents of `dst` with `src`'s, in place. */
export function replaceAll<T>(dst: T[], src: readonly T[]): void {
  if (dst === src) return;
  dst.length = 0;
  pushAll(dst, src);
}
