import { AppBody, AppFrame, Logo } from '@thc/ui';
import '../chrome.css';

export const metadata = { title: 'Offline · THC Staff' };

/**
 * The offline shell — §10.5, ADR-0001.
 *
 * Precached by the service worker and served for any navigation that
 * cannot reach the network. The copy is deliberately specific about what
 * does NOT work: a worker outside a venue with no signal needs to know
 * that their check-in did not go through. There is no offline queue — the
 * scope does not ask for one, and every check-in and check-out is decided
 * by the server at the moment of the press (§5.1) — so this page must not
 * promise one: a worker who trusted it would walk in and become a No-show
 * (docs/15).
 */
export default function Page() {
  return (
    <AppFrame>
      <AppBody className="center">
        <div className="static-screen">
          <Logo size="lg" />
          <h2>You’re offline</h2>
          <p>
            The app is here, but your phone can’t reach us right now. Move somewhere with signal and
            pull down to refresh.
          </p>
          <p className="xs muted">
            Checking in and checking out need a connection — nothing is saved on this phone while
            you’re offline. As soon as you’re back online, open your shift and try again.
          </p>
        </div>
      </AppBody>
    </AppFrame>
  );
}
