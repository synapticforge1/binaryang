// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: src/wat-writer.cc, include/wabt/wat-writer.h
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * IR-to-WAT pretty printer.
 *
 * Converts a decoded {@link Module} IR into WebAssembly Text Format (WAT).
 * Output is linear (non-folded) WAT — each instruction on its own line,
 * children written before their parent (matching the stack-machine model).
 *
 * Usage:
 * ```ts
 * const wat = writeWatModule(module);
 * ```
 */

import type {
  BlockType,
  Catch,
  Const,
  Custom,
  DataSegment,
  ElemSegment,
  Export,
  Expr,
  Field,
  Func,
  FuncSignature,
  Global,
  Import,
  Limits,
  LocalDecl,
  Memory,
  Module,
  Table,
  TableCatch,
  Tag,
  TypeEntry,
  Var,
} from '../ir/ir.ts';
import { ExternalKind } from '../core/binary.ts';
import { Type, typeName } from '../core/types.ts';
import { isRefValueType, recGroups, type ValueType } from '../ir/ir.ts';
import { printF32Literal, printF64Literal } from '../core/literal.ts';
import { anyOpcodeName, naturalAlignForOpcode, PREFIX_THREADS } from '../core/opcode.ts';
import { LabelType, ModuleContext } from '../ir/ir-util.ts';
import { ExprVisitor } from '../ir/expr-visitor.ts';
import type { ExprVisitorDelegate } from '../ir/expr-visitor.ts';
import { Result } from '../core/result.ts';

// UTF-8 encoder reused for every writeQuotedString call. Stateless, so a
// single module-level instance is safe and avoids reallocating per string.
const TEXT_ENCODER = new TextEncoder();

// ---------------------------------------------------------------------------
// Public options & entry point
// ---------------------------------------------------------------------------

/** Options for {@link writeWatModule}. */
export interface WriteWatOptions {
  /**
   * Emit folded s-expressions where possible instead of a flat instruction
   * sequence. Default: `false` (linear).
   *
   * Both spellings assemble to identical bytes — folding is text-layer only —
   * so this changes readability, not the module.
   *
   * Measured on THIS writer's output over the 421-file corpus: folded is
   * **23.6% smaller** and ~9% slower to re-parse. (An earlier note said folded
   * was 28% *larger* and 25% slower — that was measured on upstream wabt's
   * rendering, whose linear form is far more compact than ours. Ours puts one
   * instruction per line, so folding compacts it.)
   *
   * 🔧 Folded became the DEFAULT in 1.5.4. Linear is the form the binary maps
   * onto one-for-one, which is why it held the default — but it is not the form
   * the ecosystem reads, and nothing that consumes folded WAT could consume our
   * output. Linear remains fully supported for inspecting execution order,
   * since it is the stack machine as written.
   *
   * Nodes that cannot be folded fall back to linear individually, so output is
   * mixed rather than uniformly folded — which is what upstream wabt produces
   * too.
   */
  fold?: boolean;
  /** Emit `(export "name")` inline inside func/global/table/memory declarations. Default: `true`. */
  inlineExport?: boolean;
  /** Emit `(import "m" "f")` inline inside declarations instead of standalone. Default: `false`. */
  inlineImport?: boolean;
}

/**
 * Convert a decoded WebAssembly {@link Module} to a WAT string.
 */
export function writeWatModule(module: Module, options: WriteWatOptions = {}): string {
  const writer = new WatWriter(module, options);
  return writer.writeModule();
}

// ---------------------------------------------------------------------------
// Char escape tables
// ---------------------------------------------------------------------------

// Bytes that must be escaped as \XX in WAT string literals.
const IS_CHAR_ESCAPED: Uint8Array = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 32; i++) t[i] = 1; // control chars
  t[0x22] = 1; // "
  t[0x5c] = 1; // backslash
  for (let i = 0x7f; i < 256; i++) t[i] = 1; // non-ASCII
  return t;
})();

// Characters permitted in a WAT identifier ($name) without quoting.
// Matches s_valid_name_chars in wat-writer.cc.
const VALID_NAME_CHARS: Uint8Array = (() => {
  const t = new Uint8Array(256);
  const allow =
    "!#$%&'*+-./:<=>?@\\^_`|~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  for (const c of allow) t[c.charCodeAt(0)] = 1;
  return t;
})();

// ---------------------------------------------------------------------------
// Next-char state (controls spacing between tokens)
// ---------------------------------------------------------------------------

const enum NC {
  None,
  Space,
  Newline,
  ForceNewline,
}

// ---------------------------------------------------------------------------
// WatWriter
// ---------------------------------------------------------------------------

class WatWriter extends ModuleContext {
  private readonly opts: Required<WriteWatOptions>;

  // Output buffer
  private out: string[] = [];

  // Whitespace control
  private indent = 0;
  private nextChar: NC = NC.None;

  // Per-kind index counters (absolute, across imports + definitions)
  private funcIdx = 0;
  private globalIdx = 0;
  private tableIdx = 0;
  private memoryIdx = 0;
  private typeIdx = 0;
  private tagIdx = 0;
  private dataSegIdx = 0;
  private elemSegIdx = 0;

  // Inline export map: "kind:index" → Export[]
  private readonly exportMap = new Map<string, Export[]>();

  // Name → absolute index map keyed by "kind:name". Built once and used by
  // resolveVarIndex to avoid linearly scanning imports + defs for every
  // name-based Var; the writer touches resolveVarIndex once per export plus
  // once per inline-export check, so the previous O(imports+defs) scan grew
  // quadratic on modules with many exports.
  private readonly nameIndexMap = new Map<string, number>();

  constructor(module: Module, opts: WriteWatOptions) {
    super(module);
    this.opts = {
      fold: opts.fold ?? true,
      inlineExport: opts.inlineExport ?? true,
      inlineImport: opts.inlineImport ?? false,
    };
    this.buildNameIndexMap();
  }

  private buildNameIndexMap(): void {
    const counts: Partial<Record<ExternalKind, number>> = {};
    const bump = (kind: ExternalKind): number => {
      const n = counts[kind] ?? 0;
      counts[kind] = n + 1;
      return n;
    };
    const record = (kind: ExternalKind, name: string): void => {
      const idx = bump(kind);
      if (name) this.nameIndexMap.set(`${kind}:${name}`, idx);
    };
    for (const imp of this.module.imports) record(imp.kind, importItemName(imp));
    for (const f of this.module.funcs) record(ExternalKind.Func, f.name);
    for (const g of this.module.globals) record(ExternalKind.Global, g.name);
    for (const t of this.module.tables) record(ExternalKind.Table, t.name);
    for (const m of this.module.memories) record(ExternalKind.Memory, m.name);
    for (const tg of this.module.tags) record(ExternalKind.Tag, tg.name);
  }

  // -------------------------------------------------------------------------
  // Core emit helpers
  // -------------------------------------------------------------------------

  private flushNextChar(): void {
    if (this.nextChar === NC.None) return;
    if (this.nextChar === NC.Space) {
      this.out.push(' ');
    } else {
      // Newline or ForceNewline
      this.out.push('\n');
      if (this.indent > 0) this.out.push(' '.repeat(this.indent));
    }
    this.nextChar = NC.None;
  }

  private puts(s: string, nc: NC): void {
    this.flushNextChar();
    this.out.push(s);
    this.nextChar = nc;
  }

  private putsSpace(s: string): void {
    this.puts(s, NC.Space);
  }
  private putsNewline(s: string): void {
    this.puts(s, NC.Newline);
  }

  private writef(s: string): void {
    this.flushNextChar();
    this.out.push(s);
    this.nextChar = NC.Space;
  }

  private newline(force: boolean): void {
    if (this.nextChar === NC.ForceNewline) this.flushNextChar();
    this.nextChar = force ? NC.ForceNewline : NC.Newline;
  }

  private open(name: string, nc: NC): void {
    this.puts('(', NC.None);
    this.puts(name, nc);
    this.indent += 2;
  }

  private openSpace(name: string): void {
    this.open(name, NC.Space);
  }

  private close(nc: NC): void {
    if (this.nextChar !== NC.ForceNewline) this.nextChar = NC.None;
    this.indent -= 2;
    this.puts(')', nc);
  }

  private closeNewline(): void {
    this.close(NC.Newline);
  }
  private closeSpace(): void {
    this.close(NC.Space);
  }

  // -------------------------------------------------------------------------
  // Name / identifier emit
  // -------------------------------------------------------------------------

  private writeName(s: string, nc: NC): void {
    // s must begin with '$'
    const needsQuoting = [...s].some((c) => !VALID_NAME_CHARS[c.charCodeAt(0)]);
    if (needsQuoting) {
      const safe = s.replace(/[^\x21\x23-\x27\x2a-\x3a\x3c-\x40\x5c\x5e-\x7e]/g, '_');
      this.puts(safe, nc);
    } else {
      this.puts(s, nc);
    }
  }

  private writeNameOrIndex(name: string, idx: number, nc: NC): void {
    if (name.length > 0) {
      this.writeName(name, nc);
    } else {
      this.writef(`(;${idx};)`);
      this.nextChar = nc;
    }
  }

  // -------------------------------------------------------------------------
  // Quoted strings and data
  // -------------------------------------------------------------------------

  private writeQuotedData(data: Uint8Array): void {
    const hexDigits = '0123456789abcdef';
    this.flushNextChar();
    this.out.push('"');
    for (const b of data) {
      if (IS_CHAR_ESCAPED[b]) {
        this.out.push('\\', hexDigits[b >> 4]!, hexDigits[b & 0xf]!);
      } else {
        this.out.push(String.fromCharCode(b));
      }
    }
    this.out.push('"');
    this.nextChar = NC.Space;
  }

  private writeQuotedString(s: string, nc: NC): void {
    this.writeQuotedData(TEXT_ENCODER.encode(s));
    this.nextChar = nc;
  }

  // -------------------------------------------------------------------------
  // Var / type emit
  // -------------------------------------------------------------------------

  private writeVar(v: Var, nc: NC): void {
    if (v.kind === 'index') {
      this.writef(`${v.value}`);
      this.nextChar = nc;
    } else {
      this.writeName(v.name, nc);
    }
  }

  private writeVarUnlessZero(v: Var, nc: NC): void {
    if (v.kind === 'index' && v.value === 0) {
      this.nextChar = nc;
      return;
    }
    this.writeVar(v, nc);
  }

  /** Resolves a Var to an absolute index for the given kind. */
  private resolveVarIndex(v: Var, kind: ExternalKind): number {
    if (v.kind === 'index') return v.value;
    return this.nameIndexMap.get(`${kind}:${v.name}`) ?? 0;
  }

