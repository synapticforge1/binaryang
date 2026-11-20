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

import { printable } from './printable.ts';

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
export const ErrorLevel = {
  Warning: 0,
  Error: 1,
} as const;
/** One of {@link ErrorLevel}'s values. */
export type ErrorLevel = (typeof ErrorLevel)[keyof typeof ErrorLevel];
/** Each member as a type (`ErrorLevel.Warning`), as when ErrorLevel was an `enum`. */
export declare namespace ErrorLevel {
  type Warning = typeof ErrorLevel.Warning;
  type Error = typeof ErrorLevel.Error;
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
/**
 * Whether `e` is the JavaScript engine running out of call stack — what a
 * recursive walker does on a deeply nested module (open-work 13: every stage
 * let it escape as a bare `RangeError`, from ~400 nested blocks in the writers
 * to ~3,000 in the validator). Each tool's boundary turns it into its own
 * typed error with {@link NESTING_TOO_DEEP}.
 */
export function isStackExhausted(e: unknown): boolean {
  return e instanceof RangeError && /call stack/i.test(e.message);
}

/** What a tool reports when {@link isStackExhausted}: actionable, and says it is a limit of the tool. */
export const NESTING_TOO_DEEP =
  'the module nests deeper than this tool can follow (the JavaScript call stack ran out)';

/** An {@link ErrorList} holding the one {@link NESTING_TOO_DEEP} error, for a tool's result. */
export function nestingTooDeep(filename = ''): ErrorList {
  const list = makeErrorList();
  addError(list, unknownLocation(filename), NESTING_TOO_DEEP);
  return list;
}

export function hasErrors(list: ErrorList): boolean {
  return list.some((e) => e.level === ErrorLevel.Error);
}

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

/** Formatting style for rendered error messages. */
export const ErrorFormat = {
  /** `filename:line:col: error: message` (default). */
  Short: 'short',
  /** `filename:line:col: error: message\n  <source line>\n  ^--- here` (requires source). */
  Long: 'long',
} as const;
/** One of {@link ErrorFormat}'s values. */
export type ErrorFormat = (typeof ErrorFormat)[keyof typeof ErrorFormat];
/** Each member as a type (`ErrorFormat.Short`), as when ErrorFormat was an `enum`. */
export declare namespace ErrorFormat {
  type Short = typeof ErrorFormat.Short;
  type Long = typeof ErrorFormat.Long;
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

/** The most characters of a source line one long-format diagnostic quotes (a window around it). */
const MAX_QUOTED_LINE = 200;

/** The most diagnostics {@link formatErrors} prints; the rest are counted. */
const MAX_REPORTED_ERRORS = 100;

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
  const { loc, level } = err;
  // A message quotes the module's names, which may hold an ESC, a bidi override or a line break:
  // printable, tabs kept. A break is escaped too: the layout's own line breaks are the only ones
  // (round 2 review: a name with a newline forged a `file:1:1: error:` line).
  const message = printable(err.message, { keepTabs: true });
  const severity = level === ErrorLevel.Warning ? 'warning' : 'error';
  // The file name comes from the command line: printable too.
  const header = `${printable(formatLocation(loc))}: ${severity}: ${message}`;

  if (format === ErrorFormat.Long && sourceLine !== undefined && loc.column > 0) {
    // The SOURCE LINE is the input's own text: printable as the message is. 🔧 It was printed raw,
    // so a .wat with ESC/BEL on a failing line put terminal control sequences — a clipboard write
    // (OSC 52), a screen clear — on the user's stderr (review S-1, 2026-11-18). The caret is
    // measured on the printable text, so an escape that widens the line keeps it aligned; tabs are
    // kept under tabs, however the terminal expands them.
    const shown = (s: string) => printable(s, { keepTabs: true });
    // 🔧 BOUNDED: a line of N characters quoted once per error was N squared in all (hardening F2,
    // 4.1.x review: 2,000 nested `(catch_all` on one line, an error each, wrote 140 MB). A line
    // over `MAX_QUOTED_LINE` shows a window of that width around the column, `…` at a cut
    // end; the caret stays under its token. A line within the bound prints exactly as before.
    const col = loc.column - 1;
    const from = sourceLine.length > MAX_QUOTED_LINE ? Math.max(0, col - MAX_QUOTED_LINE / 2) : 0;
    const to = Math.min(sourceLine.length, from + MAX_QUOTED_LINE);
    const lead = from > 0 ? '…' : '';
    const before = lead + shown(sourceLine.slice(from, col));
    const pad = [...before].map((c) => (c === '	' ? '	' : ' '));
    // Under the whole token, as upstream (DG6); one `^` where its end is unknown.
    const token = loc.endColumn !== undefined
      ? shown(sourceLine.slice(col, Math.min(loc.endColumn - 1, to)))
      : '';
    const width = Math.min(Math.max(1, [...token].length), MAX_QUOTED_LINE);
    const quoted = `${lead}${shown(sourceLine.slice(from, to))}${
      to < sourceLine.length ? '…' : ''
    }`;
    return `${header}
${quoted}
${pad.join('')}${'^'.repeat(width)}`;
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
  // 🔧 BOUNDED too (hardening F2): malformed input can make an error per token, and a megabyte of
  // them is not a report. The first `MAX_REPORTED_ERRORS` are printed, then a count.
  const shown = list.slice(0, MAX_REPORTED_ERRORS);
  const text = shown
    .map((e) => formatError(e, e.loc.line > 0 ? lines?.[e.loc.line - 1] : undefined, format))
    .join('\n');
  const more = list.length - shown.length;
  return more > 0 ? `${text}\n... ${more} more error${more === 1 ? '' : 's'}` : text;
}
