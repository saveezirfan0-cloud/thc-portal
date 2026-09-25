import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffProfile } from '../types';

/**
 * Emergency contact — ADR-0037, docs/18 §2.
 *
 *   - the section: optional ("Not set" is a pill, not a lock), office-only
 *     copy, the /apply international picker, Save and Remove;
 *   - the actions: the worker's own RPCs, no staff id, no notification,
 *     each refusal as a sentence;
 *   - the Profile tab's amber "Emergency contact not set" subline.
 */
const rpc = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@thc/db/admin', () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { EmergencyContactSection } = await import('../details/EmergencyContactSection');
const { splitE164, toE164 } = await import('../details/phone');
const { saveEmergencyContact, clearEmergencyContact } = await import('../actions');
const { ProfileHub } = await import('../_components/ProfileHub');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => vi.clearAllMocks());

describe('the section', () => {
  it('is optional: empty shows "Not set", no Remove, and says who can see it', () => {
    const html = renderToStaticMarkup(<EmergencyContactSection contact={null} />);
    expect(html).toContain('Emergency contact');
    expect(html).toContain('Not set');
    expect(html).toContain('Only the office can see this');
    expect(html).toContain('never shared with clients');
    expect(html).not.toContain('Remove');
    for (const s of ['Parent', 'Partner', 'Sibling', 'Friend', 'Other']) expect(html).toContain(s);
    // The /apply picker, opening on the UK.
    expect(html).toContain('aria-label="Country code"');
    expect(html).toMatch(/<option value="\+44" selected="">/);
  });

  it('splits a saved number back into the picker for editing, with Save and Remove', () => {
    const html = renderToStaticMarkup(
      <EmergencyContactSection
        contact={{ name: 'Grace Kalu', relationship: 'Parent', phone: '+353871234567' }}
      />,
    );
    expect(html).not.toContain('Not set');
    expect(html).toMatch(/<option value="\+353" selected="">/);
    expect(html).toContain('value="871234567"');
    expect(html).toContain('Remove');
  });

  it('is read-only for a leaver', () => {
    const html = renderToStaticMarkup(
      <EmergencyContactSection
        readOnly
        contact={{ name: 'Grace Kalu', relationship: 'Parent', phone: '+447700900456' }}
      />,
    );
    expect(html).not.toContain('>Save<');
    expect(html).not.toContain('Remove');
  });
});

describe('the phone control', () => {
  it('splits on the longest dialling code', () => {
    expect(splitE164('+447700900456')).toEqual({ dialCode: '+44', national: '7700900456' });
    expect(splitE164('+353871234567')).toEqual({ dialCode: '+353', national: '871234567' });
    expect(splitE164(null)).toEqual({ dialCode: '+44', national: '' });
  });

  it('assembles E.164 the way /apply does, dropping the trunk zero', () => {
    expect(toE164('+44', '07700 900456')).toBe('+447700900456');
  });
});

describe('saveEmergencyContact() / clearEmergencyContact()', () => {
  it('calls the worker’s own RPC with no staff id', async () => {
    rpc.mockResolvedValue({ data: { ok: true, phone: '+447700900456' }, error: null });
    const result = await saveEmergencyContact('Grace Kalu', 'Parent', '+447700900456');
    expect(rpc).toHaveBeenCalledWith('save_my_emergency_contact', {
      p_name: 'Grace Kalu',
      p_relationship: 'Parent',
      p_phone: '+447700900456',
    });
    expect(result).toEqual({ ok: true, note: 'Emergency contact saved.' });
    expect(revalidatePath).toHaveBeenCalledWith('/profile');
  });

  it('says what was wrong', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'bad_phone' } });
    expect(await saveEmergencyContact('Grace', 'Parent', '+44')).toEqual({
      ok: false,
      message: 'Enter a full phone number, including the area code.',
    });
    rpc.mockResolvedValue({ data: null, error: { message: 'not_editable' } });
    const leaver = await clearEmergencyContact();
    expect(!leaver.ok && leaver.message).toMatch(/closed to edits/);
  });
});

describe('the Profile tab nudge', () => {
  const worker: StaffProfile = {
    staffId: 's1',
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
    rating: 4.6,
    reliability: 96,
    quizAttempts: 1,
    roles: [],
    blockers: [],
    checkedIn: false,
    bank: null,
  };
  const hub = (set: boolean | null) =>
    renderToStaticMarkup(
      <ProfileHub profile={worker} photoUrl={null} futureShifts={0} emergencyContactSet={set} />,
    );

  it('shows the amber subline only while none is saved', () => {
    expect(hub(false)).toContain('Emergency contact not set');
    expect(hub(true)).not.toContain('Emergency contact not set');
  });

  it('says nothing when the read failed — never a nag on a network error', () => {
    expect(hub(null)).not.toContain('Emergency contact not set');
  });
});
