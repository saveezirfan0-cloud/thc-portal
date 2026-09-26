'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState, useTransition } from 'react';
import { Button, Chip } from '@thc/ui';
import type { ClientOption } from '../data';
import { type EventQuery, applyFilterSet, eventsHref, filterSetOf } from './filters';
import {
  MAX_VIEW_NAME,
  type SavedView,
  activeSavedView,
  browserStorage,
  clearSavedViews,
  describeFilterSet,
  readSavedViews,
} from './saved-views';
import {
  type SavedViewsOutcome,
  deleteMyView,
  moveLocalViews,
  saveMyView,
} from './saved-views-actions';

/**
 * Saved views above the Scheduling list and calendar (ADR-0053).
 *
 * Each saved view is a chip that is a LINK — to the period on screen now,
 * seen through that view's filters — so it opens in a new tab, and the back
 * button undoes it like any other filter change. The × deletes it (with an
 * Undo, since there is no confirmation step).
 *
 * Views live in `office_saved_views`, per manager, across devices. The page
 * reads them on the server (`initial`), so chips are in the first paint;
 * every write goes through a server action on the manager's own session
 * and comes back with the fresh list.
 *
 * Views saved before the table existed are still in this browser's
 * localStorage. They are read after mount, never during render; when the
 * account has none yet, the bar offers a one-tap move and clears the old
 * copy once the database has it.
 *
 * When the database refuses — no project in this environment, or a login
 * that may not write — the bar stays: the chips still open (they are only
 * links), with a read-only notice instead of Save and ×.
 */
export function SavedViewsBar({
  query,
  clients,
  initial,
}: {
  query: EventQuery;
  clients: ClientOption[];
  initial: SavedViewsOutcome;
}) {
  const [views, setViews] = useState<SavedView[]>(initial.ok ? initial.views : []);
  // null: writable. A string: why the bar is read-only.
  const [readOnly, setReadOnly] = useState<string | null>(initial.ok ? null : initial.message);
  // This browser's pre-table views; read after mount.
  const [local, setLocal] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [undo, setUndo] = useState<SavedView | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setLocal(readSavedViews(browserStorage()));
  }, []);

  const clientName = (id: string) => clients.find((client) => client.id === id)?.name;
  const current = filterSetOf(query);
  const loaded = initial.ok;
  // With the table unreadable, this browser's own views still open.
  const shown = loaded ? views : local;
  const active = activeSavedView(shown, current);
  const offerMove = loaded && readOnly === null && views.length === 0 && local.length > 0;

  /** Apply an action's answer: the fresh list, or the reason and maybe read-only. */
  const settle = (result: SavedViewsOutcome, success?: string): boolean => {
    if (result.ok) {
      setViews(result.views);
      setNote(success ?? result.message ?? null);
      return true;
    }
    if (result.readOnly) setReadOnly(result.message);
    setNote(result.message);
    return false;
  };

  const startNaming = () => {
    setName(describeFilterSet(current, clientName).slice(0, MAX_VIEW_NAME));
    setNote(null);
    setUndo(null);
    setNaming(true);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      if (settle(await saveMyView(name, current))) setNaming(false);
    });
  };

  const remove = (view: SavedView) => {
    if (!view.id) return;
    const id = view.id;
    startTransition(async () => {
      if (settle(await deleteMyView(id), `Deleted “${view.name}”.`)) setUndo(view);
    });
  };

  const restore = () => {
    const view = undo;
    setUndo(null);
    if (!view) return;
    startTransition(async () => {
      settle(await saveMyView(view.name, view.filters), `Restored “${view.name}”.`);
    });
  };

  const move = () => {
    const moving = local;
    startTransition(async () => {
      if (settle(await moveLocalViews(moving))) {
        clearSavedViews(browserStorage());
        setLocal([]);
      }
    });
  };

  const writable = loaded && readOnly === null;

  return (
    <div className="row wrap saved-views" role="group" aria-label="Saved views">
      <span className="lbl muted sm">Saved views</span>

      {shown.map((view) => {
        const on = view === active;
        return (
          <Chip
            key={view.id ?? view.name}
            tone={on ? 'cyan' : 'neutral'}
            title={describeFilterSet(view.filters, clientName)}
          >
            <Link
              href={eventsHref(applyFilterSet(query, view.filters))}
              aria-current={on ? 'true' : undefined}
            >
              {view.name}
            </Link>
            {writable && view.id ? (
              <button
                type="button"
                className="x"
                aria-label={`Delete saved view ${view.name}`}
                disabled={pending}
                onClick={() => remove(view)}
              >
                ×
              </button>
            ) : null}
          </Chip>
        );
      })}

      {writable && views.length === 0 && !naming && !offerMove ? (
        <span className="muted sm">None yet. Set the filters, then save them here.</span>
      ) : null}

      {offerMove ? (
        <span className="muted sm">
          {local.length} saved view{local.length === 1 ? ' is' : 's are'} still only in this
          browser.{' '}
          <Button size="sm" tone="primary" disabled={pending} onClick={move}>
            Move my saved views to my account
          </Button>
        </span>
      ) : null}

      {!writable ? (
        <span className="muted sm" role="status">
          Saved views are read-only here: {readOnly}
        </span>
      ) : naming ? (
        <form className="row" onSubmit={save}>
          <input
            className="input"
            style={{ height: 32, width: 240 }}
            aria-label="Name this view"
            placeholder="Name this view"
            maxLength={MAX_VIEW_NAME}
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setNaming(false);
            }}
          />
          <Button type="submit" size="sm" tone="primary" disabled={pending}>
            Save
          </Button>
          <Button size="sm" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button size="sm" disabled={pending} onClick={startNaming}>
          Save view
        </Button>
      )}

      {note && note !== readOnly ? (
        <span className="muted sm" role="status">
          {note}
          {undo ? (
            <>
              {' '}
              <Button tone="link" disabled={pending} onClick={restore}>
                Undo
              </Button>
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
