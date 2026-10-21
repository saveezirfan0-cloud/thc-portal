/**
 * The Shift Builder's working state — Scope §3.2, §3.4, §3.5.
 *
 * Everything here is pure, so the form's behaviour can be tested without
 * rendering it. The rules themselves are NOT re-derived: the four-hour floor,
 * the derived event window, the allocation default and the edit lock all come
 * from `@thc/domain`. This module only holds what the manager has typed and
 * turns it into the shapes those rules take.
 */

import {
  type BufferSuggestionRule,
  type EditableField,
  type ReconfirmField,
  type RoleSectionDraft,
  type RoleSectionIssue,
  UK_ZONE,
  defaultAllocationPerHour,
  derivedEventWindow,
  formatTimeIn,
  isEditLocked,
  reconfirmingChanges,
  seriesPosition,
  suggestBuffer,
  ukRoleWindow,
  validateRoleSection,
} from '@thc/domain';
import type { SavedEvent } from './data';

/**
 * ADR-0079: the gender a client asked for on a role — HMRC's M or F, the
 * values `staff.gender` holds — or null for anyone.
 */
export type RequiredGender = 'M' | 'F' | null;

/** How a section with a required gender is labelled, here and on the event board. */
export const REQUIRED_GENDER_LABEL: Readonly<Record<'M' | 'F', string>> = {
  M: 'Male staff only',
  F: 'Female staff only',
};

/**
 * The dress code a role section starts with: the client's one uniform for that
 * role (§3.2). With none or several on the rate card there is nothing to
 * assume, so it stays empty and the manager chooses. Always editable.
 */
export function defaultDressCode(dressCodes: readonly string[]): string {
  return dressCodes.length === 1 ? dressCodes[0]! : '';
}

/** The sentinel the dress-code select uses for the per-event free text (§9.7). */
export const DRESS_CODE_OTHER = '__other__';

export interface RoleDraft {
  /** Stable key for React; not persisted. */
  key: string;
  /** The `shift_requirements` row this section edits, or null when it is new. */
  id: string | null;
  roleId: string;
  /** Europe/London wall clock, as typed: "17:00" (§1.8). */
  start: string;
  end: string;
  headcount: number;
  buffer: number;
  /** Pounds, as the rate card and the form carry them. */
  chargeRate: number;
  payRate: number;
  /** A value from the client's list for this role, or DRESS_CODE_OTHER. */
  dressCode: string;
  /** Free text, this event only — never saved back to the client's list. */
  dressCodeOther: string;
  autoAssign: boolean;
  /**
   * ADR-0079: the client asked for staff of one gender on this role.
   * Auto-assign, Radar and Accept then book only that gender
   * (`auto_assign_candidates`). Null = anyone.
   */
  requiredGender: RequiredGender;
  /**
   * ADR-0117: the client wants the SAME staff on every day of this job for
   * this role. Auto-assign, Radar, Accept and a manual invite then offer the
   * role only to someone who can do every other day that also asks for it
   * (`auto_assign_candidates`). Per role, off by default; Duplicate keeps it.
   */
  sameStaffAllDays: boolean;
  allocationPerHour: number;
  /**
   * Once the manager types their own allocation the default stops following
   * headcount and buffer. §3.4 makes the default editable, not sticky.
   */
  allocationTouched: boolean;
  /**
   * ADR-0181: once the manager types a buffer it stops following the
   * suggested one ("1 for every 5"). A section opened from a saved event —
   * edited or duplicated — starts touched: a saved buffer is never changed
   * by the suggestion.
   */
  bufferTouched: boolean;
}

