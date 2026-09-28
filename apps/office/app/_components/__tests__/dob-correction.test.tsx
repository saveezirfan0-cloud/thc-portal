// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Correct" on a date of birth (ADR-0069) — /staff/:id Overview and
 * /onboarding/:id.
 *
 *   · only an owner or a manager is offered it (`allowed`, from
 *     officeCan(role, 'identity')), and never on a removed profile;
 *   · the dialog types the date as /apply does and checks the rule and the
 *     reason BEFORE anything reaches the server;
 *   · the server action calls office_correct_dob through the manager's
 *     SESSION, never the service key, and says what happened to gov.uk.
 */
const rpc = vi.hoisted(() => vi.fn());
const createAdminClient = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@thc/db/admin', () => ({ createAdminClient }));

const { correctDob } = await import('../../_lib/dobCorrectionActions');
const { dobCorrectionMessage, dobCorrectionOutcome } = await import('../../_lib/dobCorrection');
const { DobCorrection } = await import('../DobCorrection');

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { ok: true, rtwCheck: 'queued' }, error: null });
  createAdminClient.mockClear();
  refresh.mockClear();
});

const REASON = 'Passport shows 31 December';

describe('correctDob — the server action', () => {
  it('calls office_correct_dob through the session with the trimmed reason', async () => {
    const result = await correctDob('s1', '1994-12-31', `  ${REASON}  `, '1995-01-01');
    expect(rpc).toHaveBeenCalledWith('office_correct_dob', {
      p_staff: 's1',
      p_dob: '1994-12-31',
      p_reason: REASON,
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      note: expect.stringMatching(/checked with gov\.uk again/),
      warning: null,
    });
  });

  it.each([
    ['1995-01-01', REASON, /already on file/],
    ['2999-01-01', REASON, /real date of birth/],
    ['1994-12-31', 'typo', /at least 10 characters/],
    ['1994-12-31', '', /Give a reason/],
  ])('refuses %s / %j before the database', async (dob, reason, message) => {
    const result = await correctDob('s1', dob, reason, '1995-01-01');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(message);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('turns the database’s refusals into words', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not_permitted' } });
    const result = await correctDob('s1', '1994-12-31', REASON, '1995-01-01');
    expect(!result.ok && result.message).toMatch(/office role does not allow/);
  });
});

describe('the words', () => {
  it('says what happened to the gov.uk check', () => {
    expect(dobCorrectionOutcome({ rtwCheck: 'queued' }).note).toMatch(/Needs review/);
    expect(dobCorrectionOutcome({ rtwCheck: 'running' }).note).toMatch(/Run check again/);
    expect(dobCorrectionOutcome({ rtwCheck: 'off' }).note).toMatch(/by hand/);
    expect(dobCorrectionOutcome({ rtwCheck: 'none' }).note).toMatch(/activity log/);
  });

  it('warns when a signed opt-out now predates the eighteenth birthday', () => {
    expect(dobCorrectionOutcome({ optOutSignedUnder18: true }).warning).toMatch(
      /under 18 when they signed the 48-hour opt-out/,
    );
    expect(dobCorrectionOutcome({}).warning).toBeNull();
  });

  it.each([
    ['read_only', /read-only/],
    ['staff_removed', /removed under GDPR/],
    ['under_18', /under 18/],
    ['reason_too_short: x', /at least 10/],
    ['something new', /something new/],
  ])('%s', (raw, words) => {
    expect(dobCorrectionMessage(raw)).toMatch(words);
  });
});

describe('<DobCorrection>', () => {
  it('is not offered to a scheduler or a viewer (allowed = false)', () => {
    const html = renderToStaticMarkup(
      <DobCorrection
        staffId="s1"
        name="Amara Kalu"
        dob="1995-01-01"
        display="01.01.1995"
        allowed={false}
      />,
    );
    expect(html).toBe('');
  });

  let host: HTMLDivElement;
  afterEach(() => host?.remove());

  function mount() {
    host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <DobCorrection
          staffId="s1"
          name="Amara Kalu"
          dob="1995-01-01"
          display="01.01.1995"
          allowed
        />,
      ),
    );
    return root;
  }

  function type(label: string, value: string) {
    const field = [...host.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label));
    const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `#${CSS.escape(field!.htmlFor)}`,
    )!;
    const proto = Object.getPrototypeOf(input) as object;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;

  it('opens a dialog with the date on file, a typed date (UK) and a reason', () => {
    mount();
    act(() => button('Correct').click());
    expect(host.textContent).toContain('Correct date of birth — Amara Kalu');
    expect(host.textContent).toContain('01.01.1995');
    expect(host.textContent).toContain('New date of birth (UK date)');
    expect(host.querySelector('input[placeholder="DD/MM/YYYY"]')).not.toBeNull();
    expect(host.textContent).toContain('Reason · for the activity log');
  });

  it('draws the slashes as the date is typed, and refuses a short reason without calling the server', () => {
    mount();
    act(() => button('Correct').click());
    type('New date of birth', '31121994');
    expect(host.querySelector<HTMLInputElement>('input[placeholder="DD/MM/YYYY"]')!.value).toBe(
      '31/12/1994',
    );
    type('Reason', 'typo');
    act(() => button('Save').click());
    expect(host.textContent).toMatch(/at least 10 characters/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('saves, closes and says what happened', async () => {
    mount();
    act(() => button('Correct').click());
    type('New date of birth', '31/12/1994');
    type('Reason', REASON);
    await act(async () => {
      button('Save').click();
    });
    expect(rpc).toHaveBeenCalledWith('office_correct_dob', {
      p_staff: 's1',
      p_dob: '1994-12-31',
      p_reason: REASON,
    });
    expect(host.textContent).not.toContain('Correct date of birth — Amara Kalu');
    expect(host.textContent).toMatch(/checked with gov\.uk again/);
    expect(refresh).toHaveBeenCalled();
  });
});
