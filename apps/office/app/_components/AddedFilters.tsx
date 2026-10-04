'use client';

import { Select } from '@thc/ui';
import {
  ADDED_BY_ANYONE,
  ADDED_BY_NOBODY,
  addedByOptions,
  type Added,
  type AddedFilter,
} from '../_lib/addedBy';

export interface AddedFiltersProps {
  /** The rows on the page, so the picker only offers managers who matched something. */
  rows: readonly Added[];
  value: AddedFilter;
  onChange: (next: AddedFilter) => void;
}

/**
 * "Added by" and "Date added" for the Venues and Clients lists — the same
 * two controls on both, so the same component. Controls only: they sit in
 * the screen's own `.toolbar`, which also owns the Clear button.
 *
 * The dates are UK calendar days (§1.8), inclusive at both ends.
 */
export function AddedFilters({ rows, value, onChange }: AddedFiltersProps) {
  const { managers, hasNobody } = addedByOptions(rows);

  return (
    <>
      <Select
        value={value.by}
        onChange={(event) => onChange({ ...value, by: event.target.value })}
        aria-label="Filter by who added"
        style={{ height: 32, width: 170 }}
      >
        <option value={ADDED_BY_ANYONE}>Added by: anyone</option>
        {managers.map((manager) => (
          <option key={manager.value} value={manager.value}>
            {manager.label}
          </option>
        ))}
        {hasNobody ? <option value={ADDED_BY_NOBODY}>Not recorded</option> : null}
      </Select>
      <label className="row sm muted" style={{ gap: 6, alignItems: 'center' }}>
        Added from
        <input
          className="input"
          style={{ height: 32, width: 150 }}
          type="date"
          value={value.from}
          max={value.to || undefined}
          onChange={(event) => onChange({ ...value, from: event.target.value })}
          aria-label="Added from (UK date)"
        />
      </label>
      <label className="row sm muted" style={{ gap: 6, alignItems: 'center' }}>
        to
        <input
          className="input"
          style={{ height: 32, width: 150 }}
          type="date"
          value={value.to}
          min={value.from || undefined}
          onChange={(event) => onChange({ ...value, to: event.target.value })}
          aria-label="Added to (UK date)"
        />
      </label>
    </>
  );
}
