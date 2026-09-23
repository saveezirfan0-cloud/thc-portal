/**
 * Willo (willo.video) — the pure half of the integration. §2.4, Appendix B
 * (B1), ADR-0021.
 *
 * Everything here is a function of its arguments: the signature check, the
 * mapping of a webhook body onto a key of `settings.willo_stage_map`, the
 * "create candidate" request and the reading of its answer. The Edge
 * Function `supabase/functions/willo-webhook` does the I/O around it and
 * runs on Deno, so this file imports nothing and reads no environment
 * (ADR-0006); `crypto.subtle` is the Web Crypto both runtimes share.
 *
 * WHAT IS ASSUMED ABOUT WILLO. THC's Willo account and API documentation
 * were not available when this was built (Appendix B, B1). Willo's exact
 * webhook signing scheme, payload shape and "create candidate" endpoint
 * are therefore NOT known here, and every place that depends on them is
 * either configuration or a tolerant reader:
 *
 *   - signature: HMAC-SHA256 over the raw body with WILLO_WEBHOOK_SECRET,
 *     hex or base64, optionally `sha256=`-prefixed, in a header named by
 *     WILLO_SIGNATURE_HEADER (default `x-willo-signature`). If
 *     WILLO_TIMESTAMP_HEADER is set, that header is required, must be
 *     within WILLO_TIMESTAMP_TOLERANCE_SECONDS (default 300) of now, and
 *     the signed message becomes `{timestamp}.{raw body}`.
 *   - payload: the event type, candidate key, stage and time are read from
 *     the handful of places a webhook body usually carries them. A stage
 *     change becomes the stage's name ("Accepted" → `accepted`); any other
 *     event becomes its own name ("New Response" → `new_response`). Which
 *     of those keys move a card is `settings.willo_stage_map`, editable on
 *     /settings (§2.4), so a surprise in Willo's naming is a settings
 *     change, not a release.
 *   - create candidate: POST {WILLO_API_BASE}{WILLO_INVITE_PATH} with the
 *     API key in WILLO_API_AUTH_HEADER / WILLO_API_AUTH_PREFIX.
 *
 * The first real delivery from THC's account settles all of it; ADR-0021
 * lists what to check.
 */

// ---------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------

export type EnvReader = (name: string) => string | undefined;

export interface WilloSignatureConfig {
  secret: string | null;
  signatureHeader: string;
  timestampHeader: string | null;
  toleranceSeconds: number;
}

export const DEFAULT_SIGNATURE_HEADER = 'x-willo-signature';
export const DEFAULT_TOLERANCE_SECONDS = 300;

function envText(env: EnvReader, name: string): string | null {
  const value = env(name)?.trim();
  return value ? value : null;
}

export function willoSignatureConfig(env: EnvReader): WilloSignatureConfig {
  const tolerance = Number(envText(env, 'WILLO_TIMESTAMP_TOLERANCE_SECONDS'));
  return {
    secret: envText(env, 'WILLO_WEBHOOK_SECRET'),
    signatureHeader: (
      envText(env, 'WILLO_SIGNATURE_HEADER') ?? DEFAULT_SIGNATURE_HEADER
    ).toLowerCase(),
    timestampHeader: envText(env, 'WILLO_TIMESTAMP_HEADER')?.toLowerCase() ?? null,
    toleranceSeconds:
      Number.isFinite(tolerance) && tolerance > 0 ? tolerance : DEFAULT_TOLERANCE_SECONDS,
  };
}

// ---------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------

export type SignatureFailure =
  | 'secret_missing'
  | 'signature_missing'
  | 'signature_malformed'
  | 'signature_mismatch'
  | 'timestamp_missing'
  | 'timestamp_malformed'
  | 'timestamp_out_of_window';

export type SignatureVerdict = { ok: true } | { ok: false; reason: SignatureFailure };

