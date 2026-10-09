/**
 * @module ir/binaryen-ts
 *
 * ⚠️ **Deprecated since 1.11.0 — import from `@jrmarcum/binaryang/ir`**, which
 * exports everything this subpath does (and `./ir/wabt-ts` and `./core/wabt-ts`
 * with it). This subpath stays for one release and is removed in a later minor.
 * One name differs: the union of a node's `type` field, which this subpath also
 * calls `Type`, is `ExprType` there — `Type` in `./ir` is core's value-type enum.
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
/**
 * @deprecated Use `ExprType` — the same type. `Type` is core's value-type enum in
 * `@jrmarcum/binaryang/ir`; this alias goes with this subpath.
 */
export type { ExprType as Type } from './ir.ts';
export * from './expressions.ts';
export * from './memory-access.ts';
export * from './module.ts';
