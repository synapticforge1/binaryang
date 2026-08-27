// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * Type-system mapping between the wabt-ts IR and binaryen-ts.
 *
 * Phase 7 — kept minimal and stateless so the bridge module (and any future
 * caller that needs to translate types in isolation) can depend on it without
 * pulling in the bridge's expression walker.
 */

import { Type } from '../core/types.ts';
import { coarsenValueType, type ValueType } from '../ir/ir.ts';
import { ValType } from '../../binaryen-ts/ir/index.ts';

/**
 * Map a wabt-ts value type to the binaryen-ts string `ValType`.
 *
 * binaryen-ts's `ValType` is flat, so a CONCRETE typed reference
 * (`(ref $T)`) has no counterpart and coarsens to its abstract supertype —
 * the same loss the whole IR used to take. wabt-ts's own binary writer is
 * precise; only this bridge is lossy, and only because the target type
 * system is.
 */
export function wabtTypeToValType(tIn: ValueType): ValType {
  const t = coarsenValueType(tIn);
  switch (t) {
    case Type.I32:
      return ValType.I32;
    case Type.I64:
      return ValType.I64;
    case Type.F32:
      return ValType.F32;
    case Type.F64:
      return ValType.F64;
    case Type.V128:
      return ValType.V128;
    case Type.FuncRef:
      return ValType.FuncRef;
    case Type.ExternRef:
      return ValType.ExternRef;
    case Type.ExnRef:
      return ValType.ExnRef;
    // GC abstract heap types
    case Type.AnyRef:
      return ValType.AnyRef;
    case Type.EqRef:
      return ValType.EqRef;
    case Type.I31Ref:
      return ValType.I31Ref;
    case Type.StructRef:
      return ValType.StructRef;
    case Type.ArrayRef:
      return ValType.ArrayRef;
    case Type.NullRef:
      return ValType.NullRef;
    case Type.NullFuncRef:
      return ValType.NullFuncRef;
    case Type.NullExternRef:
      return ValType.NullExternRef;
    case Type.NullExnRef:
      return ValType.NullExnRef;
    default:
      throw new Error(`Unknown wabt Type code: 0x${t.toString(16)}`);
  }
}
