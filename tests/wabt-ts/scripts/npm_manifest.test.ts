// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { expect } from '@std/expect';
import { type JsrManifest, NODE_FLOOR, NPM_NAME, npmManifest } from '../../../scripts/npm/build.ts';

// Open-work 29: the npm package's manifest is GENERATED from jsr.json (scripts/npm/build.ts), so
// the version keeps one source and the repo's package.json stays private. The tarball itself is
// proved by `bun run npm:prove` (packed, installed, run on every runtime); this checks the
// generator on the real jsr.json, without a build.

const jsr = JSON.parse(readFileSync(new URL('../../../jsr.json', import.meta.url), 'utf8')) as
  & JsrManifest
  & { name: string };
const m = npmManifest(jsr);
const exportsMap = m['exports'] as Record<string, { types: string; default: string }>;

describe('the npm manifest, from jsr.json', () => {
  it("has the npm name and jsr.json's version, and is not JSR's name", () => {
    expect(m['name']).toBe(NPM_NAME);
    expect(m['name']).toBe('@synapticforge1/binaryang');
    expect(m['version']).toBe(jsr.version);
    expect(jsr.name).toBe('@jrmarcum/binaryang');
  });

  it("exports exactly jsr.json's subpaths, each as .js with its .d.ts", () => {
    expect(Object.keys(exportsMap)).toEqual(Object.keys(jsr.exports));
    for (const [sub, file] of Object.entries(jsr.exports)) {
      const stem = file.replace(/\.ts$/, '');
      expect(exportsMap[sub]).toEqual({ types: `${stem}.d.ts`, default: `${stem}.js` });
    }
  });

  it('runs the CLI as `binaryang`, from the "." export, on the Node floor', () => {
    expect(m['bin']).toEqual({ binaryang: './main.js' });
    expect(m['types']).toBe('./main.d.ts');
    expect(m['type']).toBe('module');
    expect(m['engines']).toEqual({ node: NODE_FLOOR });
  });

  it('declares the dual licence, and publishes public with provenance', () => {
    expect(m['license']).toBe('MIT OR Apache-2.0');
    expect(m['publishConfig']).toEqual({ access: 'public', provenance: true });
  });

  it('refuses an export that is not a .ts file, and a jsr.json with no "." export', () => {
    expect(() => npmManifest({ version: '1.0.0', exports: { '.': './main.js' } })).toThrow(
      'not a .ts file',
    );
    expect(() => npmManifest({ version: '1.0.0', exports: { './ir': './src/ir/index.ts' } }))
      .toThrow('no "." export');
  });
});
