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
  const locStr = loc.filename
    ? `${loc.filename}:${loc.line}:${loc.column}`
    : `<binary>:0x${loc.offset.toString(16).padStart(8, '0')}`;
  const header = `${locStr}: ${severity}: ${message}`;

  if (format === ErrorFormat.Long && sourceLine !== undefined && loc.column > 0) {
    const caret = ' '.repeat(loc.column - 1) + '^';
    return `${header}\n${sourceLine}\n${caret}`;
  }
  return header;
}

/**
 * Renders all diagnostics in {@link list} to a newline-separated string.
 *
 * @param list - The errors to format.
 * @param format - Output format; defaults to {@link ErrorFormat.Short}.
 */
export function formatErrors(list: ErrorList, format: ErrorFormat = ErrorFormat.Short): string {
  return list.map((e) => formatError(e, undefined, format)).join('\n');
}
