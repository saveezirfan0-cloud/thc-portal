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
  type EditableField,
  type ReconfirmField,
  type RoleSectionDraft,
  type RoleSectionIssue,
  defaultAllocationPerHour,
  derivedEventWindow,
  isEditLocked,
  reconfirmingChanges,
  ukRoleWindow,
  validateRoleSection,
} from '@thc/domain';

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
  allocationPerHour: number;
  /**
   * Once the manager types their own allocation the default stops following
   * headcount and buffer. §3.4 makes the default editable, not sticky.
   */
  allocationTouched: boolean;
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
  roles: RoleDraft[];
}

let keySeq = 0;

/**
 * A new role section, pre-filled with the event's current window (§3.2), then
 * edited independently. Allocation starts at headcount + buffer (§3.4).
 */
export function newRoleDraft(draft: EventDraft, roleId: string, payRate = 0): RoleDraft {
  keySeq += 1;
  return {
    key: `role-${keySeq}`,
    id: null,
    roleId,
    start: draft.overallStart,
    end: draft.overallEnd,
    headcount: 1,
    buffer: 0,
    chargeRate: 0,
    payRate,
    dressCode: '',
    dressCodeOther: '',
    autoAssign: draft.autoAssign,
    allocationPerHour: defaultAllocationPerHour(1, 0),
    allocationTouched: false,
  };
}

/**
 * Applies one edit to a role section, keeping the allocation default in step
 * with headcount and buffer until the manager overrides it.
 */
export function editRole(role: RoleDraft, patch: Partial<RoleDraft>): RoleDraft {
  const next = { ...role, ...patch };
  if (patch.allocationPerHour !== undefined) next.allocationTouched = true;
  else if (!next.allocationTouched) {
    next.allocationPerHour = defaultAllocationPerHour(next.headcount, next.buffer);
  }
  return next;
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
 * `bookings.shift_id` cascades on delete, so removing a section with people
 * on it would destroy their invitations and confirmations outright — no
 * cancelled transition, no cause, no history. §3.6 makes Withdraw the only
 * way a manager takes someone off a shift, and §3.2 is explicit that cutting
 * headcount never auto-removes anyone. A section that was never saved has
 * nobody on it and is always removable.
 */
export function canRemoveRole(role: RoleDraft, bookedBySectionId: Record<string, number>): boolean {
  if (!role.id) return true;
  return (bookedBySectionId[role.id] ?? 0) === 0;
}

/**
 * §3.2: the dress code "defaults to the dress code already set for this
 * client + role combination on the client's Rate card (§9.7)". The first
 * entry of the card's list is the default (shift-builder.html opens Chef on
 * "Chef whites"); a value already on the new list, or the per-event "Other"
 * override, is kept; anything else falls back to the list's first entry, or
 * to nothing when the card has no list for this role.
 */
export function defaultDressCode(dressCodes: readonly string[], current = ''): string {
  if (current === DRESS_CODE_OTHER) return current;
  if (current && dressCodes.includes(current)) return current;
  return dressCodes[0] ?? '';
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
