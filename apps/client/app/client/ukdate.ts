import { ukDateText } from '@thc/ui';

/**
 * The list's date filters as the customer types them: dd/mm/yyyy, UK order
 * (§1.8), whatever the device's own locale is.
 *
 * The field and its pure readers (`UkDateField`, `readUkDate`, `typeUkDate`,
 * `ukDateText`) moved to @thc/ui so the Back Office's dates are typed the
 * same way (ADR-0140); they are re-exported here so the portal keeps one
 * import for its dates. What stays is the portal's own sentence.
 */
export {
  UK_DATE_FORMAT_ERROR,
  UK_DATE_PLACEHOLDER,
  readUkDate,
  typeUkDate,
  ukDateText,
} from '@thc/ui';
export type { UkDateReading } from '@thc/ui';

/** The reversed-range sentence, on the "To" field and in the empty list. */
export function reversedRangeText(from: string, to: string): string {
  return `“From” (${ukDateText(from)}) is after “To” (${ukDateText(to)}). Swap them, or change one.`;
}
