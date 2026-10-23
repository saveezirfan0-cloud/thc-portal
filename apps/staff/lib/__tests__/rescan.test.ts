import { describe, expect, it } from 'vitest';
import { checkRescanSecret } from '../rescan';

const SECRET = 'a'.repeat(40);

describe('the rescan route gate', () => {
  it('refuses everything while the secret is missing or short', () => {
    expect(checkRescanSecret(`Bearer ${SECRET}`, undefined)).toBe('not_configured');
    expect(checkRescanSecret('Bearer short', 'short')).toBe('not_configured');
  });

  it('accepts only the exact bearer secret', () => {
    expect(checkRescanSecret(`Bearer ${SECRET}`, SECRET)).toBe('ok');
    expect(checkRescanSecret(`Bearer ${SECRET}x`, SECRET)).toBe('unauthorised');
    expect(checkRescanSecret(SECRET, SECRET)).toBe('unauthorised');
    expect(checkRescanSecret(null, SECRET)).toBe('unauthorised');
  });
});