export interface HeaderReader {
  get(name: string): string | null;
}

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64ToBytes(text: string): Uint8Array | null {
  const normal = text.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normal)) return null;
  try {
    const binary = atob(normal.padEnd(Math.ceil(normal.length / 4) * 4, '='));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * The digests a signature header offers. Several, comma- or
 * space-separated, are allowed so a secret can be rotated without a
 * window of refused deliveries; each may carry a `sha256=` or `v1=` label.
 * A 32-byte digest is the only thing accepted — anything else is
 * malformed, never "close enough".
 */
export function signatureCandidates(header: string): Uint8Array[] | null {
  const parts = header
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^(sha256|v1)=/i, ''));
  const digests: Uint8Array[] = [];
  for (const part of parts) {
    const bytes = part.length === 64 ? hexToBytes(part) : base64ToBytes(part);
    if (bytes && bytes.length === 32) digests.push(bytes);
  }
  return digests.length > 0 ? digests : null;
}

/**
 * Constant-time over equal-length inputs: every byte is visited whatever
 * the first difference, so the time taken does not say how much of a
 * forged signature was right. Lengths are not secret (always 32 here).
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Seconds since the epoch from a header: seconds, milliseconds or ISO 8601. */
export function parseTimestamp(value: string): number | null {
  const text = value.trim();
  if (/^\d{9,13}$/.test(text)) {
    const n = Number(text);
    return text.length >= 13 ? Math.floor(n / 1000) : n;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Verify one delivery. `rawBody` must be the exact bytes received, as
 * text, BEFORE any JSON parsing — a re-serialised body is a different
 * message and would never verify.
 *
 * Replays: when Willo sends a timestamp (configured), a delivery outside
 * the window is refused. When it does not, a replayed body re-applies an
 * event the database has already applied, and every path through
 * `willo_record_event` is idempotent on a repeat — which is the reason
 * that property is held by pgTAP (380, 480).
 */
export async function verifyWilloSignature(
  rawBody: string,
  headers: HeaderReader,
  config: WilloSignatureConfig,
  nowSeconds: number,
): Promise<SignatureVerdict> {
  if (!config.secret) return { ok: false, reason: 'secret_missing' };

  let message = rawBody;
  if (config.timestampHeader) {
    const stamp = headers.get(config.timestampHeader);
    if (!stamp) return { ok: false, reason: 'timestamp_missing' };
    const seconds = parseTimestamp(stamp);
    if (seconds === null) return { ok: false, reason: 'timestamp_malformed' };
    if (Math.abs(nowSeconds - seconds) > config.toleranceSeconds) {
      return { ok: false, reason: 'timestamp_out_of_window' };
    }
    message = `${stamp.trim()}.${rawBody}`;
  }

  const header = headers.get(config.signatureHeader);
  if (!header) return { ok: false, reason: 'signature_missing' };
  const offered = signatureCandidates(header);
  if (!offered) return { ok: false, reason: 'signature_malformed' };

  const expected = await hmacSha256(config.secret, message);
  // Every candidate is compared, match or not, so the number offered is
  // the only thing the timing depends on.
  let matched = false;
  for (const digest of offered) matched = timingSafeEqual(digest, expected) || matched;
  return matched ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

// ---------------------------------------------------------------------
// Payload → a key of settings.willo_stage_map
// ---------------------------------------------------------------------

export interface WilloEvent {
  /** Willo's own id for the delivery, when it sends one. Logging only. */
  deliveryId: string | null;
  willoCandidateId: string;
  /** The key looked up in settings.willo_stage_map, or `progress`. */
  eventKey: string;
  rawType: string;
  stage: string | null;
  /** When Willo says it happened (ISO), or null → the receiver uses now. */
  occurredAt: string | null;
  details: { answersDone?: number; answersTotal?: number };
}

export type WilloEventFailure = 'not_json' | 'no_event_type' | 'no_candidate' | 'no_stage';

export type ParsedWilloEvent =
  { ok: true; event: WilloEvent } | { ok: false; reason: WilloEventFailure };

/** "Stage Change" → `stage_change`; "Accepted" → `accepted`. */
export function stageMapKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const STAGE_CHANGE_TYPES = new Set([
  'stage_change',
  'stage_changed',
  'candidate_stage_change',
  'candidate_stage_changed',
  'participant_stage_change',
  'participant_stage_changed',
  'moved_stage',
]);

const PROGRESS_TYPES = new Set(['progress', 'response_progress', 'answer_submitted']);

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function at(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const part of path.split('.')) {
    if (!isObject(node)) return undefined;
    node = node[part];
  }
  return node;
}

function firstText(root: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = at(root, path);
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstCount(root: unknown, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = at(root, path);
    const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0) return n;
  }
  return undefined;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value > 1e12 ? value : value * 1000).toISOString();
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const TYPE_PATHS = ['event', 'type', 'event_type', 'eventType', 'trigger', 'action'];
const CANDIDATE_PATHS = [
  'data.candidate.key',
  'data.candidate.id',
  'data.candidate_key',
  'data.candidate_id',
  'data.participant.key',
  'data.participant.id',
  'data.participant_key',
  'candidate.key',
  'candidate.id',
  'candidate_key',
  'candidate_id',
  'participant.key',
  'participant.id',
  'participant_key',
];
const STAGE_PATHS = [
  'data.stage.name',
  'data.stage.title',
  'data.stage',
  'data.new_stage.name',
  'data.new_stage',
  'data.to_stage.name',
  'data.to_stage',
  'stage.name',
  'stage.title',
  'stage',
  'new_stage.name',
  'new_stage',
];
const TIME_PATHS = ['occurred_at', 'created_at', 'timestamp', 'data.created_at', 'data.updated_at'];
const DELIVERY_PATHS = ['id', 'event_id', 'delivery_id', 'uuid'];

export function parseWilloEvent(rawBody: string): ParsedWilloEvent {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  if (!isObject(body)) return { ok: false, reason: 'not_json' };

  const rawType = firstText(body, TYPE_PATHS);
  if (!rawType || stageMapKey(rawType) === '') return { ok: false, reason: 'no_event_type' };
  const candidate = firstText(body, CANDIDATE_PATHS);
  if (!candidate) return { ok: false, reason: 'no_candidate' };

  const type = stageMapKey(rawType);
  const stage = firstText(body, STAGE_PATHS);
  let eventKey: string;
  if (STAGE_CHANGE_TYPES.has(type)) {
    if (!stage || stageMapKey(stage) === '') return { ok: false, reason: 'no_stage' };
    eventKey = stageMapKey(stage);
  } else if (PROGRESS_TYPES.has(type)) {
    eventKey = 'progress';
  } else {
    eventKey = type;
  }

  const details: WilloEvent['details'] = {};
  const done = firstCount(body, [
    'data.answers_done',
    'data.answered',
    'data.progress.answered',
    'data.progress.done',
    'answers_done',
  ]);
  const total = firstCount(body, [
    'data.answers_total',
    'data.total_questions',
    'data.progress.total',
    'answers_total',
  ]);
  if (done !== undefined) details.answersDone = done;
  if (total !== undefined) details.answersTotal = total;

  let occurredAt: string | null = null;
  for (const path of TIME_PATHS) {
    occurredAt = isoOrNull(at(body, path));
    if (occurredAt) break;
  }

  return {
    ok: true,
    event: {
      deliveryId: firstText(body, DELIVERY_PATHS),
      willoCandidateId: candidate,
      eventKey,
      rawType,
      stage,
      occurredAt,
      details,
    },
  };
}

/**
 * The time the database records for the event: Willo's own, unless it is
 * missing or in the future (a clock that runs ahead must not stamp a card
 * "completed tomorrow").
 */
export function eventTime(occurredAt: string | null, nowMs: number): string {
  if (!occurredAt) return new Date(nowMs).toISOString();
  const ms = Date.parse(occurredAt);
  if (!Number.isFinite(ms) || ms > nowMs + 60_000) return new Date(nowMs).toISOString();
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------
// What the receiver does with a database refusal
// ---------------------------------------------------------------------

/**
 * A refusal that no retry can change: the candidate is unknown to us, the
 * login belongs to somebody else, the mapping names a target that does
 * not exist. Answering 5xx to these would have Willo retry for days; the
 * receiver records them (`willo_record_refusal`) and answers 200, and the
 * office sees the card still waiting for a decision. Anything else — a
 * network blip, a lock timeout — is 5xx so Willo retries.
 */
const PERMANENT = new Set([
  'unknown_willo_candidate',
  'unsupported_willo_mapping',
  'unknown_staff',
  'unknown_account',
  'account_not_staff',
  'account_missing',
  'account_email_mismatch',
  'staff_linked_elsewhere',
  'account_linked_elsewhere',
  'illegal_staff_transition',
]);

export function refusalCode(message: string): string {
  return (message.split(':')[0] ?? '').trim();
}

export function isPermanentRefusal(message: string): boolean {
  return PERMANENT.has(refusalCode(message));
}

// ---------------------------------------------------------------------
// "Create candidate in Willo" — §2.4: "the system automatically creates
// them in Willo and Willo sends them the interview invitation" (E1).
// ---------------------------------------------------------------------

export interface WilloApiConfig {
  apiKey: string;
  interviewKey: string;
  apiBase: string;
  invitePath: string;
  authHeader: string;
  authPrefix: string;
}

export const DEFAULT_API_BASE = 'https://api.willotalent.com/api/integrations/v2';
export const DEFAULT_INVITE_PATH = '/interviews/{interviewKey}/candidates/';

/** Null when either key is missing: the caller logs and does nothing. */
export function willoApiConfig(env: EnvReader): WilloApiConfig | null {
  const apiKey = envText(env, 'WILLO_API_KEY');
  const interviewKey = envText(env, 'WILLO_INTERVIEW_KEY');
  if (!apiKey || !interviewKey) return null;
  return {
    apiKey,
    interviewKey,
    apiBase: (envText(env, 'WILLO_API_BASE') ?? DEFAULT_API_BASE).replace(/\/+$/, ''),
    invitePath: envText(env, 'WILLO_INVITE_PATH') ?? DEFAULT_INVITE_PATH,
    authHeader: envText(env, 'WILLO_API_AUTH_HEADER') ?? 'Authorization',
    // Explicitly empty is allowed (`WILLO_API_AUTH_PREFIX=` → the bare key);
    // unset means a bearer token.
    authPrefix: env('WILLO_API_AUTH_PREFIX') ?? 'Bearer ',
  };
}

export interface InviteCandidate {
  staffId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}

export interface HttpRequestSpec {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

export function willoInviteRequest(
  config: WilloApiConfig,
  candidate: InviteCandidate,
): HttpRequestSpec {
  const path = config.invitePath.replace('{interviewKey}', encodeURIComponent(config.interviewKey));
  return {
    url: `${config.apiBase}${path.startsWith('/') ? path : `/${path}`}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      [config.authHeader]: `${config.authPrefix}${config.apiKey}`,
    },
    body: JSON.stringify({
      first_name: candidate.firstName,
      last_name: candidate.lastName,
      email: candidate.email,
      phone_number: candidate.phone,
      // Ours, so a delivery can be traced back without trusting a name.
      external_id: candidate.staffId,
      send_invite: true,
    }),
  };
}

export type InviteAnswer =
  { ok: true; willoCandidateId: string } | { ok: false; retry: boolean; reason: string };

/**
 * Willo's answer to the create call. The candidate key is read from the
 * places it is likely to be; a 2xx without one is an error, because an
 * unlinked candidate's webhooks would all be `unknown_willo_candidate`.
 * `retry` says whether the same request could succeed later (5xx, 408,
 * 429); it is logged with the failure. The database's backoff
 * (`willo_invite_due`) tries again either way, so a key fixed after a 401
 * heals every waiting candidate without anyone touching them.
 */
export function readInviteAnswer(status: number, bodyText: string): InviteAnswer {
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      retry: status >= 500 || status === 408 || status === 429,
      reason: `http_${status}: ${bodyText.slice(0, 300)}`,
    };
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, retry: false, reason: 'response_not_json' };
  }
  const id = firstText(body, [
    'key',
    'candidate_key',
    'id',
    'candidate.key',
    'candidate.id',
    'data.key',
    'data.candidate_key',
    'data.id',
    'data.candidate.key',
    'participant.key',
  ]);
  return id
    ? { ok: true, willoCandidateId: id }
    : { ok: false, retry: false, reason: 'response_without_candidate_key' };
}
