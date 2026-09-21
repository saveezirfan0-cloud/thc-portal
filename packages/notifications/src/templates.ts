/**
 * Notification register — Scope §8.
 *
 * Copy is DATA, not code. Every push (N*) and email (E*) named in §8 gets one
 * entry here, and every send goes through `notification_outbox` with a unique
 * key so a job re-run can never double-send.
 *
 * Copy is verbatim from §8; where §8 states a trigger in prose rather than the
 * sendable string (N1, N8, N11, E3–E9) the copy is taken from the screen that
 * carries the same wording — `wireframes/staff/locks.html` for the push
 * register, §10.1 for E4, §10.6/§10.7 for E8/E9 — and every such case is listed
 * in `REGISTER-NOTES.md`.
 *
 * Nothing here sends: senders, retries and the outbox drain land in a later
 * phase. This module is the single source of copy they read.
 */

export type Channel = 'push' | 'email';

/**
 * Sender for emails (§9.12). `admin` and `timesheets` are the only two THC
 * addresses, both configured as environment settings so either can change
 * without a release. `willo` marks a message Willo sends itself — the copy
 * lives in Willo, not here, and the system must never send it (§8, E1).
 */
export type Sender = 'admin' | 'timesheets' | 'willo';

export interface Template {
  /** The register code, e.g. "N6b" or "E3". */
  code: string;
  channel: Channel;
  /** Push: the notification title. Email: the subject line. */
  title: string;
  /** Verbatim from §8. Placeholders are `{name}` style. */
  body: string;
  /** §8 "Trigger" column — what makes this fire. */
  trigger: string;
  /** §8 "Timing" column — when it fires relative to the trigger. */
  timing: string;
  /** §8 "Phase" column: the scope marks this send as mandatory. */
  mandatory?: boolean;
  /** Sender for emails (§9.12): admin@ or timesheets@ — or Willo for E1. */
  sender?: Sender;
  /** Fixed recipients named in §8 for the office/payroll emails. */
  recipients?: readonly string[];
  /** Where tapping the push should land the worker (routes: §08 inventory). */
  deepLink?: string;
  /**
   * One code, two halves. §8 gives N9 as a pair — the sender picks the half,
   * and the outbox key must carry the variant so the two do not collide.
   */
  variants?: Readonly<Record<string, { body: string }>>;
}

const PAYROLL = [
  'gisela@thehospitalitycompany.co.uk',
  'thc_payroll@topsourceworldwide.com',
] as const;
const OFFICE = ['admin@thehospitalitycompany.co.uk'] as const;
const OFFICE_AND_PAYROLL = [
  'admin@thehospitalitycompany.co.uk',
  'thc_payroll@topsourceworldwide.com',
] as const;

