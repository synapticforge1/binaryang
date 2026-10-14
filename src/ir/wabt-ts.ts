/**
 * @module
 * wabt-ts IR.
 *
 * An internal barrel since open-work 25 (2026-10-14): `./ir/wabt-ts` was a published subpath until
 * 1.11.0 (deprecated there) and is not one now. `@jrmarcum/binaryang/ir` re-exports everything
 * here, under the same names.
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
// Whether a name is REAL or one a reader made up (owner decision 4; M7c3b b1b).
export { isRealName } from './made-up-names.ts';
export * from './resolve-names.ts';
export * from './apply-names.ts';
