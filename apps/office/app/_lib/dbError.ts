/**
 * A database refusal, in a sentence a manager can act on (release audit
 * 14.10.2026, D-M5).
 *
 * The Back Office used to hand PostgREST's `error.message` straight to the
 * screen, so a duplicate role read *duplicate key value violates unique
 * constraint "roles_name_key"* and a refused write read *new row violates
 * row-level security policy for table "audit_log"*. That text names tables,
 * constraints and ids, and tells the reader nothing they can do.
 *
 * Two kinds of message come back from the database:
 *
 *  · Postgres's own templates (unique, foreign key, check, RLS, a bad
 *    uuid…). Those are mapped by SQLSTATE — or, where the caller only has
 *    the text, by the template — to a plain sentence, and the detail is
 *    logged on the server with `console.error`.
 *  · Our own `raise exception '…'` in a function, written for people
 *    ("Do not return needs a reason — it is shown on this client's events
 *    (§9.6)"). Those are kept, with the scope reference taken off the end.
 *
 * Snake-case codes our functions raise (`unknown_qualification`,
 * `read_only`) are mapped by the caller's own table first, then the few
 * every screen shares, then the generic sentence.
 *
 * Pure: imported by server actions and pinned by `__tests__/dbError.test.ts`.
 */

import { READ_ONLY_MESSAGE } from './sessionRole';

export interface DbError {
  code?: string | null;
  message: string;
  details?: string | null;
}

export interface DbWording {
  /** 23505 — the thing the person typed already exists. */
  unique?: string;
  /** 23503 — it refers to something gone, or something still uses it. */
  foreignKey?: string;
  /** 23514 from a table constraint (not one of our own raised sentences). */
  check?: string;
  /** Our own snake_case codes, matched on the first word of the message. */
  codes?: Readonly<Record<string, string>>;
  /** Instead of GENERIC, for this screen. */
  generic?: string;
  /** Prefixes the server log line, e.g. "[roles]". */
  log?: string;
}

export const GENERIC =
  'That could not be saved. Refresh the page and try again — if it keeps happening, tell a developer.';
export const NOT_ALLOWED =
  'Your login is not allowed to make this change. If you think it should be, ask an owner to check your access on Users & access.';
export const GONE = 'That record no longer exists. Refresh the page.';
const UNIQUE = 'That already exists. Use a different name, or edit the one that is already there.';
const FOREIGN_KEY =
  'Something this refers to has changed or been removed, or is still in use elsewhere. Refresh the page and try again.';
const CHECK = 'One of the values is not allowed. Check the form and try again.';

/** Codes several functions raise, worded once. */
const SHARED_CODES: Readonly<Record<string, string>> = {
  read_only: READ_ONLY_MESSAGE,
  not_authorised: NOT_ALLOWED,
  admins_only: NOT_ALLOWED,
  not_signed_in: 'Your session has ended. Sign in again.',
};

/** Postgres / PostgREST wording that must never reach the screen. */
const TEMPLATE =
  /violates|duplicate key|relation "|constraint "|column "|permission denied|row-level security|does not exist|invalid input syntax|null value in|value too long|out of range|syntax error|could not find|schema cache|PGRST|JWT|\bfunction\b/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Is this one of our own raised sentences, rather than a template or a code? */
export function writtenForPeople(message: string): boolean {
  const text = message.trim();
  return (
    /\s/.test(text) &&
    // A code, even with detail after it: "rota_guard_visa_cap: 20 h".
    !/^[a-z0-9]+_[a-z0-9_]*\b/.test(text) &&
    !TEMPLATE.test(text) &&
    !UUID.test(text)
  );
}

