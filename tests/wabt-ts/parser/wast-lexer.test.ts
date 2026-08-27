// Copyright (c) 2026 Jon Marcum
// Licensed under the MIT License. See LICENSE-MIT in the repository root.

import { describe, it } from '@std/testing/bdd';
import { expect } from '@std/expect';
import { WastLexer } from '../../../src/wabt-ts/parser/wast-lexer.ts';
import { LiteralType, TokenType } from '../../../src/wabt-ts/parser/token.ts';
import type {
  LiteralToken,
  OpcodeToken,
  RefKindToken,
  StringToken,
  Token,
  TypeToken,
} from '../../../src/wabt-ts/parser/token.ts';
import { Type } from '../../../src/wabt-ts/core/types.ts';
import { PREFIX_MISC, PREFIX_SIMD, PREFIX_THREADS } from '../../../src/wabt-ts/core/opcode.ts';
import { Opcode } from '../../../src/wabt-ts/core/opcode.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lex(src: string): Token[] {
  return new WastLexer(src).tokenize();
}

function lexOne(src: string): Token {
  const toks = lex(src);
  // last token is always EOF; return first meaningful token
  const tok = toks[0];
  if (tok === undefined) throw new Error('no tokens');
  return tok;
}

function lexTypes(src: string): TokenType[] {
  return lex(src).map((t) => t.tokenType);
}

// ---------------------------------------------------------------------------
// Structural tokens
// ---------------------------------------------------------------------------

