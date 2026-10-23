// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module tools/target
 *
 * A TARGET: a portability profile from D4 (`./definitions`, `profiles.json`) that a module is made
 * to fit — `wasm-opt --target portable`. Open-work 34; the agreed shape (cmem/portability.md): a
 * target "validates against the profile, applies each lowering, and refuses the rest naming the
 * engines that would".
 *
 * - **What a module needs** is decided by the validator, the one judge of feature use: a module
 *   NEEDS feature X when it is invalid with X off and every other feature on. Measured exact on
 *   the 789 probe modules (2026-10-23), up to dependencies (a GC module also needs typed function
 *   references). Instructions whose tier differs from their feature's (`br_on_non_null`, the
 *   legacy exception instructions) are found in the IR.
 * - **Lowered** features and instructions are rewritten by their pass, before any optimization.
 * - **Excluded** ones refuse the module, every one named with the engines measured refusing it —
 *   before anything runs.
 * - **The output is checked against the profile again**, so no pass (the optimizer's included)
 *   can hand back a module outside it.
 *
 * @license MIT
 */

import { allFeatures, type Features } from '../core/feature.ts';
import { ExpressionKind } from '../ir/expressions.ts';
import { BrOnOp } from '../ir/ir.ts';
import type { WasmModule } from '../ir/module.ts';
import { walkExpression } from '../ir/walk.ts';
import { PROFILE_DEFINITIONS, profileDefinition } from '../definitions/mod.ts';
import type { ProfileDefinition, ProfileTier } from '../definitions/types.ts';
import { PassRunner } from '../passes/index.ts';
import { wasmValidate } from './wasm-validate.ts';

/** Something a module uses that is not portable as it stands, in a profile. */
export interface TargetFinding {
  /** A D2 feature, or an instruction (D1 name). */
  kind: 'feature' | 'instruction';
  name: string;
  tier: Exclude<ProfileTier, 'portable'>;
  /** For tier `lowered`: the pass that rewrites it. */
  pass?: string;
  /** The defining engines measured refusing it. */
  refusedBy: string[];
}

/** A module the target cannot take: its excluded findings, each named with its engines. */
export class TargetError extends Error {
  readonly target: string;
  readonly findings: TargetFinding[];
  constructor(target: string, findings: TargetFinding[], measured: string) {
    super(
      `--target ${target}: the module uses ${findings.length === 1 ? 'a feature' : 'features'} ` +
        `no pass makes portable (engines measured ${measured}):\n` +
        findings.map((f) =>
          `  ${f.name} — refused by ${f.refusedBy.join(', ') || 'no engine measured'}`
        )
          .join('\n'),
    );
    this.name = 'TargetError';
    this.target = target;
    this.findings = findings;
  }
}

/**
 * The order lowerings run in, when a module needs several. Memory64Lowering before
 * LowerCustomPageSizes: both orders behave the same, and this one was smaller (640 bytes against
 * 789 on a module using both, 2026-10-23).
 */
const LOWERING_ORDER = [
  'TranslateToExnref',
  'Memory64Lowering',
  'LowerCustomPageSizes',
  'WideArithmeticLowering',
  'RelaxedSimdLowering',
];

/** The D4 profile `name`; throws, listing the profiles, when there is none. */
export function targetProfile(name: string): ProfileDefinition {
  const p = profileDefinition(name);
  if (p === undefined) {
    const known = PROFILE_DEFINITIONS.entries.map((e) => e.name).join(', ');
    throw new Error(`unknown target "${name}" (targets: ${known})`);
  }
  return p;
}

/**
 * The D2 features `bytes` needs: each X under which the module is invalid with X off and every
 * other feature on. A module invalid with every feature on needs nothing this can name: `[]`.
 */
export function featuresNeeded(bytes: Uint8Array): string[] {
  const all = allFeatures();
  if (wasmValidate(bytes, { features: all }).errors.length > 0) return [];
  return (Object.keys(all) as (keyof Features)[]).filter((x) =>
    wasmValidate(bytes, { features: { ...all, [x]: false } }).errors.length > 0
  );
}

/** The instructions of `names` (D1 names) that `module`'s code holds. */
function instructionsUsed(module: WasmModule, names: ReadonlySet<string>): Set<string> {
  const found = new Set<string>();
  const see = (n: string) => names.has(n) && found.add(n);
  for (const fn of module.functions) {
    walkExpression(fn.body, (e) => {
      if (e.kind === ExpressionKind.Try) {
        see('try');
        for (const c of e.catches) see(c.tag === undefined ? 'catch_all' : 'catch');
        if (e.delegate !== undefined) see('delegate');
      } else if (e.kind === ExpressionKind.Rethrow) see('rethrow');
      else if (e.kind === ExpressionKind.BrOn && e.opcode === BrOnOp.NonNull) see('br_on_non_null');
    });
  }
  return found;
}

/** Everything `module` (whose encoding is `bytes`) uses that `profile` does not take as it is. */
export function assessTarget(
  bytes: Uint8Array,
  module: WasmModule,
  profile: ProfileDefinition,
): TargetFinding[] {
  const out: TargetFinding[] = [];
  const needs = new Set(featuresNeeded(bytes));
  for (const f of profile.features) {
    if (f.tier === 'portable' || !needs.has(f.feature)) continue;
    out.push({
      kind: 'feature',
      name: f.feature,
      tier: f.tier,
      ...(f.pass === undefined ? {} : { pass: f.pass }),
      refusedBy: f.refusedBy,
    });
  }
  const listed = new Map(profile.opcodes.map((o) => [o.name, o]));
  const used = instructionsUsed(module, new Set(listed.keys()));
  for (const [name, o] of listed) {
    if (o.tier === 'portable' || !used.has(name)) continue;
    out.push({
      kind: 'instruction',
      name,
      tier: o.tier,
      ...(o.pass === undefined ? {} : { pass: o.pass }),
      refusedBy: o.refusedBy,
    });
  }
  return out;
}

/**
 * Fits `module` to the target `name`, in place: refuses it with a {@link TargetError} when it uses
 * anything excluded, else runs each lowering it needs. Returns the passes run, in order.
 */
export function applyTarget(bytes: Uint8Array, module: WasmModule, name: string): string[] {
  const profile = targetProfile(name);
  const findings = assessTarget(bytes, module, profile);
  const excluded = findings.filter((f) => f.tier === 'excluded');
  if (excluded.length > 0) throw new TargetError(name, excluded, profile.measured);
  const wanted = new Set(findings.map((f) => f.pass!));
  const passes = LOWERING_ORDER.filter((p) => wanted.has(p));
  for (const p of wanted) {
    if (!LOWERING_ORDER.includes(p)) throw new Error(`no lowering order for ${p}`);
  }
  if (passes.length > 0) {
    const runner = new PassRunner(module, {});
    for (const p of passes) runner.add(p);
    runner.run();
  }
  return passes;
}

/**
 * Checks a FINISHED module against the target: throws when it uses anything outside the profile,
 * which would mean a pass introduced it.
 */
export function checkTarget(bytes: Uint8Array, module: WasmModule, name: string): void {
  const profile = targetProfile(name);
  const findings = assessTarget(bytes, module, profile);
  if (findings.length > 0) {
    throw new Error(
      `--target ${name}: the output uses ${
        findings.map((f) => f.name).join(', ')
      }, outside the profile ` +
        '(a pass introduced it — a binaryang defect; please report it)',
    );
  }
}
