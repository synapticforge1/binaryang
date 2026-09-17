// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/ir.h, src/ir.cc
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * WebAssembly IR (Intermediate Representation).
 *
 * Expressions are tree-structured discriminated unions — each node embeds its
 * operand children as typed fields. This differs from the C++ wabt IR (which
 * uses a flat ExprList), but is required for WAT s-expression output and the
 * binaryen bridge (both are bottom-up / tree-order).
 *
 * The stack-to-tree conversion happens during binary decode: maintain an
 * operand stack, push leaf nodes, pop operands when building composites.
 */

import type { Location } from '../core/error.ts';
import { unknownLocation } from '../core/error.ts';
import { Type, typeName, type ValType } from '../core/types.ts';
import type { AbstractHeap, Index } from '../core/types.ts';
import { BinarySection, ExternalKind } from '../core/binary.ts';
import { GcOpcode, Opcode, PREFIX_GC } from '../core/opcode.ts';
import { FidelityTable } from './fidelity.ts';
import type { NodeId } from './fidelity.ts';

// Re-export so consumers can import everything from this module.
export { Opcode };
export { ExternalKind };
export { Type };

// ---------------------------------------------------------------------------
// Var — reference to a named or indexed entity
// ---------------------------------------------------------------------------

/** A reference to a function, local, global, label, etc. by index or name. */
export type Var =
  | { readonly kind: 'index'; readonly value: Index }
  | { readonly kind: 'name'; readonly name: string };

/** Construct an index-form {@link Var} (`0`, `1`, …) used after `resolveNames`. */
export function varIndex(value: Index): Var {
  return { kind: 'index', value };
}
/** Construct a name-form {@link Var} (`$foo`, `$bar`) as emitted by the WAT parser. */
export function varName(name: string): Var {
  return { kind: 'name', name };
}

/**
 * Build a {@link Var} from a WAT reference TOKEN: a bare integer is an index,
 * anything else is a name.
 *
 * 🔑 This is where the two forms are told apart — at the TEXT boundary, once,
 * rather than in a field that carries both meanings. A WAT identifier always
 * begins with `$`, so the cases cannot collide.
 *
 * ⚠️ Not optional. `(export "f" (func 19))` is as legal as `(func $g)`, and our
 * own `wasm2wat` emits the numeric form — before the encoder handled it,
 * re-parsing our own disassembly failed on 310 of 421 corpus modules. Wrapping
 * such a token with {@link varName} produces a name-form var that no name table
 * contains, which is the same defect wearing a different hat.
 */
export function varFromToken(token: string): Var {
  return /^[0-9]+$/.test(token) ? varIndex(Number(token)) : varName(token);
}

// ---------------------------------------------------------------------------
// Heap type references
// ---------------------------------------------------------------------------

/**
 * A heap type as written: one of the twelve ABSTRACT types, or a reference to
 * a defined type by index or by name.
 *
 * 🔑 **Why this is not just a {@link Var}.** It used to be one, with the name
 * arm doing double duty: `{kind:'name', name:'func'}` meant the abstract type
 * `func`, while `{kind:'name', name:'$T'}` meant an unresolved user type. The
 * two were told apart by looking the string up in the keyword table — so the
 * TYPE said "a name", and only a table lookup said which KIND of name, with
 * `$`-prefixing as the informal convention holding it together.
 *
 * That is one field carrying two meanings, which is the hazard this codebase
 * polices hardest. Making the abstract case its own arm means the discriminant
 * answers the question, and `resolveNames` has nothing to do for an abstract
 * type because it is not a reference to anything.
 *
 * The index and name arms are exactly {@link Var}, so everything that already
 * handles a `Var` — `requireIndex`, `sameVar`, name resolution — applies to a
 * defined-type reference unchanged.
 */
export type HeapTypeRef =
  | { readonly kind: 'abstract'; readonly name: AbstractHeap }
  | Var;

/** Construct an abstract heap type (`func`, `i31`, `extern`, …). */
export function heapAbstract(name: AbstractHeap): HeapTypeRef {
  return { kind: 'abstract', name };
}

/** Whether a heap type is one of the twelve abstract types. */
export function isAbstractHeap(
  h: HeapTypeRef,
): h is { kind: 'abstract'; name: AbstractHeap } {
  return h.kind === 'abstract';
}

/**
 * The {@link Var} arm of a heap type, or `undefined` for an abstract type.
 *
 * Callers that resolve or renumber DEFINED types use this: an abstract type is
 * not a reference and must not be resolved, which the old shape could not say.
 */
export function heapVar(h: HeapTypeRef): Var | undefined {
  return h.kind === 'abstract' ? undefined : h;
}

/** Whether two heap type references denote the same type. */
export function sameHeap(a: HeapTypeRef, b: HeapTypeRef): boolean {
  if (a.kind === 'abstract' || b.kind === 'abstract') {
    return a.kind === 'abstract' && b.kind === 'abstract' && a.name === b.name;
  }
  return sameVar(a, b);
}

/**
 * The index a resolved {@link Var} holds, or a loud failure.
 *
 * ⚠️ **Nine places used to extract this by hand, with FOUR different answers for
 * an unresolved name** — `0`, `-1`, `undefined` and `'?'`. Two of the zeros were
 * silent wrong answers rather than defaults: `writeMemArg` turned an unresolved
 * memory name into MEMORY 0, and the validator's `varIdx` validated an
 * unresolved var as index 0. That is the same shape as the multi-memory defect
 * on the other half — a wrong index that still encodes.
 *
 * So the policy is now explicit at each call site: this one throws, and
 * {@link indexOf} returns `undefined` for callers that genuinely branch.
 *
 * @param what names the field, so the message points at the immediate rather
 * than just saying a var was unresolved.
 */
export function requireIndex(v: Var, what: string): Index {
  if (v.kind === 'index') return v.value;
  if (v.kind !== 'name') throw notAVar(v, what);
  throw new Error(
    `${what}: var "$${v.name}" is not resolved — run resolveNames before writing. ` +
      `Defaulting it would emit a valid module addressing the wrong entity.`,
  );
}

/**
 * The error for a value that is not a {@link Var} at all.
 *
 * ⚠️ Worth its own message. A raw `0` or `'$f'` reaching an accessor means a
 * node was BUILT with the pre-conversion shape — almost always a test fixture
 * cast through `as any`, which the type checker cannot see. Reporting it as
 * "not resolved" instead sends the reader looking for a missing resolveNames
 * pass that does not exist; that misdiagnosis cost a step twice in one session.
 */
function notAVar(v: unknown, what: string): Error {
  return new Error(
    `${what}: expected a Var, got ${typeof v} ${JSON.stringify(v)}. ` +
      `Something built this node with the old shape — check for an "as any" cast.`,
  );
}

/** The index a {@link Var} holds, or `undefined` when it is still a name. */
export function indexOf(v: Var): Index | undefined {
  return v.kind === 'index' ? v.value : undefined;
}

/**
 * Whether two vars denote the same entity.
 *
 * ⚠️ A `Var` is an OBJECT, so `a === b` compares REFERENCES. Two separately
 * built vars for the same local are never `===`, and code written when the
 * field was a plain number keeps compiling after the change while quietly
 * meaning something else — a comparison that stops firing rather than failing.
 * `SimplifyLocals` lost its set+get→tee fusion exactly this way, and only a
 * behavioural test caught it.
 */
export function sameVar(a: Var, b: Var): boolean {
  return a.kind === 'index'
    ? b.kind === 'index' && a.value === b.value
    : b.kind === 'name' && a.name === b.name;
}

/**
 * The symbolic name a {@link Var} holds, or a throw when it is already resolved
 * to an index.
 *
 * The mirror of {@link requireIndex}, for consumers that address an entity BY
 * NAME — binaryen-ts references globals that way. Returning a made-up name for
 * an index-form var would silently address the wrong entity, the same failure
 * `requireIndex` exists to prevent, in the other direction.
 */
export function requireName(v: Var, what: string): string {
  if (v.kind === 'name') return v.name;
  if (v.kind !== 'index') throw notAVar(v, what);
  throw new Error(
    `${what}: var is index ${v.value}, but a symbolic name is required here. ` +
      `Resolve it against the module's name table rather than inventing one.`,
  );
}

/** The name a {@link Var} holds, or `undefined` when it is an index. */
export function nameOf(v: Var): string | undefined {
  return v.kind === 'name' ? v.name : undefined;
}

/** Type guard for index-form {@link Var}. */
export function isVarIndex(v: Var): v is { kind: 'index'; value: Index } {
  return v.kind === 'index';
}
/** Type guard for name-form {@link Var}. */
export function isVarName(v: Var): v is { kind: 'name'; name: string } {
  return v.kind === 'name';
}

// ---------------------------------------------------------------------------
// Block type — the signature of a block/loop/if/try
// ---------------------------------------------------------------------------

/**
 * Block-type immediate for `block` / `loop` / `if` / `try` / `try_table`.
 * Either void, a single value type, or an index into the type section for
 * multi-value signatures (multi-value proposal).
 */
export type BlockType =
  | { readonly kind: 'void' }
  // ⚠️ `ValueType`, not `Type`. A block result may be a TYPED REFERENCE —
  // `(block (result (ref 0)))` — which needs a heap type alongside the tag
  // byte, and `Type` is a plain numeric enum with nowhere to put one.
  //
  // While this was `Type`, the binary reader decoded the `0x64` tag and left
  // the heap-type index in the stream, where the next decode step read it as an
  // INSTRUCTION. A block whose result was `(ref 0)` came back as a block with a
  // phantom `unreachable` in it, and the module still round-tripped
  // BYTE-IDENTICALLY, because the writer emitted that phantom instruction as
  // the very byte it had been mis-read from. Found via the spec testsuite
  // (`ref.wast`); see `blockTypeValue`.
  | { readonly kind: 'value'; readonly type: ValueType }
  | { readonly kind: 'func_type'; readonly typeIdx: Index };

/**
 * The `typeIdx` of a `func_type` block type the text parser has not indexed
 * YET. Implicit types are indexed at the end of the module, in text order
 * (W5); the parser assigns every one before it returns, and the writers
 * refuse to encode this value rather than write `-1` as a block type byte.
 */
export const UNASSIGNED_TYPE_INDEX = -1;

