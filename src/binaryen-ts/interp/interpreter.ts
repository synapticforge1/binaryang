/**
 * @module binaryen-ts/interp/interpreter
 *
 * The interpreter (open-work 23, stage E3): runs a module's functions over the
 * IR, for `wasm-ctor-eval`, a `wasm-interp` CLI and tests. Numbers go through
 * the evaluator's numeric core (`numeric.ts`), so a value is computed exactly as
 * OptimizeInstructions and Precompute fold it.
 *
 * **A stack machine over the tree.** Each node pushes its results onto ONE value
 * stack; a node pops one value per operand it takes. The reader is byte-faithful,
 * so a body may still hold a `pop` — a value an earlier instruction left on the
 * stack, a multi-result producer's earlier values, a block parameter — and here
 * a `pop` is simply nothing: the value is already on the stack where the
 * consumer takes it. A branch carries the top values its TARGET takes (a block's
 * results, a loop's parameters, the function's results), however they came to
 * be on the stack.
 *
 * **Two ways to stop, never confused:**
 * - {@link Trap} — the program trapped, as an engine would (the spec testsuite's
 *   wording: `integer divide by zero`, `unreachable`, `call stack exhausted`);
 * - {@link Stop} — the interpreter cannot go on: a host function it was not
 *   given, an instruction it does not run yet, or its fuel ran out. Never a
 *   result about the program — a caller that evaluates at compile time keeps
 *   the code as it was.
 *
 * Runs today: numeric code, locals, globals, control flow (`block`, `loop`,
 * `if`, `br`, `br_if`, `br_table`, `return`, `select`, `drop`), direct calls,
 * host functions (E3a); linear memory — loads, stores, `memory.*`, data
 * segments, imported and exported memories (E3b, `memory.ts`). Everything else
 * is a {@link Stop} — tables, references, exceptions, GC, atomics and `v128`
 * come in later increments.
 *
 * @license MIT
 */

import {
  blockParamsOf,
  type Expression,
  ExpressionKind,
  labelName,
  type Literal,
} from '../ir/expressions.ts';
import type { WasmFunction, WasmModule } from '../ir/module.ts';
import { ValType } from '../ir/types.ts';
import { ExternalKind } from '../../wabt-ts/core/binary.ts';
import {
  type BlockResult,
  type FuncSignature,
  sigEquals,
  type ValueType,
  type Var,
} from '../../wabt-ts/ir/ir.ts';
import { isRef } from '../ir/types.ts';
import { loadShape, storeShape } from '../ir/memory-access.ts';
import { evalBinary, evalUnary } from './numeric.ts';
import { MemoryCell, OutOfBounds, TooLarge } from './memory.ts';
import { TableCell, TableOutOfBounds, TableTooLarge } from './table.ts';

export { MemoryCell } from './memory.ts';
export { TableCell } from './table.ts';

// ---------------------------------------------------------------------------
// Values and outcomes
// ---------------------------------------------------------------------------

/**
 * A function reference: the instance that defines (or imports) the function,
 * its index there, and its signature — what `call_indirect` checks. Calling it
 * runs in its OWN instance, whichever module's table it came through.
 */
export interface FuncRef {
  readonly owner: Interpreter;
  readonly index: number;
  readonly sig: FuncSignature;
}

/**
 * A reference value (E3c): `null` — one null, whatever its heap type, since
 * nothing observes the difference at run time — a function, or an extern
 * value the host supplied (compared by identity).
 */
export type Ref =
  | { readonly type: 'ref'; readonly kind: 'null' }
  | { readonly type: 'ref'; readonly kind: 'func'; readonly func: FuncRef }
  | { readonly type: 'ref'; readonly kind: 'extern'; readonly host: unknown };

/** The null reference. */
export const NULL: Ref = { type: 'ref', kind: 'null' };

/** A runtime value: a number (`Literal`) or a reference. */
export type Value = Literal | Ref;

const isNumber = (v: Value): v is Literal => v.type !== 'ref';

/** The program trapped. `message` is the spec testsuite's wording. */
export class Trap extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Trap';
  }
}

/** Why the interpreter could not go on — never a statement about the program. */
export type StopReason = 'host' | 'unsupported' | 'fuel';

/** The interpreter cannot go on; see {@link StopReason}. */
export class Stop extends Error {
  constructor(readonly reason: StopReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = 'Stop';
  }
}

/** A function the host supplies for an import: arguments in, results out. */
export type HostFunction = (args: Value[]) => Value[];

/**
 * A global's storage. An imported global IS the exporter's cell, not a copy:
 * a write to a mutable one through either module is seen by both (🔧 it was
 * copied, and spec `linking.wast`'s `Mg.mut_glob` read 142 for 241).
 */
