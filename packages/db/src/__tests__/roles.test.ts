import { describe, expect, it } from 'vitest';
import { wrongAppBody } from '../roles';

/**
 * The wrong-app page is a dead end by construction: the reader holds a
 * session the app will not admit, so the only thing on it that can help is
 * the sign-out control. These assert it actually works.
 */
describe('wrongAppBody', () => {
  it('signs out by POST, never by link', () => {
    const html = wrongAppBody('client', 'Staff App');

    // `/auth/signout` answers POST only. A link here returns 405 — which is
    // exactly what shipped, and left the page with no working way out.
    expect(html).toContain('<form method="post" action="/auth/signout">');
    expect(html).not.toMatch(/<a[^>]+href="\/auth\/signout"/);
  });

  it('names the app that refused the session, and the role that was held', () => {
    const html = wrongAppBody('client', 'Staff App');
    expect(html).toContain('Staff App');
    expect(html).toContain('Client Portal');
  });

  it('still offers the way out when the session carries no role at all', () => {
    const html = wrongAppBody(null, 'Back Office');
    expect(html).toContain('no role set');
    expect(html).toContain('action="/auth/signout"');
  });
});
