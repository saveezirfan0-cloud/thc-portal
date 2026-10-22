// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Correct" on a name (ADR-0194) — /staff/:id, /onboarding/:id and
 * /staff/names.
 *
 *   · only an owner or a manager is offered it (`allowed`, from
 *     officeCan(role, 'identity'));
 *   · the dialog checks the passport rule and the reason BEFORE anything
 *     reaches the server, in the database's own words;
 *   · the server action calls office_correct_name through the manager's
 *     SESSION, never the service key.
 */
const rpc = vi.hoisted(() => vi.fn());
const createAdminClient = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@thc/db/admin', () => ({ createAdminClient }));

const { correctName } = await import('../../_lib/nameCorrectionActions');
const { nameCorrectionMessage } = await import('../../_lib/nameCorrection');
const { NameCorrection } = await import('../NameCorrection');
const { NamesScreen, profileHref } = await import('../../staff/names/NamesScreen');

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
  createAdminClient.mockClear();
  refresh.mockClear();
});

const REASON = 'Passport checked in the office';
const ON_FILE = { first: 'Marc', last: 'M.' };

describe('correctName — the server action', () => {
  it('calls office_correct_name through the session with the tidied name and reason', async () => {
    const result = await correctName('s1', ' Marc  Antoni', ' Martinez ', `  ${REASON}  `, ON_FILE);
    expect(rpc).toHaveBeenCalledWith('office_correct_name', {
      p_staff: 's1',
      p_first: 'Marc Antoni',
      p_last: 'Martinez',
      p_reason: REASON,
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, note: expect.stringMatching(/payroll has been told/) });
  });

  it.each([
    ['Marc', 'M.', REASON, /surname in full/],
    ['J', 'Martinez', REASON, /first and middle names in full/],
    ['Marc', 'Martinez', 'typo', /at least 10 characters/],
    ['Marc', 'Martinez', '', /Give a reason/],
    ['Marc', 'M.', REASON, /no initials/],
  ])('refuses %j / %j / %j before the database', async (first, last, reason, message) => {
    const result = await correctName('s1', first, last, reason, ON_FILE);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(message);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('says the name is already on file', async () => {
    const result = await correctName('s1', 'Amara', 'Kalu', REASON, {
      first: 'Amara',
      last: 'Kalu',
    });
    expect(!result.ok && result.message).toMatch(/already on file/);
  });

  it('turns the database’s refusals into the office’s words', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'staff_removed' } });
    const removed = await correctName('s1', 'Marc', 'Martinez', REASON, ON_FILE);
    expect(!removed.ok && removed.message).toMatch(/removed under GDPR/);
    rpc.mockResolvedValue({ data: null, error: { message: 'last_initial' } });
    const initial = await correctName('s1', 'Marc', 'Martinez', REASON, ON_FILE);
    expect(!initial.ok && initial.message).toMatch(/surname in full/);
  });

  it('knows every code the database raises', () => {
    for (const code of [
      'first_required',
      'first_initial',
      'first_characters',
      'first_too_long',
      'last_required',
      'last_initial',
      'last_characters',
      'last_too_long',
      'unchanged',
      'reason_required',
      'reason_too_short',
      'reason_too_long',
      'staff_removed',
      'staff_not_found',
    ]) {
      expect(nameCorrectionMessage(code), code).not.toBe(code);
    }
  });
});

describe('<NameCorrection>', () => {
  it('is not offered to a scheduler or a viewer (allowed = false)', () => {
    expect(
      renderToStaticMarkup(<NameCorrection staffId="s1" first="Marc" last="M." allowed={false} />),
    ).toBe('');
  });

  let host: HTMLDivElement;
  afterEach(() => host?.remove());

  function mount(recordName: string | null = null) {
    host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <NameCorrection staffId="s1" first="Marc" last="M." allowed recordName={recordName} />,
      ),
    );
    return root;
  }

  function type(label: string, value: string) {
    const field = [...host.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label));
    const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `#${CSS.escape(field!.htmlFor)}`,
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input) as object,
      'value',
    )!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;

  it('opens a dialog with the name on file and the two halves to type, with a reason', () => {
    mount();
    act(() => button('Correct').click());
    expect(host.textContent).toContain('Correct name — Marc M.');
    expect(host.textContent).toContain('First and middle names');
    expect(host.textContent).toContain('Surname');
    expect(host.textContent).toContain('Reason · for the activity log');
    expect(host.textContent).not.toContain('Home Office record');
  });

  it('shows the name on the Home Office record as a guide, never filled in', () => {
    mount('MARC ANTONI MARTINEZ');
    act(() => button('Correct').click());
    expect(host.textContent).toContain('Home Office record');
    expect(host.textContent).toContain('MARC ANTONI MARTINEZ');
    const surname = [...host.querySelectorAll('label')].find((l) =>
      l.textContent?.startsWith('Surname'),
    )!;
    expect(host.querySelector<HTMLInputElement>(`#${CSS.escape(surname.htmlFor)}`)!.value).toBe(
      'M.',
    );
  });

  it('refuses an initial without calling the server, then saves a full name', async () => {
    mount();
    act(() => button('Correct').click());
    type('Reason', REASON);
    act(() => button('Save').click());
    expect(host.textContent).toContain('Enter the surname in full');
    expect(rpc).not.toHaveBeenCalled();

    type('First and middle names', 'Marc Antoni');
    type('Surname', 'Martinez');
    await act(async () => {
      button('Save').click();
    });
    expect(rpc).toHaveBeenCalledWith('office_correct_name', {
      p_staff: 's1',
      p_first: 'Marc Antoni',
      p_last: 'Martinez',
      p_reason: REASON,
    });
    expect(refresh).toHaveBeenCalled();
    expect(host.textContent).toContain('payroll has been told');
  });
});

describe('<NamesScreen> — /staff/names', () => {
  const rows = [
    {
      staff_id: 'a',
      status: 'interview_requested',
      first_name: 'Marc',
      last_name: 'M.',
      reasons: ['initial'],
      record_name: null,
    },
    {
      staff_id: 'b',
      status: 'compliant',
      first_name: 'carlos',
      last_name: 'garcia',
      reasons: ['lower_case'],
      record_name: 'CARLOS GARCIA',
    },
  ];

  it('lists each name with why, the Home Office name, and a link to the right profile', () => {
    const html = renderToStaticMarkup(<NamesScreen rows={rows} problem={null} canCorrect />);
    expect(html).toContain('Names to review (2)');
    expect(html).toContain('An initial');
    expect(html).toContain('All lower case');
    expect(html).toContain('CARLOS GARCIA');
    expect(html).toContain('href="/onboarding/a"');
    expect(html).toContain('href="/staff/b"');
    expect(profileHref(rows[0]!)).toBe('/onboarding/a');
    expect(profileHref(rows[1]!)).toBe('/staff/b');
  });

  it('offers Correct only to those who may', () => {
    const html = renderToStaticMarkup(
      <NamesScreen rows={rows} problem={null} canCorrect={false} />,
    );
    expect(html).not.toContain('>Correct<');
  });

  it('says when every name is in full, and says so when the list could not be read', () => {
    expect(renderToStaticMarkup(<NamesScreen rows={[]} problem={null} canCorrect />)).toContain(
      'Every name is in full',
    );
    const failed = renderToStaticMarkup(
      <NamesScreen rows={[]} problem="Could not read" canCorrect />,
    );
    expect(failed).toContain('Could not read');
    expect(failed).not.toContain('Every name is in full');
  });
});
