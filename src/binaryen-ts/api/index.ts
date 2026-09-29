/**
 * @module binaryen-ts/api
 *
 * High-level public API for `binaryen-ts`.
 *
 * This module exposes a unified, ergonomic interface for building, analyzing,
 * and optimizing WebAssembly modules. It is the recommended entry point for
 * application code — prefer this over importing from sub-modules directly.
 *
 * The API surface is intentionally modeled after `binaryen.js` to ease
 * migration from the upstream JavaScript bindings, but takes advantage of
 * TypeScript discriminated unions and const enums for compile-time safety.
 *
 * @example
 * ```ts
 * import { createModule, BinaryOp, ValType } from "@jrmarcum/binaryang/api";
 * import { writeFile } from "node:fs/promises";
 *
 * const mod = createModule((b) => {
 *   b.addFunction("add", [ValType.I32, ValType.I32], [ValType.I32], (e) =>
 *     e.return(e.binary(BinaryOp.AddI32, e.localGet(0), e.localGet(1)))
 *   );
 *   b.addExport("add", "add");
 * });
 *
 * const wasm = await mod.optimize("-Oz");
 * await writeFile("add.wasm", wasm);
 * ```
 *
 * ## Runtime support
 *
 * Every path (IR construction, writing, the pass pipeline) is binaryang's own
 * TypeScript and runs on Deno, Node 18+, Bun, and any modern browser. It calls
 * no external tool: the hybrid mode that handed `optimize()` to an upstream
 * `wasm-opt` subprocess left the product at 1.7.0 for the comparison suite.
 *
 * @license MIT
 */

import {
  type BinaryOp,
  type Expression,
  makeBinary,
  makeBlock,
  makeDrop,
  makeF32Const,
  makeF64Const,
  makeI32Const,
  makeI64Const,
  makeIf,
  makeLocalGet,
  makeLocalSet,
  makeLocalTee,
  makeNop,
  makeReturn,
  makeUnary,
  makeUnreachable,
  type UnaryOp,
} from '../ir/expressions.ts';
import { ModuleBuilder, type WasmModule } from '../ir/module.ts';
import { ValType } from '../ir/types.ts';
import { writeWasm, writeWat } from '../ir/write-wasm.ts';
import { PassRunner } from '../passes/index.ts';
import { varIndex } from '../../wabt-ts/ir/ir.ts';

// ---------------------------------------------------------------------------
// Expression builder (fluent helper passed to function body closures)
// ---------------------------------------------------------------------------

/**
 * Fluent expression builder.
 * An instance is passed to the callback in {@link FunctionBodyBuilder}
 * so function bodies can be written in a readable, composable style.
 */
export class ExprBuilder {
  /** `i32` constant. */
  i32(v: number): Expression {
    return makeI32Const(v);
  }
  /** `i64` constant. */
  i64(v: bigint): Expression {
    return makeI64Const(v);
  }
  /** `f32` constant. */
  f32(v: number): Expression {
    return makeF32Const(v);
  }
  /** `f64` constant. */
  f64(v: number): Expression {
    return makeF64Const(v);
  }
  /** `local.get` — reads local at `index`. */
  localGet(index: number, type: ValType = ValType.I32): Expression {
    return makeLocalGet(varIndex(index), type);
  }
  /** `local.set` — writes `value` to local at `index`. */
  localSet(index: number, value: Expression): Expression {
    return makeLocalSet(varIndex(index), value);
  }
  /** `local.tee` — writes `value` to local at `index` and forwards the value. */
  localTee(index: number, value: Expression, type: ValType): Expression {
    return makeLocalTee(varIndex(index), value, type);
  }
  /** Binary operation. */
  binary(opcode: BinaryOp, left: Expression, right: Expression): Expression {
    return makeBinary(opcode, left, right);
  }
  /** Unary operation. */
  unary(opcode: UnaryOp, value: Expression): Expression {
    return makeUnary(opcode, value);
  }
  /** `if` expression. */
  if(cond: Expression, then: Expression, else_?: Expression): Expression {
    return makeIf(cond, then, else_ ?? null);
  }
  /** `block` expression. */
  block(children: Expression[], name?: string): Expression {
    return makeBlock(children, name ?? null);
  }
  /** `return` expression. */
  return(value?: Expression): Expression {
    return makeReturn(value ? [value] : []);
  }
  /** `drop` — discard a value. */
  drop(value: Expression): Expression {
    return makeDrop(value);
  }
  /** `nop` — no-operation. */
  nop(): Expression {
    return makeNop();
  }
  /** `unreachable` — marks a point as never reached. */
  unreachable(): Expression {
    return makeUnreachable();
  }
}