export interface GlobalCell {
  value: Value;
}

/** What the host supplies for one import, by its kind. */
export type HostImport =
  | { kind: 'func'; call: HostFunction }
  | { kind: 'global'; cell: GlobalCell }
  | { kind: 'memory'; cell: MemoryCell }
  | { kind: 'table'; cell: TableCell<Value> };

/** Options for {@link Interpreter}. */
export interface InterpreterOptions {
  /** Supplies an import, or `undefined`: a call to a missing function is a {@link Stop}. */
  imports?: (module: string, field: string) => HostImport | undefined;
  /** Nested calls before `call stack exhausted`. Default 1,000. */
  maxDepth?: number;
  /** Instructions to run before stopping with `fuel`. Default: unlimited. */
  fuel?: number;
}

// ---------------------------------------------------------------------------
// Control transfer (thrown, not Errors: no stack trace to capture)
// ---------------------------------------------------------------------------

class Branch {
  constructor(readonly label: string) {}
}
class Return {}
const RETURN = new Return();
/** A `return_call*`: the current frame is replaced by a call to `func`. */
class TailCall {
  constructor(readonly func: FuncRef, readonly args: Value[]) {}
}

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

type FuncSlot =
  | { kind: 'defined'; fn: WasmFunction; sig: FuncSignature }
  | { kind: 'host'; name: string; call: HostFunction | undefined; sig: FuncSignature };

const EMPTY = new Uint8Array(0);

/** An address operand, unsigned: an `i32` read `>>> 0`, an `i64` as `asUintN(64)`. */
function address(v: Value): bigint {
  if (v.type === ValType.I32) return BigInt(v.value >>> 0);
  if (v.type === ValType.I64) return BigInt.asUintN(64, v.value);
  throw new Error('interp: an address must be i32 or i64');
}

/** A memory size or grow result, in the memory's address type. */
const sizeValue = (n: bigint, is64: boolean): Value =>
  is64
    ? { type: ValType.I64, value: BigInt.asIntN(64, n) }
    : { type: ValType.I32, value: Number(BigInt.asIntN(32, n)) };

/** Runs a memory operation; an access out of bounds is the spec's trap, too large a Stop. */
function memoryOp<T>(run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof OutOfBounds) throw new Trap('out of bounds memory access');
    if (e instanceof TooLarge) throw new Stop('unsupported', e.message);
    throw e;
  }
}

/** Runs a table operation; an access out of bounds is the spec's trap, too large a Stop. */
function tableOp<T>(run: () => T): T {
  try {
    return run();
  } catch (e) {
    if (e instanceof TableOutOfBounds) throw new Trap('out of bounds table access');
    if (e instanceof TableTooLarge) throw new Stop('unsupported', e.message);
    throw e;
  }
}

/** Whether a signature mentions a typed (concrete) reference — compared by identity in E3d. */
const hasTypedRefs = (sig: FuncSignature): boolean =>
  [...sig.params, ...sig.results].some((t) => typeof t === 'object');

/** `ref.eq`: both null, or the same object. */
function sameRef(a: Value, b: Value): boolean {
  if (a.type !== 'ref' || b.type !== 'ref') throw new Error('interp: ref.eq of a non-reference');
  if (a.kind === 'null' || b.kind === 'null') return a.kind === b.kind;
  if (a.kind === 'extern' && b.kind === 'extern') return a.host === b.host;
  return a === b;
}

/** A load's bytes as its value. */
function readValue(mem: MemoryCell, at: number, opcode: number): Value {
  const { bytes, signed, type } = loadShape(opcode);
  const v = mem.view;
  switch (type) {
    case ValType.I32:
      return {
        type,
        value: bytes === 1
          ? (signed ? v.getInt8(at) : v.getUint8(at))
          : bytes === 2
          ? (signed ? v.getInt16(at, true) : v.getUint16(at, true))
          : v.getInt32(at, true),
      };
    case ValType.I64:
      return {
        type,
        value: bytes === 8 ? v.getBigInt64(at, true) : BigInt(
          bytes === 1
            ? (signed ? v.getInt8(at) : v.getUint8(at))
            : bytes === 2
            ? (signed ? v.getInt16(at, true) : v.getUint16(at, true))
            : (signed ? v.getInt32(at, true) : v.getUint32(at, true)),
        ),
      };
    case ValType.F32:
      return { type, bits: v.getUint32(at, true) };
    case ValType.F64:
      return { type, bits: v.getBigUint64(at, true) };
    default:
      throw new Stop('unsupported', 'a v128 load');
  }
}