/** Pre-built singleton for the void block type. */
export const BLOCK_TYPE_VOID: BlockType = { kind: 'void' };
/** Construct a single-value {@link BlockType}. */
export function blockTypeValue(type: ValueType): BlockType {
  return { kind: 'value', type };
}
/** Construct a multi-value {@link BlockType} referencing a type-section func entry. */
export function blockTypeFuncType(typeIdx: Index): BlockType {
  return { kind: 'func_type', typeIdx };
}

/**
 * A block-type carrier's entry PARAMETERS: the declared types, and the values
 * that supply them — binaryen-ts's `BlockParams`, the shape S6 decision 7b(i)
 * gave the merged tree (S6 step 5, stage (c1)).
 *
 * 🔧 The values used to be left OUTSIDE the construct, as the preceding
 * siblings a linear body happens to have — the one place this tree did not
 * fold an operand into the node that consumes it. They are operands of the
 * construct as much as a `br`'s `values` are (decision 6A), so they are
 * children here: evaluated before the construct, and before an `if`'s
 * condition. Inside, whatever consumes a parameter holds a `pop` for it.
 *
 * Absent means none. A value the decoder could not match to an expression
 * (the stack ran out) is a `pop`, which writes nothing — the same bytes.
 */
export interface BlockParams {
  readonly types: ValueType[];
  readonly values: Expr[];
}

/**
 * A block-type carrier's DECLARED results, on the node as binaryen-ts holds
 * them in its `type`: `'none'` for no result, the value type itself for one,
 * a list for two or more (S6 step 5, stage (c2)). One spelling per arity —
 * build it with {@link blockResult}, never a one-element list.
 *
 * Declared, not derived: an `if` may declare a result its arms would not give
 * it, and a block ending in `unreachable` declares whatever it declares.
 */
export type BlockResult = 'none' | ValueType | ValueType[];

/**
 * An expression's RESULT type, where something has computed it — binaryen-ts's
 * `Type`: a {@link BlockResult}, or `'unreachable'` for an instruction after
 * which the stack is polymorphic (`unreachable`, `br`, `return`, a `throw`,
 * an operator over one).
 *
 * OPTIONAL on every node that does not declare one (S6 step 5 item 5 (4)):
 * step 3 decided the merged node carries `type?`, absent meaning "not derived
 * yet". wabt-ts's reader and parser do not set it — its validator types the tree
 * as it checks it — and binaryen-ts's factories always do. The five constructs
 * are different: their `type` is a declaration (a {@link BlockResult}, required),
 * never `'unreachable'` (owner, 2026-09-16).
 */
export type ExprType = BlockResult | 'unreachable';

/** The {@link BlockResult} for `results`, in its one spelling. */
export function blockResult(results: readonly ValueType[]): BlockResult {
  if (results.length === 0) return 'none';
  if (results.length === 1) return results[0]!;
  return [...results];
}

/** A {@link BlockResult} as a list, whatever its arity. */
export function blockResults(t: BlockResult): ValueType[] {
  if (t === 'none') return [];
  return Array.isArray(t) ? t : [t];
}

/**
 * The header a carrier WRITES, derived from the node (S6 step 5, stage (c2)).
 *
 * 🔧 It was a node field, `blockType`, which held the signature only BY
 * REFERENCE for anything past one result: `func_type` named a type-section
 * index and nothing else. The node now holds the signature itself — `type`
 * (the results) and `params.types` — plus `typeIndex`, the index its header
 * NAMED, which is FORM (decision 7c). This is the one place that turns the
 * pair back into the three header spellings:
 *
 *   - a written index → that index (the node's signature must be the one it
 *     names: the validator checks);
 *   - no index, no parameters, at most one result → `0x40` or the inline type;
 *   - anything else has no inline spelling, and with no index it cannot be
 *     written: {@link UNASSIGNED_TYPE_INDEX}, which the writers refuse.
 */
export function blockTypeOf(e: {
  readonly type: BlockResult;
  readonly typeIndex?: Index;
  readonly params?: BlockParams;
}): BlockType {
  if (e.typeIndex !== undefined) return blockTypeFuncType(e.typeIndex);
  if ((e.params?.types.length ?? 0) === 0) {
    if (e.type === 'none') return BLOCK_TYPE_VOID;
    if (!Array.isArray(e.type)) return blockTypeValue(e.type);
  }
  return blockTypeFuncType(UNASSIGNED_TYPE_INDEX);
}

// ---------------------------------------------------------------------------
// Const — a constant value (leaf node, no children)
// ---------------------------------------------------------------------------

/**
 * The immediate payload of a `*.const` instruction. f32 / f64 store the
 * raw IEEE 754 bit pattern (not the float value) so NaN payloads survive
 * round-trips; v128 stores the literal 16 lane bytes.
 */
export type Const =
  | { readonly type: Type.I32; readonly value: number }
  | { readonly type: Type.I64; readonly value: bigint }
  | { readonly type: Type.F32; readonly bits: number } // raw IEEE 754 bit pattern
  | { readonly type: Type.F64; readonly bits: bigint } // raw IEEE 754 bit pattern
  | { readonly type: Type.V128; readonly bytes: Uint8Array }; // 16 raw bytes

/** Construct an i32 {@link Const}. */
export function constI32(value: number): Const {
  return { type: Type.I32, value };
}
/** Construct an i64 {@link Const}. */
export function constI64(value: bigint): Const {
  return { type: Type.I64, value };
}
/** Construct an f32 {@link Const} from its raw IEEE 754 bit pattern. */
export function constF32(bits: number): Const {
  return { type: Type.F32, bits };
}
/** Construct an f64 {@link Const} from its raw IEEE 754 bit pattern. */
export function constF64(bits: bigint): Const {
  return { type: Type.F64, bits };
}
/** Construct a v128 {@link Const} from its 16 lane bytes. */
export function constV128(bytes: Uint8Array): Const {
  return { type: Type.V128, bytes };
}

// ---------------------------------------------------------------------------
// Catch clauses — exception handling
// ---------------------------------------------------------------------------

/** A catch clause in a try/catch block (legacy exception handling). */
export interface Catch {
  loc?: Location;
  tag?: Var; // undefined → catch_all / catch_all_ref
  isRef: boolean; // catch_ref vs catch (or catch_all_ref vs catch_all)
  /** The handler — see {@link RegionExpr}. */
  body: RegionExpr;
}

/**
 * A catch entry in a try_table block (new exception handling proposal).
 *
 * The four clauses are two ORTHOGONAL bits, held as two fields:
 *
 * | clause          | byte | `tag`   | `isRef` |
 * | --------------- | ---- | ------- | ------- |
 * | `catch`         | 0x00 | present | false   |
 * | `catch_ref`     | 0x01 | present | true    |
 * | `catch_all`     | 0x02 | absent  | false   |
 * | `catch_all_ref` | 0x03 | absent  | true    |
 *
 * 🔧 It was a union keyed by `kind: CatchKind`, split so that `kind` could not
 * disagree with the presence of `tag` (a `catch_all` beside a tag wrote the
 * `catch_all` byte FOLLOWED by a stray tag index, sliding every later clause by
 * one field). This shape closes the same hole with nothing to disagree: there
 * is no `kind`, so the tag's presence IS the tagged/untagged half. It is also
 * the legacy {@link Catch}'s encoding of the same four clauses, and binaryen-ts's
 * `TableCatch` — the same record under the same name (S6 step 5, stage (b)).
 */
export interface TableCatch {
  loc?: Location;
  tag?: Var; // undefined → catch_all / catch_all_ref
  target: Var; // branch target label
  isRef: boolean; // catch_ref / catch_all_ref: the handler also receives an exnref
}

// ---------------------------------------------------------------------------
// Expr — the full discriminated union for WebAssembly instructions
//
// Each node embeds its children as typed fields (tree form). The `loc` field
// is the byte offset or source position of the opcode.
// ---------------------------------------------------------------------------

// --- Control ---
/** `nop` (0x01) — single-byte no-op. */
export interface NopExpr {
  readonly kind: 'nop';
  /** Handle into {@link Module.fidelity}; see `fidelity.ts`. Absent means "derive it". */
  readonly nodeId?: NodeId;
  readonly type?: ExprType;
  readonly loc?: Location;
}

/**
 * `pop` — a value that is ALREADY on the stack, not an instruction.
 *
 * Both decoders build a TREE from a stack machine, so every operand slot has to
 * be filled with something. When the value that belongs in a slot is not on the
 * decoder's operand stack — most often because the producer is a multi-result
 * `call`, which is one node on that stack however many values it pushes — the
 * slot gets one of these.
 *
 * Neither writer emits it: "the value is already on the stack" is spelled in
 * wasm by writing nothing.
 *
 * 🔑 **This was a `nop` carrying a `placeholder: boolean`, which was the same
 * idea under a worse name.** binaryen-ts already had `Pop` — _"a
 * pseudo-instruction; not emitted in the binary format"_ — so the two IRs had
 * one mechanism under two spellings, and the boolean made a synthesized slot
 * filler indistinguishable from a real `nop` to anything that forgot to check
 * it. An explicitly written `(local.set $x (nop))` is a real `nop`: invalid
 * wasm that must stay invalid, and now it cannot be confused for this.
 */
export interface PopExpr {
  readonly kind: 'pop';
  readonly type?: ExprType;
  readonly loc?: Location;
}

/**
 * Where a node came from, for a diagnostic — or the unknown location when it
 * carries none.
 *
 * `loc` is OPTIONAL on every expression node (S6 step 5, item 5 (1)), as it is
 * on binaryen-ts's, whose passes and factories build nodes with no source
 * position; step 3 decided the merged node carries it optional, absent meaning
 * "unknown". Every wabt-ts producer still sets it. Read it through here where a
 * `Location` is REQUIRED, so the fallback lives in one place rather than in 160
 * scattered `??`s.
 */
export function locOf(e: { readonly loc?: Location }): Location {
  return e.loc ?? NO_LOCATION;
}

/** The one unknown location {@link locOf} hands out; a frozen value, never mutated. */
const NO_LOCATION: Location = Object.freeze(unknownLocation());

/**
 * Build the {@link PopExpr} that stands in for an operand a decoder could not
 * attribute a value to.
 */
export function operandPlaceholder(loc: Location): PopExpr {
  return { kind: 'pop', loc };
}

