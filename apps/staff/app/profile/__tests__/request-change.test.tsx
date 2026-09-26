import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffProfile } from '../types';
import type { ChangeRequest } from '../change-requests';

/**
 * Request a change — ADR-0044, docs/19 §3.
 *
 *   - the status line: pending "with the office" + Withdraw, rejected
 *     "Not changed: {reason}" + Request again, nothing otherwise;
 *   - Profile details: the locked name row and the locked photo gain
 *     "Request a change", hidden while one is pending;
 *   - the upload slots: paths built from the session, never the browser —
 *     evidence under <id>/change-requests/ through a signed upload, the
 *     photo under <id>/ even though the photo is locked;
 *   - the RPC calls carry no staff id.
 */
const rpc = vi.hoisted(() => vi.fn());
const createSignedUploadUrl = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({ rpc, storage: { from: () => ({ createSignedUploadUrl }) } }),
}));
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

const { statusLine, canRequest, changeReason, CHANGE_REASONS } = await import('../change-requests');
const { DetailsForm } = await import('../details/DetailsForm');
const actions = await import('../details/request/actions');

const saved = { ...process.env };
beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});
afterAll(() => {
  process.env = saved;
});
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (fn: string) =>
    fn === 'staff_me'
      ? { data: { staffId: 'staff-1', status: 'compliant', photoLocked: true }, error: null }
      : { data: { ok: true, id: 'r1' }, error: null },
  );
  createSignedUploadUrl.mockResolvedValue({ data: { token: 'tok' }, error: null });
});

const request = (over: Partial<ChangeRequest> = {}): ChangeRequest => ({
  id: 'r1',
  kind: 'name',
  status: 'pending',
  proposedFirstName: 'Amara',
  proposedLastName: 'Okafor',
  proposedPhotoPath: null,
  workerNote: null,
  decisionReason: null,
  createdAt: '2026-09-18T13:37:00Z',
  decidedAt: null,
  ...over,
});

describe('statusLine', () => {
  it('pending: with the office, what was asked, when (UK time)', () => {
    expect(statusLine([request()], 'name')).toEqual({
      state: 'pending',
      id: 'r1',
      text: 'Name change requested · with the office',
      detail: 'Requested: Amara Okafor · Fri 18 Sep, 14:37 (UK time)',
    });
    expect(canRequest([request()], 'name')).toBe(false);
    expect(canRequest([request()], 'photo')).toBe(true);
  });

  it('rejected: the office’s reason as written', () => {
    const line = statusLine(
      [
        request({
          kind: 'photo',
          status: 'rejected',
          decisionReason: 'your face is partly covered — please retake without sunglasses.',
        }),
      ],
      'photo',
    );
    expect(line).toEqual({
      state: 'rejected',
      id: 'r1',
      text: 'Not changed: your face is partly covered — please retake without sunglasses.',
    });
  });

  it('reads only the newest request of the kind; approved and withdrawn say nothing', () => {
    const older = request({ id: 'old', status: 'rejected', decisionReason: 'Blurry' });
    const newer = request({ id: 'new', status: 'withdrawn', createdAt: '2026-09-20T10:00:00Z' });
    expect(statusLine([older, newer], 'name')).toBeNull();
    expect(statusLine([request({ status: 'approved' })], 'name')).toBeNull();
    expect(statusLine([], 'name')).toBeNull();
  });

  it('has a sentence for every refusal the RPC raises', () => {
    for (const code of [
      'already_pending',
      'too_many_requests',
      'unchanged',
      'evidence_required',
      'file_not_found',
      'wrong_path',
      'not_pending',
      'not_editable',
    ]) {
      expect(changeReason(code)).toBe(CHANGE_REASONS[code]);
    }
  });
});