/** "… events (§9.6)" → "… events." — the scope reference is for developers. */
export function asSentence(message: string): string {
  const text = message
    .replace(/\s*\((?:[^()]*(?:§|ADR-|RULE-|migration)[^()]*)\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/** The SQLSTATE class, from the code when PostgREST sent one and from the text otherwise. */
function classify(error: DbError): 'unique' | 'fk' | 'check' | 'denied' | 'gone' | null {
  const code = error.code ?? '';
  const text = error.message ?? '';
  if (code === '23505' || /duplicate key value/i.test(text)) return 'unique';
  if (code === '23503' || /foreign key constraint/i.test(text)) return 'fk';
  if (code === '23514' || /violates check constraint/i.test(text)) return 'check';
  if (code === '42501' || /row-level security|permission denied/i.test(text)) return 'denied';
  if (code === 'P0002' || code === 'PGRST116') return 'gone';
  return null;
}

// ---------------------------------------------------------------------
// The database did not answer (go-live audit 17.10.2026, M1)
//
// Under load the 8 s statement limit cancels a slow read, and the screen
// printed PostgREST's text as it came: "canceling statement due to
// statement timeout". A fetch that never got an answer (aborted, the
// gateway's "upstream request timeout", a dropped connection) came through
// as "AbortError: …" or "TypeError: fetch failed". Neither is anything a
// manager can act on except "wait and refresh", so both say exactly that.
// ---------------------------------------------------------------------

export const TIMED_OUT =
  'This took too long to load — the database is busy. Refresh in a minute; if it keeps happening, tell a developer.';
export const UNREACHABLE =
  'The Back Office could not reach the database just now. Refresh in a minute; if it keeps happening, tell a developer.';

/** SQLSTATE 57014 query_canceled — the statement_timeout, as PostgREST reports it. */
export function isStatementTimeout(error: DbError | string): boolean {
  const err = typeof error === 'string' ? { message: error } : error;
  return err.code === '57014' || /canceling statement due to statement timeout/i.test(err.message);
}

/** No answer at all: aborted, timed out on the way, or the connection dropped. */
export function isUnreachable(error: DbError | string): boolean {
  const err = typeof error === 'string' ? { message: error, details: null } : error;
  const text = `${err.message ?? ''}\n${err.details ?? ''}`;
  return (
    /^\s*(AbortError|TimeoutError|FetchError)\b/.test(err.message ?? '') ||
    /\bfetch failed\b|operation was aborted|request was aborted|upstream request timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|UND_ERR_/i.test(
      text,
    )
  );
}

function timeoutOrUnreachable(error: DbError): string | null {
  if (isStatementTimeout(error)) return TIMED_OUT;
  if (isUnreachable(error)) return UNREACHABLE;
  return null;
}

/**
 * The `problem` a loader shows when a read fails. A timeout or a fetch that
 * never answered becomes one of the two sentences above; anything else is
 * the database's message as before, after `context` when one is given
 * ("The event could not be read: …"). Null in, null out, so
 * `readProblem(a.error ?? b.error)` reads like the `?.message ?? null`
 * chains it replaces.
 */
export function readProblem(error: DbError | string, context?: string): string;
export function readProblem(
  error: DbError | string | null | undefined,
  context?: string,
): string | null;
export function readProblem(
  error: DbError | string | null | undefined,
  context?: string,
): string | null {
  if (error === null || error === undefined) return null;
  const err: DbError = typeof error === 'string' ? { message: error } : error;
  const busy = timeoutOrUnreachable(err);
  if (busy) return busy;
  return context ? `${context}: ${err.message}` : err.message;
}

/**
 * The sentence for the screen. Everything that is not our own sentence is
 * logged with its detail, so a refusal nobody mapped can still be found.
 */
export function explainDbError(error: DbError | string, wording: DbWording = {}): string {
  const err: DbError = typeof error === 'string' ? { message: error } : error;
  const message = (err.message ?? '').trim();
  const token = message.split(/[:\s]/)[0] ?? '';

  const own = wording.codes?.[token] ?? SHARED_CODES[token];
  if (own) return own;

  const busy = timeoutOrUnreachable(err);
  if (busy) {
    console.error(`${wording.log ?? '[office]'} database did not answer in time`, {
      code: err.code ?? null,
      message,
    });
    return busy;
  }

  const log = (said: string) => {
    console.error(`${wording.log ?? '[office]'} database refusal shown as a sentence`, {
      code: err.code ?? null,
      message,
      details: err.details ?? null,
    });
    return said;
  };

  switch (classify(err)) {
    // Our own raises use these SQLSTATEs too ("This role is on 2 rate
    // card(s)…", foreign_key_violation): their words are kept.
    case 'unique':
      return writtenForPeople(message) ? asSentence(message) : log(wording.unique ?? UNIQUE);
    case 'fk':
      return writtenForPeople(message)
        ? asSentence(message)
        : log(wording.foreignKey ?? FOREIGN_KEY);
    case 'check':
      // `raise … using errcode = 'check_violation'` carries our own words.
      return writtenForPeople(message) ? asSentence(message) : log(wording.check ?? CHECK);
    case 'denied':
      return writtenForPeople(message) ? asSentence(message) : log(NOT_ALLOWED);
    case 'gone':
      return writtenForPeople(message) ? asSentence(message) : log(GONE);
    default:
      return writtenForPeople(message) ? asSentence(message) : log(wording.generic ?? GENERIC);
  }
}
