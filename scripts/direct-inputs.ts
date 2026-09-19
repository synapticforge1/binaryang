// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * What `deno task direct` and `deno task direct-behaviour` run over: the 421
 * wasmtk corpus modules, and the 123 modules of `prepare.test.ts`'s fixture
 * (post-M8 fix 7).
 *
 * The corpus alone left both gates blind to whole features. Not one corpus
 * module has a `(start …)` section, so a `prepareForPasses` that dropped the
 * start function kept both gates green (M8e); only `prepare.test.ts` saw it.
 * The fixture — every valid module the deleted bridge tests built — carries a
 * start module whose export answers differently without it, plus GC, tables
 * and the shapes the bridge got wrong.
 */

/** One module a direct gate checks: a name to report it by, and its text. */
export interface DirectInput {
  name: string;
  wat: string;
}

export const CORPUS = new URL('../tests/wabt-ts/wasmtk/', import.meta.url);
export const FIXTURE = new URL(
  '../tests/binaryen-ts/ir/fixtures/direct_path_modules.json',
  import.meta.url,
);

/** The corpus modules, by filename, sorted. */
export async function corpusInputs(): Promise<DirectInput[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(CORPUS)) {
    if (entry.isFile && entry.name.endsWith('.wat')) names.push(entry.name);
  }
  names.sort((a, b) => a.localeCompare(b));
  return Promise.all(
    names.map(async (name) => ({ name, wat: await Deno.readTextFile(new URL(name, CORPUS)) })),
  );
}

/**
 * The fixture's modules, named `fixture#<i> (<the test file it came from>)`.
 * A missing or empty fixture is an ERROR, not an empty list: a gate that
 * quietly lost its inputs would read green.
 */
export async function fixtureInputs(): Promise<DirectInput[]> {
  const modules: { from: string; wat: string }[] = JSON.parse(await Deno.readTextFile(FIXTURE));
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error(`no modules in ${FIXTURE.pathname}`);
  }
  return modules.map(({ from, wat }, i) => ({ name: `fixture#${i} (${from})`, wat }));
}

/** Everything a direct gate runs over: the corpus, then the fixture. */
export async function directInputs(): Promise<{ corpus: number; inputs: DirectInput[] }> {
  const corpus = await corpusInputs();
  return { corpus: corpus.length, inputs: [...corpus, ...await fixtureInputs()] };
}
