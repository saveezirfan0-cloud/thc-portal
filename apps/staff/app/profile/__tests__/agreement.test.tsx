import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_VERSION_CLAUSE_28_PENDING } from '@thc/domain';
import type { SignedContract, StaffProfile } from '../types';
import type * as ProfileData from '../data';

/**
 * /profile/agreement — ADR-0083.
 *
 * 10/11 promises "A copy of the signed agreement is kept on your profile".
 * What this pins: the copy is the text signed, with its clause headings and
 * its UK-time signature stamp; a leaver keeps it; a candidate is sent back;
 * and a read that failed says so rather than "No signed agreement" (D18).
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/profile/agreement',
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('../photos', () => ({ signOwnPhoto: async () => null }));

const worker = (over: Partial<StaffProfile> = {}): StaffProfile => ({
  staffId: 'staff-1',
  firstName: 'Amara',
  lastName: 'Kalu',
  employeeId: 417,
  email: 'amara@example.test',
  phone: '+447700900123',
  homeAddress: null,
  photoPath: null,
  photoLocked: true,
  status: 'compliant',
  blockKind: null,
  leftAt: null,
  rtwBranch: 'uk_irish',
  niMasked: null,
  hasNiNumber: true,
  rating: null,
  reliability: null,
  quizAttempts: 1,
  roles: ['Waiting Staff'],
  blockers: [],
  checkedIn: false,
  bank: null,
  ...over,
});

const SIGNED: SignedContract = {
  version: 'thc-agency-worker-2026-09',
  title: 'Agency Worker Contract for Services — The Hospitality Company (London) Limited',
  body:
    '9. HOLIDAYS.\n\n' +
    '9.1 The Temporary Worker is entitled to paid holiday which shall accrue at the rate of 12.07% of hours worked.',
  isPlaceholder: false,
  signedStamp: '18.09.2026 14:42 UK time',
};

const state = vi.hoisted(() => ({
  profile: null as StaffProfile | null,
  contract: { row: null, problem: null } as { row: unknown; problem: string | null },
}));

vi.mock('../data', async (importOriginal) => {
  const real = await importOriginal<typeof ProfileData>();
  return {
    ...real,
    supabaseConfigured: () => true,
    loadProfile: async () => state.profile,
    loadMyContract: async () => state.contract,
  };
});

const { default: Page } = await import('../agreement/page');
const { toSignedContract } = await import('../data');

async function render(): Promise<string> {
  return renderToStaticMarkup((await Page()) as ReactElement);
}

beforeEach(() => {
  state.profile = worker();
  state.contract = { row: SIGNED, problem: null };
});

describe('/profile/agreement (ADR-0083)', () => {
  it('shows the signed text, headings bold, under its UK-time signature stamp', async () => {
    const html = await render();
    expect(html).toContain('Signed agreement');
    expect(html).toContain(
      'Signed electronically · 18.09.2026 14:42 UK time — this timestamp is your signature',
    );
    expect(html).toContain('<b>9. HOLIDAYS.</b>');
    // The holiday terms in the contract's own words — not restated by the app.
    expect(html).toContain('accrue at the rate of 12.07% of hours worked');
    expect(html).toContain('class="contract full"');
    expect(html).toContain('this copy does not change');
    expect(html).not.toContain('awaiting THC’s approval');
  });

  it('says so when the version signed is still a placeholder', async () => {
    state.contract = {
      row: { ...SIGNED, version: CONTRACT_VERSION_CLAUSE_28_PENDING, isPlaceholder: true },
      problem: null,
    };
    expect(await render()).toContain(
      'Clause 28, the duty to disclose convictions, is awaiting THC’s approval.',
    );
  });

  it('keeps it for a leaver (§10.6 step 7)', async () => {
    state.profile = worker({ status: 'inactive', leftAt: '2026-09-30' });
    expect(await render()).toContain('<b>9. HOLIDAYS.</b>');
  });

  it('sends a candidate still in the wizard back to the profile', async () => {
    state.profile = worker({ status: 'documents', employeeId: null });
    await expect(render()).rejects.toThrow('NEXT_REDIRECT /profile');
  });

  it('a failed read is a load problem, never "No signed agreement" (D18)', async () => {
    state.contract = { row: null, problem: 'canceling statement due to timeout' };
    const html = await render();
    expect(html).toContain('We couldn’t load your agreement');
    expect(html).not.toContain('No signed agreement');
    expect(html).not.toContain('timeout');
  });

  it('nothing signed is the empty state', async () => {
    state.contract = { row: null, problem: null };
    expect(await render()).toContain('No signed agreement');
  });
});

describe('toSignedContract — my_contract() in the screen’s shape', () => {
  it('maps the RPC’s keys', () => {
    expect(
      toSignedContract({
        version: 'v1',
        title: 'T',
        body: '1. Status. Zero hours.',
        isPlaceholder: true,
        signedAt: '2026-09-18T13:42:00+00:00',
        signedStamp: '18.09.2026 14:42 UK time',
      }),
    ).toEqual({
      version: 'v1',
      title: 'T',
      body: '1. Status. Zero hours.',
      isPlaceholder: true,
      signedStamp: '18.09.2026 14:42 UK time',
    });
  });

  it('is null before signing, and for anything without a version or text', () => {
    expect(toSignedContract(null)).toBeNull();
    expect(toSignedContract({ version: 'v1', body: '' })).toBeNull();
    expect(toSignedContract('nope')).toBeNull();
  });
});
