import { cookies } from 'next/headers';
import { autosendHint, parseAutosendConfig } from '../../api/jobs/event-documents/_lib/schedule';
import type { AutosendConfig } from '../../api/jobs/event-documents/_lib/schedule';
import { eventsDb, supabaseConfigured } from '../db';

/**
 * The line under the event page's document buttons (ADR-0074): when the
 * Allocation Timesheet and the Completed Allocation Timesheet go out on
 * their own, or when they went. Read from `event_document_autosends`
 * (admin read) and the `document_autosend` settings row. The Completed
 * Timesheet goes with the invoice since ADR-0083, so its line also reads
 * the latest one queued from `event_documents` (admin read), as does the
 * Allocation Timesheet's last automatic update (ADR-0084).
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
  update: { enabled: false },
});

export async function loadAutosendHints(
  eventId: string,
  state: { started: boolean; ended: boolean },
): Promise<AutosendHints> {
  const none = { allocation: null, signout: null };
  if (!supabaseConfigured()) return none;
  try {
    const db = eventsDb(await cookies());
    const [sends, settings, completed, updated] = await Promise.all([
      db
        .from('event_document_autosends')
        .select('kind, queued_at')
        .eq('event_id', eventId)
        .not('queued_at', 'is', null),
      db.from('settings').select('value').eq('key', 'document_autosend').maybeSingle(),
      db
        .from('event_documents')
        .select('queued_at, sent_at')
        .eq('event_id', eventId)
        .eq('kind', 'signout')
        .not('queued_at', 'is', null)
        .order('queued_at', { ascending: false })
        .limit(1),
      // ADR-0084: the latest automatic update, from the copies themselves —
      // the job's claim row is cleared on every new attempt.
      db
        .from('event_documents')
        .select('queued_at')
        .eq('event_id', eventId)
        .eq('kind', 'allocation')
        .like('outbox_key', 'D1U:%')
        .not('queued_at', 'is', null)
        .order('queued_at', { ascending: false })
        .limit(1),
    ]);
    if (sends.error || settings.error || completed.error || updated.error) return none;
    // No settings row = switched off (document_autosend_config()).
    const config = settings.data ? parseAutosendConfig(settings.data.value) : OFF;
    // The latest Completed Timesheet anyone queued, and when its email went.
    const latest = ((completed.data ?? []) as { queued_at: string; sent_at: string | null }[])[0];
    const sentAt = (kind: string) =>
      ((sends.data ?? []) as { kind: string; queued_at: string }[]).find((r) => r.kind === kind)
        ?.queued_at ?? null;
    return {
      allocation: autosendHint('allocation', config, {
        ...state,
        sentAt: sentAt('allocation'),
        updatedAt: ((updated.data ?? []) as { queued_at: string }[])[0]?.queued_at ?? null,
      }),
      signout: state.started
        ? autosendHint('signout', config, {
            ...state,
            sentAt: sentAt('signout'),
            queuedAt: latest?.queued_at ?? null,
            deliveredAt: latest?.sent_at ?? null,
          })
        : null,
    };
  } catch {
    return none;
  }
}
