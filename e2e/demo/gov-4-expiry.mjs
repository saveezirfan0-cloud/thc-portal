// gov.uk right-to-work check, part 4: expiry dates, reminders and the automatic block.
// Read-only.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start, tab } from './lib.mjs';

const s = await start('gov-4-expiry');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'Expiry dates, reminders and blocking', 'What happens as a right to work runs out', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'The date gov.uk returns is the expiry date for that worker. Everything else follows from it');
await go(s, 'office', '/compliance', { wait: 1800 });
await soft('tab', async () => {
  await press(s, tab(s, /^Radar/), { after: 1800 });
});
await settle();
await say(s, 'The Radar tab shows what is running out. Expired documents block the worker, and expiring ones are the next thirty days', 8200);
await soft('counters', async () => {
  await point(s, page.getByText(/Expired · blocking/).first());
  await sleep(1000);
  await point(s, page.getByText(/Expiring · ≤ 30 days/).first());
  await sleep(1200);
});
await say(s, 'Term letters are counted separately, because they always expire on the thirty-first of December', 6400);
await soft('terms', async () => {
  await point(s, page.getByText(/Term letters/).first());
  await sleep(1200);
});

await scroll(s, 360, { pause: 600 });
await say(s, 'Each row shows who, which document, its expiry date, the days left and its status', 6000);
await soft('expiring', async () => {
  await point(s, page.locator('tr').filter({ hasText: 'Nadia Haddad' }).first());
  await sleep(1400);
});
await say(s, 'Nadia’s visa has twelve days left. She is marked Expiring, and her reminders are going out', 7000);
await soft('reminders', async () => {
  await point(s, page.getByText('Reminders sent').first());
  await sleep(1200);
});
await say(s, 'The reminders go to the worker’s phone, by themselves. A month before, two weeks before, a week before, and on the day. There is no Send reminder button, because nobody needs to press anything', 12000);
await soft('expired', async () => {
  await point(s, page.locator('tr').filter({ hasText: 'Jonah Whitfield' }).first());
  await sleep(1400);
});
await say(s, 'Jonah’s passport expired nineteen days ago. He was blocked automatically on the day, and he has uploaded nothing since', 8200);

await scroll(s, 420, { pause: 600 });
await say(s, 'This is the ladder the workers receive. It is also written at the foot of the page', 5600);
await soft('ladder', async () => {
  await point(s, page.getByText(/Reminder ladder/).first());
  await sleep(1600);
});

await card(s, 'On the expiry day, automatically', 'The worker is blocked · future shifts are released · open invitations are withdrawn · they leave auto-assign · their app locks to Documents', 3200, {
  speech: 'On the day a document expires, the system does five things by itself. It blocks the worker. It releases their future shifts, so auto-assign finds replacements. It withdraws their open invitations. It takes them out of auto-assign. And it locks their app, so they can log in but see only Documents.',
});
await card(s, 'Getting unblocked', 'The worker uploads a new document · the office verifies it · the system re-checks everything · then it unblocks them', 3200, {
  speech: 'To get unblocked, the worker uploads a new document, and the office verifies it. The system then re-checks their whole record, not just that one document. Only when every document is verified and in date does it unblock them, by itself. Shifts they lost are not given back.',
});
await hush(s);
await card(s, 'That is the gov.uk check and expiry', 'Share code, automatic check, verify, reminders and blocking', 2800);
await finish(s);
