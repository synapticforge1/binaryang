// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

/**
 * @module
 * The shapes of the shared definitions (open-work 22). The data is in
 * `features.json` / `verdicts.json`; `data.ts` is generated from them.
 */

/** What every definition file carries besides its entries. */
export interface DefinitionHeader {
  /** `D2`, `D3` — the workspace's name for the definition. */
  definition: string;
  title: string;
  /** The data's own version: bumped when an entry changes. */
  dataVersion: string;
  /** SHA-256 of the canonical JSON (keys sorted, no whitespace) with this field empty. */
  sha256: string;
  /** What each field means, in words. */
  rules: Record<string, string>;
}

/** A stack signature: operand types bottom-first, then result types. `addr`: the memory's index type. */
export interface StackSignature {
  params: string[];
  results: string[];
}

/** One WebAssembly instruction (D1). */
export interface OpcodeDefinition {
  /** The text mnemonic as binaryang prints it. */
  name: string;
  /** The opcode bytes, hex: prefix and LEB128 sub-opcode. */
  encoding: string;
  /** `null`, or the prefix byte as hex (`0xfd`). */
  prefix: string | null;
  /** The single byte, or the sub-opcode after the prefix. */
  opcode: number;
  /** Immediate kinds, in binary order. */
  immediates: string[];
  /** Access width in bytes, for an instruction with a memarg. */
  align?: number;
  /** Fixed stack signature, or `null`. */
  signature: StackSignature | null;
  /** The D2 feature that gates it; `null` for core. */
  feature: string | null;
  /** Coarse class. */
  class: string;
}

export interface OpcodeDefinitions extends DefinitionHeader {
  entries: OpcodeDefinition[];
}

/** One WebAssembly feature or proposal (D2). */
export interface FeatureDefinition {
  /** The canonical name: a key of `Features`. */
  name: string;
  /** The spelling of `--enable-<cli>` / `--disable-<cli>`. */
  cli: string;
  /** Older spellings still accepted, deprecated. */
  cliAliases?: string[];
  /** On in `defaultFeatures()`. */
  defaultOn: boolean;
  /** `false`: the flag exists and changes nothing (see `note`). */
  implemented: boolean;
  /** Spec-testsuite directories, relative to its root, whose suites need it. */
  testsuiteDirs: string[];
  /** On ONLY in these directories: it changes core semantics. */
  onlyIn?: string[];
  /** OFF in these directories: a snapshot written before it, which it relaxes. */
  offIn?: string[];
  note?: string;
  /** When the entry entered the list. */
  since: string;
}

/** One verdict class (D3). */
export interface VerdictDefinition {
  verdict: 'trap' | 'exhaustion';
  /** The class key a runner reports. */
  key: string;
  /** The testsuite's text, exactly. */
  message: string;
}

export interface FeatureDefinitions extends DefinitionHeader {
  entries: FeatureDefinition[];
}

export interface VerdictDefinitions extends DefinitionHeader {
  entries: VerdictDefinition[];
}

/** A tier of a portability profile (D4). */
export type ProfileTier = 'portable' | 'lowered' | 'excluded';

/** One engine that defines a profile (D4). */
export interface ProfileEngine {
  name: string;
  kind: string;
  /** The build measured. */
  build: string;
}

/** A feature's or an instruction's place in a profile (D4). */
export interface ProfileTierEntry {
  tier: ProfileTier;
  /** The pass that lowers it, for tier `lowered`. */
  pass?: string;
  /** The defining engines measured refusing it. */
  refusedBy: string[];
  /** How many probe modules exercised it. */
  probes: number;
  note?: string;
}

/** One portability profile (D4). */
export interface ProfileDefinition {
  /** As `wasm-opt --target <name>` takes it. */
  name: string;
  /** When the engines were measured. */
  measured: string;
  engines: ProfileEngine[];
  /** One per D2 feature. */
  features: (ProfileTierEntry & { feature: string })[];
  /** Instructions whose tier differs from their feature's, by D1 name. */
  opcodes: (ProfileTierEntry & { name: string })[];
}

export interface ProfileDefinitions extends DefinitionHeader {
  entries: ProfileDefinition[];
}
