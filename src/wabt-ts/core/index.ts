/**
 * @module
 * wabt-ts core vocabulary — entry point for the `./core/wabt-ts` subpath.
 *
 * Authored during the binaryang merge, to close a gap the narrow root created.
 *
 * Every wabt tool returns a result expressed in these types — `wat2wasm` hands
 * back `{ binary, errors, result }`, and a caller cannot interpret that without
 * `Result`, `ErrorList` and `formatErrors`. They used to reach consumers through
 * wabt-ts's package root, which re-exported the whole tree. binaryang's root is
 * deliberately narrow (two IRs are retained, and a root barrel spanning both
 * would surface 56 colliding type names), so the vocabulary needed a named
 * subpath of its own or it would have become unreachable.
 *
 * Deliberately NOT the whole of `core/`: this is the surface the published tool
 * subpaths oblige us to expose, not everything that happens to live here.
 *
 * @license MIT
 */

export * from './result.ts';
export * from './error.ts';
