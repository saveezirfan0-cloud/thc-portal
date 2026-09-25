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
 *
 * There is NO check-in queue today: sw.ts routes every non-GET request
 * through NetworkOnly and registers no Background Sync, and the on-shift
 * screen awaits the server action once with no storage or retry. So a
 * check-in pressed with no signal did not happen, and the copy must say
 * so — a worker told "don't check in twice" who waits for a replay that
 * never comes runs into the start+30 automatic No-show (§9.5). docs/06's
 * "queued check-in attempts" line describes the queue that is still to be
 * built; reinstate a "saved on this phone" promise only with that queue
 * and a test that proves the replay (see __tests__/page.test.tsx).
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
            If you were checking in, it did not go through. Check in again as soon as you have
            signal.
          </p>
        </div>
      </AppBody>
    </AppFrame>
  );
}