  private writeMemoryVarUnlessZero(v: Var, nc: NC): void {
    if (this.resolveVarIndex(v, ExternalKind.Memory) !== 0) {
      this.writeVar(v, nc);
    } else {
      this.nextChar = nc;
    }
  }

  private writeTwoMemVarsUnlessBothZero(src: Var, dest: Var, nc: NC): void {
    const si = this.resolveVarIndex(src, ExternalKind.Memory);
    const di = this.resolveVarIndex(dest, ExternalKind.Memory);
    if (si !== 0 || di !== 0) {
      this.writeVar(src, NC.Space);
      this.writeVar(dest, nc);
    } else {
      this.nextChar = nc;
    }
  }

  private writeBrVar(v: Var, nc: NC): void {
    if (v.kind === 'index') {
      const depth = v.value;
      const stackSize = this.labelStackSize;
      if (depth < stackSize) {
        this.writef(`${depth} (;@${stackSize - depth - 1};)`);
      } else {
        this.writef(`${depth} (; INVALID ;)`);
      }
      this.nextChar = nc;
    } else {
      this.writeName(v.name, nc);
    }
  }

  private writeType(t: ValueType, nc: NC): void {
    if (isRefValueType(t)) {
      // `(ref $T)` / `(ref null $T)`. Printing typeName() on a concrete typed
      // ref used to be impossible — the IR coarsened them away before they
      // ever reached here.
      this.puts('(', NC.None);
      this.puts('ref', NC.Space);
      if (t.nullable) this.puts('null', NC.Space);
      if (t.heapType.kind === 'index') this.puts(`${t.heapType.value}`, NC.None);
      else this.puts(t.heapType.name, NC.None);
      this.puts(')', nc);
      return;
    }
    this.puts(typeName(t), nc);
  }

  private writeTypes(types: ValueType[], label: string | null): void {
    if (types.length === 0) return;
    if (label !== null) this.openSpace(label);
    for (const t of types) this.writeType(t, NC.Space);
    if (label !== null) this.closeSpace();
  }

  private writeFuncSig(sig: FuncSignature): void {
    this.writeTypes(sig.params, 'param');
    this.writeTypes(sig.results, 'result');
  }

  private writeBlockType(bt: BlockType): void {
    if (bt.kind === 'void') return;
    if (bt.kind === 'value') {
      this.openSpace('result');
      this.writeType(bt.type, NC.Space);
      this.closeSpace();
    } else {
      // func_type — write as (type N)
      this.openSpace('type');
      this.writef(`${bt.typeIdx}`);
      this.closeSpace();
    }
  }

  // -------------------------------------------------------------------------
  // Const / init-expr emit
  // -------------------------------------------------------------------------

  private writeConst(c: Const): void {
    switch (c.type) {
      case Type.I32:
        this.putsSpace('i32.const');
        this.writef(`${c.value | 0}`);
        this.newline(false);
        break;
      case Type.I64:
        this.putsSpace('i64.const');
        this.writef(`${c.value}`);
        this.newline(false);
        break;
      case Type.F32: {
        this.putsSpace('f32.const');
        const lit = printF32Literal(c.bits);
        this.putsSpace(lit);
        const fv = new DataView(new ArrayBuffer(4));
        fv.setUint32(0, c.bits, true);
        this.writef(`(;=${fv.getFloat32(0, true)};)`);
        this.newline(false);
        break;
      }
      case Type.F64: {
        this.putsSpace('f64.const');
        const lit = printF64Literal(c.bits);
        this.putsSpace(lit);
        const fv = new DataView(new ArrayBuffer(8));
        const lo = Number(c.bits & 0xffffffffn);
        const hi = Number((c.bits >> 32n) & 0xffffffffn);
        fv.setUint32(0, lo, true);
        fv.setUint32(4, hi, true);
        this.writef(`(;=${fv.getFloat64(0, true)};)`);
        this.newline(false);
        break;
      }
      case Type.V128: {
        this.putsSpace('v128.const');
        const dv = new DataView(c.bytes.buffer, c.bytes.byteOffset, 16);
        this.writef(
          `i32x4 0x${dv.getUint32(0, true).toString(16).padStart(8, '0')} ` +
            `0x${dv.getUint32(4, true).toString(16).padStart(8, '0')} ` +
            `0x${dv.getUint32(8, true).toString(16).padStart(8, '0')} ` +
            `0x${dv.getUint32(12, true).toString(16).padStart(8, '0')}`,
        );
        this.newline(false);
        break;
      }
    }
  }

  private writeInitExpr(exprs: Expr[]): void {
    if (exprs.length === 0) return;
    // A constant expression is `instr*`. Wrapping the WHOLE list in one paren
    // is only correct for a SINGLE instruction: `(i32.const 1)` is a folded
    // expression, but `(i32.const 1 ref.i31)` is not — it reads as `i32.const`
    // with a bogus operand and fails to reparse. Anything longer is emitted in
    // LINEAR form, which the parser accepts for init expressions.
    // The expression VISITOR emits linear (post-order) instructions, not
    // folded s-expressions, so a tree of more than one instruction comes out
    // as `i32.const 1  ref.i31`. Wrapping that in a paren makes it read as one
    // folded expression with a bogus operand, and it fails to reparse — which
    // is why `(global anyref (ref.i31 (i32.const 1)))` did not round-trip.
    // A constant expression is `instr*`; the linear form needs no wrapper and
    // is what the parser reads back.
    this.writeExprList(exprs);
    this.nextChar = NC.Space;
  }

  /**
   * Write a segment offset as an explicit `(offset instr*)`.
   *
   * Unlike a global's initializer, a data/elem offset cannot be emitted bare:
   * the parser distinguishes it from the rest of the segment by seeing a `(`.
   * `(offset …)` wraps a whole instruction SEQUENCE, so it stays correct for
   * multi-instruction offsets where a plain paren would not.
   */
  private writeElemExpr(exprs: Expr[]): void {
    if (exprs.length === 0) return;
    // `(item instr*)` wraps a whole instruction SEQUENCE. The bare folded
    // abbreviation `(ref.func 0)` only works when the element expression is a
    // SINGLE instruction — and one expression tree can be several
    // (`(ref.i31 (i32.const 1))` is two), so `item` is used uniformly.
    this.openSpace('item');
    this.writeExprList(exprs);
    this.closeSpace();
  }

  private writeOffsetExpr(exprs: Expr[]): void {
    if (exprs.length === 0) return;
    this.openSpace('offset');
    this.writeExprList(exprs);
    this.closeSpace();
  }

  // -------------------------------------------------------------------------
  // Memory arg emit helpers
  // -------------------------------------------------------------------------

  private writeMemarg(
    opName: string,
    offset: bigint,
    align: number,
    naturalAlign: number,
    memidx: Var,
  ): void {
    this.putsSpace(opName);
    this.writeMemoryVarUnlessZero(memidx, NC.Space);
    if (offset !== 0n) this.writef(`offset=${offset}`);
    if (align !== naturalAlign) this.writef(`align=${align}`);
    this.newline(false);
  }

  // -------------------------------------------------------------------------
  // Inline export map
  // -------------------------------------------------------------------------

  /**
   * Decide whether the inline `(export "n")` abbreviation is usable for this
   * module, and if so index the exports by the item they name.
   *
   * Inlining is not always faithful, and both ways it fails are round-trip
   * bugs rather than cosmetic ones (T10.1 / T10.2):
   *
   * - **An inline export is legal only on a DEFINITION.** Emitting one inside
   *   `(import "M" "f" (func $f0 (export "n") …))` produces WAT our own parser
   *   rejects — the abbreviation has no place in the import grammar.
   * - **Inlining re-orders the export section.** Each export moves to the item
   *   it names, so re-parsing rebuilds the section grouped per item —
   *   `a, b, ac` comes back as `a, ac, b`. Export order is observable through
   *   `WebAssembly.Module.exports()`, so that is a changed module.
   *
   * The order test is exact rather than conservative: under full inlining the
   * emitted sequence is a STABLE SORT of `module.exports` by the position at
   * which `writeModule` visits each item, and a stable sort is the identity
   * exactly when those positions are non-decreasing.
   *
   * When either test fails the map stays empty, so every export falls back to
   * a standalone `(export "n" (func $f))` field written in the module's own
   * order — always legal, always faithful. It is all-or-nothing on purpose:
   * standalone exports are emitted after every item, so inlining *some* of
   * them would push the rest to the end and re-order the section again.
   */
  private buildExportMap(): void {
    if (!this.opts.inlineExport) return;

    // Position at which writeModule visits each item, and which items are
    // imports. Mirrors the emission order below: imports in declaration
    // order, then funcs, tables, memories, globals, tags.
    const emitPos = new Map<string, number>();
    const imported = new Set<string>();
    const counts: Partial<Record<ExternalKind, number>> = {};
    let pos = 0;
    const visit = (kind: ExternalKind, isImport: boolean): void => {
      const idx = counts[kind] ?? 0;
      counts[kind] = idx + 1;
      const key = `${kind}:${idx}`;
      emitPos.set(key, pos++);
      if (isImport) imported.add(key);
    };
    for (const imp of this.module.imports) visit(imp.kind, true);
    for (let i = 0; i < this.module.funcs.length; i++) visit(ExternalKind.Func, false);
    for (let i = 0; i < this.module.tables.length; i++) visit(ExternalKind.Table, false);
    for (let i = 0; i < this.module.memories.length; i++) {
      visit(ExternalKind.Memory, false);
    }
    for (let i = 0; i < this.module.globals.length; i++) {
      visit(ExternalKind.Global, false);
    }
    for (let i = 0; i < this.module.tags.length; i++) visit(ExternalKind.Tag, false);

    const keys: string[] = [];
    for (const exp of this.module.exports) {
      const key = `${exp.kind}:${this.resolveVarIndex(exp.var, exp.kind)}`;
      // An export naming an item the writer never emits cannot be inlined
      // onto anything; bail rather than silently drop it.
      if (!emitPos.has(key) || imported.has(key)) return;
      keys.push(key);
    }
    for (let i = 1; i < keys.length; i++) {
      if (emitPos.get(keys[i - 1]!)! > emitPos.get(keys[i]!)!) return;
    }

    for (const [i, exp] of this.module.exports.entries()) {
      const key = keys[i]!;
      const arr = this.exportMap.get(key);
      if (arr) arr.push(exp);
      else this.exportMap.set(key, [exp]);
    }
  }

  private writeInlineExports(kind: ExternalKind, idx: number): void {
    if (!this.opts.inlineExport) return;
    const arr = this.exportMap.get(`${kind}:${idx}`);
    if (!arr) return;
    for (const exp of arr) {
      this.openSpace('export');
      this.writeQuotedString(exp.name, NC.None);
      this.closeSpace();
    }
  }