/**
 * The instruction sequence of ONE REGION: the body of a `loop`, `try`,
 * `try_table`, each `catch`, and each `if` arm — binaryen-ts's `RegionExpr`,
 * which S6 Group 2 decision 5 (owner) put in every region slot of the merged
 * tree (S6 step 5, stage (d2)).
 *
 * 🔑 A node of its own rather than a bare `Expr[]`: it is never a branch
 * target and has no label; it never writes a block type (the construct owns
 * that); it is ALWAYS present where its construct has the region, even for 0
 * or 1 instructions, so a body has one spelling. `loc` is its construct's.
 *
 * 🔧 `if`'s `ifFalse` is `RegionExpr | null`: `null` is NO `else`, an empty
 * region is an explicit empty one. As a list, both were `[]`, and the binary
 * reader dropped a valid `else` byte (`04 40 01 05 0b` came back without the
 * `05`) — the defect the region fixed in binaryen-ts too. Upstream wabt drops
 * it as well; `wasm-tools` keeps it.
 *
 * The function body is a region in binaryen-ts; wabt-ts's `Func.body` is still
 * a list, left to the module half, where `Func` and `WasmFunction` unify.
 */
export interface RegionExpr {
  readonly kind: 'region';
  readonly children: Expr[];
  readonly type?: ExprType;
  readonly loc?: Location;
}