describe('Profile details', () => {
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
    roles: [],
    blockers: [],
    checkedIn: false,
    bank: null,
  };
  const render = (requests: ChangeRequest[] = []) =>
    renderToStaticMarkup(<DetailsForm profile={worker} photoUrl={null} requests={requests} />);

  it('offers Request a change on the locked name and the locked photo', () => {
    const html = render();
    expect(html).toContain('href="/profile/details/request?kind=name"');
    expect(html).toContain('href="/profile/details/request?kind=photo"');
    expect(html).toContain('Profile photo · locked');
  });

  it('hides it while a request is pending, and shows Withdraw instead', () => {
    const html = render([request()]);
    expect(html).not.toContain('request?kind=name"');
    expect(html).toContain('Name change requested · with the office');
    expect(html).toContain('Withdraw');
    expect(html).toContain('request?kind=photo');
  });

  it('after a rejection, shows the reason and Request again', () => {
    const html = render([
      request({ kind: 'photo', status: 'rejected', decisionReason: 'Too dark.' }),
    ]);
    expect(html).toContain('Not changed: Too dark.');
    expect(html).toContain('Request again');
  });
});

describe('the upload slots', () => {
  it('issues a signed upload for evidence under <id>/change-requests/, a fresh name', async () => {
    const slot = await actions.startEvidenceUpload({
      name: 'marriage-certificate.PDF',
      type: 'application/pdf',
      size: 1_800_000,
    });
    expect(slot.ok).toBe(true);
    const path = slot.ok ? slot.path : '';
    expect(path).toMatch(/^staff-1\/change-requests\/[0-9a-f-]{36}\.pdf$/);
    expect(createSignedUploadUrl).toHaveBeenCalledWith(path);
  });

  it('refuses a file type before issuing anything', async () => {
    const slot = await actions.startEvidenceUpload({ name: 'x.gif', type: 'image/gif', size: 10 });
    expect(slot).toEqual({ ok: false, message: 'Upload a PDF, JPG or PNG.' });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('gives a locked worker a fresh photo path in their own folder', async () => {
    const slot = await actions.startChangePhotoUpload();
    expect(slot.ok && slot.path).toMatch(/^staff-1\/selfie-\d+\.jpg$/);
  });

  it('refuses a leaver either slot', async () => {
    rpc.mockResolvedValue({ data: { staffId: 'staff-1', status: 'inactive' }, error: null });
    expect((await actions.startChangePhotoUpload()).ok).toBe(false);
  });
});

describe('the requests', () => {
  it('asks for a name change with no staff id', async () => {
    await actions.requestNameChange('Amara', 'Okafor', 'staff-1/change-requests/x.pdf', '  ');
    expect(rpc).toHaveBeenCalledWith('request_profile_change', {
      p_kind: 'name',
      p_first: 'Amara',
      p_last: 'Okafor',
      p_photo_path: null,
      p_evidence_path: 'staff-1/change-requests/x.pdf',
      p_note: null,
    });
  });

  it('asks for a photo change, and turns a refusal into its sentence', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'already_pending' } });
    const result = await actions.requestPhotoChange('staff-1/selfie-2.jpg', 'New haircut');
    expect(rpc).toHaveBeenCalledWith('request_profile_change', {
      p_kind: 'photo',
      p_first: null,
      p_last: null,
      p_photo_path: 'staff-1/selfie-2.jpg',
      p_evidence_path: null,
      p_note: 'New haircut',
    });
    expect(result).toEqual({ ok: false, message: CHANGE_REASONS['already_pending'] });
  });

  it('says the 24-hour ceiling in words (20260930205100)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'too_many_requests' } });
    const result = await actions.requestPhotoChange('staff-1/selfie-3.jpg', '');
    expect(result).toEqual({ ok: false, message: CHANGE_REASONS['too_many_requests'] });
    expect(CHANGE_REASONS['too_many_requests']).toMatch(/24 hours/);
  });

  it('withdraws by id only', async () => {
    await actions.withdrawChange('r1');
    expect(rpc).toHaveBeenCalledWith('withdraw_profile_change', { p_id: 'r1' });
  });
});
