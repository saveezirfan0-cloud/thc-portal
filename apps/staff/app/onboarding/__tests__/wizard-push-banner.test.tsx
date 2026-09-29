import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The onboarding wizard asks for notifications too. A candidate is sent
 * pushes — N8 when a document is rejected, the OC3 reminders (ADR-0071) —
 * but only the working app's shell carried the banner, so a candidate was
 * never asked and those pushes mostly reached nobody. PushStatus itself is
 * held by push-banner.test.tsx; this pins where it appears.
 */
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../../_components/PushStatus', () => ({
  PushStatus: () => <div data-testid="push-status" />,
}));

const { WizardFrame, workerFor } = await import('../_components/Wizard');

const has = (html: string) => html.includes('data-testid="push-status"');

describe('the push banner in the onboarding wizard', () => {
  it('is on every signed-in step', () => {
    const html = renderToStaticMarkup(
      <WizardFrame worker={workerFor('Aisha', 'Bello')}>
        <p>step</p>
      </WizardFrame>,
    );
    expect(has(html)).toBe(true);
    expect(html.indexOf('push-status')).toBeLessThan(html.indexOf('<p>step</p>'));
  });

  it('is not on the centred full-screen states (closed account, failed quiz)', () => {
    const html = renderToStaticMarkup(
      <WizardFrame worker={workerFor('Aisha', 'Bello')} center>
        <p>locked</p>
      </WizardFrame>,
    );
    expect(has(html)).toBe(false);
  });

  it('is not shown when there is nobody signed in to register', () => {
    const html = renderToStaticMarkup(
      <WizardFrame worker={null}>
        <p>no project</p>
      </WizardFrame>,
    );
    expect(has(html)).toBe(false);
  });
});
