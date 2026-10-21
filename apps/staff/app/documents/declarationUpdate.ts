import { isDeclarationReviewStatus } from '@thc/domain';
import type { DeclarationReviewStatus } from '@thc/domain';

/**
 * The worker's side of a declaration the office has sent back or rejected
 * (ADR-0180) — `my_declaration_update()`, a definer RPC like every other
 * worker read of a declaration (ADR-0031). It carries the message the
 * office wrote FOR them when it asked for more details, and whether
 * "Update your declaration" is open; never the details they declared and
 * never the office's own review note.
 *
 * Read by the Documents tab, the declaration form and the paused
 * onboarding screen.
 */
export interface DeclarationUpdate {
  declarationId: string;
  source: 'onboarding' | 'in_employment';
  status: DeclarationReviewStatus;
  /** What the office asked, word for word — only when it asked for more details. */
  message: string | null;
  askedAt: string | null;
  /** `declaration_update_allowed()` — the same rule the update itself checks. */
  canUpdate: boolean;
  /** A compliant worker's update pauses their shifts while it is reviewed (§10.7). */
  pausesShifts: boolean;
}

export function parseDeclarationUpdate(raw: unknown): DeclarationUpdate | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row['declarationId'] !== 'string') return null;
  const status = row['status'];
  return {
    declarationId: row['declarationId'],
    source: row['source'] === 'in_employment' ? 'in_employment' : 'onboarding',
    status: isDeclarationReviewStatus(status) ? status : 'pending',
    message: typeof row['message'] === 'string' ? row['message'] : null,
    askedAt: typeof row['askedAt'] === 'string' ? row['askedAt'] : null,
    canUpdate: row['canUpdate'] === true,
    pausesShifts: row['pausesShifts'] === true,
  };
}

/** Where the update form lives for a worker (DR1's link, declaration_update_link()). */
export const UPDATE_DECLARATION_HREF = '/documents/declare';
