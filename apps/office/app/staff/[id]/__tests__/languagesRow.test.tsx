import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0080 · the Languages row on /staff/:id, and the action behind it.
 *
 *   · editable: chips (English fixed) and "Add a language…";
 *   · a viewer: the list as text, or an amber "not recorded" pill;
 *   · never asked and editable: no chips — English does not read as
 *     recorded — plus "Not asked yet" and an English only button;
 *   · a removed profile, or a failed read: "—";
 *   · the action sends the list through the SESSION and names refusals in
 *     sentences, never codes.
 */

const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
  error: null as { message: string } | null,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@thc/db/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('../../data', () => ({ supabaseConfigured: () => true }));

const { LanguagesField } = await import('../LanguagesField');
const { saveLanguages } = await import('../actions');

beforeEach(() => {
  rpc.mockClear();
  rpc.mockImplementation(async () => ({ error: null }));
});

const render = (props: Partial<Parameters<typeof LanguagesField>[0]>) =>
  renderToStaticMarkup(
    <LanguagesField staffId="st-1" languages={['English', 'Spanish']} editable {...props} />,
  );

describe('the Languages row (ADR-0080)', () => {
  it('editable: English fixed, other languages removable, and Add a language', () => {
    const html = render({});
    expect(html).toContain('>English<');
    expect(html).toContain('Spanish');
    expect(html.match(/aria-label="Remove"/g)?.length).toBe(1);
    expect(html).toContain('Add a language…');
    // Spanish is already chosen, so it is not offered again.
    expect(html).not.toContain('<option value="Spanish">');
  });

  it('a viewer reads the list as text', () => {
    const html = render({ editable: false });
    expect(html).toContain('English &amp; Spanish');
    expect(html).not.toContain('<select');
  });

  it('never asked, editable: no chips, an explanation and English only', () => {
    const html = render({ languages: null });
    expect(html).not.toContain('class="chip');
    expect(html).toContain('Not asked yet');
    expect(html).toContain('English only');
    expect(html).toContain('Add a language…');
  });

  it('never asked, read-only: the amber pill', () => {
    const html = render({ languages: null, editable: false });
    expect(html).toContain('not recorded');
    expect(html).not.toContain('English only');
  });

  it('a removed profile or a failed read shows a dash', () => {
    expect(render({ removed: true })).toBe('<span class="muted">—</span>');
    expect(render({ languages: undefined })).toBe('<span class="muted">—</span>');
  });
});

describe('saveLanguages', () => {
  it('sends the list to set_staff_languages', async () => {
    expect(await saveLanguages('st-1', ['English', 'Polish'])).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith('set_staff_languages', {
      p_staff: 'st-1',
      p_languages: ['English', 'Polish'],
    });
  });

  it('names a refusal in a sentence, never the code', async () => {
    for (const code of ['unknown_language', 'read_only', 'not_authorised', 'unknown_staff']) {
      rpc.mockImplementationOnce(async () => ({ error: { message: code } }));
      const result = await saveLanguages('st-1', ['English']);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.message).not.toBe(code);
    }
  });
});
