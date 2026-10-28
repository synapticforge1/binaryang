// Based on WebAssembly/binaryen (https://github.com/WebAssembly/binaryen)
// Original source: src/wasm/wasm-stack-opts.cpp
// Copyright 2018 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module passes/stack-ir
 *
 * Local2Stack (open-work 31; upstream's StackIR `local2Stack`, which its writer applies at -O3,
 * -Os and -Oz): a value the code stores in a local and reads back ONCE, where nothing reaches the
 * stack in between, can stay on the stack — the `local.set` and the `local.get` are both left out
 * of the bytes:
 *
 *     V  local.set $x  [… code that leaves the stack as it found it …]  local.get $x  use
 *  →  V                [… the same code …]                                            use
 *
 * A tree cannot say this (the value would sit under the code between), so it is a WRITER
 * decision: {@link stackOmissions} names the nodes whose opcode the binary writer omits.
 *
 * Upstream's rules, kept:
 * - a stack simulation in the order the writer emits: a set is a CANDIDATE where it stands; an
 *   actual value pushed on top of it, then consumed, kills it (the value would be under that
 *   one); a construct's start saves the stack and its end restores it, an `else` or a
 *   branch-out clears it;
 * - the pair must be exact: the get's only reaching definition is that set, and that set's only
 *   reader is that get (reaching definitions, `local-graph.ts`: upstream's LocalGraph).
 *
 * Not done (upstream also does them in StackIR): removing a `drop` before an `unreachable`, and
 * dead code after an `unreachable` (our tree passes already remove it). A function with block
 * parameters, `try` / `try_table`, or a multi-value type is left as it is.
 *
 * Reference: `WebAssembly/binaryen/src/wasm/wasm-stack-opts.cpp`
 *
 * @license MIT
 */

import {
  type Expression,
  ExpressionKind,
  type LocalGetExpr,
  type LocalSetExpr,
  typeOf,
} from '../ir/expressions.ts';
import type { WasmFunction } from '../ir/module.ts';
import { requireIndex } from '../ir/ir.ts';
import { visitChildren } from '../ir/walk.ts';
import { localGraph } from './local-graph.ts';

/** How many values a type puts on the stack: `none` and `unreachable` none, a tuple its arity. */
function arity(e: Expression): number {
  const t = typeOf(e) as unknown;
  if (t === 'none' || t === 'unreachable') return 0;
  return Array.isArray(t) ? t.length : 1;
}

/**
 * The `local.set` and `local.get` nodes of `fn` the writer may leave out, in pairs; empty when
 * the function holds a shape this does not handle. An analysis that cannot read the function
 * (an untyped node, an unresolvable branch) THROWS: it is a bug in whatever made the function.
 * 🔧 Every exception was caught and the function written as it was, hiding such bugs as lost
 * size (open-work 52 (c), 2026-10-28).
 */
export function stackOmissions(fn: WasmFunction): Set<Expression> {
  return _omissions(fn);
}

function _omissions(fn: WasmFunction): Set<Expression> {
  // Shapes left alone.
  let unsupported = false;
  const scan = (e: Expression): void => {
    if (
      e.kind === ExpressionKind.Try || e.kind === ExpressionKind.TryTable ||
      ((e.kind === ExpressionKind.Block || e.kind === ExpressionKind.If ||
        e.kind === ExpressionKind.Loop) && e.params !== undefined && e.params.values.length > 0) ||
      Array.isArray(typeOf(e))
    ) unsupported = true;
    if (!unsupported) visitChildren(e, scan);
  };
  scan(fn.body);
  if (unsupported) return new Set();

  const { reaching, readers } = localGraph(fn);
  const exact = (set: Expression, get: Expression): boolean => {
    const defs = reaching.get(get);
    const uses = readers.get(set);
    return defs?.size === 1 && defs.has(set) && uses?.size === 1 && uses.has(get);
  };
  const out = new Set<Expression>();
  for (const [set, get] of _pairs(fn, exact)) {
    out.add(set);
    out.add(get);
  }
  return out;
}

/**
 * Upstream's stack walk, on the tree in the writer's order: the (set, get) pairs where the set's
 * value is on top of the stack when the get would push it, and the pair is exact.
 *
 * 🔧 Exactness is decided AT the get, as upstream decides it, not after the walk: the walk goes on
 * as if each pair it took were left out (the get pushes nothing; the set's value stays). A pair
 * judged afterwards and kept left a later pair, taken on that assumption, reading the wrong value:
 * `set $c … set $d … get $c … get $d` with only (d) exact wrote `get $c` above `$d`'s value, and
 * `get $d`'s consumer took `$c` (open-work 31, step 4 → found at 1.13.0's release check: rust-debug
 * and zig-releasefast -O3 / -Os / -Oz computed wrong results).
 */
function _pairs(
  fn: WasmFunction,
  exact: (set: Expression, get: Expression) => boolean,
): [Expression, Expression][] {
  /** `null` for an actual value; a set node for a value that set could leave on the stack. */
  let values: (LocalSetExpr | null)[] = [];
  const saved: (LocalSetExpr | null)[][] = [];
  const pairs: [Expression, Expression][] = [];
  const localOf = (e: LocalGetExpr | LocalSetExpr) => requireIndex(e.var, 'local index');

  const consume = (n: number): void => {
    while (n > 0) {
      // A candidate above the consumed value would be under it: it can never be reached.
      while (values.length > 0 && values[values.length - 1] !== null) values.pop();
      if (values.length === 0) return; // unreachable code: the stack is polymorphic
      values.pop();
      n--;
    }
  };
  const push = (e: Expression): void => {
    if (e.kind === ExpressionKind.LocalGet && values.length > 0) {
      const local = localOf(e);
      for (let j = values.length - 1; j >= 0; j--) {
        const c = values[j];
        if (c === null || c === undefined) break; // an actual value in the way
        if (localOf(c) === local) {
          if (!exact(c, e)) break; // kept: this get pushes its value, as written
          pairs.push([c, e]);
          values[j] = null; // the set's value stays on the stack as a plain value
          return;
        }
      }
    }
    for (let k = 0; k < arity(e); k++) values.push(null);
  };
  const begin = (): void => {
    saved.push(values);
    values = [];
  };
  const end = (e: Expression): void => {
    values = saved.pop() ?? [];
    push(e);
  };

  const emit = (e: Expression): void => {
    switch (e.kind) {
      case ExpressionKind.Region:
        for (const c of e.children) emit(c);
        return;
      case ExpressionKind.Block:
        begin();
        for (const c of e.children) emit(c);
        end(e);
        return;
      case ExpressionKind.Loop:
        begin();
        emit(e.body);
        end(e);
        return;
      case ExpressionKind.If:
        emit(e.condition);
        consume(1);
        begin();
        emit(e.ifTrue);
        if (e.ifFalse !== null) {
          values = []; // `else`: what the true arm left is gone
          emit(e.ifFalse);
        }
        end(e);
        return;
    }
    // An instruction: its operands, then it consumes them, then what it pushes.
    let operands = 0;
    visitChildren(e, (c) => {
      emit(c);
      operands += arity(c);
    });
    consume(operands);
    if (typeOf(e) === 'unreachable') {
      values = []; // a branch out, a return, a trap: nothing after it is reached from here
      return;
    }
    if (e.kind === ExpressionKind.LocalSet && arity(e.value) === 1) {
      values.push(e); // a candidate
      return;
    }
    push(e);
  };
  emit(fn.body);
  return pairs;
}
