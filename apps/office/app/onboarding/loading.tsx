import { Skeleton, SkeletonScreen, SkeletonText, SkeletonToolbar } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import './onboarding.css';

const STAGES = 6;

/**
 * /onboarding (§2.2) while the pipeline is read: the filters and the six
 * kanban columns, each with a card or two.
 */
export default function Loading() {
  return (
    <OfficeShell activeHref="/onboarding" title="Onboarding">
      <SkeletonScreen label="Loading the candidate pipeline">
        <SkeletonToolbar controls={2} />
        <div className="kanban six" aria-hidden="true">
          {Array.from({ length: STAGES }, (_, column) => (
            <div className="kcol" key={column}>
              <div className="kh">
                <Skeleton width="60%" />
              </div>
              <div className="kb">
                {Array.from({ length: column % 3 === 0 ? 2 : 1 }, (_, card) => (
                  <div className="kcard" key={card}>
                    <SkeletonText lines={3} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SkeletonScreen>
    </OfficeShell>
  );
}