describe('WastLexer — structural', () => {
  it('empty source yields only EOF', () => {
    const toks = lex('');
    expect(toks.length).toBe(1);
    expect(toks[0]?.tokenType).toBe(TokenType.Eof);
  });

  it('tokenizes ( and )', () => {
    const types = lexTypes('()');
    expect(types).toEqual([TokenType.Lpar, TokenType.Rpar, TokenType.Eof]);
  });

  it('tokenizes nested parens', () => {
    const types = lexTypes('(())');
    expect(types).toEqual([
      TokenType.Lpar,
      TokenType.Lpar,
      TokenType.Rpar,
      TokenType.Rpar,
      TokenType.Eof,
    ]);
  });

  it('location tracks line and column', () => {
    const tok = lexOne('(');
    expect(tok.loc.line).toBe(1);
    expect(tok.loc.column).toBe(1);
  });

  it('location column increments across tokens', () => {
    const toks = lex('( )');
    expect(toks[0]?.loc.column).toBe(1);
    expect(toks[1]?.loc.column).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Whitespace and comments
// ---------------------------------------------------------------------------

describe('WastLexer — whitespace and comments', () => {
  it('skips spaces and tabs', () => {
    expect(lexTypes('  \t  ')).toEqual([TokenType.Eof]);
  });

  it('skips line comments (;;)', () => {
    expect(lexTypes(';; this is a comment\n(')).toEqual([TokenType.Lpar, TokenType.Eof]);
  });

  it('line comment to EOF is fine', () => {
    expect(lexTypes(';; no newline')).toEqual([TokenType.Eof]);
  });

  it('skips block comments (;...;)', () => {
    expect(lexTypes('(; comment ;)(')).toEqual([TokenType.Lpar, TokenType.Eof]);
  });

  it('supports nested block comments', () => {
    expect(lexTypes('(; outer (;inner;) outer ;)(')).toEqual([TokenType.Lpar, TokenType.Eof]);
  });

  it('updates line counter across line comments', () => {
    const toks = lex(';; line 1\n(');
    const lpar = toks.find((t) => t.tokenType === TokenType.Lpar);
    expect(lpar?.loc.line).toBe(2);
  });

  it('updates line counter across block comments with newlines', () => {
    const toks = lex('(;\nline 2\n;)(');
    const lpar = toks.find((t) => t.tokenType === TokenType.Lpar);
    expect(lpar?.loc.line).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Bare keyword tokens
// ---------------------------------------------------------------------------

describe('WastLexer — bare keywords', () => {
  const BARE_CASES: Array<[string, TokenType]> = [
    ['module', TokenType.Module],
    ['function', TokenType.Function],
    ['param', TokenType.Param],
    ['result', TokenType.Result],
    ['local', TokenType.Local],
    ['global', TokenType.Global],
    ['memory', TokenType.Memory],
    ['table', TokenType.Table],
    ['import', TokenType.Import],
    ['export', TokenType.Export],
    ['type', TokenType.Type],
    ['start', TokenType.Start],
    ['data', TokenType.Data],
    ['elem', TokenType.Elem],
    ['mut', TokenType.Mut],
    ['ref', TokenType.Ref],
    ['null', TokenType.Null],
    ['nop', TokenType.Nop],
    ['drop', TokenType.Drop],
    ['return', TokenType.Return],
    ['assert_return', TokenType.AssertReturn],
    ['assert_trap', TokenType.AssertTrap],
    ['assert_invalid', TokenType.AssertInvalid],
    ['assert_malformed', TokenType.AssertMalformed],
    ['invoke', TokenType.Invoke],
    ['register', TokenType.Register],
  ];

  for (const [kw, expected] of BARE_CASES) {
    it(`'${kw}' → expected TokenType`, () => {
      expect(lexOne(kw).tokenType).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Value type tokens
// ---------------------------------------------------------------------------

describe('WastLexer — value types', () => {
  it('i32 → ValueType with Type.I32', () => {
    const tok = lexOne('i32') as TypeToken;
    expect(tok.tokenType).toBe(TokenType.ValueType);
    expect(tok.valueType).toBe(Type.I32);
  });

  it('i64 → ValueType with Type.I64', () => {
    const tok = lexOne('i64') as TypeToken;
    expect(tok.tokenType).toBe(TokenType.ValueType);
    expect(tok.valueType).toBe(Type.I64);
  });

  it('f32 → ValueType with Type.F32', () => {
    const tok = lexOne('f32') as TypeToken;
    expect(tok.tokenType).toBe(TokenType.ValueType);
    expect(tok.valueType).toBe(Type.F32);
  });

  it('f64 → ValueType with Type.F64', () => {
    const tok = lexOne('f64') as TypeToken;
    expect(tok.tokenType).toBe(TokenType.ValueType);
    expect(tok.valueType).toBe(Type.F64);
  });

  it('v128 → ValueType with Type.V128', () => {
    const tok = lexOne('v128') as TypeToken;
    expect(tok.tokenType).toBe(TokenType.ValueType);
    expect(tok.valueType).toBe(Type.V128);
  });
});

// ---------------------------------------------------------------------------
// Ref kind tokens
// ---------------------------------------------------------------------------

describe('WastLexer — ref kinds', () => {
  it('func → Func refkind with Type.FuncRef', () => {
    const tok = lexOne('func') as RefKindToken;
    expect(tok.tokenType).toBe(TokenType.Func);
    expect(tok.refType).toBe(Type.FuncRef);
  });

  it('funcref → ValueType with Type.FuncRef', () => {
    const tok = lexOne('funcref') as TypeToken;
    expect(tok.tokenType).toBe(TokenType.ValueType);
    expect(tok.valueType).toBe(Type.FuncRef);
  });

  it('externref → ValueType with Type.ExternRef', () => {
    const tok = lexOne('externref') as TypeToken;
    expect(tok.tokenType).toBe(TokenType.ValueType);
    expect(tok.valueType).toBe(Type.ExternRef);
  });
});

// ---------------------------------------------------------------------------
// Opcode tokens — core
// ---------------------------------------------------------------------------

describe('WastLexer — core opcode tokens', () => {
  it('i32.const → Const opcode', () => {
    const tok = lexOne('i32.const') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.Const);
    expect(tok.opcode as unknown as number).toBe(Opcode.I32Const);
  });

  it('i32.add → Binary opcode', () => {
    const tok = lexOne('i32.add') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.Binary);
    expect(tok.opcode as unknown as number).toBe(Opcode.I32Add);
  });

  it('i32.load → Load opcode', () => {
    const tok = lexOne('i32.load') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.Load);
    expect(tok.opcode as unknown as number).toBe(Opcode.I32Load);
  });

  it('i32.store → Store opcode', () => {
    const tok = lexOne('i32.store') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.Store);
    expect(tok.opcode as unknown as number).toBe(Opcode.I32Store);
  });

  it('block → Block opcode', () => {
    const tok = lexOne('block') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.Block);
    expect(tok.opcode as unknown as number).toBe(Opcode.Block);
  });

  it('if → If opcode', () => {
    const tok = lexOne('if') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.If);
    expect(tok.opcode as unknown as number).toBe(Opcode.If);
  });

  it('call → Call opcode', () => {
    const tok = lexOne('call') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.Call);
    expect(tok.opcode as unknown as number).toBe(Opcode.Call);
  });

  it('br → Br opcode', () => {
    const tok = lexOne('br') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.Br);
    expect(tok.opcode as unknown as number).toBe(Opcode.Br);
  });

  it('unreachable → Unreachable opcode', () => {
    const tok = lexOne('unreachable') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.Unreachable);
    expect(tok.opcode as unknown as number).toBe(Opcode.Unreachable);
  });

  it('memory.grow → MemoryGrow opcode', () => {
    const tok = lexOne('memory.grow') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.MemoryGrow);
    expect(tok.opcode as unknown as number).toBe(Opcode.MemoryGrow);
  });
});

// ---------------------------------------------------------------------------
// Opcode tokens — extended (SIMD, atomics, misc)
// ---------------------------------------------------------------------------

describe('WastLexer — extended opcode tokens', () => {
  it('v128.load → SimdLoadSplat with SIMD prefix', () => {
    const tok = lexOne('v128.load') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.Load);
    expect(tok.opcode as unknown as number).toBe((PREFIX_SIMD << 16) | 0x00);
  });

  it('i32x4.add → Binary with SIMD prefix', () => {
    const tok = lexOne('i32x4.add') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.Binary);
    expect(tok.opcode as unknown as number).toBe((PREFIX_SIMD << 16) | 0xae);
  });

  it('atomic.fence → AtomicFence with threads prefix', () => {
    const tok = lexOne('atomic.fence') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.AtomicFence);
    expect(tok.opcode as unknown as number).toBe((PREFIX_THREADS << 16) | 0x03);
  });

  it('i32.atomic.load → AtomicLoad', () => {
    const tok = lexOne('i32.atomic.load') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.AtomicLoad);
    expect(tok.opcode as unknown as number).toBe((PREFIX_THREADS << 16) | 0x10);
  });

  it('memory.copy → MemoryCopy with misc prefix', () => {
    const tok = lexOne('memory.copy') as OpcodeToken;
    expect(tok.tokenType).toBe(TokenType.MemoryCopy);
    expect(tok.opcode as unknown as number).toBe((PREFIX_MISC << 16) | 0x0a);
  });
});

