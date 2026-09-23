import { describe, expect, it } from 'vitest';
import { activationLink, isActivationToken, parseActivationType } from '../activation';

/** 56 hex characters: what GoTrue's generateLink returns as hashed_token. */
const TOKEN = 'a1'.repeat(28);

describe('the personal activation link (§2.7, E3)', () => {
  it('is the wireframe path /activate/:token for an invite', () => {
    expect(activationLink('https://app.thc.example', TOKEN, 'invite')).toBe(
      `https://app.thc.example/activate/${TOKEN}`,
    );
  });

  it('names the token type only when it is a magic link', () => {
    expect(activationLink('https://app.thc.example', TOKEN, 'magiclink')).toBe(
      `https://app.thc.example/activate/${TOKEN}?type=magiclink`,
    );
  });

  it('tolerates a trailing slash on the configured origin', () => {
    expect(activationLink('http://127.0.0.1:3001/', TOKEN, 'invite')).toBe(
      `http://127.0.0.1:3001/activate/${TOKEN}`,
    );
  });

  it('refuses to build a link that could not work', () => {
    expect(() => activationLink('https://app.thc.example', '', 'invite')).toThrow();
    expect(() => activationLink('https://app.thc.example', 'abc', 'invite')).toThrow();
    expect(() => activationLink('https://app.thc.example', `${TOKEN}/../x`, 'invite')).toThrow();
    expect(() =>
      activationLink('https://app.thc.example', `${TOKEN}?next=//evil`, 'invite'),
    ).toThrow();
    expect(() => activationLink('app.thc.example', TOKEN, 'invite')).toThrow();
    expect(() => activationLink('https://app.thc.example/staff', TOKEN, 'invite')).toThrow();
  });

  it('reads a token and a type back the same way', () => {
    expect(isActivationToken(TOKEN)).toBe(true);
    expect(isActivationToken('')).toBe(false);
    expect(isActivationToken(undefined)).toBe(false);
    expect(parseActivationType('magiclink')).toBe('magiclink');
    expect(parseActivationType(undefined)).toBe('invite');
    expect(parseActivationType('recovery')).toBe('invite');
    expect(parseActivationType(['magiclink'])).toBe('invite');
  });
});