/** A store's value as its bytes — the low `bytes` of it for a narrow store. */
function writeValue(mem: MemoryCell, at: number, opcode: number, value: Value): void {
  const { bytes } = storeShape(opcode);
  const v = mem.view;
  switch (value.type) {
    case ValType.I32:
      if (bytes === 1) v.setUint8(at, value.value & 0xff);
      else if (bytes === 2) v.setUint16(at, value.value & 0xffff, true);
      else v.setUint32(at, value.value >>> 0, true);
      return;
    case ValType.I64:
      if (bytes === 8) v.setBigUint64(at, BigInt.asUintN(64, value.value), true);
      else {
        const low = Number(BigInt.asUintN(bytes * 8, value.value));
        if (bytes === 1) v.setUint8(at, low);
        else if (bytes === 2) v.setUint16(at, low, true);
        else v.setUint32(at, low, true);
      }
      return;
    case ValType.F32:
      v.setUint32(at, value.bits >>> 0, true);
      return;
    case ValType.F64:
      v.setBigUint64(at, BigInt.asUintN(64, value.bits), true);
      return;
    default:
      throw new Stop('unsupported', 'a v128 store');
  }
}

/** The zero a local of `type` starts with; `undefined` for a type not run yet. */
function zeroOf(type: ValueType): Value | undefined {
  switch (type) {
    case ValType.I32:
      return { type: ValType.I32, value: 0 };
    case ValType.I64:
      return { type: ValType.I64, value: 0n };
    case ValType.F32:
      return { type: ValType.F32, bits: 0 };
    case ValType.F64:
      return { type: ValType.F64, bits: 0n };
    default:
      // A reference local starts null. (A non-nullable one is set before any
      // read — validation's guarantee — so its start value is never seen.)
      return isRef(type) ? NULL : undefined;
  }
}

const arityOf = (
  t: BlockResult | string,
): number => (t === 'none' || t === 'unreachable' ? 0 : Array.isArray(t) ? t.length : 1);

function resolve<T>(v: Var, slots: T[], names: string[], what: string): T {
  const i = v.kind === 'index' ? v.value : names.indexOf(v.name);
  const slot = slots[i];
  if (slot === undefined) {
    throw new Error(`interp: unknown ${what} ${v.kind === 'index' ? v.value : v.name}`);
  }
  return slot;
}

/**
 * One instantiated module. Instantiation evaluates the global initialisers and
 * runs the start function, which may trap or stop like any call.
 */
export class Interpreter {
  private readonly funcs: FuncSlot[] = [];
  private readonly funcNames: string[] = [];
  private readonly globals: GlobalCell[] = [];
  private readonly globalNames: string[] = [];
  private readonly memories: MemoryCell[] = [];
  private readonly memoryNames: string[] = [];
  /** Each data segment's bytes; a dropped one is empty. */
  private readonly data: Uint8Array[] = [];
  private readonly tables: TableCell<Value>[] = [];
  private readonly tableNames: string[] = [];
  /** Each element segment's references; a dropped one is empty. */
  private readonly elems: Value[][] = [];
  private readonly stack: Value[] = [];
  private readonly maxDepth: number;
  /** Whether this module declares a rec group or explicit subtyping — types then match by identity. */
  readonly nominal: boolean;
  private depth = 0;
  private fuel: number;