export interface EventDraft {
  clientId: string;
  venueId: string;
  title: string;
  /** "YYYY-MM-DD", the event's own date. */
  date: string;
  /** The overall window. It only pre-fills new roles (§3.2). */
  overallStart: string;
  overallEnd: string;
  poNumber: string;
  onsiteContact: string;
  notes: string;
  autoAssign: boolean;
  /**
   * ADR-0080: the languages staff on this event must speak — English
   * always, plus any the client asked for. Auto-assign, Radar and Accept
   * then book only people who speak every one (`auto_assign_candidates`).
   */
  requiredLanguages: string[];
  /**
   * ADR-0117: the event this one is a Duplicate of, or null. Saving links
   * the two as the days of one multi-day job (`link_event_series`) — the
   * staff are still not copied (§3.2).
   */
  duplicateOf: string | null;
  roles: RoleDraft[];
}

let keySeq = 0;

/**
 * A new role section, pre-filled with the event's current window (§3.2), then
 * edited independently. The buffer starts at the suggestion for one person
 * at the section's start (ADR-0181: 0, or 1 when the window starts before
 * 08:00 under THC's rule; 0 with the rule off) and allocation at
 * headcount + buffer (§3.4).
 */
export function newRoleDraft(
  draft: EventDraft,
  roleId: string,
  payRate = 0,
  bufferRule: BufferSuggestionRule | null = null,
): RoleDraft {
  keySeq += 1;
  const buffer = suggestBuffer(1, bufferRule, draft.overallStart) ?? 0;
  return {
    key: `role-${keySeq}`,
    id: null,
    roleId,
    start: draft.overallStart,
    end: draft.overallEnd,
    headcount: 1,
    buffer,
    chargeRate: 0,
    payRate,
    dressCode: '',
    dressCodeOther: '',
    autoAssign: draft.autoAssign,
    requiredGender: null,
    sameStaffAllDays: false,
    allocationPerHour: defaultAllocationPerHour(1, buffer),
    allocationTouched: false,
    bufferTouched: false,
  };
}

/**
 * Applies one edit to a role section.
 *
 *   * The buffer follows the suggestion as the headcount — or the section's
 *     own start, which decides the early-start extra — changes, until the
 *     manager types one (ADR-0181). With no rule, or the rule off, nothing
 *     follows and the buffer is only what was typed.
 *   * The allocation default then follows headcount and buffer until the
 *     manager overrides it (§3.4).
 */
export function editRole(
  role: RoleDraft,
  patch: Partial<RoleDraft>,
  bufferRule: BufferSuggestionRule | null = null,
): RoleDraft {
  const next = { ...role, ...patch };
  if (patch.buffer !== undefined && patch.bufferTouched === undefined) next.bufferTouched = true;
  if (!next.bufferTouched) {
    // RULE-18: the section's own start, never the event window.
    const suggested = suggestBuffer(next.headcount, bufferRule, next.start);
    if (suggested !== null) next.buffer = suggested;
  }
  if (patch.allocationPerHour !== undefined) next.allocationTouched = true;
  else if (!next.allocationTouched) {
    next.allocationPerHour = defaultAllocationPerHour(next.headcount, next.buffer);
  }
  return next;
}

/**
 * The edit "Use suggestion (N)" makes, or null when there is nothing to
 * suggest or the buffer already is the suggestion.
 *
 * On a section not saved yet (new, or a Duplicate's copy) it hands the
 * buffer back to the suggestion, which then follows the headcount again. On
 * a saved section it only sets the number: the manager chose it, and a saved
 * buffer never moves on its own afterwards (ADR-0181).
 */
export function bufferSuggestionPatch(
  role: RoleDraft,
  bufferRule: BufferSuggestionRule | null,
): Partial<RoleDraft> | null {
  const suggested = suggestBuffer(role.headcount, bufferRule, role.start);
  if (suggested === null || suggested === role.buffer) return null;
  return role.id === null ? { bufferTouched: false } : { buffer: suggested };
}

/** True once the date and both times are complete enough to resolve. */
export function isResolvable(date: string, role: RoleDraft): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    /^\d{2}:\d{2}$/.test(role.start) &&
    /^\d{2}:\d{2}$/.test(role.end)
  );
}

