'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { Button, Chip } from '@thc/ui';
import type { ClientOption } from '../data';
import { type EventQuery, applyFilterSet, eventsHref, filterSetOf } from './filters';
import {
  SAVED_VIEWS_KEY,
  type SavedView,
  type ViewStorage,
  activeSavedView,
  browserStorage,
  describeFilterSet,
  findSavedView,
  readSavedViews,
  removeSavedView,
  upsertSavedView,
  writeSavedViews,
} from './saved-views';

/**
 * Saved views above the Scheduling list and calendar.
 *
 * Each saved view is a chip that is a LINK — to the period on screen now,
 * seen through that view's filters — so it opens in a new tab, and the back
 * button undoes it like any other filter change. The × deletes it (with an
 * Undo, since there is no confirmation step).
 *
 * Views live in this browser's localStorage (`saved-views.ts`). Storage is
 * read after mount, never during render, so the server's markup and the
 * first client render agree; with storage unavailable the bar says so and
 * the rest of the screen is untouched.
 */
export function SavedViewsBar({ query, clients }: { query: EventQuery; clients: ClientOption[] }) {
  // undefined: not yet checked (server render and first paint); null: unavailable.
  const [storage, setStorage] = useState<ViewStorage | null | undefined>(undefined);
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [undo, setUndo] = useState<SavedView[] | null>(null);

  useEffect(() => {
    const found = browserStorage();
    setStorage(found);
    setViews(readSavedViews(found));
  }, []);

  // A view saved or deleted in another tab shows up here too.
  useEffect(() => {
    if (!storage) return undefined;
    const onStorage = (event: StorageEvent) => {
      if (event.key === SAVED_VIEWS_KEY) setViews(readSavedViews(storage));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storage]);

  const clientName = (id: string) => clients.find((client) => client.id === id)?.name;
  const current = filterSetOf(query);
  const active = activeSavedView(views, current);

  const commit = (next: SavedView[]): boolean => {
    if (!writeSavedViews(storage, next)) {
      setNote('This browser would not store the view.');
      return false;
    }
    setViews(next);
    return true;
  };

  const startNaming = () => {
    setName(describeFilterSet(current, clientName));
    setNote(null);
    setUndo(null);
    setNaming(true);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const replacing = findSavedView(views, name);
    const next = upsertSavedView(views, name, current);
    if (next === views) {
      setNote('Give the view a name.');
      return;
    }
    if (commit(next)) {
      setNote(replacing ? `Updated “${replacing.name}”.` : 'View saved.');
      setNaming(false);
    }
  };

  const remove = (view: SavedView) => {
    const before = views;
    if (commit(removeSavedView(views, view.name))) {
      setUndo(before);
      setNote(`Deleted “${view.name}”.`);
    }
  };

  const restore = () => {
    if (undo && commit(undo)) setNote(null);
    setUndo(null);
  };

  if (storage === null) {
    return (
      <div className="row wrap saved-views">
        <span className="muted sm">
          Saved views are unavailable: this browser is not allowing site storage.
        </span>
      </div>
    );
  }

  return (
    <div className="row wrap saved-views" role="group" aria-label="Saved views">
      <span className="lbl muted sm">Saved views</span>

      {views.map((view) => {
        const on = view === active;
        return (
          <Chip
            key={view.name}
            tone={on ? 'cyan' : 'neutral'}
            title={describeFilterSet(view.filters, clientName)}
          >
            <Link
              href={eventsHref(applyFilterSet(query, view.filters))}
              aria-current={on ? 'true' : undefined}
            >
              {view.name}
            </Link>
            <button
              type="button"
              className="x"
              aria-label={`Delete saved view ${view.name}`}
              onClick={() => remove(view)}
            >
              ×
            </button>
          </Chip>
        );
      })}

      {views.length === 0 && storage !== undefined && !naming ? (
        <span className="muted sm">None yet. Set the filters, then save them here.</span>
      ) : null}

      {naming ? (
        <form className="row" onSubmit={save}>
          <input
            className="input"
            style={{ height: 32, width: 240 }}
            aria-label="Name this view"
            placeholder="Name this view"
            maxLength={60}
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setNaming(false);
            }}
          />
          <Button type="submit" size="sm" tone="primary">
            Save
          </Button>
          <Button size="sm" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button size="sm" disabled={storage === undefined} onClick={startNaming}>
          Save view
        </Button>
      )}

      {note ? (
        <span className="muted sm" role="status">
          {note}
          {undo ? (
            <>
              {' '}
              <Button tone="link" onClick={restore}>
                Undo
              </Button>
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
