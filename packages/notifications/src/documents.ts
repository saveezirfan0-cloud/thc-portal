/**
 * The emails that carry a FILE — Scope §9.9 (BG-08) and §11.4, and the New
 * Starter (HMRC) report's own Monday email (ADR-0090).
 *
 * They are not in §8's register, and `TEMPLATES` is held to exactly that
 * register by its test, so they live here instead, beside it:
 *
 *   BG08  the Monday 09:00 finance email — the payroll CSV (§9.9, §7). The
 *         New Starter (HMRC) CSV used to be a second attachment; since
 *         ADR-0090 it is NS1's.
 *         From admin@ (§9.12: "the finance reports"), to the same two
 *         payroll addresses as E5/E6 — read from E5, not retyped.
 *   NS1   the New Starter (HMRC) report, every Monday from 09:00 UK, only
 *         when there were new starters (§9.9, ADR-0090). Same sender and
 *         the same two addresses as BG08.
 *   D1    the Allocation Timesheet, "Send allocation sheet" from the event
 *         page (§11.4), sent BEFORE the event — so it never speaks of
 *         check-in, check-out or hours worked from them.
 *   D2    the Completed Allocation Timesheet, the same way, after the event,
 *         filled in from check-in and check-out.
 *         Both from timesheets@ (§9.12) to the contact emails on the client
 *         card (§9.7), which the outbox row carries. THC renamed both in
 *         client emails on 29.09.2026 — §11.3/§11.4 say "allocation sheet"
 *         and "sign-out timesheet" (ADR-0073).
 *
 * Every one is sent as text AND as THC Light HTML (ADR-0073). The text is
 * `body`; the HTML is built from the same values by `documentHtml()` below,
 * with its sentences in `html` beside the text so the two are read together
 * (email-html.test.ts checks that every sentence of the HTML's own copy is
 * also in the text).
 *
 * Every one goes through `notification_outbox` with a unique key like
 * everything else (BG08:<week>, D1:document:<id>). The row carries its
 * attachments as storage REFERENCES — bucket, path, file name — never as
 * content: an outbox payload is not where a list of NI numbers should sit.
 *
 * For the drain (P2): route a claimed row with `isDocumentEmail(row.template)`
 * to `documentMessageFor(row)` instead of `messageFor(row)`, download each
 * attachment from Storage with the service key, and send through Resend with
 * `attachments`. Like `messageFor`, everything this rejects is a fault in the
 * row, so throw it as UnsendableRow and fail the row rather than retry it.
 */

import type { EmailBlock, EmailFact } from './email-html.ts';
import { preheaderFrom, renderEmailHtml, templateToBlocks } from './email-html.ts';
import type { EmailMessage, OutboxRow, RenderOptions } from './outbox.ts';
import { UnsendableRow } from './outbox.ts';
import { DEFAULT_SENDER_ADDRESSES, signedBy } from './senders.ts';
import { TEMPLATES, render } from './templates.ts';

export type DocumentBucket = 'reports' | 'timesheets';

export interface DocumentEmailTemplate {
  code: string;
  channel: 'email';
  sender: 'admin' | 'timesheets';
  /** Fixed recipients, when the scope names them. Otherwise the row's. */
  recipients?: readonly string[];
  /** The only bucket this email may attach from. */
  bucket: DocumentBucket;
  title: string;
  /** The plain-text body. */
  body: string;
  /** The HTML version's own pieces (ADR-0073); every sentence is also in `body`. */
  html: DocumentEmailHtml;
  trigger: string;
  timing: string;
}

/**
 * What the THC Light HTML of a document email says, in its order: eyebrow,
 * title (the event, or the subject), "Hello,", `intro`, the facts box, the
 * `steps`, the file cards, `closing`, the reply button, the sign-off.
 * BG08 and NS1 have no `intro`: their HTML is their text body, laid out.
 */
