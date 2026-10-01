// Client Portal, part 1: signing in and the events list. Read-only.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start, tab } from './lib.mjs';

const s = await start('client-1-events');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'Client Portal', '1 · Signing in and your events', 2600);
await say(s, 'The Client Portal is for our customers. It shows who is working your events, and nothing about pay or charges');
await login(s, 'client', 'marco@leonardo-stpauls.example');
await settle();

await say(s, 'You sign in with the email and password from your invitation. Forgot it? Use the link on the sign-in page', 5600);
await say(s, 'This is Your events. It lists everything we are staffing for your company, and it is read-only', 5000);
await soft('next up', async () => {
  await point(s, page.getByText(/Happening now/).first());
  await sleep(1200);
});
await say(s, 'The strip at the top shows what is happening now, or what is next, with how many people are confirmed', 5200);

await say(s, 'Use the tabs for Upcoming, Past or All');
await soft('tabs', async () => {
  await press(s, tab(s, /^Past/), { after: 1800 });
  await press(s, tab(s, /^Upcoming/), { after: 1600 });
});
await say(s, 'Filter by venue, or by a From and To date', 3600);
await soft('dates', async () => {
  await point(s, page.getByText('From (UK date)').first());
  await sleep(1600);
});

await say(s, 'Each row is one event: the venue, the date and time in UK time, its status, and the PO number you gave us', 5600);
await soft('row', async () => {
  await scroll(s, 220, { pause: 500 });
  await point(s, page.getByText(/PO 4471-A/).first());
  await sleep(1400);
});
await say(s, 'The Confirmed column shows how full each role is. Only workers who have confirmed count', 5000);
await soft('line-up', async () => {
  await point(s, page.getByText(/Waiting Staff 0\/12/).first());
  await sleep(1600);
});
await say(s, 'While an event is on, it also shows how many people have arrived on site', 4400);
await soft('arrived', async () => {
  await point(s, page.getByText(/of 7 arrived/).first());
  await sleep(1800);
});
await say(s, 'Download the Allocation Timesheet for any event from the last column, or open Details', 5000);
await soft('timesheet', async () => {
  await point(s, page.getByRole('button', { name: /Allocation Timesheet/ }).first());
  await sleep(1800);
});
await hush(s);
await card(s, 'Next: one event, and leaving feedback', 'Client Portal · part 2', 2400);
await finish(s);
