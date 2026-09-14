/**
 * @module scripts/check-translate-eh
 *
 * Runs the legacy exception-handling spec testsuite through TranslateToExnref.
 *
 * ## Why this exists
 *
 * The pass rewrites control flow, so the only evidence that counts is
 * behaviour, and the spec's legacy EH files carry behaviour written by the
 * spec's authors: `assert_return`, `assert_exception` and `assert_trap` over
 * `try` / `catch` / `catch_all` / `delegate` / `rethrow` / `throw`. That is an
 * authority independent of V8, of wabt-ts and of the pass itself.
 *
 * Each module runs in V8 in THREE worlds, each with its own registered
 * instances so an import chain stays within one form:
 *
 * | world | the module | proves |
 * | ----- | ---------- | ------ |
 * | `legacy` | as assembled | the harness reads the assertions right (V8 runs legacy EH) |
 * | `translated` | TranslateToExnref, then encoded | the pass keeps the spec's behaviour |
 * | `translated -Oz` | the same, then the default `-Oz` passes | the moved `Pop`s survive optimization |
 *
 * Every translated module is also re-decoded (no `try` / `rethrow` may remain)
 * and validated by wabt-ts's validator. `assert_invalid` / `assert_malformed`
 * are counted and skipped: rejecting input is not this pass's job.
 *
 * ## Usage
 *
 * ```sh
 * deno task translate-eh <testsuite>/legacy <scratch-out-dir>
 * ```
 *
 * The `.wast` files are split with upstream `wast2json` (`--enable-exceptions
 * --enable-tail-call`) into the out dir; the testsuite is a READ-ONLY sibling
 * repo. Exit 0 only when every behavioural assertion holds in every world and
 * every translated module is legacy-free and valid.
 *
 * @license MIT
 */

import { parseWasm } from '../src/binaryen-ts/binary/index.ts';
import { encodeWasm } from '../src/binaryen-ts/encoder/index.ts';
import { ExpressionKind } from '../src/binaryen-ts/ir/expressions.ts';
import { walkExpression } from '../src/binaryen-ts/ir/walk.ts';
import { PassRunner } from '../src/binaryen-ts/passes/index.ts';
import { formatErrors, hasErrors, makeErrorList } from '../src/wabt-ts/core/error.ts';
import { allFeatures } from '../src/wabt-ts/core/feature.ts';
import { readBinaryIr } from '../src/wabt-ts/reader/binary-reader-ir.ts';
import { validateModule } from '../src/wabt-ts/validator/validator.ts';

const [srcDir, outDir] = Deno.args;
if (!srcDir || !outDir) {
  console.error('usage: deno task translate-eh <testsuite>/legacy <scratch-out-dir>');
  Deno.exit(2);
}

interface SpecValue {
  type: string;
  value?: string;
}
interface Action {
  type: string;
  field: string;
  args: SpecValue[];
  module?: string;
}
interface Command {
  type: string;
  line: number;
  filename?: string;
  as?: string;
  name?: string;
  action?: Action;
  expected?: SpecValue[];
}

type World = 'legacy' | 'translated' | 'translated -Oz';
const WORLDS: World[] = ['legacy', 'translated', 'translated -Oz'];

function toJs(v: SpecValue): number | bigint {
  const raw = BigInt(v.value!);
  switch (v.type) {
    case 'i32':
      return Number(BigInt.asIntN(32, raw));
    case 'i64':
      return BigInt.asIntN(64, raw);
    case 'f32': {
      const d = new DataView(new ArrayBuffer(4));
      d.setUint32(0, Number(raw));
      return d.getFloat32(0);
    }
    case 'f64': {
      const d = new DataView(new ArrayBuffer(8));
      d.setBigUint64(0, raw);
      return d.getFloat64(0);
    }
    default:
      throw new Error(`unsupported value type ${v.type}`);
  }
}

function sameValue(got: unknown, want: SpecValue): boolean {
  if (want.value?.startsWith('nan:')) return typeof got === 'number' && Number.isNaN(got);
  const w = toJs(want);
  return typeof w === 'number' && typeof got === 'number' ? Object.is(got, w) : got === w;
}

function translate(legacy: Uint8Array, optimize: boolean): Uint8Array {
  const mod = parseWasm(legacy);
  new PassRunner(mod).add('TranslateToExnref').run();
  if (optimize) {
    new PassRunner(mod, { optimizeLevel: 2, shrinkLevel: 2 }).addDefaultOptimizationPasses().run();
  }
  return encodeWasm(mod);
}

/** Problems with a translated module: a surviving legacy node, or a validation error. */
function inspect(bytes: Uint8Array): string[] {
  const problems: string[] = [];
  for (const fn of parseWasm(bytes).functions) {
    walkExpression(fn.body, (e) => {
      if (e.kind === ExpressionKind.Try || e.kind === ExpressionKind.Rethrow) {
        problems.push(`a ${e.kind} survived in ${fn.name}`);
      }
    });
  }
  const errs = makeErrorList();
  const m = readBinaryIr(bytes, errs);
  if (!hasErrors(errs)) validateModule(m, errs, { features: allFeatures() });
  if (hasErrors(errs)) problems.push(`invalid: ${formatErrors(errs).trim().split('\n')[0]}`);
  return problems;
}

