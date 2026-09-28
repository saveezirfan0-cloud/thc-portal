import { deflateSync } from 'node:zlib';
import { formatShareCode } from '@thc/domain';
import { envText, ukToday } from './checker';
import type { EnvReader } from './checker';

/**
 * The SANDBOX right-to-work provider (ADR-0063): a stand-in for a real
 * provider's HTTP API, for demos and UAT, where no real share code exists.
 *
 * It is not an adapter. It is a `fetch` that answers the provider adapter's
 * request in the shape `provider.config.ts` reads, so a demo runs the real
 * path end to end: the provider adapter, the orchestrator, `decideRtwCheck`,
 * the report and photo upload, `rtw_check_record()` and the office's
 * Verify / Reject (ADR-0041).
 *
 * Switched on only by `RTW_PROVIDER_URL=sandbox:` (with
 * `settings.rtw_check.primary = 'provider'`). It answers ONLY the fixed demo
 * share codes below. Any other code gets a 404 without an outcome, which the
 * adapter reads as an error: a real worker's code is never given a made-up
 * answer, and goes to the gov.uk fallback if one is on. Every report it
 * makes says SANDBOX across the top, and every reference starts SANDBOX-.
 *
 * Like the Home Office, it answers only for the code together with the
 * right date of birth: `lookupHolder` finds the worker who filed that code
 * with that date of birth, and the record carries their name. A code filed
 * with a different date of birth is "not found", as on gov.uk.
 */

export const SANDBOX_URL_PREFIX = 'sandbox:';

export function isSandboxProviderUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.trim().toLowerCase().startsWith(SANDBOX_URL_PREFIX);
}

/** Whether the route should hand the provider adapter the sandbox. */
export function rtwSandboxEnabled(env: EnvReader): boolean {
  return isSandboxProviderUrl(envText(env, 'RTW_PROVIDER_URL'));
}

/**
 * The environment the provider adapter sees in sandbox mode: the key is not
 * checked by the sandbox, so an unset one defaults rather than switching the
 * provider off.
 */
export function sandboxEnv(env: EnvReader): EnvReader {
  return (name) =>
    name === 'RTW_PROVIDER_API_KEY' ? (envText(env, name) ?? 'sandbox') : env(name);
}

// ---------------------------------------------------------------------
// The demo share codes. Each is a valid code (W + 8 letters and digits),
// so the Staff App accepts it as typed.
// ---------------------------------------------------------------------

export type SandboxOutcome =
  | 'right_to_work'
  | 'settled'
  | 'student'
  | 'name_mismatch'
  | 'condition'
  | 'not_found'
  | 'no_right_to_work'
  | 'unavailable';

export interface SandboxPersona {
  code: string;
  outcome: SandboxOutcome;
  /** What the office will see, for the demo script. */
  shows: string;
  /** The Staff App right-to-work branches this code fits. */
  branches: string;
}

export const SANDBOX_PERSONAS: readonly SandboxPersona[] = [
  {
    code: 'WDEMOPASS',
    outcome: 'right_to_work',
    shows: 'Recommend verify: right to work for two years, any job',
    branches: 'Work visa, Dependant / other, EU pre-settled',
  },
  {
    code: 'WDEMOSETL',
    outcome: 'settled',
    shows: 'Recommend verify: settled status, no time limit',
    branches: 'EU settled',
  },
  {
    code: 'WDEMOSTDY',
    outcome: 'student',
    shows: 'Recommend verify: Student visa, 20 hours a week in term time',
    branches: 'International student (degree level)',
  },
  {
    code: 'WDEMONAME',
    outcome: 'name_mismatch',
    shows: 'Needs review: the name on the record is not the name on the profile',
    branches: 'any share-code branch',
  },
  {
    code: 'WDEMOCOND',
    outcome: 'condition',
    shows: 'Needs review: a work condition the system cannot apply',
    branches: 'Work visa',
  },
  {
    code: 'WDEMONONE',
    outcome: 'not_found',
    shows: 'Recommend reject: share code not recognised with this date of birth',
    branches: 'any share-code branch',
  },
  {
    code: 'WDEMONORW',
    outcome: 'no_right_to_work',
    shows: 'Recommend reject: no right to work in the UK',
    branches: 'any share-code branch',
  },
  {
    code: 'WDEMODOWN',
    outcome: 'unavailable',
    shows: 'Provider unavailable: the check retries (30 min, 2 h, 6 h, 16 h), then Needs review',
    branches: 'any share-code branch',
  },
];

