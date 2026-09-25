/**
 * *.vectors.json → supabase/tests/_shared/*_vectors.psql
 *
 *   pay.vectors.json               → pay_vectors.psql               (§5.1–5.2)
 *   availability.vectors.json      → availability_vectors.psql      (ADR-0036)
 *   emergencyContact.vectors.json  → emergency_contact_vectors.psql (ADR-0037)
 *   changeRequest.vectors.json     → change_request_vectors.psql    (ADR-0038)
 *   shiftOffer.vectors.json        → shift_offer_vectors.psql       (ADR-0039)
 *
 * The vectors are the contract between packages/domain and the Postgres
 * functions, triggers and CHECKs that repeat the same rules (pay.ts and
 * 0005_checkin_checkout.sql; the four staff additions of docs/18 and
 * 20260930100100_staff_additions_schema.sql). Vitest reads the JSON
 * directly; pgTAP cannot, because `supabase test db` runs pg_prove with only
 * supabase/ in reach — so the same cases are generated into a .psql the test
 * includes with \ir. Each domain test compares the committed file with a
 * fresh render, so the JSON stays the single source of truth.
 *
 *   pnpm --filter @thc/domain gen:vectors      write every file
 *   node gen-vectors-sql.mjs --stdout          pay only (pay.vectors.test.ts)
 *   node gen-vectors-sql.mjs --stdout <name>   one file: availability,
 *                                              emergencyContact, changeRequest,
 *                                              shiftOffer
 *   node gen-vectors-sql.mjs --check           fail if any file has drifted
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src');
const SHARED = resolve(here, '../../../supabase/tests/_shared');
export const VECTORS_PATH = resolve(SRC, 'pay.vectors.json');
export const OUT_PATH = resolve(SHARED, 'pay_vectors.psql');

/** Every case carries a complete input: the group's defaults, then its own keys. */
export function merged(group) {
  return group.cases.map((c) => ({ ...c, input: { ...(group.defaults ?? {}), ...c.input } }));
}

const GROUPS = [
  ['vec_check_in', 'checkIn'],
  ['vec_check_out', 'checkOut'],
  ['vec_pay', 'pay'],
  ['vec_turn_away', 'turnAway'],
];

const text = (value) => `'${value.replaceAll("'", "''")}'`;
const json = (value) => `${text(JSON.stringify(value))}::jsonb`;

