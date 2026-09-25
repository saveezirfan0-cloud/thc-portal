import { StaffShell } from '../_components/StaffShell';
import { NotificationsScreen } from './NotificationsScreen';
import '../chrome.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications · THC Staff' };

/**
 * "Turn on notifications" — §10.5, wireframes/staff/auth.html.
 *
 * `ignoreLock`: a blocked worker still needs push. N4 tells them they were
 * blocked, N8 carries the reason a document was rejected, and N15 is what
 * tells them they are unblocked again (§8) — so this screen renders
 * whatever the app lock says, while the navigation still shows the tabs
 * they cannot reach.
 */
export default function Page() {
  return (
    <StaffShell title="Notifications" ignoreLock pushStatus={false}>
      <NotificationsScreen />
    </StaffShell>
  );
}
