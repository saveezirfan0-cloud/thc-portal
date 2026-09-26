/**
 * How the agreement's stored text is laid out on screen (§2.11).
 *
 * `contract_versions.body` is plain text: paragraphs separated by a blank
 * line, each clause opening "N. Heading." — the shape of the wireframe's
 * draft and of THC's agreement (20260930140100). The heading is drawn bold,
 * as wireframes/staff/onboarding-3.html draws it; nothing else is
 * interpreted, so what is shown is what was signed. A heading may stand as
 * a paragraph of its own ("1. INTERPRETATION.", its sub-clauses after it) —
 * then the text is empty. Sub-clauses ("1.1 …", "3.10.3.1 …") are not
 * headings: the number is followed by a digit, not a space.
 */
export interface ContractParagraph {
  heading: string | null;
  text: string;
}

export function contractParagraphs(body: string): ContractParagraph[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      const match = /^(\d+\.\s[^.]{1,80}\.)(?:\s+([\s\S]*))?$/.exec(p);
      return match ? { heading: match[1]!, text: match[2] ?? '' } : { heading: null, text: p };
    });
}