  private isInlineExport(exp: Export): boolean {
    if (!this.opts.inlineExport) return false;
    const idx = this.resolveVarIndex(exp.var, exp.kind);
    return this.exportMap.has(`${exp.kind}:${idx}`);
  }

  // -------------------------------------------------------------------------
  // ExprVisitor delegate — writes linear WAT for each instruction
  // -------------------------------------------------------------------------

  private makeDelegate(): ExprVisitorDelegate {
    const opname = (op: number) => anyOpcodeName(op);

    return {
      onNopExpr: (e) => {
        // Same rule as the binary writer: a synthesized operand slot-filler
        // means "the value is already on the stack", which linear WAT spells
        // by writing nothing. Printing `nop` here would re-enter the parser as
        // a real instruction and the two writers would disagree (T10.8).
        if (e.placeholder) return Result.Ok;
        this.putsNewline('nop');
        return Result.Ok;
      },
      onUnreachableExpr: () => {
        this.putsNewline('unreachable');
        return Result.Ok;
      },
      onDropExpr: () => {
        this.putsNewline('drop');
        return Result.Ok;
      },
      onReturnExpr: () => {
        this.putsNewline('return');
        return Result.Ok;
      },

      onConstExpr: (e) => {
        this.writeConst(e.value);
        return Result.Ok;
      },

      onLocalGetExpr: (e) => {
        this.putsSpace('local.get');
        this.writeVar(e.var, NC.Newline);
        return Result.Ok;
      },
      onLocalSetExpr: (e) => {
        this.putsSpace('local.set');
        this.writeVar(e.var, NC.Newline);
        return Result.Ok;
      },
      onLocalTeeExpr: (e) => {
        this.putsSpace('local.tee');
        this.writeVar(e.var, NC.Newline);
        return Result.Ok;
      },
      onGlobalGetExpr: (e) => {
        this.putsSpace('global.get');
        this.writeVar(e.var, NC.Newline);
        return Result.Ok;
      },
      onGlobalSetExpr: (e) => {
        this.putsSpace('global.set');
        this.writeVar(e.var, NC.Newline);
        return Result.Ok;
      },

      onUnaryExpr: (e) => {
        this.putsNewline(opname(e.opcode));
        return Result.Ok;
      },
      onBinaryExpr: (e) => {
        this.putsNewline(opname(e.opcode));
        return Result.Ok;
      },
      onCompareExpr: (e) => {
        this.putsNewline(opname(e.opcode));
        return Result.Ok;
      },
      onConvertExpr: (e) => {
        this.putsNewline(opname(e.opcode));
        return Result.Ok;
      },
      onTernaryExpr: (e) => {
        this.putsNewline(opname(e.opcode));
        return Result.Ok;
      },
      onQuaternaryExpr: (e) => {
        this.putsNewline(opname(e.opcode));
        return Result.Ok;
      },

      onSelectExpr: (e) => {
        this.putsSpace('select');
        if (e.resultType.length > 0) this.writeTypes(e.resultType, 'result');
        this.newline(false);
        return Result.Ok;
      },

      onLoadExpr: (e) => {
        const na = naturalAlignForOpcode(e.opcode);
        this.writeMemarg(opname(e.opcode), e.offset, e.align, na, e.memidx);
        return Result.Ok;
      },
      onStoreExpr: (e) => {
        const na = naturalAlignForOpcode(e.opcode);
        this.writeMemarg(opname(e.opcode), e.offset, e.align, na, e.memidx);
        return Result.Ok;
      },

      onMemorySizeExpr: (e) => {
        this.putsSpace('memory.size');
        this.writeMemoryVarUnlessZero(e.memidx, NC.Newline);
        this.newline(false);
        return Result.Ok;
      },
      onMemoryGrowExpr: (e) => {
        this.putsSpace('memory.grow');
        this.writeMemoryVarUnlessZero(e.memidx, NC.Newline);
        this.newline(false);
        return Result.Ok;
      },
      onMemoryCopyExpr: (e) => {
        this.putsSpace('memory.copy');
        this.writeTwoMemVarsUnlessBothZero(e.destMemidx, e.srcMemidx, NC.Space);
        this.newline(false);
        return Result.Ok;
      },
      onMemoryFillExpr: (e) => {
        this.putsSpace('memory.fill');
        this.writeMemoryVarUnlessZero(e.memidx, NC.Space);
        this.newline(false);
        return Result.Ok;
      },
      onMemoryInitExpr: (e) => {
        this.putsSpace('memory.init');
        // TEXT order is `memory.init $memidx $dataidx` — memory FIRST — which
        // is the reverse of the binary encoding (dataidx then memidx). This
        // wrote the binary order, so a wasm2wat round-trip of any non-zero
        // memory re-parsed with the two indices transposed and V8 rejected it
        // ("invalid data segment index"). A zero memory index is omitted,
        // leaving the one-var form, which already means "data segment".
        const memIdx = e.memidx.kind === 'index' ? e.memidx.value : -1;
        if (memIdx !== 0) this.writeVar(e.memidx, NC.Space);
        this.writeVar(e.segment, NC.Space);
        this.newline(false);
        return Result.Ok;
      },
      onDataDropExpr: (e) => {
        this.putsSpace('data.drop');
        this.writeVar(e.segment, NC.Newline);
        return Result.Ok;
      },

      onCallExpr: (e) => {
        this.putsSpace('call');
        this.writeVar(e.func, NC.Newline);
        return Result.Ok;
      },
      onCallIndirectExpr: (e) => {
        this.putsSpace('call_indirect');
        this.writeVarUnlessZero(e.table, NC.Space);
        this.openSpace('type');
        this.writeVar(e.typeVar, NC.Newline);
        this.closeNewline();
        return Result.Ok;
      },
      onCallRefExpr: (e) => {
        this.putsSpace('call_ref');
        this.writeVar(e.sigType, NC.Newline);
        return Result.Ok;
      },
      onReturnCallExpr: (e) => {
        this.putsSpace('return_call');
        this.writeVar(e.func, NC.Newline);
        return Result.Ok;
      },
      onReturnCallIndirectExpr: (e) => {
        this.putsSpace('return_call_indirect');
        // The TABLE index, like `call_indirect` above. Omitting it did not
        // fail to reparse — `parseVarOpt` defaults it to 0 — so every
        // `return_call_indirect` against a table other than 0 came back
        // pointing at table 0 instead. Still valid wasm, different program.
        // Last of the round-trip differences (T10.4's file, a separate bug).
        this.writeVarUnlessZero(e.table, NC.Space);
        this.openSpace('type');
        this.writeVar(e.typeVar, NC.Space);
        this.closeNewline();
        return Result.Ok;
      },
      onReturnCallRefExpr: (e) => {
        this.putsSpace('return_call_ref');
        this.writeVar(e.sigType, NC.Newline);
        return Result.Ok;
      },

      onRefNullExpr: (e) => {
        this.putsSpace('ref.null');
        if (e.refType.kind === 'name') {
          // Either an abstract heap-type keyword (`func` / `any` / …) or a
          // user-defined `$T`; both are written verbatim. writeName is for
          // `$`-prefixed identifiers only, so it mangled bare keywords.
          this.putsNewline(e.refType.name);
        } else {
          // A resolved type index. `ref.null 3` is valid WAT; the earlier code
          // printed the type entry's KIND (`func` / `struct`) instead, which
          // silently retargeted the null to the abstract supertype.
          this.putsNewline(`${e.refType.value}`);
        }
        return Result.Ok;
      },
      onRefIsNullExpr: () => {
        this.putsNewline('ref.is_null');
        return Result.Ok;
      },
      onRefFuncExpr: (e) => {
        this.putsSpace('ref.func');
        this.writeVar(e.func, NC.Newline);
        return Result.Ok;
      },
      onRefAsNonNullExpr: () => {
        this.putsNewline('ref.as_non_null');
        return Result.Ok;
      },
      onRefEqExpr: () => {
        this.putsNewline('ref.eq');
        return Result.Ok;
      },
      onExternConvertExpr: (e) => {
        this.putsNewline(e.kind);
        return Result.Ok;
      },
      onRefI31Expr: () => {
        this.putsNewline('ref.i31');
        return Result.Ok;
      },
      onI31GetExpr: (e) => {
        this.putsNewline(e.signed ? 'i31.get_s' : 'i31.get_u');
        return Result.Ok;
      },
      onStructNewExpr: (e) => {
        this.putsSpace('struct.new');
        this.writeVar(e.typeVar, NC.Newline);
        return Result.Ok;
      },
      onStructNewDefaultExpr: (e) => {
        this.putsSpace('struct.new_default');
        this.writeVar(e.typeVar, NC.Newline);
        return Result.Ok;
      },
      onStructGetExpr: (e) => {
        this.putsSpace(
          e.signed === true ? 'struct.get_s' : e.signed === false ? 'struct.get_u' : 'struct.get',
        );
        this.writeVar(e.typeVar, NC.Space);
        this.writeVar(e.fieldVar, NC.Newline);
        return Result.Ok;
      },
      onStructSetExpr: (e) => {
        this.putsSpace('struct.set');
        this.writeVar(e.typeVar, NC.Space);
        this.writeVar(e.fieldVar, NC.Newline);
        return Result.Ok;
      },
      onArrayNewExpr: (e) => {
        this.putsSpace('array.new');
        this.writeVar(e.typeVar, NC.Newline);
        return Result.Ok;
      },
      onArrayNewDefaultExpr: (e) => {
        this.putsSpace('array.new_default');
        this.writeVar(e.typeVar, NC.Newline);
        return Result.Ok;
      },
      onArrayNewFixedExpr: (e) => {
        this.putsSpace('array.new_fixed');
        this.writeVar(e.typeVar, NC.Space);
        this.puts(String(e.operands.length), NC.Newline);
        return Result.Ok;
      },
      onArrayNewDataExpr: (e) => {
        this.putsSpace('array.new_data');
        this.writeVar(e.typeVar, NC.Space);
        this.writeVar(e.dataVar, NC.Newline);
        return Result.Ok;
      },
      onArrayNewElemExpr: (e) => {
        this.putsSpace('array.new_elem');
        this.writeVar(e.typeVar, NC.Space);
        this.writeVar(e.elemVar, NC.Newline);
        return Result.Ok;
      },
      onArrayGetExpr: (e) => {
        this.putsSpace(
          e.signed === true ? 'array.get_s' : e.signed === false ? 'array.get_u' : 'array.get',
        );
        this.writeVar(e.typeVar, NC.Newline);
        return Result.Ok;
      },
      onArraySetExpr: (e) => {
        this.putsSpace('array.set');
        this.writeVar(e.typeVar, NC.Newline);
        return Result.Ok;
      },
      onArrayFillExpr: (e) => {
        this.putsSpace('array.fill');
        this.writeVar(e.typeVar, NC.Newline);
        return Result.Ok;
      },
      onArrayCopyExpr: (e) => {
        this.putsSpace('array.copy');
        this.writeVar(e.destTypeVar, NC.Space);
        this.writeVar(e.srcTypeVar, NC.Newline);
        return Result.Ok;
      },
      onArrayInitSegmentExpr: (e) => {
        this.putsSpace(e.kind);
        this.writeVar(e.typeVar, NC.Space);
        this.writeVar(e.segment, NC.Newline);
        return Result.Ok;
      },
      onArrayLenExpr: () => {
        this.putsNewline('array.len');
        return Result.Ok;
      },
      onRefTestExpr: (e) => {
        this.putsSpace('ref.test');
        this.openSpace('ref');
        if (e.nullable) this.putsSpace('null');
        this.writeVar(e.heapType, NC.None);
        this.closeNewline();
        return Result.Ok;
      },
      onRefCastExpr: (e) => {
        this.putsSpace('ref.cast');
        this.openSpace('ref');
        if (e.nullable) this.putsSpace('null');
        this.writeVar(e.heapType, NC.None);
        this.closeNewline();
        return Result.Ok;
      },

      onTableGetExpr: (e) => {
        this.putsSpace('table.get');
        this.writeVar(e.table, NC.Newline);
        return Result.Ok;
      },
      onTableSetExpr: (e) => {
        this.putsSpace('table.set');
        this.writeVar(e.table, NC.Newline);
        return Result.Ok;
      },
      onTableGrowExpr: (e) => {
        this.putsSpace('table.grow');
        this.writeVar(e.table, NC.Newline);
        return Result.Ok;
      },
      onTableSizeExpr: (e) => {
        this.putsSpace('table.size');
        this.writeVar(e.table, NC.Newline);
        return Result.Ok;
      },
      onTableFillExpr: (e) => {
        this.putsSpace('table.fill');
        this.writeVar(e.table, NC.Newline);
        return Result.Ok;
      },
      onTableCopyExpr: (e) => {
        this.putsSpace('table.copy');
        if (
          e.dst.kind !== 'index' || e.dst.value !== 0 || e.src.kind !== 'index' || e.src.value !== 0
        ) {
          this.writeVar(e.dst, NC.Space);
          this.writeVar(e.src, NC.Space);
        }
        this.newline(false);
        return Result.Ok;
      },
      onTableInitExpr: (e) => {
        this.putsSpace('table.init');
        this.writeVarUnlessZero(e.table, NC.Space);
        this.writeVar(e.segment, NC.Newline);
        return Result.Ok;
      },
      onElemDropExpr: (e) => {
        this.putsSpace('elem.drop');
        this.writeVar(e.segment, NC.Newline);
        return Result.Ok;
      },

      onThrowExpr: (e) => {
        this.putsSpace('throw');
        this.writeVar(e.tag, NC.Newline);
        return Result.Ok;
      },
      onThrowRefExpr: () => {
        this.putsNewline('throw_ref');
        return Result.Ok;
      },
      onRethrowExpr: (e) => {
        this.putsSpace('rethrow');
        this.writeBrVar(e.depth, NC.Newline);
        return Result.Ok;
      },

      onBrExpr: (e) => {
        this.putsSpace('br');
        this.writeBrVar(e.target, NC.Newline);
        return Result.Ok;
      },
      onBrIfExpr: (e) => {
        this.putsSpace('br_if');
        this.writeBrVar(e.target, NC.Newline);
        return Result.Ok;
      },
      onBrOnNullExpr: (e) => {
        this.putsSpace('br_on_null');
        this.writeBrVar(e.target, NC.Newline);
        return Result.Ok;
      },
      onBrOnNonNullExpr: (e) => {
        this.putsSpace('br_on_non_null');
        this.writeBrVar(e.target, NC.Newline);
        return Result.Ok;
      },
      onBrOnCastExpr: (e) => {
        this.putsSpace(e.onFail ? 'br_on_cast_fail' : 'br_on_cast');
        this.writeBrVar(e.target, NC.Space);
        // Always the explicit `(ref [null] H)` spelling for both types —
        // the abbreviated `anyref` form only covers the nullable case.
        for (const [i, rt] of [e.from, e.to].entries()) {
          this.openSpace('ref');
          if (rt.nullable) this.putsSpace('null');
          this.writeVar(rt.heapType, NC.None);
          if (i === 0) this.closeSpace();
          else this.closeNewline();
        }
        return Result.Ok;
      },
      onBrTableExpr: (e) => {
        this.putsSpace('br_table');
        for (const t of e.targets) this.writeBrVar(t, NC.Space);
        this.writeBrVar(e.defaultTarget, NC.Newline);
        return Result.Ok;
      },

      // --- Block-like ---
      beginBlockExpr: (e) => {
        this.putsSpace('block');
        if (e.label) this.writeName(e.label, NC.Space);
        this.writeBlockType(e.blockType);
        if (!e.label) this.writef(` ;; label = @${this.labelStackSize}`);
        this.newline(true);
        this.beginBlock(e.label, LabelType.Block, e.blockType);
        this.indent += 2;
        return Result.Ok;
      },
      endBlockExpr: (_e) => {
        this.indent -= 2;
        this.endBlock();
        this.putsNewline('end');
        return Result.Ok;
      },

      beginLoopExpr: (e) => {
        this.putsSpace('loop');
        if (e.label) this.writeName(e.label, NC.Space);
        this.writeBlockType(e.blockType);
        if (!e.label) this.writef(` ;; label = @${this.labelStackSize}`);
        this.newline(true);
        this.beginBlock(e.label, LabelType.Loop, e.blockType);
        this.indent += 2;
        return Result.Ok;
      },
      endLoopExpr: () => {
        this.indent -= 2;
        this.endBlock();
        this.putsNewline('end');
        return Result.Ok;
      },

      beginIfExpr: (e) => {
        this.putsSpace('if');
        if (e.label) this.writeName(e.label, NC.Space);
        this.writeBlockType(e.blockType);
        if (!e.label) this.writef(` ;; label = @${this.labelStackSize}`);
        this.newline(true);
        this.beginBlock(e.label, LabelType.If, e.blockType);
        this.indent += 2;
        return Result.Ok;
      },
      afterIfTrueExpr: (e) => {
        if (e.else_.length > 0) {
          this.indent -= 2;
          this.putsSpace('else');
          this.indent += 2;
          this.newline(true);
        }
        return Result.Ok;
      },
      endIfExpr: () => {
        this.indent -= 2;
        this.endBlock();
        this.putsNewline('end');
        return Result.Ok;
      },

      beginTryExpr: (e) => {
        this.putsSpace('try');
        if (e.label) this.writeName(e.label, NC.Space);
        this.writeBlockType(e.blockType);
        this.newline(true);
        this.beginBlock(e.label, LabelType.Try, e.blockType);
        this.indent += 2;
        return Result.Ok;
      },
      onCatchExpr: (_te, c) => {
        this.writeCatch(c);
        return Result.Ok;
      },
      onDelegateExpr: (e) => {
        if (e.delegate !== undefined) {
          this.indent -= 2;
          this.putsSpace('delegate');
          this.writeBrVar(e.delegate, NC.Newline);
        }
        return Result.Ok;
      },
      endTryExpr: () => {
        this.indent -= 2;
        this.endBlock();
        this.putsNewline('end');
        return Result.Ok;
      },

      beginTryTableExpr: (e) => {
        this.putsSpace('try_table');
        if (e.label) this.writeName(e.label, NC.Space);
        this.writeBlockType(e.blockType);
        if (!e.label) this.writef(` ;; label = @${this.labelStackSize}`);
        this.newline(true);
        this.indent += 2;
        for (const tc of e.catches) {
          this.writeTableCatch(tc);
        }
        this.beginBlock(e.label, LabelType.TryTable, e.blockType);
        return Result.Ok;
      },
      endTryTableExpr: () => {
        this.indent -= 2;
        this.endBlock();
        this.putsNewline('end');
        return Result.Ok;
      },

      // --- Atomic memory ops ---
      onAtomicLoadExpr: (e) => {
        this.writeMemarg(
          opname(e.opcode),
          e.offset,
          e.align,
          naturalAlignForOpcode(e.opcode),
          e.memidx,
        );
        return Result.Ok;
      },
      onAtomicStoreExpr: (e) => {
        this.writeMemarg(
          opname(e.opcode),
          e.offset,
          e.align,
          naturalAlignForOpcode(e.opcode),
          e.memidx,
        );
        return Result.Ok;
      },
      onAtomicRmwExpr: (e) => {
        this.writeMemarg(
          opname(e.opcode),
          e.offset,
          e.align,
          naturalAlignForOpcode(e.opcode),
          e.memidx,
        );
        return Result.Ok;
      },
      onAtomicRmwCmpxchgExpr: (e) => {
        this.writeMemarg(
          opname(e.opcode),
          e.offset,
          e.align,
          naturalAlignForOpcode(e.opcode),
          e.memidx,
        );
        return Result.Ok;
      },
      onAtomicWaitExpr: (e) => {
        this.writeMemarg(
          opname(e.opcode),
          e.offset,
          e.align,
          naturalAlignForOpcode(e.opcode),
          e.memidx,
        );
        return Result.Ok;
      },
      onAtomicNotifyExpr: (e) => {
        this.writeMemarg(
          'memory.atomic.notify',
          e.offset,
          e.align,
          naturalAlignForOpcode((PREFIX_THREADS << 16) | 0x00),
          e.memidx,
        );
        return Result.Ok;
      },
      onAtomicFenceExpr: () => {
        this.putsNewline('atomic.fence');
        return Result.Ok;
      },

      // --- SIMD ---
      onSimdLaneOpExpr: (e) => {
        this.putsSpace(opname(e.opcode));
        this.writef(`${e.lane}`);
        this.newline(false);
        return Result.Ok;
      },
      onSimdShuffleOpExpr: (e) => {
        this.putsSpace('i8x16.shuffle');
        const lanes = [...e.lanes].map((b) => b.toString()).join(' ');
        this.writef(lanes);
        this.newline(false);
        return Result.Ok;
      },
      onSimdLoadLaneExpr: (e) => {
        const na = naturalAlignForOpcode(e.opcode);
        this.putsSpace(opname(e.opcode));
        this.writeMemoryVarUnlessZero(e.memidx, NC.Space);
        if (e.offset !== 0n) this.writef(`offset=${e.offset}`);
        if (e.align !== na) this.writef(`align=${e.align}`);
        this.writef(`${e.lane}`);
        this.newline(false);
        return Result.Ok;
      },
      onSimdStoreLaneExpr: (e) => {
        const na = naturalAlignForOpcode(e.opcode);
        this.putsSpace(opname(e.opcode));
        this.writeMemoryVarUnlessZero(e.memidx, NC.Space);
        if (e.offset !== 0n) this.writef(`offset=${e.offset}`);
        if (e.align !== na) this.writef(`align=${e.align}`);
        this.writef(`${e.lane}`);
        this.newline(false);
        return Result.Ok;
      },
      onLoadSplatExpr: (e) => {
        const na = naturalAlignForOpcode(e.opcode);
        this.writeMemarg(opname(e.opcode), e.offset, e.align, na, e.memidx);
        return Result.Ok;
      },
      onLoadZeroExpr: (e) => {
        const na = naturalAlignForOpcode(e.opcode);
        this.writeMemarg(opname(e.opcode), e.offset, e.align, na, e.memidx);
        return Result.Ok;
      },

      onCodeMetadataExpr: (e) => {
        this.openSpace(`@metadata.code.${e.name}`);
        this.writeQuotedData(e.data);
        this.closeSpace();
        return Result.Ok;
      },
    };
  }

