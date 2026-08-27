/**
 * @module binaryen-ts/ir
 *
 * Re-exports all public IR symbols from sub-modules.
 *
 * This is the primary entry point for the IR layer. Import from
 * `@jrmarcum/binaryang/ir/binaryen-ts` for access to types, expressions, and the module
 * builder.
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
 * } from "@jrmarcum/binaryang/ir/binaryen-ts";
 *
 * const mod = new ModuleBuilder()
 *   .addFunction("add", [ValType.I32, ValType.I32], [ValType.I32],
 *     makeReturn(makeBinary(BinaryOp.AddI32, makeLocalGet(0, ValType.I32), makeLocalGet(1, ValType.I32)))
 *   )
 *   .addExport("add", "add")
 *   .build();
 * ```
 *
 * @license MIT
 */

export * from './gc-types.ts';
export * from './types.ts';
export * from './expressions.ts';
export * from './module.ts';
