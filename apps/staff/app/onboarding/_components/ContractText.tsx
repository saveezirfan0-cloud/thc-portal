import { contractClause28Pending } from '@thc/domain';
import { contractParagraphs } from '../content/contract';
import './contract.css';

/**
 * The agreement's text, as `contract_versions` holds it (§2.11) — drawn the
 * same way in the wizard's 10/11 and on /profile/agreement (ADR-0083), so
 * the copy a worker reopens reads as the one they signed. Nothing is
 * interpreted beyond the bold clause headings (`contractParagraphs`).
 */
export function ContractText({
  title,
  body,
  size = 'scroll',
}: {
  title: string;
  body: string;
  /** `scroll` — 10/11's 300px box; `short` — once signed; `full` — the whole text. */
  size?: 'scroll' | 'short' | 'full';
}) {
  return (
    <div
      className={`contract${size === 'scroll' ? '' : ` ${size}`}`}
      {...(size === 'full' ? {} : { tabIndex: 0 })}
      aria-label={title}
    >
      <h4>{title}</h4>
      {contractParagraphs(body).map((p, i) => (
        <p key={i}>
          {p.heading ? <b>{p.heading}</b> : null}
          {p.heading && p.text ? ' ' : null}
          {p.text}
        </p>
      ))}
    </div>
  );
}

/**
 * The note over a version still marked `is_placeholder`. Shown wherever the
 * text is, because a worker who signed it should know what it is.
 */
export function placeholderNote(version: string): string {
  return contractClause28Pending(version)
    ? 'Clause 28, the duty to disclose convictions, is awaiting THC’s approval.'
    : 'Draft wording: THC’s own agreement replaces this text before go-live.';
}
