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
import type { BlockResult, FuncSignature, ValueType, Var } from '../../wabt-ts/ir/ir.ts';
import { loadShape, storeShape } from '../ir/memory-access.ts';
import { evalBinary, evalUnary } from './numeric.ts';
import { MemoryCell, OutOfBounds, TooLarge } from './memory.ts';

export { MemoryCell } from './memory.ts';

// ---------------------------------------------------------------------------
// Values and outcomes
// ---------------------------------------------------------------------------

/** A runtime value. Numbers only in E3a; references join with E3c. */
export type Value = Literal;

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
  | { kind: 'memory'; cell: MemoryCell };

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
      return undefined;
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
  private readonly stack: Value[] = [];
  private readonly maxDepth: number;
  private depth = 0;
  private fuel: number;

  constructor(readonly module: WasmModule, options: InterpreterOptions = {}) {
    this.maxDepth = options.maxDepth ?? 1000;
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
      }
      // An imported table or tag is not set up yet (E3c / E3d): an instruction
      // that uses one stops; a module that only declares one still runs.
    }
    // An active element segment writes a table at instantiation, and may trap
    // doing it: skipping it would set up a different module (E3c runs it).
    if (module.elements.some((s) => s.kind === 'active')) {
      throw new Stop('unsupported', 'an active element segment');
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
        throw new Stop('unsupported', `a local of type ${String(fn.locals[i]!.type)}`);
      }
      locals.push(z);
    }
    const base = this.stack.length;
    const n = sig.results.length;
    try {
      for (const e of fn.body.children) this.exec(e, locals);
    } catch (t) {
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

  private pop(): Value {
    const v = this.stack.pop();
    if (v === undefined) throw new Error('interp: operand stack underflow');
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
        const r = evalUnary(e.opcode, this.pop());
        if (r === null) throw new Stop('unsupported', `unary 0x${e.opcode.toString(16)}`);
        if ('trap' in r) throw new Trap(r.trap);
        s.push(r.value);
        return;
      }
      case ExpressionKind.Binary: {
        this.exec(e.left, locals);
        this.exec(e.right, locals);
        const b = this.pop(), a = this.pop();
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
        if (e.isReturn) throw new Stop('unsupported', 'return_call');
        for (const o of e.operands) this.exec(o, locals);
        const f = resolve(e.func, this.funcs, this.funcNames, 'function');
        const args = s.splice(s.length - f.sig.params.length);
        s.push(...this.call(f, args));
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
