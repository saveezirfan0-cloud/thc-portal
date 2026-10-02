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
        when: 'Monday 09:00 UK — last week’s payroll CSV, and the New Starter (HMRC) CSV',
        warning:
          'The weekly job does not run, so no week is exported or marked as sent. Switched back on, it sends last week; earlier weeks are exported from Reports.',
      },
      {
        code: 'E5',
        label: 'Bank & payroll details updated',
        when: 'A worker changes their bank details',
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
    ],
  },
  {
    id: 'accounts',
    title: 'Candidate & login emails',
    channel: 'email',
    items: [
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
      { code: 'RC2', label: 'Profile updated', when: 'The office approves a profile change' },
      { code: 'RC3', label: 'Change not made', when: 'The office declines a profile change' },
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
