/**
 * ASSUMED — confirm against the live service (ADR-0025).
 *
 * THC has not yet chosen a right-to-work provider, and no provider's API
 * documentation was reachable when this was written. Everything this
 * adapter assumes about that API is in THIS FILE and nowhere else: the
 * request it sends, how it authenticates, and how it reads the answer. The
 * URL and the auth header are environment variables, so a provider whose
 * API matches the shape below needs no release; one that differs needs
 * this file changed, and the synthetic fixtures in __tests__ updated to a
 * real sandbox response.
 *
 *   RTW_PROVIDER_URL          the check endpoint, POSTed to (required)
 *   RTW_PROVIDER_API_KEY      the key (required)
 *   RTW_PROVIDER_AUTH_HEADER  header carrying it   (default `Authorization`)
 *   RTW_PROVIDER_AUTH_PREFIX  prefix before it     (default `Bearer `)
 *   RTW_PROVIDER_TIMEOUT_MS   per request          (default 30000)
 *
 * Without the URL and key the provider is simply unavailable and the
 * orchestrator goes to the gov.uk fallback (or, with neither, claims
 * nothing).
 */
import { rtwCheckError, safeErrorCode, termTimeLimitFrom } from '@thc/domain';
import type { RtwCheckOutcome, RtwCheckResult } from '@thc/domain';
import { envNumber, envText, parseUkDate } from './checker';
import type { CheckInput, EnvReader } from './checker';

export interface ProviderConfig {
  url: string | null;
  apiKey: string | null;
  authHeader: string;
  authPrefix: string;
  timeoutMs: number;
}

export function providerConfig(env: EnvReader): ProviderConfig {
  const prefix = env('RTW_PROVIDER_AUTH_PREFIX');
  return {
    url: envText(env, 'RTW_PROVIDER_URL'),
    apiKey: envText(env, 'RTW_PROVIDER_API_KEY'),
    authHeader: envText(env, 'RTW_PROVIDER_AUTH_HEADER') ?? 'Authorization',
    // An empty prefix is a legitimate choice (a bare `x-api-key`), so only
    // an UNSET variable falls back to `Bearer `.
    authPrefix: prefix === undefined ? 'Bearer ' : prefix,
    timeoutMs: envNumber(env, 'RTW_PROVIDER_TIMEOUT_MS', 30_000),
  };
}

export function providerAvailable(config: ProviderConfig): boolean {
  return Boolean(config.url && config.apiKey);
}

export function authHeaders(config: ProviderConfig): Record<string, string> {
  return { [config.authHeader]: `${config.authPrefix}${config.apiKey ?? ''}` };
}

/**
 * ASSUMED request: JSON, snake_case, the three things gov.uk itself asks an
 * employer for, plus a request for the PDF.
 */
export function providerRequestBody(input: CheckInput): Record<string, unknown> {
  return {
    share_code: input.shareCode,
    date_of_birth: input.dateOfBirth,
    company_name: input.companyName,
    include_report: true,
  };
}

// ---------------------------------------------------------------------
// ASSUMED response. A tolerant reader: each field is looked for in the
// handful of places a JSON API usually puts it.
// ---------------------------------------------------------------------

/** Status words, lower-cased with spaces and hyphens as underscores. */
export const PROVIDER_OUTCOMES: Readonly<Record<RtwCheckOutcome, readonly string[]>> = {
  right_to_work: [
    'right_to_work',
    'has_right_to_work',
    'valid',
    'pass',
    'passed',
    'eligible',
    'allowed',
    'permitted',
  ],
  no_right_to_work: [
    'no_right_to_work',
    'invalid',
    'fail',
    'failed',
    'not_eligible',
    'ineligible',
    'refused',
    'denied',
    'not_permitted',
  ],
  not_found: [
    'not_found',
    'no_match',
    'unmatched',
    'no_record',
    'record_not_found',
    'share_code_not_found',
    'details_do_not_match',
    'expired_share_code',
  ],
  error: ['error', 'pending', 'unavailable'],
};

const OUTCOME_PATHS = [
  'outcome',
  'result.outcome',
  'result',
  'status',
  'data.outcome',
  'data.status',
  'check.status',
] as const;

/** A permission type meaning "no time limit" — only ever an explicit statement. */
export const PROVIDER_NO_TIME_LIMIT = [
  'indefinite',
  'no_time_limit',
  'permanent',
  'settled',
  'unlimited',
] as const;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
const word = (v: unknown): string | null =>
  text(v)
    ?.toLowerCase()
    .replace(/[\s-]+/g, '_') ?? null;

