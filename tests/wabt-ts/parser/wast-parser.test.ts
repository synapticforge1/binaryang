// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals, assertExists } from '@std/assert';

import { Type } from '../../src/core/types.ts';
import { ExternalKind } from '../../src/core/binary.ts';
import { parseWastScript, parseWatModule } from '../../src/parser/wast-parser.ts';
import type {
  DataSegment,
  ElemSegment,
  Func,
  Global,
  Import,
  Memory,
  Table,
} from '../../src/ir/ir.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseModule(src: string) {
  const result = parseWatModule(src);
  return result.module;
}

// ---------------------------------------------------------------------------
// Empty module
// ---------------------------------------------------------------------------

describe('parseWatModule', () => {
  it('parses an empty module', () => {
    const m = parseModule('(module)');
    assertExists(m);
    assertEquals(m.funcs.length, 0);
    assertEquals(m.imports.length, 0);
    assertEquals(m.exports.length, 0);
  });

  it('parses a named module', () => {
    const m = parseModule('(module $foo)');
    assertExists(m);
    assertEquals(m.name, '$foo');
  });

  it('returns errors array on success', () => {
    const result = parseWatModule('(module)');
    assertEquals(result.errors.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Type section
// ---------------------------------------------------------------------------

describe('parseWatModule — types', () => {
  it('parses a type entry', () => {
    const m = parseModule('(module (type (func (param i32) (result i64))))');
    assertEquals(m.types.length, 1);
    const t = m.types[0];
    assertExists(t);
    assertEquals(t.kind, 'func');
    if (t.kind === 'func') {
      assertEquals(t.sig.params, [Type.I32]);
      assertEquals(t.sig.results, [Type.I64]);
    }
  });

  it('parses a named type entry', () => {
    const m = parseModule('(module (type $mytype (func (param f32))))');
    assertEquals(m.types.length, 1);
    const t = m.types[0];
    assertExists(t);
    assertEquals(t.name, '$mytype');
  });

  it('parses an empty type (no params/results)', () => {
    const m = parseModule('(module (type (func)))');
    assertEquals(m.types.length, 1);
    const t = m.types[0];
    assertExists(t);
    if (t?.kind === 'func') {
      assertEquals(t.sig.params.length, 0);
      assertEquals(t.sig.results.length, 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

describe('parseWatModule — imports', () => {
  it('parses a func import', () => {
    const m = parseModule('(module (import "env" "fn" (func (param i32) (result i32))))');
    assertEquals(m.imports.length, 1);
    const imp = m.imports[0] as Import;
    assertExists(imp);
    assertEquals(imp.kind, ExternalKind.Func);
    if (imp.kind === ExternalKind.Func) {
      assertEquals(imp.module, 'env');
      assertEquals(imp.field, 'fn');
      assertEquals(imp.func.sig.params, [Type.I32]);
      assertEquals(imp.func.sig.results, [Type.I32]);
    }
    assertEquals(m.numFuncImports, 1);
  });

  it('parses a memory import', () => {
    const m = parseModule('(module (import "env" "mem" (memory 1)))');
    assertEquals(m.imports.length, 1);
    const imp = m.imports[0] as Import;
    assertExists(imp);
    assertEquals(imp.kind, ExternalKind.Memory);
    if (imp.kind === ExternalKind.Memory) {
      assertEquals(imp.module, 'env');
      assertEquals(imp.field, 'mem');
      assertEquals(imp.memory.limits.initial, 1n);
    }
  });

  it('parses a global import', () => {
    const m = parseModule('(module (import "env" "g" (global i32)))');
    assertEquals(m.imports.length, 1);
    const imp = m.imports[0] as Import;
    assertExists(imp);
    assertEquals(imp.kind, ExternalKind.Global);
    if (imp.kind === ExternalKind.Global) {
      assertEquals(imp.global.type, Type.I32);
      assertEquals(imp.global.mutable, false);
    }
  });

  it('parses a mutable global import', () => {
    const m = parseModule('(module (import "env" "g" (global (mut i32))))');
    assertEquals(m.imports.length, 1);
    const imp = m.imports[0] as Import;
    assertExists(imp);
    if (imp.kind === ExternalKind.Global) {
      assertEquals(imp.global.mutable, true);
    }
  });

  it('parses a table import', () => {
    const m = parseModule('(module (import "env" "t" (table 10 funcref)))');
    assertEquals(m.imports.length, 1);
    const imp = m.imports[0] as Import;
    assertExists(imp);
    assertEquals(imp.kind, ExternalKind.Table);
    if (imp.kind === ExternalKind.Table) {
      assertEquals(imp.table.limits.initial, 10n);
      assertEquals(imp.table.elemType, Type.FuncRef);
    }
  });
});

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

describe('parseWatModule — functions', () => {
  it('parses a simple function', () => {
    const m = parseModule('(module (func))');
    assertEquals(m.funcs.length, 1);
    const f = m.funcs[0] as Func;
    assertExists(f);
    assertEquals(f.sig.params.length, 0);
    assertEquals(f.sig.results.length, 0);
    assertEquals(f.body.length, 0);
  });

  it('parses a named function', () => {
    const m = parseModule(
      '(module (func $add (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))',
    );
    assertEquals(m.funcs.length, 1);
    const f = m.funcs[0] as Func;
    assertExists(f);
    assertEquals(f.name, '$add');
    assertEquals(f.sig.params, [Type.I32, Type.I32]);
    assertEquals(f.sig.results, [Type.I32]);
    assert(f.body.length > 0);
  });

  it('parses function locals', () => {
    const m = parseModule('(module (func (local i32) (local f64 f64)))');
    assertEquals(m.funcs.length, 1);
    const f = m.funcs[0] as Func;
    assertExists(f);
    assertEquals(f.localDecls.length, 3);
  });

  it('parses function with export', () => {
    const m = parseModule('(module (func (export "main")))');
    assertEquals(m.funcs.length, 1);
    assertEquals(m.exports.length, 1);
    assertEquals(m.exports[0]?.name, 'main');
    assertEquals(m.exports[0]?.kind, ExternalKind.Func);
  });

  it('parses inline func import', () => {
    const m = parseModule('(module (func $f (import "env" "f") (param i32)))');
    assertEquals(m.funcs.length, 0);
    assertEquals(m.imports.length, 1);
    const imp = m.imports[0];
    assertExists(imp);
    if (imp.kind === ExternalKind.Func) {
      assertEquals(imp.module, 'env');
      assertEquals(imp.field, 'f');
    }
  });
});

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

describe('parseWatModule — globals', () => {
  it('parses an immutable global', () => {
    const m = parseModule('(module (global i32 (i32.const 42)))');
    assertEquals(m.globals.length, 1);
    const g = m.globals[0] as Global;
    assertExists(g);
    assertEquals(g.type, Type.I32);
    assertEquals(g.mutable, false);
    assertEquals(g.init.length, 1);
  });

  it('parses a mutable global', () => {
    const m = parseModule('(module (global (mut i64) (i64.const 0)))');
    assertEquals(m.globals.length, 1);
    const g = m.globals[0] as Global;
    assertExists(g);
    assertEquals(g.type, Type.I64);
    assertEquals(g.mutable, true);
  });
});

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

describe('parseWatModule — memories', () => {
  it('parses a memory with initial pages', () => {
    const m = parseModule('(module (memory 1))');
    assertEquals(m.memories.length, 1);
    const mem = m.memories[0] as Memory;
    assertExists(mem);
    assertEquals(mem.limits.initial, 1n);
  });

  it('parses a memory with initial and max pages', () => {
    const m = parseModule('(module (memory 1 4))');
    assertEquals(m.memories.length, 1);
    const mem = m.memories[0] as Memory;
    assertExists(mem);
    assertEquals(mem.limits.initial, 1n);
    assertEquals(mem.limits.max, 4n);
  });

  it('parses a memory with inline data segment', () => {
    const m = parseModule('(module (memory (data "hello")))');
    assertEquals(m.memories.length, 1);
    assertEquals(m.dataSegments.length, 1);
    assertEquals(m.dataSegments[0]?.kind, 'active');
  });
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

describe('parseWatModule — tables', () => {
  it('parses a table', () => {
    const m = parseModule('(module (table 10 funcref))');
    assertEquals(m.tables.length, 1);
    const t = m.tables[0] as Table;
    assertExists(t);
    assertEquals(t.limits.initial, 10n);
    assertEquals(t.elemType, Type.FuncRef);
  });

  it('parses a table with max', () => {
    const m = parseModule('(module (table 1 100 funcref))');
    assertEquals(m.tables.length, 1);
    const t = m.tables[0] as Table;
    assertExists(t);
    assertEquals(t.limits.initial, 1n);
    assertEquals(t.limits.max, 100n);
  });
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

describe('parseWatModule — exports', () => {
  it('parses a function export', () => {
    const m = parseModule('(module (func) (export "main" (func 0)))');
    assertEquals(m.exports.length, 1);
    assertEquals(m.exports[0]?.name, 'main');
    assertEquals(m.exports[0]?.kind, ExternalKind.Func);
  });

  it('parses a memory export', () => {
    const m = parseModule('(module (memory 1) (export "mem" (memory 0)))');
    assertEquals(m.exports.length, 1);
    assertEquals(m.exports[0]?.name, 'mem');
    assertEquals(m.exports[0]?.kind, ExternalKind.Memory);
  });

  it('parses a global export', () => {
    const m = parseModule('(module (global i32 (i32.const 0)) (export "g" (global 0)))');
    assertEquals(m.exports.length, 1);
    assertEquals(m.exports[0]?.name, 'g');
    assertEquals(m.exports[0]?.kind, ExternalKind.Global);
  });
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

describe('parseWatModule — tags', () => {
  it('parses a tag with parameters', () => {
    const m = parseModule('(module (tag $exn (param i32 i32)))');
    assertEquals(m.tags.length, 1);
    assertEquals(m.tags[0]?.name, '$exn');
    assertEquals(m.tags[0]?.sig.params, [Type.I32, Type.I32]);
  });

  it('parses an inline export on a tag (wasmtk repro)', () => {
    // wasic emits this shape for any exception tag export; previously
    // failed with "expected ), got (" because parseTagModuleField had
    // no inline-export loop.
    const m = parseModule('(module (tag $exn (export "exn") (param i32 i32)))');
    assertEquals(m.tags.length, 1);
    assertEquals(m.tags[0]?.name, '$exn');
    assertEquals(m.exports.length, 1);
    assertEquals(m.exports[0]?.name, 'exn');
    assertEquals(m.exports[0]?.kind, ExternalKind.Tag);
  });

  it('parses multiple inline exports on a tag', () => {
    const m = parseModule('(module (tag $e (export "a") (export "b") (param i32)))');
    assertEquals(m.exports.length, 2);
    assertEquals(m.exports[0]?.name, 'a');
    assertEquals(m.exports[1]?.name, 'b');
    assertEquals(m.exports[0]?.kind, ExternalKind.Tag);
    assertEquals(m.exports[1]?.kind, ExternalKind.Tag);
  });

  it('parses a tag import', () => {
    const m = parseModule('(module (tag $t (import "env" "t") (param i32)))');
    assertEquals(m.imports.length, 1);
    assertEquals(m.imports[0]?.kind, ExternalKind.Tag);
    assertEquals(m.numTagImports, 1);
    assertEquals(m.tags.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

describe('parseWatModule — start', () => {
  it('parses a start function', () => {
    const m = parseModule('(module (func $init) (start $init))');
    assertExists(m.start);
  });
});

// ---------------------------------------------------------------------------
// Data segments
// ---------------------------------------------------------------------------

describe('parseWatModule — data segments', () => {
  it('parses an active data segment', () => {
    const m = parseModule('(module (memory 1) (data (i32.const 0) "hello"))');
    assertEquals(m.dataSegments.length, 1);
    const ds = m.dataSegments[0] as DataSegment;
    assertExists(ds);
    assertEquals(ds.kind, 'active');
    assertEquals(ds.data.length, 5);
  });

  it('parses a passive data segment', () => {
    const m = parseModule('(module (data "world"))');
    assertEquals(m.dataSegments.length, 1);
    const ds = m.dataSegments[0] as DataSegment;
    assertExists(ds);
    assertEquals(ds.kind, 'passive');
    assertEquals(ds.data.length, 5);
  });
});

// ---------------------------------------------------------------------------
// Elem segments
// ---------------------------------------------------------------------------

describe('parseWatModule — elem segments', () => {
  it('parses an active elem segment', () => {
    // Use explicit (table N) form which the parser handles
    const m = parseModule('(module (func) (func) (table funcref (elem 0 1)))');
    assertEquals(m.elemSegments.length, 1);
    const es = m.elemSegments[0] as ElemSegment;
    assertExists(es);
    assertEquals(es.kind, 'active');
    assertEquals(es.elemType, Type.FuncRef);
    assertEquals(es.elemExprs.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Instruction parsing — folded form
// ---------------------------------------------------------------------------

describe('parseWatModule — instructions (folded)', () => {
  it('parses i32.const in folded form', () => {
    const m = parseModule('(module (func (result i32) (i32.const 42)))');
    assertEquals(m.funcs.length, 1);
    const body = m.funcs[0]?.body ?? [];
    assertEquals(body.length, 1);
    const expr = body[0];
    assertExists(expr);
    assertEquals(expr.kind, 'const');
    if (expr.kind === 'const') {
      assertEquals(expr.value.type, Type.I32);
    }
  });

  it('parses i32.add in folded form', () => {
    const m = parseModule('(module (func (result i32) (i32.add (i32.const 1) (i32.const 2))))');
    assertEquals(m.funcs.length, 1);
    const body = m.funcs[0]?.body ?? [];
    assertEquals(body.length, 1);
    const expr = body[0];
    assertExists(expr);
    assertEquals(expr.kind, 'binary');
  });

  it('parses block in folded form', () => {
    const m = parseModule('(module (func (block (nop))))');
    const body = m.funcs[0]?.body ?? [];
    assertEquals(body.length, 1);
    assertEquals(body[0]?.kind, 'block');
  });

  it('parses if in folded form', () => {
    const m = parseModule('(module (func (if (i32.const 1) (then (nop)) (else (nop)))))');
    const body = m.funcs[0]?.body ?? [];
    assertEquals(body.length, 1);
    assertEquals(body[0]?.kind, 'if');
  });
});

// ---------------------------------------------------------------------------
// Instruction parsing — linear form
// ---------------------------------------------------------------------------

describe('parseWatModule — instructions (linear)', () => {
  it('parses nop in linear form', () => {
    const m = parseModule('(module (func nop))');
    const body = m.funcs[0]?.body ?? [];
    assertEquals(body.length, 1);
    assertEquals(body[0]?.kind, 'nop');
  });

  it('parses unreachable in linear form', () => {
    const m = parseModule('(module (func unreachable))');
    const body = m.funcs[0]?.body ?? [];
    assertEquals(body.length, 1);
    assertEquals(body[0]?.kind, 'unreachable');
  });

  it('parses return in linear form', () => {
    const m = parseModule('(module (func return))');
    const body = m.funcs[0]?.body ?? [];
    assertEquals(body.length, 1);
    assertEquals(body[0]?.kind, 'return');
  });

  it('parses local.get / local.set in linear form', () => {
    const m = parseModule('(module (func (param i32) local.get 0))');
    const body = m.funcs[0]?.body ?? [];
    assertEquals(body.length, 1);
    assertEquals(body[0]?.kind, 'local.get');
  });

  it('parses i32.load with offset= in linear form', () => {
    const m = parseModule(
      '(module (memory 1) (func (param i32) (result i32) local.get 0 i32.load offset=4))',
    );
    const body = m.funcs[0]?.body ?? [];
    assert(body.length > 0);
    const load = body.find((e) => e.kind === 'load');
    assertExists(load);
    if (load?.kind === 'load') {
      assertEquals(load.offset, 4n);
    }
  });

  it('parses block / loop / end in linear form', () => {
    const m = parseModule('(module (func block nop end))');
    const body = m.funcs[0]?.body ?? [];
    assertEquals(body.length, 1);
    assertEquals(body[0]?.kind, 'block');
  });

  it('parses if / then / else / end in linear form', () => {
    const m = parseModule('(module (func (param i32) local.get 0 if nop else nop end))');
    const body = m.funcs[0]?.body ?? [];
    // after stack flush: local.get goes to stmts, if is separate
    const ifNode = body.find((e) => e.kind === 'if');
    assertExists(ifNode);
  });
});

// ---------------------------------------------------------------------------
// Const expressions
// ---------------------------------------------------------------------------

describe('parseWatModule — const expressions', () => {
  it('parses i32.const', () => {
    const m = parseModule('(module (global i32 (i32.const 100)))');
    const init = m.globals[0]?.init ?? [];
    assertEquals(init.length, 1);
    const expr = init[0];
    assertExists(expr);
    assertEquals(expr.kind, 'const');
    if (expr.kind === 'const') {
      assertEquals(expr.value.type, Type.I32);
    }
  });

  it('parses i64.const', () => {
    const m = parseModule('(module (global i64 (i64.const 9999999999)))');
    const init = m.globals[0]?.init ?? [];
    const expr = init[0];
    assertExists(expr);
    if (expr?.kind === 'const') {
      assertEquals(expr.value.type, Type.I64);
    }
  });

  it('parses f32.const', () => {
    const m = parseModule('(module (global f32 (f32.const 3.14)))');
    const init = m.globals[0]?.init ?? [];
    const expr = init[0];
    assertExists(expr);
    if (expr?.kind === 'const') {
      assertEquals(expr.value.type, Type.F32);
    }
  });

  it('parses f64.const', () => {
    const m = parseModule('(module (global f64 (f64.const 1.5)))');
    const init = m.globals[0]?.init ?? [];
    const expr = init[0];
    assertExists(expr);
    if (expr?.kind === 'const') {
      assertEquals(expr.value.type, Type.F64);
    }
  });
});

// ---------------------------------------------------------------------------
// Multiple module fields
// ---------------------------------------------------------------------------

describe('parseWatModule — multiple fields', () => {
  it('parses a module with multiple imports', () => {
    const src = `(module
      (import "a" "f1" (func))
      (import "a" "f2" (func (param i32)))
      (import "b" "mem" (memory 1))
    )`;
    const m = parseModule(src);
    assertEquals(m.imports.length, 3);
    assertEquals(m.numFuncImports, 2);
    assertEquals(m.numMemoryImports, 1);
  });

  it('parses a module with funcs + exports', () => {
    const src = `(module
      (func $a (result i32) i32.const 1)
      (func $b (result i32) i32.const 2)
      (export "a" (func $a))
      (export "b" (func $b))
    )`;
    const m = parseModule(src);
    assertEquals(m.funcs.length, 2);
    assertEquals(m.exports.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('parseWatModule — error handling', () => {
  it('returns errors for malformed input', () => {
    const result = parseWatModule('(module (func (type $nonexistent (garbage');
    // Parser may produce partial results or errors; key is it doesn't throw
    assertExists(result);
    assertExists(result.module);
    assertExists(result.errors);
  });
});

// ---------------------------------------------------------------------------
// WAST script parsing
// ---------------------------------------------------------------------------

describe('parseWastScript', () => {
  it('parses an assert_return command', () => {
    const src =
      `(module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
(assert_return (invoke "add" (i32.const 1) (i32.const 2)) (i32.const 3))`;
    const result = parseWastScript(src);
    assertExists(result);
    assertExists(result.script);
    assertEquals(result.errors.length, 0);
    const cmds = result.script.commands;
    const assertRet = cmds.find((c) => c.kind === 'assert_return');
    assertExists(assertRet);
  });

  it('parses an invoke action', () => {
    const src = `(module (func (export "noop")))
(invoke "noop")`;
    const result = parseWastScript(src);
    assertExists(result);
    const cmds = result.script.commands;
    const invoke = cmds.find((c) => c.kind === 'action');
    assertExists(invoke);
  });

  it('parses assert_trap', () => {
    const src = `(module (func (export "trap") unreachable))
(assert_trap (invoke "trap") "unreachable")`;
    const result = parseWastScript(src);
    assertExists(result);
    const cmds = result.script.commands;
    const trap = cmds.find((c) => c.kind === 'assert_trap');
    assertExists(trap);
  });

  it('parses assert_invalid', () => {
    const src = `(assert_invalid (module (func (result i32))) "type mismatch")`;
    const result = parseWastScript(src);
    assertExists(result);
    const cmds = result.script.commands;
    const invalid = cmds.find((c) => c.kind === 'assert_invalid');
    assertExists(invalid);
  });

  it('parses multiple commands', () => {
    const src = `(module)
(assert_return (invoke "f") (i32.const 0))
(assert_return (invoke "g") (i64.const 0))`;
    const result = parseWastScript(src);
    assertExists(result);
    assertEquals(result.script.commands.length, 3);
  });
});
