/**
 * IR1's HTML (ADR-0122): the owner's own dark design of 13.10.2026, for this
 * one email. Every other email is THC Light (`email-html.ts`, ADR-0073);
 * this is the single, deliberate exception, at the owner's request.
 *
 * The rules of `email-html.ts` still hold: table layout, 600px max, every
 * style inline, every gradient on a solid fallback colour for Outlook, no
 * script, no external stylesheet, no `data:` image. Every value is escaped;
 * the only link is the apply link the job passes, and only if it is http(s).
 *
 * Words: `invite-reminder-copy.ts`, shared with the plain text.
 */

import { escapeHtml, isHttpUrl } from './email-html.ts';
import {
  INVITE_REMINDER_COPY as C,
  axlr8Countdown,
  axlr8DaysLeft,
} from './invite-reminder-copy.ts';

/** The owner's palette (dark navy ground, cyan → violet accent). */
export const INVITE_REMINDER_COLOURS = {
  page: '#0a0e18',
  card: '#171b26',
  panel: '#1e2333',
  tile: '#272d3f',
  line: '#262c3b',
  action: '#12232a',
  notice: '#1a1830',
  footer: '#0f131d',
  text: '#e9eef5',
  muted: '#8a97a3',
  accent: '#3edcec',
  violet: '#b3a6ff',
  gradient: 'linear-gradient(135deg,#3edcec 0%,#8f7bff 100%)',
} as const;

/**
 * THC's wordmark, as the owner's design has it (hosted on the THC website).
 * A remote image, so a mail app that blocks images shows the alt text
 * instead; it is styled to read as the wordmark on the dark card.
 */
export const INVITE_REMINDER_LOGO =
  'https://thehospitalitycompany.co.uk/wp-content/uploads/2026/07/01f4aa97-fd39-4dc5-aaf2-1b635dfb0ac8-1.png';

const K = INVITE_REMINDER_COLOURS;
const FONT = "'Plus Jakarta Sans',Arial,Helvetica,sans-serif";
const e = escapeHtml;

const para = (text: string) =>
  `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:15px;line-height:1.65;color:${K.text};">${text}</p>`;

const label = (text: string, margin = '0 0 2px 0') =>
  `<div style="font-size:11px;line-height:1.4;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${K.accent};margin:${margin};">${text}</div>`;

const tile = (icon: string, size = 40, bg: string = K.tile) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td align="center" valign="middle" width="${size}" height="${size}" bgcolor="${bg}" style="width:${size}px;height:${size}px;border-radius:12px;background-color:${bg};font-size:${size === 40 ? 20 : 23}px;line-height:${size}px;text-align:center;">${icon}</td></tr></table>`;

/** A list of icon rows in a rounded panel; a hairline between rows. */
function rows(items: readonly { icon: string; body: string }[], margin: string): string {
  const out = items
    .map((item, i) => {
      const first = i === 0;
      const last = i === items.length - 1;
      const pad = `${first ? 18 : 14}px`;
      const padBottom = `${last ? 18 : 14}px`;
      const border = last ? '' : `border-bottom:1px solid ${K.line};`;
      return `<tr><td valign="top" width="58" style="padding:${pad} 0 ${padBottom} 18px;${border}">${tile(item.icon)}</td><td valign="top" style="padding:${pad} 18px ${padBottom} 4px;${border}font-family:${FONT};">${item.body}</td></tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${K.panel}" style="margin:${margin};background-color:${K.panel};border-radius:18px;border-collapse:separate;">${out}</table>`;
}

const rowTitle = (text: string) =>
  `<div style="font-size:15px;line-height:1.4;font-weight:700;color:${K.text};margin:0 0 3px 0;">${text}</div>`;
const rowText = (html: string) =>
  `<div style="font-size:14px;line-height:1.6;color:${K.muted};">${html}</div>`;

