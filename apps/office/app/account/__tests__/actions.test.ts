import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /account — My profile (ADR-0049 §7), the four server actions with every
 * Supabase client mocked.
 *
 *   saveMyDetails        checked here first (the same rules the database
 *                        applies again), then `update_my_profile` with the
 *                        values trimmed and blanks as NULL; the function's
 *                        reason codes come back as sentences.
 *   changeMyEmail        GoTrue's confirmation-link flow on the user's own
 *                        session; the link comes back to the OFFICE origin
 *                        from configuration, never a request header.
 *   changeMyPassword     the current password is proved on a separate,
 *                        cookie-less client BEFORE anything changes, and a
 *                        success signs every other device out.
 *   signOutOtherDevices  `signOut({ scope: 'others' })` on the session.
 */

const session = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    // Never to be used by these actions — the probe client is.
    signInWithPassword: vi.fn(),
  },
  rpc: vi.fn(),
}));
const probe = vi.hoisted(() => ({
  auth: { signInWithPassword: vi.fn(), signOut: vi.fn() },
}));
const createProbe = vi.hoisted(() => vi.fn());
const createSession = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const configured = vi.hoisted(() => ({ value: true }));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@thc/db/server', () => ({ createClient: createSession }));
vi.mock('@supabase/supabase-js', () => ({ createClient: createProbe }));
vi.mock('../../staff/data', () => ({ supabaseConfigured: () => configured.value }));

const { changeMyEmail, changeMyPassword, saveMyDetails, signOutOtherDevices } =
  await import('../actions');

const NOT_CONFIGURED =
  'This environment has no Supabase project, so this cannot be saved. See docs/04-setup-github-vercel-supabase.md.';
const ME = { id: 'u-gisela', email: 'gisela@thehospitalitycompany.example' };
const GOOD = 'Harbour-Lantern-2048';

