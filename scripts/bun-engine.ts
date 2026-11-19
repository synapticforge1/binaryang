// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * The JavaScriptCore options every Bun this repository starts runs with. Importing this module
 * sets them in `process.env`, so each process spawned afterwards inherits them.
 *
 * 🔒 **memory64 on, always** (owner, 2026-11-19: "We want memory64 on always"). JavaScriptCore
 * implements memory64 / table64 behind `useWasmMemory64`, off by default in Bun 1.4.4 ("Memory64
 * is not enabled"); Safari turns it on from 27.3. With it on, the 24 memory64 / table64 tests the
 * Bun leg listed as engine differences pass (measured 2026-11-19).
 *
 * ⚠️ The option is read when Bun STARTS: setting it inside a running Bun changes nothing for that
 * process, and a `.env` file is read too late (measured). So it reaches a Bun only through the
 * environment of the process that starts it — `scripts/test.ts` and `scripts/gate.ts` import this
 * first. A `bun test` started by hand needs `BUN_JSC_useWasmMemory64=1` in its environment.
 *
 * ```sh
 * bun scripts/test.ts --bun        # sets it for the `bun test` it starts
 * ```
 */

/** The options, as Bun reads them: `BUN_JSC_<JavaScriptCore option>`. */
export const BUN_ENGINE_ENV: Readonly<Record<string, string>> = {
  BUN_JSC_useWasmMemory64: '1',
};

for (const [name, value] of Object.entries(BUN_ENGINE_ENV)) process.env[name] = value;
