/**
 * @module binaryen-ts/parser/sexpr
 *
 * S-expression tree builder for WAT parsing.
 *
 * Converts a flat {@link Token} array (from the tokenizer) into a nested
 * {@link SExpr} tree. This is the second stage of the WAT parser pipeline:
 *
 * ```
 * Token[]  ──buildSExpr()──▶  SExpr  ──parseModule()──▶  WasmModule
 * ```
 *
 * The WAT grammar is built on S-expressions: every construct is either an
 * atom (a single token) or a parenthesized list whose first element is a
 * keyword. This representation makes the subsequent IR builder straightforward
 * — it only needs to pattern-match on the keyword head of each list.
 *
 * @example
 * ```ts
 * import { tokenize } from "./tokenizer.ts";
 * import { buildSExpr, listHead, listChildren } from "./sexpr.ts";
 *
 * const tokens = tokenize(`(module (func $f (result i32) (i32.const 42)))`);
 * const root = buildSExpr(tokens);
 * // root → List("module", [List("func", [Atom($f), List("result", [Atom(i32)]), ...])])
 * console.log(listHead(root)); // "module"
 * ```
 *
 * @license MIT
 */

import { type TextPos, type Token, TokenKind } from './tokenizer.ts';

// ---------------------------------------------------------------------------
// SExpr node types
// ---------------------------------------------------------------------------

/**
 * An S-expression atom — a single token that is not a parenthesis.
 * Atoms represent keywords, identifiers, literals, and strings.
 */
export interface Atom {
  readonly kind: 'atom';
  readonly token: Token;
  readonly pos: TextPos;
}

/**
 * An S-expression list — a parenthesized sequence of child S-expressions.
 * The first child, when present, is always an {@link Atom} whose `token`
 * has kind {@link TokenKind.Keyword} or {@link TokenKind.Id}.
 */
export interface SList {
  readonly kind: 'list';
  readonly children: SExpr[];
  readonly pos: TextPos;
}

/** Union of all S-expression node types. */
export type SExpr = Atom | SList;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** Error thrown when the S-expression structure is malformed. */
export class WatSExprError extends Error {
  constructor(
    message: string,
    public readonly pos: TextPos,
    public readonly filename: string,
  ) {
    super(`${filename}:${pos.line}:${pos.col}: ${message}`);
    this.name = 'WatSExprError';
  }
}

/**
 * Builds an {@link SExpr} tree from a flat token array.
 *
 * Expects the token stream to contain exactly one top-level S-expression
 * (the WAT `(module ...)` form) followed by EOF. For `.wast` files that may
 * contain multiple top-level forms, call {@link buildSExprList} instead.
 *
 * @param tokens - Output of {@link tokenize}.
 * @param filename - Filename for error messages.
 * @throws {@link WatSExprError} on structural errors (unmatched parens, etc.).
 */
export function buildSExpr(tokens: Token[], filename = '<input>'): SExpr {
  const builder = new SExprBuilder(tokens, filename);
  const root = builder.parseOne();
  if (!builder.atEOF()) {
    const pos = builder.currentPos();
    throw new WatSExprError('unexpected tokens after top-level form', pos, filename);
  }
  return root;
}

/**
 * Builds a list of top-level {@link SExpr} nodes from a token array.
 * Used for `.wast` files that contain multiple directives.
 *
 * @param tokens - Output of {@link tokenize}.
 * @param filename - Filename for error messages.
 */
export function buildSExprList(tokens: Token[], filename = '<input>'): SExpr[] {
  const builder = new SExprBuilder(tokens, filename);
  const result: SExpr[] = [];
  while (!builder.atEOF()) {
    result.push(builder.parseOne());
  }
  return result;
}

// ---------------------------------------------------------------------------
// Internal builder class
// ---------------------------------------------------------------------------

class SExprBuilder {
  private pos = 0;
  private readonly tokens: Token[];
  private readonly filename: string;

  constructor(tokens: Token[], filename: string) {
    this.tokens = tokens;
    this.filename = filename;
  }

  parseOne(): SExpr {
    const tok = this.peek();
    if (tok.kind === TokenKind.EOF) {
      this.err('unexpected end of input');
    }
    if (tok.kind === TokenKind.LParen) {
      return this.parseList();
    }
    if (tok.kind === TokenKind.RParen) {
      this.err('unexpected `)`');
    }
    return this.parseAtom();
  }

