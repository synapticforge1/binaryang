import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { combineResults, failed, Result, succeeded } from '../../src/core/result.ts';

describe('Result', () => {
  it('Ok = 0', () => assertEquals(Result.Ok, 0));
  it('Error = 1', () => assertEquals(Result.Error, 1));
});

describe('succeeded', () => {
  it('true for Ok', () => assertEquals(succeeded(Result.Ok), true));
  it('false for Error', () => assertEquals(succeeded(Result.Error), false));
});

describe('failed', () => {
  it('false for Ok', () => assertEquals(failed(Result.Ok), false));
  it('true for Error', () => assertEquals(failed(Result.Error), true));
});

describe('combineResults', () => {
  it('Ok | Ok = Ok', () => assertEquals(combineResults(Result.Ok, Result.Ok), Result.Ok));
  it('Ok | Error = Error', () =>
    assertEquals(combineResults(Result.Ok, Result.Error), Result.Error));
  it('Error | Ok = Error', () =>
    assertEquals(combineResults(Result.Error, Result.Ok), Result.Error));
  it('Error | Error = Error', () =>
    assertEquals(combineResults(Result.Error, Result.Error), Result.Error));
});
