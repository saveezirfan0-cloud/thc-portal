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
 * Beyond §8 the register carries four more families, each in its own list:
 * the completion letter requirement's CL codes (REQUIREMENT_CODES), two
 * extensions §8 should have named (EXTENSION_CODES), and the Staff App
 * additions RC and OF (ADDITION_CODES, ADR-0038/0039, docs/18).
 *
 * Nothing here sends. The drain (`drain.ts`, run by the `notify-drain` Edge
 * Function) reads this copy; the sender ADDRESS for `sender: 'admin' |
 * 'timesheets'` comes from `settings.senders` at send time (`senders.ts`),
 * never from this file.
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
  /**
   * Push: the heading the worker sees above the body — short, and worker-safe.
   * §8 gives no push titles (its galleries render a push as the app name plus
   * the body), so these are ours; the §8 Trigger text stays in `trigger`,
   * because some of it is office language that must never reach a worker.
   * Email: the subject line.
   */
  title: string;
  /**
   * Verbatim from §8. Placeholders are `{name}` style. Absent on a code whose
   * copy only exists per variant (N9) — read it through `body()`, never here.
   */
  body?: string;
  /**
   * The §8 Content cell as written, where it is not itself sendable.
   * Reference only: never send this.
   */
  scopeCopy?: string;
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
   * The one button §8 gives a push — "Re-upload" on N8 ("Document rejected
   * — [reason]" + a Re-upload button, §2.3/§2.6). The service worker draws
   * it where the platform draws notification buttons (Android, desktop);
   * pressing it opens `deepLink`, the same as tapping the notification, and
   * iOS — which draws no buttons — still lands on the deep link where the
   * button lives.
   */
  action?: string;
  /**
   * Routes the row's `link` payload value may pick instead of `deepLink`,
   * for a push whose right landing depends on who receives it (N8: a
   * candidate re-uploads in the onboarding wizard, a worker on the Documents
   * hub). Anything else in `link` is ignored and `deepLink` is used: the
   * payload never names an arbitrary URL.
   */
  deepLinkOptions?: readonly string[];
  /**
   * The notification's collapse tag, `{placeholder}` style. A second push
   * with the same rendered tag replaces the first on the device. Absent, or
   * left with an unfilled placeholder, the deep link is the tag.
   */
  tag?: string;
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
    title: 'New shift invitation',
    body: '{role} · {event} · {dateTime} · {rate}/h',
    trigger: 'Shift invitation',
    timing: 'on invite',
    deepLink: '/invites/{invitationId}',
  },
  N6: {
    code: 'N6',
    channel: 'push',
    title: "Confirm tomorrow's shift",
    body: "Confirm tomorrow's shift by 12:00 today — or you'll be removed from it",
    trigger: 'Day-before',
    timing: 'the day before (cutoff 12:00)',
    // The "I'm ready" button lives on the /shifts card, not the shift detail
    // screen (wireframes: staff-app shifts vs shift-detail), so the push
    // opens where the worker can act on it.
    deepLink: '/shifts',
  },
  N6b: {
    code: 'N6b',
    channel: 'push',
    title: "Removed from tomorrow's shift",
    body: 'You have been removed from your shift tomorrow as we have not received your re-confirmation by the 12:00 deadline',
    trigger: 'Automatically dropped for missing the day-before deadline',
    timing: 'at the moment of the automatic 12:05 cutoff (confirmed 01.09.2026)',
    deepLink: '/shifts',
  },
  N7: {
    code: 'N7',
    channel: 'push',
    title: "Confirm today's shift",
    body: "Confirm today's shift",
    trigger: 'On-the-day',
    timing: 'on the day of the shift',
    // As N6: "Confirm today" is on the /shifts card.
    deepLink: '/shifts',
  },

  // Review outcomes.
  N8: {
    code: 'N8',
    channel: 'push',
    title: 'Document rejected',
    body: 'Document rejected — {reason}. Re-upload.',
    trigger: 'Document rejected',
    timing: 'on reject',
    // A worker re-uploads on the Documents hub; a candidate's app is locked
    // to the onboarding wizard, which is where their re-upload is. The row
    // says which (`link`, n8_link() in SQL, 20260930130200).
    deepLink: '/documents',
    deepLinkOptions: ['/documents', '/onboarding'],
    action: 'Re-upload',
    // One notification per rejected document: a second rejection of the
    // same one replaces it, two documents stay two.
    tag: 'N8:{documentId}',
  },

  // Check-in / check-out / breaks (§5).
  N9: {
    code: 'N9',
    channel: 'push',
    title: 'Your shift today',
    // No `body`: §8 gives N9 as two sends, so there is nothing sendable here.
    // A sender reads a half through `body('N9', 'check-in' | 'check-out')`.
    scopeCopy:
      '"Time to check in" / "Don\'t forget to check out" — each half is skipped if the worker has already signed in / signed out respectively',
    trigger: '30 min before start / end',
    timing: '−30 min',
    deepLink: '/shifts/{bookingId}',
    variants: {
      'check-in': { body: 'Time to check in' },
      'check-out': { body: "Don't forget to check out" },
    },
  },
  N9b: {
    code: 'N9b',
    channel: 'push',
    title: "You haven't checked out",
    body: "You haven't checked out of {event} yet — tap to check out.",
    trigger: "Still not checked out 30 minutes after the shift's scheduled end",
    timing:
      '+30 min after the scheduled end — skipped if the worker has already checked out; sent once, not repeated, and leaves 3.5 hours before the check-out button locks (RULE-02, §5.2)',
    deepLink: '/shifts/{bookingId}',
  },
  N13: {
    code: 'N13',
    channel: 'push',
    title: 'Break reminder',
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
    title: "You're booked!",
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
    title: 'Shift cancelled',
    body: "You've been removed from {event} · {dateTime}",
    trigger: 'Shift cancelled by the office (manager presses Withdraw)',
    timing: 'on change (confirmed 14.07.2026)',
    mandatory: true,
    deepLink: '/shifts',
  },
  // §8 N10b's trigger — the manager presses Withdraw — covers an open
  // invitation too, but its copy ("You've been removed from …") tells a
  // worker they had a shift they never accepted. Same trigger, the
  // invitation's own words (withdraw_booking(), 20260930110300).
  N10d: {
    code: 'N10d',
    channel: 'push',
    title: 'Invitation withdrawn',
    body: 'Your invitation to {event} · {dateTime} has been withdrawn.',
    trigger:
      'The office withdraws an open invitation (manager presses Withdraw on an Invited row). Not in §8: N10b covers the Withdraw, but its copy says the worker was removed from a shift they had, which an invitee never did (ADR-0037)',
    timing: 'on change, in the same transaction as the withdrawal',
    deepLink: '/invites',
  },
  N10c: {
    code: 'N10c',
    channel: 'push',
    title: 'Shift filled',
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
    title: 'Shift time changed',
    body: 'Shift time changed — now {window}',
    trigger: 'Event time / date changed (start time OR end time — either one triggers this push)',
    timing:
      'on change — delivered as a standard device-level push (FCM/APNs, §1.3), reaching the worker even if the Staffing App is closed',
    deepLink: '/shifts/{bookingId}',
  },
  // §3.5 sends the same re-confirmation for a venue address or dress-code
  // change, but §8 only gives N11's copy, which says the TIME changed. A
  // worker told "Shift time changed — now 17:00–23:00" about a dress code
  // would look at the clock and miss the change. Same flow, own words.
  N11b: {
    code: 'N11b',
    channel: 'push',
    title: 'Shift details changed',
    body: 'Shift details changed — {change}. Please confirm in the app.',
    trigger:
      'Venue address or dress code changed on a booked shift (§3.5: "If the event time / date, venue address, or dress code changes → everyone booked must re-confirm … + push"). Not in §8: N11 is the only re-confirmation push §8 lists, and its copy is about the time (20260930110000 round, ADR-0037)',
    timing:
      'on change — the same device-level push and "Awaiting" state as N11; sent instead of N11 when the time did not move',
    deepLink: '/shifts/{bookingId}',
  },
  N12: {
    code: 'N12',
    channel: 'push',
    title: 'Event cancelled',
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
    title: 'Your weekly limit has changed',
    // No `body`: §8's copy ends "until [date]", and two of the five bands
    // (RULE-20) have no date to put there — a verified completion letter is
    // permanent, and the 48-hour opt-out lasts until the worker revokes it.
    // `render` leaves an unmatched placeholder in the string, so one body
    // with an optional date would send the literal "{date}" to a worker.
    // Two halves, as N9 does it, and the sender picks by variant.
    scopeCopy:
      'Your weekly limit is now [20 / 48] hours — [term time / university holiday] until [date].',
    trigger:
      'Weekly hours cap changes band — term time starts or ends, or a completion letter is verified (§4.4, §4.5)',
    timing:
      'On the morning the change takes effect, from the daily compliance job (§7) — once per change',
    deepLink: '/documents',
    variants: {
      dated: { body: 'Your weekly limit is now {limit} hours — {band} until {date}.' },
      // The band has no end date on the calendar, so the clause is dropped
      // rather than filled with a placeholder nobody can answer.
      open: { body: 'Your weekly limit is now {limit} hours — {band}.' },
      // §8's copy offers "[20 / 48] hours", which the fifth band (RULE-20's
      // `uncapped`) has no number for. Reusing the sentence would send
      // "your weekly limit is now no hours", which reads as zero — the
      // opposite of what signing the opt-out did.
      uncapped: { body: 'You no longer have a weekly hours limit — {band}.' },
    },
  },
  N15: {
    code: 'N15',
    channel: 'push',
    title: 'Your shifts are open again',
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
  E2b: {
    code: 'E2b',
    channel: 'email',
    sender: 'admin',
    title: 'Your application to The Hospitality Company',
    body: 'Thank you for the time you have given to your application with The Hospitality Company. On this occasion we will not be taking your application further. We wish you the very best.',
    trigger:
      'Rejected before completing the interview (Interview requested, no Willo response) or after the interview stage (documents, quiz stage, additional info), or a returning applicant declined. Not in §8: E2 thanks the candidate for completing their interview, which is untrue for these, so this is E2 without the interview (20260923170000, 20260930130300)',
    timing: 'on the rejection decision',
    mandatory: true,
  },
  E3: {
    code: 'E3',
    channel: 'email',
    sender: 'admin',
    title: 'Activate your account',
    body: 'Your application was accepted. Set your password to start onboarding: {link}\n\nThen download the app and add it to your home screen: {installLink}',
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
  // §9.12 names this send and §8 does not: "A worker's self-cancel of a
  // confirmed booking (RULE-04, §3.6) also triggers an immediate email to
  // admin@thehospitalitycompany.co.uk, flagging which event/role/shift lost
  // a confirmed worker so the office can follow up if auto-assign doesn't
  // backfill it in time." E10 is the next free E-number, as REGISTER-NOTES
  // pencilled in. The payload keys are held to self_cancel_booking()'s by
  // supabase/tests/592_self_cancel_office_email.sql.
  E10: {
    code: 'E10',
    channel: 'email',
    sender: 'admin',
    recipients: OFFICE,
    title: 'Confirmed worker self-cancelled — {event} · {role} · {date}',
    body: 'A worker has cancelled a confirmed shift from the app, more than 72 hours before it starts (RULE-04). They cannot be invited to this event again. The slot is open again — follow up if it is not refilled in time.\n\nEvent: {event}\nClient: {client}\nVenue: {venue}\nRole: {role}\nShift: {dateTime} (UK time)\n\nName: {name}\nEmployee ID: {employeeId}\nCancelled: {cancelledAt}\n\nConfirmed for this role now: {confirmed} of {headcount} (+{buffer})\nAuto-assign for this role: {autoAssign}',
    trigger:
      'A worker self-cancels a confirmed booking (RULE-04, §3.6). Not in §8: §9.12 says it "triggers an immediate email to admin@thehospitalitycompany.co.uk, flagging which event/role/shift lost a confirmed worker", but §8 gives it no code, so it takes the next free E-number (20260927140200)',
    timing: 'immediately on the self-cancel, not batched (§9.12)',
  },

  // ────────────────────────────────────────────────────────────────────────
  // UNIVERSITY COMPLETION LETTER REQUIREMENT §5 — not scope v1.6 §8, a later
  // document from THC (docs/scope/university-completion-letter-requirement.pdf).
  // `CL` codes so they can never collide with an N- or E-code THC assigns to
  // §8 later. "Rejected (with reason)" is not here: it is N8, the §8 push for
  // any rejected document, with the same Re-upload button.
  // ────────────────────────────────────────────────────────────────────────
  CL1: {
    code: 'CL1',
    channel: 'push',
    title: 'Completion letter received',
    body: "We've received your completion letter. Your weekly hours stay the same until the office has checked it.",
    trigger:
      'Worker uploads a completion letter, transcript or university email (requirement §2.1, §5)',
    timing: 'on upload — the upload itself changes no hours (acceptance criterion 2)',
    deepLink: '/documents',
  },
  CL2: {
    code: 'CL2',
    channel: 'push',
    title: 'Completion letter approved',
    // No `body`: the approval has three honest outcomes, and one sentence with
    // optional clauses would send a placeholder to somebody (see N14).
    scopeCopy: 'Worker: approved (with new cap and effective date).',
    trigger: 'The office approves a completion letter (requirement §2.2, §5)',
    timing: 'on approval',
    deepLink: '/documents',
    variants: {
      dated: {
        body: 'Your completion letter is approved — your weekly limit is {limit} hours from {date}.',
      },
      // The worker has a valid 48-hour opt-out, so the release lifts the ceiling
      // entirely. "Limit is null hours" would read as zero.
      uncapped: {
        body: 'Your completion letter is approved — from {date} you have no weekly hours limit.',
      },
      // §7: the right to work ends before the release would start.
      visa_first: {
        body: 'Your completion letter is approved, but your right to work ends on {date}, before the new limit would start — your weekly hours do not change.',
      },
    },
  },
  CL3: {
    code: 'CL3',
    channel: 'email',
    sender: 'admin',
    recipients: OFFICE,
    title: 'Completion letter awaiting review — {name}, Employee ID {employeeId}',
    body: "Name: {name}\nEmployee ID: {employeeId}\nUploaded: {uploadedAt}\nDocument: {form}\nCourse completion date entered by the worker: {completionDate}\n\nReview it in Compliance → Needs review. The worker's weekly hours do not change until it is approved.",
    trigger: 'A completion letter is uploaded and waits for review (requirement §5)',
    timing: 'on upload',
  },
  CL4: {
    code: 'CL4',
    channel: 'email',
    sender: 'admin',
    recipients: OFFICE,
    title: 'Right to work expires in {days} days — {name}, Employee ID {employeeId}',
    body: 'Name: {name}\nEmployee ID: {employeeId}\nRight to work: {route}\nExpires: {visaExpiry} ({days} days)\n\nNo shift after that date can be rostered, and they are blocked on the day unless a new right-to-work check is recorded.',
    trigger: "A live worker's recorded right to work is approaching expiry (requirement §2.3, §5)",
    timing: '60, 30 and 14 days before — each once per expiry date, from the daily compliance job',
  },
  CL5: {
    code: 'CL5',
    channel: 'email',
    sender: 'admin',
    recipients: OFFICE,
    title: '48-hour opt-out signed — {name}, Employee ID {employeeId}',
    body: 'Name: {name}\nEmployee ID: {employeeId}\nSigned: {signedAt} ({signedCopy})\nNotice period to cancel: {noticeDays} days\n\nThis lifts the 48-hour weekly limit. It does not lift a Student visa term-time limit.',
    trigger: 'A worker signs the 48-hour opt-out (requirement §2.4, §5)',
    timing: 'on signature',
  },
  CL6: {
    code: 'CL6',
    channel: 'email',
    sender: 'admin',
    recipients: OFFICE,
    title: '48-hour opt-out cancelled — {name}, Employee ID {employeeId}',
    body: 'Name: {name}\nEmployee ID: {employeeId}\nNotice given: {cancelledAt}\nThe 48-hour weekly limit applies again from: {effectiveFrom}\n\nWeeks already booked above 48 hours from then: {overCapWeeks}',
    trigger: 'A worker gives notice to cancel the 48-hour opt-out (requirement §2.4, §5)',
    timing: 'on notice',
  },

  // ────────────────────────────────────────────────────────────────────────
  // STAFF APP ADDITIONS — not scope v1.6 §8. Five features the product owner
  // approved on 25.09.2026 (docs/18-staff-features-plan.md), each with its
  // own ADR, status proposed — awaiting THC. Family prefixes, as `CL` does,
  // so none can collide with an N- or E-number THC assigns to §8 later. The
  // copy is ours and every row is "confirm with THC" (REGISTER-NOTES.md,
  // docs/15 Q21). RF1 (refer a friend, ADR-0040) is proposed and deliberately
  // NOT registered: it would tell one person another's employment status.
  // ────────────────────────────────────────────────────────────────────────

  // Request a change — name and photo (ADR-0038). Keys `RCn:request:<id>`.
  RC1: {
    code: 'RC1',
    channel: 'email',
    sender: 'admin',
    recipients: OFFICE,
    title: 'Profile change requested — {name}, Employee ID {employeeId}',
    body: '{name} has asked the office to change their {change}.\n\nRequested: {requestedAt} (UK time)\nNow: {current}\nRequested: {proposed}\nNote: {note}\n\nReview it in Staff → Change requests.',
    trigger:
      'A worker asks the office to change their locked name or photo (request_profile_change, §10.1). Not in §8: an addition to scope v1.6, ADR-0038 (proposed — awaiting THC)',
    timing: 'on request',
  },
  RC2: {
    code: 'RC2',
    channel: 'push',
    title: 'Profile updated',
    body: 'Your {change} has been updated.',
    trigger:
      'The office approves a name or photo change request (office_decide_profile_change). Not in §8: an addition to scope v1.6, ADR-0038 (proposed — awaiting THC)',
    timing: 'on approve',
    deepLink: '/profile/details',
  },
  RC3: {
    code: 'RC3',
    channel: 'push',
    title: 'Change not made',
    body: "We couldn't update your {change}: {reason}",
    trigger:
      'The office rejects a name or photo change request, with the reason the worker is shown (office_decide_profile_change). Not in §8: an addition to scope v1.6, ADR-0038 (proposed — awaiting THC)',
    timing: 'on reject',
    deepLink: '/profile/details',
  },
  RC4: {
    code: 'RC4',
    channel: 'email',
    sender: 'admin',
    // E7's recipients: a name change is a contact-details change payroll
    // must hear about, and issued PDFs and exports are never rewritten.
    recipients: OFFICE_AND_PAYROLL,
    title: 'Name changed — {name}, Employee ID {employeeId}',
    body: 'Previous name: {previousName}\nNew name: {name}\nApproved: {approvedAt} (UK time)',
    trigger:
      "The office approves a worker's name change (office_decide_profile_change); payroll is told as for E7. Not in §8: an addition to scope v1.6, ADR-0038 (proposed — awaiting THC)",
    timing: 'on approving a name',
  },

  // Offer up a shift — release to the pool (ADR-0039). Keys
  // `OFn:offer:<id>` (OF5: `OF5:booking:<booking id>`, one cover email per booking — 20260930150000), and `OF1:offer:<offer>:<staff>` per candidate.
  OF1: {
    code: 'OF1',
    channel: 'push',
    title: 'Shift up for grabs',
    // Never names the offerer: Radar lists offers through an RPC that does
    // not return them, and the push must not either.
    body: '{role} · {event} · {dateTime} · {rate}/h — tap to take it.',
    trigger:
      'A confirmed worker offers their shift to the pool more than 72 hours before it starts, or the office opens a cover request to the pool (notify_offer_candidates, RULE-17 order). Not in §8: an addition to scope v1.6, ADR-0039 (proposed — awaiting THC)',
    timing: 'hourly, `allocation_per_hour` per round, wave 1 first, never after expiry',
    deepLink: '/radar/offers/{offerId}',
  },
  OF2: {
    code: 'OF2',
    channel: 'push',
    title: 'Shift handed over',
    body: "{event} · {dateTime} has been taken by another worker. You're no longer booked on it.",
    trigger:
      'Another worker takes the offered shift and the original booking is released (take_offered_shift). Not in §8: an addition to scope v1.6, ADR-0039 (proposed — awaiting THC)',
    timing: 'on take',
    deepLink: '/shifts',
  },
  OF3: {
    code: 'OF3',
    channel: 'push',
    title: "You're still booked",
    body: "Nobody took your {event} shift on {date} — you're still booked. If you can't make it, contact the office.",
    trigger:
      'An open offer reaches its expiry (start − 72 h for a pool offer) with no taker; the worker stays confirmed (lapse_shift_offers). Not in §8: an addition to scope v1.6, ADR-0039 (proposed — awaiting THC)',
    // Not when the booking leaves confirmed for another cause: the
    // bookings_offer_lapse trigger closes the offer silently then.
    timing: 'on lapse by expiry only',
    deepLink: '/shifts/{bookingId}',
  },
  OF4: {
    code: 'OF4',
    channel: 'push',
    title: "You're booked!",
    body: '{event} on {date} is yours. Tap to view your shift details.',
    trigger:
      'A worker takes an offered shift and is confirmed on it (take_offered_shift, Booking.source = offer). Not in §8: an addition to scope v1.6, ADR-0039 (proposed — awaiting THC)',
    timing: 'on take',
    deepLink: '/shifts/{bookingId}',
  },
  OF5: {
    code: 'OF5',
    channel: 'email',
    sender: 'admin',
    recipients: OFFICE,
    title: 'Cover requested — {event} · {role} · {date}',
    body: 'Name: {name}\nEmployee ID: {employeeId}\n\nEvent: {event}\nClient: {client}\nVenue: {venue}\nRole: {role}\nShift: {dateTime} (UK time)\nNote: {note}\n\nConfirmed for this role now: {confirmed} of {headcount} (+{buffer})\nAuto-assign for this role: {autoAssign}\n\nThey are still booked until you act.',
    trigger:
      'A confirmed worker asks the office for cover inside 72 hours of the start (request_cover); the booking is unchanged. Not in §8: an addition to scope v1.6, ADR-0039 (proposed — awaiting THC)',
    timing: 'immediately',
  },
  OF6: {
    code: 'OF6',
    channel: 'push',
    title: 'Cover request closed',
    body: "The office has closed your cover request for {event} on {date}. You're still booked — contact the office if you can't make it.",
    trigger:
      "The office declines a worker's cover request (office_decline_cover). Not in §8: an addition to scope v1.6, ADR-0039 (proposed — awaiting THC)",
    timing: 'on decline',
    deepLink: '/shifts/{bookingId}',
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

/**
 * Codes from the University Completion Letter requirement §5
 * (docs/scope/university-completion-letter-requirement.pdf), a later THC
 * document than the scope. Kept apart from SCOPE_CODES so the test that holds
 * the register to §8 still says exactly what §8 says.
 */
export const REQUIREMENT_CODES = [
  'CL1',
  'CL2',
  'CL3',
  'CL4',
  'CL5',
  'CL6',
] as const satisfies readonly TemplateCode[];

/**
 * Codes the register carries that §8 does not name, each with its `trigger`
 * saying why. E2b exists because §8's own copy would have been untrue where
 * it was about to be sent; E10 because §9.12 requires a send §8 never lists;
 * N10d and N11b for the same reason as E2b — §8's copy (N10b, N11) would
 * tell an invitee they had a shift, or tell a worker the time moved when it
 * was the dress code (ADR-0037). Kept apart from SCOPE_CODES so the test can
 * still hold that list to the scope exactly.
 */
export const EXTENSION_CODES = [
  'E2b',
  'E10',
  'N10d',
  'N11b',
] as const satisfies readonly TemplateCode[];

/**
 * Codes for the Staff App additions (docs/18-staff-features-plan.md §6): RC
 * for Request a change (ADR-0038), OF for Offer up a shift (ADR-0039). Not
 * §8's, not the completion letter requirement's, and not a fix to either —
 * new features, each `trigger` naming its ADR. RF1 (ADR-0040) is proposed
 * only and is not in the register.
 */
export const ADDITION_CODES = [
  'RC1',
  'RC2',
  'RC3',
  'RC4',
  'OF1',
  'OF2',
  'OF3',
  'OF4',
  'OF5',
  'OF6',
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
    if (entry.body === undefined) throw new Error(`${code} has no body`);
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
  code: TemplateCode,
  subject: string,
  id: string | number,
  variant?: string,
): string {
  return variant === undefined ? `${code}:${subject}:${id}` : `${code}:${subject}:${id}:${variant}`;
}

export function render(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