export interface DocumentEmailHtml {
  eyebrow: string;
  intro?: string;
  stepsLead?: string;
  steps?: readonly string[];
  closing?: string;
  /** Under each file name on its card. */
  attachmentNote: string;
  /** Under the name badges' file name (ADR-0081, D1 only); `{nameBadges}` is the count. */
  badgesNote?: string;
  /** A `mailto:` button to the sender's reply-to, subject "Re: <subject>". */
  replyButton?: string;
}

export const DOCUMENT_EMAILS = {
  BG08: {
    code: 'BG08',
    channel: 'email',
    sender: 'admin',
    recipients: TEMPLATES.E5.recipients,
    bucket: 'reports',
    title: 'THC payroll — {periodStart} to {periodEnd}',
    body: 'Hello,\n\nAttached is the payroll for Monday {periodStart} to Sunday {periodEnd}: {rows} shifts, one row per shift, with base pay and holiday pay (+12.07%) in separate columns.\n\n{newStarterLine}{heldLine}\n\nThe Hospitality Company\nadmin@thehospitalitycompany.co.uk',
    html: { eyebrow: 'Weekly payroll', attachmentNote: 'CSV · attached' },
    trigger: 'BG-08 — every Monday at 09:00 UK (§9.9, §7)',
    timing: 'Monday 09:00 Europe/London; a missed Monday is caught up the same week',
  },
  NS1: {
    code: 'NS1',
    channel: 'email',
    sender: 'admin',
    recipients: TEMPLATES.E5.recipients,
    bucket: 'reports',
    title: 'THC new starters (HMRC) — {periodStart} to {periodEnd}',
    body: 'Hello,\n\nAttached is the New Starter (HMRC) report for Monday {periodStart} to Sunday {periodEnd}: {newStarterLine}\n\nEach row is a worker who has worked their first shift, with the details needed to set them up: NI number, home address, date of birth, first shift date, HMRC statement and student loan answers.\n\nThe Hospitality Company\nadmin@thehospitalitycompany.co.uk',
    html: { eyebrow: 'New starters (HMRC)', attachmentNote: 'CSV · attached' },
    trigger: 'NS1 — every Monday at 09:00 UK, when there were new starters (§9.9, ADR-0090)',
    timing:
      'Monday 09:00 Europe/London; a missed Monday is caught up the same week. A week with nobody new sends nothing',
  },
  D1: {
    code: 'D1',
    channel: 'email',
    sender: 'timesheets',
    bucket: 'timesheets',
    title: 'Allocation Timesheet — {event}, {date}{poSuffix}{updateTag}',
    body: "Hello,\n\nPlease find attached the Allocation Timesheet for the {event} on {date}. It lists the {staffCount} staff booked to work, with each person's role and scheduled start and finish times.{bufferLine}{poLine}{badgeLine}{updateLine}\n\nOn the day, please ask your manager on site to:\n1. fill in each person's finish time, any comments (breaks, early finishes) and hours worked,\n2. print and sign their name at the bottom,\n3. email the signed sheet back to us — just reply to this email.\n\nAny questions, you can reach us the same way.\n\nBest regards,\nThe Hospitality Company\ntimesheets@thehospitalitycompany.co.uk · www.thehospitalitycompany.co.uk",
    html: {
      eyebrow: 'Allocation Timesheet',
      intro:
        "Please find attached the Allocation Timesheet for the {event} on {date}. It lists the {staffCount} staff booked to work, with each person's role and scheduled start and finish times.{bufferLine}{poLine}{badgeLine}{updateLine}",
      stepsLead: 'On the day, please ask your manager on site to:',
      steps: [
        "fill in each person's finish time, any comments (breaks, early finishes) and hours worked,",
        'print and sign their name at the bottom,',
        'email the signed sheet back to us — just reply to this email.',
      ],
      closing: 'Any questions, you can reach us the same way.',
      attachmentNote: 'Allocation Timesheet · attached',
      badgesNote: 'Name badges · {nameBadges} to print',
      replyButton: 'Reply with the signed sheet',
    },
    trigger: '"Send allocation sheet" on the Back Office event page (§11.4)',
    timing: 'on the press — any time, including mid-event (§11.3)',
  },
  D2: {
    code: 'D2',
    channel: 'email',
    sender: 'timesheets',
    bucket: 'timesheets',
    title: 'Completed Allocation Timesheet — {event}, {date}{poSuffix}',
    body: "Hello,\n\nPlease find attached the completed Allocation Timesheet for the {event} on {date} — {staffCount} staff, with finish times, breaks and hours worked taken from each person's check-in and check-out in the THC Staff App.{bufferLine}{poLine}\n\nIf anything doesn't match your records, just reply to this email and we'll look into it.\n\nBest regards,\nThe Hospitality Company\ntimesheets@thehospitalitycompany.co.uk · www.thehospitalitycompany.co.uk",
    html: {
      eyebrow: 'Completed Allocation Timesheet',
      intro:
        "Please find attached the completed Allocation Timesheet for the {event} on {date} — {staffCount} staff, with finish times, breaks and hours worked taken from each person's check-in and check-out in the THC Staff App.{bufferLine}{poLine}",
      closing:
        "If anything doesn't match your records, just reply to this email and we'll look into it.",
      attachmentNote: 'Completed Allocation Timesheet · attached',
      replyButton: 'Reply to this email',
    },
    trigger: '"Send timesheet" on the Back Office event page, after the event (§11.3, §11.4)',
    timing: 'on the press',
  },
} as const satisfies Record<string, DocumentEmailTemplate>;

