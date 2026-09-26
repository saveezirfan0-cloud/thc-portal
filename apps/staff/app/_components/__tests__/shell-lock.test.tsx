import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffProfile } from '../../profile/types';

/**
 * `StaffShell` and the profile it locks on.
 *
 * Audit D16: a `staff_me()` error came back as a null profile, and a null
 * profile meant "nothing to lock on" — so on any timeout a held, a
 * quiz-failed or an auto-blocked worker got all four tabs and their shifts.
 * It now fails CLOSED: no tabs, no content, no avatar, a retry.
 *
 * And §10.1's square selfie is the header avatar, signed with the worker's
 * own session (item 8).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

type Read =
  | { kind: 'unconfigured' }
  | { kind: 'ok'; profile: StaffProfile }
  | { kind: 'problem'; message: string };
const read = vi.fn<() => Promise<Read>>();
vi.mock('../../profile/data', () => ({ readProfile: () => read() }));
const sign = vi.fn<(path: string | null) => Promise<string | null>>();
vi.mock('../../profile/photos', () => ({ signOwnPhoto: (p: string | null) => sign(p) }));

const { StaffShell } = await import('../StaffShell');

const worker = (over: Partial<StaffProfile> = {}): StaffProfile => ({
  staffId: 's1',
  firstName: 'Tom',
  lastName: 'Reid',
  employeeId: 1001,
  email: 'tom@example.test',
  phone: '+447700900123',
  homeAddress: null,
  photoPath: 's1/selfie-1.jpg',
  photoLocked: true,
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

async function render(ignoreLock = false): Promise<string> {
  const element = await StaffShell({
    title: 'Shifts',
    active: '/shifts',
    ignoreLock,
    children: <span data-testid="content">My shifts</span>,
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  read.mockReset();
  sign.mockReset();
  sign.mockResolvedValue(null);
});

describe('audit D16 · a failed profile read locks, it does not unlock', () => {
  it('shows the retry and nothing else: no tabs, no content, no avatar', async () => {
    read.mockResolvedValue({ kind: 'problem', message: 'timeout' });
    const html = await render();
    expect(html).toContain('We couldn’t load your account — pull to refresh or try again.');
    expect(html).toContain('Try again');
    expect(html).not.toContain('My shifts');
    expect(html).not.toContain('bottom-nav');
    expect(html).not.toContain('href="/shifts"');
    expect(html).not.toContain('href="/profile"');
  });

  it('keeps a lock-free screen’s own content, still without the tabs', async () => {
    read.mockResolvedValue({ kind: 'problem', message: 'timeout' });
    const html = await render(true);
    expect(html).toContain('My shifts');
    expect(html).not.toContain('bottom-nav');
  });

  it('runs unlocked only where no project is configured at all (docs/04)', async () => {
    read.mockResolvedValue({ kind: 'unconfigured' });
    const html = await render();
    expect(html).toContain('My shifts');
    expect(html).toContain('bottom-nav');
  });

  it('still applies the lock from a profile that was read', async () => {
    read.mockResolvedValue({
      kind: 'ok',
      profile: worker({ status: 'blocked', blockKind: 'manual' }),
    });
    const html = await render();
    expect(html).toContain('Your account is on hold.');
    expect(html).not.toContain('My shifts');
  });
});

describe('the header avatar is the worker’s selfie (§10.1)', () => {
  it('signs the worker’s own photo path and shows it', async () => {
    read.mockResolvedValue({ kind: 'ok', profile: worker() });
    sign.mockResolvedValue(
      'https://example.supabase.co/storage/v1/object/sign/photos/s1/x?token=t',
    );
    const html = await render();
    expect(sign).toHaveBeenCalledWith('s1/selfie-1.jpg');
    expect(html).toContain(
      'src="https://example.supabase.co/storage/v1/object/sign/photos/s1/x?token=t"',
    );
  });

  it('falls back to initials when there is no photo or it cannot be signed', async () => {
    read.mockResolvedValue({ kind: 'ok', profile: worker({ photoPath: null }) });
    const html = await render();
    expect(html).toContain('>TR<');
  });
});