// ---------------------------------------------------------------------------
// Identifier (Var) tokens
// ---------------------------------------------------------------------------

describe('WastLexer — identifiers', () => {
  it('$foo → Var with text "$foo"', () => {
    const tok = lexOne('$foo') as StringToken;
    expect(tok.tokenType).toBe(TokenType.Var);
    expect(tok.text).toBe('$foo');
  });

  it('$0 → Var with text "$0"', () => {
    const tok = lexOne('$0') as StringToken;
    expect(tok.tokenType).toBe(TokenType.Var);
    expect(tok.text).toBe('$0');
  });

  it('$my_func → Var', () => {
    const tok = lexOne('$my_func') as StringToken;
    expect(tok.tokenType).toBe(TokenType.Var);
    expect(tok.text).toBe('$my_func');
  });

  it('$add!#$ → Var (id chars include punctuation)', () => {
    const tok = lexOne('$add!') as StringToken;
    expect(tok.tokenType).toBe(TokenType.Var);
    expect(tok.text).toBe('$add!');
  });
});

// ---------------------------------------------------------------------------
// String literals (Text)
// ---------------------------------------------------------------------------

describe('WastLexer — string literals', () => {
  it('simple string → Text with full quoted text', () => {
    const tok = lexOne('"hello"') as StringToken;
    expect(tok.tokenType).toBe(TokenType.Text);
    expect(tok.text).toBe('"hello"');
  });

  it('empty string → Text', () => {
    const tok = lexOne('""') as StringToken;
    expect(tok.tokenType).toBe(TokenType.Text);
    expect(tok.text).toBe('""');
  });

  it('string with \\n escape', () => {
    const tok = lexOne('"a\\nb"') as StringToken;
    expect(tok.tokenType).toBe(TokenType.Text);
    expect(tok.text).toBe('"a\\nb"');
  });

  it('string with \\t escape', () => {
    const tok = lexOne('"\\t"') as StringToken;
    expect(tok.tokenType).toBe(TokenType.Text);
    expect(tok.text).toBe('"\\t"');
  });

  it('string with hex escape', () => {
    const tok = lexOne('"\\41"') as StringToken; // \41 = 'A'
    expect(tok.tokenType).toBe(TokenType.Text);
    expect(tok.text).toBe('"\\41"');
  });

  it('string with unicode escape', () => {
    const tok = lexOne('"\\u{41}"') as StringToken;
    expect(tok.tokenType).toBe(TokenType.Text);
    expect(tok.text).toBe('"\\u{41}"');
  });

  it('$"named" var string → Var', () => {
    const tok = lexOne('$"name"') as StringToken;
    expect(tok.tokenType).toBe(TokenType.Var);
  });
});

// ---------------------------------------------------------------------------
// Numeric literals
// ---------------------------------------------------------------------------