export type DocumentEmailCode = keyof typeof DOCUMENT_EMAILS;

export function isDocumentEmail(code: string): code is DocumentEmailCode {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_EMAILS, code);
}

export interface Attachment {
  bucket: DocumentBucket;
  path: string;
  filename: string;
  /**
   * What the file is when it is not the email's main document: 'badges',
   * the D1 name badges (ADR-0081). Its card says the template's
   * `badgesNote` instead of `attachmentNote`.
   */
  role?: 'badges';
}

export interface EmailWithAttachments extends EmailMessage {
  attachments: Attachment[];
}

function parseAttachments(raw: unknown, code: DocumentEmailCode): Attachment[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      throw new UnsendableRow(`${code}: attachments is not JSON`);
    }
  }
  if (!Array.isArray(list) || list.length === 0) {
    throw new UnsendableRow(`${code}: an email that carries a file has no attachment`);
  }
  const bucket = DOCUMENT_EMAILS[code].bucket;
  return list.map((entry, index) => {
    const a = entry as Partial<Attachment>;
    if (a.bucket !== bucket) {
      throw new UnsendableRow(`${code}: attachment ${index} is not in the ${bucket} bucket`);
    }
    if (
      typeof a.path !== 'string' ||
      a.path === '' ||
      a.path.includes('..') ||
      a.path.startsWith('/')
    ) {
      throw new UnsendableRow(`${code}: attachment ${index} has no usable path`);
    }
    if (typeof a.filename !== 'string' || a.filename.trim() === '') {
      throw new UnsendableRow(`${code}: attachment ${index} has no file name`);
    }
    return {
      bucket,
      path: a.path,
      filename: a.filename,
      ...(a.role === 'badges' ? { role: 'badges' as const } : {}),
    };
  });
}