/** The instants a role section's typed times resolve to on the event's date. */
export function resolveRole(role: RoleDraft, date: string): RoleSectionDraft {
  return {
    ...ukRoleWindow(date, role.start, role.end),
    headcount: role.headcount,
    buffer: role.buffer,
    allocationPerHour: role.allocationPerHour,
  };
}

export function roleIssues(role: RoleDraft, date: string): RoleSectionIssue[] {
  return validateRoleSection(resolveRole(role, date));
}

/**
 * The derived event window (RULE-18), or null while there are no roles yet —
 * or while the date or a time is still half-typed and nothing resolves.
 */
export function draftWindow(draft: EventDraft) {
  return derivedEventWindow(resolvableRoles(draft));
}

export function draftLocked(draft: EventDraft, now?: Date): boolean {
  return isEditLocked(resolvableRoles(draft), now);
}

function resolvableRoles(draft: EventDraft): RoleSectionDraft[] {
  return draft.roles
    .filter((role) => isResolvable(draft.date, role))
    .map((role) => resolveRole(role, draft.date));
}

export interface DraftIssues {
  /** Event-level problems: the fields the header needs before anything else. */
  event: string[];
  /** Per role key, in the order the sections are shown. */
  roles: Map<string, RoleSectionIssue[]>;
}

const NEEDS_ROLE = 'Choose a role for every section';
const NEEDS_TIMES = 'Every role section needs a start and an end';

export function draftIssues(draft: EventDraft): DraftIssues {
  const event: string[] = [];
  if (!draft.clientId) event.push('Choose a client');
  if (!draft.venueId) event.push('Choose a venue');
  if (!draft.title.trim()) event.push('Give the event a title');
  if (!draft.date) event.push('Set the event date');
  if (draft.roles.length === 0) event.push('Add at least one role');

  const roles = new Map<string, RoleSectionIssue[]>();
  for (const role of draft.roles) {
    if (!role.roleId && !event.includes(NEEDS_ROLE)) event.push(NEEDS_ROLE);

    // A half-typed date or time has nothing to check yet; the event-level
    // message is what the manager needs to see first. A missing ROLE is not
    // the same thing — the times are wrong on their own terms, so the
    // four-hour error shows whether or not the role has been picked.
    if (!isResolvable(draft.date, role)) {
      roles.set(role.key, []);
      if (draft.date && !event.includes(NEEDS_TIMES)) event.push(NEEDS_TIMES);
      continue;
    }
    roles.set(role.key, roleIssues(role, draft.date));
  }
  return { event, roles };
}

/** A new event's date that has already gone by (release audit, Shift Builder). */
export const PAST_DATE =
  'That date has already passed — a new event can only be built for today or a later day.';

/**
 * The past-date refusal for a NEW event, or null. `today` is the UK
 * calendar day (`ukToday()`), the day every rule is judged on. Both are
 * `YYYY-MM-DD`, so they compare as strings.
 */
export function pastDateIssue(date: string, today: string): string | null {
  return date !== '' && date < today ? PAST_DATE : null;
}

/** Save is disabled while any role section fails validation (§3.2). */
export function canSave(draft: EventDraft): boolean {
  const issues = draftIssues(draft);
  if (issues.event.length > 0) return false;
  if (draft.roles.some((role) => !isResolvable(draft.date, role))) return false;
  for (const list of issues.roles.values()) if (list.length > 0) return false;
  return true;
}

/**
 * Whether a role section can be removed from the builder at all.
 *
 * `bookings.shift_id` cascades on delete, so removing a section with anyone
 * confirmed on it would destroy their bookings outright — no cancelled
 * transition, no cause, no history. §3.6 makes Withdraw the only way a
 * manager takes someone off a shift, and §3.2 is explicit that cutting
 * headcount never auto-removes anyone. Pending invitations and applications
 * do not hold a section: the save closes them through
 * remove_shift_sections(), which tells each worker (ADR-0160). A section
 * that was never saved has nobody on it and is always removable.
 */
