import Link from 'next/link';
import { Kanban, KanbanColumn, Skeleton, SkeletonScreen, SkeletonToolbar } from '@thc/ui';
import { COLUMNS } from './view-model';

/**
 * The onboarding topbars and skeletons (§2.2, §2.3;
 * `wireframes/backoffice/onboarding.html`, `candidate.html`). Plain
 * components with no hooks, so a page draws them in its own `OfficeShell`
 * around the streamed screen (ADR-0161), and `OnboardingBoard` /
 * `CandidateScreen` draw the same ones when rendered whole.
 */

export function OnboardingCrumbs({ active, rejected }: { active: number; rejected: number }) {
  return (
    <>
      candidate pipeline · <b>{active} active</b> · {rejected} rejected
    </>
  );
}

/** The public /apply form, on the Staff App; no button when its origin is not configured. */
export function ApplyFormLink({ url }: { url: string | null }) {
  return url ? (
    <a className="btn sm" href={url} target="_blank" rel="noreferrer">
      Open /apply form ↗
    </a>
  ) : null;
}

export function CandidateCrumbs({ name }: { name: string }) {
  return (
    <>
      <Link href="/onboarding">Onboarding</Link> / <b>{name}</b>
    </>
  );
}

/** The pipeline while it is read: the toolbar, then the six columns, empty. */
export function BoardSkeleton() {
  return (
    <SkeletonScreen label="Loading the candidate pipeline">
      <SkeletonToolbar controls={4} />
      <Kanban>
        {COLUMNS.map((column) => (
          <KanbanColumn
            key={column.key}
            title={<span className={`t ${column.tone}`}>{column.label}</span>}
          >
            <Skeleton shape="card" />
            <Skeleton shape="card" />
          </KanbanColumn>
        ))}
      </Kanban>
    </SkeletonScreen>
  );
}

/** A candidate while their record is read: the header, the stepper, a panel. */
export function CandidateSkeleton() {
  return (
    <SkeletonScreen label="Loading the candidate">
      <div className="cand-head">
        <Skeleton shape="avatar" />
        <div className="who">
          <Skeleton width="38%" height="1.1em" />
          <Skeleton width="62%" />
        </div>
      </div>
      <SkeletonToolbar controls={6} />
      <Skeleton shape="card" />
    </SkeletonScreen>
  );
}