beforeEach(() => {
  vi.clearAllMocks();
  configured.value = true;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('NEXT_PUBLIC_OFFICE_URL', '');
  vi.stubEnv('VERCEL_URL', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});

  createSession.mockReturnValue(session);
  createProbe.mockReturnValue(probe);
  session.auth.getUser.mockResolvedValue({ data: { user: ME } });
  session.auth.updateUser.mockResolvedValue({ error: null });
  session.auth.signOut.mockResolvedValue({ error: null });
  session.rpc.mockResolvedValue({ data: { changed: ['full_name'] }, error: null });
  probe.auth.signInWithPassword.mockResolvedValue({ data: { user: ME }, error: null });
  probe.auth.signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------
// saveMyDetails
// ---------------------------------------------------------------------

describe('saveMyDetails', () => {
  const valid = { fullName: 'Gisela Brandt', phone: '+44 7700 900123', jobTitle: 'Ops manager' };

  it.each([
    [{ ...valid, fullName: ' G ' }, 'Enter a name of at least two characters.'],
    [{ ...valid, fullName: 'x'.repeat(121) }, 'Keep the name under 120 characters.'],
    [
      { ...valid, phone: 'call me maybe' },
      'Enter a phone number using digits, spaces and an optional +.',
    ],
    [
      { ...valid, phone: '++44 7700 900123' },
      'Enter a phone number using digits, spaces and an optional +.',
    ],
    [{ ...valid, jobTitle: 'y'.repeat(81) }, 'Keep the job title under 80 characters.'],
  ])('refuses %j before asking the database', async (input, message) => {
    expect(await saveMyDetails(input)).toEqual({ ok: false, message });
    expect(createSession).not.toHaveBeenCalled();
    expect(session.rpc).not.toHaveBeenCalled();
  });

  it('checks the name first when several fields are wrong', async () => {
    const result = await saveMyDetails({ fullName: '', phone: 'nope', jobTitle: 'z'.repeat(81) });
    expect(result).toEqual({ ok: false, message: 'Enter a name of at least two characters.' });
  });

  it('says so, without a call, when there is no Supabase project', async () => {
    configured.value = false;
    expect(await saveMyDetails(valid)).toEqual({ ok: false, message: NOT_CONFIGURED });
    expect(session.rpc).not.toHaveBeenCalled();
  });

  it('calls update_my_profile with the values trimmed', async () => {
    await saveMyDetails({
      fullName: '  Gisela Brandt ',
      phone: ' +44 7700 900123 ',
      jobTitle: ' Ops manager ',
    });
    expect(session.rpc).toHaveBeenCalledTimes(1);
    expect(session.rpc).toHaveBeenCalledWith('update_my_profile', {
      p_full_name: 'Gisela Brandt',
      p_phone: '+44 7700 900123',
      p_job_title: 'Ops manager',
    });
  });

  it('sends a blank phone and job title as NULL, so they are cleared rather than kept as ""', async () => {
    await saveMyDetails({ fullName: 'Gisela Brandt', phone: '   ', jobTitle: '' });
    expect(session.rpc).toHaveBeenCalledWith('update_my_profile', {
      p_full_name: 'Gisela Brandt',
      p_phone: null,
      p_job_title: null,
    });
  });

  it('a change is saved and the whole layout revalidated — the sidebar foot names the user', async () => {
    expect(await saveMyDetails(valid)).toEqual({ ok: true, message: 'Saved.' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it.each([[{ changed: [] }], [null]])(
    'reports nothing changed when the function says %j',
    async (data) => {
      session.rpc.mockResolvedValue({ data, error: null });
      expect(await saveMyDetails(valid)).toEqual({ ok: true, message: 'Nothing had changed.' });
    },
  );

  it.each([
    ['not_signed_in', 'Your session has ended. Sign in again.'],
    [
      'no_profile',
      'This login has no profile yet. Ask another admin to invite it again from Users & access.',
    ],
    ['use_staff_profile', 'A worker’s name is edited on their staff profile.'],
    ['name_required', 'Enter a name of at least two characters.'],
    ['phone_invalid', 'Enter a phone number using digits, spaces and an optional +.'],
    ['job_title_too_long', 'Keep the job title under 80 characters.'],
    // PostgREST can prefix detail after a colon; only the code decides.
    [
      'phone_invalid: value "+x" rejected',
      'Enter a phone number using digits, spaces and an optional +.',
    ],
    [
      'duplicate key value violates unique constraint',
      'That did not save. Try again, and if it keeps happening tell a developer.',
    ],
  ])('maps the database refusal %j to a sentence and saves nothing', async (code, message) => {
    session.rpc.mockResolvedValue({ data: null, error: { message: code } });
    expect(await saveMyDetails(valid)).toEqual({ ok: false, message });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// changeMyEmail
// ---------------------------------------------------------------------

describe('changeMyEmail', () => {
  it('refuses something that is not an address, before reading the session', async () => {
    expect(await changeMyEmail('not an email')).toEqual({
      ok: false,
      message: 'Enter a valid email address.',
    });
    expect(session.auth.getUser).not.toHaveBeenCalled();
    expect(session.auth.updateUser).not.toHaveBeenCalled();
  });

  it('says so when there is no Supabase project', async () => {
    configured.value = false;
    expect(await changeMyEmail('new@example.com')).toEqual({ ok: false, message: NOT_CONFIGURED });
    expect(session.auth.updateUser).not.toHaveBeenCalled();
  });

  it('asks a signed-out caller to sign in again', async () => {
    session.auth.getUser.mockResolvedValue({ data: { user: null } });
    expect(await changeMyEmail('new@example.com')).toEqual({
      ok: false,
      message: 'Your session has ended. Sign in again.',
    });
    expect(session.auth.updateUser).not.toHaveBeenCalled();
  });

  it.each(['gisela@thehospitalitycompany.example', '  GISELA@TheHospitalityCompany.example '])(
    'refuses the address already in use (%j) without asking GoTrue',
    async (email) => {
      expect(await changeMyEmail(email)).toEqual({
        ok: false,
        message: 'That is already your sign-in address.',
      });
      expect(session.auth.updateUser).not.toHaveBeenCalled();
    },
  );

  it('normalises the address and sends the confirmation link back to the office origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_OFFICE_URL', 'https://office.thc.example/');
    // A deployment URL must not win over the explicit origin.
    vi.stubEnv('VERCEL_URL', 'thc-office-git-branch.vercel.app');

    const result = await changeMyEmail('  Gisela.New@Example.COM ');

    expect(session.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(session.auth.updateUser).toHaveBeenCalledWith(
      { email: 'gisela.new@example.com' },
      { emailRedirectTo: 'https://office.thc.example/auth/callback?next=/account' },
    );
    expect(result).toEqual({
      ok: true,
      message:
        'Check gisela.new@example.com for a confirmation link. Your current address keeps working until it is opened.',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/account');
  });

  it('never guesses the origin from VERCEL_URL: locally :3000, in production it refuses', async () => {
    // packages/db origin.ts (main #70): a deployment URL is not in the
    // Supabase redirect allow-list and sits behind Vercel's SSO.
    vi.stubEnv('VERCEL_URL', 'thc-office.vercel.app');
    await changeMyEmail('b@example.com');
    expect(session.auth.updateUser).toHaveBeenLastCalledWith(
      { email: 'b@example.com' },
      { emailRedirectTo: 'http://127.0.0.1:3000/auth/callback?next=/account' },
    );

    vi.stubEnv('NODE_ENV', 'production');
    session.auth.updateUser.mockClear();
    const refused = await changeMyEmail('c@example.com');
    expect(refused).toEqual({
      ok: false,
      message: 'The email cannot be changed on this deployment yet — set NEXT_PUBLIC_OFFICE_URL.',
    });
    expect(session.auth.updateUser).not.toHaveBeenCalled();
  });

  it('says plainly when the new address already has a login', async () => {
    session.auth.updateUser.mockResolvedValue({
      error: { status: 422, message: 'A user with this email address has already been registered' },
    });
    expect(await changeMyEmail('taken@example.com')).toEqual({
      ok: false,
      message: 'That address already has a login.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('any other GoTrue refusal is a generic retry, never the raw message', async () => {
    session.auth.updateUser.mockResolvedValue({
      error: { status: 429, message: 'Email rate limit exceeded' },
    });
    expect(await changeMyEmail('new@example.com')).toEqual({
      ok: false,
      message: 'The address could not be changed. Try again in a minute.',
    });
  });
});

// ---------------------------------------------------------------------
// changeMyPassword
// ---------------------------------------------------------------------

describe('changeMyPassword', () => {
  const input = { current: 'Old-password-1', next: GOOD, confirm: GOOD };

  it.each([
    [{ ...input, next: 'short1', confirm: 'short1' }, 'Use at least 10 characters.'],
    [
      { ...input, next: 'no-numbers-here', confirm: 'no-numbers-here' },
      'Include at least one number.',
    ],
    [{ ...input, confirm: `${GOOD}x` }, 'Passwords don’t match.'],
    [{ ...input, current: '' }, 'Enter your current password.'],
    [
      { current: GOOD, next: GOOD, confirm: GOOD },
      'The new password must be different from the current one.',
    ],
  ])('refuses %j without touching either client', async (attempt, message) => {
    expect(await changeMyPassword(attempt)).toEqual({ ok: false, message });
    expect(createSession).not.toHaveBeenCalled();
    expect(createProbe).not.toHaveBeenCalled();
  });

  it('says so when there is no Supabase project', async () => {
    configured.value = false;
    expect(await changeMyPassword(input)).toEqual({ ok: false, message: NOT_CONFIGURED });
    expect(createProbe).not.toHaveBeenCalled();
  });

  it('asks a signed-out caller to sign in again, before building the probe', async () => {
    session.auth.getUser.mockResolvedValue({ data: { user: null } });
    expect(await changeMyPassword(input)).toEqual({
      ok: false,
      message: 'Your session has ended. Sign in again.',
    });
    expect(createProbe).not.toHaveBeenCalled();
  });

  it('proves the current password on a separate cookie-less client, never the session', async () => {
    await changeMyPassword(input);

    expect(createProbe).toHaveBeenCalledTimes(1);
    expect(createProbe).toHaveBeenCalledWith('http://127.0.0.1:54321', 'anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(createProbe.mock.results[0]!.value).not.toBe(session);
    expect(probe.auth.signInWithPassword).toHaveBeenCalledWith({
      email: ME.email,
      password: 'Old-password-1',
    });
    // The session this action runs on never signs in with a guessed password.
    expect(session.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('a wrong current password is refused BEFORE the password is changed', async () => {
    probe.auth.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 400, message: 'Invalid login credentials' },
    });

    expect(await changeMyPassword(input)).toEqual({
      ok: false,
      message: 'Your current password is not right.',
    });
    expect(session.auth.updateUser).not.toHaveBeenCalled();
    expect(session.auth.signOut).not.toHaveBeenCalled();
  });

  it('success: probe signs in, drops its own session, the password changes, then every other device is signed out', async () => {
    const result = await changeMyPassword(input);

    expect(result).toEqual({
      ok: true,
      message: 'Password changed. Every other device has been signed out.',
    });
    expect(probe.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(session.auth.updateUser).toHaveBeenCalledWith({ password: GOOD });
    expect(session.auth.signOut).toHaveBeenCalledTimes(1);
    expect(session.auth.signOut).toHaveBeenCalledWith({ scope: 'others' });

    const order = [
      probe.auth.signInWithPassword.mock.invocationCallOrder[0]!,
      probe.auth.signOut.mock.invocationCallOrder[0]!,
      session.auth.updateUser.mock.invocationCallOrder[0]!,
      session.auth.signOut.mock.invocationCallOrder[0]!,
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('a breached password is named as such, and nobody is signed out', async () => {
    session.auth.updateUser.mockResolvedValue({
      error: { status: 422, message: 'Password is known to be weak and easy to guess (pwned)' },
    });
    expect(await changeMyPassword(input)).toEqual({
      ok: false,
      message: 'That password has appeared in a known data breach. Choose a different one.',
    });
    expect(session.auth.signOut).not.toHaveBeenCalled();
  });

  it('any other failure is a generic retry, and nobody is signed out', async () => {
    session.auth.updateUser.mockResolvedValue({ error: { status: 500, message: 'boom' } });
    expect(await changeMyPassword(input)).toEqual({
      ok: false,
      message: 'The password could not be changed. Try again.',
    });
    expect(session.auth.signOut).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// signOutOtherDevices
// ---------------------------------------------------------------------

describe('signOutOtherDevices', () => {
  it('ends every session but this one', async () => {
    expect(await signOutOtherDevices()).toEqual({
      ok: true,
      message: 'Every other device has been signed out.',
    });
    expect(session.auth.signOut).toHaveBeenCalledTimes(1);
    expect(session.auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('says so when GoTrue refuses', async () => {
    session.auth.signOut.mockResolvedValue({ error: { message: 'nope' } });
    expect(await signOutOtherDevices()).toEqual({
      ok: false,
      message: 'That did not work. Try again.',
    });
  });

  it('says so when there is no Supabase project', async () => {
    configured.value = false;
    expect(await signOutOtherDevices()).toEqual({ ok: false, message: NOT_CONFIGURED });
    expect(session.auth.signOut).not.toHaveBeenCalled();
  });
});
