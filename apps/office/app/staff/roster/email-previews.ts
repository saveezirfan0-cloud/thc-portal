import { messageFor } from '@thc/notifications';
import { LOGO_CONTENT_ID } from '@thc/notifications/email-html';
import { inlineLogoAttachment } from '@thc/notifications/email-logo';
import { STAFF_EMAILS } from './emails';

/**
 * The emails on /staff/roster (ADR-0141), rendered on the server from the
 * register exactly as the drain sends them (messageFor), so what the office
 * reads is what staff get. Server only: the page passes the finished HTML
 * down, and the register never reaches the browser bundle.
 */

/** The first name every preview is shown with. */
export const SAMPLE_NAME = 'Amara';

/** The header logo the emails attach, as a data URL a browser can show. */
export const LOGO_DATA_URL = `data:${inlineLogoAttachment().contentType};base64,${inlineLogoAttachment().content}`;

export interface EmailPreview {
  id: string;
  subject: string;
  /** The email's own HTML, the logo inlined so a browser shows it. */
  html: string;
  /** The plain-text version sent alongside it. */
  text: string;
}

/**
 * Every email rendered as it is sent, with a sample first name. `applyLink`
 * is IR1's button (`<Staff App>/apply`); `logoDataUrl` stands in for the
 * `cid:` logo the THC Light layout points at, which only a mail app can
 * resolve.
 */
export function emailPreviews(
  applyLink: string,
  logoDataUrl: string = LOGO_DATA_URL,
): EmailPreview[] {
  return STAFF_EMAILS.map((email) => {
    const message = messageFor({
      id: 0,
      key: `preview:${email.id}`,
      channel: 'email',
      template: email.template,
      recipient_staff_id: null,
      recipient_emails: ['preview@example.invalid'],
      payload: { name: SAMPLE_NAME, variant: email.variant, applyLink },
      attempts: 0,
    });
    if (message.kind !== 'email') throw new Error(`${email.id} is not an email`);
    return {
      id: email.id,
      subject: message.subject,
      html: message.html.replaceAll(`cid:${LOGO_CONTENT_ID}`, logoDataUrl),
      text: message.body,
    };
  });
}
