// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * S7 — the text-form record: how each instruction was WRITTEN, so that
 * `wasm2wat` gives back exactly the form `wat2wasm` was given — linear, folded,
 * or any mix of the two.
 *
 * Owner, 2026-09-19: "The first rule is fidelity for the wat2wasm and
 * wasm2wat… this part transpiles verbatim. The optimization does not and is not
 * fidelity tied, and must use the folded structure in the tree." And, the same
 * day: "The default should be a mixed form if a mixed form is in the wat… It
 * should never change the state unless it goes into optimization." So the fact
 * is as-written metadata: it lives in the module's fidelity side table
 * (`FidelityEntry.textForm`, on each function's `nodeId`), which every pass run
 * resets — the optimizer strips it with no code of its own.
 *
 * ## What is recorded — one number per instruction
 *
 * Folding is syntax: `(op f1 … fk)` IS `f1 … fk op`, so the instruction
 * SEQUENCE is fixed by the bytes and only its parenthesisation is free. Walk a
 * body in binary order ({@link formNodes}) and give each instruction a FORM:
 *
 *     0      written bare — `op`, or `block … end`
 *     k + 1  written folded around the k folded items just before it —
 *            `(op f1 … fk)`, `(block …)`, `(if f1 … fk (then …))`
 *
 * That reproduces the text's grouping exactly: rebuilding it is a stack of
 * written items, where a folded instruction takes the last k (the WAT writer's
 * `writtenItems`). The parser records every function's forms.
 *
 * ## What is written — only what a reader would not predict
 *
 * The CANONICAL form of an instruction in a tree is the plain nested fold:
 * folded around every operand that is an instruction (a `pop` is a value
 * already on the stack and writes nothing), and a block, loop, `try` or
 * `try_table` around none — its entry values are its siblings. It is what
 * `wasm2wat` prints for a function nothing is recorded for (measured: the fold
 * writer's grouping IS the canonical forms of the reader's tree, 26,454 of
 * 26,454 corpus functions).
 *
 * ⚠️ Canonical forms are a property of a TREE, and trees for the same bytes
 * differ: the parser hangs a multi-value call's single operand on the call, the
 * wabt-ts reader gives it a slot per value; the parser attaches an operand
 * across `unreachable`, the reader leaves a `pop`. So the PREDICTION a section
 * is written against is one tree's, fixed by definition: the canonical forms of
 * the wabt-ts binary reader's tree of the very bytes the section sits in. Both
 * encoders read their own output back to get it ({@link encodeTextForm}); a
 * function whose forms are the prediction is not written at all.
 *
 * ## The section — `binaryang.text-form`, version 2
 *
 * A custom section, written LAST (after the `name` section), so any engine or
 * tool ignores it and a read → write round trip puts it back where it was:
 *
 *     u8   version                     (2)
 *     u32  count                       functions recorded
 *     per function, ascending by index:
 *       u32  function index            the function index space, imports
 *                                      first — DEFINED functions only
 *       u8   base                      0 predicted, 1 every instruction bare
 *       u32  instructions              the body's instruction count
 *       u32  predicted hash            base 0 only: FNV-1a of the predicted
 *                                      forms, 4 bytes little-endian
 *       u32  exceptions
 *       per exception: u32 gap, u32 form   gap = instructions since the
 *                                          previous exception (the first
 *                                          counts from 0)
 *
 * A linear function is `base 1` and no exceptions; a mixed one is whichever
 * base leaves fewer. ABSENCE means predicted, so a binary made before this
 * existed, or by any other tool, reads as it always did.
 *
 * A payload that is malformed — unknown version, truncated, an index that is not
 * a defined function — is kept as a raw custom section and nothing is applied.
 * An entry whose count or hash does not match the tree reading it is SKIPPED:
 * that function prints as predicted rather than grouped wrongly (binaryen-ts's
 * decoder, whose tree is not the bytes one-for-one in a handful of functions;
 * a reader whose tree changes after the section was written).
 *
 * Version 1 (whole functions only) was never released; it is not read.
 */

import type { Expr, Func, Module } from './ir.ts';
import { countImports } from './ir.ts';
import { ExternalKind } from '../core/binary.ts';
import { ExprVisitor, type ExprVisitorDelegate } from './expr-visitor.ts';
import { Result } from '../core/result.ts';

/** The custom section's name. */
export const TEXT_FORM_SECTION = 'binaryang.text-form';

/** The format this module writes and reads. */
export const TEXT_FORM_VERSION = 2;

/** An instruction's written form: 0 bare, `k + 1` folded around `k` items. */
export type Form = number;

/** The form of an instruction written bare. */
export const BARE: Form = 0;

// Hooks that fire for something other than an instruction of their own: the
// arms and end of a construct, and a code-metadata annotation (no opcode).
const NOT_AN_INSTRUCTION = new Set([
  'afterIfTrueExpr',
  'onCatchExpr',
  'onDelegateExpr',
  'onCodeMetadataExpr',
]);

/**
 * A body's instructions in binary order, each with its canonical form. The
 * order the binary writers emit opcodes in, so a form list recorded against
 * one reader's tree lines up with any other's for the same bytes.
 */
export function formNodes(
  body: readonly Expr[],
  withCanonical = true,
): { nodes: Expr[]; canonical: Form[] } {
  const nodes: Expr[] = [];
  const canonical: Form[] = [];
  const record = (e: Expr): Result => {
    nodes.push(e);
    if (withCanonical) canonical.push(canonicalForm(e));
    return Result.Ok;
  };
  const delegate = new Proxy({} as ExprVisitorDelegate, {
    get: (_t, name) =>
      typeof name === 'string' && !NOT_AN_INSTRUCTION.has(name) &&
        (name.startsWith('on') || name.startsWith('begin'))
        ? record
        : undefined,
  });
  new ExprVisitor(delegate).visitExprList([...body]);
  return { nodes, canonical };
}

/** The plain nested fold of `e` (see the module doc). */
function canonicalForm(e: Expr): Form {
  switch (e.kind) {
    case 'block':
    case 'loop':
    case 'try':
    case 'try_table':
      return 1;
    case 'if':
      return 1 + sumItems([...(e.params?.values ?? []), e.condition]);
    default: {
      // What the fold writer actually nests (`foldSpec`): a PREFIX of `pop`s is
      // expressible by omitting it, so the items are every operand from the
      // first non-pop on. A pop SCATTERED among them is not expressible at all
      // — that node is written as siblings plus a bare head, which is `1`.
      //
      // ⚠️ This counted every non-pop operand, which is the same number only
      // while pops form a prefix. Multi-value producers put one mid-list (One
      // front end, stage 2), and the prediction then disagreed with the writer
      // on 4 corpus files, so their recorded forms could not be reproduced.
      const ops = operandsOf(e);
      const first = ops.findIndex((op) => op.kind !== 'pop');
      if (first === -1 || scattered(ops, first)) return 1;
      return 1 + sumItems(ops.slice(first));
    }
  }
}

/** A plain instruction's operands, in evaluation order. */
function operandsOf(e: Expr): Expr[] {
  const ops: Expr[] = [];
  new ExprVisitor({}).visitShallow(e, (op) => ops.push(op));
  return ops;
}

/** Is a `pop` among the operands after the first real one? */
function scattered(ops: readonly Expr[], first: number): boolean {
  return ops.slice(first).some((op) => op.kind === 'pop');
}

/**
 * How many ITEMS `e` writes at the paren level it sits in — what a fold around
 * it counts. One, unless the fold writer spreads it: a node with scattered
 * `pop`s is its operands' items then its bare head, and a block, loop or `try`
 * has its entry values written as siblings before it. A `pop` writes nothing.
 * 🔧 This counted each operand as ONE item, so a fold around a spread operand
 * was predicted smaller than written (`(i32.ne (call $a …) (call $a …) (call
 * $cmp) (i32.const 0))`, `$cmp` taking two 2-value results): 6 of 26,896
 * corpus functions, whose forms were then recorded instead of predicted.
 */
function items(e: Expr): number {
  switch (e.kind) {
    case 'pop':
      return 0;
    case 'block':
    case 'loop':
    case 'try':
    case 'try_table':
      return sumItems(e.params?.values ?? []) + 1;
    case 'if':
      return 1;
    default: {
      const ops = operandsOf(e);
      const first = ops.findIndex((op) => op.kind !== 'pop');
      return first !== -1 && scattered(ops, first) ? sumItems(ops) + 1 : 1;
    }
  }
}

function sumItems(es: readonly Expr[]): number {
  return es.reduce((n, x) => n + items(x), 0);
}

/** Each instruction's written form for `f`, in binary order, or `undefined` — predicted. */
export function writtenForms(m: Module, f: Func): readonly Form[] | undefined {
  return m.fidelity.get(f.nodeId)?.textForm;
}

/** Whether any function of `m` has its written forms recorded. */
export function hasWrittenForms(m: Module): boolean {
  return m.functions.some((f) => writtenForms(m, f) !== undefined);
}

/**
 * Record `forms` (binary order) as how `f` was written — nothing when they do
 * not fit the body. A caller that built `forms` from the body's own
 * {@link formNodes} passes `fits` rather than walking it again.
 */
export function recordForms(m: Module, f: Func, forms: readonly Form[], fits = false): void {
  if (!fits && forms.length !== formNodes(f.body.children, false).nodes.length) return;
  const entry = { textForm: forms };
  if (f.nodeId === undefined) {
    (f as { nodeId?: Func['nodeId'] }).nodeId = m.fidelity.record(entry);
  } else {
    m.fidelity.set(f.nodeId, entry);
  }
}

/** One function's record as the section carries it. */
export interface TextFormEntry {
  readonly index: number;
  readonly linearBase: boolean;
  readonly instructions: number;
  /** Base 0 only: {@link predictionHash} of the forms the entry was written against. */
  readonly hash?: number;
  /** `[position, form]`, positions ascending. */
  readonly exceptions: readonly (readonly [number, Form])[];
}

/** FNV-1a over a form list — the check that a reader predicts what the writer did. */
export function predictionHash(forms: readonly Form[]): number {
  let h = 0x811c9dc5;
  for (const x of forms) {
    h ^= x & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= x >>> 8;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The section's payload for `m`, or `null` when nothing needs writing.
 *
 * `view` is the wabt-ts binary reader's module for the bytes the section will
 * follow — the PREDICTION's tree. Its defined functions line up with `m`'s.
 */
export function encodeTextForm(m: Module, view: Module): Uint8Array | null {
  const base = countImports(m, ExternalKind.Func);
  const out: number[] = [];
  let count = 0;
  m.functions.forEach((f, i) => {
    const forms = writtenForms(m, f);
    const g = view.functions[i];
    if (forms === undefined || g === undefined) return;
    const predicted = formNodes(g.body.children).canonical;
    if (forms.length !== predicted.length) return; // not this body's forms
    const vsPredicted = forms.flatMap((x, p) => x === predicted[p] ? [] : [[p, x] as const]);
    if (vsPredicted.length === 0) return;
    const vsBare = forms.flatMap((x, p) => x === BARE ? [] : [[p, x] as const]);
    const linearBase = vsBare.length < vsPredicted.length;
    const exceptions = linearBase ? vsBare : vsPredicted;
    writeU32(out, base + i);
    out.push(linearBase ? 1 : 0);
    writeU32(out, forms.length);
    if (!linearBase) {
      const h = predictionHash(predicted);
      out.push(h & 0xff, (h >>> 8) & 0xff, (h >>> 16) & 0xff, h >>> 24);
    }
    writeU32(out, exceptions.length);
    let next = 0;
    for (const [p, x] of exceptions) {
      writeU32(out, p - next);
      writeU32(out, x);
      next = p + 1;
    }
    count++;
  });
  if (count === 0) return null;
  const head: number[] = [TEXT_FORM_VERSION];
  writeU32(head, count);
  return new Uint8Array([...head, ...out]);
}

/**
 * The records a payload carries, or `null` when it is not a version-2 payload
 * this reader can read — unknown version, truncated, trailing bytes, indices
 * not ascending, a base that is neither 0 nor 1, an exception past the end.
 * `null` means: keep the section as raw bytes, print as predicted.
 */
export function decodeTextForm(data: Uint8Array): TextFormEntry[] | null {
  if (data.length === 0 || data[0] !== TEXT_FORM_VERSION) return null;
  const at = { pos: 1 };
  const count = readU32(data, at);
  if (count === null) return null;
  const out: TextFormEntry[] = [];
  for (let k = 0; k < count; k++) {
    const index = readU32(data, at);
    if (index === null || (out.length > 0 && index <= out[out.length - 1]!.index)) return null;
    if (at.pos >= data.length) return null;
    const baseByte = data[at.pos++]!;
    if (baseByte > 1) return null;
    const instructions = readU32(data, at);
    if (instructions === null) return null;
    let hash: number | undefined;
    if (baseByte === 0) {
      if (at.pos + 4 > data.length) return null;
      hash = (data[at.pos]! | data[at.pos + 1]! << 8 | data[at.pos + 2]! << 16 |
        data[at.pos + 3]! << 24) >>> 0;
      at.pos += 4;
    }
    const n = readU32(data, at);
    if (n === null) return null;
    const exceptions: [number, Form][] = [];
    let next = 0;
    for (let e = 0; e < n; e++) {
      const gap = readU32(data, at);
      const form = readU32(data, at);
      if (gap === null || form === null || next + gap >= instructions) return null;
      exceptions.push([next + gap, form]);
      next += gap + 1;
    }
    const entry = { index, linearBase: baseByte === 1, instructions, exceptions };
    out.push(hash === undefined ? entry : { ...entry, hash });
  }
  return at.pos === data.length ? out : null;
}

/**
 * Record the forms `entries` give on `m`'s functions, predicted from `view` —
 * the wabt-ts reader's module for the same bytes (`m` itself, in that reader).
 *
 * False — and nothing recorded — when an entry names no DEFINED function: a
 * section that does not fit the module it sits in is kept raw rather than
 * half-applied. An entry whose instruction count or prediction does not match
 * is skipped: that function prints as predicted.
 */
export function applyTextForm(
  m: Module,
  entries: readonly TextFormEntry[],
  view: Module = m,
): boolean {
  const base = countImports(m, ExternalKind.Func);
  if (entries.some((e) => e.index < base || m.functions[e.index - base] === undefined)) {
    return false;
  }
  for (const entry of entries) {
    const f = m.functions[entry.index - base]!;
    const g = view.functions[entry.index - base];
    if (g === undefined) continue;
    const predicted = formNodes(g.body.children).canonical;
    if (predicted.length !== entry.instructions) continue;
    if (!entry.linearBase && entry.hash !== predictionHash(predicted)) continue;
    const forms = entry.linearBase ? predicted.map(() => BARE) : [...predicted];
    for (const [p, x] of entry.exceptions) forms[p] = x;
    recordForms(m, f, forms);
  }
  return true;
}

function writeU32(out: number[], n: number): void {
  let v = n >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
}

function readU32(data: Uint8Array, at: { pos: number }): number | null {
  let result = 0;
  for (let shift = 0; shift < 35; shift += 7) {
    if (at.pos >= data.length) return null;
    const byte = data[at.pos++]!;
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return result <= 0xffffffff ? result : null;
  }
  return null;
}