/** The copy values the rows do not carry themselves, derived once, here. */
function derivedValues(
  code: DocumentEmailCode,
  values: Record<string, string>,
): Record<string, string> {
  if (code === 'BG08') {
    const newStarters = Number(values.newStarters ?? 0);
    const held = Number(values.held ?? 0);
    return {
      ...values,
      // ADR-0090: the New Starter (HMRC) report is NS1's own email. A row queued
      // before that (it carries `newStarters`) still says what it attached.
      newStarterLine:
        values.newStarters === undefined
          ? 'The New Starter (HMRC) report comes in its own email every Monday.\n\n'
          : newStarters > 0
            ? `The New Starter (HMRC) report is attached too: ${newStarters} new starter${newStarters === 1 ? '' : 's'} who worked their first shift in this run.\n\n`
            : 'There were no new starters this week, so there is no New Starter (HMRC) report.\n\n',
      heldLine:
        held > 0
          ? `${held} shift${held === 1 ? ' is' : 's are'} held out of this file: ${held === 1 ? 'it has' : 'they have'} an unresolved "No check-out" and will go out with the first Monday run after a manager resolves ${held === 1 ? 'it' : 'them'}.`
          : 'No shifts were held back this week.',
    };
  }
  if (code === 'NS1') {
    const n = Number(values.newStarters ?? 0);
    return {
      ...values,
      newStarterLine: `${n} new starter${n === 1 ? '' : 's'}.`,
    };
  }
  const po = (values.poNumber ?? '').trim();
  // ADR-0087: an automatic D1 that follows one already sent says so. A row
  // without the key (older) is a first sheet.
  const updated = (values.updateTag ?? '').trim() !== '';
  // ADR-0081: a client with name badges on gets them with the D1 sheet. The
  // count is in the facts box ("Name badges"), so the sentence needs none.
  const badges = Number((values.nameBadges ?? '').trim()) || 0;
  // ADR-0089: people listed beyond what the client asked for ('' or absent = none).
  const buffer = Number((values.bufferStaff ?? '').trim()) || 0;
  return {
    ...values,
    bufferStaff: values.bufferStaff ?? '',
    bufferLine:
      buffer > 0
        ? ` It includes ${buffer} buffer ${buffer === 1 ? 'person' : 'people'}, booked in addition to the number required to cover late arrivals and drop-outs on the day.`
        : '',
    updateTag: values.updateTag ?? '',
    updateLine: updated
      ? ' This replaces the Allocation Timesheet we sent earlier: the line-up has changed since, so please use this one.'
      : '',
    poLine: po ? ` Your PO number ${po} is on the sheet.` : '',
    badgeLine:
      badges > 0
        ? badges === 1
          ? ' Their THC name badge is attached too, as a second PDF: print it, cut along the dashed lines and slide it into a badge holder.'
          : ' Their THC name badges are attached too, as a second PDF: print them, cut along the dashed lines and slide each one into a badge holder.'
        : '',
  };
}

/** "17 (incl. 2 buffer)" — the count the client reads, with the reason it is larger (ADR-0089). */
function staffWithBuffer(count: string, buffer: string): string {
  const n = Number(buffer) || 0;
  return count && n > 0 ? `${count} (incl. ${n} buffer)` : count;
}

/**
 * The facts box for each document email. Every value is optional — the D1/D2
 * payload gained `schedule` and `totalHours` later, and an older row without
 * them still renders — and an empty one drops its row.
 */
function documentFacts(code: DocumentEmailCode, v: Record<string, string>): EmailFact[] {
  const get = (key: string) => (v[key] ?? '').trim();
  if (code === 'BG08') {
    const start = get('periodStart');
    const end = get('periodEnd');
    return [
      { label: 'Period', value: start && end ? `Monday ${start} to Sunday ${end}` : '' },
      { label: 'Shifts', value: get('rows') },
      { label: 'New starters', value: get('newStarters') },
      { label: 'Held back', value: get('held') },
    ];
  }
  if (code === 'NS1') {
    const start = get('periodStart');
    const end = get('periodEnd');
    return [
      { label: 'Period', value: start && end ? `Monday ${start} to Sunday ${end}` : '' },
      { label: 'New starters', value: get('newStarters') },
    ];
  }
  const common = [
    { label: 'Client', value: get('client') },
    { label: 'Date', value: get('date') },
  ];
  if (code === 'D1') {
    return [
      ...common,
      { label: 'Staff booked', value: staffWithBuffer(get('staffCount'), get('bufferStaff')) },
      // "Chef 07:00 – 15:00 · Waiting Staff 17:00 – 23:30": one role a line.
      { label: 'Scheduled', value: get('schedule').split(' · ').join('\n') },
      { label: 'PO number', value: get('poNumber') },
      // ADR-0081: '' (no badges) drops the row.
      { label: 'Name badges', value: get('nameBadges') },
    ];
  }
  return [
    ...common,
    { label: 'Staff', value: staffWithBuffer(get('staffCount'), get('bufferStaff')) },
    { label: 'Total hours', value: get('totalHours') },
    { label: 'PO number', value: get('poNumber') },
  ];
}