export interface InviteReminderHtmlInput {
  subject: string;
  /** The first name from the invite list, or none ("Hi there"). */
  name?: string;
  applyLink: string;
  /** The monitored address the footer names (the sender's reply-to). */
  senderAddress: string;
  /**
   * Days until AXLR8 stops working (the register's `{axlr8Days}`, worked out
   * when the email is rendered). Absent, it is worked out from now.
   */
  daysLeft?: number;
}

export function inviteReminderHtml(input: InviteReminderHtmlInput): string {
  if (!isHttpUrl(input.applyLink)) {
    throw new Error('IR1 needs an http(s) applyLink');
  }
  const link = e(input.applyLink);
  // The countdown (owner, 15.10.2026): a tile, the heading and the bold
  // sentence all count down to the day AXLR8 stops working.
  const days = Number.isFinite(input.daysLeft) ? input.daysLeft! : axlr8DaysLeft(new Date());
  const countdown = axlr8Countdown(days);
  const top = countdown.tileNumber
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="border-collapse:separate;margin:0 auto;"><tr><td align="center" bgcolor="${K.action}" style="padding:18px 34px 16px 34px;border-radius:22px;background-color:${K.action};font-family:${FONT};text-align:center;"><div style="font-size:${countdown.days === 0 ? 40 : 56}px;line-height:1.05;font-weight:800;color:${K.accent};">${e(countdown.tileNumber)}</div><div style="margin:8px 0 0 0;font-size:13px;line-height:1.2;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${K.muted};">${e(countdown.tileLabel ?? '')}</div></td></tr></table>`
    : `<span style="display:inline-block;padding:6px 14px;border-radius:999px;background-color:${K.panel};font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${K.accent};">⏰&nbsp; ${e(C.badge)}</span>`;
  const name = input.name?.trim();
  const greeting = name ? `Hi ${e(name)},` : 'Hi there,';
  const a = (words: string, style = '') =>
    `<a href="${link}" target="_blank" style="color:${K.accent};text-decoration:underline;${style}">${words}</a>`;
  const sender = input.senderAddress.trim();
  const senderHtml = /^[^\s@<>"]+@[^\s@<>"]+$/.test(sender)
    ? `<a href="mailto:${e(sender)}" style="color:${K.muted};text-decoration:none;">${e(sender)}</a>`
    : e(sender);

  const steps = rows(
    C.steps.map((s, i) => ({
      icon: s.icon,
      body:
        label(`Step ${i + 1}`) +
        rowTitle(e(s.title)) +
        rowText(s.link ? `${e(s.text)} ${a(e(s.link.words))} ${e(s.link.after)}` : e(s.text)),
    })),
    '0 0 26px 0',
  );

  const extras = rows(
    [
      { icon: '🎒', body: rowTitle(e(C.ready.title)) + rowText(e(C.ready.text)) },
      { icon: '💬', body: rowTitle(e(C.help.title)) + rowText(e(C.help.text)) },
    ],
    '0 0 30px 0',
  );

  return `<!DOCTYPE html>
<html lang="en-GB" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(input.subject)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark;}
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
@media only screen and (max-width:620px){
.thc-outer{padding:10px 6px!important;}
.thc-pad{padding-left:18px!important;padding-right:18px!important;}
.thc-title{font-size:25px!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${K.page};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${K.page};opacity:0;">${e(countdown.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${K.page}" style="background-color:${K.page};">
<tr><td align="center" class="thc-outer" style="padding:28px 12px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${K.card}" style="max-width:600px;margin:0 auto;background-color:${K.card};border-radius:22px;border-collapse:separate;box-shadow:0 18px 40px -16px rgba(62,220,236,0.28);">
<tr><td height="6" bgcolor="${K.accent}" style="height:6px;line-height:6px;font-size:0;mso-line-height-rule:exactly;background-color:${K.accent};background-image:${K.gradient};border-radius:22px 22px 0 0;">&nbsp;</td></tr>
<tr><td class="thc-pad" align="center" style="padding:30px 32px 6px 32px;"><img src="${INVITE_REMINDER_LOGO}" height="52" alt="The Hospitality Company" style="display:block;height:52px;width:auto;max-width:240px;border:0;margin:0 auto;font-family:${FONT};font-size:20px;line-height:52px;font-weight:800;color:${K.text};text-align:center;"></td></tr>
<tr><td class="thc-pad" align="center" style="padding:24px 32px 0 32px;font-family:${FONT};text-align:center;">
${top}
<h1 class="thc-title" style="margin:20px 0 8px 0;font-family:${FONT};font-size:30px;line-height:1.2;font-weight:800;color:${K.text};">${e(countdown.heading)}</h1>
<p style="margin:0 0 28px 0;font-family:${FONT};font-size:17px;line-height:1.6;font-weight:600;color:${K.muted};">${e(countdown.subheading)}</p>
</td></tr>
<tr><td class="thc-pad" style="padding:0 32px 22px 32px;">${para(greeting)}${para(e(C.intro))}${para(`${e(C.stopping.lead)} <strong>${e(countdown.stops)}</strong> ${e(C.stopping.rest)}`)}<p style="margin:0 0 24px 0;font-family:${FONT};font-size:14px;line-height:1.65;color:${K.muted};">${e(C.everyDay)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${K.action}" style="margin:0 0 18px 0;background-color:${K.action};border-radius:18px;border-collapse:separate;"><tr><td style="padding:22px 24px;font-family:${FONT};">${label(`⚠️&nbsp; ${e(C.action.label)}`, '0 0 8px 0')}<div style="font-size:19px;line-height:1.45;font-weight:800;color:${K.text};">${e(C.action.lead)} <span style="color:${K.accent};">${e(C.action.accent)}</span> ${e(C.action.rest)}</div><div style="font-size:15px;line-height:1.55;font-weight:700;color:${K.text};margin:14px 0 0 0;">${e(C.warning)}</div></td></tr></table><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 14px 0;"><tr><td valign="middle" style="font-size:18px;line-height:1;padding:0 10px 0 0;">✅</td><td valign="middle" style="font-family:${FONT};font-size:18px;line-height:1.3;font-weight:800;color:${K.text};">${e(C.stepsTitle)}</td></tr></table>${steps}<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="border-collapse:separate;margin:4px auto 8px auto;"><tr><td align="center" valign="middle" bgcolor="${K.accent}" style="border-radius:999px;background-color:${K.accent};background-image:${K.gradient};"><a href="${link}" target="_blank" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:16px;font-weight:800;line-height:1.2;color:${K.page};text-decoration:none;border-radius:999px;">${e(C.button)} &nbsp;→</a></td></tr></table><p style="margin:0 0 32px 0;text-align:center;font-family:${FONT};font-size:12px;line-height:1.5;color:${K.muted};word-break:break-all;">${a(link)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${K.notice}" style="margin:0 0 26px 0;background-color:${K.notice};border-radius:18px;border-collapse:separate;"><tr><td valign="top" width="66" style="padding:20px 0 20px 20px;">${tile('🚫', 46, K.page)}</td><td valign="top" style="padding:18px 20px 20px 8px;font-family:${FONT};"><div style="font-size:17px;line-height:1.35;font-weight:800;color:${K.violet};margin:0 0 6px 0;">${e(C.whatsapp.title)}</div><div style="font-size:14px;line-height:1.6;color:${K.text};margin:0;">${e(C.whatsapp.text)}</div></td></tr></table>${extras}${para(e(C.thanks))}<p style="margin:0 0 8px 0;font-family:${FONT};font-size:15px;line-height:1.65;color:${K.text};">${e(C.signOff)}<br><strong>${e(C.signature)}</strong></p></td></tr>
<tr><td class="thc-pad" bgcolor="${K.footer}" align="center" style="padding:18px 32px 20px 32px;background-color:${K.footer};border-radius:0 0 22px 22px;font-family:${FONT};font-size:11px;line-height:1.7;color:${K.muted};text-align:center;">${senderHtml}<br><a href="https://www.thehospitalitycompany.co.uk" target="_blank" style="color:${K.muted};text-decoration:none;">www.thehospitalitycompany.co.uk</a><br>Registered Company in England and Wales 12411407</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;
}
