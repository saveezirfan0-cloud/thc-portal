import { AuthCard } from '@thc/ui';
import { ActivatedScreen } from './ActivatedScreen';

export const metadata = {
  title: 'Account activated · THC Staff',
  robots: { index: false, follow: false },
};

/**
 * "Activated · install the app" — §2.7 ("activated → CTA 'download the
 * app'"), §10.5, ADR-0001, wireframes/public/activate.html.
 *
 * Public, like the rest of /activate: it says nothing about anybody, and
 * "Open the app" goes through the sign-in gate like any other link.
 */
export default function Page() {
  return (
    <AuthCard product="Account activated" heading="You’re in — install the app">
      <ActivatedScreen />
    </AuthCard>
  );
}
