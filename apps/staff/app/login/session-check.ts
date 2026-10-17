/**
 * How often the Staff App middleware asks GoTrue about a session it can
 * already read — the Back Office rule (ADR-0108,
 * `apps/office/app/login/session-check.ts`), applied here by the go-live
 * audit (H2). Kept as its own copy rather than imported across apps; it
 * belongs in `@thc/db` once a shared-package PR can take it.
 *
 * The access token is verified locally on every request (`getClaims()`:
 * signature against the project's published keys, expiry). What a token
 * cannot say is whether its session has since been revoked — only GoTrue
 * knows, and asking is a network round trip on the path of every page,
 * every prefetch, every location ping and every push-subscription save. So
 * that one question is asked at most once per `SESSION_RECHECK_MS` per
 * session per server instance, and the answer is remembered here, in the
 * server's memory. Nothing the browser sends is part of the key's trust:
 * it is derived from claims that have just been signature-checked.
 *
 * The Staff App has no second step (ADR-0057 is the Back Office's), so the
 * only thing remembered is whether GoTrue still knows the session.
 *
 * Pure (no Next, no Supabase), so the rule is testable.
 */
export const SESSION_RECHECK_MS = 60_000;
/** ~1,000 workers; a busy instance sees a good share of them at a shift start. */
export const MAX_ENTRIES = 2_000;

export interface SessionCheck {
  /** GoTrue still knows this session (`getUser()` returned a user). */
  valid: boolean;
}

interface Entry extends SessionCheck {
  at: number;
}

/** The slice of the verified claims the key is built from. */
export interface SessionClaims {
  sub: string;
  session_id?: string;
  iat?: number;
}

/**
 * One session. `session_id` is in every Supabase token; `iat` stands in if
 * a custom hook ever strips it, so a refreshed token is simply checked again.
 */
export function sessionKey(claims: SessionClaims): string {
  return `${claims.sub}:${claims.session_id ?? claims.iat ?? ''}`;
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
      return { valid: entry.valid };
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
