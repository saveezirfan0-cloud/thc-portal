import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffProfile } from '../types';

/**
 * Audit D18 on the docs/19 additions under Profile: a read that FAILED is
 * the load-problem state for its section (`<LoadProblem>`, or its words on
 * a hub row), never the section's empty state —
 *
 *   /profile/details           the emergency contact, the change requests
 *   /profile/details/request   the change requests
 *   /profile/availability      the calendar
 *   /profile/refer             the link, the count
 *   /profile                   next pay, a document expiring, the
 *                              emergency-contact nudge
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
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
  headers: async () => new Headers({ host: 'staff.example.test', 'x-forwarded-proto': 'https' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc: vi.fn() }) }));
vi.mock('@thc/db/admin', () => ({ createAdminClient: () => ({ rpc: vi.fn() }) }));
vi.mock('../../../activate/activate.css', () => ({}));
vi.mock('../photos', () => ({ signOwnPhoto: async () => null }));

const TIMEOUT = 'canceling statement due to timeout';

const worker: StaffProfile = {
  staffId: 'staff-1',
  firstName: 'Amara',
  lastName: 'Kalu',
  employeeId: 417,
  email: 'amara@example.test',
  phone: '+447700900123',
  homeAddress: null,
  photoPath: 'staff-1/selfie-1.jpg',
  photoLocked: true,
  status: 'compliant',
  blockKind: null,
  leftAt: null,
  rtwBranch: 'uk_irish',
  niMasked: '●●●●●●●2B',
  hasNiNumber: true,
  rating: null,
  reliability: null,
  quizAttempts: 1,
  roles: ['Waiting Staff'],
  blockers: [],
  checkedIn: false,
  bank: null,
};

const reads = vi.hoisted(() => ({
  contact: { row: null, problem: null } as { row: null; problem: string | null },
  requests: { rows: [], problem: null } as { rows: never[]; problem: string | null },
  availability: { rows: [], problem: null } as { rows: never[]; problem: string | null },
  referral: {
    code: { row: 'K7M4Q2XP', problem: null },
    applied: { row: 0, problem: null },
  } as {
    code: { row: string | null; problem: string | null };
    applied: { row: number | null; problem: string | null };
  },
  earningsFail: false,
  documentsFail: false,
}));

vi.mock('../data', () => ({
  supabaseConfigured: () => true,
  loadProfile: async () => worker,
  readProfile: async () => ({ kind: 'ok', profile: worker }),
  loadEmergencyContact: async () => reads.contact,
  loadChangeRequests: async () => reads.requests,
  loadEarnings: async () => {
    if (reads.earningsFail) throw new Error(TIMEOUT);
    return [];
  },
}));
vi.mock('../availability/data', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadUnavailability: async () => reads.availability,
}));
vi.mock('../refer/data', () => ({ loadReferral: async () => reads.referral }));
vi.mock('../../data', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadBookings: async () => ({ rows: [], problem: null }),
}));
vi.mock('../../documents/data', () => ({
  loadDocuments: async () =>
    reads.documentsFail ? null : { today: '2026-09-25', documents: [], termLetterApplies: false },
}));

const { default: DetailsPage } = await import('../details/page');
const { default: RequestPage } = await import('../details/request/page');
const { default: AvailabilityPage } = await import('../availability/page');
const { default: ReferPage } = await import('../refer/page');
const { default: ProfilePage } = await import('../page');

const html = async (page: Promise<unknown>) => renderToStaticMarkup((await page) as ReactElement);
const PROBLEM = 'data-load-problem';

beforeEach(() => {
  reads.contact = { row: null, problem: null };
  reads.requests = { rows: [], problem: null };
  reads.availability = { rows: [], problem: null };
  reads.referral = { code: { row: 'K7M4Q2XP', problem: null }, applied: { row: 0, problem: null } };
  reads.earningsFail = false;
  reads.documentsFail = false;
});

describe('/profile/details', () => {
  it('a failed emergency-contact read is the load-problem state, not an empty form', async () => {
    reads.contact = { row: null, problem: TIMEOUT };
    const page = await html(DetailsPage());
    expect(page).toContain('We couldn’t load your emergency contact');
    expect(page).not.toContain('Not set');
  });

  it('with the read answered and nothing saved, the section says "Not set"', async () => {
    const page = await html(DetailsPage());
    expect(page).toContain('Not set');
    expect(page).not.toContain(PROBLEM);
  });

  it('a failed change-request read hides "Request a change" and says it could not load', async () => {
    reads.requests = { rows: [], problem: TIMEOUT };
    const page = await html(DetailsPage());
    expect(page).toContain('We couldn’t load your change requests');
    expect(page).not.toContain('request?kind=name');
    expect(page).not.toContain('request?kind=photo');
  });

  it('with the read answered, both "Request a change" links are offered', async () => {
    const page = await html(DetailsPage());
    expect(page).toContain('request?kind=name');
    expect(page).toContain('request?kind=photo');
    expect(page).not.toContain('your change requests');
  });
});

describe('/profile/details/request', () => {
  const request = () => RequestPage({ searchParams: Promise.resolve({ kind: 'name' }) });

  it('a failed read offers no form on the guess that nothing is pending', async () => {
    reads.requests = { rows: [], problem: TIMEOUT };
    const page = await html(request());
    expect(page).toContain('We couldn’t load your change requests');
    expect(page).not.toContain('Send to the office');
    expect(page).not.toMatch(/name="first"|First name/);
  });

  it('with the read answered and nothing pending, the form is there', async () => {
    const page = await html(request());
    expect(page).not.toContain(PROBLEM);
    expect(page).toMatch(/First name/);
  });
});

describe('/profile/availability', () => {
  it('a failed read is the load-problem state, not an empty calendar', async () => {
    reads.availability = { rows: [], problem: TIMEOUT };
    const page = await html(AvailabilityPage());
    expect(page).toContain('We couldn’t load your availability');
    expect(page).toContain('Try again');
  });

  it('with the read answered, the screen draws (its own empty state)', async () => {
    const page = await html(AvailabilityPage());
    expect(page).not.toContain(PROBLEM);
  });
});

describe('/profile/refer', () => {
  it('a failed count is the load-problem state, never "No one yet"', async () => {
    reads.referral = {
      code: { row: 'K7M4Q2XP', problem: null },
      applied: { row: null, problem: TIMEOUT },
    };
    const page = await html(ReferPage());
    expect(page).toContain('apply?ref=K7M4Q2XP');
    expect(page).toContain('We couldn’t load how many people applied with your link');
    expect(page).not.toContain('No one yet');
  });

  it('a failed code read says it could not load the link', async () => {
    reads.referral = { code: { row: null, problem: TIMEOUT }, applied: { row: 0, problem: null } };
    const page = await html(ReferPage());
    expect(page).toContain('We couldn’t load your link');
    expect(page).not.toContain('apply?ref=');
  });

  it('with both read and nobody yet, "No one yet" stands', async () => {
    const page = await html(ReferPage());
    expect(page).toContain('No one yet');
    expect(page).not.toContain(PROBLEM);
  });
});

describe('/profile — the hub’s sub-lines', () => {
  it('failed reads say so on their rows, with one retry — never the plain descriptions', async () => {
    reads.earningsFail = true;
    reads.documentsFail = true;
    reads.contact = { row: null, problem: TIMEOUT };
    const page = await html(ProfilePage());
    expect(page).toContain('We couldn’t load your next pay');
    expect(page).toContain('We couldn’t load your documents');
    expect(page).toContain('We couldn’t load your emergency contact');
    expect(page).not.toContain('Emergency contact not set');
    expect(page).not.toContain('Earnings history, bank details');
    expect(page.split('Try again').length - 1).toBe(1);
  });

  it('with every read answered, the rows carry their usual lines and no retry', async () => {
    const page = await html(ProfilePage());
    expect(page).toContain('Earnings history, bank details');
    expect(page).toContain('Right to work, ID, declarations');
    expect(page).toContain('Emergency contact not set');
    expect(page).not.toContain('We couldn’t load');
    expect(page).not.toContain('Try again');
  });
});
