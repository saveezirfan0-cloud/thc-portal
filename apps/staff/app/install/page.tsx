import { AppBody, AppFrame } from '@thc/ui';
import { InstallScreen } from './InstallScreen';
import '../chrome.css';

export const metadata = { title: 'Install the app · THC Staff' };

/**
 * The install screen — §10.5, ADR-0001, wireframes/staff/auth.html.
 *
 * Public on purpose: it is where the activation email's hand-off lands
 * (§2.7), before there is a session, and it is also where the "add this to
 * your home screen" banner inside the app points. It must render with no
 * database and no account.
 */
export default function Page() {
  return (
    <AppFrame>
      <AppBody>
        <InstallScreen />
      </AppBody>
    </AppFrame>
  );
}
