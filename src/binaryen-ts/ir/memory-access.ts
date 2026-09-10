/**
 * @module binaryen-ts/ir/memory-access
 *
 * The ONE table relating a plain load/store opcode to its access width,
 * signedness and value type.
 *
 * 🔑 **Why this exists.** A `Load`/`Store` node used to hold `bytes` + `signed`
 * and have its opcode RECOMPUTED from them — plus, for a store, from its
 * operand's type. That relationship was written out five times: the encoder's
 * `loadOpcode` / `storeOpcode`, the bridge's `loadInfo` / `storeBytes`, and the
 * WAT parser's `loadBytes` / `storeBytes`, which sniffed the mnemonic string.
 *
 * Two of those five disagreed with the spec and with each other in a way that
 * cancelled: the encoder and the binary decoder carried INVERSE rotations of
 * the i64 narrow stores, so `i64.store8` wrote two bytes while every round-trip
 * gate stayed byte-identical (see `narrow_store_width.test.ts`). And because a
 * store's opcode was derived from its operand's TYPE, a store whose operand had
 * not been typed could not be encoded at all — five of the bridge's 24 failures.
 *
 * The node now holds the OPCODE, which is the as-written form and names exactly
 * one instruction. Width, signedness and type are derived from it, here, once.
 * A combination that is not a real instruction is unrepresentable.
 *
 * @license MIT
 */

import {
  anyOpcodeName,
  Opcode,
  OPCODE_V128_LOAD,
  OPCODE_V128_STORE,
} from '../../wabt-ts/core/opcode.ts';
import { ValType } from './types.ts';

/** What a load opcode means. */
export interface LoadShape {
  readonly opcode: Opcode;
  /** Bytes read from memory. */
  readonly bytes: 1 | 2 | 4 | 8 | 16;
  /** Sign-extends a narrow read. Always `false` for a full-width load. */
  readonly signed: boolean;
  /** The value the load produces. */
  readonly type: ValType;
  /** The text-format mnemonic. */
  readonly name: string;
}

/** What a store opcode means. */
export interface StoreShape {
  readonly opcode: Opcode;
  /** Bytes written to memory. */
  readonly bytes: 1 | 2 | 4 | 8 | 16;
  /** The operand type the store consumes. */
  readonly valueType: ValType;
  /** The text-format mnemonic. */
  readonly name: string;
}

const L = (
  opcode: Opcode,
  bytes: LoadShape['bytes'],
  signed: boolean,
  type: ValType,
  name: string,
): LoadShape => ({ opcode, bytes, signed, type, name });

const S = (
  opcode: Opcode,
  bytes: StoreShape['bytes'],
  valueType: ValType,
  name: string,
): StoreShape => ({ opcode, bytes, valueType, name });

const LOADS: readonly LoadShape[] = [
  L(Opcode.I32Load, 4, false, ValType.I32, 'i32.load'),
  L(Opcode.I64Load, 8, false, ValType.I64, 'i64.load'),
  L(Opcode.F32Load, 4, false, ValType.F32, 'f32.load'),
  L(Opcode.F64Load, 8, false, ValType.F64, 'f64.load'),
  L(Opcode.I32Load8S, 1, true, ValType.I32, 'i32.load8_s'),
  L(Opcode.I32Load8U, 1, false, ValType.I32, 'i32.load8_u'),
  L(Opcode.I32Load16S, 2, true, ValType.I32, 'i32.load16_s'),
  L(Opcode.I32Load16U, 2, false, ValType.I32, 'i32.load16_u'),
  L(Opcode.I64Load8S, 1, true, ValType.I64, 'i64.load8_s'),
  L(Opcode.I64Load8U, 1, false, ValType.I64, 'i64.load8_u'),
  L(Opcode.I64Load16S, 2, true, ValType.I64, 'i64.load16_s'),
  L(Opcode.I64Load16U, 2, false, ValType.I64, 'i64.load16_u'),
  L(Opcode.I64Load32S, 4, true, ValType.I64, 'i64.load32_s'),
  L(Opcode.I64Load32U, 4, false, ValType.I64, 'i64.load32_u'),
  L(OPCODE_V128_LOAD, 16, false, ValType.V128, 'v128.load'),
];

const STORES: readonly StoreShape[] = [
  S(Opcode.I32Store, 4, ValType.I32, 'i32.store'),
  S(Opcode.I64Store, 8, ValType.I64, 'i64.store'),
  S(Opcode.F32Store, 4, ValType.F32, 'f32.store'),
  S(Opcode.F64Store, 8, ValType.F64, 'f64.store'),
  S(Opcode.I32Store8, 1, ValType.I32, 'i32.store8'),
  S(Opcode.I32Store16, 2, ValType.I32, 'i32.store16'),
  S(Opcode.I64Store8, 1, ValType.I64, 'i64.store8'),
  S(Opcode.I64Store16, 2, ValType.I64, 'i64.store16'),
  S(Opcode.I64Store32, 4, ValType.I64, 'i64.store32'),
  S(OPCODE_V128_STORE, 16, ValType.V128, 'v128.store'),
];

const LOAD_BY_OPCODE = new Map(LOADS.map((l) => [l.opcode, l]));
const STORE_BY_OPCODE = new Map(STORES.map((s) => [s.opcode, s]));
const LOAD_BY_NAME = new Map(LOADS.map((l) => [l.name, l]));
const STORE_BY_NAME = new Map(STORES.map((s) => [s.name, s]));

/** Every load and store row — exported so a test can check the table itself. */
export const MEMORY_ACCESS_TABLE: {
  readonly loads: readonly LoadShape[];
  readonly stores: readonly StoreShape[];
} = { loads: LOADS, stores: STORES };

/** What `opcode` means as a load. Throws when it is not a plain load. */
export function loadShape(opcode: Opcode): LoadShape {
  const l = LOAD_BY_OPCODE.get(opcode);
  if (l === undefined) {
    throw new Error(`not a plain load opcode: 0x${opcode.toString(16)} (${anyOpcodeName(opcode)})`);
  }
  return l;
}

/** What `opcode` means as a store. Throws when it is not a plain store. */
export function storeShape(opcode: Opcode): StoreShape {
  const s = STORE_BY_OPCODE.get(opcode);
  if (s === undefined) {
    throw new Error(
      `not a plain store opcode: 0x${opcode.toString(16)} (${anyOpcodeName(opcode)})`,
    );
  }
  return s;
}

/** The load a WAT mnemonic names, or `undefined` when it names none. */
export function loadByName(name: string): LoadShape | undefined {
  return LOAD_BY_NAME.get(name);
}

/** The store a WAT mnemonic names, or `undefined` when it names none. */
export function storeByName(name: string): StoreShape | undefined {
  return STORE_BY_NAME.get(name);
}

/**
 * The same-width load with the requested signedness.
 *
 * For `PickLoadSigns`, which decides a narrow load's extension after the fact.
 * A full-width load has no signed variant, so asking for one throws rather than
 * returning the load unchanged — the pass should never ask, and a silent no-op
 * would hide that it did.
 */
export function withSigned(opcode: Opcode, signed: boolean): Opcode {
  const l = loadShape(opcode);
  if (l.signed === signed) return opcode;
  const other = LOADS.find((x) => x.bytes === l.bytes && x.type === l.type && x.signed === signed);
  if (other === undefined) {
    throw new Error(`${l.name} has no ${signed ? 'signed' : 'unsigned'} variant`);
  }
  return other.opcode;
}
