import { AppBody, AppFrame, Logo } from '@thc/ui';
import '../chrome.css';

export const metadata = { title: 'Offline · THC Staff' };

/**
 * The offline shell — §10.5, ADR-0001.
 *
 * Precached by the service worker and served for any navigation that
 * cannot reach the network. The copy is deliberately specific about what
 * still works: a worker outside a venue with no signal needs to know
 * whether their check-in went through, and "you're offline" alone does not
 * tell them.
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
            If you were checking in, your attempt is saved on this phone and is sent the moment you
            are back online — don’t check in twice.
          </p>
        </div>
      </AppBody>
    </AppFrame>
  );
}