export function sandboxPersona(code: string): SandboxPersona | null {
  const normal = code.replace(/\s+/g, '').toUpperCase();
  return SANDBOX_PERSONAS.find((p) => p.code === normal) ?? null;
}

// ---------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------

export interface SandboxDeps {
  /**
   * The name of the worker who filed this share code with this date of
   * birth, or null. The sandbox's stand-in for the Home Office record.
   */
  lookupHolder(shareCode: string, dateOfBirth: string): Promise<string | null>;
  now?: () => Date;
}

/** YYYY-MM-DD plus whole years; 29 February lands on 28 February. */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y + years, m - 1, d));
  if (date.getUTCMonth() !== m - 1) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

const MISMATCHED_NAME = 'Jordan Ellis-Whitfield';

interface SandboxRecord {
  status: 'right_to_work' | 'no_right_to_work';
  full_name: string;
  right_to_work_until?: string;
  permission_type?: string;
  conditions: string[];
  term_time_hours?: number;
  summary: string;
}

function recordFor(outcome: SandboxOutcome, holder: string, today: string): SandboxRecord | null {
  switch (outcome) {
    case 'right_to_work':
      return {
        status: 'right_to_work',
        full_name: holder,
        right_to_work_until: addYears(today, 2),
        conditions: ['They can work in any job'],
        summary: 'This person can work in the UK until the date shown.',
      };
    case 'settled':
      return {
        status: 'right_to_work',
        full_name: holder,
        permission_type: 'settled',
        conditions: ['They can work in the UK with no time limit'],
        summary: 'This person has settled status and can work in the UK with no time limit.',
      };
    case 'student':
      return {
        status: 'right_to_work',
        full_name: holder,
        right_to_work_until: addYears(today, 1),
        conditions: [
          'They can work up to 20 hours a week during term time',
          'They can work full-time during vacations',
        ],
        term_time_hours: 20,
        summary: 'This person has a Student visa and can work with the conditions shown.',
      };
    case 'name_mismatch':
      return {
        status: 'right_to_work',
        full_name: MISMATCHED_NAME,
        right_to_work_until: addYears(today, 2),
        conditions: ['They can work in any job'],
        summary: 'This person can work in the UK until the date shown.',
      };
    case 'condition':
      return {
        status: 'right_to_work',
        full_name: holder,
        right_to_work_until: addYears(today, 2),
        conditions: ['They can only work for the sponsor named on their visa'],
        summary: 'This person can work in the UK with the conditions shown.',
      };
    case 'no_right_to_work':
      return {
        status: 'no_right_to_work',
        full_name: holder,
        conditions: ['They do not have permission to work in the UK'],
        summary: 'This person does not have the right to work in the UK.',
      };
    default:
      return null;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * The sandbox as a `fetch`: hand it to `createProviderChecker(env, fetch)`.
 * It answers the check POST only; any other URL or method is a 404.
 */
export function createSandboxProviderFetch(deps: SandboxDeps): typeof fetch {
  const now = deps.now ?? (() => new Date());

  const sandboxFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isSandboxProviderUrl(url) || (init?.method ?? 'GET').toUpperCase() !== 'POST') {
      return json(404, { error: 'sandbox_no_such_endpoint' });
    }
    const headers = new Headers(init?.headers);
    const hasAuth = [...headers.values()].some((v) => v.trim() !== '');
    if (!hasAuth) return json(401, { error: 'sandbox_unauthorised' });

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(String(init?.body ?? '')) as Record<string, unknown>;
    } catch {
      return json(400, { error: 'sandbox_bad_request' });
    }
    const shareCode = typeof body['share_code'] === 'string' ? body['share_code'] : '';
    const dateOfBirth = typeof body['date_of_birth'] === 'string' ? body['date_of_birth'] : '';
    const companyName =
      typeof body['company_name'] === 'string' ? body['company_name'] : 'The employer';

    const persona = sandboxPersona(shareCode);
    // Not a demo code: never an answer about a real person.
    if (!persona) return json(404, { error: 'sandbox_unknown_code' });
    if (persona.outcome === 'unavailable') {
      return json(503, { status: 'unavailable' });
    }

    const checkedAt = now();
    const today = ukToday(checkedAt);
    // Without its W: rtw_check_clean_result() refuses a result whose
    // letters and digits contain the share code anywhere.
    const reference = `SANDBOX-${persona.code.slice(1)}-${checkedAt
      .toISOString()
      .slice(0, 16)
      .replace(/[-:]/g, '')}`;

    const holder =
      persona.outcome === 'not_found' ? null : await deps.lookupHolder(persona.code, dateOfBirth);
    const record = holder ? recordFor(persona.outcome, holder, today) : null;
    if (!record) {
      return json(200, { status: 'not_found', reference_number: reference });
    }

    const report = sandboxReportPdf({
      reference,
      checkedAt,
      companyName,
      shareCode: formatShareCode(persona.code),
      record,
    });
    return json(200, {
      ...record,
      reference_number: reference,
      report_pdf_base64: Buffer.from(report).toString('base64'),
      photo_png_base64: Buffer.from(sandboxPhotoPng()).toString('base64'),
    });
  };
  return sandboxFetch as typeof fetch;
}