export function canRemoveRole(role: RoleDraft, heldBySectionId: Record<string, number>): boolean {
  if (!role.id) return true;
  return (heldBySectionId[role.id] ?? 0) === 0;
}

/**
 * A saved event as the builder's working state — for editing it, or as the
 * starting point of its Duplicate (§3.2).
 *
 * "Multi-day = separate events created via Duplicate (the clone copies the
 * roles, NOT the staff)." So a duplicate:
 *   * keeps the client, venue, title, PO, contact, notes and every role
 *     section's times, headcount, buffer, rates, dress code, allocation and
 *     staff gender — that is the client's ask, not the day's (ADR-0079) —
 *     and the languages the event needs, for the same reason (ADR-0080);
 *   * drops every section id, so saving creates new sections and nothing
 *     booked on the original — confirmed, invited or applied — comes along;
 *   * leaves the DATE empty: a day is the one thing a duplicate must change,
 *     and Save stays disabled until the manager sets it;
 *   * keeps each section's "Same staff on all days" (ADR-0117) and links the
 *     clone to the original as another day of one job on save — the staff
 *     are still not copied, only who may be invited is constrained;
 *   * starts with auto-assign ON at event and role level, the §3.4 default
 *     for any new event — a switch turned off on the original was about
 *     that day's people.
 *
 * `dressCodesFor` is the client's rate-card list for a role: a stored dress
 * code not on it was that event's own override and reopens as "Other".
 */
export function draftFromSaved(
  event: SavedEvent,
  dressCodesFor: (roleId: string) => string[],
  as: 'edit' | 'duplicate',
): EventDraft {
  const duplicate = as === 'duplicate';
  const roles: RoleDraft[] = event.sections.map((section, index) => {
    const onList = dressCodesFor(section.roleId).includes(section.dressCode);
    return {
      key: `${duplicate ? 'copy' : 'saved'}-${section.id}-${index}`,
      id: duplicate ? null : section.id,
      roleId: section.roleId,
      start: section.start,
      end: section.end,
      headcount: section.headcount,
      buffer: section.buffer,
      chargeRate: section.chargeRate,
      payRate: section.payRate,
      dressCode: section.dressCode && !onList ? DRESS_CODE_OTHER : section.dressCode,
      dressCodeOther: section.dressCode && !onList ? section.dressCode : '',
      autoAssign: duplicate ? true : section.autoAssign,
      requiredGender: section.requiredGender,
      // ADR-0117: the client's ask, not the day's - the clone keeps it.
      sameStaffAllDays: section.sameStaffAllDays,
      allocationPerHour: section.allocationPerHour,
      // Whatever is stored is the manager's choice; the default never
      // overwrites it on reopening (§3.4).
      allocationTouched: true,
      // ADR-0181: the same for the buffer, and a Duplicate keeps the copied
      // one — the suggestion never rewrites a saved number.
      bufferTouched: true,
    };
  });

  // A role added now is pre-filled with the event's CURRENT window (§3.2),
  // which is the derived one: earliest start → latest end (RULE-18).
  const window = derivedEventWindow(
    event.sections.map((s) => ukRoleWindow(event.date, s.start, s.end)),
  );

  return {
    clientId: event.clientId,
    venueId: event.venueId,
    title: event.title,
    date: duplicate ? '' : event.date,
    // Draft values stay "HH:MM" on the 24-hour clock, which `ukRoleWindow`
    // reads back; `TimeField` shows them on the operator's clock (ADR-0085).
    overallStart: window ? formatTimeIn(window.startsAt, UK_ZONE) : '07:00',
    overallEnd: window ? formatTimeIn(window.endsAt, UK_ZONE) : '23:30',
    poNumber: event.poNumber,
    onsiteContact: event.onsiteContact,
    notes: event.notes,
    autoAssign: duplicate ? true : event.autoAssign,
    requiredLanguages: [...event.requiredLanguages],
    duplicateOf: duplicate ? event.id : null,
    roles,
  };
}

