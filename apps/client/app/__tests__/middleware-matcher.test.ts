import { describe, expect, it } from 'vitest';
import { config } from '../../middleware';

/**
 * The session gate's matcher (audit D52): static files are skipped only at
 * the top level, where public/ serves them. A nested path that merely ends
 * in an image extension is a page route and must pass the gate.
 */
describe('middleware matcher', () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it('skips the top-level public files and Next.js assets', () => {
    for (const skipped of ['/favicon.ico', '/logo.png', '/_next/static/x.js', '/_next/image']) {
      expect(matcher.test(skipped), skipped).toBe(false);
    }
  });

  it('gates a nested path that merely ends in an image extension', () => {
    for (const gated of ['/client/x.png', '/client', '/client/events/1/photo.jpg', '/']) {
      expect(matcher.test(gated), gated).toBe(true);
    }
  });
});