/** A {@link RegionExpr} holding `children`. */
export function region(children: Expr[], loc: Location): RegionExpr {
  return { kind: 'region', children, loc };
}
/** `unreachable` (0x00) — traps unconditionally. Type-stack becomes polymorphic. */
export interface UnreachableExpr {
  readonly kind: 'unreachable';
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `return` — returns the function's result values from the type stack (multi-value capable). */
export interface ReturnExpr {
  readonly kind: 'return';
  /**
   * Operand expressions whose post-order evaluation pushes the return
   * values onto the operand stack before the `return` opcode fires.
   * Length must equal the enclosing function's result arity at runtime.
   * Single-value returns store one entry; void returns store none;
   * multi-value returns (`(func (result i32 i32) ...)`) store the full
   * tuple.
   */
  readonly values: Expr[];
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `drop` (0x1a) — discards the top stack value. */
export interface DropExpr {
  readonly kind: 'drop';
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `select` (0x1b / 0x1c) — picks `val1` or `val2` based on a non-zero `cond`. */
export interface SelectExpr {
  readonly kind: 'select';
  /**
   * Handle into {@link Module.fidelity}, where the as-written result type is
   * recorded. Optional: a node built by a pass has none, and no entry, which
   * means "derive it".
   */
  readonly nodeId?: NodeId;
  /**
   * The value the instruction yields when the condition is NON-ZERO.
   *
   * Named as the spec names the operands, not `ifTrue` / `ifFalse`: a select
   * is not a branch. BOTH operands are evaluated, always — that is the whole
   * difference from an `if`, and the reason a select cannot host a trap or a
   * side effect that only one side should see.
   */
  readonly val1: Expr;
  /** The value it yields when the condition is ZERO. Also always evaluated. */
  readonly val2: Expr;
  readonly condition: Expr;
  /**
   * The DECLARED result type of a typed `select` (`0x1c`, `(select (result t))`),
   * or EMPTY for an untyped one (S6 decision 7a).
   *
   * Semantics, not decoration: over references the declared type is what
   * validation checks, and it may be WIDER than either arm — a `ref.null` arm
   * and a `(ref $a)` arm declared `(ref null $a)`. Its presence also records
   * that the source wrote the typed form, so a numeric typed select re-encodes
   * as written (divergence S1); upstream binaryen's `wasm-opt` rewrites a numeric
   * `0x1c` as `0x1b`.
   *
   * ⚠️ **A list, and deliberately** (S6 step 5, stage S3). binaryen-ts held one
   * `ValueType | null` because validation requires exactly one type. But the
   * ENCODING is a vector, and this reader keeps whatever count a binary declares
   * so the validator can report a wrong one. binaryen-ts's front doors refuse
   * any count but one.
   */
  readonly resultType: ValueType[];
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- Blocks ---
/** `block` (0x02) — a labeled scope; `br $label` exits forward. */
export interface BlockExpr {
  readonly kind: 'block';
  /** Handle into {@link Module.fidelity}; see `fidelity.ts`. Absent means "derive it". */
  readonly nodeId?: NodeId;
  readonly label: string;
  /** The DECLARED results — see {@link BlockResult}. */
  readonly type: BlockResult;
  /** The type-section index its header NAMED, if it named one (7c) — see {@link blockTypeOf}. */
  readonly typeIndex?: Index;
  /** Entry parameters — see {@link BlockParams}. Absent means none. */
  readonly params?: BlockParams;
  /** The block's instructions, in order — a region's `children` (S6 step 5, stage (d1)). */
  readonly children: Expr[];
  readonly loc?: Location;
}
/** `loop` (0x03) — a labeled scope; `br $label` jumps to the LOOP HEADER, not its exit. */
export interface LoopExpr {
  readonly kind: 'loop';
  /** Handle into {@link Module.fidelity}; see `fidelity.ts`. Absent means "derive it". */
  readonly nodeId?: NodeId;
  readonly label: string;
  /** The DECLARED results — see {@link BlockResult}. */
  readonly type: BlockResult;
  /** The type-section index its header NAMED, if it named one (7c) — see {@link blockTypeOf}. */
  readonly typeIndex?: Index;
  /** Entry parameters — see {@link BlockParams}. Absent means none. */
  readonly params?: BlockParams;
  /** The region — see {@link RegionExpr}. */
  readonly body: RegionExpr;
  readonly loc?: Location;
}
/** `if` / `else` / `end` (0x04 / 0x05) — conditional execution based on a non-zero `cond`. */
export interface IfExpr {
  readonly kind: 'if';
  /** Handle into {@link Module.fidelity}; see `fidelity.ts`. Absent means "derive it". */
  readonly nodeId?: NodeId;
  readonly label: string;
  /** The DECLARED results — see {@link BlockResult}. */
  readonly type: BlockResult;
  /** The type-section index its header NAMED, if it named one (7c) — see {@link blockTypeOf}. */
  readonly typeIndex?: Index;
  /** Entry parameters — see {@link BlockParams}. Absent means none. */
  readonly params?: BlockParams;
  readonly condition: Expr;
  /**
   * The arm run when the condition is non-zero — binaryen-ts's spelling, taken
   * for the merged tree (S6 Group 3, decided on blast radius: 30 sites here
   * against 44 there).
   *
   * `ifTrue` was upstream wabt's C++ keyword workaround, and in TypeScript
   * `then` carries a hazard of its own: an object with a `then` PROPERTY is
   * treated as a thenable by `await` and `Promise.resolve`.
   */
  readonly ifTrue: RegionExpr;
  /**
   * The arm run when the condition is zero: `null` when there is NO `else`,
   * an empty region when an empty one was written — see {@link RegionExpr}.
   */
  readonly ifFalse: RegionExpr | null;
  readonly loc?: Location;
}

// --- Branches ---
/** `br $label` (0x0c) — unconditional branch to the label-stack `target`. */
export interface BrExpr {
  readonly kind: 'br';
  /**
   * Present iff this is a `br_if`.
   *
   * binaryen-ts models the same instruction pair as one `Break` with
   * `condition: Expression | null`, and the difference really is one operand:
   * the two branches of every writer here chose between `br` and `br_if` on the
   * KIND, which is the same fact spelled twice. The opcode follows from the
   * presence of this field.
   */
  readonly condition?: Expr;
  readonly target: Var;
  /**
   * Operands pushed before the branch, in stack order. A branch to a label
   * with N results carries N values; the earlier single `value?: Expr` slot
   * silently dropped all but the first, so
   * `(func (result i32 f64) (br 0 (i32.const 79) (f64.const 8)))` emitted one
   * operand and V8 rejected it. Same shape as {@link ReturnExpr.values}.
   */
  readonly values: Expr[];
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `br_table` (0x0e) — table-switch branch. The i32 value indexes `targets` (out-of-range → `defaultTarget`). */
export interface BrTableExpr {
  readonly kind: 'br_table';
  readonly targets: Var[];
  readonly defaultTarget: Var;
  /**
   * The i32 index selecting a target. It is the TOP operand — the values
   * carried to the target sit below it, exactly as with {@link BrIfExpr.condition}.
   */
  readonly condition: Expr;
  /**
   * Values carried to the selected label, in stack order. In the LINEAR form
   * these are preceding statements, but the folded form
   * `(br_table $a $b (i32.const 7) (local.get 0))` supplies them inline, where
   * they used to be misread — the first child landed in the index slot and the
   * real index was dropped.
   */
  readonly values: Expr[];
  readonly type?: ExprType;
  readonly loc?: Location;
}
/**
 * Which `br_on_*` this is, as its OPCODE — the operator representation stage 1
 * settled (a GC-prefixed one is `(PREFIX_GC << 16) | sub`). It was a string union
 * here and a numeric const in binaryen-ts; S6 step 5 made this the ONE
 * definition, which binaryen-ts re-exports.
 */
export const BrOnOp = {
  Null: Opcode.BrOnNull,
  NonNull: Opcode.BrOnNonNull,
  Cast: (PREFIX_GC << 16) | GcOpcode.BrOnCast,
  CastFail: (PREFIX_GC << 16) | GcOpcode.BrOnCastFail,
} as const;
/** A `br_on_*` operator: an {@link Opcode}, like every operator field. */
export type BrOnOp = Opcode;

/**
 * The `br_on_*` family: a conditional branch that tests the top reference.
 *
 * `br_on_null` (0xd5) and `br_on_non_null` (0xd6) branch on nullness;
 * `br_on_cast` (0xfb 0x18) and `br_on_cast_fail` (0xfb 0x19) branch on the
 * runtime type, carrying `from` (`rt1`) and `to` (`rt2`).
 *
 * Operands are `[t* ref]` with the tested ref on TOP: the target may take `t*`
 * as well, so `values` carries them below the ref. The field is `ref`, not
 * `value`, because a one-letter difference from `values` is too easy to misread
 * at a call site.
 *
 * ⚠️ **The branch carries the OPPOSITE type from the fallthrough for the cast
 * pair**: `br_on_cast` branches with `rt2` and falls through with the difference
 * `rt1` minus `rt2`; `br_on_cast_fail` is the other way round.
 *
 * These were three kinds — with the cast pair already sharing one kind behind an
 * `onFail` boolean, which is the same idea half-applied. binaryen-ts models all
 * four as one node plus a sub-op, and every consumer here already treated the
 * null pair as a fallthrough pair, so the finer split bought nothing.
 */
export interface BrOnExpr {
  readonly kind: 'br_on';
  readonly opcode: Opcode;
  /** Handle into {@link Module.fidelity}; see `fidelity.ts`. */
  readonly nodeId?: NodeId;
  readonly target: Var;
  /** The ref being tested — the TOP operand. */
  readonly ref: Expr;
  /**
   * Values carried to the branch target, in stack order, below the ref —
   * decision 6's shape, extended to the last branch kind (S6 step 5, stage B3).
   * binaryen-ts's decoder leaves them EMPTY (they stay preceding stack entries);
   * this reader folds them in, so everything handling a `br_on` must see them.
   */
  readonly values: Expr[];
  /**
   * `rt1` — the type the operand is expected to have. Cast variants only.
   *
   * 🔑 The heap type and its nullability are ONE reference type, so they are
   * one field (S6 Group 3). binaryen-ts held four flat optionals — `srcType`,
   * `srcNullable`, `castType`, `castNullable` — so a node could hold a
   * nullability with no heap type beside it, and its encoder papered over exactly
   * that with `?? AbstractHeapType.Any`. Paired, the incoherent state cannot be
   * written down.
   */
  readonly from?: { readonly heapType: HeapTypeRef; readonly nullable: boolean };
  /** `rt2` — the type being tested for. Cast variants only. */
  readonly to?: { readonly heapType: HeapTypeRef; readonly nullable: boolean };
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- Constants ---
/** `*.const` (0x41 / 0x42 / 0x43 / 0x44 / 0xfd 0x0c) — pushes a literal value. */
export interface ConstExpr {
  readonly kind: 'const';
  readonly value: Const;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- Locals ---
/** `local.get $var` (0x20) — pushes the value of a local. */
export interface LocalGetExpr {
  readonly kind: 'local.get';
  readonly var: Var;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `local.set $var` (0x21) — pops the top stack value and writes it to a local. */
export interface LocalSetExpr {
  readonly kind: 'local.set';
  readonly var: Var;
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `local.tee $var` (0x22) — like local.set but leaves the value on the stack. */
export interface LocalTeeExpr {
  readonly kind: 'local.tee';
  readonly var: Var;
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- Globals ---
/** `global.get $var` (0x23) — pushes the value of a global. */
export interface GlobalGetExpr {
  readonly kind: 'global.get';
  readonly var: Var;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `global.set $var` (0x24) — pops the top stack value and writes it to a (mutable) global. */
export interface GlobalSetExpr {
  readonly kind: 'global.set';
  readonly var: Var;
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- Numeric: unary, binary, compare, convert ---
/** Single-operand numeric op (`i32.eqz`, `f32.abs`, etc.). `opcode` identifies the specific op. */
export interface UnaryExpr {
  readonly kind: 'unary';
  readonly opcode: Opcode;
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** Two-operand numeric op (`i32.add`, `f64.mul`, etc.). `opcode` identifies the specific op. */
export interface BinaryExpr {
  readonly kind: 'binary';
  readonly opcode: Opcode;
  readonly left: Expr;
  readonly right: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** Three-operand numeric op (rare; placeholder for relaxed-SIMD ternary instructions). */
export interface TernaryExpr {
  readonly kind: 'simd.ternary';
  readonly opcode: Opcode;
  readonly a: Expr;
  readonly b: Expr;
  readonly c: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** Four-operand numeric op (rare; placeholder for relaxed-SIMD quaternary instructions). */
export interface QuaternaryExpr {
  readonly kind: 'quaternary';
  readonly opcode: Opcode;
  readonly a: Expr;
  readonly b: Expr;
  readonly c: Expr;
  readonly d: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- Memory load/store ---
/**
 * Linear-memory load (`i32.load`, `f64.load8_s`, etc.). `align` is in BYTES and
 * always a power of two — the natural alignment when the text gave no `align=`.
 */
export interface LoadExpr {
  readonly kind: 'load';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** Linear-memory store (`i32.store`, `f32.store`, etc.). `align` as for {@link LoadExpr}. */
export interface StoreExpr {
  readonly kind: 'store';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- Memory misc ---
/** `memory.size` (0x3f) — pushes the current memory size in pages. */
export interface MemorySizeExpr {
  readonly kind: 'memory.size';
  readonly memidx: Var;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `memory.grow` (0x40) — grows memory by `delta` pages, returns the old size (or -1 on failure). */
export interface MemoryGrowExpr {
  readonly kind: 'memory.grow';
  readonly memidx: Var;
  readonly delta: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `memory.copy` (0xfc 0x0a) — copies `size` bytes from `src` to `dest` within memory. */
export interface MemoryCopyExpr {
  readonly kind: 'memory.copy';
  readonly destMemidx: Var;
  readonly srcMemidx: Var;
  readonly dest: Expr;
  readonly source: Expr;
  readonly size: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `memory.fill` (0xfc 0x0b) — fills `size` bytes starting at `dest` with `value`. */
export interface MemoryFillExpr {
  readonly kind: 'memory.fill';
  readonly memidx: Var;
  readonly dest: Expr;
  readonly value: Expr;
  readonly size: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `memory.init $seg` (0xfc 0x08) — copies bytes from a passive data segment into memory. */
export interface MemoryInitExpr {
  readonly kind: 'memory.init';
  readonly segment: Var;
  readonly memidx: Var;
  readonly dest: Expr;
  readonly source: Expr;
  readonly size: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `data.drop $seg` (0xfc 0x09) — declares a passive data segment as no longer needed. */
export interface DataDropExpr {
  readonly kind: 'data.drop';
  readonly segment: Var;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- Calls ---
/** `call $func` (0x10) — direct call to a function (index space includes imports + defined). */
export interface CallExpr {
  readonly kind: 'call';
  /**
   * `return_call` when true — the tail-call proposal's variant of this
   * instruction, which replaces the current frame instead of pushing one.
   *
   * A modifier rather than a different instruction: the operand shape is
   * identical, and binaryen-ts already modelled it exactly this way with
   * `isReturn` on Call and CallIndirect. What it changes is real and lives in
   * the consumers -- a different opcode, the `tailCall` feature gate, and the
   * fact that a tail call makes the rest of the block unreachable.
   */
  readonly isReturn?: boolean;
  readonly func: Var;
  readonly operands: Expr[];
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `call_indirect (type $T) [$table]` (0x11) — indirect call through a function table. */
export interface CallIndirectExpr {
  readonly kind: 'call_indirect';
  /**
   * `return_call` when true — the tail-call proposal's variant of this
   * instruction, which replaces the current frame instead of pushing one.
   *
   * A modifier rather than a different instruction: the operand shape is
   * identical, and binaryen-ts already modelled it exactly this way with
   * `isReturn` on Call and CallIndirect. What it changes is real and lives in
   * the consumers -- a different opcode, the `tailCall` feature gate, and the
   * fact that a tail call makes the rest of the block unreachable.
   */
  readonly isReturn?: boolean;
  /** Handle into {@link Module.fidelity}; see `fidelity.ts`. Absent means "derive it". */
  readonly nodeId?: NodeId;
  /**
   * The signature the call expects the table entry to have.
   *
   * 🔧 binaryen-ts held flat `params` + `results`. S6 Group 3's one tie where
   * cost and structure pointed opposite ways; the owner took this `sig`
   * (2026-09-14), the form beside `typeVar` and the one `FidelityEntry.sig` keys
   * on (cmem/ir-convergence.md § "Group 3").
   */
  readonly sig: FuncSignature;
  /**
   * The type the instruction names — form beside `sig` (7c): which of several
   * identical types. Absent until `synthesizeTypes` interns an INLINE signature
   * (`call_indirect (param i32)`), and on a node built without one; the writers
   * refuse to encode it absent. binaryen-ts's field, spelled the same (owner,
   * 2026-09-16, S6 step 5 item 4 (a)).
   *
   * 🔧 It was required, defaulting to `varIndex(0)`, so index 0 meant both "no
   * annotation" and "the source wrote `(type 0)`" — and a duplicate `typeUse`
   * field said which. That text-form fact lives in the fidelity table
   * ({@link FidelityEntry.typeUse}), which already held it.
   */
  readonly typeVar?: Var;
  readonly table: Var;
  /** Argument expressions, in declaration order. */
  readonly operands: Expr[];
  /**
   * The operand giving the table SLOT to call — the LAST operand.
   *
   * 🔧 binaryen-ts called it `target`, documented as "target label of the
   * branch", which it is not: this instruction does not branch. `target` meant
   * three different things across kinds there — the called function on `call`,
   * a branch label on `br_on`, this operand here (S6 Group 3, on SAFETY).
   */
  readonly callee: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `call_ref $type` (0x14) — typed-function-references proposal: calls a `(ref $T)` value. */
export interface CallRefExpr {
  readonly kind: 'call_ref';
  /**
   * `return_call` when true — the tail-call proposal's variant of this
   * instruction, which replaces the current frame instead of pushing one.
   *
   * A modifier rather than a different instruction: the operand shape is
   * identical, and binaryen-ts already modelled it exactly this way with
   * `isReturn` on Call and CallIndirect. What it changes is real and lives in
   * the consumers -- a different opcode, the `tailCall` feature gate, and the
   * fact that a tail call makes the rest of the block unreachable.
   */
  readonly isReturn?: boolean;
  readonly sigType: Var;
  readonly operands: Expr[];
  readonly callee: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- Ref types ---
/** `ref.null funcref|externref|…` (0xd0) — pushes a null ref of the given type. */
export interface RefNullExpr {
  readonly kind: 'ref.null';
  /**
   * The HEAP type the instruction names — `ref.null func`, `ref.null $T` — and
   * what is written.
   *
   * 🔑 binaryen-ts did not carry it: the node's type `(ref null ht)` held it,
   * and a field beside `type` would have been the same fact twice while `type`
   * was the only carrier (S6 Group 3). It stopped being: `type` is optional and
   * DERIVED, while this is the instruction's immediate (S6 step 5 item 5 (6b)).
   */
  readonly refType: HeapTypeRef;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `ref.is_null` (0xd1) — pops a ref, pushes i32 (1 = null, 0 otherwise). */
export interface RefIsNullExpr {
  readonly kind: 'ref.is_null';
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `ref.func $f` (0xd2) — pushes a funcref to the named function (must be declared in elem or export). */
export interface RefFuncExpr {
  readonly kind: 'ref.func';
  readonly func: Var;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `ref.as_non_null` (0xd4) — converts nullable ref to non-null (traps on null). */
export interface RefAsNonNullExpr {
  readonly kind: 'ref.as';
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- GC reference ops (GC proposal) ---
/** `ref.eq` — compares two `eqref`-compatible references for identity. */
export interface RefEqExpr {
  readonly kind: 'ref.eq';
  readonly left: Expr;
  readonly right: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `ref.i31` — boxes an i32 value into an `i31ref`. */
export interface RefI31Expr {
  readonly kind: 'ref.i31';
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/**
 * `any.convert_extern` (0xfb 0x1a) / `extern.convert_any` (0xfb 0x1b) — the GC
 * proposal's conversions between the `extern` and `any` hierarchies. One
 * operand, no immediates.
 */
export interface ExternConvertExpr {
  readonly kind: 'any.convert_extern' | 'extern.convert_any';
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `i31.get_s` / `i31.get_u` — unboxes an `i31ref` to i32 (sign- or zero-extended). */
export interface I31GetExpr {
  readonly kind: 'i31.get';
  readonly i31: Expr;
  /** True for `i31.get_s` (sign-extended), false for `i31.get_u` (zero-extended). */
  readonly signed: boolean;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- GC struct ops ---
/** `struct.new $type` — pops one value per field, pushes (ref $type). */
export interface StructNewExpr {
  readonly kind: 'struct.new';
  /**
   * `struct.new_default` when true — every field takes its type's default and
   * `operands` is empty.
   *
   * A flag rather than a kind because that is what it is: the same instruction
   * with its field values implied. binaryen-ts already modelled it as
   * `defaultInit`, and the operand count is what every consumer branches on.
   */
  readonly defaultInit?: boolean;
  readonly typeVar: Var;
  readonly operands: Expr[];
  readonly type?: ExprType;
  readonly loc?: Location;
}
/**
 * `struct.get $type $field` (and signed/unsigned variants for packed fields).
 * Pops a `(ref null $type)`, pushes the field's value.
 */
export interface StructGetExpr {
  readonly kind: 'struct.get';
  readonly typeVar: Var;
  readonly fieldVar: Var;
  readonly ref: Expr;
  /**
   * Signedness extension for i8/i16 packed fields. `undefined` for `struct.get`
   * (unpacked field); `true` for `struct.get_s`; `false` for `struct.get_u`.
   */
  readonly signed?: boolean;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `struct.set $type $field` — pops ref + value, no result. */
export interface StructSetExpr {
  readonly kind: 'struct.set';
  readonly typeVar: Var;
  readonly fieldVar: Var;
  readonly ref: Expr;
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- GC array ops ---
/** `array.new $T` — pops init value + length (i32), pushes (ref $T). */
export interface ArrayNewExpr {
  readonly kind: 'array.new';
  readonly typeVar: Var;
  /** Absent for `array.new_default`, where each element takes the type's default. */
  readonly init?: Expr;
  readonly length: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `array.new_fixed $T N` — pops N element values, pushes (ref $T). */
export interface ArrayNewFixedExpr {
  readonly kind: 'array.new_fixed';
  readonly typeVar: Var;
  readonly operands: Expr[];
  readonly type?: ExprType;
  readonly loc?: Location;
}
/**
 * `array.new_data $T $data` — pops offset (i32) + length (i32), pushes (ref $T)
 * initialized from the named data segment.
 */
export interface ArrayNewDataExpr {
  readonly kind: 'array.new_data';
  readonly typeVar: Var;
  readonly dataVar: Var;
  readonly offset: Expr;
  readonly length: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/**
 * `array.new_elem $T $elem` — pops offset (i32) + length (i32), pushes (ref $T)
 * initialized from the named element segment.
 */
export interface ArrayNewElemExpr {
  readonly kind: 'array.new_elem';
  readonly typeVar: Var;
  readonly elemVar: Var;
  readonly offset: Expr;
  readonly length: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/**
 * `array.get $T` (and signed/unsigned variants for packed element types).
 * Pops (ref $T) + i32 index, pushes element value.
 */
export interface ArrayGetExpr {
  readonly kind: 'array.get';
  readonly typeVar: Var;
  readonly ref: Expr;
  readonly index: Expr;
  /** Signedness for i8/i16 packed element types. Undefined for unpacked. */
  readonly signed?: boolean;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `array.set $T` — pops (ref $T) + i32 index + element value, no result. */
export interface ArraySetExpr {
  readonly kind: 'array.set';
  readonly typeVar: Var;
  readonly ref: Expr;
  readonly index: Expr;
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/**
 * `array.fill $t` (0xfb 0x10) — pops (ref null $t), i32 offset, field value,
 * i32 size; fills the range with the value.
 */
export interface ArrayFillExpr {
  readonly kind: 'array.fill';
  readonly typeVar: Var;
  readonly ref: Expr;
  readonly offset: Expr;
  readonly value: Expr;
  readonly size: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/**
 * `array.copy $dst $src` (0xfb 0x11) — pops dest ref, dest offset, src ref,
 * src offset, size. Carries TWO type immediates, destination first.
 */
export interface ArrayCopyExpr {
  readonly kind: 'array.copy';
  readonly destTypeVar: Var;
  readonly srcTypeVar: Var;
  readonly destRef: Expr;
  readonly destOffset: Expr;
  readonly srcRef: Expr;
  readonly srcOffset: Expr;
  readonly size: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/**
 * `array.init_data $t $d` (0xfb 0x12) — pops (ref null $t), i32 dest offset, i32
 * source offset, i32 size, and copies from the named DATA segment.
 */
export interface ArrayInitDataExpr {
  readonly kind: 'array.init_data';
  readonly typeVar: Var;
  readonly segment: Var;
  readonly ref: Expr;
  readonly destOffset: Expr;
  readonly srcOffset: Expr;
  readonly size: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/**
 * `array.init_elem $t $e` (0xfb 0x13) — the same shape, copying from the named
 * ELEM segment.
 *
 * Two interfaces, as binaryen-ts has (S6 step 5): one interface with a KIND UNION
 * could not be matched by kind, so the convergence ratchet read identical fields
 * as different. {@link ArrayInitSegmentExpr} is the pair.
 */
export interface ArrayInitElemExpr {
  readonly kind: 'array.init_elem';
  readonly typeVar: Var;
  readonly segment: Var;
  readonly ref: Expr;
  readonly destOffset: Expr;
  readonly srcOffset: Expr;
  readonly size: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** Either `array.init_*` — the kind says which index space `segment` refers to. */
export type ArrayInitSegmentExpr = ArrayInitDataExpr | ArrayInitElemExpr;
/** `array.len` — pops (ref array), pushes i32 length. No type immediate. */
export interface ArrayLenExpr {
  readonly kind: 'array.len';
  readonly ref: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- GC ref.test / ref.cast ---
/**
 * `ref.test (ref [null] H) val` — pops a ref, pushes i32 (1 if the ref's
 * runtime type matches the heap type H respecting nullability, else 0).
 *
 * `heapType` is a {@link Var} for parity with `ref.null`: name-form holds
 * the abstract-heap-type keyword (`"any"` / `"eq"` / `"i31"` / `"struct"` /
 * `"array"` / `"func"` / `"extern"` / `"none"` / `"nofunc"` / `"noextern"`)
 * or `"$T"` for a concrete user-defined heap type. `nullable` matches the
 * `null` keyword in the WAT immediate.
 */
export interface RefTestExpr {
  readonly kind: 'ref.test';
  readonly heapType: HeapTypeRef;
  readonly nullable: boolean;
  readonly ref: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/**
 * `ref.cast (ref [null] H) val` — pops a ref, pushes a ref of type H
 * (traps if the runtime type doesn't match).
 */
export interface RefCastExpr {
  readonly kind: 'ref.cast';
  readonly heapType: HeapTypeRef;
  readonly nullable: boolean;
  readonly ref: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- Tables ---
/** `table.get $table` (0x25) — reads the element at the given index. */
export interface TableGetExpr {
  readonly kind: 'table.get';
  readonly table: Var;
  readonly index: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `table.set $table` (0x26) — writes an element at the given index. */
export interface TableSetExpr {
  readonly kind: 'table.set';
  readonly table: Var;
  readonly index: Expr;
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `table.grow $table` (0xfc 0x0f) — grows the table by `delta`, init with `initValue`. */
export interface TableGrowExpr {
  readonly kind: 'table.grow';
  readonly table: Var;
  readonly value: Expr;
  readonly delta: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `table.size $table` (0xfc 0x10) — pushes the current table size. */
export interface TableSizeExpr {
  readonly kind: 'table.size';
  readonly table: Var;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `table.fill $table` (0xfc 0x11) — fills a range of the table with `value`. */
export interface TableFillExpr {
  readonly kind: 'table.fill';
  readonly table: Var;
  readonly dest: Expr;
  readonly value: Expr;
  readonly size: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `table.copy $dst $src` (0xfc 0x0e) — copies `size` elements between tables. */
export interface TableCopyExpr {
  readonly kind: 'table.copy';
  readonly destTable: Var;
  readonly sourceTable: Var;
  readonly dest: Expr;
  readonly source: Expr;
  readonly size: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `table.init $seg $table` (0xfc 0x0c) — copies elements from a passive elem segment. */
export interface TableInitExpr {
  readonly kind: 'table.init';
  readonly segment: Var;
  readonly table: Var;
  readonly dest: Expr;
  readonly source: Expr;
  readonly size: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `elem.drop $seg` (0xfc 0x0d) — declares a passive element segment as no longer needed. */
export interface ElemDropExpr {
  readonly kind: 'elem.drop';
  readonly segment: Var;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- Exceptions ---
/** `throw $tag` (0x08) — throws an exception with the named tag, popping the tag's args. */
export interface ThrowExpr {
  readonly kind: 'throw';
  readonly tag: Var;
  readonly operands: Expr[];
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `throw_ref` (0x0a) — re-throws an existing exception reference (EH proposal). */
export interface ThrowRefExpr {
  readonly kind: 'throw_ref';
  readonly exnref: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `rethrow $depth` (0x09) — legacy EH: re-throws the exception caught by the labeled outer catch. */
export interface RethrowExpr {
  readonly kind: 'rethrow';
  /**
   * The catch label this re-throws from.
   *
   * 🔧 It was `depth`, which describes only ONE of the two forms a {@link Var}
   * takes — `rethrow $l` names a label, and since the binary writer resolves
   * label names itself, a name is exactly what reaches this field from text.
   * Every other single-label reference in both IRs is `target`.
   */
  readonly target: Var;
  readonly type?: ExprType;
  readonly loc?: Location;
}

/** `try ... (catch ...)* (delegate ...)?` (0x06) — legacy EH; superseded by `try_table`. */
export interface TryExpr {
  readonly kind: 'try';
  /** Handle into {@link Module.fidelity}; see `fidelity.ts`. Absent means "derive it". */
  readonly nodeId?: NodeId;
  readonly label: string;
  /** The DECLARED results — see {@link BlockResult}. */
  readonly type: BlockResult;
  /** The type-section index its header NAMED, if it named one (7c) — see {@link blockTypeOf}. */
  readonly typeIndex?: Index;
  /** Entry parameters — see {@link BlockParams}. Absent means none. */
  readonly params?: BlockParams;
  /** The region — see {@link RegionExpr}. */
  readonly body: RegionExpr;
  readonly catches: Catch[];
  readonly delegate?: Var;
  readonly loc?: Location;
}
/** `try_table ... (catch ...)*` (0x1f) — current EH proposal; catches branch to labels. */
export interface TryTableExpr {
  readonly kind: 'try_table';
  /** Handle into {@link Module.fidelity}; see `fidelity.ts`. Absent means "derive it". */
  readonly nodeId?: NodeId;
  readonly label: string;
  /** The DECLARED results — see {@link BlockResult}. */
  readonly type: BlockResult;
  /** The type-section index its header NAMED, if it named one (7c) — see {@link blockTypeOf}. */
  readonly typeIndex?: Index;
  /** Entry parameters — see {@link BlockParams}. Absent means none. */
  readonly params?: BlockParams;
  /** The region — see {@link RegionExpr}. */
  readonly body: RegionExpr;
  readonly catches: TableCatch[];
  readonly loc?: Location;
}

// --- SIMD ---
/**
 * `i8x16.extract_lane_s` and friends — read one lane out of a vector.
 *
 * ⚠️ **Split from a single `simd_lane_op` kind, against S4's preference for the
 * coarse form.** Both worst conditions were measured and neither binds: the two
 * forms are fidelity-equivalent, and NO pass dispatches on this family at all.
 * S4's rationale was a pass forced to enumerate finer kinds; with no such pass,
 * that rationale does not apply, and cost decides — 27 sites here against 110 on
 * binaryen-ts's side, which already had the split.
 */
export interface SimdExtractExpr {
  readonly kind: 'simd.extract';
  readonly opcode: Opcode;
  readonly lane: number;
  /** The vector being read. */
  readonly vec: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}

/** `i8x16.replace_lane` and friends — write one lane and yield the vector. */
export interface SimdReplaceExpr {
  readonly kind: 'simd.replace';
  readonly opcode: Opcode;
  readonly lane: number;
  /** The vector being written into. */
  readonly vec: Expr;
  /** The scalar written into the lane. */
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** SIMD `i8x16.shuffle` — permutes 32 bytes from two v128 operands via 16 lane indices. */
export interface SimdShuffleOpExpr {
  readonly kind: 'simd.shuffle';
  readonly lanes: Uint8Array; // 16 lane indices
  readonly left: Expr;
  readonly right: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** SIMD `v128.load*_lane` — loads one lane of a v128 from memory, leaving others unchanged. */
export interface SimdLoadLaneExpr {
  readonly kind: 'simd.load_store_lane';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly lane: number;
  readonly address: Expr;
  readonly vec: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** SIMD `v128.load*_splat` — loads a scalar and broadcasts it to every lane. */
export interface LoadSplatExpr {
  readonly kind: 'simd.load';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- Atomics ---
/** Atomic load (`i32.atomic.load`, etc.) — sequentially-consistent read from shared memory. */
export interface AtomicLoadExpr {
  readonly kind: 'atomic.load';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** Atomic store — sequentially-consistent write to shared memory. */
export interface AtomicStoreExpr {
  readonly kind: 'atomic.store';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** Atomic read-modify-write (`i32.atomic.rmw.add`, etc.) — pops value, returns the prior memory contents. */
export interface AtomicRmwExpr {
  readonly kind: 'atomic.rmw';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly value: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** Atomic compare-exchange — writes `replacement` iff memory matches `expected`; returns the old value. */
export interface AtomicRmwCmpxchgExpr {
  readonly kind: 'atomic.cmpxchg';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly expected: Expr;
  readonly replacement: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `memory.atomic.wait{32,64}` — blocks until memory at `address` changes or timeout expires. */
export interface AtomicWaitExpr {
  readonly kind: 'atomic.wait';
  readonly opcode: Opcode;
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly expected: Expr;
  readonly timeout: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `memory.atomic.notify` — wakes up to `count` waiters blocked on `address`. */
export interface AtomicNotifyExpr {
  readonly kind: 'atomic.notify';
  readonly align: number;
  readonly offset: bigint;
  readonly memidx: Var;
  readonly address: Expr;
  readonly count: Expr;
  readonly type?: ExprType;
  readonly loc?: Location;
}
/** `atomic.fence` (0xfe 0x03) — memory fence; `consistencyModel` is always 0 currently. */
export interface AtomicFenceExpr {
  readonly kind: 'atomic.fence';
  readonly consistencyModel: number;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// --- Misc ---
/** Code-metadata pseudo-expression — captures debug info attached to an instruction position. */
export interface CodeMetadataExpr {
  readonly kind: 'code_metadata';
  readonly name: string;
  readonly data: Uint8Array;
  readonly type?: ExprType;
  readonly loc?: Location;
}

// ---------------------------------------------------------------------------
// Expr — the complete union type
// ---------------------------------------------------------------------------

/**
 * The full discriminated union of WebAssembly instruction IR nodes. Each
 * variant carries its operands as typed children (tree shape) so a
 * post-order walk emits the correct binary stack-machine sequence.
 * Use the `kind` field to discriminate.
 */
export type Expr =
  | NopExpr
  | PopExpr
  | RegionExpr
  | UnreachableExpr
  | ReturnExpr
  | DropExpr
  | SelectExpr
  | BlockExpr
  | LoopExpr
  | IfExpr
  | BrExpr
  | BrTableExpr
  | ConstExpr
  | LocalGetExpr
  | LocalSetExpr
  | LocalTeeExpr
  | GlobalGetExpr
  | GlobalSetExpr
  | UnaryExpr
  | BinaryExpr
  | TernaryExpr
  | QuaternaryExpr
  | LoadExpr
  | StoreExpr
  | MemorySizeExpr
  | MemoryGrowExpr
  | MemoryCopyExpr
  | MemoryFillExpr
  | MemoryInitExpr
  | DataDropExpr
  | CallExpr
  | CallIndirectExpr
  | CallRefExpr
  | RefNullExpr
  | RefIsNullExpr
  | RefFuncExpr
  | RefAsNonNullExpr
  | RefEqExpr
  | RefI31Expr
  | ExternConvertExpr
  | I31GetExpr
  | StructNewExpr
  | StructGetExpr
  | StructSetExpr
  | ArrayNewExpr
  | ArrayNewFixedExpr
  | ArrayNewDataExpr
  | ArrayNewElemExpr
  | ArrayGetExpr
  | ArraySetExpr
  | ArrayLenExpr
  | ArrayFillExpr
  | ArrayCopyExpr
  | ArrayInitDataExpr
  | ArrayInitElemExpr
  | RefTestExpr
  | RefCastExpr
  | TableGetExpr
  | TableSetExpr
  | TableGrowExpr
  | TableSizeExpr
  | TableFillExpr
  | TableCopyExpr
  | TableInitExpr
  | ElemDropExpr
  | ThrowExpr
  | ThrowRefExpr
  | RethrowExpr
  | BrOnExpr
  | TryExpr
  | TryTableExpr
  | SimdExtractExpr
  | SimdReplaceExpr
  | SimdShuffleOpExpr
  | SimdLoadLaneExpr
  | LoadSplatExpr
  | AtomicLoadExpr
  | AtomicStoreExpr
  | AtomicRmwExpr
  | AtomicRmwCmpxchgExpr
  | AtomicWaitExpr
  | AtomicNotifyExpr
  | AtomicFenceExpr
  | CodeMetadataExpr;

/** Helper alias for the discriminant string of {@link Expr} (e.g. `'block'`, `'i32.const'`). */
export type ExprKind = Expr['kind'];

// ---------------------------------------------------------------------------
// Module-level IR structures
// ---------------------------------------------------------------------------

/** Function signature (type). */
export interface FuncSignature {
  params: ValueType[];
  results: ValueType[];
}

/** Structural equality for two {@link FuncSignature} values (params + results). */
export function valueTypeEquals(a: ValueType, b: ValueType): boolean {
  if (isRefValueType(a) || isRefValueType(b)) {
    if (!isRefValueType(a) || !isRefValueType(b)) return false;
    if (a.nullable !== b.nullable) return false;
    // One spelling for heap-type equality, so the arms cannot drift apart.
    return sameHeap(a.heapType, b.heapType);
  }
  return a === b;
}

/** Structural equality for two {@link FuncSignature} values (params + results). */
export function sigEquals(a: FuncSignature, b: FuncSignature): boolean {
  return (
    a.params.length === b.params.length &&
    a.results.length === b.results.length &&
    a.params.every((t, i) => valueTypeEquals(t, b.params[i]!)) &&
    a.results.every((t, i) => valueTypeEquals(t, b.results[i]!))
  );
}

/** A local variable declaration (type + count, matching LocalTypes in C++). */
/**
 * One local slot — a parameter or a declared local, in the one index space they
 * share (S6 step 5 item 6 (M6c); binaryen-ts's `Local`).
 *
 * 🔧 This was `LocalDecl` — run-length `{ type, count }` groups, excluding
 * params, beside a sparse `localNames` map covering both. Three shapes for one
 * list: a pass that added a local had to touch two of them, and the name of the
 * local it added had to go in the third, keyed by an index it had to compute.
 * The GROUPING is not lost by flattening: it is the binary's own form, and the
 * writer already re-derived it (it coalesces runs, which is why the emitted
 * bytes are unchanged — measured: 4,064 of 4,065 corpus functions with locals
 * are written in exactly that canonical grouping).
 */
export interface Local {
  type: ValueType;
  /** Its name, where it has one — `$`-prefixed, as every name here is. */
  name?: string;
}

/**
 * The named slots of `locals`, by index — the shape the name section's local
 * subsection and the text writer both want (M6c).
 */
export function localNameEntries(locals: readonly Local[]): [Index, string][] {
  const out: [Index, string][] = [];
  locals.forEach((l, i) => {
    if (l.name !== undefined) out.push([i, l.name]);
  });
  return out;
}

/**
 * A CONCRETE typed reference — `(ref $T)` / `(ref null $T)` — carrying the
 * heap type it points at.
 *
 * The flat `Type` enum cannot express this: its values are single wire bytes,
 * but a typed reference encodes as `0x64`/`0x63` FOLLOWED BY a heap type. The
 * parser used to coarsen every typed ref to `Type.StructRef`, so the writer
 * emitted a structref byte and V8 rejected any module using one in a
 * signature, local, global, or element type.
 */
export interface RefValueType {
  // No `kind`: S6 step 5 stage V3b removed a discriminator that could only ever
  // be 'ref' -- a ref record is the one OBJECT among value types, so it told
  // nothing `typeof` did not -- and binaryen-ts's `RefType` never had one.
  /** The heap type: a name-var for `$T`, an index-var once resolved. */
  readonly heapType: HeapTypeRef;
  /** `(ref null $T)` when true, `(ref $T)` when false. */
  readonly nullable: boolean;
}

/**
 * Anywhere a value type can appear: a scalar {@link ValType} (whose value IS its
 * wire byte) or a concrete {@link RefValueType} — binaryen-ts's `ValueType`.
 *
 * 🔧 It was `Type | RefValueType`, and `Type` also holds what is NOT a value type:
 * the packed `I8` / `I16` (field storage only), `Void`, `Func` / `Struct` /
 * `Array` (type-definition forms) and the validator's `Any`. Each of those had a
 * use, and each lived in a slot that claimed to hold a value (S6 step 5, item 4
 * (b)). They have their own names now: {@link StorageType} for fields, and the
 * validator's stack type for `Any`.
 */
export type ValueType = ValType | RefValueType;

/**
 * The storage type of a struct or array field: a value type, or a packed
 * integer that is only valid there — binaryen-ts's `StorageType`. ⚠️ binaryen-ts
 * spells the packed pair as the strings `'i8'` / `'i16'`, here they are wire
 * bytes: unifying that is the module half's (GC type definitions).
 */
export type StorageType = ValueType | typeof Type.I8 | typeof Type.I16;

/** Narrow a {@link ValueType} to the concrete typed-reference case. */
export function isRefValueType(vt: ValueType | Type): vt is RefValueType {
  return typeof vt === 'object';
}

/**
 * Collapse a {@link ValueType} to a single abstract {@link Type}.
 *
 * For consumers that cannot yet represent a concrete heap type — the
 * type-checker's operand stack and the binaryen bridge. A typed ref becomes
 * its nullable abstract supertype, which is what the whole IR used to store.
 * Encoders must NOT use this: emitting the coarsened byte is precisely the
 * bug this type exists to fix.
 */
export function coarsenValueType(vt: ValueType): ValType {
  return isRefValueType(vt) ? Type.StructRef : vt;
}

/**
 * Human-readable spelling of a {@link ValueType}, matching the WAT text
 * format. Abstract types delegate to `typeName`; a concrete typed reference
 * prints as `(ref $T)` / `(ref null $T)`. Printing is total over `Type`, so
 * the validator's `any` stack slot and a field's packed `i8` / `i16` print
 * through here too.
 */
export function valueTypeName(vt: ValueType | Type): string {
  if (!isRefValueType(vt)) return typeName(vt);
  const h = vt.heapType.kind === 'index' ? `${vt.heapType.value}` : vt.heapType.name;
  return `(ref ${vt.nullable ? 'null ' : ''}${h})`;
}

/** Shared shape for every {@link TypeEntry} variant. */
export interface TypeEntryBase {
  name: string;
  loc: Location;
  /**
   * An explicit `(sub final? $super*)` declaration.
   *
   * ABSENT means the bare comptype shorthand, which the spec defines as
   * `sub final` with no supertypes — so absent is NOT the same as
   * `{ final: false, supertypes: [] }`, and the writer emits a different
   * encoding for each.
   */
  sub?: { final: boolean; supertypes: Var[] };
  /**
   * Set on the FIRST entry of an explicit `(rec …)` group: how many
   * consecutive entries the group spans. Absent means a singleton group.
   *
   * The type INDEX space counts entries, but the type SECTION is a vector of
   * rec groups — so a 2-entry group occupies one vector slot and two indices.
   */
  recGroupSize?: number;
}

/** A type section entry — function, struct, or array type. */
export type TypeEntry =
  | ({ kind: 'func'; sig: FuncSignature } & TypeEntryBase)
  | ({ kind: 'struct'; fields: Field[] } & TypeEntryBase)
  | ({ kind: 'array'; field: Field } & TypeEntryBase);

/**
 * Walk `types` as the SECTION sees it: a sequence of rec groups. Each yielded
 * entry is `[startIndex, count, explicit]`, where `explicit` distinguishes a
 * written `(rec …)` from an implicit singleton — the two encode differently.
 */
export function recGroups(
  types: readonly TypeEntry[],
): Array<{ start: number; count: number; explicit: boolean }> {
  const out: Array<{ start: number; count: number; explicit: boolean }> = [];
  for (let i = 0; i < types.length;) {
    const size = types[i]!.recGroupSize;
    if (size !== undefined && size >= 0) {
      out.push({ start: i, count: size, explicit: true });
      i += Math.max(size, 1);
    } else {
      out.push({ start: i, count: 1, explicit: false });
      i += 1;
    }
  }
  return out;
}

/** A field in a GC struct or array type. */
export interface Field {
  name: string;
  /** A value type or a packed integer — see {@link StorageType}. */
  type: StorageType;
  mutable: boolean;
}

/** Memory / table size limits. */
export interface Limits {
  /**
   * Initial size, in pages (memory) or elements (table).
   *
   * A `bigint` because the field is u64 for a 64-bit memory or table and the
   * spec's bound is 2^48 pages / 2^64-1 elements — a JS number is exact only
   * to 2^53, so `(table i64 0 0xffff_ffff_ffff_ffff funcref)`, which the spec
   * calls VALID, could not be represented at all. It was rounded to 2^64 on
   * the way in and the encoder had to refuse it (T13.2).
   */
  initial: bigint;
  /** Maximum size, in the same unit as {@link initial}. `bigint` for the same reason. */
  max?: bigint;
  isShared: boolean;
  is64: boolean;
  /**
   * log2 of the memory's PAGE SIZE (custom-page-sizes proposal); omitted means
   * the standard 16, i.e. 64 KiB.
   *
   * The LOG2, because that is what the wire field holds. It was `pageSize`,
   * documented as bytes, while the reader and writer both passed the raw wire
   * value through — so a decoded 64 KiB memory carried `pageSize = 16` and the
   * WAT writer printed `(pagesize 16)`.
   *
   * Only 0 and 16 are legal — the proposal admits page sizes 1 and 65536 and
   * NOTHING between. That is the trap: the field is already a log2, so every
   * value looks like a power of two, and a "is it a power of two" check accepts
   * fourteen sizes the spec rejects. `validateModule` owns that rule.
   *
   * A TABLE has no page size, and the binary reader rejects the flag bit on one
   * rather than ignoring it.
   */
  pageSizeLog2?: number;
}

/** A function defined (or imported) in the module. */
/**
 * How an item's signature was NAMED in the source, when `typeVar` alone
 * cannot say.
 *
 * `typeVar` is required and defaults to index 0 when the source annotated
 * nothing, so index 0 is ambiguous between "no annotation" and "the source
 * really wrote `(type 0)`" — and `synthesizeTypes` needs to tell them apart
 * before it decides whether to overwrite the index.
 *
 * - `'resolved'` — a `(type N)` type-use was written and `typeVar` already
 *   points at it. AUTHORITATIVE: `synthesizeTypes` must not re-derive the
 *   index from the signature. Several distinct types can share one signature
 *   (`(sub (func))` and `(sub final (func))` are both `() -> ()` but are not
 *   interchangeable), so a structural match picks the wrong one.
 * - a {@link Var} — a type-use was written with no inline signature, so the
 *   signature is adopted wholesale from the referenced type, but `N` was not
 *   resolvable at parse time. Either a forward reference, or an index into
 *   the IMPLICIT part of the type space, which only exists once
 *   `synthesizeTypes` has appended the inline signatures.
 * - `'inline'` — no `(type …)` was written at all, so the inline signature
 *   DEFINES a type and has to be interned. Deferred rather than interned at
 *   parse time so explicit `(type …)` fields keep the low indices: the spec
 *   appends implicit types after all explicit ones, and the testsuite depends
 *   on it (`func.wast` writes `(type 1)` for an implicit entry).
 *
 * Omitted, never `undefined`, when there is nothing to record.
 */
export type TypeUse = Var | 'resolved' | 'inline';

/**
 * A function definition: its signature, its locals, and its body.
 *
 * Note that `sig` is the resolved signature while `typeVar` is the
 * type-section reference it came from. Both are kept because the binary format
 * distinguishes a signature written inline from one written as a type index,
 * and round-trip fidelity depends on reproducing the spelling that was read.
 */
export interface Func {
  name: string;
  loc: Location;
  /** Handle into {@link Module.fidelity}; see `fidelity.ts`. */
  nodeId?: NodeId;
  /** Type-section reference (index or name). Filled during decode. */
  typeVar: Var;
  /** How the signature was named; see {@link TypeUse}. */
  typeUse?: TypeUse;
  sig: FuncSignature;
  /**
   * Every local slot the function has, PARAMS FIRST — the one index space a
   * `local.get` addresses, each slot carrying its own name where it has one
   * (M6c). The params are also {@link sig}'s, by index.
   *
   * 🔧 N1 (cmem/names.md): a name had nowhere to live. The parser resolved
   * `$arg` to a slot and discarded the name, so no writer could put it back and
   * WAT → wasm2wat lost every param and local name (24,694 of them in the
   * corpus). The name now sits on the slot it names.
   */
  locals: Local[];
  /**
   * The body — the {@link RegionExpr} its instructions are held in, as every
   * other sequence in this tree is (S6 step 5 item 6 (M6b); decision 5, and
   * binaryen-ts's shape). Its `children` are exactly the instructions read.
   *
   * It was a bare `Expr[]`: a list with nowhere to put the location it spans,
   * and the one sequence a pass could not splice through the region helpers
   * (`mapWithSequences`) that every other one uses.
   */
  body: RegionExpr;
  tailcall: boolean;
}

/** A global variable. */
export interface Global {
  name: string;
  loc: Location;
  type: ValueType;
  mutable: boolean;
  /**
   * The initializer — ABSENT on an imported global, which has none — a constant
   * expression, held as a {@link RegionExpr}: its children
   * are exactly the instructions read, 0, 1 or many (owner, 2026-09-16, S6
   * step 5 item 6 (M2)). A malformed one — empty, two values, a `nop` — is kept
   * for the validator to report, as the binary said it.
   */
  init?: RegionExpr;
}

/** A table. */
export interface Table {
  name: string;
  loc: Location;
  elemType: ValueType;
  limits: Limits;
  /**
   * The initializer, when the table declares one — a constant expression, held as a {@link RegionExpr}: its children
   * are exactly the instructions read, 0, 1 or many (owner, 2026-09-16, S6
   * step 5 item 6 (M2)). A malformed one — empty, two values, a `nop` — is kept
   * for the validator to report, as the binary said it.
   */
  /**
   * ABSENT when it declares none. 🔧 It was `Expr[]` with `[]` for none, so a
   * PRESENT-but-empty initializer (`40 00 70 00 01 0b`) read as none and was
   * written without one — three bytes and the initializer lost.
   */
  init?: RegionExpr;
}

/** A linear memory. */
export interface Memory {
  name: string;
  loc: Location;
  limits: Limits;
}

/** An exception tag. */
export interface Tag {
  name: string;
  loc: Location;
  sig: FuncSignature;
}

/** An element segment (active or passive). */
export type SegmentKind = 'active' | 'passive' | 'declared';

/**
 * An element segment in the elem section. Active segments initialize a
 * portion of a table at instantiation; passive segments wait for an explicit
 * `table.init`; declared segments only declare ref.func references for
 * subsequent `ref.func` instructions.
 */
export interface ElemSegment {
  name: string;
  loc: Location;
  kind: SegmentKind;
  tableVar: Var; // only for active
  /**
   * The offset — present exactly when the segment is active — a constant expression, held as a {@link RegionExpr}: its children
   * are exactly the instructions read, 0, 1 or many (owner, 2026-09-16, S6
   * step 5 item 6 (M2)). A malformed one — empty, two values, a `nop` — is kept
   * for the validator to report, as the binary said it.
   */
  offset?: RegionExpr;
  elemType: ValueType;
  /** Each entry, a constant expression (a {@link RegionExpr}, as `offset`). */
  elemExprs: RegionExpr[];
}

/** A data segment (active or passive). */
export interface DataSegment {
  name: string;
  loc: Location;
  kind: SegmentKind;
  memoryVar: Var; // only for active
  /**
   * The offset — present exactly when the segment is active — a constant expression, held as a {@link RegionExpr}: its children
   * are exactly the instructions read, 0, 1 or many (owner, 2026-09-16, S6
   * step 5 item 6 (M2)). A malformed one — empty, two values, a `nop` — is kept
   * for the validator to report, as the binary said it.
   */
  offset?: RegionExpr;
  data: Uint8Array;
}

/** An import entry. */
export type Import =
  | { kind: ExternalKind.Func; module: string; field: string; func: Func }
  | { kind: ExternalKind.Table; module: string; field: string; table: Table }
  | { kind: ExternalKind.Memory; module: string; field: string; memory: Memory }
  | { kind: ExternalKind.Global; module: string; field: string; global: Global }
  | { kind: ExternalKind.Tag; module: string; field: string; tag: Tag };

/** An export entry. */
export interface Export {
  name: string;
  kind: ExternalKind;
  var: Var;
}

/** A custom section's raw bytes and name. */
export interface Custom {
  name: string;
  /**
   * The payload, verbatim — or `null` for the `name` section's PLACE, and only
   * for a section named `name`: its content is generated from the module's
   * names, so the entry marks where it goes (S6 step 5 item 6 (M2f)). A binary
   * laid out `.debug_*`, `name`, `producers` (clang's, rustc's) came back with
   * the name section moved last when the reader dropped it on applying it.
   */
  data: Uint8Array | null;
  loc: Location;
  /**
   * The known section this custom section FOLLOWED in the source binary:
   * `null` if it came before any of them, `undefined` if the position is not
   * known (IR built by hand, or by a reader that did not record it).
   *
   * Custom sections may legally appear anywhere, so the writer used to emit
   * them all in one block at the END. That silently RELOCATED a section the
   * caller had asked to keep -- `wasm-strip --sections` removes the named ones
   * and moves the survivors -- and position is load-bearing for at least one
   * of them: the dynamic-linking convention requires `dylink.0` to come FIRST.
   *
   * `undefined` keeps the old append-at-the-end behaviour, so hand-built IR is
   * unaffected.
   */
  precedingSection?: BinarySection | null;
}

// ---------------------------------------------------------------------------
// Section metadata envelope (for wasm-objdump)
// ---------------------------------------------------------------------------

/** Byte-level metadata about a section in the binary. */
export interface SectionMeta {
  section: BinarySection;
  /** Byte offset of the section *body* (after the section ID and size LEB). */
  offset: number;
  /** Byte size of the section body. */
  size: number;
  /** Number of entries in the section (0 for custom/start). */
  count: number;
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

/** A complete decoded WebAssembly module. */
export interface Module {
  name: string;
  filename: string;
  loc: Location;

