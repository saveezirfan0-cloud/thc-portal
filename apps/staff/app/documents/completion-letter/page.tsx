import { Alert } from '@thc/ui';
import { NotAvailable, SubScreen } from '../_components/SubScreen';
import { CompletionLetterForm } from '../_components/CompletionLetterForm';
import { buildDocumentsView } from '../model';
import '../../staff-app.css';
import '../documents.css';

export const dynamic = 'force-dynamic';

// The upload's document read runs in after() (ADR-0033) and counts against
// the function's duration: 45 s per model call plus one retry and the download.
export const maxDuration = 120;
export const metadata = { title: 'Completion letter · Documents · THC Staff' };

/**
 * The Official University Completion Letter upload — completion letter
 * requirement §2.1, scope §4.5. Student / Tier 4 workers only: the option
 * exists "for any worker whose visa type is Student / Tier 4", and
 * `submit_completion_letter()` refuses anyone else with `not_student_visa`.
 */
export default async function Page() {
  return (
    <SubScreen title="Completion letter">
      {(data) => {
        const view = buildDocumentsView(data);
        if (data.rtwBranch !== 'international_student') {
          return (
            <NotAvailable>
              The completion letter is only for workers on a Student visa.
            </NotAvailable>
          );
        }
        if (!view.canUpload) {
          return (
            <NotAvailable>
              Uploads aren’t available on your account right now. Please contact the office at:
              admin@thehospitalitycompany.co.uk
            </NotAvailable>
          );
        }
        const slot = view.completion;
        if (slot?.state === 'in_review') {
          return (
            <NotAvailable>
              Your completion letter is already with the office for review. Your weekly limit stays
              where it is until they approve it.
            </NotAvailable>
          );
        }
        if (slot?.state === 'verified') {
          return <NotAvailable>{slot.meta}</NotAvailable>;
        }
        const currentLimit =
          data.cap?.hours !== null && data.cap?.hours !== undefined
            ? `${data.cap.hours} hours a week`
            : 'your current limit';
        return (
          <>
            {slot?.state === 'rejected' ? (
              <Alert tone="coral">
                <b>The office couldn’t accept your last upload.</b>
                <br />
                <span className="xs">{slot.meta}</span>
              </Alert>
            ) : null}
            <p className="sm muted">
              Finished your course? Upload one of these as evidence. Once the office approves it,
              your weekly limit rises from the Student visa’s term-time limit to 48 hours.
            </p>
            <CompletionLetterForm currentLimit={currentLimit} />
          </>
        );
      }}
    </SubScreen>
  );
}
