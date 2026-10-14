/**
 * @module ir/binaryen-ts
 *
 * An internal barrel since open-work 25 (2026-10-14): `./ir/binaryen-ts` was a published subpath until
 * 1.11.0 (deprecated there) and is not one now. `@jrmarcum/binaryang/ir` re-exports everything
 * here, under the same names.
 * The union of a node's `type` field is `ExprType`; `Type` in `./ir` is core's value-type enum.
 *
 * Re-exports binaryen-ts's view of the IR: the expression factories, the module
 * builder, the value and GC types.
 *
 * @example
 * ```ts
 * import {
 *   ValType,
 *   ModuleBuilder,
 *   BinaryOp,
 *   makeI32Const,
 *   makeLocalGet,
 *   makeBinary,
 *   makeReturn,
 *   varIndex,
 * } from "@jrmarcum/binaryang/ir";
 *
 * const mod = new ModuleBuilder()
 *   .addFunction("add", [ValType.I32, ValType.I32], [ValType.I32],
 *     makeReturn(makeBinary(
 *       BinaryOp.AddI32,
 *       makeLocalGet(varIndex(0), ValType.I32),
 *       makeLocalGet(varIndex(1), ValType.I32),
 *     ))
 *   )
 *   .addExport("add", "add")
 *   .build();
 * ```
 *
 * @license MIT
 */

export * from './gc-types.ts';
export * from './types.ts';
// The union a node's `type` field holds — declared once, as `ExprType`, in ./ir.ts.
export type { ExprType } from './ir.ts';
export * from './expressions.ts';
export * from './memory-access.ts';
export * from './module.ts';