  constructor(readonly module: WasmModule, options: InterpreterOptions = {}) {
    this.maxDepth = options.maxDepth ?? 1000;
    this.nominal = module.types.some((t) => t.sub !== undefined || (t.recGroupSize ?? 0) > 0);
    this.fuel = options.fuel ?? Infinity;
    const host = options.imports ?? (() => undefined);

    for (const imp of module.imports) {
      if (imp.kind === ExternalKind.Func) {
        const h = host(imp.module, imp.field);
        this.funcs.push({
          kind: 'host',
          name: `${imp.module}.${imp.field}`,
          call: h?.kind === 'func' ? h.call : undefined,
          sig: imp.func.sig,
        });
        this.funcNames.push(imp.func.name);
      } else if (imp.kind === ExternalKind.Global) {
        const h = host(imp.module, imp.field);
        if (h?.kind !== 'global') throw new Stop('host', `global ${imp.module}.${imp.field}`);
        this.globals.push(h.cell);
        this.globalNames.push(imp.global.name);
      } else if (imp.kind === ExternalKind.Memory) {
        const h = host(imp.module, imp.field);
        if (h?.kind !== 'memory') throw new Stop('host', `memory ${imp.module}.${imp.field}`);
        this.memories.push(h.cell);
        this.memoryNames.push(imp.memory.name);
      } else if (imp.kind === ExternalKind.Table) {
        const h = host(imp.module, imp.field);
        if (h?.kind !== 'table') throw new Stop('host', `table ${imp.module}.${imp.field}`);
        this.tables.push(h.cell);
        this.tableNames.push(imp.table.name);
      }
      // An imported tag is not set up yet (E3d): a throw or catch of one stops.
    }
    for (const fn of module.functions) {
      this.funcs.push({ kind: 'defined', fn, sig: fn.sig });
      this.funcNames.push(fn.name);
    }
    for (const m of module.memories) {
      if (m.limits.isShared) throw new Stop('unsupported', 'a shared memory');
      try {
        this.memories.push(new MemoryCell(m.limits));
      } catch (e) {
        if (e instanceof TooLarge) throw new Stop('unsupported', e.message);
        throw e;
      }
      this.memoryNames.push(m.name);
    }
    for (const g of module.globals) {
      // An initialiser is a constant expression: it may read the globals
      // before it, and nothing else this interpreter cannot run.
      const [value] = this.evaluate(g.init?.children ?? [], 1);
      this.globals.push({ value: value! });
      this.globalNames.push(g.name);
    }
    // Tables, each filled with its initialiser or null (E3c).
    for (const t of module.tables) {
      const [init] = t.init === undefined ? [NULL] : this.evaluate(t.init.children, 1);
      this.tables.push(tableOp(() => new TableCell<Value>(t.limits, init!)));
      this.tableNames.push(t.name);
    }
    // Element segments: every one's references are computed now; an active one
    // is written and dropped, a declared one only dropped; one out of bounds
    // traps, keeping what the segments before it wrote — the same order as data.
    for (const s of module.elements) {
      this.elems.push(s.elemExprs.map((r) => this.evaluate(r.children, 1)[0]!));
      if (s.kind === 'passive') continue;
      if (s.kind === 'active') {
        const [offset] = this.evaluate(s.offset?.children ?? [], 1);
        const table = resolve(s.tableVar, this.tables, this.tableNames, 'table');
        const refs = this.elems[this.elems.length - 1]!;
        tableOp(() => table.init(address(offset!), refs, 0n, BigInt(refs.length)));
      }
      this.elems[this.elems.length - 1] = [];
    }
    // Data segments, in order: an active one is written and then dropped; one
    // out of bounds traps, keeping what the segments before it wrote (the
    // spec's order since bulk memory — observable through a shared memory).
    for (const d of module.dataSegments) {
      this.data.push(d.data);
      if (d.kind !== 'active') continue;
      const [offset] = this.evaluate(d.offset?.children ?? [], 1);
      const mem = resolve(d.memoryVar, this.memories, this.memoryNames, 'memory');
      try {
        mem.init(address(offset!), d.data, 0n, BigInt(d.data.length));
      } catch (e) {
        if (e instanceof OutOfBounds) throw new Trap('out of bounds memory access');
        throw e;
      }
      this.data[this.data.length - 1] = EMPTY;
    }
    if (module.start !== undefined) {
      this.call(resolve(module.start, this.funcs, this.funcNames, 'function'), []);
    }
  }

  /** Calls the exported function `name` with `args`; throws {@link Trap} or {@link Stop}. */
  invoke(name: string, args: Value[]): Value[] {
    const ex = this.module.exports.find((e) => e.name === name && e.kind === ExternalKind.Func);
    if (ex === undefined) throw new Error(`interp: no exported function "${name}"`);
    return this.call(resolve(ex.var, this.funcs, this.funcNames, 'function'), args);
  }

  /** Sets the instructions left to run before a {@link Stop} with `fuel` — per call, for a caller that wants it. */
  refuel(fuel: number): void {
    this.fuel = fuel;
  }

  /** The current value of the exported global `name`. */
  global(name: string): Value {
    return this.globalCell(name).value;
  }

  /** The exported memory `name`'s cell — what another module importing it shares. */
  memoryCell(name: string): MemoryCell {
    const ex = this.module.exports.find((e) => e.name === name && e.kind === ExternalKind.Memory);
    if (ex === undefined) throw new Error(`interp: no exported memory "${name}"`);
    return resolve(ex.var, this.memories, this.memoryNames, 'memory');
  }

  /** The exported table `name`'s cell — what another module importing it shares. */
  tableCell(name: string): TableCell<Value> {
    const ex = this.module.exports.find((e) => e.name === name && e.kind === ExternalKind.Table);
    if (ex === undefined) throw new Error(`interp: no exported table "${name}"`);
    return resolve(ex.var, this.tables, this.tableNames, 'table');
  }

  /** Calls function `index` of this instance — how a {@link FuncRef} from any table runs. */
  callIndex(index: number, args: Value[]): Value[] {
    const f = this.funcs[index];
    if (f === undefined) throw new Error(`interp: no function ${index}`);
    return this.call(f, args);
  }