await Deno.mkdir(outDir, { recursive: true });
const failures: string[] = [];
const totals = new Map<World, { pass: number; fail: number }>(
  WORLDS.map((w) => [w, { pass: 0, fail: 0 }]),
);
let modules = 0;
let skipped = 0;

const wastFiles = [...Deno.readDirSync(srcDir)]
  .map((e) => e.name)
  .filter((n) => n.endsWith('.wast'))
  .sort();

for (const name of wastFiles) {
  const base = name.replace(/\.wast$/, '');
  const json = `${outDir}/${base}.json`;
  const split = await new Deno.Command('wast2json', {
    args: ['--enable-exceptions', '--enable-tail-call', `${srcDir}/${name}`, '-o', json],
  }).output();
  if (!split.success) {
    failures.push(`${base}: wast2json failed: ${new TextDecoder().decode(split.stderr).trim()}`);
    continue;
  }
  const commands = (JSON.parse(await Deno.readTextFile(json)) as { commands: Command[] }).commands;

  const registry = new Map<World, Map<string, WebAssembly.Exports>>(
    WORLDS.map((w) => [w, new Map()]),
  );
  const current = new Map<World, WebAssembly.Instance>();
  const named = new Map<World, Map<string, WebAssembly.Instance>>(
    WORLDS.map((w) => [w, new Map()]),
  );

  for (const c of commands) {
    const where = `${base}.wast:${c.line}`;
    if (c.type === 'module') {
      modules++;
      const legacy = await Deno.readFile(`${outDir}/${c.filename}`);
      const forms: Record<World, Uint8Array> = {
        legacy,
        translated: translate(legacy, false),
        'translated -Oz': translate(legacy, true),
      };
      for (const w of WORLDS) {
        if (w !== 'legacy') {
          for (const p of inspect(forms[w])) failures.push(`${where} [${w}] ${p}`);
        }
        try {
          const mod = new WebAssembly.Module(forms[w] as BufferSource);
          const imports: Record<string, Record<string, unknown>> = {};
          for (const imp of WebAssembly.Module.imports(mod)) {
            const from = registry.get(w)!.get(imp.module);
            if (!from) throw new Error(`no registered module "${imp.module}"`);
            (imports[imp.module] ??= {})[imp.name] = from[imp.name];
          }
          const inst = new WebAssembly.Instance(mod, imports as WebAssembly.Imports);
          current.set(w, inst);
          if (c.name) named.get(w)!.set(c.name, inst);
        } catch (e) {
          failures.push(`${where} [${w}] module did not instantiate: ${(e as Error).message}`);
          current.delete(w);
        }
      }
      continue;
    }
    if (c.type === 'register') {
      for (const w of WORLDS) {
        const inst = c.name ? named.get(w)!.get(c.name) : current.get(w);
        if (inst) registry.get(w)!.set(c.as!, inst.exports);
      }
      continue;
    }
    if (
      c.type !== 'assert_return' && c.type !== 'assert_exception' && c.type !== 'assert_trap' &&
      c.type !== 'action'
    ) {
      skipped++;
      continue;
    }
    const action = c.action!;
    for (const w of WORLDS) {
      const inst = action.module ? named.get(w)!.get(action.module) : current.get(w);
      const tally = totals.get(w)!;
      const fail = (why: string) => {
        tally.fail++;
        failures.push(`${where} [${w}] ${c.type} ${action.field}: ${why}`);
      };
      if (!inst) {
        fail('no instance');
        continue;
      }
      const fn = inst.exports[action.field] as (...a: unknown[]) => unknown;
      let result: unknown;
      let thrown: unknown;
      try {
        result = fn(...action.args.map(toJs));
      } catch (e) {
        thrown = e;
      }
      // deno-lint-ignore no-explicit-any
      const isException = thrown instanceof (WebAssembly as any).Exception;
      const isTrap = thrown instanceof WebAssembly.RuntimeError;
      if (c.type === 'assert_exception') {
        if (isException) tally.pass++;
        else fail(thrown ? `threw ${thrown}` : `returned ${String(result)}`);
      } else if (c.type === 'assert_trap') {
        if (isTrap) tally.pass++;
        else fail(thrown ? `threw ${thrown}` : `returned ${String(result)}`);
      } else if (thrown !== undefined) {
        fail(`threw ${thrown}`);
      } else if (c.type === 'action') {
        tally.pass++;
      } else {
        const want = c.expected ?? [];
        const got = want.length === 0 ? [] : want.length === 1 ? [result] : (result as unknown[]);
        if (got.length === want.length && want.every((v, i) => sameValue(got[i], v))) tally.pass++;
        else fail(`got ${JSON.stringify(got, (_k, x) => typeof x === 'bigint' ? `${x}n` : x)}`);
      }
    }
  }
}

console.log('  === legacy EH spec testsuite, through TranslateToExnref ===');
for (const w of WORLDS) {
  const t = totals.get(w)!;
  console.log(`    ${`behavioural assertions [${w}]`.padEnd(41)}${t.pass} / ${t.pass + t.fail}`);
}
console.log(`    ${'modules'.padEnd(41)}${modules}`);
console.log(
  `    ${'assert_invalid / assert_malformed'.padEnd(41)}${skipped} skipped (not this pass's job)`,
);
if (failures.length > 0) {
  console.log(`\n  ${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`    ${f}`);
  Deno.exit(1);
}
console.log(
  '\n  every assertion holds in every world; every translated module is legacy-free and valid',
);
