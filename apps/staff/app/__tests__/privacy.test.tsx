import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * D3 (§1.7): the GDPR consent on /apply says "as described in the Privacy
 * notice" and links to /privacy. That route did not exist and was not
 * public, so a logged-out applicant who followed the link landed on
 * /login?next=/privacy in the middle of giving consent.
 */
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

const { middleware } = await import('../../middleware');
const { default: PrivacyPage } = await import('../privacy/page');

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('/privacy is public', () => {
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  });
  afterAll(() => {
    process.env = saved;
  });

  it('serves a logged-out visit instead of redirecting to sign-in', async () => {
    const res = await middleware(new NextRequest('http://127.0.0.1:3001/privacy'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('still sends a logged-out visit to a private page to sign-in (control)', async () => {
    const res = await middleware(new NextRequest('http://127.0.0.1:3001/shifts'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login?next=%2Fshifts');
  });
});

describe('the consent link lands on the notice', () => {
  it('points at the route this page lives on', () => {
    const form = readFileSync(join(APP, 'apply', 'ApplyForm.tsx'), 'utf8');
    expect(form).toContain('href="/privacy"');
    expect(existsSync(join(APP, 'privacy', 'page.tsx'))).toBe(true);
  });

  it('states what §1.7 and ADR-0019 decide', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);
    expect(html).toContain('Deleted account #id');
    expect(html).toContain('admin@thehospitalitycompany.co.uk');
    expect(html).toContain('plus two years after it ends');
    expect(html).toMatch(/18 or over/);
    // Marked as a placeholder for THC's legal text, on the page and in source.
    expect(html).toContain('full legal privacy notice will replace this page');
    const src = readFileSync(join(APP, 'privacy', 'page.tsx'), 'utf8');
    expect(src).toContain("REPLACE WITH THC'S LEGAL TEXT WHEN SUPPLIED");
  });
});