  private writeCatch(c: Catch): void {
    // Emits only the `catch $tag` / `catch_all` clause header. The handler
    // body is walked by the ExprVisitor's `try` case (visitExprList(c.body)
    // runs right after onCatchExpr), so writing it here too would duplicate
    // every handler instruction.
    this.indent -= 2;
    if (c.tag !== undefined) {
      this.putsSpace(c.isRef ? 'catch_ref' : 'catch');
      this.writeVar(c.tag, NC.Newline);
    } else {
      this.putsNewline(c.isRef ? 'catch_all_ref' : 'catch_all');
    }
    this.indent += 2;
    this.newline(true);
  }

  private writeTableCatch(tc: TableCatch): void {
    this.puts('(', NC.None);
    switch (tc.kind) {
      case 'catch':
        this.putsSpace('catch');
        break;
      case 'catch_ref':
        this.putsSpace('catch_ref');
        break;
      case 'catch_all':
        this.putsSpace('catch_all');
        break;
      case 'catch_all_ref':
        this.putsSpace('catch_all_ref');
        break;
    }
    if (tc.tag !== undefined) this.writeVar(tc.tag, NC.Space);
    this.writeBrVar(tc.target, NC.None);
    this.puts(')', NC.Newline);
  }

  // -------------------------------------------------------------------------
  // Expression list writer (uses ExprVisitor)
  // -------------------------------------------------------------------------

