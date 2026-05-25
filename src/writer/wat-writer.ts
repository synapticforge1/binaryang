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
  Module, Func, Expr, Global, Table, Memory, Tag, Import, Export,
  TypeEntry, Field, Limits, ElemSegment, DataSegment, Custom, Const,
  FuncSignature, LocalDecl, Var, BlockType, Catch, TableCatch,
} from '../ir/ir.ts';
import { ExternalKind } from '../core/binary.ts';
import { Type, typeName } from '../core/types.ts';
import { printF32Literal, printF64Literal } from '../core/literal.ts';
import { anyOpcodeName } from '../core/opcode.ts';
import { ModuleContext, LabelType } from '../ir/ir-util.ts';
import { ExprVisitor } from '../ir/expr-visitor.ts';
import type { ExprVisitorDelegate } from '../ir/expr-visitor.ts';
import { Result } from '../core/result.ts';

// UTF-8 encoder reused for every writeQuotedString call. Stateless, so a
// single module-level instance is safe and avoids reallocating per string.
const TEXT_ENCODER = new TextEncoder();

// ---------------------------------------------------------------------------
// Public options & entry point
// ---------------------------------------------------------------------------

export interface WriteWatOptions {
  /** Emit `(export "name")` inline inside func/global/table/memory declarations. Default: true. */
  inlineExport?: boolean;
  /** Emit `(import "m" "f")` inline inside declarations instead of standalone. Default: false. */
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
  for (let i = 0; i < 32; i++) t[i] = 1;     // control chars
  t[0x22] = 1; // "
  t[0x5c] = 1; // backslash
  for (let i = 0x7f; i < 256; i++) t[i] = 1;  // non-ASCII
  return t;
})();

// Characters permitted in a WAT identifier ($name) without quoting.
// Matches s_valid_name_chars in wat-writer.cc.
const VALID_NAME_CHARS: Uint8Array = (() => {
  const t = new Uint8Array(256);
  const allow = '!#$%&\'*+-./:<=>?@\\^_`|~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  for (const c of allow) t[c.charCodeAt(0)] = 1;
  return t;
})();

// ---------------------------------------------------------------------------
// Next-char state (controls spacing between tokens)
// ---------------------------------------------------------------------------

