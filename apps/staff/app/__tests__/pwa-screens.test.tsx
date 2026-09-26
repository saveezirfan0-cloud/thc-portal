import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The two §10.5 screens, state by state, against wireframes/staff/auth.html
 * (Install · iOS / Android; Permissions · Notifications). Effects do not
 * run under renderToStaticMarkup, so each state is opened through the
 * screen's initial-state prop; the server action is stubbed.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../notifications/actions', () => ({ savePushSubscription: vi.fn() }));

const { InstallScreen } = await import('../install/InstallScreen');
const { NotificationsScreen } = await import('../notifications/NotificationsScreen');

const button = (html: string, label: string) =>
  new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}`).exec(html)?.[0] ?? '';

describe('/install (§10.5)', () => {
  it('iOS: the three Share → Add to Home Screen steps, in the wireframe’s words', () => {
    const html = renderToStaticMarkup(<InstallScreen initialPlatform="ios" />);
    expect(html).toContain('iPhone · Safari');
    expect(html).toContain('Tap the Share button below');
    expect(html).toContain('The square with an arrow, in Safari’s toolbar.');
    expect(html).toContain('Scroll the list if you don’t see it.');
    expect(html).toContain('Notifications on iPhone only work from the installed app');
    expect(html).not.toContain('Uses the browser’s own install prompt');
  });

  it('Android: the banner step, the ⋮ route, and the footnote that explains a missing button', () => {
    const html = renderToStaticMarkup(<InstallScreen initialPlatform="android" />);
    expect(html).toContain('Android · Chrome');
    expect(html).toContain('Tap “Install” on the banner');
    expect(html).toContain('Or use ⋮ → “Add to Home screen”.');
    expect(html).toContain('It opens full-screen without the browser bar.');
    expect(html).toContain('Uses the browser’s own install prompt where it’s available');
    expect(html).not.toContain('Share button');
  });

  it('a desktop reader is not told to tap Safari’s Share button', () => {
    const html = renderToStaticMarkup(<InstallScreen initialPlatform="other" />);
    expect(html).toContain('Install the app');
    expect(html).toContain('Open this address on your phone');
    expect(html).not.toContain('Share button');
  });

  it('installed: on to notifications, with "Open the app" at the 44px size', () => {
    const html = renderToStaticMarkup(<InstallScreen initialPlatform="installed" />);
    expect(html).toContain('You’re all set');
    expect(html).toContain('href="/notifications" class="btn primary block lg"');
    expect(html).toContain('href="/shifts" class="btn ghost block lg"');
  });
});

describe('/notifications (§10.5, §8 register)', () => {
  it('opens with the hero and the four register rows as title over sub-line', () => {
    const html = renderToStaticMarkup(<NotificationsScreen initialState="default" />);
    expect(html).toContain('class="auth-hero notif-hero"');
    expect(html).toContain('<h2 class="name">Turn on notifications</h2>');
    expect(html).toContain('<div class="t">Shift invitations</div>');
    expect(html).toContain('<div class="s">First to confirm takes the slot.</div>');
    expect(html).toContain('Miss it and you’re removed from the shift.');
    expect(html).toContain('30 minutes before start and end.');
    expect(html).toContain('A month, 2 weeks, 1 week before — and on the day.');
    expect(button(html, 'Turn on notifications')).not.toContain('disabled');
    expect(html).toContain('You can change this later in your phone’s settings.');
  });

  it('labels the rows in plain words, never with the register’s internal codes', () => {
    const html = renderToStaticMarkup(<NotificationsScreen initialState="default" />);
    for (const label of ['Invitations', 'Deadline', 'Check-in', 'Documents']) {
      expect(html).toContain(`<span class="pill purple">${label}</span>`);
    }
    expect(html).not.toMatch(/>N\d+b?</);
  });

  it('granted: says so, and the button is done', () => {
    const html = renderToStaticMarkup(<NotificationsScreen initialState="granted" />);
    expect(html).toContain('Notifications are on.');
    expect(button(html, 'Turn on notifications')).toContain('disabled');
  });

  it('denied: the settings walkthrough the banner’s "Show me how" points at', () => {
    const html = renderToStaticMarkup(<NotificationsScreen initialState="denied" />);
    expect(html).toContain('iPhone: Settings → Notifications → The Hospitality Company');
    expect(html).toContain('Android: Settings → Apps → The Hospitality Company');
    expect(html).toContain('Settings → Notifications → The Hospitality Company → Allow.');
    expect(button(html, 'Turn on notifications')).toContain('disabled');
  });

  it('needs-install: the iOS sentence with the link to /install, button held', () => {
    const html = renderToStaticMarkup(<NotificationsScreen initialState="needs-install" />);
    expect(html).toContain('On iPhone, notifications only work from the installed app');
    expect(html).toContain('href="/install"');
    expect(button(html, 'Turn on notifications')).toContain('disabled');
  });

  it('unconfigured: nobody has push yet, and it says so', () => {
    const html = renderToStaticMarkup(<NotificationsScreen initialState="unconfigured" />);
    expect(html).toContain('Notifications are not switched on for this version of the app.');
    expect(button(html, 'Turn on notifications')).toContain('disabled');
  });
});
