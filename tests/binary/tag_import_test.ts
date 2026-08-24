/**
 * @module binaryen-ts/tests/binary/tag_import_test
 *
 * Regression tests for UP-6 — `WasmImport.kind` had no `"tag"`, so an imported
 * exception tag hit the parser's `default` branch and failed loudly ("unknown
 * import kind 0x4"). Tag *exports* already worked and `addTag` defined one, so
 * imports were the last hole in tag support.
 *
 * The part worth pinning down is the index space. Imported tags occupy the low
 * end of it, ahead of every defined tag, exactly like functions/globals/tables.
 * Numbering defined tags from zero while imports exist is the same defect that
 * made every imported-function call encode as `call 0` in WT-2b: the reference
 * resolves against a combined space, so a separate counter silently retargets
 * every `throw` and tag export. `throwsTheSecondTag` below is the case that
 * catches it — a `throw` of a DEFINED tag in a module that also imports one.
 *
 * @license MIT
 */

import { assert, assertEquals } from "@std/assert";
import { parseWasm } from "../../src/binary/index.ts";
import { encodeWasm } from "../../src/encoder/index.ts";
import { makeI32Const, makeThrow } from "../../src/ir/expressions.ts";
import { ModuleBuilder } from "../../src/ir/module.ts";
import { ValType } from "../../src/ir/types.ts";
import { PassRunner } from "../../src/passes/pass.ts";
import "../../src/passes/index.ts"; // side-effect: registers the pass registry

/**
 * `(import "env" "imported" (tag (param i32)))`, a defined
 * `(tag $own (param i32))`, and `func $t { throw $own (i32.const 7) }`.
 *
 * `$own` is tag index 1 — the import takes index 0.
 */
function moduleWithImportedAndDefinedTag(): ReturnType<ModuleBuilder["build"]> {
  return new ModuleBuilder()
    .addTagImport("$tag0", "env", "imported", [ValType.I32])
    .addTag("$tag1", [ValType.I32])
    .addFunction("$t", [], [], makeThrow("$tag1", [makeI32Const(7)]))
    .addExport("t", "$t")
    .build();
}

/** Byte offset of section `id`, or -1. */
function sectionBody(bytes: Uint8Array, id: number): Uint8Array | null {
  let i = 8;
  while (i < bytes.length) {
    const secId = bytes[i++];
    let size = 0, shift = 0, b: number;
    do {
      b = bytes[i++];
      size |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (secId === id) return bytes.subarray(i, i + size);
    i += size;
  }
  return null;
}

Deno.test("tag import: encodes as import kind 0x04 with a reserved attribute byte", () => {
  const bytes = encodeWasm(moduleWithImportedAndDefinedTag());
  const imports = sectionBody(bytes, 2);
  assert(imports !== null, "no import section emitted");

  // count=1, "env"(3), "imported"(8), kind, attr, typeidx
  const expectedKindAt = 1 + 1 + 3 + 1 + 8;
  assertEquals(imports[expectedKindAt], 0x04, "import kind is not tag (0x04)");
  assertEquals(imports[expectedKindAt + 1], 0x00, "missing reserved attribute byte");
});

Deno.test("tag import: survives a parse-encode round-trip", () => {
  const out = encodeWasm(parseWasm(encodeWasm(moduleWithImportedAndDefinedTag())));
  const mod = parseWasm(out);

  const tagImports = mod.imports.filter((i) => i.kind === "tag");
  assertEquals(tagImports.length, 1);
  assertEquals(tagImports[0].module, "env");
  assertEquals(tagImports[0].base, "imported");
  assertEquals(tagImports[0].params, [ValType.I32]);
});

Deno.test("tag import: imported tags take the low end of the tag index space", () => {
  const mod = parseWasm(encodeWasm(moduleWithImportedAndDefinedTag()));

  // The import is $tag0; the defined tag is numbered after it, not from zero.
  assertEquals(mod.imports.filter((i) => i.kind === "tag").map((i) => i.name), ["$tag0"]);
  assertEquals(mod.tags.map((t) => t.name), ["$tag1"]);
});

Deno.test("tag import: a throw of a DEFINED tag still resolves past the import", () => {
  // The teeth: numbering defined tags from zero while an import exists would
  // encode this `throw $tag1` as tag index 0 — the IMPORTED tag. Valid wasm,
  // wrong tag thrown.
  const bytes = encodeWasm(moduleWithImportedAndDefinedTag());
  const mod = parseWasm(bytes);

  const body = mod.functions[0].body;
  const found: string[] = [];
  const walk = (e: unknown): void => {
    if (!e || typeof e !== "object") return;
    const node = e as { kind?: string; tag?: string };
    if (node.kind === "throw" && node.tag) found.push(node.tag);
    for (const v of Object.values(e as unknown as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  walk(body);
  assertEquals(found, ["$tag1"], "throw was retargeted to the imported tag");
});

Deno.test("tag import: an imported tag can be re-exported", () => {
  const mod = new ModuleBuilder()
    .addTagImport("$tag0", "env", "imported", [ValType.I32])
    .addExport("reexported", "$tag0", "tag")
    .build();

  const out = encodeWasm(mod);
  const parsed = parseWasm(out);
  const exp = parsed.exports.find((e) => e.name === "reexported");
  assert(exp !== undefined, "tag export was dropped");
  assertEquals(exp.kind, "tag");
  assertEquals(exp.value, "$tag0");
});

Deno.test("StripEH removes imported tags along with defined ones", () => {
  const mod = moduleWithImportedAndDefinedTag();
  new PassRunner(mod, {}).add("StripEH").run();

  assertEquals(mod.tags, []);
  assertEquals(mod.imports.filter((i) => i.kind === "tag"), []);
  assertEquals(mod.hasExceptionHandling, false);
});
