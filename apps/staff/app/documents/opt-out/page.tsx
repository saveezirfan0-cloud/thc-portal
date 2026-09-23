import { NotAvailable, SubScreen } from '../_components/SubScreen';
import { OptOutForm } from '../_components/OptOutForm';
import { optOutView } from '../model';
import '../../staff-app.css';
import '../documents.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: '48-hour opt-out · Documents · THC Staff' };

/**
 * The 48-hour opt-out — completion letter requirement §2.4.
 *
 * `optOutView()` returns null for anyone `canSignOptOut()` refuses — under
 * 18, or no date of birth on file — and this screen then offers nothing:
 * "do not offer the opt-out flow to under-18s".
 */
export default async function Page() {
  return (
    <SubScreen title="48-hour opt-out">
      {(data) => {
        const view = optOutView(data);
        if (!view) {
          return (
            <NotAvailable>
              The 48-hour opt-out isn’t available on your account. If you think that’s wrong, please
              contact the office at: admin@thehospitalitycompany.co.uk
            </NotAvailable>
          );
        }
        return (
          <OptOutForm
            state={view.state}
            today={data.today}
            noticeDays={data.optOut.noticeDays ?? 7}
            cancelledFrom={data.optOut.cancelledFrom}
            student={data.rtwBranch === 'international_student'}
          />
        );
      }}
    </SubScreen>
  );
}
