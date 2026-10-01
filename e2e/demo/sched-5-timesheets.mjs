// Scheduling video, part 5: the allocation timesheet. Opens Send and says
// "Not now": nothing is sent.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';
import { EVENT } from './sched-lib.mjs';

const s = await start('sched-5-timesheets');
const { page } = s;

await card(s, 'How timesheets are sent', 'The Allocation Timesheet', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'Every event has one timesheet: a single P D F for the whole event, all roles together');
await go(s, 'office', `/events/${EVENT.gala}`);
await say(s, 'It lists each worker with their photo, name, role and start time. The client signs it on site', 4800);
await soft('buttons', async () => {
  await point(s, page.getByRole('button', { name: 'Send Allocation Timesheet' }));
  await sleep(1200);
});
await say(s, 'Send Allocation Timesheet emails it. Download gives you the P D F to drop into WhatsApp', 5000);
await soft('download', async () => {
  await point(s, page.getByRole('link', { name: 'Download Allocation Timesheet' }));
  await sleep(1400);
});

await say(s, 'You never have to remember. It goes out by itself, the day before at two in the afternoon', 5000);
await soft('hint', async () => {
  await point(s, page.getByText(/Sent automatically/).first());
  await sleep(2000);
});
await say(s, 'After the event, the Completed Timesheet goes out the next morning at ten, filled in from check-in and check-out', 6000);

await say(s, 'To send one yourself at any time, press Send. It shows who it goes to before anything leaves');
await soft('send', async () => {
  await press(s, page.getByRole('button', { name: 'Send Allocation Timesheet' }), { after: 1800 });
});
await say(s, 'It goes from the timesheets address to every contact on the client card. There can be several', 5400);
await soft('not now', async () => {
  await press(s, page.getByRole('button', { name: 'Not now' }), { after: 1200 });
});
await say(s, 'This time we press Not now, so nothing is sent. Cancelled events never produce a timesheet', 4800);
await hush(s);
await card(s, 'Next: confirming shifts', 'Scheduling · part 6', 2400);
await finish(s);
