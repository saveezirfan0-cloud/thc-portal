import { describe, expect, it } from 'vitest';
import { config } from '../../middleware';

/**
 * The session gate's matcher (audit D52): static files are skipped only
 * where public/ serves them (the top level and public/icons/, the push
 * badge) and the service worker's own files. A nested page path that merely
 * ends in an image extension must pass the gate.
 */
describe('middleware matcher', () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it('skips the public files, the service worker and Next.js assets', () => {
    for (const skipped of [
      '/favicon.ico',
      '/icon-192.png',
      '/apple-touch-icon.png',
      '/icons/badge-96.png',
      '/manifest.webmanifest',
      '/sw.js',
      '/swe-worker-abc123.js',
      '/workbox-4f2e.js',
      '/_next/static/x.js',
    ]) {
      expect(matcher.test(skipped), skipped).toBe(false);
    }
  });

  it('gates a nested page path that merely ends in an image extension', () => {
    for (const gated of [
      '/shifts/x.png',
      '/shifts/1/photo.jpg',
      '/icons/nested/x.png',
      '/profile',
      '/sw.jsx',
      '/',
    ]) {
      expect(matcher.test(gated), gated).toBe(true);
    }
  });
});
