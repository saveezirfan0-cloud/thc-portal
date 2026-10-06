import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * ADR-0094 · the Willo interview link stays on the staff profile.
 *
 *   · a worker with a Willo handle keeps "Review interview on Willo ↗" on
 *     the Overview after onboarding, opening in a new tab;
 *   · no link (no handle, Willo not configured, or removed under §1.7)
 *     reads "No interview link on file", never a dead anchor.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@thc/db/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc: vi.fn() }) }));
vi.mock('../../data', () => ({ supabaseConfigured: () => true }));

const { Overview } = await import('../Overview');

const profile = {
  id: 'st-1',
  display_name: 'Sam Test',
  status: 'compliant',
  removed: false,
  joined_at: '2026-01-05T09:00:00Z',
  term_dates: null,
  weekly_cap_band: null,
  weekly_cap_hours: null,
  weekly_cap_until: null,
} as unknown as Parameters<typeof Overview>[0]['profile'];

const render = (willoReviewUrl: string | null | undefined, removed = false) =>
  renderToStaticMarkup(
    <Overview
      profile={{ ...profile, removed }}
      references={[]}
      declarations={[]}
      willoReviewUrl={willoReviewUrl}
    />,
  );

describe('the Interview row (ADR-0094)', () => {
  it('keeps the link for a working member of staff', () => {
    const html = render('https://app.willo.video/review/abc');
    expect(html).toContain('href="https://app.willo.video/review/abc"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('Review interview on Willo ↗');
  });

  it.each([null, undefined])('no link (%s) reads as not on file', (url) => {
    const html = render(url);
    expect(html).toContain('No interview link on file');
    expect(html).not.toContain('Review interview on Willo');
  });

  it('a removed profile has none (§1.7 nulls the handle)', () => {
    expect(render(null, true)).toContain('No interview link on file');
  });
});
