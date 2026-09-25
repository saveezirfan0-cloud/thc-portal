import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffProfile } from '../../profile/types';

/**
 * §10.1: the onboarding selfie "becomes their photo across the whole system
 * (falling back to initials)" — the collapsing header's avatar included,
 * on every tab, not only on /profile. The shell signs the worker's own
 * photo path through `signOwnPhoto` (the worker's session, ten minutes)
 * and hands the URL to the chrome; with no photo the avatar is initials.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const profile = vi.fn<() => Promise<StaffProfile | null>>();
vi.mock('../../profile/data', () => ({ loadProfile: () => profile() }));

const sign = vi.fn<(path: string | null) => Promise<string | null>>();
vi.mock('../../profile/photos', () => ({ signOwnPhoto: (path: string | null) => sign(path) }));

const { StaffShell } = await import('../StaffShell');

const worker = (over: Partial<StaffProfile> = {}): StaffProfile => ({
  staffId: 's1',
  firstName: 'Amara',
  lastName: 'Kalu',
  employeeId: 417,
  email: 'amara@example.test',
  phone: '+447700900123',
  homeAddress: null,
  photoPath: null,
  photoLocked: false,
  status: 'compliant',
  blockKind: null,
  leftAt: null,
  rtwBranch: 'uk_irish',
  niMasked: null,
  hasNiNumber: false,
  rating: null,
  reliability: null,
  quizAttempts: 0,
  roles: ['Waiting Staff'],
  blockers: [],
  checkedIn: false,
  bank: null,
  ...over,
});

async function render(): Promise<string> {
  return renderToStaticMarkup(
    await StaffShell({ title: 'Shifts', active: '/shifts', children: <span /> }),
  );
}

beforeEach(() => {
  profile.mockReset();
  sign.mockReset();
});

describe('the header avatar (§10.1)', () => {
  it('shows the selfie when the worker has one, signed once from the shell', async () => {
    profile.mockResolvedValue(worker({ photoPath: 's1/selfie-1.jpg', photoLocked: true }));
    sign.mockResolvedValue('https://storage.example/sign/s1/selfie-1.jpg?token=t');

    const html = await render();
    expect(sign).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledWith('s1/selfie-1.jpg');
    expect(html).toContain(
      '<img src="https://storage.example/sign/s1/selfie-1.jpg?token=t" alt="Amara Kalu"',
    );
    expect(html).toContain('aria-label="Your profile"');
  });

  it('falls back to initials when there is no photo', async () => {
    profile.mockResolvedValue(worker());
    sign.mockResolvedValue(null);

    const html = await render();
    expect(sign).toHaveBeenCalledWith(null);
    expect(html).not.toContain('<img');
    expect(html).toMatch(/class="avatar photo"[^>]*>AK</);
  });

  it('falls back to initials when Storage declines to sign', async () => {
    profile.mockResolvedValue(worker({ photoPath: 's1/selfie-1.jpg' }));
    sign.mockResolvedValue(null);

    const html = await render();
    expect(html).not.toContain('<img');
    expect(html).toContain('AK');
  });

  it('with no profile row there is no avatar to draw', async () => {
    profile.mockResolvedValue(null);
    sign.mockResolvedValue(null);

    const html = await render();
    expect(html).not.toContain('aria-label="Your profile"');
  });
});