  private writeExprList(exprs: Expr[]): void {
    if (this.opts.fold) {
      // Decide per TOP-LEVEL expression, and only after `canFold` has walked the
      // whole subtree. Committing output first and discovering a decline halfway
      // down would leave a half-written `(` behind -- which is why this asks
      // before it writes rather than unwinding after.
      //
      // Falling back per expression rather than per list keeps the foldable
      // parts folded: a body with one control-flow construct still folds its
      // arithmetic.
      let anyFolded = false;
      for (const e of exprs) {
        if (this.canFold(e)) {
          this.writeFoldedExpr(e);
          anyFolded = true;
        } else {
          this.writeExprListLinear([e]);
        }
      }
      if (anyFolded) return;
      return;
    }
    this.writeExprListLinear(exprs);
  }

  /** The linear (stack-machine) rendering: children before parents, one per line. */
  private writeExprListLinear(exprs: Expr[]): void {
    const delegate = this.makeDelegate();
    const visitor = new ExprVisitor(delegate);
    visitor.visitExprList(exprs);
  }

  /**
   * Emit a constant expression as ONE folded s-expression, e.g.
   * `(ref.func $f)` or `(ref.i31 (global.get $g))`.
   *
   * This writer is linear (post-order) everywhere else, and deliberately so —
   * see {@link writeInitExpr}. But a few grammar slots take a single folded
   * instruction and have no `(item …)` / `(offset …)` wrapper to hold a linear
   * sequence; the table initializer is one, and losing it is not cosmetic (see
   * {@link writeTableDecl}).
   *
   * Only CONSTANT expressions are foldable here, which is what makes the
   * operand table below closed rather than a second copy of the instruction
   * set: the spec limits a constant expression to the const family, the `ref`
   * forms, `global.get`, extended-const arithmetic and the GC allocations, and
   * the validator enforces exactly that list. Anything else is rejected before
   * it reaches a slot that needs folding.
   *
   * The instruction's own text still comes from the ordinary delegate — the
   * `onXExpr` callbacks write a node's opcode and immediates and never touch
   * its children, so folding needs the operand ORDER and nothing else. No
   * immediate formatting is duplicated.
   *
   * Returns false when `e` is not a constant expression, leaving the output
   * untouched so the caller can fail loudly rather than emit something that
   * will not reparse.
   */
  private writeFoldedConstExpr(e: Expr): boolean {
    const operands = constExprOperands(e);
    if (operands === null) return false;
    for (const operand of operands) {
      if (constExprOperands(operand) === null) return false;
    }

    this.puts('(', NC.None);
    this.indent += 2;
    // A leaf is a head with zero operands, so both cases are the same write.
    //
    // 🔧 The leaf used to go through `writeExprList([e])`, on the reasoning that
    // "a leaf's linear rendering IS its head". That held only while linear was
    // the default. Once folding became the default in 1.5.4 that call emitted
    // `(ref.func 0)` — already parenthesised — inside the parens opened here,
    // giving `(table $T0 10 funcref ((ref.func 0)))`, which does not parse.
    // `writeInstrHead` is what was meant: the head alone, no wrapper.
    this.writeInstrHead(e);
    for (const operand of operands) {
      if (!this.writeFoldedConstExpr(operand)) return false;
    }
    this.close(NC.Space);
    return true;
  }