  /** What the export `name` is — for a host wiring one module's exports to another's imports. */
  exportKind(name: string): ExternalKind | undefined {
    return this.module.exports.find((e) => e.name === name)?.kind;
  }

  /** The exported global `name`'s cell — what another module importing it shares. */
  globalCell(name: string): GlobalCell {
    const ex = this.module.exports.find((e) => e.name === name && e.kind === ExternalKind.Global);
    if (ex === undefined) throw new Error(`interp: no exported global "${name}"`);
    return resolve(ex.var, this.globals, this.globalNames, 'global');
  }

  /** Runs `exprs` as a body with no locals and returns its top `results` values. */
  private evaluate(exprs: Expression[], results: number): Value[] {
    const base = this.stack.length;
    for (const e of exprs) this.exec(e, []);
    const out = this.stack.splice(this.stack.length - results);
    this.stack.length = base;
    return out;
  }

  private call(f: FuncSlot, args: Value[]): Value[] {
    // A loop, not recursion, for TAIL calls: a `return_call` replaces this
    // frame with its callee's, so a million-deep tail recursion runs in one
    // frame, as the spec requires (`return_call.wast` counts down from 10^6).
    for (;;) {
      if (f.kind === 'host') {
        if (f.call === undefined) throw new Stop('host', f.name);
        return f.call(args);
      }
      if (++this.depth > this.maxDepth) {
        this.depth--;
        throw new Trap('call stack exhausted');
      }
      const { fn, sig } = f;
      const locals: Value[] = [...args];
      for (let i = sig.params.length; i < fn.locals.length; i++) {
        const z = zeroOf(fn.locals[i]!.type);
        if (z === undefined) {
          this.depth--;
          throw new Stop('unsupported', `a local of type ${String(fn.locals[i]!.type)}`);
        }
        locals.push(z);
      }
      const base = this.stack.length;
      const n = sig.results.length;
      try {
        for (const e of fn.body.children) this.exec(e, locals);
      } catch (t) {
        if (t instanceof TailCall) {
          this.depth--;
          this.stack.length = base;
          if (t.func.owner !== this) return t.func.owner.callIndex(t.func.index, t.args);
          f = this.funcs[t.func.index]!;
          args = t.args;
          continue;
        }
        // A `return`, or a branch to the function's own frame, leaves with the
        // top values the function returns.
        const frame = t instanceof Branch && (t.label === '' || t.label === fn.bodyFrameLabel);
        if (t !== RETURN && !frame) {
          this.depth--;
          this.stack.length = base;
          // The host's own stack ran out first: to the program that is the same
          // exhaustion. 🔧 This tested the message with a regex, and at the
          // stack's limit the regex ITSELF overflowed (spec `fac.wast`'s
          // `fac-rec`). Whatever the test throws here propagates to the caller's
          // frame, which tries again with more room.
          if (t instanceof RangeError && t.message.includes('call stack')) {
            throw new Trap('call stack exhausted');
          }
          throw t;
        }
      }
      this.depth--;
      const results = this.stack.splice(this.stack.length - n, n);
      this.stack.length = base;
      return results;
    }
  }

  /** The function a reference names, or the trap a null one is. */
  private funcOf(r: Value, nullTrap: string): FuncRef {
    if (r.type !== 'ref') throw new Error('interp: expected a reference');
    if (r.kind === 'null') throw new Trap(nullTrap);
    if (r.kind !== 'func') throw new Error('interp: expected a function reference');
    return r.func;
  }

  /** Calls `func` with the top values of the stack — or, for a tail call, hands it to `call`. */
  private invokeRef(func: FuncRef, tail: boolean | undefined): void {
    const s = this.stack;
    const args = s.splice(s.length - func.sig.params.length);
    if (tail) throw new TailCall(func, args);
    s.push(
      ...(func.owner === this
        ? this.call(this.funcs[func.index]!, args)
        : func.owner.callIndex(func.index, args)),
    );
  }

  private pop(): Value {
    const v = this.stack.pop();
    if (v === undefined) throw new Error('interp: operand stack underflow');
    return v;
  }

  /** Pops a number — what every numeric operator takes. */
  private num(): Literal {
    const v = this.pop();
    if (!isNumber(v)) throw new Error('interp: expected a number, found a reference');
    return v;
  }

  private i32(): number {
    const v = this.pop();
    if (v.type !== ValType.I32) throw new Error('interp: expected an i32 operand');
    return v.value | 0;
  }

