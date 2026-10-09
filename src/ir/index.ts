// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The IR — entry point for the `@jrmarcum/binaryang/ir` subpath.
 *
 * ONE IR, one subpath (open-work 21, phase 4, owner 2026-10-09). It exports
 * everything the three subpaths it replaces exported — `./ir/wabt-ts`,
 * `./ir/binaryen-ts` and `./core/wabt-ts` — which stay for one release,
 * deprecated, and are removed in a later minor:
 *
 * - the IR's records under their own names (`Expr`, `Module`, `Func`, …) and
 *   under binaryen-ts's (`Expression`, `WasmModule`, `WasmFunction`, …) — the
 *   SAME types, one declaration each;
 * - the expression factories (`makeI32Const`, `makeBinary`, …), the module
 *   builder, the value and GC types, naming and resolution, the visitor;
 * - the core vocabulary every tool's result is written in (`Result`,
 *   `ErrorList`, `formatErrors`, the feature sets).
 *
 * **One name changed meaning.** `Type` is core's value-type ENUM (`Type.I32`),
 * as in `./ir/wabt-ts`. binaryen-ts's `Type` — the union a node's `type` field
 * holds — is `ExprType` here, the same type under the IR's name.
 *
 * @example
 * ```ts
 * import {
 *   BinaryOp,
 *   makeBinary,
 *   makeLocalGet,
 *   makeReturn,
 *   ModuleBuilder,
 *   ValType,
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

export * from './wabt-ts.ts';
export * from './binaryen-ts.ts';
export * from '../core/index.ts';
// Two of the stars above export a `Type`: core's enum (through ./wabt-ts.ts) and
// binaryen-ts's deprecated alias of `ExprType` (through ./binaryen-ts.ts). An
// explicit export wins over every star export, so here `Type` is the enum.
export { Type } from '../core/types.ts';