  // Type section
  types: TypeEntry[];

  // Imports (all external items, in declaration order)
  imports: Import[];

  // Defined items (in binary order; indices start after imports)
  functions: Func[];
  tables: Table[];
  memories: Memory[];
  globals: Global[];
  tags: Tag[];

  // Segments
  elements: ElemSegment[];
  dataSegments: DataSegment[];

  // Exports
  exports: Export[];

  // Start function (optional; absent when not present in module)
  start?: Var;

  // Custom sections
  customSections: Custom[];

  // Import counts (used to compute final index-space positions)
  numFuncImports: number;
  numTableImports: number;
  numMemoryImports: number;
  numGlobalImports: number;
  numTagImports: number;

  // Section layout metadata (byte offsets, sizes — for wasm-objdump)
  sectionMeta: SectionMeta[];

  /**
   * As-written metadata, held beside the tree rather than in its nodes.
   *
   * Read and written by wabt-ts's fidelity operations; dropped wholesale by
   * binaryen-ts's passes, because an optimized module has no original to be
   * faithful to. See `fidelity.ts`.
   */
  fidelity: FidelityTable;

  /**
   * Whether the module carries a `name` section even when it names nothing —
   * N1 (cmem/names.md).
   *
   * The binary writer writes one when this is set OR anything is named. True
   * from {@link makeModule}, so text and hand-built modules get upstream
   * `wat2wasm --debug-names`'s section even at `(module)`. The binary reader
   * sets it to whether the binary HAD one: a binary without names must
   * round-trip without gaining a section it never had.
   */
  hasNameSection: boolean;