// ---------------------------------------------------------------------
// The report: a one-page PDF, written by hand (no dependency), watermarked.
// ---------------------------------------------------------------------

/** Standard-font PDF text: ASCII only, with ( ) \ escaped. */
function pdfText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[‐-―]/g, '-')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/([()\\])/g, '\\$1');
}

function ukDateLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function sandboxReportPdf(input: {
  reference: string;
  checkedAt: Date;
  companyName: string;
  shareCode: string;
  record: SandboxRecord;
}): Uint8Array {
  const { record } = input;
  const checked = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  }).format(input.checkedAt);

  const ops: string[] = [];
  // The watermark band: amber, full width, across the top.
  ops.push('0.98 0.75 0.18 rg 0 782 595 60 re f');
  const line = (font: 'F1' | 'F2', size: number, x: number, y: number, text: string) =>
    ops.push(`BT /${font} ${size} Tf 0 0 0 rg ${x} ${y} Td (${pdfText(text)}) Tj ET`);

  line('F2', 16, 40, 815, 'SANDBOX - NOT A HOME OFFICE RESULT');
  line(
    'F1',
    9,
    40,
    797,
    "Made by the THC platform's sandbox provider for a demo. Never evidence of a right to work.",
  );

  let y = 745;
  line('F2', 20, 40, y, 'Right to work check');
  y -= 30;
  line('F1', 11, 40, y, record.summary);
  y -= 34;

  const rows: [string, string][] = [
    ['Name', record.full_name],
    [
      'Right to work until',
      record.right_to_work_until
        ? ukDateLong(record.right_to_work_until)
        : record.status === 'right_to_work'
          ? 'No time limit'
          : '-',
    ],
    ['Share code', input.shareCode],
    ['Checked by', input.companyName],
    ['Checked on', `${checked} (UK time)`],
    ['Reference', input.reference],
  ];
  for (const [k, v] of rows) {
    line('F2', 11, 40, y, k);
    line('F1', 11, 200, y, v);
    y -= 22;
  }
  y -= 14;
  line('F2', 12, 40, y, 'Conditions');
  y -= 20;
  for (const c of record.conditions) {
    line('F1', 11, 52, y, `- ${c}`);
    y -= 18;
  }

  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character is ASCII (pdfText), so length in characters = in bytes.
  return new TextEncoder().encode(pdf);
}

// ---------------------------------------------------------------------
// The photo: a placeholder silhouette with an amber SANDBOX band, so no
// one mistakes it for a real person's photo.
// ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typed = new TextEncoder().encode(type);
  out.set(typed, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

let cachedPhoto: Uint8Array | null = null;

export function sandboxPhotoPng(): Uint8Array {
  if (cachedPhoto) return cachedPhoto;
  const width = 180;
  const height = 225;
  const raw = new Uint8Array(height * (1 + width * 3));
  const background = [226, 231, 238];
  const figure = [148, 160, 176];
  const band = [250, 191, 46];
  const stripe = [30, 30, 30];
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      let colour = background;
      const head = (x - 90) ** 2 + (y - 88) ** 2 <= 38 ** 2;
      const body = y >= 140 && ((x - 90) / 78) ** 2 + ((y - 230) / 88) ** 2 <= 1;
      if (head || body) colour = figure;
      // Amber band with dark diagonal stripes along the bottom.
      if (y >= height - 30) colour = (x + y) % 16 < 5 ? stripe : band;
      raw.set(colour, row + 1 + x * 3);
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  cachedPhoto = png;
  return png;
}
