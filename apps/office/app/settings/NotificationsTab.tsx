'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Panel, Pill, Switch } from '@thc/ui';
import { NOTIFICATION_SWITCH_GROUPS } from '@thc/notifications';
import type { NotificationSwitch } from '@thc/notifications';
import { saveNotificationSwitch } from './actions';

/**
 * /settings → Notifications (ADR-0083): one switch per notification the
 * platform sends, grouped by who receives it.
 *
 * Each switch saves the moment it is flicked. Off is enforced in the
 * database (claim_outbox_batch, 20261002113000), so it holds for every
 * send path — a job, a button, the drain — without a deploy.
 */
export function NotificationsTab({ off }: { off: readonly string[] }) {
  const offCount = off.length;

  return (
    <div className="stack notif-tab">
      {offCount > 0 ? (
        <Alert tone="amber">
          {offCount === 1 ? '1 notification is' : `${offCount} notifications are`} switched off.
        </Alert>
      ) : null}
      <div className="settings-grid">
        {NOTIFICATION_SWITCH_GROUPS.map((group) => {
          const groupOff = group.items.filter((item) => off.includes(item.code)).length;
          return (
            <Panel
              key={group.id}
              title={group.title}
              actions={
                groupOff > 0 ? (
                  <Pill tone="amber">{groupOff} off</Pill>
                ) : (
                  <Pill tone="green">All on</Pill>
                )
              }
            >
              <div className="notif-list">
                {group.items.map((item) => (
                  <SwitchRow key={item.code} item={item} on={!off.includes(item.code)} />
                ))}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

function SwitchRow({ item, on }: { item: NotificationSwitch; on: boolean }) {
  const router = useRouter();
  // Shown at once; put back if the save is refused, and replaced by the
  // database's answer when the page re-reads.
  const [draft, setDraft] = useState(on);
  const [shownFor, setShownFor] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (shownFor !== on) {
    setShownFor(on);
    setDraft(on);
  }

  const flick = (next: boolean) => {
    setDraft(next);
    setError(null);
    start(async () => {
      const result = await saveNotificationSwitch(item.code, next);
      if (result.ok) router.refresh();
      else {
        setDraft(!next);
        setError(result.message);
      }
    });
  };

  return (
    <div className={draft ? 'notif-row' : 'notif-row is-off'}>
      <div className="notif-text">
        <div className="notif-label">{item.label}</div>
        <div className="sm muted">{item.when}</div>
        {!draft && item.warning ? <div className="sm notif-warning">{item.warning}</div> : null}
        {error ? <Alert tone="coral">{error}</Alert> : null}
      </div>
      <Switch
        checked={draft}
        disabled={pending}
        onChange={flick}
        label={draft ? 'On' : 'Off'}
        aria-label={item.label}
      />
    </div>
  );
}