// ---------------------------------------------------------------------------
// Module wrapper with optimization methods
// ---------------------------------------------------------------------------

/**
 * A compiled {@link WasmModule} with optimization and serialization methods.
 */
export class Module {
  private readonly _inner: WasmModule;

  /** @internal */
  constructor(inner: WasmModule) {
    this._inner = inner;
  }

  /** The underlying raw IR module. */
  get ir(): WasmModule {
    return this._inner;
  }

  /**
   * Optimizes the module and returns the WASM binary bytes.
   *
   * @param flags - Optimization preset (e.g. `"-Oz"`, `"-O3"`).
   */
  optimize(flags = '-Oz'): Promise<Uint8Array> {
    // Parse the optimization level out of `flags` (`-O0`..`-O4`, `-Os`, `-Oz`),
    // matching `wasm-opt`'s convention. Previously `optimizeLevel` was hardcoded
    // to 2, so `optimize("-O0")` / `"-O1"` / `"-O3"` all ran the level-2 pipeline.
    const tok = /-O([0-4sz])/.exec(flags)?.[1];
    const optimizeLevel: 0 | 1 | 2 | 3 | 4 = tok === 'z' || tok === 's'
      ? 2
      : tok !== undefined
      ? (Number(tok) as 0 | 1 | 2 | 3 | 4)
      : 2;
    const shrinkLevel: 0 | 1 | 2 = tok === 'z' ? 2 : tok === 's' ? 1 : 0;
    const runner = new PassRunner(this._inner, { optimizeLevel, shrinkLevel });
    if (optimizeLevel > 0 || shrinkLevel > 0) {
      runner.addDefaultOptimizationPasses();
    }
    runner.run();
    return Promise.resolve(this.toBinary());
  }

  /**
   * Serializes the module to WAT text format.
   * @returns WAT text as a string.
   */
  toWat(): string {
    return writeWat(this._inner);
  }

  /**
   * Serializes the module to binary WASM.
   * @returns Binary WASM bytes.
   */
  toBinary(): Uint8Array {
    return writeWasm(this._inner);
  }
}

// ---------------------------------------------------------------------------
// createModule — primary factory
// ---------------------------------------------------------------------------

/**
 * Callback type for the {@link createModule} body builder.
 * Receives a {@link ModuleBuilder} for defining functions, globals, etc.
 */
export type ModuleBodyBuilder = (builder: ModuleBuilder, expr: ExprBuilder) => void;

/**
 * Creates a {@link Module} using a fluent builder callback.
 *
 * This is the primary factory function for application code.
 *
 * @param body - Callback that populates the module via the provided {@link ModuleBuilder}.
 * @returns A {@link Module} ready for optimization or serialization.
 *
 * @example
 * ```ts
 * import { createModule, BinaryOp, ValType } from "@jrmarcum/binaryang/api";
 *
 * const mod = createModule((b, e) => {
 *   b.addFunction("square", [ValType.I32], [ValType.I32],
 *     e.return(e.binary(BinaryOp.MulI32, e.localGet(0), e.localGet(0)))
 *   );
 *   b.addExport("square", "square");
 * });
 * ```
 */
export function createModule(body: ModuleBodyBuilder): Module {
  const builder = new ModuleBuilder();
  const expr = new ExprBuilder();
  body(builder, expr);
  return new Module(builder.build());
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { BinaryOp, UnaryOp } from '../ir/expressions.ts';
export { ExpressionKind } from '../ir/expressions.ts';
export { ModuleBuilder } from '../ir/module.ts';
export {
  isFloat,
  isInteger,
  isRef,
  None,
  typeToString,
  Unreachable,
  ValType,
} from '../ir/types.ts';
export type { Expression, Literal } from '../ir/expressions.ts';
export type {
  Local,
  WasmExport,
  WasmFunction,
  WasmGlobal,
  WasmImport,
  WasmModule,
} from '../ir/module.ts';
export type { Type } from '../ir/types.ts';