  /**
   * Which functions the `name` section's LOCAL subsection listed, by index in
   * the function index space — imports first — N6 (cmem/divergences.md).
   *
   * 🔧 The writer listed EVERY function, which is upstream `wat2wasm
   * --debug-names`'s shape and right for a module we assembled. A producer
   * (clang, rustc, zig) lists only the functions that HAVE a named local, so
   * re-encoding one gained entries it never had: 9 of 9 real WASI binaries with
   * a name section differed by those bytes and nothing else.
   *
   * - **absent** — not read from a name section: list every function, as
   *   upstream does. Text and hand-built modules take this path.
   * - **a set** — list exactly these, even if it is empty (a subsection that
   *   listed nobody is `02 01 00`, not nothing).
   * - **`null`** — the section had NO local subsection: write none.
   */
  localNamesListed?: ReadonlySet<number> | null;

  /**
   * Whether the module was READ with a DataCount section (id 12) — W6.
   *
   * The writer emits one when a function body names a data segment
   * (`memory.init`, `data.drop`, `array.new_data`, `array.init_data`), which is
   * when the format REQUIRES it and exactly when upstream `wat2wasm` and
   * `wasm-tools` write it — or when this is set, so a binary that carried one
   * it did not need round-trips with it. False from {@link makeModule}: text has
   * no way to ask for one.
   */
  hasDataCountSection: boolean;

