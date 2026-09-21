import { describe, expect, it } from 'vitest';
import { TEMPLATES, outboxKey, render, template } from '../templates';

describe('notification register (§8)', () => {
  it('keys every template by its register code', () => {
    for (const [key, value] of Object.entries(TEMPLATES)) {
      expect(value.code).toBe(key);
    }
  });

  it('sends emails from a named sender (§9.12)', () => {
    for (const value of Object.values(TEMPLATES)) {
      if (value.channel === 'email') expect(value.sender).toBeDefined();
    }
  });

  it('builds a stable idempotency key', () => {
    expect(outboxKey('N9', 'booking', 41)).toBe('N9:booking:41');
  });

  it('renders placeholders and leaves unknown ones alone', () => {
    expect(render(template('N8').body, { reason: 'Expired' })).toBe('Document rejected — Expired');
    expect(render('Hi {who}', {})).toBe('Hi {who}');
  });
});