export function render(vectors) {
  const out = [
    '-- =====================================================================',
    '-- GENERATED FILE — do not edit.',
    '--',
    '-- Source: packages/domain/src/pay.vectors.json',
    '-- Regenerate: pnpm --filter @thc/domain gen:vectors',
    '--',
    '-- The shared §5.1–5.2 vectors as temporary tables, for the pgTAP half of',
    "-- the contract. Group defaults are already merged into each case's input.",
    '-- Included with \\ir from supabase/tests/070_check_in_out.sql; the .psql',
    '-- extension keeps pg_prove from running it as a test of its own.',
    '-- =====================================================================',
    '',
  ];

  for (const [table, key] of GROUPS) {
    const cases = merged(vectors[key]);
    out.push(
      `create temporary table ${table} (name text, input jsonb, expect jsonb) on commit drop;`,
    );
    out.push(`insert into ${table} (name, input, expect) values`);
    out.push(
      cases.map((c) => `  (${text(c.name)}, ${json(c.input)}, ${json(c.expect)})`).join(',\n') +
        ';',
    );
    out.push('');
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------
// The staff additions (docs/18, ADR-0036–0039)
// ---------------------------------------------------------------------

/** A SQL literal for a JSON scalar: null, a boolean, a number or a string. */
const lit = (value) => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return text(String(value));
};

/** `create temporary table … ; insert … values …;` for one list of rows. */
function table(name, columns, rows) {
  const out = [`create temporary table ${name} (`];
  out.push(columns.map(([col, type]) => `  ${col} ${type}`).join(',\n'));
  out.push(') on commit drop;');
  out.push('');
  if (rows.length > 0) {
    out.push(`insert into ${name} values`);
    out.push(rows.map((r) => `  (${r.join(', ')})`).join(',\n') + ';');
  }
  out.push('');
  return out;
}

function header(source, test, what) {
  return [
    '-- =====================================================================',
    '-- GENERATED FILE — do not edit.',
    '--',
    `-- Source: packages/domain/src/${source}`,
    '-- Regenerate: pnpm --filter @thc/domain gen:vectors',
    '--',
    ...what.map((line) => `-- ${line}`),
    `-- Included with \\ir from ${test}; the .psql`,
    '-- extension keeps pg_prove from running it as a test of its own.',
    '-- =====================================================================',
    '',
  ];
}

const statusTables = (prefix, vectors) => [
  ...table(
    `${prefix}_status_vectors`,
    [['status', 'text primary key']],
    vectors.statuses.map((s) => [lit(s)]),
  ),
  ...table(
    `${prefix}_edge_vectors`,
    [
      ['from_status', 'text not null'],
      ['to_status', 'text not null'],
    ],
    vectors.edges.map((e) => [lit(e.from), lit(e.to)]),
  ),
];

export function renderAvailability(v) {
  const range = (i) => [
    lit(i.fromDate),
    lit(i.toDate ?? null),
    lit(i.fromTime ?? null),
    lit(i.toTime ?? null),
  ];
  const out = header('availability.vectors.json', 'supabase/tests/651_staff_additions_state.sql', [
    'ADR-0036: unavailability_range() and staff_unavailable() against the',
    'cases availability.ts is held to. Dates and times are UK wall clock;',
    'lower/upper are the half-open range in UTC. `error` is the refusal the',
    'builder raises instead of a range.',
  ]);
  out.push(
    ...table(
      'availability_range_vectors',
      [
        ['name', 'text primary key'],
        ['from_date', 'date not null'],
        ['to_date', 'date'],
        ['from_time', 'time'],
        ['to_time', 'time'],
        ['lower_at', 'timestamptz'],
        ['upper_at', 'timestamptz'],
        ['hours', 'numeric'],
        ['error', 'text'],
      ],
      v.ranges.map((c) => [
        lit(c.name),
        ...range(c.input),
        lit(c.expect.lower ?? null),
        lit(c.expect.upper ?? null),
        lit(c.expect.hours ?? null),
        lit(c.expect.error ?? null),
      ]),
    ),
  );
  out.push(
    ...table(
      'availability_overlap_vectors',
      [
        ['name', 'text primary key'],
        ['from_date', 'date not null'],
        ['to_date', 'date'],
        ['from_time', 'time'],
        ['to_time', 'time'],
        ['section_starts', 'timestamptz not null'],
        ['section_ends', 'timestamptz not null'],
        ['expect_overlap', 'boolean not null'],
      ],
      v.overlaps.map((c) => [
        lit(c.name),
        ...range(c.entry),
        lit(c.section.startsAt),
        lit(c.section.endsAt),
        lit(c.overlaps),
      ]),
    ),
  );
  out.push(
    ...table(
      'availability_weekly_vectors',
      [
        ['name', 'text not null'],
        ['week', 'int not null'],
        ['from_date', 'date not null'],
        ['to_date', 'date'],
        ['from_time', 'time'],
        ['to_time', 'time'],
        ['lower_at', 'timestamptz not null'],
        ['upper_at', 'timestamptz not null'],
        ['primary key', '(name, week)'],
      ],
      v.weekly.flatMap((c) =>
        c.expect.map((e, week) => [
          lit(c.name),
          String(week),
          ...range(c.input),
          lit(e.lower),
          lit(e.upper),
        ]),
      ),
    ),
  );
  out.push(
    ...table(
      'availability_validation_vectors',
      [
        ['name', 'text primary key'],
        ['now_at', 'timestamptz not null'],
        ['input', 'jsonb not null'],
        ['expect', 'text'],
      ],
      v.validation.map((c) => [lit(c.name), lit(c.now), json(c.input), lit(c.expect)]),
    ),
  );
  out.push(`\\set availability_range_count ${v.ranges.length}`);
  out.push(`\\set availability_overlap_count ${v.overlaps.length}`);
  out.push(`\\set availability_weekly_count ${v.weekly.reduce((n, c) => n + c.expect.length, 0)}`);
  out.push(`\\set availability_validation_count ${v.validation.length}`);
  out.push('');
  return out.join('\n');
}

export function renderEmergencyContact(v) {
  const out = header(
    'emergencyContact.vectors.json',
    'supabase/tests/650_staff_additions_rls.sql',
    [
      'ADR-0037: the staff_emergency_contacts CHECKs against the cases',
      'emergencyContact.ts is held to. `storable`: the raw string passes the',
      'phone CHECK as it is. `normalised`: what the form stores (null = refused).',
    ],
  );
  out.push(
    ...table(
      'emergency_phone_vectors',
      [
        ['name', 'text primary key'],
        ['input', 'text not null'],
        ['storable', 'boolean not null'],
        ['normalised', 'text'],
      ],
      v.phones.map((c) => [lit(c.name), lit(c.input), lit(c.storable), lit(c.normalised)]),
    ),
  );
  out.push(
    ...table(
      'emergency_contact_vectors',
      [
        ['name', 'text primary key'],
        ['contact_name', 'text not null'],
        ['relationship', 'text not null'],
        ['phone', 'text not null'],
        ['stored_phone', 'text'],
        ['valid', 'boolean not null'],
      ],
      v.contacts.map((c) => [
        lit(c.name),
        lit(c.input.name),
        lit(c.input.relationship),
        lit(c.input.phone),
        lit(c.phone),
        lit(c.errors.length === 0),
      ]),
    ),
  );
  out.push(`\\set emergency_phone_count ${v.phones.length}`);
  out.push(`\\set emergency_contact_count ${v.contacts.length}`);
  out.push('');
  return out.join('\n');
}

export function renderChangeRequest(v) {
  const out = header('changeRequest.vectors.json', 'supabase/tests/651_staff_additions_state.sql', [
    'ADR-0038: profile_change_transitions(), the state guard and the',
    'profile_change_requests CHECKs against the cases state.ts and',
    'changeRequest.ts are held to. `refusal` null = the name is accepted.',
  ]);
  out.push(...statusTables('change_request', v));
  out.push(
    ...table(
      'change_request_name_vectors',
      [
        ['name', 'text primary key'],
        ['first_name', 'text not null'],
        ['last_name', 'text not null'],
        ['refusal', 'text'],
      ],
      v.names.map((c) => [
        lit(c.name),
        lit(c.input.first),
        lit(c.input.last),
        lit(c.expect.refusal ?? null),
      ]),
    ),
  );
  out.push(
    ...table(
      'change_request_decision_vectors',
      [
        ['name', 'text primary key'],
        ['approve', 'boolean not null'],
        ['reason', 'text'],
        ['refusal', 'text'],
      ],
      v.decisions.map((c) => [lit(c.name), lit(c.approve), lit(c.reason), lit(c.expect)]),
    ),
  );
  out.push(`\\set change_request_status_count ${v.statuses.length}`);
  out.push(`\\set change_request_edge_count ${v.edges.length}`);
  out.push('');
  return out.join('\n');
}

export function renderShiftOffer(v) {
  const out = header('shiftOffer.vectors.json', 'supabase/tests/651_staff_additions_state.sql', [
    'ADR-0039: shift_offer_transitions(), shift_offer_mode_transitions() and',
    'the state guard against the cases state.ts and shiftOffer.ts are held',
    'to; take and visibility cases (defaults merged) for take_offered_shift()',
    "and the Radar read in Agent A's 20260930110100.",
  ]);
  out.push(...statusTables('shift_offer', v));
  out.push(
    ...table(
      'shift_offer_mode_vectors',
      [['mode', 'text primary key']],
      v.modes.map((m) => [lit(m)]),
    ),
  );
  out.push(
    ...table(
      'shift_offer_mode_edge_vectors',
      [
        ['from_mode', 'text not null'],
        ['to_mode', 'text not null'],
      ],
      v.modeEdges.map((e) => [lit(e.from), lit(e.to)]),
    ),
  );
  out.push(
    ...table(
      'shift_offer_can_offer_vectors',
      [
        ['name', 'text primary key'],
        ['starts_at', 'timestamptz not null'],
        ['now_at', 'timestamptz not null'],
        ['expect', 'boolean not null'],
      ],
      v.canOffer.map((c) => [lit(c.name), lit(c.startsAt), lit(c.now), lit(c.expect)]),
    ),
  );
  out.push(
    ...table(
      'shift_offer_expires_vectors',
      [
        ['name', 'text primary key'],
        ['starts_at', 'timestamptz not null'],
        ['opened_by_office', 'boolean not null'],
        ['expect', 'timestamptz not null'],
      ],
      v.expires.map((c) => [lit(c.name), lit(c.startsAt), lit(c.openedByOffice), lit(c.expect)]),
    ),
  );
  for (const [name, key] of [
    ['shift_offer_take_vectors', 'take'],
    ['shift_offer_visibility_vectors', 'visibility'],
  ]) {
    out.push(
      ...table(
        name,
        [
          ['name', 'text primary key'],
          ['input', 'jsonb not null'],
          ['expect', 'jsonb not null'],
        ],
        merged(v[key]).map((c) => [lit(c.name), json(c.input), json(c.expect)]),
      ),
    );
  }
  out.push(`\\set shift_offer_status_count ${v.statuses.length}`);
  out.push(`\\set shift_offer_edge_count ${v.edges.length}`);
  out.push(`\\set shift_offer_mode_edge_count ${v.modeEdges.length}`);
  out.push('');
  return out.join('\n');
}

/** Every generated file: source JSON, output .psql, renderer. */
export const TARGETS = {
  pay: { json: VECTORS_PATH, out: OUT_PATH, render },
  availability: {
    json: resolve(SRC, 'availability.vectors.json'),
    out: resolve(SHARED, 'availability_vectors.psql'),
    render: renderAvailability,
  },
  emergencyContact: {
    json: resolve(SRC, 'emergencyContact.vectors.json'),
    out: resolve(SHARED, 'emergency_contact_vectors.psql'),
    render: renderEmergencyContact,
  },
  changeRequest: {
    json: resolve(SRC, 'changeRequest.vectors.json'),
    out: resolve(SHARED, 'change_request_vectors.psql'),
    render: renderChangeRequest,
  },
  shiftOffer: {
    json: resolve(SRC, 'shiftOffer.vectors.json'),
    out: resolve(SHARED, 'shift_offer_vectors.psql'),
    render: renderShiftOffer,
  },
};

export function generateTarget(name) {
  const target = TARGETS[name];
  if (!target) throw new Error(`unknown vectors target: ${name}`);
  return target.render(JSON.parse(readFileSync(target.json, 'utf8')));
}

export function generate() {
  return generateTarget('pay');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--stdout') {
    // --stdout alone is how pay.vectors.test.ts checks the committed file.
    process.stdout.write(generateTarget(args[1] ?? 'pay'));
  } else if (args[0] === '--check') {
    const stale = Object.entries(TARGETS).filter(
      ([name, t]) => readFileSync(t.out, 'utf8') !== generateTarget(name),
    );
    for (const [name, t] of stale) console.error(`${t.out} is out of date (${name})`);
    if (stale.length > 0) process.exit(1);
    process.stdout.write(
      `all ${Object.keys(TARGETS).length} generated vector files are up to date\n`,
    );
  } else {
    for (const [name, t] of Object.entries(TARGETS)) {
      writeFileSync(t.out, generateTarget(name));
      process.stdout.write(`wrote ${t.out}\n`);
    }
  }
}
