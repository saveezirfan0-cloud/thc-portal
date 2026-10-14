'use client';

import { Select, UkDateField } from '@thc/ui';
import {
  ADDED_BY_ANYONE,
  ADDED_BY_NOBODY,
  addedByOptions,
  type Added,
  type AddedFilter,
} from '../_lib/addedBy';
import './added-filters.css';

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
        style={{ width: 170 }}
      >
        <option value={ADDED_BY_ANYONE}>Added by: anyone</option>
        {managers.map((manager) => (
          <option key={manager.value} value={manager.value}>
            {manager.label}
          </option>
        ))}
        {hasNobody ? <option value={ADDED_BY_NOBODY}>Not recorded</option> : null}
      </Select>
      {/* Typed dd/mm/yyyy whatever the device's locale (ADR-0140): a native
          date input showed mm/dd/yyyy on a US-English browser. */}
      <span className="row sm muted added-date">
        <span aria-hidden="true">Added from</span>
        <UkDateField
          label="Added from (UK date)"
          labelHidden
          value={value.from}
          max={value.to || undefined}
          onChange={(from) => onChange({ ...value, from })}
        />
      </span>
      <span className="row sm muted added-date">
        <span aria-hidden="true">to</span>
        <UkDateField
          label="Added to (UK date)"
          labelHidden
          value={value.to}
          min={value.from || undefined}
          onChange={(to) => onChange({ ...value, to })}
        />
      </span>
    </>
  );
}
