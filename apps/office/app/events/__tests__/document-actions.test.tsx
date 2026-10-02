import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentActions } from '../[id]/_components/DocumentActions';

/**
 * ADR-0074 (THC, 29.09.2026): the two §11.3 documents are the Allocation
 * Timesheet and the Completed Allocation Timesheet, and the event page says
 * so on its buttons. "Sign-out timesheet" is the code's word only.
 */
describe('the event page document buttons (§11.4, ADR-0074)', () => {
  it('before the event: Send / Download Allocation Timesheet only', () => {
    const markup = renderToStaticMarkup(<DocumentActions eventId="ev-1" started={false} />);
    expect(markup).toContain('>Send Allocation Timesheet</button>');
    expect(markup).toContain(
      '<a class="btn sm" href="/api/documents/ev-1?kind=allocation">Download Allocation Timesheet</a>',
    );
    expect(markup).not.toContain('Completed Timesheet');
  });

  it('once started: Download Completed Timesheet joins it, with no Send (ADR-0083)', () => {
    const markup = renderToStaticMarkup(<DocumentActions eventId="ev-1" started />);
    // It goes to the client with the invoice, from Reports › Financial.
    expect(markup).not.toContain('Send Completed Timesheet');
    expect(markup).toContain('>Send Allocation Timesheet</button>');
    expect(markup).toContain(
      '<a class="btn sm" href="/api/documents/ev-1?kind=signout">Download Completed Timesheet</a>',
    );
    expect(markup.toLowerCase()).not.toContain('sign-out');
    expect(markup.toLowerCase()).not.toContain('allocation sheet');
  });

  it('ADR-0081: a client with name badges gets Download Name Badges beside the Allocation Timesheet', () => {
    const markup = renderToStaticMarkup(<DocumentActions eventId="ev-1" started nameBadges />);
    expect(markup).toContain(
      '<a class="btn sm" href="/api/documents/ev-1/badges">Download Name Badges</a>',
    );
    // Once, with the Allocation Timesheet — never with the Completed one.
    expect(markup.match(/Download Name Badges/g)).toHaveLength(1);
    expect(markup.indexOf('Download Name Badges')).toBeLessThan(
      markup.indexOf('Download Completed Timesheet'),
    );
  });

  it('ADR-0081: no badge button for a client without them', () => {
    const markup = renderToStaticMarkup(<DocumentActions eventId="ev-1" started={false} />);
    expect(markup).not.toContain('Name Badges');
  });
});
