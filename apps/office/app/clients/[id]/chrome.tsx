import Link from 'next/link';
import { SkeletonKpis, SkeletonPanel, SkeletonScreen } from '@thc/ui';
import { newEventHref } from './card';

/**
 * The client card's topbar (§9.7, `wireframes/backoffice/client-card.html`):
 * "Clients / Acme" and "+ New event for this client". No hooks, so the page
 * draws them in its own `OfficeShell` from the card's first read while the
 * rest streams (ADR-0161), and `ClientCard` draws the same ones when
 * rendered whole.
 */
export function ClientCrumbs({ name }: { name: string }) {
  return (
    <>
      <Link href="/clients">Clients</Link> / <b>{name}</b>
    </>
  );
}

/**
 * The Shift Builder opens with this client picked, its rate card and
 * on-site contact loaded (§9.7, §3.2).
 */
export function NewEventForClient({ clientId }: { clientId: string }) {
  return (
    <Link className="btn primary sm" href={newEventHref(clientId)}>
      + New event for this client
    </Link>
  );
}

/** The card while it is read: general info and its tiles, then the blocks below. */
export function ClientCardSkeleton() {
  return (
    <SkeletonScreen label="Loading the client card">
      <SkeletonPanel rows={4} lines={1} />
      <SkeletonKpis count={2} />
      <SkeletonPanel rows={4} />
      <SkeletonPanel rows={5} avatar />
    </SkeletonScreen>
  );
}
