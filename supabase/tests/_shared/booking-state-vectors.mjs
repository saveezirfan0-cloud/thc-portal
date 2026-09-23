/**
 * Generates supabase/tests/_shared/booking_state_vectors.psql from the single
 * source of truth, packages/domain/src/bookingState.vectors.json (Scope §3.6
 * booking state machine + the cancel_cause vocabulary, docs/14 §4 B2/B3).
 *
 * Same shape as rota-guard-vectors.mjs: pgTAP cannot read JSON, so the edges
 * and causes are rendered into temp tables that
 * supabase/tests/490_booking_state_machine.sql loads with \ir, and the Vitest
 * suite in packages/domain re-renders and compares so the generated file
 * cannot drift from the JSON.
 *
 *   node supabase/tests/_shared/booking-state-vectors.mjs          # rewrite
 *   node supabase/tests/_shared/booking-state-vectors.mjs --check  # verify
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const BOOKING_VECTORS_JSON = resolve(
  here,
  '../../../packages/domain/src/bookingState.vectors.json',
);
export const BOOKING_VECTORS_PSQL = resolve(here, 'booking_state_vectors.psql');

const sqlText = (v) =>
  v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`;

/** The .psql file body for a parsed bookingState.vectors.json. Pure — no I/O. */
export function renderBookingStateVectors(vectors) {
  const statuses = vectors.statuses.map((s) => `  (${sqlText(s)})`);
  const edges = vectors.edges.map((e) => `  (${sqlText(e.from)}, ${sqlText(e.to)})`);
  const causes = vectors.cancelCauses.map((c) => `  (${sqlText(c.cause)}, ${sqlText(c.status)})`);
  const legacy = Object.entries(vectors.legacyCauses).map(
    ([from, to]) => `  (${sqlText(from)}, ${sqlText(to)})`,
  );

  return `-- =====================================================================
-- GENERATED FILE — DO NOT EDIT.
--
-- Source:    packages/domain/src/bookingState.vectors.json
-- Generator: node supabase/tests/_shared/booking-state-vectors.mjs
--
-- The §3.6 booking machine and the cancel_cause vocabulary as tables pgTAP
-- can join against. The Vitest suite in packages/domain fails if this file
-- has drifted from the JSON, so BOOKING_TRANSITIONS / CANCEL_CAUSES and
-- booking_transitions() / bookings_cancel_cause_check are held to the same
-- cases.
-- =====================================================================

create temporary table booking_status_vectors (
  status text primary key
) on commit drop;

insert into booking_status_vectors values
${statuses.join(',\n')};

create temporary table booking_edge_vectors (
  from_status text not null,
  to_status   text not null,
  primary key (from_status, to_status)
) on commit drop;

insert into booking_edge_vectors values
${edges.join(',\n')};

create temporary table cancel_cause_vectors (
  cause  text primary key,
  status text not null
) on commit drop;

insert into cancel_cause_vectors values
${causes.join(',\n')};

create temporary table legacy_cause_vectors (
  legacy text primary key,
  cause  text not null
) on commit drop;

insert into legacy_cause_vectors values
${legacy.join(',\n')};

\\set booking_status_count ${vectors.statuses.length}
\\set booking_edge_count ${vectors.edges.length}
\\set cancel_cause_count ${vectors.cancelCauses.length}
`;
}

export function readBookingVectors() {
  return JSON.parse(readFileSync(BOOKING_VECTORS_JSON, 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rendered = renderBookingStateVectors(readBookingVectors());
  if (process.argv.includes('--check')) {
    if (readFileSync(BOOKING_VECTORS_PSQL, 'utf8') !== rendered) {
      console.error(
        'booking_state_vectors.psql is out of date — run: node supabase/tests/_shared/booking-state-vectors.mjs',
      );
      process.exit(1);
    }
    console.log('booking_state_vectors.psql is up to date');
  } else {
    writeFileSync(BOOKING_VECTORS_PSQL, rendered);
    console.log(`wrote ${BOOKING_VECTORS_PSQL}`);
  }
}
