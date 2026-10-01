// Client Portal, part 3: the timesheet and Your account. Nothing is changed.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start, tab } from './lib.mjs';

const s = await start('client-3-timesheet-account');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'Timesheets and your account', 'Client Portal · part 3', 2600);
await login(s, 'client', 'marco@leonardo-stpauls.example');
await settle();

await say(s, 'Every event has one timesheet: a single P D F for the whole event, with every role in it');
await soft('document', async () => {
  await point(s, page.getByRole('button', { name: /Allocation Timesheet/ }).first());
  await sleep(1400);
});
await say(s, 'Before the event it is the Allocation Timesheet: who is coming, with their photo, role and start time', 5600);
await say(s, 'Our team emails it to you the day before. You can also download it here whenever you like', 5000);
await say(s, 'After the event the Completed Timesheet replaces it, with finish times and hours filled in from check-in and check-out', 6200);
await say(s, 'Print it for the day, and have your manager sign it. The signature is always made by hand', 5000);
await soft('past', async () => {
  await press(s, tab(s, /^Past/), { after: 1800 });
  await point(s, page.getByText(/Completed Timesheet|Timesheet not issued yet/).first());
  await sleep(1600);
});
await say(s, 'Until a completed timesheet is issued, the row says so', 3600);

await say(s, 'Open Account from the menu at the top');
await press(s, page.getByRole('link', { name: 'Account', exact: true }), { after: 1600 });
await settle();
await say(s, 'Your account shows who is signed in, and your company', 4000);
await soft('details', async () => {
  await point(s, page.getByText('Sign-in email').first());
  await sleep(1400);
});
await say(s, 'These are the addresses your timesheets are emailed to. We set them up for you, so they cannot be edited here', 6000);
await soft('recipients', async () => {
  await point(s, page.getByText('Timesheet emails go to').first());
  await sleep(1800);
});
await scroll(s, 420, { pause: 700 });
await say(s, 'You can change your password here. It must be at least ten characters and contain a number', 5400);
await soft('password', async () => {
  await point(s, page.getByLabel('New password').first());
  await sleep(1400);
});
await say(s, 'Saving signs you out of every other device', 3400);
await say(s, 'Need anything changed? Email the office and we will update it for you', 4400);
await soft('email', async () => {
  await point(s, page.getByRole('link', { name: 'Email the office' }));
  await sleep(1600);
});
await say(s, 'You can switch between light and dark display with the toggle at the top', 4400);
await hush(s);
await card(s, 'That is the Client Portal', 'Events, line-ups, feedback and timesheets', 2600);
await finish(s);