describe('WastLexer — numeric literals', () => {
  it('unsigned integer → Nat with Int literalType', () => {
    const tok = lexOne('42') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Nat);
    expect(tok.literal.literalType).toBe(LiteralType.Int);
    expect(tok.literal.text).toBe('42');
  });

  it('positive signed integer → Int with Int literalType', () => {
    const tok = lexOne('+42') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Int);
    expect(tok.literal.literalType).toBe(LiteralType.Int);
    expect(tok.literal.text).toBe('+42');
  });

  it('negative signed integer → Int', () => {
    const tok = lexOne('-1') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Int);
    expect(tok.literal.text).toBe('-1');
  });

  it('hex unsigned → Nat with Int literalType', () => {
    const tok = lexOne('0xff') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Nat);
    expect(tok.literal.literalType).toBe(LiteralType.Int);
    expect(tok.literal.text).toBe('0xff');
  });

  it('hex signed → Int with Int literalType', () => {
    const tok = lexOne('-0x10') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Int);
    expect(tok.literal.literalType).toBe(LiteralType.Int);
    expect(tok.literal.text).toBe('-0x10');
  });

  it('decimal float → Float with Float literalType', () => {
    const tok = lexOne('3.14') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Float);
    expect(tok.literal.literalType).toBe(LiteralType.Float);
    expect(tok.literal.text).toBe('3.14');
  });

  it('float with exponent → Float', () => {
    const tok = lexOne('1e10') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Float);
    expect(tok.literal.literalType).toBe(LiteralType.Float);
    expect(tok.literal.text).toBe('1e10');
  });

  it('hex float → Float with Hexfloat literalType', () => {
    const tok = lexOne('0x1.8p+1') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Float);
    expect(tok.literal.literalType).toBe(LiteralType.Hexfloat);
    expect(tok.literal.text).toBe('0x1.8p+1');
  });

  it('inf → Float with Infinity literalType', () => {
    const tok = lexOne('inf') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Float);
    expect(tok.literal.literalType).toBe(LiteralType.Infinity);
    expect(tok.literal.text).toBe('inf');
  });

  it('+inf → Float with Infinity', () => {
    const tok = lexOne('+inf') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Float);
    expect(tok.literal.literalType).toBe(LiteralType.Infinity);
  });

  it('-inf → Float with Infinity', () => {
    const tok = lexOne('-inf') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Float);
    expect(tok.literal.literalType).toBe(LiteralType.Infinity);
  });

  it('nan → Float with Nan literalType', () => {
    const tok = lexOne('nan') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Float);
    expect(tok.literal.literalType).toBe(LiteralType.Nan);
    expect(tok.literal.text).toBe('nan');
  });

  it('nan:0x1 → Float with Nan literalType', () => {
    const tok = lexOne('nan:0x1') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Float);
    expect(tok.literal.literalType).toBe(LiteralType.Nan);
    expect(tok.literal.text).toBe('nan:0x1');
  });

  it('underscore separator in integer', () => {
    const tok = lexOne('1_000') as LiteralToken;
    expect(tok.tokenType).toBe(TokenType.Nat);
    expect(tok.literal.text).toBe('1_000');
  });
});

// ---------------------------------------------------------------------------
// align= and offset= tokens
// ---------------------------------------------------------------------------

describe('WastLexer — align= and offset=', () => {
  it('align=4 → AlignEqNat with text "4"', () => {
    const tok = lexOne('align=4') as StringToken;
    expect(tok.tokenType).toBe(TokenType.AlignEqNat);
    expect(tok.text).toBe('4');
  });

  it('align=0x10 → AlignEqNat with hex text', () => {
    const tok = lexOne('align=0x10') as StringToken;
    expect(tok.tokenType).toBe(TokenType.AlignEqNat);
    expect(tok.text).toBe('0x10');
  });

  it('offset=100 → OffsetEqNat with text "100"', () => {
    const tok = lexOne('offset=100') as StringToken;
    expect(tok.tokenType).toBe(TokenType.OffsetEqNat);
    expect(tok.text).toBe('100');
  });

  it('offset=0xff → OffsetEqNat with hex text', () => {
    const tok = lexOne('offset=0xff') as StringToken;
    expect(tok.tokenType).toBe(TokenType.OffsetEqNat);
    expect(tok.text).toBe('0xff');
  });

  it('align without = falls back to keyword', () => {
    // 'align' alone is not a bare keyword — treated as Reserved
    const tok = lexOne('align');
    expect(tok.tokenType).toBe(TokenType.Reserved);
  });
});

// ---------------------------------------------------------------------------
// LparAnn annotation token
// ---------------------------------------------------------------------------

