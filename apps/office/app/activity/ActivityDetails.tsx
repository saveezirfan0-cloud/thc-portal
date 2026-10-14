import { DETAILS_FOLD } from './view-model';

/**
 * The Details cell of an activity entry, on /activity and on every
 * History block. A long entry used to be cut at 77 characters with no way
 * to read the rest (release audit 14.10.2026); it now folds at
 * DETAILS_FOLD and opens in place — a native `<details>`, so it works by
 * keyboard and without script, and the CSV export carries it whole.
 */
export function ActivityDetails({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return <>—</>;
  const text = lines.join(' · ');
  if (text.length <= DETAILS_FOLD) return <>{text}</>;
  const preview = `${text.slice(0, DETAILS_FOLD - 20).trimEnd()}…`;
  return (
    <details className="activity-more">
      <summary>
        <span className="activity-more-preview">{preview}</span>{' '}
        <span className="activity-more-cue">
          <span className="activity-more-open">Show all</span>
          <span className="activity-more-close">Show less</span>
        </span>
      </summary>
      <span className="activity-more-full">{text}</span>
    </details>
  );
}