  // Features used by this module (tracked during decode)
  featuresUsed: {
    simd: boolean;
    exceptions: boolean;
    threads: boolean;
    tailcall: boolean;
    gc: boolean;
  };
}

/** Returns an empty, zeroed Module ready to be populated by a reader. */
export function makeModule(): Module {
  return {
    name: '',
    filename: '',
    loc: { filename: '', line: 0, column: 0, offset: 0 },
    types: [],
    imports: [],
    functions: [],
    tables: [],
    memories: [],
    globals: [],
    tags: [],
    elements: [],
    dataSegments: [],
    exports: [],
    customSections: [],
    numFuncImports: 0,
    numTableImports: 0,
    numMemoryImports: 0,
    numGlobalImports: 0,
    numTagImports: 0,
    sectionMeta: [],
    fidelity: new FidelityTable(),
    hasNameSection: true,
    hasDataCountSection: false,
    featuresUsed: { simd: false, exceptions: false, threads: false, tailcall: false, gc: false },
  };
}

/** Total number of functions in index space (imports + defined). */
export function totalFuncs(m: Module): number {
  return m.numFuncImports + m.functions.length;
}
/** Total number of tables in index space (imports + defined). */
export function totalTables(m: Module): number {
  return m.numTableImports + m.tables.length;
}
/** Total number of memories in index space (imports + defined). */
export function totalMemories(m: Module): number {
  return m.numMemoryImports + m.memories.length;
}
/** Total number of globals in index space (imports + defined). */
export function totalGlobals(m: Module): number {
  return m.numGlobalImports + m.globals.length;
}
/** Total number of tags in index space (imports + defined). */
export function totalTags(m: Module): number {
  return m.numTagImports + m.tags.length;
}
