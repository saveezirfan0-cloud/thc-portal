/**
 * Notification switches — which sends /settings → Notifications can turn
 * off (ADR-0083).
 *
 * The switch itself is in the database: `settings.notification_switches`
 * holds the codes that are OFF as `{"<code>": false}`, and
 * claim_outbox_batch() settles a due row whose code is off instead of
 * handing it to the drain (20261002113000). BG08 is also stopped at the
 * job, before it stamps a week into the payroll export.
 *
 * This file is the list the screen draws: every code the drain can send —
 * the register (TEMPLATES) and the three document emails — in groups by
 * who receives it, with a name a manager recognises. E1 is not here:
 * Willo sends it, so there is nothing of ours to switch off. The test
 * holds the list to exactly that set, so a code added to the register
 * cannot be left without a switch.
 */

import type { DocumentEmailCode } from './documents.ts';
import type { TemplateCode } from './templates.ts';

export type SwitchableCode = Exclude<TemplateCode, 'E1'> | DocumentEmailCode;

export interface NotificationSwitch {
  code: SwitchableCode;
  /** What a manager calls it. */
  label: string;
  /** When it goes, in a few words. */
  when: string;
  /** Said beside the switch while it is off — what stops working. */
  warning?: string;
}

export interface NotificationSwitchGroup {
  id: 'finance' | 'office' | 'clients' | 'accounts' | 'workers';
  title: string;
  /** Email or push — what the group's rows are. */
  channel: 'email' | 'push';
  items: readonly NotificationSwitch[];
}