export const TEMPLATES = {
  // ────────────────────────────────────────────────────────────────────────
  // PUSH — Staffing App, Web Push in the PWA (§8, §10.5). Device-level: every
  // one of these must reach the worker with the app closed.
  // ────────────────────────────────────────────────────────────────────────

  // Document expiry ladder (§4.2) — N1 → N2 → N3 → N4 (block).
  N1: {
    code: 'N1',
    channel: 'push',
    title: 'Document expiring',
    body: 'Update your {document} — it expires on {date}',
    trigger: 'Document expiring',
    timing: '1 month before',
    deepLink: '/documents',
  },
  N2: {
    code: 'N2',
    channel: 'push',
    title: 'Document expiring',
    body: 'Update your {document} — 2 weeks left',
    trigger: 'Document expiring',
    timing: '2 weeks before',
    deepLink: '/documents',
  },
  N3: {
    code: 'N3',
    channel: 'push',
    title: 'Document expiring',
    body: 'Final reminder: update your {document}',
    trigger: 'Document expiring',
    timing: '1 week before',
    deepLink: '/documents',
  },
  N4: {
    code: 'N4',
    channel: 'push',
    title: 'Document expired',
    body: 'You have been blocked — please update',
    trigger: 'Document expired',
    timing: 'on the day (+ automatic block)',
    deepLink: '/documents',
  },

  // Invitation and the three-stage confirmation (§3.5).
  N5: {
    code: 'N5',
    channel: 'push',
    title: 'Shift invitation',
    body: '{role} · {event} · {dateTime} · {rate}/h',
    trigger: 'Shift invitation',
    timing: 'on invite',
    deepLink: '/invites/{invitationId}',
  },
  N6: {
    code: 'N6',
    channel: 'push',
    title: 'Day-before',
    body: "Confirm tomorrow's shift by 12:00 today — or you'll be removed from it",
    trigger: 'Day-before',
    timing: 'the day before (cutoff 12:00)',
    deepLink: '/shifts/{bookingId}',
  },
  N6b: {
    code: 'N6b',
    channel: 'push',
    title: 'Automatically dropped for missing the day-before deadline',
    body: 'You have been removed from your shift tomorrow as we have not received your re-confirmation by the 12:00 deadline',
    trigger: 'Automatically dropped for missing the day-before deadline',
    timing: 'at the moment of the automatic 12:05 cutoff (confirmed 01.09.2026)',
    deepLink: '/shifts',
  },
  N7: {
    code: 'N7',
    channel: 'push',
    title: 'On-the-day',
    body: "Confirm today's shift",
    trigger: 'On-the-day',
    timing: 'on the day of the shift',
    deepLink: '/shifts/{bookingId}',
  },

  // Review outcomes.
  N8: {
    code: 'N8',
    channel: 'push',
    title: 'Document rejected',
    body: 'Document rejected — {reason}. Re-upload.',
    trigger: 'Document rejected',
    timing: 'on reject',
    deepLink: '/documents',
  },

  // Check-in / check-out / breaks (§5).
  N9: {
    code: 'N9',
    channel: 'push',
    title: '30 min before start / end',
    body: "Time to check in / Don't forget to check out",
    trigger: '30 min before start / end',
    timing:
      '−30 min — each half is skipped if the worker has already signed in / signed out respectively',
    deepLink: '/shifts/{bookingId}',
    variants: {
      'check-in': { body: 'Time to check in' },
      'check-out': { body: "Don't forget to check out" },
    },
  },
  N9b: {
    code: 'N9b',
    channel: 'push',
    title: "Still not checked out 30 minutes after the shift's scheduled end",
    body: "You haven't checked out of {event} yet — tap to check out.",
    trigger: "Still not checked out 30 minutes after the shift's scheduled end",
    timing:
      '+30 min after the scheduled end — skipped if the worker has already checked out; sent once, not repeated, and leaves 3.5 hours before the check-out button locks (RULE-02, §5.2)',
    deepLink: '/shifts/{bookingId}',
  },
  N13: {
    code: 'N13',
    channel: 'push',
    title: '6 hours on shift with no break logged (unpaid-break clients only)',
    body: "You've been on shift 6 hours — please ask your manager on site about taking your break.",
    trigger: '6 hours on shift with no break logged (unpaid-break clients only)',
    timing:
      '+6 h after check-in — once per shift, skipped if a break has already been started (§5.2b, §7 BG-10)',
    deepLink: '/shifts/{bookingId}',
  },

  // Radar and office changes.
  N10: {
    code: 'N10',
    channel: 'push',
    title: 'Radar application accepted',
    body: "You're booked! Your application for {event} on {date} has been accepted. Tap to view your shift details.",
    trigger: 'Radar application accepted',
    timing:
      "on the booking's transition to Confirmed for a Radar self-application (Booking.source = self) — whether the manager picks the applicant manually from the Potential pool, or auto-assign/first-to-confirm fills the role while the application is still pending",
    mandatory: true,
    deepLink: '/shifts/{bookingId}',
  },
  N10b: {
    code: 'N10b',
    channel: 'push',
    title: 'Shift cancelled by the office (manager presses Withdraw)',
    body: "You've been removed from {event} · {dateTime}",
    trigger: 'Shift cancelled by the office (manager presses Withdraw)',
    timing: 'on change (confirmed 14.07.2026)',
    mandatory: true,
    deepLink: '/shifts',
  },
  N10c: {
    code: 'N10c',
    channel: 'push',
    title: 'Radar application not taken forward',
    body: 'Shift update: the {event} shift on {date} has now been filled. Keep an eye on Radar — new shifts are added regularly.',
    trigger:
      'Radar application not taken forward (the role fills before or without the office reviewing this specific application)',
    timing:
      'the moment the role becomes fully confirmed and drops off the event board (§3.3) — one trigger covers both a manual office pick of someone else and an automatic auto-assign/first-to-confirm fill',
    mandatory: true,
    deepLink: '/radar',
  },
  N11: {
    code: 'N11',
    channel: 'push',
    title: 'Event time / date changed',
    body: 'Shift time changed — now {window}',
    trigger: 'Event time / date changed (start time OR end time — either one triggers this push)',
    timing:
      'on change — delivered as a standard device-level push (FCM/APNs, §1.3), reaching the worker even if the Staffing App is closed',
    deepLink: '/shifts/{bookingId}',
  },
  N12: {
    code: 'N12',
    channel: 'push',
    title: 'Event cancelled by the office',
    body: 'This event has been cancelled',
    trigger:
      'Event cancelled by the office (client cancelled the booking) — reaches every Confirmed and Invited worker, plus anyone with an open Radar application for this event (Booking.source = self, still pending), not just Confirmed/Invited (confirmed 08.09.2026)',
    timing: 'on cancel',
    mandatory: true,
    deepLink: '/shifts',
  },

  // Compliance outcomes.
  N14: {
    code: 'N14',
    channel: 'push',
    title: 'Weekly hours cap changes band',
    body: 'Your weekly limit is now {limit} hours — {band} until {date}.',
    trigger:
      'Weekly hours cap changes band — term time starts or ends, or a completion letter is verified (§4.4, §4.5)',
    timing:
      'On the morning the change takes effect, from the daily compliance job (§7) — once per change',
    deepLink: '/documents',
  },
  N15: {
    code: 'N15',
    channel: 'push',
    title: 'Declared conviction accepted — unblocked',
    body: "Thanks for your patience — your shifts are open again. Tap to see what's available.",
    trigger:
      'A declared conviction has been reviewed and accepted, and the worker is unblocked (§10.7)',
    timing:
      'On the manager verifying the declaration and the full compliance re-check passing (§4.3)',
    deepLink: '/radar',
  },

  // ────────────────────────────────────────────────────────────────────────
  // EMAIL — email survives only where the app does not exist yet (before
  // onboarding) or where Willo sends the message itself (§8). Senders §9.12.
  // ────────────────────────────────────────────────────────────────────────

  E1: {
    code: 'E1',
    channel: 'email',
    sender: 'willo',
    title: 'Interview invitation',
    body: 'Sent by Willo, not by this system — the copy and the template live in Willo (§2.2, §8).',
    trigger: 'Form submitted',
    timing: 'immediately on form submission (§2.7)',
  },
  E2: {
    code: 'E2',
    channel: 'email',
    sender: 'admin',
    title: 'Your application to The Hospitality Company',
    body: 'Thank you for taking the time to complete your interview with The Hospitality Company. On this occasion we will not be taking your application further. We wish you the very best.',
    trigger:
      'Interview rejection — sent by the system, not by Willo, so the wording is THC’s and is the same for every rejection route (§2.7)',
    timing: 'on the rejection decision',
    mandatory: true,
  },
  E3: {
    code: 'E3',
    channel: 'email',
    sender: 'admin',
    title: 'Activate your account',
    body: 'Your application was accepted. Set your password to start onboarding: {link}',
    trigger: 'Accepted after the interview — activation + password + "download the app"',
    timing: 'on acceptance. The only mandatory system email (§8)',
    mandatory: true,
  },
  E4: {
    code: 'E4',
    channel: 'email',
    sender: 'admin',
    title: 'Health & Safety Assessment — Unsuccessful',
    body: "Unfortunately, you haven't passed the Health & Safety assessment after three attempts, which is the maximum number permitted at this stage. As passing this assessment is a required part of onboarding, we're unable to progress your application any further at this time.",
    trigger: 'Quiz failed 3× — the same wording as the in-app terminal screen (§10.1)',
    timing: 'on the third failed attempt (§2.9)',
    mandatory: true,
  },
  E5: {
    code: 'E5',
    channel: 'email',
    sender: 'admin',
    recipients: PAYROLL,
    title: 'Bank & payroll details updated — {name}, Employee ID {employeeId}',
    body: 'A worker has updated their bank & payroll details.\n\nName: {name}\nEmployee ID: {employeeId}\nChanged: {changedAt}',
    trigger: 'Worker updates bank & payroll details (§2.10, §10.1)',
    timing: 'on save',
    mandatory: true,
  },
  E6: {
    code: 'E6',
    channel: 'email',
    sender: 'admin',
    recipients: PAYROLL,
    title: 'NI number entered — {name}, Employee ID {employeeId}',
    body: 'A worker who joined without an NI number has now entered one.\n\nName: {name}\nEmployee ID: {employeeId}\nEntered: {changedAt}',
    trigger: 'Worker enters their NI number after joining without one (§2.10)',
    timing: 'on save',
    mandatory: true,
  },
  E7: {
    code: 'E7',
    channel: 'email',
    sender: 'admin',
    recipients: OFFICE_AND_PAYROLL,
    title: 'Contact details updated — {name}, Employee ID {employeeId}',
    body: 'A worker has updated their contact details in Profile details.\n\nName: {name}\nEmployee ID: {employeeId}\nChanged: {changedAt}\nWhat changed: {changed}',
    trigger: 'Worker updates their email address or home address in Profile details (§10.1)',
    timing: 'on save — a new email address is verified by confirmation code first (§10.1)',
    mandatory: true,
  },
  E8: {
    code: 'E8',
    channel: 'email',
    sender: 'admin',
    recipients: OFFICE,
    title: 'P45 requested — {name}, Employee ID {employeeId}',
    body: 'Name: {name}\nEmployee ID: {employeeId}\nNI number: {niNumber}\nRequested: {requestedAt}\nReason given: {reason}\nLast completed shift: {lastShiftDate}\n\nFuture shifts released by this request (event · client · venue · role · date):\n{releasedShifts}',
    trigger: 'Worker requests their P45 and leaves (§10.6)',
    timing: 'immediately, not batched',
    mandatory: true,
  },
  E9: {
    code: 'E9',
    channel: 'email',
    sender: 'admin',
    recipients: OFFICE,
    title: 'Criminal conviction declared — {name}, Employee ID {employeeId}',
    body: 'Name: {name}\nEmployee ID: {employeeId}\nDeclared: {declaredAt}\n\nFuture shifts released by this declaration (event · client · venue · role · date):\n{releasedShifts}\n\nThe declaration details are not included in this email — they are read in the Back Office, where access is role-controlled.',
    trigger: 'Worker declares a criminal conviction while working (§10.7)',
    timing: 'immediately, not batched',
    mandatory: true,
  },
} as const satisfies Record<string, Template>;

