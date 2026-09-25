// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffProfile } from '../types';

/**
 * Request my P45 on the profile sheet — §10.6, wireframes/staff/profile.html.
 *
 * The scope is specific about the shape, and this pins each clause on
 * screen rather than in the SQL 330 already covers:
 *
 *   - the action is disabled while checked in, with "Available once you've
 *     checked out" as its hint;
 *   - the sheet is headed "Leaving The Hospitality Company?";
 *   - Cancel is the default-styled (primary) action and the confirm button
 *     "Yes, request my P45" is deliberately not;
 *   - a second "Are you sure? This can't be undone from the app" step sits
 *     behind it, and `requestP45` is called from THAT step only.
 *
 * A DOM is needed for the two taps, so this file runs under jsdom and
 * drives React directly; nothing here is a screenshot.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const requestP45 = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../actions', () => ({ requestP45: (reason: string) => requestP45(reason) }));

const { ProfileSheet } = await import('../_components/ProfileSheet');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const worker = (over: Partial<StaffProfile> = {}): StaffProfile => ({
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
  roles: ['Waiting Staff', 'Bar Staff'],
  blockers: [],
  checkedIn: false,
  bank: null,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

function mount(profile: StaffProfile, futureShifts = 3) {
  act(() => {
    root.render(<ProfileSheet profile={profile} photoUrl={null} futureShifts={futureShifts} />);
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button reads "${label}"`);
  return found;
}

async function tap(label: string) {
  await act(async () => {
    button(label).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requestP45.mockResolvedValue({ ok: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the P45 action on the sheet (§10.6)', () => {
  it('sits at the foot, below sign-out and the help line, and is not primary-styled', () => {
    mount(worker());
    const link = container.querySelector<HTMLButtonElement>('.p45-slot .p45-link');
    expect(link).not.toBeNull();
    expect(link!.className).not.toContain('primary');
    const html = container.innerHTML;
    expect(html.indexOf('Sign out')).toBeLessThan(html.indexOf('Need help?'));
    expect(html.indexOf('Need help?')).toBeLessThan(html.indexOf('p45-slot'));
    expect(link!.textContent).toBe('Request my P45 — leaving The Hospitality Company');
  });

  it('is disabled while checked in, with the scope’s hint (step 3)', () => {
    mount(worker({ checkedIn: true }));
    const link = container.querySelector<HTMLButtonElement>('.p45-link');
    expect(link!.disabled).toBe(true);
    expect(link!.textContent).toBe('Request my P45');
    expect(container.querySelector('.p45-hint')!.textContent).toBe(
      "Available once you've checked out",
    );
    expect(container.querySelector('[aria-label="Leaving The Hospitality Company?"]')).toBeNull();
  });

  it('is absent, not disabled, for someone who has already left', () => {
    mount(worker({ status: 'inactive', leftAt: '2026-09-01T10:00:00Z' }));
    expect(container.querySelector('.p45-slot')).toBeNull();
  });
});

describe('the two-step sheet (§10.6)', () => {
  it('opens headed "Leaving The Hospitality Company?" with the consequences and the real count', async () => {
    mount(worker(), 3);
    await tap('Request my P45 — leaving The Hospitality Company');

    const sheet = container.querySelector('[aria-label="Leaving The Hospitality Company?"]');
    expect(sheet).not.toBeNull();
    const text = sheet!.textContent ?? '';
    expect(text).toContain('Leaving The Hospitality Company?');
    expect(text).toContain('P45 will be requested');
    expect(text).toContain('taken off every shift you’re booked on');
    expect(text).toContain('3 upcoming shifts will be offered to other staff straight away');
    expect(text).toContain('Any open invitations and Radar applications are withdrawn.');
    expect(text).toContain('won’t be able to book or be invited to shifts again');
    expect(text).toContain(
      'A shift you’re working right now is not affected and is paid as normal.',
    );
    expect(sheet!.querySelector('textarea')).not.toBeNull();
  });

  it('Cancel carries the primary tone and the confirm deliberately does not', async () => {
    mount(worker());
    await tap('Request my P45 — leaving The Hospitality Company');

    const cancel = button('Cancel');
    const confirm = button('Yes, request my P45');
    expect(cancel.className.split(' ')).toContain('primary');
    expect(confirm.className.split(' ')).not.toContain('primary');
    expect(confirm.className.split(' ')).not.toContain('danger');
    // No second step yet, and nothing sent.
    expect(container.querySelector('.modal')).toBeNull();
    expect(requestP45).not.toHaveBeenCalled();
  });

  it('Cancel closes the sheet without sending anything', async () => {
    mount(worker());
    await tap('Request my P45 — leaving The Hospitality Company');
    await tap('Cancel');
    expect(container.querySelector('[aria-label="Leaving The Hospitality Company?"]')).toBeNull();
    expect(requestP45).not.toHaveBeenCalled();
  });

  it('the confirm opens the second step verbatim, and only THAT step sends the request', async () => {
    mount(worker());
    await tap('Request my P45 — leaving The Hospitality Company');

    const reason = container.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(reason, 'Moving away');
      reason.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await tap('Yes, request my P45');
    expect(requestP45).not.toHaveBeenCalled();
    const modal = container.querySelector('.modal');
    expect(modal).not.toBeNull();
    expect(modal!.querySelector('h3')!.textContent).toBe(
      'Are you sure? This can’t be undone from the app',
    );

    // "Go back" is the primary action of the second step too.
    expect(button('Go back').className.split(' ')).toContain('primary');
    expect(button('Request my P45').className.split(' ')).toContain('danger');

    await tap('Go back');
    expect(container.querySelector('.modal')).toBeNull();
    expect(requestP45).not.toHaveBeenCalled();

    await tap('Yes, request my P45');
    await tap('Request my P45');
    expect(requestP45).toHaveBeenCalledTimes(1);
    expect(requestP45).toHaveBeenCalledWith('Moving away');
    // Step 7: the whole app is now the leaver screen.
    expect(router.replace).toHaveBeenCalledWith('/profile');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('a refusal from the server is shown on the sheet and the flow stays open', async () => {
    requestP45.mockResolvedValue({
      ok: false,
      message:
        'You’re checked in to a shift right now. Request my P45 is available once you’ve checked out.',
    });
    mount(worker());
    await tap('Request my P45 — leaving The Hospitality Company');
    await tap('Yes, request my P45');
    await tap('Request my P45');
    expect(container.querySelector('.modal')).toBeNull();
    expect(container.querySelector('.alert')!.textContent).toContain(
      'checked in to a shift right now',
    );
    expect(router.replace).not.toHaveBeenCalled();
  });
});
