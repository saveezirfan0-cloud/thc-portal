/**
 * The header logo as an inline CID attachment (ADR-0073).
 *
 * Kept apart from the renderer and out of the package index: only the drain
 * sends email, so only the drain imports the base64 bytes. An app that
 * imports `@thc/notifications` for the register never bundles them.
 */

import { THC_MARK_EMAIL_PNG_BASE64 } from './assets/thc-mark-email.ts';
import { LOGO_CONTENT_ID } from './email-html.ts';

export interface InlineImage {
  filename: string;
  /** base64, standard alphabet. */
  content: string;
  contentId: string;
  contentType: string;
}

/** The header mark, as the inline attachment every HTML email carries. */
export function inlineLogoAttachment(): InlineImage {
  return {
    filename: 'thc-mark.png',
    content: THC_MARK_EMAIL_PNG_BASE64,
    contentId: LOGO_CONTENT_ID,
    contentType: 'image/png',
  };
}
