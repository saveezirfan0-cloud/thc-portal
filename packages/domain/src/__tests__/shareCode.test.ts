import { describe, expect, it } from 'vitest';
import {
  SHARE_CODE_PATTERN,
  SHARE_CODE_SQL_PATTERN,
  formatShareCode,
  isValidShareCode,
  normaliseShareCode,
  shareCodeError,
} from '../shareCode';

describe('share code (§2.5, corrected 31.07.2026)', () => {
  it('accepts the scope’s own example, letters AND numbers', () => {
    expect(isValidShareCode('W123AB4CD')).toBe(true);
  });

  it('ignores spaces — pasted as three groups of three', () => {
    expect(isValidShareCode('W12 3AB 4CD')).toBe(true);
    expect(isValidShareCode('  W12  3AB 4CD ')).toBe(true);
    expect(normaliseShareCode('W12 3AB 4CD')).toBe('W123AB4CD');
  });

  it('is case-insensitive', () => {
    expect(isValidShareCode('w123ab4cd')).toBe(true);
    expect(normaliseShareCode('w12 3ab 4cd')).toBe('W123AB4CD');
  });

  it('is exactly nine characters', () => {
    expect(isValidShareCode('W123AB4C')).toBe(false);
    expect(isValidShareCode('W123AB4CDE')).toBe(false);
    expect(isValidShareCode('W12 3AB')).toBe(false);
  });

  it('starts with W', () => {
    expect(isValidShareCode('A123AB4CD')).toBe(false);
    expect(isValidShareCode('123AB4CDW')).toBe(false);
  });

  it('is alphanumeric only — no dashes or punctuation are forgiven', () => {
    expect(isValidShareCode('W12-3AB-4CD')).toBe(false);
    expect(isValidShareCode('W123AB4C!')).toBe(false);
  });

  it('the earlier "letters only" wording is not the rule', () => {
    expect(isValidShareCode('WABCDEFGH')).toBe(true);
    expect(isValidShareCode('W12345678')).toBe(true);
  });

  it('empty and null are invalid', () => {
    expect(isValidShareCode('')).toBe(false);
    expect(isValidShareCode(null)).toBe(false);
    expect(isValidShareCode(undefined)).toBe(false);
  });

  it('carries the wireframe’s error copy', () => {
    expect(shareCodeError('W12 3AB')).toBe(
      "Share code must be 9 letters and numbers starting with W — e.g. W123AB4CD. Spaces are fine, we'll remove them.",
    );
    expect(shareCodeError('W12 3AB 4CD')).toBeNull();
    expect(shareCodeError('')).toBe('Enter your share code.');
  });

  it('formats as gov.uk prints it', () => {
    expect(formatShareCode('w123ab4cd')).toBe('W12 3AB 4CD');
  });

  it('the SQL spelling is the same pattern', () => {
    expect(SHARE_CODE_PATTERN.source).toBe(SHARE_CODE_SQL_PATTERN);
  });
});
