import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { type TimeFormat, ukRoleWindow } from '@thc/domain';
import { TimeFormatProvider } from '@thc/ui';

/**
 * ADR-0085 on /events: the Shift Builder's times are typed in `TimeField`s
 * (never the browser's `<input type="time">`, which draws on the device's
 * clock), written on the operator's clock, and still "(UK time)" with an
 * "HH:MM" value underneath. The summary window follows the clock too.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ShiftBuilder } = await import('../_components/ShiftBuilder');
const { RoleSection } = await import('../_components/RoleSection');
const { SummaryPanel } = await import('../_components/SummaryPanel');
const { newRoleDraft } = await import('../draft');
import type { EventDraft } from '../draft';

const DRAFT: EventDraft = {
  clientId: '',
  venueId: '',
  title: '',
  date: '2026-10-09',
  overallStart: '07:00',
  overallEnd: '23:30',
  poNumber: '',
  onsiteContact: '',
  notes: '',
  autoAssign: true,
  requiredLanguages: ['English'],
  roles: [],
};

const REFERENCE = { clients: [], venues: [], roles: [] };

function builder(format: TimeFormat, initial: EventDraft = DRAFT): string {
  return renderToStaticMarkup(
    <TimeFormatProvider format={format}>
      <ShiftBuilder
        mode="new"
        reference={REFERENCE}
        initial={initial}
        saved={null}
        confirmed={{}}
        booked={{}}
        locked={false}
        ratesVisible
        save={async () => ({ error: 'unused' })}
      />
    </TimeFormatProvider>,
  );
}

/** The `<input>` carrying a label's text, wherever the attributes fall. */
function inputFor(html: string, label: string): string {
  const id = new RegExp(`<label class="label" for="([^"]+)">(?:(?!</label>)[^])*?${label}`).exec(
    html,
  )?.[1];
  expect(id, `a label "${label}"`).toBeDefined();
  const tag = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0];
  expect(tag, `an input for "${label}"`).toBeDefined();
  return tag!;
}

describe('Shift Builder times (§3.2, §1.8, ADR-0085)', () => {
  it('never draws the browser time input, which shows the device clock', () => {
    const html = builder('24h', {
      ...DRAFT,
      roles: [newRoleDraft(DRAFT, 'role-waiting')],
    });
    expect(html).not.toContain('type="time"');
    expect(html).toContain('type="date"'); // dates are not part of this change
  });

  it('keeps the "(UK time)" labels on the overall window and on every role', () => {
    const html = builder('12h', { ...DRAFT, roles: [newRoleDraft(DRAFT, 'role-waiting')] });
    expect(html).toContain('Overall start (UK time)');
    expect(html).toContain('Overall end (UK time)');
    expect(html).toContain('Start (UK time)');
    expect(html).toContain('End (UK time)');
  });

  it('writes the overall window on a 24-hour clock by default', () => {
    const html = builder('24h');
    expect(inputFor(html, 'Overall start')).toContain('value="07:00"');
    expect(inputFor(html, 'Overall end')).toContain('value="23:30"');
    expect(html).toContain('(e.g. 17:00–01:30)');
  });

  it('writes the overall window on a 12-hour clock for an operator who chose it', () => {
    const html = builder('12h');
    expect(inputFor(html, 'Overall start')).toContain('value="7:00 am"');
    expect(inputFor(html, 'Overall end')).toContain('value="11:30 pm"');
    expect(html).toContain('(e.g. 5:00 pm–1:30 am)');
  });

  it('shows a role section on the chosen clock; the draft values stay HH:MM', () => {
    const role = newRoleDraft(DRAFT, 'role-waiting');
    expect(role.start).toBe('07:00');
    expect(role.end).toBe('23:30');
    expect(() => ukRoleWindow(DRAFT.date, role.start, role.end)).not.toThrow();

    const html = builder('12h', { ...DRAFT, roles: [role] });
    // The overall fields plus the role's own: two of each, all in 12-hour.
    expect(html.match(/value="7:00 am"/g)).toHaveLength(2);
    expect(html.match(/value="11:30 pm"/g)).toHaveLength(2);
  });

  it('says a locked event started at its UK time, on the chosen clock', () => {
    const role = { ...newRoleDraft(DRAFT, 'role-waiting'), start: '17:00', end: '23:00' };
    const draft = { ...DRAFT, roles: [role] };
    const html = renderToStaticMarkup(
      <TimeFormatProvider format="12h">
        <ShiftBuilder
          mode="edit"
          reference={REFERENCE}
          initial={draft}
          saved={null}
          confirmed={{}}
          booked={{}}
          locked
          ratesVisible
          save={async () => ({ error: 'unused' })}
        />
      </TimeFormatProvider>,
    );
    expect(html).toContain('started at 5:00 pm (UK)');
  });
});

describe('a role section (§3.5)', () => {
  const role = {
    ...newRoleDraft(DRAFT, 'role-waiting'),
    id: 'sec-1',
    start: '17:00',
    end: '23:00',
  };
  const original = { ...role, start: '16:00', end: '22:00' };

  function section(format: TimeFormat, locked = false): string {
    return renderToStaticMarkup(
      <TimeFormatProvider format={format}>
        <RoleSection
          mode="edit"
          index={0}
          role={role}
          date={DRAFT.date}
          issues={[]}
          roles={[]}
          client={undefined}
          confirmed={2}
          booked={2}
          changed={new Set(['starts_at', 'ends_at'])}
          original={original}
          locked={locked}
          ratesVisible
          onChange={() => {}}
          onRemove={() => {}}
        />
      </TimeFormatProvider>,
    );
  }

  it('writes the "was …" hints in the operator’s clock', () => {
    expect(section('24h')).toContain('was 16:00');
    expect(section('24h')).toContain('was 22:00');
    const twelve = section('12h');
    expect(twelve).toContain('was 4:00 pm');
    expect(twelve).toContain('was 10:00 pm');
    expect(twelve).not.toContain('was 16:00');
  });

  it('types into text fields whose value is the operator’s clock', () => {
    const twelve = section('12h');
    expect(inputFor(twelve, 'Start')).toContain('value="5:00 pm"');
    expect(inputFor(twelve, 'End')).toContain('value="11:00 pm"');
    const twentyFour = section('24h');
    expect(inputFor(twentyFour, 'Start')).toContain('value="17:00"');
    expect(twentyFour).not.toContain('type="time"');
  });

  it('writes the collapsed (locked) header on the chosen clock too', () => {
    expect(section('24h', true)).toContain('17:00 – 23:00');
    expect(section('12h', true)).toContain('5:00 pm – 11:00 pm');
  });
});

describe('the summary window (§3.2, RULE-18)', () => {
  const window = ukRoleWindow('2026-10-09', '07:00', '23:30');

  function summary(format: TimeFormat): string {
    return renderToStaticMarkup(
      <TimeFormatProvider format={format}>
        <SummaryPanel
          window={window}
          validRoles={1}
          erroredRoles={0}
          headcount={4}
          buffer={1}
          forecast={{
            payableHours: 0,
            chargePence: 0,
            basePayPence: 0,
            holidayPence: 0,
            marginPence: 0,
            marginPct: 0,
          }}
          ratesVisible={false}
        />
      </TimeFormatProvider>,
    );
  }

  it('is 24-hour by default and 12-hour on request', () => {
    expect(summary('24h')).toContain('07:00 – 23:30');
    expect(summary('12h')).toContain('7:00 am – 11:30 pm');
  });
});