  private parseList(): SList {
    const open = this.consume();
    const pos = open.pos;
    const children: SExpr[] = [];
    while (true) {
      const tok = this.peek();
      if (tok.kind === TokenKind.EOF) {
        throw new WatSExprError('unclosed `(` — reached end of input', pos, this.filename);
      }
      if (tok.kind === TokenKind.RParen) {
        this.consume();
        break;
      }
      children.push(this.parseOne());
    }
    return { kind: 'list', children, pos };
  }

  private parseAtom(): Atom {
    const tok = this.consume();
    return { kind: 'atom', token: tok, pos: tok.pos };
  }

  consume(): Token {
    // Past the end there is no token to return, and the tokenizer always
    // terminates the stream with EOF — so a miss here means the stream was
    // built by something else, not that input ran out. Synthesize EOF rather
    // than returning `undefined` typed as `Token`, matching `peek()` below.
    const tok = this.tokens[this.pos] ??
      { kind: TokenKind.EOF, raw: '', pos: { line: 1, col: 1 } };
    if (tok.kind !== TokenKind.EOF) this.pos++;
    return tok;
  }

  peek(): Token {
    return this.tokens[this.pos] ?? { kind: TokenKind.EOF, raw: '', pos: { line: 1, col: 1 } };
  }

  atEOF(): boolean {
    return this.tokens[this.pos]?.kind === TokenKind.EOF || this.pos >= this.tokens.length;
  }

  currentPos(): TextPos {
    return this.peek().pos;
  }

  private err(msg: string): never {
    throw new WatSExprError(msg, this.currentPos(), this.filename);
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Returns the keyword head of a list node, or `null` if the list is empty.
 *
 * @example
 * ```ts
 * listHead(parse("(func $f)"))  // → "func"
 * listHead(parse("()"))         // → null
 * ```
 */
export function listHead(s: SList): string | null {
  const first = s.children[0];
  if (!first || first.kind !== 'atom') return null;
  return first.token.raw;
}

/**
 * Returns the children of a list node, excluding the keyword head.
 */
export function listChildren(s: SList): SExpr[] {
  return s.children.slice(1);
}

/**
 * Returns the children of a list node starting at index `from` (0-based, includes head).
 */
export function listFrom(s: SList, from: number): SExpr[] {
  return s.children.slice(from);
}

/**
 * Returns the raw text of an atom node, or `null` if `s` is a list or absent.
 *
 * `undefined` is accepted deliberately: callers index into a child array
 * (`atomText(args[0])`), and "there is no such child" is the same answer as
 * "that child is not an atom" — you do not get a value. Every call site already
 * handles the `null`, usually as `?? this.err(...)`. Narrowing the parameter to
 * `SExpr` did not make the absent case impossible, it only hid it from the
 * type checker.
 */
export function atomText(s: SExpr | undefined): string | null {
  return s?.kind === 'atom' ? s.token.raw : null;
}

/**
 * Returns `true` if `s` is a list whose head equals `keyword`. An absent node is
 * not a list with that keyword, so `undefined` is `false` — see { atomText}
 * for why the parameter admits it.
 */
export function isListWith(s: SExpr | undefined, keyword: string): s is SList {
  return s?.kind === 'list' && listHead(s) === keyword;
}

/**
 * Returns the string value of a string-literal atom, or `null`.
 */
export function atomString(s: SExpr | undefined): string | null {
  if (s?.kind !== 'atom' || s.token.kind !== TokenKind.String) return null;
  return s.token.text ?? null;
}

/**
 * Returns the integer value of an integer-literal atom, or `null`.
 */
export function atomInt(s: SExpr | undefined): number | bigint | null {
  if (s?.kind !== 'atom' || s.token.kind !== TokenKind.Integer) return null;
  return s.token.value ?? null;
}

/**
 * Returns the float value of a float-literal atom, or `null`.
 */
export function atomFloat(s: SExpr | undefined): number | null {
  if (s?.kind !== 'atom' || s.token.kind !== TokenKind.Float) return null;
  return (s.token.value as number) ?? null;
}

/**
 * Renders an S-expression back to a compact string (useful for debugging).
 */
export function sExprToString(s: SExpr): string {
  if (s.kind === 'atom') return s.token.raw;
  return `(${s.children.map(sExprToString).join(' ')})`;
}
