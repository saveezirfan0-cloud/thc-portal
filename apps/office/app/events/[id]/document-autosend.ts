import { cookies } from 'next/headers';
import { autosendHint, parseAutosendConfig } from '../../api/jobs/event-documents/_lib/schedule';
import type { AutosendConfig } from '../../api/jobs/event-documents/_lib/schedule';
import { eventsDb, supabaseConfigured } from '../db';

/**
 * The line under the event page's document buttons (ADR-0074): when the
 * Allocation Timesheet and the Completed Allocation Timesheet go out on
 * their own, or when they went. Read from `event_document_autosends`
 * (admin read) and the `document_autosend` settings row.
 *
 * A hint, not a record: any read that fails leaves it out rather than
 * holding up the board.
 */
export interface AutosendHints {
  allocation: string | null;
  signout: string | null;
}

const OFF: AutosendConfig = parseAutosendConfig({
  allocation: { enabled: false },
  completed: { enabled: false },
});

export async function loadAutosendHints(
  eventId: string,
  state: { started: boolean; ended: boolean },
): Promise<AutosendHints> {
  const none = { allocation: null, signout: null };
  if (!supabaseConfigured()) return none;
  try {
    const db = eventsDb(await cookies());
    const [sentRows, settings] = await Promise.all([
      db
        .from('event_document_autosends')
        .select('kind, queued_at, revision')
        .eq('event_id', eventId)
        .not('queued_at', 'is', null),
      db.from('settings').select('value').eq('key', 'document_autosend').maybeSingle(),
    ]);
    if (sentRows.error || settings.error) return none;
    // No settings row = switched off (document_autosend_config()).
    const config = settings.data ? parseAutosendConfig(settings.data.value) : OFF;
    const sends = (sentRows.data ?? []) as { kind: string; queued_at: string; revision: number }[];
    // The first automatic send, and (ADR-0084) the latest updated copy after it.
    const first = (kind: string) =>
      sends.find((r) => r.kind === kind && r.revision === 0)?.queued_at ?? null;
    const updated = (kind: string) =>
      sends
        .filter((r) => r.kind === kind && r.revision > 0)
        .map((r) => r.queued_at)
        .sort()
        .pop() ?? null;
    return {
      allocation: autosendHint('allocation', config, {
        ...state,
        sentAt: first('allocation'),
        updatedAt: updated('allocation'),
      }),
      signout: state.started
        ? autosendHint('signout', config, { ...state, sentAt: first('signout') })
        : null,
    };
  } catch {
    return none;
  }
}