function pick(body: Json, paths: readonly string[]): unknown {
  for (const path of paths) {
    let value: unknown = body;
    for (const key of path.split('.')) value = obj(value)[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function outcomeOf(value: unknown): RtwCheckOutcome | null {
  const w = word(value);
  if (!w) return null;
  for (const [outcome, words] of Object.entries(PROVIDER_OUTCOMES) as [
    RtwCheckOutcome,
    readonly string[],
  ][]) {
    if (words.includes(w)) return outcome;
  }
  return null;
}

function conditionsOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((c) => (typeof c === 'string' ? c : text(obj(c)['description'] ?? obj(c)['text'])))
      .filter((c): c is string => !!c && c.trim() !== '')
      .map((c) => c.trim());
  }
  const single = text(value);
  return single
    ? single
        .split(/\n+/)
        .map((c) => c.trim())
        .filter(Boolean)
    : [];
}

export interface ProviderMapped {
  result: RtwCheckResult;
  /** Base64 PDF in the body, if the provider inlines it. */
  reportBase64: string | null;
  /** Or a URL to fetch it from, with the same credentials. */
  reportUrl: string | null;
}

/**
 * The provider's HTTP answer as a normalised result. `status` is the HTTP
 * status; `body` the parsed JSON (or null if it was not JSON).
 */
export function mapProviderResponse(
  status: number,
  body: unknown,
  checkedAt: string,
): ProviderMapped {
  const none = { reportBase64: null, reportUrl: null };
  const b = obj(body);

  // The first of these places that holds a word we recognise: a body may
  // carry an unrelated `status` ("complete") beside the real outcome.
  const outcome =
    OUTCOME_PATHS.map((path) => outcomeOf(pick(b, [path]))).find((o) => o !== null) ?? null;

  if (status === 401 || status === 403) {
    return { result: rtwCheckError('provider', `provider_http_${status}`, checkedAt), ...none };
  }
  // A 404 / 422 is only "not found" if the body says so; otherwise it is an
  // endpoint or request problem and the gov.uk fallback should run.
  if ((status === 404 || status === 422) && outcome === 'not_found') {
    return { result: notFound(checkedAt), ...none };
  }
  if (status < 200 || status >= 300) {
    return { result: rtwCheckError('provider', `provider_http_${status}`, checkedAt), ...none };
  }
  if (!outcome) {
    return { result: rtwCheckError('provider', 'provider_unknown_status', checkedAt), ...none };
  }
  if (outcome === 'error') {
    return { result: rtwCheckError('provider', 'provider_reported_error', checkedAt), ...none };
  }
  if (outcome === 'not_found') return { result: notFound(checkedAt), ...none };

  const first = text(
    pick(b, ['first_name', 'person.first_name', 'data.first_name', 'given_names']),
  );
  const last = text(
    pick(b, ['last_name', 'person.last_name', 'data.last_name', 'family_name', 'surname']),
  );
  const fullName =
    text(
      pick(b, [
        'full_name',
        'name',
        'person.full_name',
        'person.name',
        'data.full_name',
        'data.name',
      ]),
    ) ??
    ([first, last].filter(Boolean).join(' ') || null);

  const conditions = conditionsOf(
    pick(b, [
      'conditions',
      'work_conditions',
      'restrictions',
      'work_restrictions',
      'data.conditions',
    ]),
  );
  const hours = Number(pick(b, ['term_time_hours', 'max_term_time_hours', 'data.term_time_hours']));
  const termTimeLimitHours =
    Number.isFinite(hours) && hours > 0 ? hours : termTimeLimitFrom(conditions);

  const rawUntil = pick(b, [
    'right_to_work_until',
    'expiry_date',
    'valid_until',
    'permission_expiry_date',
    'data.right_to_work_until',
    'data.expiry_date',
  ]);
  const until = parseUkDate(rawUntil);
  const permission = word(pick(b, ['permission_type', 'leave_type', 'data.permission_type']));
  const explicitNoLimit =
    pick(b, ['no_time_limit', 'data.no_time_limit']) === true ||
    (permission !== null && (PROVIDER_NO_TIME_LIMIT as readonly string[]).includes(permission));

  if (outcome === 'right_to_work') {
    if (rawUntil !== undefined && until === null) {
      return { result: rtwCheckError('provider', 'provider_unreadable_date', checkedAt), ...none };
    }
    // ADR-0018: "no time limit" is never inferred from a missing date. A pass
    // with neither a date nor an explicit statement is incomplete — which
    // sends it to the gov.uk fallback rather than through.
    if (until === null && !explicitNoLimit) {
      return { result: rtwCheckError('provider', 'provider_no_expiry', checkedAt), ...none };
    }
  }

  const report = obj(pick(b, ['report']));
  return {
    result: {
      outcome,
      fullName,
      rightToWorkUntil: outcome === 'right_to_work' ? until : null,
      conditions,
      termTimeLimitHours,
      referenceNumber: text(
        pick(b, ['reference_number', 'reference', 'gov_reference', 'check_reference', 'id']),
      ),
      checkedAt,
      source: 'provider',
    },
    reportBase64:
      text(pick(b, ['report_pdf_base64', 'pdf_base64', 'report.pdf_base64'])) ??
      text(report['base64']),
    reportUrl: text(pick(b, ['report_url', 'pdf_url', 'report.url'])),
  };
}

function notFound(checkedAt: string): RtwCheckResult {
  return {
    outcome: 'not_found',
    fullName: null,
    rightToWorkUntil: null,
    conditions: [],
    termTimeLimitHours: null,
    referenceNumber: null,
    checkedAt,
    source: 'provider',
  };
}

/** A thrown fetch as an error code: `timeout` or `network`, never the message. */
export function providerFailureCode(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return 'provider_timeout';
  return safeErrorCode(`provider_network_${name || 'error'}`);
}
