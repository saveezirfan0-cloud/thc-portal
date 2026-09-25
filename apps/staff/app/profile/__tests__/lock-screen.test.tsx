import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { QUIZ_FAILED_COPY, QUIZ_FAILED_TITLE } from '@thc/domain';
import { TEMPLATES } from '@thc/notifications';

/**
 * §10.1 case 3 — "a terminal screen carrying the same wording as the
 * rejection email" (E4). The screen and the template both read the domain
 * constant; this pins the screen to it, so the two cannot drift apart.
 * Layout per wireframes/staff/onboarding-2.html ("Terminal — failed 3
 * times"): badge, heading, copy, contact line, the attempts, then Sign out.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { LockScreen } = await import('../_components/LockScreen');

/** renderToStaticMarkup escapes quotes and ampersands; undo that to compare prose. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}

describe('the quiz-failed lock screen (§10.1 case 3, §8 E4)', () => {
  const html = renderToStaticMarkup(
    <LockScreen
      lock="quiz_failed"
      detail={
        <ul>
          <li>Attempt 1</li>
          <li>Attempt 2</li>
          <li>Attempt 3</li>
        </ul>
      }
    />,
  );

  it('carries E4 verbatim — the title and the body', () => {
    const plain = text(html);
    expect(plain).toContain(QUIZ_FAILED_TITLE);
    expect(plain).toContain(QUIZ_FAILED_COPY);
    expect(plain).toContain(TEMPLATES.E4.body);
    expect(plain).toContain('Application closed');
  });

  it('puts the attempts between the contact line and Sign out, as the wireframe does', () => {
    const contact = html.indexOf('If you have any questions');
    const attempts = html.indexOf('Attempt 1');
    const signOut = html.indexOf('Sign out');
    expect(contact).toBeGreaterThan(-1);
    expect(contact).toBeLessThan(attempts);
    expect(attempts).toBeLessThan(signOut);
  });
});

describe('the other locks never carry E4', () => {
  it.each(['rejected', 'hold', 'removed'] as const)('%s', (lock) => {
    const plain = text(renderToStaticMarkup(<LockScreen lock={lock} />));
    expect(plain).not.toContain('Health & Safety');
    expect(plain).toContain('admin@thehospitalitycompany.co.uk');
  });
});
