/**
 * @module
 * wabt-ts — Native TypeScript port of WebAssembly/wabt.
 *
 * Provides WebAssembly tooling as idiomatic TypeScript modules with no binary
 * dependency. Runs natively on Deno (primary) and Bun (secondary).
 *
 * For CLI tools, import the named entry points directly:
 * - `jsr:@jrmarcum/wabt-ts/wat2wasm`
 * - `jsr:@jrmarcum/wabt-ts/wasm2wat`
 * - `jsr:@jrmarcum/wabt-ts/wasm-validate`
 * - `jsr:@jrmarcum/wabt-ts/wasm-objdump`
 * - `jsr:@jrmarcum/wabt-ts/wasm2ts`
 *
 * @example
 * ```ts
 * import { wat2wasm, wasm2wat } from "jsr:@jrmarcum/wabt-ts";
 * ```
 */

// Phase 1 — Core infrastructure
export * from './core/types.ts';
export * from './core/binary.ts';
export * from './core/result.ts';
export * from './core/feature.ts';
export * from './core/error.ts';
export * from './core/leb128.ts';
export * from './core/literal.ts';
export * from './core/opcode.ts';
