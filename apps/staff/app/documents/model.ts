import {
  COMPLETION_EVIDENCE_FORM_LABELS,
  DOC_LABELS,
  canActOnDocuments,
  canDeclareConviction,
  canSignOptOut,
  completionEffectiveFrom,
  daysBetween,
  documentState,
  isDocType,
} from '@thc/domain';
import type { DocType, DocumentState } from '@thc/domain';
import type { DeclarationRecord, DocumentRecord, DocumentsData } from './types';

/**
 * The Documents tab as a view — §10.4, §4.1–4.5, §10.7,
 * `wireframes/staff/documents.html`.
 *
 * Pure: the page renders this and the tests assert it, so every state the
 * wireframe draws is a case here rather than a branch buried in JSX.
 *
 *   verified      "Verified · expires 14.03.2031"
 *   expiring      ≤ 30 days — N1's window — with an Upload for the replacement
 *   expired       "Expired 17.09.2026", Upload (the §4.3 block has landed)
 *   in_review     a pending upload; the old one, if still valid, keeps counting
 *   rejected      "Re-upload · "<the manager's reason>"" (§4.1, N8)
 *   missing       a branch document never supplied
 *   superseded    an earlier period's evidence (§2.12), read-only history
 *   not_needed    a graduate's term letter (§4.5)
 *   optional      the completion letter slot, Student visa only
 *
 * Nothing here decides compliance. The status pill is the database's
 * status; the lock is `appLock()`'s; a row being "expired" is
 * `doc_expires_on()`'s date against the day the database evaluated.
 */

export type RowState = DocumentState | 'missing' | 'optional';

/** The `.docrow` modifier each state draws with (packages/ui DocRow). */
export type RowTone = 'pending' | 'review' | 'verified' | 'rejected' | 'expired';

export interface RowAction {
  label: string;
  href: string;
  primary: boolean;
}

export interface DocRowView {
  key: string;
  /** A doc type, or `criminal_declaration`. */
  kind: DocType | 'criminal_declaration';
  title: string;
  state: RowState;
  tone: RowTone;
  icon: string;
  meta: string;
  /** Colours the meta line — coral for a rejection or an expiry. */
  metaTone: 'coral' | 'amber' | null;
  pill: { tone: 'green' | 'amber' | 'coral' | 'neutral'; text: string } | null;
  action: RowAction | null;
}

export interface OptOutView {
  state: 'not_signed' | 'signed' | 'cancelling' | 'cancelled';
  title: string;
  meta: string;
  action: RowAction;
}

export interface DocumentsView {
  statusPill: { tone: 'green' | 'coral' | 'amber'; text: string };
  capLine: string | null;
  /** The amber banner over the list when something needs the worker (not while locked). */
  attention: { headline: string; detail: string | null } | null;
  rows: DocRowView[];
  completion: DocRowView | null;
  optOut: OptOutView | null;
  history: DocRowView[];
  canUpload: boolean;
  canDeclare: boolean;
}

// ---------------------------------------------------------------------
// Formatting (§1.8: document dates are UK calendar days; audit stamps UK)
// ---------------------------------------------------------------------

