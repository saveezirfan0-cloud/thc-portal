/**
 * The "N of MAX characters" line under a capped field (release audit
 * D-M3), as the Client Portal's feedback box writes it: shown once the
 * text is within a fifth of the cap, so a short name carries no counter.
 * The field itself has `maxLength`, and the database holds the same cap.
 */
export function lengthHint(length: number, max: number): string | null {
  if (length < Math.floor(max * 0.8)) return null;
  return `${length.toLocaleString('en-GB')} of ${max.toLocaleString('en-GB')} characters.`;
}

/** Venue and client names (venues_name_length, clients_name_length). */
export const NAME_MAX = 120;
/** One dress code (client_rate_cards / shift_requirements, 20261014180000). */
export const DRESS_CODE_MAX = 200;
/** The office's own feedback — the Client Portal's figure for a client's (20261012120600). */
export const FEEDBACK_TEXT_MAX = 2000;
