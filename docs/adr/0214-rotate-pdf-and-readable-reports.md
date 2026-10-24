# ADR-0214 · Rotate a PDF too; a right-to-work report is never shrunk below 90 %

**Status:** Accepted (tickets TK-24 and TK-21, Sam Barrington-Wells, 24.10.2026). Amends ADR-0212 and the TK-15 report fit.

## Context

**TK-24:** "The passport is still not the right way round and there is no option to correct the layout." The passport was a PDF. ADR-0212's Rotate turned JPEG and PNG photos only, so a PDF got no button and the office's only answer was Reject again.

**TK-21:** "The Right To Work reports are still squashed looking when viewed." The TK-15 fit put the whole gov.uk result on one A4 sheet by scaling it down as far as needed. A typical result (photo, conditions, reference) came out at about 0.6–0.8 scale, so it read small and squashed.

## Decision

- **Rotate takes a PDF.**
  - The Back Office turns every page a quarter clockwise with pdf-lib, through the page's `/Rotate`, so nothing on the page is re-compressed.
  - The turned file is a `.pdf` beside the original and stays `application/pdf`.
  - `turn_document_upright()` (`20261027140000`) accepts a pending PDF, but only with a `.pdf` target. A photo still becomes a `.jpg`, and a HEIC is still refused.
  - The AI's automatic turn on upload stays photos only.
- **A report shrinks at most to 90 %.**
  - `fitReportToOnePage` still keeps a result that is a little too long on one sheet, scaled no further than `MIN_SCALE_PERCENT` (90).
  - A longer result prints at full size over as many pages as it needs. Photos, headings, summary-list rows and panels are not split across a page break.

## Consequences

- `pdf-lib` is a dependency of the Back Office.
- New reports are readable at full size and may run to two pages. Reports already on file are not regenerated.
