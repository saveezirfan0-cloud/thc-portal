// gov.uk right-to-work check, part 1: the worker's side, on the phone.
// Opens the share-code form but never submits it: every real submission is a live
// check with gov.uk.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';

const s = await start('gov-1-worker', { kind: 'mobile' });
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'Right to work and expiry dates', 'The worker’s side', 2600);
await login(s, 'staff', 'amara.kalu@example.com');
await settle();

await say(s, 'Every worker keeps their documents in the app, under Profile, then Documents');
await go(s, 'staff', '/documents', { wait: 1800 });
await say(s, 'Each document shows its state. Verified, with its expiry date, or missing, with an Upload button', 6400);
await scroll(s, 300, { pause: 600 });
await soft('visa', async () => {
  await point(s, page.getByText('Visa document').first());
  await sleep(1400);
});
await say(s, 'Amara’s visa is verified, and expires on the thirteenth of December. Her reminders are already scheduled', 6400);
await soft('term', async () => {
  await point(s, page.getByText('University Term Dates Letter').first());
  await sleep(1400);
});
await say(s, 'A student’s term dates letter always expires on the thirty-first of December, whatever dates are printed on it, and reminders start on the first', 8400);
await soft('missing', async () => {
  await point(s, page.getByText('Missing').first());
  await sleep(1400);
});
await say(s, 'A missing document shows Upload. Nothing can be skipped', 4000);

await say(s, 'Anyone who is not a British or Irish citizen proves their right to work with a share code from gov.uk. The worker enters it in the app. The office never types it');
await go(s, 'staff', '/documents/upload/share_code_report', { wait: 1800 });
await say(s, 'The code comes from gov.uk. Nine letters and numbers, starting with W. Capital letters or not, with or without spaces', 8200);
await soft('code', async () => {
  await point(s, page.getByText(/9 letters and numbers/).first());
  await sleep(1400);
});
await say(s, 'The worker also confirms their date of birth. It must match the one gov.uk holds, or gov.uk will not recognise the code', 7600);
await soft('dob', async () => {
  await point(s, page.getByText('Date of birth').first());
  await sleep(1400);
});
await scroll(s, 360, { pause: 600 });
await say(s, 'Below, the app explains what happens next. We check it with gov.uk straight away, and the office confirms the result', 7600);
await soft('next', async () => {
  await point(s, page.getByText('What happens next').first());
  await sleep(1400);
});
await say(s, 'Nothing changes on the account until the office has confirmed it. Meanwhile their current right to work keeps counting', 7600);
await say(s, 'We do not send a code in this demonstration, because every real one is a live check with gov.uk', 6400);
await hush(s);
await card(s, 'Next: the automatic check', 'Right to work and expiry dates · part 2', 2400);
await finish(s);
