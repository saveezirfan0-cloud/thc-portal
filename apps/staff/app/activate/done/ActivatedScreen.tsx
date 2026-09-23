'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
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
 */
const WIZARD_PATH = '/onboarding';

type Platform = 'ios' | 'android' | 'desktop' | 'installed' | 'unknown';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function ActivatedScreen() {
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.host);
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
      <Link href={WIZARD_PATH} className={deferred ? 'btn block' : 'btn primary block lg'}>
        Open the app
      </Link>

      {platform === 'desktop' ? (
        <p className="sm muted" style={{ margin: 0 }}>
          On your phone, open <b className="mono">{origin}</b>. One account, one app — no app-store
          download.
        </p>
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
                <li>
                  Tap <b>Install</b> in the prompt at the bottom
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
