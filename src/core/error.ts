// Ported from WebAssembly/wabt (https://github.com/WebAssembly/wabt)
// Original source: include/wabt/error.h, include/wabt/error-formatter.h
// Copyright 2016 WebAssembly Community Group participants
// Licensed under the Apache License, Version 2.0

/**
 * @module
 * Error types and error-collection utilities used across wabt-ts. Errors are
 * accumulated in an {@link ErrorList} rather than thrown immediately, matching
 * the wabt C++ error-reporting pattern.
 */

// ---------------------------------------------------------------------------
// Source location
// ---------------------------------------------------------------------------

/** A location in a source file (text format) or byte offset (binary format). */
export interface Location {
  /** Source filename, or an empty string for binary inputs. */
  filename: string;
  /** 1-based line number (text format only; 0 for binary). */
  line: number;
  /** 1-based column number (text format only; 0 for binary). */
  column: number;
  /** Byte offset from the start of the binary (binary format only; 0 for text). */
  offset: number;
  /**
   * 1-based column just PAST the token (text only; absent where unknown), so a
   * diagnostic underlines the whole token — `^^^^^^^` under `i32.add`, as
   * upstream's tools print it (DG6) — rather than one `^`.
   */
  endColumn?: number;
}

/** Returns a {@link Location} with all fields zeroed (unknown / binary context). */
export function unknownLocation(filename = ''): Location {
  return { filename, line: 0, column: 0, offset: 0 };
}

// ---------------------------------------------------------------------------
// Error severity
// ---------------------------------------------------------------------------

/** Severity level of a diagnostic message. */
export enum ErrorLevel {
  Warning = 0,
  Error = 1,
}

// ---------------------------------------------------------------------------
// Diagnostic entry
// ---------------------------------------------------------------------------

/** A single diagnostic message with its location and severity. */
export interface WabtError {
  /** Where in the source or binary the error occurred. */
  loc: Location;
  /** Human-readable description of the error. */
  message: string;
  /** Severity level. */
  level: ErrorLevel;
}

// ---------------------------------------------------------------------------
// Error list
// ---------------------------------------------------------------------------

/** Mutable collection of errors produced during a single pass. */
export type ErrorList = WabtError[];

/** Creates an empty {@link ErrorList}. */
export function makeErrorList(): ErrorList {
  return [];
}

/** Appends an error-level diagnostic to {@link list}. */
export function addError(list: ErrorList, loc: Location, message: string): void {
  list.push({ loc, message, level: ErrorLevel.Error });
}

/** Appends a warning-level diagnostic to {@link list}. */
export function addWarning(list: ErrorList, loc: Location, message: string): void {
  list.push({ loc, message, level: ErrorLevel.Warning });
}

/** Returns true if {@link list} contains at least one error-level entry. */
export function hasErrors(list: ErrorList): boolean {
  return list.some((e) => e.level === ErrorLevel.Error);
}

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

/** Formatting style for rendered error messages. */
export enum ErrorFormat {
  /** `filename:line:col: error: message` (default). */
  Short = 'short',
  /** `filename:line:col: error: message\n  <source line>\n  ^--- here` (requires source). */
  Long = 'long',
}

/**
 * Where a diagnostic points, as the user reads it:
 *
 * - text — `file:line:col`, whenever there is a line;
 * - binary — `file:0000025`, upstream's seven hex digits of byte offset
 *   (`<binary>:0x00000025` when there is no filename);
 * - unknown — the filename alone (`<input>` with none).
 *
 * ⚠️ Chosen by what the location HOLDS, not by whether it has a filename. It
 * used to print `line:col` whenever a filename was set, and every binary tool
 * sets one — so every binary diagnostic from the CLI read `file:0:0` and the
 * offset the reader had carefully recorded (A3) never reached a user.
 */
export function formatLocation(loc: Location): string {
  if (loc.line > 0) return `${loc.filename || '<input>'}:${loc.line}:${loc.column}`;
  if (loc.offset > 0) {
    return loc.filename
      ? `${loc.filename}:${loc.offset.toString(16).padStart(7, '0')}`
      : `<binary>:0x${loc.offset.toString(16).padStart(8, '0')}`;
  }
  return loc.filename || '<input>';
}

/**
 * Renders a single {@link WabtError} to a human-readable string.
 *
 * @param err - The diagnostic to format.
 * @param sourceLine - Optional source text for the line where the error occurred (long format).
 * @param format - Output format; defaults to {@link ErrorFormat.Short}.
 */
export function formatError(
  err: WabtError,
  sourceLine?: string,
  format: ErrorFormat = ErrorFormat.Short,
): string {
  const { loc, message, level } = err;
  const severity = level === ErrorLevel.Warning ? 'warning' : 'error';
  const header = `${formatLocation(loc)}: ${severity}: ${message}`;

  if (format === ErrorFormat.Long && sourceLine !== undefined && loc.column > 0) {
    // Tabs are kept under tabs, so the caret lines up however the terminal
    // expands them.
    const pad = [...sourceLine.slice(0, loc.column - 1)].map((c) => (c === '\t' ? '\t' : ' '));
    // Under the whole token, as upstream (DG6); one `^` where its end is unknown.
    const width = loc.endColumn !== undefined ? Math.max(1, loc.endColumn - loc.column) : 1;
    return `${header}\n${sourceLine}\n${pad.join('')}${'^'.repeat(width)}`;
  }
  return header;
}

/**
 * Renders all diagnostics in {@link list} to a newline-separated string.
 *
 * With {@link ErrorFormat.Long} and the `source` text the diagnostics point
 * into, each one with a line position is followed by that source line and a
 * caret under its column, as upstream's tools print it — the CLI does this for
 * every text input.
 *
 * @param list - The errors to format.
 * @param format - Output format; defaults to {@link ErrorFormat.Short}.
 * @param source - The text the errors' `line` / `column` refer to.
 */
export function formatErrors(
  list: ErrorList,
  format: ErrorFormat = ErrorFormat.Short,
  source?: string,
): string {
  const lines = source?.split(/\r?\n/);
  return list
    .map((e) => formatError(e, e.loc.line > 0 ? lines?.[e.loc.line - 1] : undefined, format))
    .join('\n');
}