export type TemplateCode = keyof typeof TEMPLATES;

/** Every code §8 names, in register order. The test holds this to the scope. */
export const SCOPE_CODES = [
  'N1',
  'N2',
  'N3',
  'N4',
  'N5',
  'N6',
  'N6b',
  'N7',
  'N8',
  'N9',
  'N9b',
  'N10',
  'N10b',
  'N10c',
  'N11',
  'N12',
  'N13',
  'N14',
  'N15',
  'E1',
  'E2',
  'E3',
  'E4',
  'E5',
  'E6',
  'E7',
  'E8',
  'E9',
] as const satisfies readonly TemplateCode[];

export function template(code: TemplateCode): Template {
  return TEMPLATES[code];
}

/**
 * The body to send. A code with `variants` (only N9) has no single body: the
 * caller names the half, and the combined §8 copy is never sent as-is.
 */
export function body(code: TemplateCode, variant?: string): string {
  const entry: Template = TEMPLATES[code];
  if (!entry.variants) {
    if (variant !== undefined) throw new Error(`${code} has no variants`);
    return entry.body;
  }
  if (variant === undefined)
    throw new Error(`${code} needs a variant: ${Object.keys(entry.variants).join(' | ')}`);
  const half = entry.variants[variant];
  if (!half) throw new Error(`${code} has no variant "${variant}"`);
  return half.body;
}

/**
 * The idempotency key for an outbox row. The same code for the same subject
 * is written once; a re-run of the job hits the unique index and does nothing.
 * A variant (N9's two halves) is part of the key, so the pair cannot collide.
 */
export function outboxKey(
  code: string,
  subject: string,
  id: string | number,
  variant?: string,
): string {
  return variant === undefined ? `${code}:${subject}:${id}` : `${code}:${subject}:${id}:${variant}`;
}

export function render(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