const enum NC { None, Space, Newline, ForceNewline }

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

  // Inline import arrays by kind (populated only when inlineImport=true)
  private readonly funcImports: Import[] = [];
  private readonly tableImports: Import[] = [];
  private readonly memoryImports: Import[] = [];
  private readonly globalImports: Import[] = [];
  private readonly tagImports: Import[] = [];

  // Name → absolute index map keyed by "kind:name". Built once and used by
  // resolveVarIndex to avoid linearly scanning imports + defs for every
  // name-based Var; the writer touches resolveVarIndex once per export plus
  // once per inline-export check, so the previous O(imports+defs) scan grew
  // quadratic on modules with many exports.
  private readonly nameIndexMap = new Map<string, number>();

  constructor(module: Module, opts: WriteWatOptions) {
    super(module);
    this.opts = {
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

  private putsSpace(s: string): void { this.puts(s, NC.Space); }
  private putsNewline(s: string): void { this.puts(s, NC.Newline); }

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

  private openSpace(name: string): void { this.open(name, NC.Space); }
  private openNewline(name: string): void { this.open(name, NC.Newline); }

  private close(nc: NC): void {
    if (this.nextChar !== NC.ForceNewline) this.nextChar = NC.None;
    this.indent -= 2;
    this.puts(')', nc);
  }

  private closeNewline(): void { this.close(NC.Newline); }
  private closeSpace(): void { this.close(NC.Space); }

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

  private writeType(t: Type, nc: NC): void {
    this.puts(typeName(t), nc);
  }

  private writeTypes(types: Type[], label: string | null): void {
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

  private writeRefKind(t: Type, nc: NC): void {
    const name =
      t === Type.Func ? 'func' :
      t === Type.ExternRef ? 'extern' :
      t === Type.ExnRef ? 'exn' : typeName(t);
    this.puts(name, nc);
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
    this.puts('(', NC.None);
    this.writeExprList(exprs);
    this.nextChar = NC.None;
    this.puts(')', NC.Space);
  }

  // -------------------------------------------------------------------------
  // Memory arg emit helpers
  // -------------------------------------------------------------------------

  private writeMemarg(opName: string, offset: bigint, align: number, naturalAlign: number, memidx: Var): void {
    this.putsSpace(opName);
    this.writeMemoryVarUnlessZero(memidx, NC.Space);
    if (offset !== 0n) this.writef(`offset=${offset}`);
    if (align !== naturalAlign) this.writef(`align=${align}`);
    this.newline(false);
  }

  // -------------------------------------------------------------------------
  // Inline export map
  // -------------------------------------------------------------------------

  private buildExportMap(): void {
    if (!this.opts.inlineExport) return;
    for (const exp of this.module.exports) {
      const idx = this.resolveVarIndex(exp.var, exp.kind);
      const key = `${exp.kind}:${idx}`;
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
      onNopExpr:        () => { this.putsNewline('nop'); return Result.Ok; },
      onUnreachableExpr:() => { this.putsNewline('unreachable'); return Result.Ok; },
      onDropExpr:       () => { this.putsNewline('drop'); return Result.Ok; },
      onReturnExpr:     () => { this.putsNewline('return'); return Result.Ok; },

      onConstExpr: (e) => { this.writeConst(e.value); return Result.Ok; },

      onLocalGetExpr: (e) => { this.putsSpace('local.get'); this.writeVar(e.var, NC.Newline); return Result.Ok; },
      onLocalSetExpr: (e) => { this.putsSpace('local.set'); this.writeVar(e.var, NC.Newline); return Result.Ok; },
      onLocalTeeExpr: (e) => { this.putsSpace('local.tee'); this.writeVar(e.var, NC.Newline); return Result.Ok; },
      onGlobalGetExpr:(e) => { this.putsSpace('global.get'); this.writeVar(e.var, NC.Newline); return Result.Ok; },
      onGlobalSetExpr:(e) => { this.putsSpace('global.set'); this.writeVar(e.var, NC.Newline); return Result.Ok; },

      onUnaryExpr:   (e) => { this.putsNewline(opname(e.opcode)); return Result.Ok; },
      onBinaryExpr:  (e) => { this.putsNewline(opname(e.opcode)); return Result.Ok; },
      onCompareExpr: (e) => { this.putsNewline(opname(e.opcode)); return Result.Ok; },
      onConvertExpr: (e) => { this.putsNewline(opname(e.opcode)); return Result.Ok; },
      onTernaryExpr: (e) => { this.putsNewline(opname(e.opcode)); return Result.Ok; },
      onQuaternaryExpr:(e)=> { this.putsNewline(opname(e.opcode)); return Result.Ok; },

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
        this.writeVar(e.segment, NC.Space);
        this.writeMemoryVarUnlessZero(e.memidx, NC.Space);
        this.newline(false);
        return Result.Ok;
      },
      onDataDropExpr: (e) => {
        this.putsSpace('data.drop');
        this.writeVar(e.segment, NC.Newline);
        return Result.Ok;
      },

      onCallExpr: (e) => { this.putsSpace('call'); this.writeVar(e.func, NC.Newline); return Result.Ok; },
      onCallIndirectExpr: (e) => {
        this.putsSpace('call_indirect');
        this.writeVarUnlessZero(e.table, NC.Space);
        this.openSpace('type');
        this.writeVar(e.typeVar, NC.Newline);
        this.closeNewline();
        return Result.Ok;
      },
      onCallRefExpr: (e) => { this.putsSpace('call_ref'); this.writeVar(e.sigType, NC.Newline); return Result.Ok; },
      onReturnCallExpr: (e) => { this.putsSpace('return_call'); this.writeVar(e.func, NC.Newline); return Result.Ok; },
      onReturnCallIndirectExpr: (e) => {
        this.putsSpace('return_call_indirect');
        this.openSpace('type');
        this.writeVar(e.typeVar, NC.Space);
        this.closeNewline();
        return Result.Ok;
      },
      onReturnCallRefExpr: (e) => { this.putsSpace('return_call_ref'); this.writeVar(e.sigType, NC.Newline); return Result.Ok; },

      onRefNullExpr: (e) => {
        this.putsSpace('ref.null');
        if (e.refType.kind === 'name') {
          this.writeName(e.refType.name, NC.Newline);
        } else {
          // index-based refType: look up type entry
          const te = this.module.types[e.refType.value];
          if (te) this.putsNewline(te.kind === 'func' ? 'func' : te.kind);
          else this.writef(`${e.refType.value}`);
        }
        return Result.Ok;
      },
      onRefIsNullExpr:  () => { this.putsNewline('ref.is_null'); return Result.Ok; },
      onRefFuncExpr:    (e) => { this.putsSpace('ref.func'); this.writeVar(e.func, NC.Newline); return Result.Ok; },
      onRefAsNonNullExpr:()=> { this.putsNewline('ref.as_non_null'); return Result.Ok; },

      onTableGetExpr:  (e) => { this.putsSpace('table.get'); this.writeVar(e.table, NC.Newline); return Result.Ok; },
      onTableSetExpr:  (e) => { this.putsSpace('table.set'); this.writeVar(e.table, NC.Newline); return Result.Ok; },
      onTableGrowExpr: (e) => { this.putsSpace('table.grow'); this.writeVar(e.table, NC.Newline); return Result.Ok; },
      onTableSizeExpr: (e) => { this.putsSpace('table.size'); this.writeVar(e.table, NC.Newline); return Result.Ok; },
      onTableFillExpr: (e) => { this.putsSpace('table.fill'); this.writeVar(e.table, NC.Newline); return Result.Ok; },
      onTableCopyExpr: (e) => {
        this.putsSpace('table.copy');
        if (e.dst.kind !== 'index' || e.dst.value !== 0 || e.src.kind !== 'index' || e.src.value !== 0) {
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
      onElemDropExpr: (e) => { this.putsSpace('elem.drop'); this.writeVar(e.segment, NC.Newline); return Result.Ok; },

      onThrowExpr:    (e) => { this.putsSpace('throw'); this.writeVar(e.tag, NC.Newline); return Result.Ok; },
      onThrowRefExpr: () => { this.putsNewline('throw_ref'); return Result.Ok; },
      onRethrowExpr:  (e) => { this.putsSpace('rethrow'); this.writeBrVar(e.depth, NC.Newline); return Result.Ok; },

      onBrExpr:       (e) => { this.putsSpace('br'); this.writeBrVar(e.target, NC.Newline); return Result.Ok; },
      onBrIfExpr:     (e) => { this.putsSpace('br_if'); this.writeBrVar(e.target, NC.Newline); return Result.Ok; },
      onBrOnNullExpr: (e) => { this.putsSpace('br_on_null'); this.writeBrVar(e.target, NC.Newline); return Result.Ok; },
      onBrOnNonNullExpr:(e)=>{ this.putsSpace('br_on_non_null'); this.writeBrVar(e.target, NC.Newline); return Result.Ok; },
      onBrTableExpr:  (e) => {
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
        this.writeMemarg(opname(e.opcode), e.offset, e.align, 1, e.memidx);
        return Result.Ok;
      },
      onAtomicStoreExpr: (e) => {
        this.writeMemarg(opname(e.opcode), e.offset, e.align, 1, e.memidx);
        return Result.Ok;
      },
      onAtomicRmwExpr: (e) => {
        this.writeMemarg(opname(e.opcode), e.offset, e.align, 1, e.memidx);
        return Result.Ok;
      },
      onAtomicRmwCmpxchgExpr: (e) => {
        this.writeMemarg(opname(e.opcode), e.offset, e.align, 1, e.memidx);
        return Result.Ok;
      },
      onAtomicWaitExpr: (e) => {
        this.writeMemarg(opname(e.opcode), e.offset, e.align, 1, e.memidx);
        return Result.Ok;
      },
      onAtomicNotifyExpr: (e) => {
        this.writeMemarg('memory.atomic.notify', e.offset, e.align, 1, e.memidx);
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
    this.indent -= 2;
    if (c.tag !== undefined) {
      this.putsSpace(c.isRef ? 'catch_ref' : 'catch');
      this.writeVar(c.tag, NC.Newline);
    } else {
      this.putsNewline(c.isRef ? 'catch_all_ref' : 'catch_all');
    }
    this.indent += 2;
    this.newline(true);
    this.writeExprList(c.body);
  }

  private writeTableCatch(tc: TableCatch): void {
    this.puts('(', NC.None);
    switch (tc.kind) {
      case 'catch':       this.putsSpace('catch'); break;
      case 'catch_ref':   this.putsSpace('catch_ref'); break;
      case 'catch_all':   this.putsSpace('catch_all'); break;
      case 'catch_all_ref': this.putsSpace('catch_all_ref'); break;
    }
    if (tc.tag !== undefined) this.writeVar(tc.tag, NC.Space);
    this.writeBrVar(tc.target, NC.None);
    this.puts(')', NC.Newline);
  }

  // -------------------------------------------------------------------------
  // Expression list writer (uses ExprVisitor)
  // -------------------------------------------------------------------------

  private writeExprList(exprs: Expr[]): void {
    const delegate = this.makeDelegate();
    const visitor = new ExprVisitor(delegate);
    visitor.visitExprList(exprs);
  }

  // -------------------------------------------------------------------------
  // Module-level section writers
  // -------------------------------------------------------------------------

  private writeTypeEntry(te: TypeEntry): void {
    this.openSpace('type');
    this.writeNameOrIndex(te.name, this.typeIdx++, NC.Space);
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
    if (lim.pageSize !== undefined && lim.pageSize !== 65536) {
      this.openSpace('pagesize');
      this.writef(`${lim.pageSize}`);
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
  private writeFuncBegin(func: Func, _isImport: boolean): void {
    this.openSpace('func');
    this.writeNameOrIndex(func.name, this.funcIdx, NC.Space);
    this.writeInlineExports(ExternalKind.Func, this.funcIdx);
    this.writeFuncSig(func.sig);
    this.funcIdx++;
  }

  private writeFunc(func: Func): void {
    this.openSpace('func');
    this.writeNameOrIndex(func.name, this.funcIdx, NC.Space);
    this.writeInlineExports(ExternalKind.Func, this.funcIdx);
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

  private writeTypeBindings(prefix: string, types: Type[], _decls: LocalDecl[], _offset: number): void {
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
    this.writeType(t.elemType, NC.None);
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
    const kindStr =
      exp.kind === ExternalKind.Func ? 'func' :
      exp.kind === ExternalKind.Global ? 'global' :
      exp.kind === ExternalKind.Table ? 'table' :
      exp.kind === ExternalKind.Memory ? 'memory' : 'tag';
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
      this.writeInitExpr(seg.offset);
    } else if (seg.kind === 'declared') {
      this.putsSpace('declare');
    }

    // Element type and values
    const useFuncShorthand =
      seg.elemType === Type.FuncRef &&
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
        this.writeInitExpr(ee);
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
      this.writeInitExpr(seg.offset);
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

    // 1. Type section
    for (const te of this.module.types) {
      this.writeTypeEntry(te);
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

function importItemName(imp: Import): string {
  switch (imp.kind) {
    case ExternalKind.Func:   return imp.func.name;
    case ExternalKind.Table:  return imp.table.name;
    case ExternalKind.Memory: return imp.memory.name;
    case ExternalKind.Global: return imp.global.name;
    case ExternalKind.Tag:    return imp.tag.name;
  }
}

// ---------------------------------------------------------------------------
// Natural alignment for load/store opcodes (bytes, not log2)
// ---------------------------------------------------------------------------

function naturalAlignForOpcode(op: number): number {
  switch (op) {
    // align 1
    case 0x2c: case 0x2d: // i32.load8_s, i32.load8_u
    case 0x30: case 0x31: // i64.load8_s, i64.load8_u
    case 0x3a:            // i32.store8
    case 0x3c:            // i64.store8
      return 1;
    // align 2
    case 0x2e: case 0x2f: // i32.load16_s, i32.load16_u
    case 0x32: case 0x33: // i64.load16_s, i64.load16_u
    case 0x3b:            // i32.store16
    case 0x3d:            // i64.store16
      return 2;
    // align 4
    case 0x28:            // i32.load
    case 0x2a:            // f32.load
    case 0x34: case 0x35: // i64.load32_s, i64.load32_u
    case 0x36:            // i32.store
    case 0x38:            // f32.store
    case 0x3e:            // i64.store32
      return 4;
    // align 8
    case 0x29:            // i64.load
    case 0x2b:            // f64.load
    case 0x37:            // i64.store
    case 0x39:            // f64.store
      return 8;
    default:
      return 1;
  }
}