  /**
   * Folded rendering for one expression: its operands AND how to write its head,
   * from a SINGLE switch.
   *
   * ⚠️ The existing const-expr folder splits these across two functions —
   * `constExprOperands` and `writeInstrHead` — and `const_expr_head_coupling.test.ts`
   * exists because nothing made them agree. A kind present in one and absent
   * from the other emits its operands TWICE, and the result still reparses as a
   * different module. That test is a guard against a hazard the shape created.
   *
   * This returns both halves from the same `case`, so the hazard cannot occur
   * here rather than being tested for. Returning `null` declines, and the caller
   * falls back to the linear renderer — which is always correct, just less
   * folded.
   *
   * ⚠️ **A placeholder operand makes a node unfoldable.** `operandPlaceholder`
   * marks "the value is already on the stack"; linear WAT spells that by writing
   * nothing, and folded form has no way to spell it at all. Such nodes decline.
   *
   * Control flow (block / loop / if / try) is deliberately absent for now: it
   * folds around a BODY rather than operands, and declining keeps the output
   * correct while that is built.
   */
  private foldSpec(
    e: Expr,
  ): { operands: Expr[]; head: (d: ExprVisitorDelegate) => void } | null {
    // A synthesized slot-filler means the operand is not structurally present.
    const usable = (x: Expr | undefined): boolean =>
      x !== undefined && !(x.kind === 'nop' && x.placeholder === true);

    const spec = ((): { operands: Expr[]; head: (d: ExprVisitorDelegate) => void } | null => {
      switch (e.kind) {
        // ---- leaves: no operands, so the folded form is `(instr imm*)` --------
        case 'const':
          return { operands: [], head: (d) => void d.onConstExpr?.(e) };
        case 'local.get':
          return { operands: [], head: (d) => void d.onLocalGetExpr?.(e) };
        case 'global.get':
          return { operands: [], head: (d) => void d.onGlobalGetExpr?.(e) };
        case 'ref.null':
          return { operands: [], head: (d) => void d.onRefNullExpr?.(e) };
        case 'ref.func':
          return { operands: [], head: (d) => void d.onRefFuncExpr?.(e) };
        case 'nop':
          return { operands: [], head: (d) => void d.onNopExpr?.(e) };
        case 'unreachable':
          return { operands: [], head: (d) => void d.onUnreachableExpr?.(e) };
        case 'memory.size':
          return { operands: [], head: (d) => void d.onMemorySizeExpr?.(e) };
        case 'table.size':
          return { operands: [], head: (d) => void d.onTableSizeExpr?.(e) };
        case 'struct.new_default':
          return { operands: [], head: (d) => void d.onStructNewDefaultExpr?.(e) };
        case 'data.drop':
          return { operands: [], head: (d) => void d.onDataDropExpr?.(e) };

        // ---- one operand ------------------------------------------------------
        case 'unary':
          return { operands: [e.operand], head: (d) => void d.onUnaryExpr?.(e) };
        case 'convert':
          return { operands: [e.operand], head: (d) => void d.onConvertExpr?.(e) };
        case 'drop':
          return { operands: [e.value], head: (d) => void d.onDropExpr?.(e) };
        case 'local.set':
          return { operands: [e.value], head: (d) => void d.onLocalSetExpr?.(e) };
        case 'local.tee':
          return { operands: [e.value], head: (d) => void d.onLocalTeeExpr?.(e) };
        case 'global.set':
          return { operands: [e.value], head: (d) => void d.onGlobalSetExpr?.(e) };
        case 'load':
          return { operands: [e.address], head: (d) => void d.onLoadExpr?.(e) };
        case 'ref.is_null':
          return { operands: [e.value], head: (d) => void d.onRefIsNullExpr?.(e) };
        case 'ref.as_non_null':
          return { operands: [e.value], head: (d) => void d.onRefAsNonNullExpr?.(e) };
        case 'any.convert_extern':
        case 'extern.convert_any':
          return { operands: [e.value], head: (d) => void d.onExternConvertExpr?.(e) };
        case 'ref.i31':
          return { operands: [e.value], head: (d) => void d.onRefI31Expr?.(e) };
        case 'memory.grow':
          return { operands: [e.delta], head: (d) => void d.onMemoryGrowExpr?.(e) };
        case 'array.len':
          return { operands: [e.ref], head: (d) => void d.onArrayLenExpr?.(e) };
        case 'ref.test':
          return { operands: [e.ref], head: (d) => void d.onRefTestExpr?.(e) };
        case 'ref.cast':
          return { operands: [e.ref], head: (d) => void d.onRefCastExpr?.(e) };
        case 'struct.get':
          return { operands: [e.ref], head: (d) => void d.onStructGetExpr?.(e) };
        case 'table.get':
          return { operands: [e.index], head: (d) => void d.onTableGetExpr?.(e) };

        // ---- two operands -----------------------------------------------------
        case 'binary':
          return { operands: [e.left, e.right], head: (d) => void d.onBinaryExpr?.(e) };
        case 'compare':
          return { operands: [e.left, e.right], head: (d) => void d.onCompareExpr?.(e) };
        case 'store':
          return { operands: [e.address, e.value], head: (d) => void d.onStoreExpr?.(e) };
        case 'ref.eq':
          return { operands: [e.left, e.right], head: (d) => void d.onRefEqExpr?.(e) };
        case 'struct.set':
          return { operands: [e.ref, e.value], head: (d) => void d.onStructSetExpr?.(e) };
        case 'array.get':
          return { operands: [e.ref, e.index], head: (d) => void d.onArrayGetExpr?.(e) };
        case 'array.new':
          return { operands: [e.init, e.length], head: (d) => void d.onArrayNewExpr?.(e) };
        case 'table.set':
          return { operands: [e.index, e.value], head: (d) => void d.onTableSetExpr?.(e) };

        // ---- br / br_if / return are DELIBERATELY absent ----------------------
        //
        // Tried and reverted, because the differential caught it. All three
        // transfer a value that sits on the stack, put there by a PRECEDING
        // SIBLING rather than held as a child — `(br $l)` is legal folded WAT,
        // but the value it carries is not inside the parens.
        //
        // Folding them produced output that did not assemble at all:
        //
        //     (i32.const 1
        //       br
        //
        // The preceding sibling's closing paren was still pending when the leaf
        // path re-entered the linear writer for the branch. `br_if` was worse —
        // it assembled and produced DIFFERENT BYTES, which is the failure mode
        // that gets shipped.
        //
        // Reverting cost the folded form nothing it can express correctly: a
        // stack-carried value has no folded spelling, which is the same reason
        // `placeholder` operands decline. Corpus equivalence went 4/421 back to
        // 421/421.
        // ---- branch and return -----------------------------------------------
        //
        // All four carry `values: Expr[]` — the operands pushed before the
        // transfer — and the ones with a condition or index put THAT on top of
        // them. So the folded operand order is `values…` then `cond`/`value`,
        // which is the order `(br_if $l v1 v2 cond)` spells.
        //
        // ⚠️ An earlier pass declared these unfoldable, on the reading that a
        // branch's value lives on the stack and cannot be a child. That was
        // wrong: it came from reading the interfaces with `grep -A 9`, which
        // stops inside the docstrings that precede `values` — so the field was
        // never seen. Folding them with `operands: []` then emitted the head
        // while the linear writer still rendered the value, producing
        // `(i32.const 1 br 0)`. The fix was the field list, not the concept.
        //
        // `BrTableExpr`'s own docstring records the same mistake being made
        // once before: "the first child landed in the index slot and the real
        // index was dropped".
        case 'br':
          return { operands: [...e.values], head: (d) => void d.onBrExpr?.(e) };
        case 'return':
          return { operands: [...e.values], head: (d) => void d.onReturnExpr?.(e) };
        case 'br_if':
          return { operands: [...e.values, e.cond], head: (d) => void d.onBrIfExpr?.(e) };
        case 'br_table':
          return { operands: [...e.values, e.value], head: (d) => void d.onBrTableExpr?.(e) };

        // ---- three operands ---------------------------------------------------
        case 'select':
          return {
            operands: [e.val1, e.val2, e.cond],
            head: (d) => void d.onSelectExpr?.(e),
          };
        case 'memory.copy':
          return {
            operands: [e.dest, e.src, e.size],
            head: (d) => void d.onMemoryCopyExpr?.(e),
          };
        case 'memory.fill':
          return {
            operands: [e.dest, e.value, e.size],
            head: (d) => void d.onMemoryFillExpr?.(e),
          };

        // ---- variadic ---------------------------------------------------------
        case 'call':
          return { operands: [...e.args], head: (d) => void d.onCallExpr?.(e) };
        case 'struct.new':
          return { operands: [...e.operands], head: (d) => void d.onStructNewExpr?.(e) };
        case 'array.new_fixed':
          return { operands: [...e.operands], head: (d) => void d.onArrayNewFixedExpr?.(e) };
        case 'throw':
          return { operands: [...e.args], head: (d) => void d.onThrowExpr?.(e) };
        // `rethrow N` carries no operands — it re-raises the exception caught by
        // the handler at depth N — so it folds as a leaf, `(rethrow 0)`.
        case 'rethrow':
          return { operands: [], head: (d) => void d.onRethrowExpr?.(e) };
        // `call_indirect`'s callee is the table index and comes LAST in the
        // operand order, after the arguments -- the same order the stack sees.
        case 'call_indirect':
          return {
            operands: [...e.args, e.callee],
            head: (d) => void d.onCallIndirectExpr?.(e),
          };

        default:
          return null;
      }
    })();

    if (spec === null) return null;

    // A placeholder operand means "this value is already on the stack". Folded
    // WAT CAN say that — `(local.set 0)` with no operand is legal, and both
    // upstream wabt and upstream binaryen accept it — so a node whose operands
    // are ALL stack-sourced folds to its head alone rather than declining.
    //
    // This used to decline, dropping the whole subtree to the linear writer and
    // emitting a bare `local.set 0`. That is equally legal WAT and equally
    // correct, but nothing downstream that reads folded input could consume it.
    //
    // A MIX folds too, so long as the placeholders form a PREFIX — which they
    // always do, because the reader fills operands from the top of the stack
    // down, so the DEEPEST slots are the ones that run out.
    //
    // 🔧 Corrected 2026-09-01. This used to decline every mix, arguing that
    // `(i32.store (value))` gives one operand for two slots and "a reader
    // assigns it to the FIRST", filling the address with the value. That is
    // backwards. Folding is defined by UNFOLDING: `(instr a b)` is `a b instr`,
    // so the written operands land in the LAST slots and the stack supplies the
    // rest. Measured, not argued — with a non-commutative callee to make slot
    // order observable:
    //
    //     (i32.const 3) (call $sub (i32.const 1))          => 2, i.e. 3 - 1
    //     (i32.const 16) (i32.store (i32.const 42))        stores 42 AT 16
    //
    // Both are the very cases the old comment named as unsafe. So a prefix of
    // stack-sourced operands is expressed by OMITTING it, and the all-stack case
    // is just the whole list omitted rather than a rule of its own.
    //
    // ⚠️ A SCATTERED mix would still be inexpressible — positional operands
    // cannot skip a hole in the middle — so that case still declines. It does
    // not arise from our binary reader, but the guard is cheap and the failure
    // it prevents is silent wrong bytes.
    const firstUsable = spec.operands.findIndex((op) => usable(op));
    if (firstUsable === -1) return { operands: [], head: spec.head };
    if (!spec.operands.slice(firstUsable).every((op) => usable(op))) return null;
    return firstUsable === 0
      ? spec
      : { operands: spec.operands.slice(firstUsable), head: spec.head };
  }

  /**
   * Write `e` folded, returning false if it (or anything beneath it) declines.
   *
   * ⚠️ A false return may come AFTER output has been written, so the caller must
   * not treat it as "nothing happened". `writeExprList` therefore decides
   * foldability for the whole expression up front via {@link canFold} and only
   * then commits — the same reason `writeFoldedConstExpr` pre-checks its
   * operands rather than discovering the problem halfway through.
   */
  private writeFoldedExpr(e: Expr): boolean {
    if (e.kind === 'block' || e.kind === 'loop' || e.kind === 'if' || e.kind === 'try') {
      return this.writeFoldedControl(e);
    }
    const spec = this.foldSpec(e);
    if (spec === null) return false;
    this.puts('(', NC.None);
    this.indent += 2;
    if (spec.operands.length === 0) {
      // A leaf's linear rendering IS its head — nothing to interleave. Uses the
      // LINEAR path directly: going through writeExprList would re-enter the
      // folding branch and wrap the leaf in a second pair of parens.
      this.writeExprListLinear([e]);
    } else {
      spec.head(this.makeDelegate());
      for (const op of spec.operands) {
        if (!this.writeFoldedExpr(op)) return false;
      }
    }
    this.close(NC.Space);
    return true;
  }

  /**
   * Folded rendering for the block-structured expressions.
   *
   * These fold around a BODY rather than around operands, so they do not fit
   * {@link foldSpec}. The distinction matters in one useful way: a folded
   * `(block …)` wraps an instruction SEQUENCE, so its body may itself be linear
   * — which means block and loop always fold, whatever they contain. Only the
   * `if` condition is an operand, and only that can force a decline.
   *
   * The label stack is pushed and popped exactly as the linear path does. `br`
   * depths are resolved against it, so skipping that would silently renumber
   * every branch inside the body — the folded form drops the `end` keyword, not
   * the scope it delimited.
   */
  private writeFoldedControl(e: Expr): boolean {
    switch (e.kind) {
      case 'block':
      case 'loop': {
        const isLoop = e.kind === 'loop';
        this.puts('(', NC.None);
        this.putsSpace(isLoop ? 'loop' : 'block');
        if (e.label) this.writeName(e.label, NC.Space);
        this.writeBlockType(e.blockType);
        this.newline(true);
        this.beginBlock(e.label, isLoop ? LabelType.Loop : LabelType.Block, e.blockType);
        this.indent += 2;
        this.writeExprList(e.body);
        this.indent -= 2;
        this.endBlock();
        this.close(NC.Space);
        return true;
      }
      case 'try': {
        // `(try $l (result T) (do instr*) (catch $tag instr*) (catch_all instr*))`
        //
        // Unlike `block`, the arms are named CLAUSES rather than a bare
        // sequence, so each gets its own paren. A `delegate` replaces the
        // handlers entirely.
        this.puts('(', NC.None);
        this.putsSpace('try');
        if (e.label) this.writeName(e.label, NC.Space);
        this.writeBlockType(e.blockType);
        this.newline(true);
        this.beginBlock(e.label, LabelType.Try, e.blockType);
        this.indent += 2;

        this.puts('(', NC.None);
        this.putsSpace('do');
        this.indent += 2;
        this.writeExprList(e.body);
        this.indent -= 2;
        this.close(NC.Newline);

        if (e.delegate !== undefined) {
          this.puts('(', NC.None);
          this.putsSpace('delegate');
          this.writeVar(e.delegate, NC.None);
          this.close(NC.Newline);
        } else {
          for (const c of e.catches) {
            this.puts('(', NC.None);
            if (c.tag !== undefined) {
              this.putsSpace(c.isRef ? 'catch_ref' : 'catch');
              this.writeVar(c.tag, NC.Space);
            } else {
              this.putsSpace(c.isRef ? 'catch_all_ref' : 'catch_all');
            }
            this.indent += 2;
            this.writeExprList(c.body);
            this.indent -= 2;
            this.close(NC.Newline);
          }
        }

        this.indent -= 2;
        this.endBlock();
        this.close(NC.Space);
        return true;
      }
      case 'if': {
        // `(if blocktype? folded-cond (then instr*) (else instr*)?)`. The
        // condition is an OPERAND, so a placeholder there — meaning the value is
        // already on the stack — has no folded spelling and declines.
        if (!this.canFold(e.cond)) return false;
        this.puts('(', NC.None);
        this.putsSpace('if');
        if (e.label) this.writeName(e.label, NC.Space);
        this.writeBlockType(e.blockType);
        this.newline(true);
        this.indent += 2;
        this.writeFoldedExpr(e.cond);
        this.beginBlock(e.label, LabelType.If, e.blockType);
        this.newline(true);
        this.puts('(', NC.None);
        this.putsSpace('then');
        this.indent += 2;
        this.writeExprList(e.then_);
        this.indent -= 2;
        this.close(NC.Space);
        if (e.else_.length > 0) {
          this.newline(true);
          this.puts('(', NC.None);
          this.putsSpace('else');
          this.indent += 2;
          this.writeExprList(e.else_);
          this.indent -= 2;
          this.close(NC.Space);
        }
        this.endBlock();
        this.indent -= 2;
        this.close(NC.Space);
        return true;
      }
      default:
        return false;
    }
  }

