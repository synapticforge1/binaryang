/**
 * @module
 * wabt-ts IR — entry point for the `./ir/wabt-ts` subpath.
 *
 * Authored during the binaryang merge. wabt-ts had no `ir/index.ts` because its
 * IR reached consumers through the package root (`src/index.ts` re-exported
 * these six modules). binaryang's root is deliberately narrow — with two IRs
 * retained, a root that carried either one would read as "the IR" while meaning
 * one of them — so each IR needs its own explicitly named subpath, and this is
 * wabt-ts's.
 *
 * @license MIT
 */

export * from './ir.ts';
export * from './ir-util.ts';
export * from './expr-visitor.ts';
export * from './generate-names.ts';
export * from './resolve-names.ts';
export * from './apply-names.ts';