/** The THC Light HTML of a document email (ADR-0073). */
function documentHtml(
  code: DocumentEmailCode,
  values: Record<string, string>,
  subject: string,
  text: string,
  attachments: readonly Attachment[],
  replyTo: string,
): string {
  const copy: DocumentEmailHtml = DOCUMENT_EMAILS[code].html;
  const facts: EmailBlock = { kind: 'facts', rows: documentFacts(code, values) };
  const files: EmailBlock = {
    kind: 'attachments',
    items: attachments.map((a) => ({
      filename: a.filename,
      note:
        a.role === 'badges' && copy.badgesNote
          ? render(copy.badgesNote, values)
          : copy.attachmentNote,
    })),
  };

  if (!copy.intro) {
    // BG08: its text template laid out (placeholders in place, values filled
    // in escaped), with the numbers boxed after its first sentence and the
    // files above the signature.
    const template = signedBy(DOCUMENT_EMAILS[code].body, DOCUMENT_EMAILS[code].sender, replyTo);
    const blocks = templateToBlocks(template, values);
    blocks.splice(Math.min(2, blocks.length), 0, facts);
    blocks.splice(Math.max(blocks.length - 1, 0), 0, files);
    return renderEmailHtml({
      eyebrow: copy.eyebrow,
      title: subject,
      documentTitle: subject,
      blocks,
      senderAddress: replyTo,
      preheader: preheaderFrom(text.replace(/^Hello,\s*/, '')),
    });
  }

  const blocks: EmailBlock[] = [
    { kind: 'paragraph', text: 'Hello,' },
    // Filled, not rendered-then-parsed: an event name is text, never a link.
    { kind: 'filled', template: copy.intro, values },
    facts,
  ];
  if (copy.steps && copy.steps.length > 0) {
    blocks.push({ kind: 'steps', lead: copy.stepsLead, items: copy.steps });
  }
  blocks.push(files);
  if (copy.closing) blocks.push({ kind: 'paragraph', text: copy.closing });
  if (copy.replyButton) {
    blocks.push({
      kind: 'button',
      label: copy.replyButton,
      href: `mailto:${replyTo}?subject=${encodeURIComponent(`Re: ${subject}`)}`,
    });
  }
  blocks.push({ kind: 'paragraph', text: 'Best regards,\nThe Hospitality Company' });
  return renderEmailHtml({
    eyebrow: copy.eyebrow,
    title: (values.event ?? '').trim() || subject,
    documentTitle: subject,
    blocks,
    senderAddress: replyTo,
    preheader: preheaderFrom(render(copy.intro, values)),
  });
}

export function documentMessageFor(
  row: OutboxRow,
  options: RenderOptions = {},
): EmailWithAttachments {
  if (!isDocumentEmail(row.template)) {
    throw new UnsendableRow(`${row.template} is not a document email`);
  }
  const code = row.template;
  const entry: DocumentEmailTemplate = DOCUMENT_EMAILS[code];
  if (row.channel !== 'email') {
    throw new UnsendableRow(`${code} is an email but the row is ${row.channel}`);
  }
  const to = entry.recipients ?? row.recipient_emails;
  if (!to || to.length === 0) {
    throw new UnsendableRow(`${code} is an email with no recipient`);
  }
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const attachments = parseAttachments(payload.attachments, code);
  const values = derivedValues(
    code,
    Object.fromEntries(
      Object.entries(payload)
        .filter(([key]) => key !== 'attachments')
        .map(([key, value]) => [key, value === null || value === undefined ? '' : String(value)]),
    ),
  );
  const replyTo = options.replyTo ?? DEFAULT_SENDER_ADDRESSES[entry.sender];
  const subject = render(entry.title, values);
  // The signature names the sender's monitored address as /settings has it.
  const text = signedBy(render(entry.body, values), entry.sender, replyTo);
  return {
    kind: 'email',
    sender: entry.sender,
    to,
    subject,
    body: text,
    html: documentHtml(code, values, subject, text, attachments, replyTo),
    attachments,
  };
}