/** What the worker is actually told to wear (§9.7). */
export function effectiveDressCode(role: RoleDraft): string {
  return role.dressCode === DRESS_CODE_OTHER ? role.dressCodeOther.trim() : role.dressCode;
}

// ---------------------------------------------------------------------
// §3.5 — what an edit does to the people already booked
// ---------------------------------------------------------------------

export interface RoleChange {
  key: string;
  /** The fields that changed on this section, triggering and silent alike. */
  changed: EditableField[];
  /** Of those, the ones that send that role's booked staff back to Awaiting. */
  reconfirming: ReconfirmField[];
}

/**
 * Compares a role section against the version that was saved.
 *
 * Re-confirmation is per role section: a start time moved on Waiting Staff
 * leaves Chef and Kitchen Porter untouched, and their workers are never asked
 * (§3.2, §3.5). Headcount, buffer, charge rate and the PO number apply
 * silently, however far they move.
 */
export function roleChanges(before: RoleDraft, after: RoleDraft, dateChanged: boolean): RoleChange {
  const changed: EditableField[] = [];
  if (before.start !== after.start) changed.push('starts_at');
  if (before.end !== after.end) changed.push('ends_at');
  if (dateChanged) changed.push('event_date');
  if (effectiveDressCode(before) !== effectiveDressCode(after)) changed.push('dress_code');
  if (before.headcount !== after.headcount) changed.push('headcount');
  if (before.buffer !== after.buffer) changed.push('buffer');
  if (before.chargeRate !== after.chargeRate) changed.push('charge_rate');
  if (before.payRate !== after.payRate) changed.push('pay_rate');
  if (before.allocationPerHour !== after.allocationPerHour) changed.push('allocation_per_hour');
  if (before.autoAssign !== after.autoAssign) changed.push('auto_assign');
  if (before.requiredGender !== after.requiredGender) changed.push('required_gender');
  if (before.sameStaffAllDays !== after.sameStaffAllDays) changed.push('same_staff_all_days');

  return { key: after.key, changed, reconfirming: reconfirmingChanges(changed) };
}

/**
 * Every role section whose booked staff will be asked to re-confirm, plus the
 * venue change that asks all of them (§3.5).
 */
export function reconfirmPlan(
  before: EventDraft,
  after: EventDraft,
): { venueChanged: boolean; roles: RoleChange[] } {
  const dateChanged = before.date !== after.date;
  const byId = new Map(before.roles.filter((r) => r.id).map((r) => [r.id!, r]));

  const roles: RoleChange[] = [];
  for (const role of after.roles) {
    const original = role.id ? byId.get(role.id) : undefined;
    // A role added now has nobody booked on it, so nobody to re-confirm.
    if (!original) continue;
    const change = roleChanges(original, role, dateChanged);
    if (change.changed.length > 0) roles.push(change);
  }

  return { venueChanged: before.venueId !== after.venueId, roles };
}

// ---------------------------------------------------------------------
// ADR-0117 — what the builder says about the days of a multi-day job
// ---------------------------------------------------------------------

/**
 * Where this event stands in a multi-day job, for the hint under the
 * "Same staff on all days" switch:
 *   * `duplicate` — a new event being built from another; saving links them;
 *   * `series`    — a saved event with other live days (Day 2 of 3);
 *   * `single`    — neither: the switch changes nothing until another day is
 *                   added by Duplicate.
 */
export type SeriesContext =
  { kind: 'single' } | { kind: 'duplicate' } | { kind: 'series'; day: number; of: number };

export function seriesContextFor(
  draft: Pick<EventDraft, 'duplicateOf'>,
  saved: Pick<SavedEvent, 'id' | 'seriesDays'> | null,
): SeriesContext {
  if (saved) {
    const position = seriesPosition(saved.id, saved.seriesDays);
    return position ? { kind: 'series', ...position } : { kind: 'single' };
  }
  return draft.duplicateOf ? { kind: 'duplicate' } : { kind: 'single' };
}
