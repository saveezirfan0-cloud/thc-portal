'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Alert, Button } from '@thc/ui';
import { isIos, isStandalone } from '../../../lib/push';
import '../activate.css';

/**
 * The activated frame — wireframes/public/activate.html, §2.7, §10.5.
 *
 * The same platform split as /install (and its helpers from lib/push):
 * Android/Chrome gets its native prompt behind a button (beforeinstallprompt);
 * iOS/Safari has no prompt, so the Share → Add to Home Screen steps are
 * printed; a desktop reader gets both, to follow on the phone.
 *
 * "Open the app" goes to the onboarding wizard (§10.3). Activation leaves
 * the candidate signed in on this browser, so on the phone that is one
 * tap; from the installed icon it is a sign-in with the new password.
 *
 * The desktop card also draws a QR code of the app's address (activate.html:
 * "Scan with your phone camera, or open"). The address is the Staff App's
 * public origin, `NEXT_PUBLIC_STAFF_URL` (docs/16 §3.1) — the one E3 was
 * built on — and only when that is unset the page's own, which on a Vercel
 * preview is a hostname behind a login wall.
 */
const WIZARD_PATH = '/onboarding';

export type Platform = 'ios' | 'android' | 'desktop' | 'installed' | 'unknown';

const PUBLIC_ORIGIN = process.env['NEXT_PUBLIC_STAFF_URL'] ?? '';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function ActivatedScreen({
  initialPlatform = 'unknown',
}: {
  /** The platform before detection runs — for the tests and previews, where no effect does. */
  initialPlatform?: Platform;
}) {
  const [platform, setPlatform] = useState<Platform>(initialPlatform);
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [origin, setOrigin] = useState(PUBLIC_ORIGIN ? new URL(PUBLIC_ORIGIN).host : '');

  useEffect(() => {
    if (!PUBLIC_ORIGIN) setOrigin(window.location.host);
    if (isStandalone()) setPlatform('installed');
    else if (isIos(navigator.userAgent, navigator.maxTouchPoints)) setPlatform('ios');
    else if (/android/i.test(navigator.userAgent)) setPlatform('android');
    else setPlatform('desktop');

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setPlatform('installed');
      setOutcome('Installed. Open the app from your home screen and sign in.');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome: choice } = await deferred.userChoice;
    setDeferred(null);
    setOutcome(
      choice === 'accepted'
        ? 'Installing — open the app from your home screen when it appears.'
        : 'Not installed. You can install later from the ⋮ menu → “Install app”.',
    );
  };

  const showIos = platform === 'ios' || platform === 'desktop' || platform === 'unknown';
  const showAndroid = platform === 'android' || platform === 'desktop' || platform === 'unknown';

  return (
    <>
      <div className="act-done">
        <span className="ico" aria-hidden="true">
          ✓
        </span>
        <p className="sm muted" style={{ margin: 0 }}>
          {platform === 'desktop'
            ? 'Onboarding, shifts and check-in all happen in the app on your phone.'
            : 'Add The Hospitality Company to your home screen so it opens like an app — with notifications for invitations and shifts.'}
        </p>
      </div>

      {outcome ? <Alert tone="cyan">{outcome}</Alert> : null}

      {deferred ? (
        <Button type="button" tone="primary" size="lg" block onClick={() => void install()}>
          Install the app
        </Button>
      ) : null}
      {/* Primary in every branch, as the wireframe draws it (activate.html). */}
      <Link href={WIZARD_PATH} className="btn primary block lg">
        Open the app
      </Link>

      {platform === 'desktop' ? (
        <div className="row top act-qr-row">
          {origin ? <AppQr url={`https://${origin}`} /> : null}
          <div className="stack" style={{ flex: 1 }}>
            <span className="label">
              {origin ? 'Scan with your phone camera, or open' : 'On your phone, open'}
            </span>
            <a className="mono sm" href={`https://${origin}`}>
              {origin}
            </a>
            <p className="xs muted" style={{ margin: 0 }}>
              Sent to you by email as well (E3). One account, one app — no app-store download.
            </p>
          </div>
        </div>
      ) : null}

      {showIos || showAndroid ? (
        <div className="act-grid">
          {showIos ? (
            <div className="act-install">
              <span className="k">iPhone · Safari</span>
              <ol>
                {platform === 'desktop' || platform === 'unknown' ? (
                  <li>
                    Open the link in <b>Safari</b>
                  </li>
                ) : null}
                <li>
                  Tap <b>Share</b>{' '}
                  <span className="key" aria-hidden="true">
                    ⎙
                  </span>
                  {platform === 'ios' ? ' in the bar below' : null}
                </li>
                <li>
                  Tap <b>Add to Home Screen</b> → <b>Add</b>
                </li>
              </ol>
            </div>
          ) : null}
          {showAndroid ? (
            <div className="act-install">
              <span className="k">Android · Chrome</span>
              <ol>
                {platform === 'desktop' || platform === 'unknown' ? (
                  <li>
                    Open the link in <b>Chrome</b>
                  </li>
                ) : null}
                {/* While this screen holds Chrome's prompt (preventDefault
                    above), the native sheet is not showing: the step points
                    at the screen's own button instead. */}
                <li>
                  {deferred ? (
                    <>
                      Tap <b>Install the app</b> above
                    </>
                  ) : (
                    <>
                      Tap <b>Install</b> in the prompt at the bottom
                    </>
                  )}
                </li>
                <li>
                  No prompt?{' '}
                  <span className="key" aria-hidden="true">
                    ⋮
                  </span>{' '}
                  → <b>Install app</b>
                </li>
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="xs muted" style={{ margin: 0 }}>
        Then sign in with the password you just set. Allow notifications and location when asked —
        invitations and check-in depend on them.
      </p>
    </>
  );
}

/**
 * The QR as inline SVG, one path of unit squares over the module grid, so
 * it is crisp at any size and takes its colours from the box around it
 * (`currentColor` on `--qr-paper`). `QRCode.create` is synchronous, which
 * keeps the server and the browser rendering the same markup.
 */
export function AppQr({ url }: { url: string }) {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const size = modules.size;
  let d = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules.get(y, x)) d += `M${x} ${y}h1v1H${x}z`;
    }
  }
  return (
    <div className="act-qr">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`QR code → ${url}`}
      >
        <path d={d} fill="currentColor" />
      </svg>
    </div>
  );
}
