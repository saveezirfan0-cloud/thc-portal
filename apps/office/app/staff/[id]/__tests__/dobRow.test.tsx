import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProfileRow } from '../types';

/**
 * ADR-0069 — the Date of birth row in the Overview's "Contacts & identity"
 * card gains "Correct" for an owner or a manager, and for nobody on a
 * removed profile. The dialog and the action are held in
 * _components/__tests__/dob-correction.test.tsx.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../actions', () => ({ saveEmergencyContact: vi.fn(), clearEmergencyContact: vi.fn() }));
vi.mock('../../../_lib/dobCorrectionActions', () => ({ correctDob: vi.fn() }));

const { Overview } = await import('../Overview');

const PROFILE = {
  id: 's1',
  display_name: 'Amara Kalu',
  status: 'compliant',
  removed: false,
  dob: '1995-01-01',
  joined_at: '2026-01-10T10:00:00Z',
  term_dates: [],
  wtr_optout: false,
} as unknown as ProfileRow;

const render = (profile: ProfileRow, canCorrectDob: boolean) =>
  renderToStaticMarkup(
    <Overview profile={profile} references={[]} declarations={[]} canCorrectDob={canCorrectDob} />,
  );

describe('Overview · Date of birth (ADR-0069)', () => {
  it('shows the date with Correct to an owner or a manager', () => {
    const html = render(PROFILE, true);
    expect(html).toContain('01.01.1995');
    expect(html).toContain('>Correct<');
  });

  it('shows the date alone to a scheduler or a viewer', () => {
    const html = render(PROFILE, false);
    expect(html).toContain('01.01.1995');
    expect(html).not.toContain('>Correct<');
  });

  it('offers nothing on a removed profile (§1.7)', () => {
    const html = render({ ...PROFILE, removed: true, dob: null } as ProfileRow, true);
    expect(html).not.toContain('>Correct<');
  });
});
