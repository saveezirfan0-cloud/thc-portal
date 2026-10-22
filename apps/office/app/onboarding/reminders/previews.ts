import { messageFor } from '@thc/notifications';
import { LOGO_CONTENT_ID } from '@thc/notifications/email-html';
import { inlineLogoAttachment } from '@thc/notifications/email-logo';
import { REMINDER_EMAILS } from './reminders';

/**
 * The reminders on /onboarding/reminders (ADR-0187), rendered on the server
 * from the register exactly as the drain sends them (messageFor), so what
 * the office reads is what candidates get. Server only: the page passes the
 * finished HTML down, and the register never reaches the browser bundle.
 */

/** The first name every preview is shown with. */
export const SAMPLE_NAME = 'Amara';
/** The wizard step the app reminders are shown at: one with a list worth reading. */
export const SAMPLE_STEP = 'your two references';

/** The header logo the emails attach, as a data URL a browser can show. */
export const LOGO_DATA_URL = `data:${inlineLogoAttachment().contentType};base64,${inlineLogoAttachment().content}`;

export interface ReminderPreview {
  id: string;
  subject: string;
  /** The email's own HTML, the logo inlined; null for a push, which has none. */
  html: string | null;
  /** The plain text sent alongside the email, or the push's title and words. */
  text: string;
}

export interface PreviewLinks {
  /** `<Staff App>/onboarding`, OC4's button. */
  appLink: string;
  /** `<Staff App>/activate/…`, OC2's button: a sample, never a live link. */
  activationLink: string;
  /** `<Staff App>/install`. */
  installLink: string;
}

/**
 * Every reminder rendered as it is sent, with a sample first name and step.
 * `logoDataUrl` stands in for the `cid:` logo the layout points at, which
 * only a mail app can resolve.
 */
export function reminderPreviews(
  links: PreviewLinks,
  logoDataUrl: string = LOGO_DATA_URL,
): ReminderPreview[] {
  return REMINDER_EMAILS.map((email) => {
    const message = messageFor({
      id: 0,
      key: `preview:${email.id}`,
      channel: email.channel,
      template: email.template,
      recipient_staff_id: email.channel === 'push' ? 'preview' : null,
      recipient_emails: email.channel === 'email' ? ['preview@example.invalid'] : null,
      payload: {
        name: SAMPLE_NAME,
        variant: email.variant,
        step: SAMPLE_STEP,
        pushOn: '0',
        link: email.template === 'OC2' ? links.activationLink : links.appLink,
        installLink: links.installLink,
      },
      attempts: 0,
    });
    if (message.kind === 'push') {
      return {
        id: email.id,
        subject: message.title,
        html: null,
        text: `${message.title}\n\n${message.body}`,
      };
    }
    if (message.kind !== 'email') throw new Error(`${email.id} is neither an email nor a push`);
    return {
      id: email.id,
      subject: message.subject,
      html: message.html.replaceAll(`cid:${LOGO_CONTENT_ID}`, logoDataUrl),
      text: message.body,
    };
  });
}
