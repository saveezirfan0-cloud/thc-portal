/**
 * Link many "Applied · no Payroll ID" rows at once (ADR-0144). Pure, so the
 * panel and the vitest suite read the one definition.
 *
 * A row is **safe** when Link needs nobody's word: the names agree, and the
 * sheet's Payroll ID is free or already theirs. A **name differs** row is
 * linkable only on the office's word that the two names are one person, so
 * it is never ticked by "Tick all safe" and the confirmation lists every
 * pair. A taken Payroll ID, or another one already carried, is never
 * linkable here (ADR-0143): one of two records is wrong.
 */
import type { RosterEntry } from './data';
import { keptLinkable } from './report';
import type { RosterKept } from './report';

export interface KeptRow {
  row: RosterEntry;
  kept: RosterKept;
}

export interface LinkItem {
  entryId: string;
  staffId: string;
  confirmName: boolean;
}

/** Link settles it with no question asked. */
export function keptSafe(k: RosterKept): boolean {
  return keptLinkable(k) && k.reason !== 'name_differs';
}

/** The list rows that have a kept reason, in the list's order. */
export function keptRows(waiting: readonly RosterEntry[], kept: readonly RosterKept[]): KeptRow[] {
  const byEntry = new Map(kept.map((k) => [k.entryId, k]));
  return waiting.flatMap((row) => {
    const k = byEntry.get(row.id);
    return k ? [{ row, kept: k }] : [];
  });
}

/** What "Link ticked" sends: only linkable rows, each name-differs row carrying the office's word. */
export function linkPlan(rows: readonly KeptRow[], ticked: ReadonlySet<string>): LinkItem[] {
  return rows
    .filter(({ row, kept }) => ticked.has(row.id) && keptLinkable(kept))
    .map(({ row, kept }) => ({
      entryId: row.id,
      staffId: kept.staffId,
      confirmName: kept.reason === 'name_differs',
    }));
}

export function sheetName(row: RosterEntry): string {
  return [row.first_name, row.last_name].filter(Boolean).join(' ');
}

export interface BulkLinkOutcome {
  linked: number;
  /** Linked with their Payroll ID, but not switched to SpudBros: upcoming THC shifts. */
  heldSpudbros: number;
  failed: { entryId: string; message: string }[];
}

/** The sentence after "Link ticked": how many, and what to do about the rest. */
export function bulkSummary(outcome: BulkLinkOutcome): string {
  const parts = [
    `${outcome.linked} linked: they have their Payroll ID and group, and come off the list.`,
  ];
  if (outcome.heldSpudbros > 0)
    parts.push(
      `${outcome.heldSpudbros} with upcoming THC shifts ${outcome.heldSpudbros === 1 ? 'was' : 'were'} not switched to SpudBros Express: do that on their profile once those are done.`,
    );
  if (outcome.failed.length > 0)
    parts.push(
      `${outcome.failed.length} could not be linked and ${outcome.failed.length === 1 ? 'stays' : 'stay'} ticked.`,
    );
  return parts.join(' ');
}
