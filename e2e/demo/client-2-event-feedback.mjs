// Client Portal, part 2: the event page and the feedback popup. Nothing is
// submitted: the popup is filled in and cancelled.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start, type } from './lib.mjs';

const LUNCH = '70000000-0000-4000-8000-000000000001';
const s = await start('client-2-event-feedback');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'One event, and your feedback', 'Client Portal · part 2', 2600);
await login(s, 'client', 'marco@leonardo-stpauls.example');
await say(s, 'Open an event with Details');
await go(s, 'client', `/client/events/${LUNCH}`, { wait: 1500 });
await settle();

await say(s, 'The event page shows the venue, the date, the event window and who is staffing it', 4600);
await soft('header', async () => {
  await point(s, page.getByText(/arrived/).first());
  await sleep(1400);
});
await say(s, 'Add to calendar puts the event in your own calendar. Download gives you the Allocation Timesheet as a P D F', 5600);
await soft('buttons', async () => {
  await point(s, page.getByRole('button', { name: /Add to calendar/ }).or(page.getByRole('link', { name: /Add to calendar/ })));
  await sleep(1500);
});
await say(s, 'Your on-site contact is the person the staff report to on the day', 4000);
await soft('contact', async () => {
  await point(s, page.getByText('Your on-site contact').first());
  await sleep(1400);
});

await say(s, 'Below, each role has its own times and its confirmed line-up, with a live count of who has arrived', 5600);
await scroll(s, 420, { pause: 800 });
await soft('role', async () => {
  await point(s, page.getByText(/of 4 arrived/).first());
  await sleep(1600);
});
await say(s, 'Times are UK time. A role that runs past midnight is marked plus one day', 4200);

await say(s, 'Once the event has started, you can leave feedback on each person. Press Leave feedback next to a name', 5400);
await soft('open', async () => {
  await press(s, page.getByRole('button', { name: 'Leave feedback' }).first(), { after: 1400 });
});
await say(s, 'Tap a star, one to five. A rating is required', 3600);
await soft('stars', async () => {
  await press(s, page.getByRole('radio', { name: '5 stars' }), { after: 1200 });
});
await say(s, 'A comment is optional. It is seen by the office, never by the worker', 4200);
await soft('comment', async () => {
  await type(s, page.getByRole('dialog').locator('textarea'), 'Calm, quick and well presented. Guests noticed.');
  await sleep(800);
});
await say(s, 'Once you submit, feedback cannot be edited or withdrawn. If something needs correcting, contact the office', 6000);
await say(s, 'Your rating feeds the worker’s score, once the office has read it. For this demonstration we cancel instead of submitting', 6200);
await soft('cancel', async () => {
  await press(s, page.getByRole('button', { name: 'Cancel' }), { after: 1400 });
});
await hush(s);
await card(s, 'Next: timesheets and your account', 'Client Portal · part 3', 2400);
await finish(s);