  /** Runs a labelled construct whose body is `run`; a branch to `label` ends it with `arity` values. */
  private scope(label: string, base: number, arity: number, run: () => void): void {
    try {
      run();
    } catch (t) {
      if (!(t instanceof Branch) || label === '' || t.label !== label) throw t;
    }
    const results = this.stack.splice(this.stack.length - arity, arity);
    this.stack.length = base;
    this.stack.push(...results);
  }

  private exec(e: Expression, locals: Value[]): void {
    if (--this.fuel < 0) throw new Stop('fuel', 'out of fuel');
    const s = this.stack;
    switch (e.kind) {
      case ExpressionKind.Nop:
      case ExpressionKind.Pop:
        return;

      case ExpressionKind.Const:
        s.push(e.value);
        return;

      case ExpressionKind.LocalGet:
        s.push(locals[(e.var as Extract<Var, { kind: 'index' }>).value]!);
        return;
      case ExpressionKind.LocalSet:
        this.exec(e.value, locals);
        locals[(e.var as Extract<Var, { kind: 'index' }>).value] = this.pop();
        return;
      case ExpressionKind.LocalTee: {
        this.exec(e.value, locals);
        const v = this.pop();
        locals[(e.var as Extract<Var, { kind: 'index' }>).value] = v;
        s.push(v);
        return;
      }

      case ExpressionKind.GlobalGet:
        s.push(resolve(e.var, this.globals, this.globalNames, 'global').value);
        return;
      case ExpressionKind.GlobalSet: {
        this.exec(e.value, locals);
        resolve(e.var, this.globals, this.globalNames, 'global').value = this.pop();
        return;
      }

      case ExpressionKind.Unary: {
        this.exec(e.value, locals);
        const r = evalUnary(e.opcode, this.num());
        if (r === null) throw new Stop('unsupported', `unary 0x${e.opcode.toString(16)}`);
        if ('trap' in r) throw new Trap(r.trap);
        s.push(r.value);
        return;
      }
      case ExpressionKind.Binary: {
        this.exec(e.left, locals);
        this.exec(e.right, locals);
        const b = this.num(), a = this.num();
        const r = evalBinary(e.opcode, a, b);
        if (r === null) throw new Stop('unsupported', `binary 0x${e.opcode.toString(16)}`);
        if ('trap' in r) throw new Trap(r.trap);
        s.push(r.value);
        return;
      }

      case ExpressionKind.Select: {
        this.exec(e.val1, locals);
        this.exec(e.val2, locals);
        this.exec(e.condition, locals);
        const c = this.i32(), b = this.pop(), a = this.pop();
        s.push(c !== 0 ? a : b);
        return;
      }
      case ExpressionKind.Drop:
        this.exec(e.value, locals);
        this.pop();
        return;

      case ExpressionKind.Region:
        for (const c of e.children) this.exec(c, locals);
        return;

      case ExpressionKind.Block: {
        const params = this.params(e, locals);
        const base = s.length - params;
        this.scope(e.label, base, arityOf(e.type as BlockResult), () => {
          for (const c of e.children) this.exec(c, locals);
        });
        return;
      }

      case ExpressionKind.Loop: {
        const params = this.params(e, locals);
        const base = s.length - params;
        const results = arityOf(e.type as BlockResult);
        for (;;) {
          try {
            this.exec(e.body, locals);
          } catch (t) {
            if (!(t instanceof Branch) || t.label !== e.label) throw t;
            // Back to the top, with the loop's parameters.
            const carried = s.splice(s.length - params, params);
            s.length = base;
            s.push(...carried);
            continue;
          }
          break;
        }
        const out = s.splice(s.length - results, results);
        s.length = base;
        s.push(...out);
        return;
      }

      case ExpressionKind.If: {
        const params = this.params(e, locals);
        this.exec(e.condition, locals);
        const c = this.i32();
        const base = s.length - params;
        const arm = c !== 0 ? e.ifTrue : e.ifFalse;
        this.scope(e.label, base, arityOf(e.type as BlockResult), () => {
          if (arm !== null) this.exec(arm, locals);
        });
        return;
      }

      case ExpressionKind.Break: {
        for (const v of e.values) this.exec(v, locals);
        if (e.condition !== undefined) {
          this.exec(e.condition, locals);
          if (this.i32() === 0) return; // falls through, its values left as its result
        }
        throw new Branch(labelName(e.target));
      }

      case ExpressionKind.Switch: {
        for (const v of e.values) this.exec(v, locals);
        this.exec(e.condition, locals);
        const i = this.i32() >>> 0;
        throw new Branch(labelName(i < e.targets.length ? e.targets[i]! : e.defaultTarget));
      }

      case ExpressionKind.Return:
        for (const v of e.values) this.exec(v, locals);
        throw RETURN;

      case ExpressionKind.Unreachable:
        throw new Trap('unreachable');

      case ExpressionKind.Call: {
        for (const o of e.operands) this.exec(o, locals);
        this.invokeRef(this.funcRef(e.func), e.isReturn);
        return;
      }

      // -------------------------------------------------------------------
      // References and tables (E3c)
      // -------------------------------------------------------------------
      case ExpressionKind.CallIndirect: {
        for (const o of e.operands) this.exec(o, locals);
        this.exec(e.callee, locals);
        const table = this.table(e.table);
        const i = address(this.pop());
        // The spec's order: an index past the end, then an empty slot, then a
        // signature that does not match.
        if (i >= table.size) throw new Trap('undefined element');
        // The reference interpreter names the slot (`uninitialized element 2`);
        // the suite expects both that and the bare prefix.
        const func = this.funcOf(table.get(i), `uninitialized element ${i}`);
        // Since GC, function types match by IDENTITY — rec-group
        // canonicalisation and declared subtyping — not by shape: two `(func)`
        // types in different rec groups differ, and a subtype matches its
        // supertype (`type-rec.wast`, `type-subtyping.wast`). Without either in
        // play the structural comparison IS the spec's; with them, E3d decides.
        if (this.nominal || func.owner.nominal || hasTypedRefs(e.sig) || hasTypedRefs(func.sig)) {
          throw new Stop(
            'unsupported',
            'call_indirect type identity (rec groups, subtypes, typed refs)',
          );
        }
        if (!sigEquals(func.sig, e.sig)) throw new Trap('indirect call type mismatch');
        this.invokeRef(func, e.isReturn);
        return;
      }
      case ExpressionKind.CallRef: {
        for (const o of e.operands) this.exec(o, locals);
        this.exec(e.callee, locals);
        this.invokeRef(this.funcOf(this.pop(), 'null function reference'), e.isReturn);
        return;
      }
      case ExpressionKind.RefNull:
        s.push(NULL);
        return;
      case ExpressionKind.RefFunc:
        s.push({ type: 'ref', kind: 'func', func: this.funcRef(e.func) });
        return;
      case ExpressionKind.RefIsNull: {
        this.exec(e.value, locals);
        const r = this.pop();
        s.push({ type: ValType.I32, value: r.type === 'ref' && r.kind === 'null' ? 1 : 0 });
        return;
      }
      case ExpressionKind.RefAs: {
        this.exec(e.value, locals);
        const r = this.pop();
        if (r.type === 'ref' && r.kind === 'null') throw new Trap('null reference');
        s.push(r);
        return;
      }
      case ExpressionKind.RefEq: {
        this.exec(e.left, locals);
        this.exec(e.right, locals);
        const b = this.pop(), a = this.pop();
        s.push({ type: ValType.I32, value: sameRef(a, b) ? 1 : 0 });
        return;
      }
      case ExpressionKind.TableGet: {
        this.exec(e.index, locals);
        const table = this.table(e.table);
        const i = address(this.pop());
        s.push(tableOp(() => table.get(i)));
        return;
      }
      case ExpressionKind.TableSet: {
        this.exec(e.index, locals);
        this.exec(e.value, locals);
        const table = this.table(e.table);
        const v = this.pop(), i = address(this.pop());
        tableOp(() => table.set(i, v));
        return;
      }
      case ExpressionKind.TableSize: {
        const table = this.table(e.table);
        s.push(sizeValue(table.size, table.is64));
        return;
      }
      case ExpressionKind.TableGrow: {
        this.exec(e.value, locals);
        this.exec(e.delta, locals);
        const table = this.table(e.table);
        const delta = address(this.pop()), init = this.pop();
        s.push(sizeValue(tableOp(() => table.grow(delta, init)), table.is64));
        return;
      }
      case ExpressionKind.TableFill: {
        this.exec(e.dest, locals);
        this.exec(e.value, locals);
        this.exec(e.size, locals);
        const table = this.table(e.table);
        const n = address(this.pop()), v = this.pop(), dest = address(this.pop());
        tableOp(() => table.fill(dest, v, n));
        return;
      }
      case ExpressionKind.TableCopy: {
        this.exec(e.dest, locals);
        this.exec(e.source, locals);
        this.exec(e.size, locals);
        const to = this.table(e.destTable), from = this.table(e.sourceTable);
        const n = address(this.pop()), src = address(this.pop()), dest = address(this.pop());
        tableOp(() => TableCell.copy(to, dest, from, src, n));
        return;
      }
      case ExpressionKind.TableInit: {
        this.exec(e.dest, locals);
        this.exec(e.source, locals);
        this.exec(e.size, locals);
        const table = this.table(e.table);
        const refs = resolve(
          e.segment,
          this.elems,
          this.module.elements.map((s) => s.name),
          'element segment',
        );
        const n = address(this.pop()), src = address(this.pop()), dest = address(this.pop());
        tableOp(() => table.init(dest, refs, src, n));
        return;
      }
      case ExpressionKind.ElemDrop: {
        const names = this.module.elements.map((s) => s.name);
        const i = e.segment.kind === 'index' ? e.segment.value : names.indexOf(e.segment.name);
        if (this.elems[i] === undefined) throw new Error('interp: unknown element segment');
        this.elems[i] = [];
        return;
      }

      // -------------------------------------------------------------------
      // Linear memory (E3b)
      // -------------------------------------------------------------------
      case ExpressionKind.Load: {
        this.exec(e.address, locals);
        const mem = this.memory(e.memidx);
        const shape = loadShape(e.opcode);
        const at = memoryOp(() => mem.at(address(this.pop()), e.offset, shape.bytes));
        s.push(readValue(mem, at, e.opcode));
        return;
      }
      case ExpressionKind.Store: {
        this.exec(e.address, locals);
        this.exec(e.value, locals);
        const mem = this.memory(e.memidx);
        const value = this.pop();
        const at = memoryOp(() =>
          mem.at(address(this.pop()), e.offset, storeShape(e.opcode).bytes)
        );
        writeValue(mem, at, e.opcode, value);
        return;
      }
      case ExpressionKind.MemorySize: {
        const mem = this.memory(e.memidx);
        s.push(sizeValue(mem.pages, mem.is64));
        return;
      }
      case ExpressionKind.MemoryGrow: {
        this.exec(e.delta, locals);
        const mem = this.memory(e.memidx);
        const delta = address(this.pop());
        s.push(sizeValue(memoryOp(() => mem.grow(delta)), mem.is64));
        return;
      }
      case ExpressionKind.MemoryFill: {
        this.exec(e.dest, locals);
        this.exec(e.value, locals);
        this.exec(e.size, locals);
        const mem = this.memory(e.memidx);
        const n = address(this.pop()), value = this.i32(), dest = address(this.pop());
        memoryOp(() => mem.fill(dest, value, n));
        return;
      }
      case ExpressionKind.MemoryCopy: {
        this.exec(e.dest, locals);
        this.exec(e.source, locals);
        this.exec(e.size, locals);
        const to = this.memory(e.destMemidx), from = this.memory(e.srcMemidx);
        // The size is in the SMALLER address type of the two (memory64).
        const n = address(this.pop()), src = address(this.pop()), dest = address(this.pop());
        memoryOp(() => MemoryCell.copy(to, dest, from, src, n));
        return;
      }
      case ExpressionKind.MemoryInit: {
        this.exec(e.dest, locals);
        this.exec(e.source, locals);
        this.exec(e.size, locals);
        const mem = this.memory(e.memidx);
        const data = resolve(e.segment, this.data, this.dataNames(), 'data segment');
        const n = address(this.pop()), src = address(this.pop()), dest = address(this.pop());
        memoryOp(() => mem.init(dest, data, src, n));
        return;
      }
      case ExpressionKind.DataDrop: {
        const i = e.segment.kind === 'index'
          ? e.segment.value
          : this.dataNames().indexOf(e.segment.name);
        if (this.data[i] === undefined) throw new Error('interp: unknown data segment');
        this.data[i] = EMPTY;
        return;
      }

      default:
        throw new Stop('unsupported', e.kind);
    }
  }

  private table(v: Var): TableCell<Value> {
    if (this.tables.length === 0) throw new Error('interp: no table');
    return resolve(v, this.tables, this.tableNames, 'table');
  }

  /** A reference to this instance's function `v`. */
  private funcRef(v: Var): FuncRef {
    const index = v.kind === 'index' ? v.value : this.funcNames.indexOf(v.name);
    const slot = this.funcs[index];
    if (slot === undefined) {
      throw new Error(`interp: unknown function ${v.kind === 'index' ? v.value : v.name}`);
    }
    return { owner: this, index, sig: slot.sig };
  }

  private memory(v: Var): MemoryCell {
    if (this.memories.length === 0) throw new Error('interp: no memory');
    return resolve(v, this.memories, this.memoryNames, 'memory');
  }

  private dataNames(): string[] {
    return this.module.dataSegments.map((d) => d.name);
  }

  /** Evaluates a carrier's parameter values; returns how many it takes. */
  private params(e: Expression, locals: Value[]): number {
    const p = blockParamsOf(e);
    if (p === undefined) return 0;
    for (const v of p.values) this.exec(v, locals);
    return p.types.length;
  }
}
