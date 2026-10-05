import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TimeFormatProvider } from '@thc/ui';

/**
 * /account → Sessions & appearance → Time format (ADR-0085): 24-hour is the
 * default and says so, 12-hour is the one other choice, and a live example
 * shows what each reads like. The choice saves on click (the action has its
 * own tests); this holds what the screen draws.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('../actions', () => ({
  changeMyEmail: vi.fn(),
  changeMyPassword: vi.fn(),
  saveMyDetails: vi.fn(),
  saveMyTimeFormat: vi.fn(),
  signOutOtherDevices: vi.fn(),
}));
vi.mock('../two-step-actions', () => ({
  startTwoStep: vi.fn(),
  confirmTwoStep: vi.fn(),
  turnOffTwoStep: vi.fn(),
}));
vi.mock('../../_components/OfficeShell', () => ({
  OfficeShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { AccountScreen } = await import('../AccountScreen');

const ACCOUNT = {
  email: 'gisela@thehospitalitycompany.example',
  pendingEmail: null,
  fullName: 'Gisela Brandt',
  phone: '',
  jobTitle: 'Operations manager',
  role: 'admin',
  createdAt: '2026-09-01T09:00:00Z',
  lastSignInAt: '2026-10-05T17:30:00Z',
  twoStep: { on: false, deviceName: null, since: null },
  timeFormat: '24h' as const,
};

function render(timeFormat: '24h' | '12h'): string {
  return renderToStaticMarkup(
    <TimeFormatProvider format={timeFormat}>
      <AccountScreen data={{ account: { ...ACCOUNT, timeFormat }, problem: null }} />
    </TimeFormatProvider>,
  );
}

describe('My profile · Time format (ADR-0085)', () => {
  it('offers 24-hour, labelled as the default, and 12-hour', () => {
    const html = render('24h');
    expect(html).toContain('aria-label="Time format"');
    expect(html).toContain('24-hour (default)');
    expect(html).toContain('>12-hour<');
  });

  it('shows the saved choice as pressed, with a live example in its clock', () => {
    const twentyFour = render('24h');
    expect(twentyFour).toMatch(/aria-pressed="true" class="on">24-hour \(default\)/);
    expect(twentyFour).toContain('Example: <b class="mono">17:30</b>');

    const twelve = render('12h');
    expect(twelve).toMatch(/aria-pressed="true" class="on">12-hour/);
    expect(twelve).toContain('Example: <b class="mono">5:30 pm</b>');
  });

  it('says it changes the writing, not the stored times or the UK-time labels', () => {
    expect(render('24h')).toContain('stored times and the UK-time labels do not change');
  });

  it('writes the "last signed in" stamp on the chosen clock, still labelled UK time', () => {
    // 17:30Z on 5 October is 18:30 in London (BST).
    expect(render('24h')).toContain('Last signed in 05 Oct, 18:30 (UK time)');
    expect(render('12h')).toContain('Last signed in 05 Oct, 6:30 pm (UK time)');
  });
});
