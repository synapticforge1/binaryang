// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * One engine's leg of `check-lowering.ts` (open-work 32): for each job, the ORIGINAL module's and
 * the LOWERED module's outcomes, by `spec-behaviour`'s own `outcomes()` — `v128` exports through
 * their wrappers, every import an inert stand-in, values by bits, a trap by its class. It runs
 * under the engine being measured: Node (V8, the referee) or Bun (JavaScriptCore). `node:` only.
 *
 * Usage: `<runtime> scripts/lowering/record.ts <jobs.json> <out.json>`
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { type Invoke, outcomes } from '../spec-behaviour/differential.ts';
import type { Sig } from '../spec-behaviour/v128.ts';

/** One module to replay: its original and lowered bytes, and the invocations after it. */
export interface Job {
  name: string;
  original: string;
  lowered: string;
  invokes: Invoke[];
  v128: [string, Sig][];
}

/** One job's outcomes on this engine. */
export interface Recorded {
  original: string[];
  lowered: string[];
}

if (import.meta.main) {
  const [jobsPath, outPath] = process.argv.slice(2) as [string, string];
  const jobs = JSON.parse(readFileSync(jobsPath, 'utf8')) as Job[];
  const out: Record<string, Recorded> = {};
  for (const j of jobs) {
    const v128 = new Map(j.v128);
    const run = (path: string) => {
      try {
        return outcomes(new Uint8Array(readFileSync(path)), j.invokes, v128);
      } catch (e) {
        return [`recorder threw: ${(e as Error).message.slice(0, 160)}`];
      }
    };
    out[j.name] = { original: run(j.original), lowered: run(j.lowered) };
  }
  writeFileSync(outPath, JSON.stringify(out));
}
