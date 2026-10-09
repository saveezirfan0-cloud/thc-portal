/**
 * How often the middleware asks GoTrue about a session it can already read
 * (ADR-0108).
 *
 * The access token is verified locally on every request (`getClaims()`:
 * signature against the project's published keys, expiry). What a token
 * cannot say is whether its session has since been revoked, or whether the
 * login has a verified authenticator factor — only GoTrue knows, and asking
 * is a network round trip on the path of every page and every prefetch.
 * So that one question is asked at most once per `SESSION_RECHECK_MS` per
 * session per server instance, and the answer is remembered here, in the
 * server's memory. Nothing the browser sends is part of the key's trust: it
 * is derived from claims that have just been signature-checked.
 *
 * Pure (no Next, no Supabase), like `two-step.ts`, so the rule is testable.
 */
export const SESSION_RECHECK_MS = 60_000;
const MAX_ENTRIES = 500;

export interface SessionCheck {
  /** GoTrue still knows this session (`getUser()` returned a user). */
  valid: boolean;
  /** The login has a verified factor, so it can reach aal2 (`nextLevelFor`). */
  secondStep: boolean;
}

interface Entry extends SessionCheck {
  at: number;
}

/** The slice of the verified claims the key is built from. */
export interface SessionClaims {
  sub: string;
  session_id?: string;
  iat?: number;
  aal?: string;
}

/**
 * One session at one assurance level. `session_id` is in every Supabase
 * token; `iat` stands in if a custom hook ever strips it, so a refreshed
 * token is simply checked again.
 */
export function sessionKey(claims: SessionClaims): string {
  return `${claims.sub}:${claims.session_id ?? claims.iat ?? ''}:${claims.aal ?? ''}`;
}

export function createSessionCheckCache(now: () => number = Date.now) {
  const entries = new Map<string, Entry>();

  return {
    /** The remembered answer, or null when there is none or it is due again. */
    get(key: string): SessionCheck | null {
      const entry = entries.get(key);
      if (!entry) return null;
      if (now() - entry.at >= SESSION_RECHECK_MS) {
        entries.delete(key);
        return null;
      }
      return { valid: entry.valid, secondStep: entry.secondStep };
    },
    set(key: string, check: SessionCheck): void {
      // Bounded: drop the oldest entries rather than grow with every login.
      if (entries.size >= MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.delete(key);
      entries.set(key, { ...check, at: now() });
    },
  };
}