describe('WastLexer — annotation', () => {
  // BEHAVIOUR CHANGE (T6.5): the lexer used to emit an `LparAnn` token for
  // `(@id` and then keep lexing the body as ordinary tokens. Annotation
  // bodies are deliberately hostile — arbitrary reserved characters, nested
  // parens and annotations, strings containing parens, and comments
  // containing parens — so that always failed on the first `,` with
  // "unexpected char", and nothing consumed the annotation.
  //
  // The spec makes annotations TRANSPARENT: a tool that does not understand
  // one skips it. wabt-ts has no annotation consumer, so the lexer now skips
  // the whole annotation at the character level and emits NO tokens for it.
  // If a consumer is ever added, the right shape is one token carrying the
  // annotation's full source, not a re-tokenised body.
  it('an annotation produces no tokens at all', () => {
    const toks = lexTypes('(@name)').filter((t) => t !== TokenType.Eof);
    expect(toks.length).toBe(0);
  });

  it('surrounding tokens still lex', () => {
    const toks = lexTypes('(module (@producers "x") )').filter((t) => t !== TokenType.Eof);
    expect(toks).toEqual([TokenType.Lpar, TokenType.Module, TokenType.Rpar]);
  });

  it('a hostile body does not derail the lexer', () => {
    // Reserved chars, nested parens/annotations, a string holding a paren,
    // and comments holding parens — every one of which broke the old path.
    const src = '(module (@a , ; ] [ }} ({) ")" (@x) (; ) ;) ;; bla)\n) )';
    const toks = lexTypes(src).filter((t) => t !== TokenType.Eof);
    expect(toks).toEqual([TokenType.Lpar, TokenType.Module, TokenType.Rpar]);
  });
});

// ---------------------------------------------------------------------------
// nan:canonical / nan:arithmetic bare tokens
// ---------------------------------------------------------------------------

describe('WastLexer — nan keywords', () => {
  it('nan:canonical → NanCanonical bare token', () => {
    expect(lexOne('nan:canonical').tokenType).toBe(TokenType.NanCanonical);
  });

  it('nan:arithmetic → NanArithmetic bare token', () => {
    expect(lexOne('nan:arithmetic').tokenType).toBe(TokenType.NanArithmetic);
  });
});

// ---------------------------------------------------------------------------
// Reserved / unknown tokens
// ---------------------------------------------------------------------------

describe('WastLexer — reserved', () => {
  it('unknown keyword → Reserved', () => {
    const tok = lexOne('totally_unknown_keyword') as StringToken;
    expect(tok.tokenType).toBe(TokenType.Reserved);
  });

  it('i32.unknown_op → Reserved', () => {
    const tok = lexOne('i32.unknown_op') as StringToken;
    expect(tok.tokenType).toBe(TokenType.Reserved);
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('WastLexer — errors', () => {
  it('bad string escape → Invalid token with error', () => {
    const lexer = new WastLexer('"\\z"');
    const toks = lexer.tokenize();
    expect(toks[0]?.tokenType).toBe(TokenType.Invalid);
    expect(lexer.errors.length).toBeGreaterThan(0);
  });

  it('unclosed block comment → error', () => {
    const lexer = new WastLexer('(; unclosed');
    lexer.tokenize();
    expect(lexer.errors.length).toBeGreaterThan(0);
  });

  it('newline inside string → Invalid with error', () => {
    const lexer = new WastLexer('"a\nb"');
    const toks = lexer.tokenize();
    expect(toks[0]?.tokenType).toBe(TokenType.Invalid);
    expect(lexer.errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Full WAT snippet
// ---------------------------------------------------------------------------

describe('WastLexer — full WAT snippet', () => {
  it('tokenizes a simple module', () => {
    const src = '(module (func $add (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))';
    const types = lexTypes(src);
    expect(types[0]).toBe(TokenType.Lpar);
    expect(types[1]).toBe(TokenType.Module);
    expect(types.at(-1)).toBe(TokenType.Eof);
    expect(types.includes(TokenType.Func)).toBe(true);
    expect(types.includes(TokenType.Param)).toBe(true);
    expect(types.includes(TokenType.Result)).toBe(true);
  });

  it('tokenizes assert_return invoke snippet', () => {
    const src = '(assert_return (invoke "add" (i32.const 1) (i32.const 2)) (i32.const 3))';
    const types = lexTypes(src);
    expect(types.includes(TokenType.AssertReturn)).toBe(true);
    expect(types.includes(TokenType.Invoke)).toBe(true);
    expect(types.includes(TokenType.Const)).toBe(true);
  });
});
