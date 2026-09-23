'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Button, Logo, Pill } from '@thc/ui';
import { isIos, isStandalone } from '../../lib/push';

/**
 * "Install the app" — §10.5, ADR-0001, wireframes/staff/auth.html.
 *
 * This screen is the gate on everything device-level. iOS 16.4+ delivers
 * Web Push only to a PWA that has been added to the home screen, so on an
 * iPhone "install the app" is literally "switch on your shift
 * notifications". Android can be asked with one button.
 *
 * The two platforms get different content because the actions are
 * different, and a generic "add to home screen" helps neither.
 */
type Platform = 'ios' | 'android' | 'other' | 'installed' | 'unknown';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallScreen() {
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => {
    const detect = () => {
      if (isStandalone()) return setPlatform('installed');
      if (isIos(navigator.userAgent, navigator.maxTouchPoints)) return setPlatform('ios');
      if (/android/i.test(navigator.userAgent)) return setPlatform('android');
      return setPlatform('other');
    };
    detect();

    // Chrome fires this when the app meets the install criteria (manifest,
    // service worker, HTTPS). Holding on to it is what lets the app show
    // its own button instead of the browser's mini-infobar.
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setPlatform('installed');
      setOutcome('Installed. Open the app from your home screen.');
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
        : 'Not installed. You can install later from the ⋮ menu → “Add to Home screen”.',
    );
  };

  if (platform === 'installed') {
    return (
      <>
        <div className="auth-hero">
          <Logo size="lg" />
          <div className="name">You’re all set</div>
          <div className="sub">Installed</div>
        </div>
        <Alert tone="green">
          The app is installed on this device. The last step is notifications — without them you
          will not hear about invitations or the 12:00 deadline.
        </Alert>
        <Link href="/notifications" className="btn primary block lg">
          Turn on notifications
        </Link>
        <Link href="/shifts" className="btn ghost block">
          Open the app
        </Link>
      </>
    );
  }

  return (
    <>
      <div className="auth-hero">
        <Logo size="lg" />
        <div className="name">Install the app</div>
        <div className="sub">
          {platform === 'ios'
            ? 'iPhone · Safari'
            : platform === 'android'
              ? 'Android · Chrome'
              : 'Any phone'}
        </div>
      </div>

      {outcome ? <Alert tone="cyan">{outcome}</Alert> : null}

      {platform === 'ios' || platform === 'unknown' || platform === 'other' ? (
        <div className="steps">
          <Step n={1} title="Tap the Share button">
            The square with an arrow out of it, in Safari’s toolbar at the bottom.
          </Step>
          <Step n={2} title="Choose “Add to Home Screen”">
            Scroll the list if you don’t see it straight away.
          </Step>
          <Step n={3} title="Tap “Add”, then open it from your home screen">
            Sign in once — you’ll stay signed in.
          </Step>
        </div>
      ) : null}

      {platform === 'android' ? (
        <div className="steps">
          <Step n={1} title="Tap Install">
            Or use the ⋮ menu → “Add to Home screen” if no banner appears.
          </Step>
          <Step n={2} title="Open it from your home screen">
            It opens full-screen, without the browser bar.
          </Step>
        </div>
      ) : null}

      {deferred ? (
        <Button type="button" tone="primary" size="lg" block onClick={() => void install()}>
          Install app
        </Button>
      ) : null}

      {platform === 'ios' ? (
        <Alert tone="cyan">
          Notifications on iPhone only work from the installed app, not from the Safari tab — so
          this step is required (iOS 16.4+).
        </Alert>
      ) : null}

      <div className="xs muted" style={{ textAlign: 'center' }}>
        Already installed? Open it from your home screen and sign in.
      </div>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="step">
      <Pill tone="cyan">{n}</Pill>
      <div>
        <div className="t">{title}</div>
        <div className="s">{children}</div>
      </div>
    </div>
  );
}