  /** Whether `e` and every descendant can be folded — checked before committing output. */
  private canFold(e: Expr): boolean {
    // A folded block or loop wraps an instruction SEQUENCE, so its body may be
    // linear inside — there is nothing about its contents that can prevent the
    // wrapper. `if` is different only because its condition is an operand.
    // `try` wraps CLAUSES, each holding an instruction sequence, so like block
    // and loop nothing in its contents can prevent the wrapper.
    if (e.kind === 'block' || e.kind === 'loop' || e.kind === 'try') return true;
    if (e.kind === 'if') return this.canFold(e.cond);
    const spec = this.foldSpec(e);
    if (spec === null) return false;
    return spec.operands.every((op) => this.canFold(op));
  }

  /**
   * Write one instruction's opcode and immediates WITHOUT its operands.
   *
   * The delegate callbacks already have exactly this shape — the post-order
   * visitor is what supplies children, not the callback — so this dispatches
   * to the same method the linear path uses. Only the kinds that can carry an
   * operand inside a constant expression need an entry.
   *
   * INTENT — THIS SWITCH IS COUPLED TO `constExprOperands`, and the coupling is
   * not visible from either side. Every kind that function returns a NON-EMPTY
   * operand list for must have a case here. If one is missing, the `default`
   * below writes the instruction *and* its operands (a full linear rendering),
   * and `writeFoldedConstExpr` then writes the operands a second time — so the
   * emitted WAT carries a duplicated operand and still REPARSES, producing a
   * different module with no diagnostic. Same shape as the `writeCatch`
   * duplication (T10.6). Verified by deleting the `ref.i31` case: a table
   * initializer came out as `(i32.const 7 ref.i31 (i32.const 7))`.
   *
   * Gated by `tests/writer/const_expr_head_coupling.test.ts` (T13.21), which
   * reads both switches out of this file and fails if they drift.
   */
  private writeInstrHead(e: Expr): void {
    const d = this.makeDelegate();
    switch (e.kind) {
      case 'ref.i31':
        d.onRefI31Expr?.(e);
        return;
      case 'any.convert_extern':
      case 'extern.convert_any':
        d.onExternConvertExpr?.(e);
        return;
      case 'binary':
        d.onBinaryExpr?.(e);
        return;
      case 'struct.new':
        d.onStructNewExpr?.(e);
        return;
      case 'array.new':
        d.onArrayNewExpr?.(e);
        return;
      case 'array.new_default':
        d.onArrayNewDefaultExpr?.(e);
        return;
      case 'array.new_fixed':
        d.onArrayNewFixedExpr?.(e);
        return;
      default:
        // Every other constant-expression head is a LEAF — `i32.const`,
        // `ref.func`, `ref.null`, `global.get` — and a leaf's head is exactly
        // its linear rendering.
        //
        // ⚠️ This must be the LINEAR writer, not `writeExprList`. Since 1.5.4
        // that folds by default, so it would parenthesise the head inside the
        // parens the caller has already opened: `((ref.func 0))`, which does not
        // parse. The old comment here called this branch unreachable, which was
        // true only while `writeFoldedConstExpr` special-cased leaves — it no
        // longer does, and the two mistakes cancelled out into valid output for
        // exactly as long as linear was the default.
        this.writeExprListLinear([e]);
    }
  }

  // -------------------------------------------------------------------------
  // Module-level section writers
  // -------------------------------------------------------------------------

  private writeTypeEntry(te: TypeEntry): void {
    this.openSpace('type');
    this.writeNameOrIndex(te.name, this.typeIdx++, NC.Space);
    // `(sub final? $super*)` wraps the comptype. Absent means the bare
    // shorthand, which already implies `sub final` with no supertypes.
    if (te.sub !== undefined) {
      this.openSpace('sub');
      if (te.sub.final) this.puts('final', NC.Space);
      for (const sup of te.sub.supertypes) this.writeVar(sup, NC.Space);
    }
    switch (te.kind) {
      case 'func':
        this.openSpace('func');
        this.writeFuncSig(te.sig);
        this.closeSpace();
        break;
      case 'struct': {
        this.openSpace('struct');
        let fi = 0;
        for (const f of te.fields) {
          this.openSpace('field');
          this.writeNameOrIndex(f.name, fi++, NC.Space);
          this.writeField(f);
          this.closeSpace();
        }
        this.closeSpace();
        break;
      }
      case 'array':
        this.openSpace('array');
        this.writeField(te.field);
        this.closeSpace();
        break;
    }
    if (te.sub !== undefined) this.closeSpace(); // closes (sub …)
    this.closeNewline();
  }

  private writeField(f: Field): void {
    if (f.mutable) {
      this.openSpace('mut');
      this.writeType(f.type, NC.Space);
      this.closeSpace();
    } else {
      this.writeType(f.type, NC.Space);
    }
  }

  private writeLimits(lim: Limits): void {
    if (lim.is64) this.writef('i64');
    this.writef(`${lim.initial}`);
    if (lim.max !== undefined) this.writef(`${lim.max}`);
    if (lim.isShared) this.writef('shared');
    // `(pagesize N)` trails the limits, AFTER `shared`, and N is the size in
    // BYTES while the IR holds its log2.
    if (lim.pageSizeLog2 !== undefined) {
      this.openSpace('pagesize');
      this.writef(`${2 ** lim.pageSizeLog2}`);
      this.closeSpace();
    }
  }

  /** Write standalone `(import "m" "f" ...)` entry. */
  private writeImport(imp: Import): void {
    this.openSpace('import');
    this.writeQuotedString(imp.module, NC.Space);
    this.writeQuotedString(imp.field, NC.Space);
    switch (imp.kind) {
      case ExternalKind.Func:
        this.writeFuncBegin(imp.func, /*isImport*/ true);
        this.closeSpace();
        break;
      case ExternalKind.Table:
        this.writeTableDecl(imp.table);
        break;
      case ExternalKind.Memory:
        this.writeMemoryDecl(imp.memory);
        break;
      case ExternalKind.Global:
        this.writeGlobalBegin(imp.global, /*isImport*/ true);
        this.closeSpace();
        break;
      case ExternalKind.Tag:
        this.writeTagDecl(imp.tag);
        break;
    }
    this.closeNewline();
  }

  /** Write `(func ...)` header (name, inline exports/imports, type) for imported funcs. */
  /**
   * Emit the function's `(type N)` type-use.
   *
   * A SIGNATURE does not identify a type: `(sub (func))` and
   * `(sub final (func))` are both `() -> ()` but are not interchangeable. So
   * printing only the inline `(param …) (result …)` loses which type the
   * function actually has, and re-parsing picks whichever entry a structural
   * match lands on. That was invisible while `synthesizeTypes` re-derived the
   * index on both sides — both were equally wrong, so the bytes agreed — and
   * surfaced as soon as an explicit type-use became authoritative (T7.14).
   * wabt's own `wasm2wat` prints it for the same reason.
   */
  private writeFuncTypeUse(func: Func): void {
    if (func.typeVar.kind !== 'index') return;
    this.openSpace('type');
    this.writeVar(func.typeVar, NC.None);
    this.closeSpace();
  }

  private writeFuncBegin(func: Func, _isImport: boolean): void {
    this.openSpace('func');
    this.writeNameOrIndex(func.name, this.funcIdx, NC.Space);
    this.writeInlineExports(ExternalKind.Func, this.funcIdx);
    this.writeFuncTypeUse(func);
    this.writeFuncSig(func.sig);
    this.funcIdx++;
  }

  private writeFunc(func: Func): void {
    this.openSpace('func');
    this.writeNameOrIndex(func.name, this.funcIdx, NC.Space);
    this.writeInlineExports(ExternalKind.Func, this.funcIdx);
    this.writeFuncTypeUse(func);
    this.funcIdx++;
    // Params (named individually if they have names)
    this.writeTypeBindings('param', func.sig.params, func.localDecls, 0);
    this.writeTypes(func.sig.results, 'result');
    this.newline(false);
    // Locals
    if (func.localDecls.length > 0) {
      for (const decl of func.localDecls) {
        for (let k = 0; k < decl.count; k++) {
          this.openSpace('local');
          // Only write the name for the first local in this group
          // (when count > 1 they're anonymous in grouped form)
          if (decl.count === 1) {
            // local might have no name — that's fine
          }
          this.writeType(decl.type, NC.Space);
          this.closeSpace();
        }
      }
      this.newline(false);
    }
    // Body
    this.beginFunc(func);
    this.writeExprList(func.body);
    this.endFunc();
    this.closeNewline();
  }

  private writeTypeBindings(
    prefix: string,
    types: ValueType[],
    _decls: LocalDecl[],
    _offset: number,
  ): void {
    // For params, write grouped (param i32 i64) or individually ($name i32)
    if (types.length === 0) return;
    // For simplicity, write all params as one group per type
    let i = 0;
    while (i < types.length) {
      // Check if consecutive params have same type and no names
      this.openSpace(prefix);
      this.writeType(types[i]!, NC.Space);
      i++;
      while (i < types.length) {
        this.writeType(types[i]!, NC.Space);
        i++;
      }
      this.closeSpace();
      break; // single group for all params
    }
  }