export const NOTIFICATION_SWITCH_GROUPS: readonly NotificationSwitchGroup[] = [
  {
    id: 'finance',
    title: 'Finance & payroll emails',
    channel: 'email',
    items: [
      {
        code: 'BG08',
        label: 'Weekly payroll email',
        when: 'Monday 09:00 UK — last week’s payroll CSV',
        warning:
          'The weekly job does not run, so no week is exported or marked as sent. Switched back on, it sends last week; earlier weeks are exported from Reports.',
      },
      {
        code: 'NS1',
        label: 'New Starter (HMRC) report',
        when: 'Monday 09:00 UK, when there were new starters — to Payroll and Gisela, on its own',
        warning:
          'New starters are not sent to Payroll. Switched back on, the next Monday sends everyone not yet sent, including the weeks in between.',
      },
      {
        code: 'E5',
        label: 'Bank & payroll details updated',
        when: 'A worker changes their bank details',
      },
      {
        code: 'E5b',
        label: 'Bank details changed outside the app',
        when: 'The office, or the system, changes a worker’s bank details',
        warning:
          'Payroll is not told when an office login or the system changes a worker’s bank details.',
      },
      { code: 'E6', label: 'NI number entered', when: 'A worker who joined without one enters it' },
      {
        code: 'E7',
        label: 'Contact details updated',
        when: 'A worker changes their email or home address',
      },
      {
        code: 'RC4',
        label: 'Name change approved',
        when: 'The office approves a worker’s name change',
      },
    ],
  },
  {
    id: 'office',
    title: 'Office emails',
    channel: 'email',
    items: [
      { code: 'E8', label: 'P45 requested', when: 'A worker requests their P45 and leaves' },
      { code: 'E9', label: 'Criminal conviction declared', when: 'A worker declares a conviction' },
      {
        code: 'E10',
        label: 'Confirmed worker self-cancelled',
        when: 'A worker cancels a confirmed shift',
      },
      { code: 'OF5', label: 'Cover requested', when: 'A worker asks for cover inside 72 hours' },
      {
        code: 'CR3',
        label: 'Client quiz not passed',
        when: 'A worker fails the last attempt at a client’s quiz',
        warning: 'The office is not told when a worker runs out of attempts at a client’s quiz.',
      },
      {
        code: 'CP1',
        label: 'Client asked for a worker again',
        when: 'A client presses “Request again” in the Client Portal',
        warning:
          'The office is not emailed when a client asks for a worker again; the request still shows on the client card.',
      },
      {
        code: 'TK1',
        label: 'Ticket logged or updated',
        when: 'Someone logs a ticket, or comments on one, in the Back Office',
        warning:
          'Nobody is emailed when a ticket is logged or updated; they still show on Tickets.',
      },
      {
        code: 'RC1',
        label: 'Profile change requested',
        when: 'A worker asks to change name, photo or date of birth',
      },
      {
        code: 'CL3',
        label: 'Completion letter to review',
        when: 'A worker uploads a completion letter',
      },
      {
        code: 'CL4',
        label: 'Right to work expiring',
        when: '60, 30 and 14 days before a right to work ends',
      },
      { code: 'CL5', label: '48-hour opt-out signed', when: 'A worker signs the opt-out' },
      { code: 'CL6', label: '48-hour opt-out cancelled', when: 'A worker cancels the opt-out' },
    ],
  },
  {
    id: 'clients',
    title: 'Client emails',
    channel: 'email',
    items: [
      {
        code: 'D1',
        label: 'Allocation Timesheet',
        when: 'Before the event — sent from the event page, or automatically',
      },
      {
        code: 'D2',
        label: 'Completed Allocation Timesheet',
        when: 'After the event — sent from the event page, or automatically',
      },
      {
        code: 'INV1',
        label: 'Invoice',
        when: '10:00 the morning after the last event on a PO — with the completed timesheets attached',
      },
      {
        code: 'CP2',
        label: 'Line-up fully confirmed',
        when: 'Every role of an upcoming event is confirmed — once per event, 07:00–23:00 UK',
        warning:
          'No client is told their line-up is fully confirmed. Each client card also has its own switch.',
      },
      {
        code: 'CP3',
        label: 'Line-up changed after the Allocation Timesheet',
        when: 'Someone joins or leaves after the timesheet went — at most hourly, 07:00–23:00 UK',
        warning:
          'No client is told their line-up changed after the timesheet went. Each client card also has its own switch.',
      },
    ],
  },
  {
    id: 'accounts',
    title: 'Candidate & login emails',
    channel: 'email',
    items: [
      {
        code: 'IR1',
        label: 'Daily reminder to apply (THC invite list)',
        when: 'Someone on the THC list on Staff → Invite list has not applied yet',
      },
      {
        code: 'OC1',
        label: 'Video interview reminder',
        when: 'A candidate has not done their Willo interview',
      },
      {
        code: 'E2',
        label: 'Application rejected (after interview)',
        when: 'On the rejection decision',
      },
      {
        code: 'E2b',
        label: 'Application rejected',
        when: 'Rejected before or after the interview stage',
      },
      {
        code: 'E3',
        label: 'Activate your account',
        when: 'A candidate is accepted after the interview',
        warning:
          'Accepted candidates get no link to set a password, so they cannot start onboarding.',
      },
      {
        code: 'OC2',
        label: 'Account set-up reminder',
        when: 'An accepted candidate has not set a password',
      },
      {
        code: 'OC4',
        label: 'Onboarding reminder by email',
        when: 'Daily, the app reminder by email with how to do the step: in place of the push when notifications are off, beside it when they are on',
        warning:
          'Candidates with notifications off are not reminded at all; the board says so in amber.',
      },
      { code: 'E12', label: 'Documents approved', when: 'A candidate’s last document is verified' },
      { code: 'E4', label: 'Health & Safety quiz failed', when: 'On the third failed attempt' },
      {
        code: 'E11',
        label: 'Back Office / Client Portal login',
        when: 'A login is invited on Users, or sent a new set-up link',
        warning: 'New logins get no set-up link by email — copy it from Users instead.',
      },
    ],
  },
  {
    id: 'workers',
    title: 'Staff App push notifications',
    channel: 'push',
    items: [
      {
        code: 'N5',
        label: 'New shift invitation',
        when: 'Auto-assign or the office invites a worker',
      },
      { code: 'N10', label: 'You’re booked', when: 'An invitation is confirmed' },
      { code: 'N10c', label: 'Shift filled', when: 'A worker accepts after the role is full' },
      { code: 'N10d', label: 'Invitation withdrawn', when: 'The office withdraws an invitation' },
      {
        code: 'N10e',
        label: 'Shift no longer needed',
        when: 'The office removes a role a worker applied for',
      },
      {
        code: 'N6',
        label: 'Confirm tomorrow’s shift',
        when: 'The day before — “I’m ready” by 12:00',
      },
      {
        code: 'N6b',
        label: 'Removed from tomorrow’s shift',
        when: '12:05 the day before, if not ready',
      },
      { code: 'N7', label: 'Confirm today’s shift', when: 'On the day' },
      { code: 'N9', label: 'Your shift today', when: 'Check-in reminders on the day' },
      {
        code: 'CK1',
        label: 'Check in and out today',
        when: '07:00 UK on the day of a shift, or 3 hours before an earlier start',
        warning:
          'Workers are not reminded in the morning to check in and out; the reminders 30 minutes before the start and the end still go.',
      },
      { code: 'N9b', label: 'You haven’t checked out', when: 'After the shift ends' },
      { code: 'N13', label: 'Break reminder', when: 'During a shift' },
      { code: 'N10b', label: 'Shift cancelled', when: 'The office cancels a booking' },
      { code: 'N11', label: 'Shift time changed', when: 'A role’s times change' },
      { code: 'N11b', label: 'Shift details changed', when: 'Venue or details change' },
      { code: 'N12', label: 'Event cancelled', when: 'The event is cancelled' },
      { code: 'OF1', label: 'Shift up for grabs', when: 'Another worker offers a shift' },
      { code: 'OF2', label: 'Shift handed over', when: 'An offered shift is taken' },
      { code: 'OF3', label: 'You’re still booked', when: 'An offered shift is not taken' },
      {
        code: 'OF4',
        label: 'You’re booked (taken shift)',
        when: 'A worker takes an offered shift',
      },
      { code: 'OF6', label: 'Cover request closed', when: 'The office declines a cover request' },
      { code: 'N1', label: 'Document expiring (first notice)', when: 'Expiry ladder' },
      { code: 'N2', label: 'Document expiring (second notice)', when: 'Expiry ladder' },
      { code: 'N3', label: 'Document expiring (final notice)', when: 'Expiry ladder' },
      { code: 'N4', label: 'Document expired', when: 'On expiry — the worker is blocked' },
      { code: 'N8', label: 'Document rejected', when: 'The office rejects a document' },
      {
        code: 'CL1',
        label: 'Completion letter received',
        when: 'A worker uploads a completion letter',
      },
      { code: 'CL2', label: 'Completion letter approved', when: 'The office approves it' },
      { code: 'N14', label: 'Weekly limit changed', when: 'A worker’s weekly hours limit changes' },
      { code: 'N15', label: 'Shifts open again', when: 'A block is lifted' },
      {
        code: 'DR1',
        label: 'More detail needed on a declaration',
        when: 'The office asks for more details on a criminal declaration',
        warning:
          'Workers are not told the office asked; the request still shows on their Documents and onboarding screens.',
      },
      { code: 'RC2', label: 'Profile updated', when: 'The office approves a profile change' },
      {
        code: 'CR1',
        label: 'Quiz before your first shift',
        when: 'A worker is first booked on a role a client asks a quiz for',
        warning:
          'Workers are not told a client’s quiz is waiting; it still shows on their Shifts tab.',
      },
      {
        code: 'CR2',
        label: 'What to bring today',
        when: 'The morning of a shift on a role a client has a kit message for, or for a client with name badges',
        warning:
          'Workers are not reminded what to bring; the message still shows on the shift until they confirm it.',
      },
      {
        code: 'SC1',
        label: 'Bring ID to a security-cleared event',
        when: 'A worker is confirmed on an event marked Security cleared',
        warning:
          'Workers are not told to bring a passport or driving licence; the note still shows on the shift.',
      },
      { code: 'RC3', label: 'Change not made', when: 'The office declines a profile change' },
      {
        code: 'RC5',
        label: 'Profile photo not accepted',
        when: 'The office rejects a worker’s profile selfie',
      },
      {
        code: 'OC3',
        label: 'Finish your onboarding',
        when: 'Daily, while a candidate has a step waiting',
      },
      {
        code: 'OM1',
        label: 'Event message',
        when: 'The office messages an event’s staff',
        warning: 'Messages sent from the event board are not delivered.',
      },
      {
        code: 'OM2',
        label: 'Message from the office',
        when: 'The office messages chosen workers',
        warning: 'Messages sent from Staff are not delivered.',
      },
    ],
  },
];

export const NOTIFICATION_SWITCHES: readonly NotificationSwitch[] =
  NOTIFICATION_SWITCH_GROUPS.flatMap((group) => group.items);

const SWITCHABLE = new Set<string>(NOTIFICATION_SWITCHES.map((s) => s.code));

export function isSwitchableCode(code: string): code is SwitchableCode {
  return SWITCHABLE.has(code);
}

/**
 * The codes switched off in a `settings.notification_switches` value. Only
 * a JSON false is off — the same rule as notification_switched_on() in SQL,
 * so the screen can never show "on" for something the database is holding.
 */
export function switchedOff(value: unknown): SwitchableCode[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([code, on]) => on === false && isSwitchableCode(code))
    .map(([code]) => code as SwitchableCode);
}

/** The reason claim_outbox_batch() writes on a row it did not send. */
export const SWITCHED_OFF_ERROR = 'Not sent: switched off in Settings';