/** "14.03.2031" from an ISO date. */
export function formatDay(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** "18.09.2026 14:44" — an audit stamp, UK time only (§1.8). */
export function formatStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

/** The UK calendar day of a timestamp. */
export function ukDay(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
  return parts;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------
// Branch and cap
// ---------------------------------------------------------------------

const BRANCH_LABELS: Record<string, string> = {
  uk_irish: 'UK / Irish citizen',
  eu_settled: 'EU / EEA — settled or pre-settled',
  work_visa: 'Work visa',
  international_student: 'International student',
  dependant_other: 'Dependant / other status',
};

/**
 * "International student · 20 h/week in term time until 13.12.2026" — the
 * wireframe's line beside the status pill. Calculated by `weekly_cap_for()`
 * and never typed (RULE-20); this only words it.
 */
export function capLine(data: DocumentsData): string | null {
  const branch = data.rtwBranch ? (BRANCH_LABELS[data.rtwBranch] ?? null) : null;
  const cap = data.cap;
  if (!cap) return branch;
  let limit: string;
  if (cap.hours === null) {
    limit = 'no weekly limit — you have signed the 48-hour opt-out';
  } else if (cap.band === 'visa_expired_0') {
    limit = 'no hours — your right to work has expired';
  } else {
    limit = `${cap.hours} h/week — ${cap.label}`;
    if (cap.until) limit += ` until ${formatDay(cap.until)}`;
  }
  return branch ? `${branch} · ${limit}` : limit;
}

// ---------------------------------------------------------------------
// One row per document type
// ---------------------------------------------------------------------

function uploadHref(docType: DocType): string {
  return `/documents/upload/${docType}`;
}

/** The order the wireframe reads in: what needs the worker first. */
const ORDER: Record<RowState, number> = {
  expired: 0,
  rejected: 1,
  missing: 2,
  expiring: 3,
  in_review: 4,
  verified: 5,
  not_needed: 6,
  optional: 7,
  superseded: 8,
};

function titleFor(docType: DocType, record?: DocumentRecord): string {
  return record?.label || DOC_LABELS[docType];
}

function shareCodeMeta(record: DocumentRecord): string {
  return record.shareCodeTail ? `code ending ${record.shareCodeTail}` : 'share code';
}

/**
 * A verified row's meta line. The share code reads its expiry as the
 * right-to-work date (§4.4 "right to work until … from gov.uk"); the term
 * letter reminds the worker that it dies 31 December whatever it prints.
 */
function verifiedMeta(record: DocumentRecord, state: DocumentState, today: string): string {
  const expires = record.expiresOn;
  if (state === 'not_needed') {
    return 'No longer needed — your completion letter is approved';
  }
  if (!expires) return 'Verified';
  if (state === 'expired') return `Expired ${formatDay(expires)}`;
  const left = daysBetween(today, expires);
  const leftText = plural(left, 'day', 'days');
  if (record.docType === 'share_code_report') {
    return state === 'expiring'
      ? `Right to work until ${formatDay(expires)} (${leftText}) — enter a new share code`
      : `Verified · right to work until ${formatDay(expires)} (gov.uk)`;
  }
  if (record.docType === 'university_term_dates_letter') {
    return state === 'expiring'
      ? `Expires ${formatDay(expires)} (${leftText}) — upload next year’s letter`
      : `Verified · expires ${formatDay(expires)} · reminders from 1 Dec`;
  }
  return state === 'expiring'
    ? `Expires ${formatDay(expires)} (${leftText}) — upload the renewed one`
    : `Verified · expires ${formatDay(expires)}`;
}

function rowFor(
  docType: DocType,
  records: readonly DocumentRecord[],
  data: DocumentsData,
  canUpload: boolean,
): DocRowView | null {
  const current = records.find((r) => r.isCurrent);
  if (!current) return null;
  const counted = records.find((r) => r.isCountedVerified) ?? null;
  const title = titleFor(docType, current);
  const today = data.today;
  const isShare = docType === 'share_code_report';

  const state = documentState(current, today, data.termLetterApplies);
  const base = { key: `doc:${docType}`, kind: docType, title, state } as const;

  if (state === 'in_review') {
    // The replacement is pending; the last verified one still counts until
    // it runs out (current_verified_docs()), so say which is which.
    const what = isShare
      ? `In review · new ${shareCodeMeta(current)} entered ${formatDay(ukDay(current.uploadedAt))}`
      : `In review · uploaded ${formatDay(ukDay(current.uploadedAt))}`;
    let tail = '';
    if (counted && counted.id !== current.id && counted.expiresOn) {
      const old = documentState(counted, today, data.termLetterApplies);
      tail =
        old === 'expired'
          ? ` · the previous one expired ${formatDay(counted.expiresOn)}`
          : ` · your current one stays valid until ${formatDay(counted.expiresOn)}`;
    }
    return {
      ...base,
      tone: 'pending',
      icon: current.hasFile ? 'PDF' : '…',
      meta: what + tail,
      metaTone: null,
      pill: { tone: 'amber', text: 'In review' },
      action: null,
    };
  }

  if (state === 'rejected') {
    const reason = current.rejectionReason
      ? `“${current.rejectionReason}”`
      : 'see the office’s note';
    return {
      ...base,
      tone: 'rejected',
      icon: '✕',
      meta: `Re-upload · ${reason}`,
      metaTone: 'coral',
      pill: null,
      action: canUpload
        ? {
            label: isShare ? 'Enter new code' : 'Re-upload',
            href: uploadHref(docType),
            primary: true,
          }
        : null,
    };
  }

  if (state === 'expired') {
    return {
      ...base,
      tone: 'expired',
      icon: '!',
      meta: verifiedMeta(current, state, today),
      metaTone: 'coral',
      pill: null,
      action: canUpload
        ? { label: isShare ? 'Enter new code' : 'Upload', href: uploadHref(docType), primary: true }
        : null,
    };
  }

  if (state === 'expiring') {
    return {
      ...base,
      tone: 'review',
      icon: '!',
      meta: verifiedMeta(current, state, today),
      metaTone: 'amber',
      pill: null,
      action: canUpload
        ? { label: isShare ? 'Enter new code' : 'Upload', href: uploadHref(docType), primary: true }
        : null,
    };
  }

  // verified · not_needed
  return {
    ...base,
    tone: 'verified',
    icon: '✓',
    meta: verifiedMeta(current, state, today),
    metaTone: null,
    pill: {
      tone: state === 'not_needed' ? 'neutral' : 'green',
      text: state === 'not_needed' ? 'Not needed' : 'Verified',
    },
    action: null,
  };
}

/** `onboarding_documents_missing()` tokens that are documents the worker supplies here. */
function missingRows(data: DocumentsData, present: ReadonlySet<string>, canUpload: boolean) {
  const rows: DocRowView[] = [];
  for (const token of data.missing) {
    const docType: DocType | null =
      token === 'share_code' ? 'share_code_report' : isDocType(token) ? token : null;
    if (!docType || present.has(docType)) continue;
    rows.push({
      key: `missing:${docType}`,
      kind: docType,
      title: DOC_LABELS[docType],
      state: 'missing',
      tone: 'pending',
      icon: '—',
      meta: docType === 'share_code_report' ? 'Missing · enter your share code' : 'Missing',
      metaTone: 'coral',
      pill: null,
      action: canUpload
        ? {
            label: docType === 'share_code_report' ? 'Enter code' : 'Upload',
            href: uploadHref(docType),
            primary: true,
          }
        : null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------
// The criminal conviction declaration row (§10.7)
// ---------------------------------------------------------------------

/**
 * The latest declaration that is not superseded. Its details are never
 * here to show — `staff_documents()` does not return them — and the row
 * says so for a pending one, as the wireframe does.
 */
function declarationRow(declarations: readonly DeclarationRecord[]): DocRowView | null {
  const latest = declarations.find((d) => !d.superseded);
  if (!latest) return null;
  const when = latest.source === 'onboarding' ? 'at onboarding' : 'from the app';
  const base = {
    key: 'declaration',
    kind: 'criminal_declaration' as const,
    title: 'Criminal conviction declaration',
  };
  if (latest.reviewStatus === 'pending') {
    return {
      ...base,
      state: 'in_review',
      tone: 'pending',
      icon: '…',
      meta: `In review · declared ${formatStamp(latest.declaredAt)} · details not shown here`,
      metaTone: null,
      pill: { tone: 'amber', text: 'In review' },
      action: null,
    };
  }
  if (latest.reviewStatus === 'rejected') {
    // §10.7 Reject: the office contacts the worker directly — nothing to do here.
    return {
      ...base,
      state: 'rejected',
      tone: 'rejected',
      icon: '✕',
      meta: 'Reviewed — the office will be in touch',
      metaTone: null,
      pill: null,
      action: null,
    };
  }
  return {
    ...base,
    state: 'verified',
    tone: 'verified',
    icon: '✓',
    meta: latest.answer
      ? `Verified · declared ${when}, ${formatDay(ukDay(latest.declaredAt))}`
      : `Verified · answered “No” ${when}, ${formatDay(ukDay(latest.declaredAt))}`,
    metaTone: null,
    pill: { tone: 'green', text: 'Verified' },
    action: null,
  };
}

// ---------------------------------------------------------------------
// The completion letter slot (requirement §2.1, §4.5)
// ---------------------------------------------------------------------

export const COMPLETION_HREF = '/documents/completion-letter';

function completionRow(data: DocumentsData, canUpload: boolean): DocRowView | null {
  const letters = data.documents.filter((d) => d.docType === 'university_completion_letter');
  const student = data.rtwBranch === 'international_student';
  if (!student && letters.length === 0) return null;

  const current = letters.find((d) => d.isCurrent) ?? null;
  const title = DOC_LABELS.university_completion_letter;
  const base = { key: 'completion', kind: 'university_completion_letter' as const, title };
  const upload = canUpload && student;
  const holdCap =
    data.cap?.hours !== null && data.cap?.hours !== undefined
      ? `${data.cap.hours} h`
      : 'your current limit';

  if (!current) {
    return {
      ...base,
      state: 'optional',
      tone: 'pending',
      icon: '+',
      meta: 'Optional · upload when you finish your course. Once the office approves it, your limit rises to 48 h/week from your course completion date.',
      metaTone: null,
      pill: null,
      action: upload ? { label: 'Upload', href: COMPLETION_HREF, primary: false } : null,
    };
  }

  if (current.reviewStatus === 'pending') {
    const form = current.evidenceForm
      ? COMPLETION_EVIDENCE_FORM_LABELS[current.evidenceForm]
      : 'Completion evidence';
    return {
      ...base,
      state: 'in_review',
      tone: 'pending',
      icon: current.hasFile ? 'PDF' : '…',
      meta: `In review · ${form} · completion date ${formatDay(current.completionDateClaimed)} · your limit stays at ${holdCap} until the office approves it`,
      metaTone: null,
      pill: { tone: 'amber', text: 'In review' },
      action: null,
    };
  }

  if (current.reviewStatus === 'rejected') {
    return {
      ...base,
      state: 'rejected',
      tone: 'rejected',
      icon: '✕',
      meta: `Re-upload · ${current.rejectionReason ? `“${current.rejectionReason}”` : 'see the office’s note'} · your limit has not changed`,
      metaTone: 'coral',
      pill: null,
      action: upload ? { label: 'Re-upload', href: COMPLETION_HREF, primary: true } : null,
    };
  }

  // Approved. The release runs from the COMPLETION DATE (never backdated
  // before the approval): completionEffectiveFrom(), the same rule as
  // completion_effective_from() in SQL.
  const completion = current.completionDate ?? data.courseCompletionDate;
  const verifiedOn =
    data.graduatedAt ?? (current.reviewedAt ? ukDay(current.reviewedAt) : data.today);
  const from = completion ? completionEffectiveFrom(completion, verifiedOn) : verifiedOn;
  const future = from > data.today;
  return {
    ...base,
    state: 'verified',
    tone: 'verified',
    icon: '✓',
    meta: future
      ? `Approved · 48 h/week from ${formatDay(from)} — until then your current limit applies`
      : `Approved · 48 h/week since ${formatDay(from)} (course completed ${formatDay(completion)})`,
    metaTone: null,
    pill: { tone: 'green', text: 'Approved' },
    action: null,
  };
}

// ---------------------------------------------------------------------
// The 48-hour opt-out (requirement §2.4)
// ---------------------------------------------------------------------

export const OPT_OUT_HREF = '/documents/opt-out';

/**
 * Offered only to someone who may sign it: 18 or over with a date of birth
 * on file (`canSignOptOut`, mirroring `sign_wtr_optout()`). An under-18 is
 * not shown the flow at all — "do not offer the opt-out flow".
 */
export function optOutView(data: DocumentsData): OptOutView | null {
  if (!canSignOptOut(data.dob, data.today)) return null;
  if (data.status !== 'compliant' && data.status !== 'blocked') return null;
  const o = data.optOut;
  const title = '48-hour opt-out (Working Time Regulations)';
  const notice = o.noticeDays ?? 7;

  if (o.signed && o.cancelledFrom) {
    const running = o.cancelledFrom > data.today;
    return {
      state: running ? 'cancelling' : 'cancelled',
      title,
      meta: running
        ? `Cancelled · the 48-hour limit returns on ${formatDay(o.cancelledFrom)}, at the end of your ${plural(notice, 'day', 'days')}’ notice`
        : `Cancelled · the 48-hour limit has applied since ${formatDay(o.cancelledFrom)}`,
      action: { label: running ? 'Details' : 'Sign again', href: OPT_OUT_HREF, primary: false },
    };
  }
  if (o.signed) {
    return {
      state: 'signed',
      title,
      meta: `Signed${o.signedAt ? ` ${formatDay(ukDay(o.signedAt))}` : ''} · cancel any time with ${plural(notice, 'day', 'days')}’ notice. It never lifts a Student visa’s term-time limit.`,
      action: { label: 'Manage', href: OPT_OUT_HREF, primary: false },
    };
  }
  return {
    state: 'not_signed',
    title,
    meta: 'Not signed · the law limits your average week to 48 hours unless you choose to opt out in writing.',
    action: { label: 'Read', href: OPT_OUT_HREF, primary: false },
  };
}

// ---------------------------------------------------------------------
// History — superseded evidence, read-only (§2.12)
// ---------------------------------------------------------------------

function historyRows(data: DocumentsData): DocRowView[] {
  const docs = data.documents
    .filter((d) => d.reviewStatus === 'superseded')
    .map<DocRowView>((d) => ({
      key: `history:${d.id}`,
      kind: d.docType,
      title: titleFor(d.docType, d),
      state: 'superseded',
      tone: 'pending',
      icon: '·',
      meta: `Superseded · uploaded ${formatDay(ukDay(d.uploadedAt))} · kept on record, read-only`,
      metaTone: null,
      pill: { tone: 'neutral', text: 'Superseded' },
      action: null,
    }));
  const decl = data.declarations
    .filter((d) => d.superseded)
    .map<DocRowView>((d) => ({
      key: `history:${d.id}`,
      kind: 'criminal_declaration',
      title: 'Criminal conviction declaration',
      state: 'superseded',
      tone: 'pending',
      icon: '·',
      meta: `Superseded · declared ${formatDay(ukDay(d.declaredAt))} · kept on record, read-only`,
      metaTone: null,
      pill: { tone: 'neutral', text: 'Superseded' },
      action: null,
    }));
  return [...docs, ...decl];
}

// ---------------------------------------------------------------------
// The whole tab
// ---------------------------------------------------------------------

export function buildDocumentsView(data: DocumentsData): DocumentsView {
  const canUpload = canActOnDocuments(data.status, data.blockKind);

  const byType = new Map<DocType, DocumentRecord[]>();
  for (const record of data.documents) {
    if (record.docType === 'university_completion_letter') continue;
    const list = byType.get(record.docType) ?? [];
    list.push(record);
    byType.set(record.docType, list);
  }

  const docRows: DocRowView[] = [];
  for (const [docType, records] of byType) {
    const row = rowFor(docType, records, data, canUpload);
    if (row) docRows.push(row);
  }
  const present = new Set(docRows.map((r) => r.kind as string));
  docRows.push(...missingRows(data, present, canUpload));
  docRows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.title.localeCompare(b.title));

  const declaration = declarationRow(data.declarations);
  const rows = declaration ? [...docRows, declaration] : docRows;

  const needs = docRows.filter(
    (r) =>
      r.state === 'expired' ||
      r.state === 'rejected' ||
      r.state === 'missing' ||
      r.state === 'expiring',
  ).length;
  const replacing = docRows.some((r) => r.state === 'in_review');
  const attention =
    data.status === 'compliant' && needs > 0
      ? {
          headline: `${plural(needs, 'document needs', 'documents need')} your attention.`,
          detail: replacing
            ? 'You stay compliant while a replacement is in review before the old one expires.'
            : 'Upload a replacement before the current one expires and you stay compliant throughout.',
        }
      : null;

  const statusPill =
    data.status === 'compliant'
      ? ({ tone: 'green', text: 'Compliant' } as const)
      : data.status === 'blocked'
        ? ({ tone: 'coral', text: 'Blocked' } as const)
        : ({ tone: 'amber', text: 'In review' } as const);

  return {
    statusPill,
    capLine: capLine(data),
    attention,
    rows,
    completion: completionRow(data, canUpload),
    optOut: optOutView(data),
    history: historyRows(data),
    canUpload,
    canDeclare: canDeclareConviction(data.status, data.blockKind),
  };
}

/** The row an upload screen is about, for its context line. */
export function rowForType(view: DocumentsView, docType: DocType): DocRowView | null {
  return view.rows.find((r) => r.kind === docType) ?? null;
}