  private writeGlobalBegin(g: Global, _isImport: boolean): void {
    this.openSpace('global');
    this.writeNameOrIndex(g.name, this.globalIdx, NC.Space);
    this.writeInlineExports(ExternalKind.Global, this.globalIdx);
    this.globalIdx++;
    if (g.mutable) {
      this.openSpace('mut');
      this.writeType(g.type, NC.Space);
      this.closeSpace();
    } else {
      this.writeType(g.type, NC.Space);
    }
  }

  private writeGlobal(g: Global): void {
    this.writeGlobalBegin(g, false);
    this.writeInitExpr(g.init);
    this.closeNewline();
  }

  private writeTableDecl(t: Table): void {
    this.openSpace('table');
    this.writeNameOrIndex(t.name, this.tableIdx, NC.Space);
    this.writeInlineExports(ExternalKind.Table, this.tableIdx);
    this.tableIdx++;
    this.writeLimits(t.limits);
    this.writeType(t.elemType, NC.Space);
    // T10.3. Dropping `t.init` here was not cosmetic: a NON-NULLABLE element
    // type has no default value, so the spec REQUIRES the `0x40` init form
    // for it, and the re-encoded plain form is rejected outright.
    //
    // The table grammar takes ONE FOLDED instruction here and has no
    // `(item …)` wrapper to hold a linear sequence, which is why this needed
    // `writeFoldedConstExpr` rather than the usual `writeInitExpr`.
    if (t.init.length === 1) {
      if (!this.writeFoldedConstExpr(t.init[0]!)) {
        throw new Error(
          `wat writer: table initializer is not a constant expression ` +
            `(${t.init[0]!.kind}); it cannot be written in the folded form ` +
            `the table grammar requires`,
        );
      }
    } else if (t.init.length > 1) {
      // A constant expression is `instr*`, but the table slot holds exactly
      // one folded instruction — and the IR stores one expression TREE per
      // element, so more than one is a decoder bug rather than valid input.
      throw new Error(
        `wat writer: table initializer has ${t.init.length} expressions; ` +
          `the table grammar holds exactly one`,
      );
    }
    this.closeNewline();
  }

  private writeMemoryDecl(m: Memory): void {
    this.openSpace('memory');
    this.writeNameOrIndex(m.name, this.memoryIdx, NC.Space);
    this.writeInlineExports(ExternalKind.Memory, this.memoryIdx);
    this.memoryIdx++;
    this.writeLimits(m.limits);
    this.closeNewline();
  }

  private writeTagDecl(tag: Tag): void {
    this.openSpace('tag');
    this.writeNameOrIndex(tag.name, this.tagIdx, NC.Space);
    this.writeInlineExports(ExternalKind.Tag, this.tagIdx);
    this.tagIdx++;
    this.writeFuncSig(tag.sig);
    this.closeNewline();
  }

  private writeExport(exp: Export): void {
    if (this.isInlineExport(exp)) return;
    this.openSpace('export');
    this.writeQuotedString(exp.name, NC.Space);
    const kindStr = exp.kind === ExternalKind.Func
      ? 'func'
      : exp.kind === ExternalKind.Global
      ? 'global'
      : exp.kind === ExternalKind.Table
      ? 'table'
      : exp.kind === ExternalKind.Memory
      ? 'memory'
      : 'tag';
    this.openSpace(kindStr);
    this.writeVar(exp.var, NC.Space);
    this.closeSpace();
    this.closeNewline();
  }

  private writeElemSegment(seg: ElemSegment): void {
    this.openSpace('elem');
    this.writeNameOrIndex(seg.name, this.elemSegIdx++, NC.Space);

    if (seg.kind === 'active') {
      // Emit table ref unless it's table 0
      const tableIdx = this.resolveVarIndex(seg.tableVar, ExternalKind.Table);
      if (tableIdx !== 0) {
        this.openSpace('table');
        this.writeVar(seg.tableVar, NC.Space);
        this.closeSpace();
      }
      this.writeOffsetExpr(seg.offset);
    } else if (seg.kind === 'declared') {
      this.putsSpace('declare');
    }

    // Element type and values
    // The `func $a $b` shorthand IS the funcidx elemlist, whose element type
    // is the non-nullable `(ref func)`. Gating it on the NULLABLE `funcref`
    // was backwards: it printed a `funcref` segment in a spelling that means
    // `(ref func)`, so the declared nullability was lost in the text and the
    // re-encode came back a different segment.
    const useFuncShorthand = isRefValueType(seg.elemType) && !seg.elemType.nullable &&
      seg.elemType.heapType.kind === 'name' && seg.elemType.heapType.name === 'func' &&
      seg.elemExprs.every((ee) => ee.length === 1 && ee[0]?.kind === 'ref.func');

    if (useFuncShorthand) {
      this.putsSpace('func');
      for (const ee of seg.elemExprs) {
        const e = ee[0];
        if (e?.kind === 'ref.func') this.writeVar(e.func, NC.Space);
      }
    } else {
      this.writeType(seg.elemType, NC.Space);
      for (const ee of seg.elemExprs) {
        this.writeElemExpr(ee);
      }
    }
    this.closeNewline();
  }

  private writeDataSegment(seg: DataSegment): void {
    this.openSpace('data');
    this.writeNameOrIndex(seg.name, this.dataSegIdx++, NC.Space);
    if (seg.kind === 'active') {
      const memIdx = this.resolveVarIndex(seg.memoryVar, ExternalKind.Memory);
      if (memIdx !== 0) {
        this.openSpace('memory');
        this.writeVar(seg.memoryVar, NC.Space);
        this.closeSpace();
      }
      this.writeOffsetExpr(seg.offset);
    }
    this.writeQuotedData(seg.data);
    this.closeNewline();
  }

  private writeStartFunction(v: Var): void {
    this.openSpace('start');
    this.writeVar(v, NC.None);
    this.closeNewline();
  }

  private writeCustom(c: Custom): void {
    this.openSpace('@custom');
    this.writeQuotedString(c.name, NC.Space);
    this.writeQuotedData(c.data);
    this.closeNewline();
  }

  // -------------------------------------------------------------------------
  // Top-level module writer
  // -------------------------------------------------------------------------

  writeModule(): string {
    this.buildExportMap();

    this.openSpace('module');
    if (this.module.name.length > 0) {
      this.writeName(this.module.name, NC.Newline);
    } else {
      this.newline(false);
    }

    // 1. Type section, walked as REC GROUPS. Writing the entries flat dropped
    //    both the `(rec …)` wrapper and — via writeTypeEntry — the `(sub …)`
    //    declarations, so a wasm2wat round-trip silently lost the recursion
    //    and the subtype relations. It still REPARSED, which is why a
    //    "does it round-trip" check did not catch it.
    for (const g of recGroups(this.module.types)) {
      if (g.explicit) {
        this.openSpace('rec');
        for (let i = g.start; i < g.start + g.count; i++) {
          this.writeTypeEntry(this.module.types[i]!);
        }
        this.closeNewline();
      } else {
        this.writeTypeEntry(this.module.types[g.start]!);
      }
    }

    // 2. All imports (in declaration order)
    for (const imp of this.module.imports) {
      if (this.opts.inlineImport) {
        // Skip standalone — they'll be emitted inline with their definition
      } else {
        // Track indices while writing imports
        this.writeImport(imp);
        // Advance the corresponding kind counter
        // (funcIdx/globalIdx/etc. were already advanced in writeFuncBegin etc.)
        // But writeImport calls writeFuncBegin which advances funcIdx already, EXCEPT
        // for Table/Memory/Global/Tag whose Begin methods advance the counters.
        // So we need to not double-count. The counters are advanced inside each write*Decl/writeGlobalBegin.
      }
    }

    // 3. Defined funcs
    for (const func of this.module.funcs) {
      this.writeFunc(func);
    }

    // 4. Defined tables
    for (const table of this.module.tables) {
      this.writeTableDecl(table);
    }

    // 5. Defined memories
    for (const mem of this.module.memories) {
      this.writeMemoryDecl(mem);
    }

    // 6. Defined globals
    for (const g of this.module.globals) {
      this.writeGlobal(g);
    }

    // 7. Defined tags
    for (const tag of this.module.tags) {
      this.writeTagDecl(tag);
    }

    // 8. Exports (non-inlined)
    for (const exp of this.module.exports) {
      this.writeExport(exp);
    }

    // 9. Start
    if (this.module.start !== undefined) {
      this.writeStartFunction(this.module.start);
    }

    // 10. Element segments
    for (const seg of this.module.elemSegments) {
      this.writeElemSegment(seg);
    }

    // 11. Data segments
    for (const seg of this.module.dataSegments) {
      this.writeDataSegment(seg);
    }

    // 12. Custom sections
    for (const custom of this.module.customs) {
      this.writeCustom(custom);
    }

    this.closeNewline();
    this.flushNextChar();
    return this.out.join('');
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/**
 * Operand sub-expressions of a CONSTANT expression, in stack order, or `null`
 * when `e` is not one.
 *
 * Kept to the constant-expression grammar on purpose — that list is closed by
 * the spec (const family, `ref` forms, `global.get`, extended-const
 * arithmetic, GC allocations) and is the same one the validator's
 * constant-expression check enforces. It is not a general operand table for
 * the instruction set, and should not grow into one: the only callers are
 * grammar slots that take a single folded instruction.
 *
 * INTENT — ADDING A CASE HERE THAT RETURNS OPERANDS OBLIGES YOU TO ADD ONE TO
 * `WatWriter.writeInstrHead` TOO. The two are coupled and neither signature
 * shows it: a kind with operands here but no head-writer case emits the
 * instruction with its operands AND then the operands again, which reparses
 * cleanly as a different module. Returning `[]` (a leaf) carries no such
 * obligation — that path never calls `writeInstrHead`. Gated by
 * `tests/writer/const_expr_head_coupling.test.ts` (T13.21).
 */
function constExprOperands(e: Expr): Expr[] | null {
  switch (e.kind) {
    case 'const':
    case 'ref.null':
    case 'ref.func':
    case 'global.get':
    case 'struct.new_default':
      return [];
    case 'ref.i31':
    case 'any.convert_extern':
    case 'extern.convert_any':
      return [e.value];
    case 'array.new_default':
      return [e.length];
    case 'array.new':
      return [e.init, e.length];
    case 'binary':
      // Extended-const arithmetic: i32/i64 add, sub, mul.
      return [e.left, e.right];
    case 'struct.new':
    case 'array.new_fixed':
      return e.operands;
    default:
      return null;
  }
}

function importItemName(imp: Import): string {
  switch (imp.kind) {
    case ExternalKind.Func:
      return imp.func.name;
    case ExternalKind.Table:
      return imp.table.name;
    case ExternalKind.Memory:
      return imp.memory.name;
    case ExternalKind.Global:
      return imp.global.name;
    case ExternalKind.Tag:
      return imp.tag.name;
  }
}
