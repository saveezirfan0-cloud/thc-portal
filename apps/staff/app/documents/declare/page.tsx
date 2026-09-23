import { canDeclareConviction } from '@thc/domain';
import { loadBookings } from '../../data';
import { NotAvailable, SubScreen } from '../_components/SubScreen';
import { DeclareForm } from '../_components/DeclareForm';
import '../../staff-app.css';
import '../documents.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Declare a criminal conviction · THC Staff' };

/**
 * Declare a criminal conviction — §10.7.
 *
 * The count the confirmation quotes is the worker's confirmed bookings that
 * have not started: exactly the set `block_worker()` releases, since a shift
 * already under way is not disturbed (§10.7 step 4).
 */
export default async function Page() {
  return (
    <SubScreen title="Declare a criminal conviction">
      {async (data) => {
        if (!canDeclareConviction(data.status, data.blockKind)) {
          return (
            <NotAvailable>
              Declarations can’t be made from the app on your account. Please contact the office at:
              admin@thehospitalitycompany.co.uk
            </NotAvailable>
          );
        }
        const now = Date.now();
        const futureShifts = (await loadBookings()).filter(
          (booking) => booking.status === 'confirmed' && booking.startsAt.getTime() > now,
        ).length;
        return <DeclareForm futureShifts={futureShifts} today={data.today} />;
      }}
    </SubScreen>
  );
}
