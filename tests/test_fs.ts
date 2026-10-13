// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.
//
// The file-system calls the tests used from `Deno.*`, with the same names and semantics, on
// `node:fs` (Bun migration B5, 2026-10-13), so each call site changed `Deno.x` to `fsx.x` and
// nothing else. Runs on Node, Bun and Deno alike.

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Path = string | URL;

/** A directory entry, as `Deno.DirEntry` had it. */
export interface DirEntry {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymlink: boolean;
}
const entry = (d: fs.Dirent): DirEntry => ({
  name: d.name,
  isFile: d.isFile(),
  isDirectory: d.isDirectory(),
  isSymlink: d.isSymbolicLink(),
});

export const readTextFile = (p: Path): Promise<string> => fsp.readFile(p, 'utf8');
export const readTextFileSync = (p: Path): string => fs.readFileSync(p, 'utf8');
export const readFile = async (p: Path): Promise<Uint8Array> =>
  new Uint8Array(await fsp.readFile(p));
export const writeTextFile = (p: Path, text: string): Promise<void> => fsp.writeFile(p, text);
export const writeFile = (p: Path, bytes: Uint8Array): Promise<void> => fsp.writeFile(p, bytes);
export const stat = (p: Path): Promise<fs.Stats> => fsp.stat(p);

export async function* readDir(p: Path): AsyncIterable<DirEntry> {
  for (const d of await fsp.readdir(p, { withFileTypes: true })) yield entry(d);
}
export function readDirSync(p: Path): DirEntry[] {
  return fs.readdirSync(p, { withFileTypes: true }).map(entry);
}

/** A new empty directory under the OS temp directory. */
export const makeTempDir = (opts: { prefix?: string } = {}): Promise<string> =>
  fsp.mkdtemp(join(tmpdir(), opts.prefix ?? 'binaryang-'));

/** A new empty file under the OS temp directory. */
export async function makeTempFile(opts: { suffix?: string } = {}): Promise<string> {
  const path = join(tmpdir(), `binaryang-${randomUUID()}${opts.suffix ?? ''}`);
  await fsp.writeFile(path, new Uint8Array(0), { flag: 'wx' });
  return path;
}

/** Remove a file, or a directory: an EMPTY one unless `recursive`, as `Deno.remove`. */
export async function remove(p: Path, opts: { recursive?: boolean } = {}): Promise<void> {
  if (opts.recursive) return fsp.rm(p, { recursive: true });
  const s = await fsp.lstat(p);
  return s.isDirectory() ? fsp.rmdir(p) : fsp.unlink(p);
}
