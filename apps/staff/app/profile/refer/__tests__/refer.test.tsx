import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { referralLink } from '@thc/domain';

/**
 * Refer a friend — ADR-0046, docs/19 §5. The link, Copy, the QR, a count
 * and never a name; no reward copy anywhere (Q19, Q20).
 */
vi.mock('../../../activate/activate.css', () => ({}));

const { ReferScreen } = await import('../ReferScreen');
const { appliedLine, publicOrigin, shareData, INTRO_COPY, EMPTY_COPY } = await import('../model');

const LINK = referralLink('https://app.thehospitalitycompany.co.uk', 'K7M4Q2XP');
const REWARD = /reward|bonus|earn|£|paid|cash|voucher/i;

describe('the screen', () => {
  it('shows the link, Copy link, the QR and the count', () => {
    const html = renderToStaticMarkup(<ReferScreen link={LINK} applied={3} />);
    expect(html).toContain('app.thehospitalitycompany.co.uk/apply?ref=K7M4Q2XP');
    expect(html).toContain('Copy link');
    expect(html).toContain(`aria-label="QR code → ${LINK}"`);
    expect(html).toContain('>3<');
    expect(html).toContain('people have applied with your link');
  });

  it('says "No one yet" before anyone has applied', () => {
    const html = renderToStaticMarkup(<ReferScreen link={LINK} applied={0} />);
    expect(html).toContain('No one yet');
    expect(html).not.toContain('have applied with your link');
  });

  it('promises nothing — no reward copy anywhere (Q19)', () => {
    const html = renderToStaticMarkup(<ReferScreen link={LINK} applied={2} />);
    expect(html).not.toMatch(REWARD);
    for (const copy of [INTRO_COPY, EMPTY_COPY, appliedLine(1), shareData(LINK).text]) {
      expect(copy).not.toMatch(REWARD);
    }
  });
});

describe('the words and the origin', () => {
  it('counts people, singular and plural', () => {
    expect(appliedLine(1)).toBe('1 person has applied with your link');
    expect(appliedLine(3)).toBe('3 people have applied with your link');
  });

  it('builds on the configured staff URL first, then the request, then Vercel, then local', () => {
    expect(
      publicOrigin({ NEXT_PUBLIC_STAFF_URL: 'https://app.thc.test/' }, { host: 'preview.test' }),
    ).toBe('https://app.thc.test');
    expect(publicOrigin({}, { host: 'preview.test', proto: 'https,http' })).toBe(
      'https://preview.test',
    );
    expect(publicOrigin({ VERCEL_URL: 'thc-staff.vercel.app' })).toBe(
      'https://thc-staff.vercel.app',
    );
    expect(publicOrigin({})).toBe('http://127.0.0.1:3001');
  });

  it('in production uses only the configured staff URL, never the request host', () => {
    const forged = { host: 'evil.example', proto: 'https' };
    for (const prod of [{ VERCEL_ENV: 'production' }, { NODE_ENV: 'production' }]) {
      expect(publicOrigin({ ...prod, NEXT_PUBLIC_STAFF_URL: 'https://app.thc.test' }, forged)).toBe(
        'https://app.thc.test',
      );
      // Unset: no link at all rather than one built on a header the caller chose.
      expect(publicOrigin(prod, forged)).toBeNull();
      expect(publicOrigin({ ...prod, VERCEL_URL: 'thc-staff.vercel.app' }, forged)).toBeNull();
      expect(publicOrigin({ ...prod, NEXT_PUBLIC_STAFF_URL: '  ' }, forged)).toBeNull();
    }
  });

  it('falls back to the request host only outside production', () => {
    for (const env of [{ NODE_ENV: 'development' }, { VERCEL_ENV: 'preview', NODE_ENV: 'test' }]) {
      expect(publicOrigin(env, { host: 'localhost:3001', proto: 'http' })).toBe(
        'http://localhost:3001',
      );
    }
  });

  it('shares the link itself', () => {
    expect(shareData(LINK).url).toBe(LINK);
  });
});
