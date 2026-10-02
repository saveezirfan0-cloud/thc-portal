// gov.uk right-to-work check, part 3: Verify / Reject. Set DRY=1 to rehearse without
// pressing the final Verify (which changes the demo data and cannot be undone).
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start, tab } from './lib.mjs';

const s = await start('gov-3-decide');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});
const row = (name) => page.locator('tr').filter({ hasText: name }).filter({ hasText: 'share code' }).first();

await card(s, 'Verify or Reject', 'Completing the check, with the expiry date', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'A result that has come back lands in Needs review, with the others waiting for a person');
await go(s, 'office', '/compliance', { wait: 2000 });
await settle();
await say(s, 'The first line says it is an automatic gov.uk check, and what it recommends', 5400);
await soft('tomas', async () => {
  await point(s, row('Tomas Silva'));
  await sleep(1200);
});
await say(s, 'For Tomas, the check says: right to work until the thirtieth of September 2027, and the conditions that come with it', 8000);
await soft('until', async () => {
  await point(s, page.getByText(/Right to work until/).first());
  await sleep(1600);
});
await say(s, 'That date is the expiry used for reminders. Nobody types it. It comes straight from gov.uk', 6600);
await soft('conditions', async () => {
  await point(s, page.getByText(/limited to 20 hours/).first());
  await sleep(1400);
});
await say(s, 'The conditions are shown too. Here the visa limits work to twenty hours a week in term time', 6000);
await soft('photos', async () => {
  await point(s, page.getByText('Compare the photos before you verify').first());
  await sleep(1600);
});
await say(s, 'Before you verify, compare the photo on the gov.uk report with the worker’s selfie in the app. That is the human check', 8000);
await soft('report', async () => {
  await point(s, page.getByRole('button', { name: /Download gov\.uk report/ }).first());
  await sleep(1200);
});
await say(s, 'The full gov.uk report is stored on the profile, and can be downloaded', 5000);

await say(s, 'If the match is good, press Verify');
await soft('verify open', async () => {
  await press(s, row('Tomas Silva').getByRole('button', { name: 'Verify', exact: true }), { after: 1600 });
});
await say(s, 'The dialog repeats the date. It is confirmed as it is, not typed. It becomes the expiry used for reminders, and the last day the worker can be rostered', 10000);
await say(s, 'Because this is a student, you also say whether the course is below degree level. That sets the term-time limit at ten hours instead of twenty', 9000);
if (process.env.DRY) {
  await soft('cancel', async () => {
    await press(s, page.getByRole('button', { name: 'Cancel' }), { after: 1000 });
  });
} else {
  await soft('confirm', async () => {
    await press(s, page.getByRole('dialog').getByRole('button', { name: 'Verify', exact: true }), { after: 2600 });
  });
  await settle();
  await say(s, 'Verified. The document is accepted, the date is stored, and Tomas moves one step closer to working', 6200);
}

await say(s, 'Now Dimitri, where gov.uk found no record');
await soft('dimitri', async () => {
  await point(s, row('Dimitri Popescu'));
  await sleep(1200);
});
await say(s, 'This share code and date of birth did not match anyone. The check does not reject it by itself. It recommends Reject', 8000);
await soft('reject open', async () => {
  await press(s, row('Dimitri Popescu').getByRole('button', { name: 'Reject', exact: true }), { after: 1600 });
});
await say(s, 'The reason box is filled in for you. It goes to the worker word for word, as a push, with a Re-upload button. You can edit it first', 9400);
await say(s, 'A wrong code, or a date of birth that is slightly off, is the usual cause. The worker simply enters it again, and a fresh check runs', 8000);
await soft('cancel reject', async () => {
  await press(s, page.getByRole('button', { name: 'Cancel' }), { after: 1200 });
});
await say(s, 'We cancel here. In real use, you would press Reject document', 4000);
await say(s, 'And if gov.uk ever says someone has no right to work, the check shows the report and recommends Reject. Never roster them on that evidence', 8600);
await hush(s);
await card(s, 'Next: expiry, reminders and blocking', 'Right to work and expiry dates · part 4', 2400);
await finish(s);
