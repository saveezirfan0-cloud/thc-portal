// Timesheets, part 2: sending. The Send dialog is opened and cancelled: nothing is sent.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';

const GALA = '60000000-0000-4000-8000-000000000001';
const CANCELLED = '60000000-0000-4000-8000-000000000004';
const s = await start('ts-2-sending');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'Sending timesheets', 'By hand, and automatically', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'To send a timesheet yourself, open the event and press Send Allocation Timesheet');
await go(s, 'office', `/events/${GALA}`, { wait: 1800 });
await soft('send', async () => {
  await press(s, page.getByRole('button', { name: 'Send Allocation Timesheet' }), { after: 1600 });
});
await say(s, 'Before anything leaves, it says what will happen. A fresh P D F, with the P O number on it, goes from the timesheets address to every contact email on the client card', 9400);
await say(s, 'There is no time limit. You can send it, or download it, at any point, even in the middle of the event', 6200);
await soft('not now', async () => {
  await press(s, page.getByRole('button', { name: 'Not now' }), { after: 1200 });
});
await say(s, 'We press Not now here, so nothing is sent in this demonstration', 4000);

await say(s, 'The addresses come from the client. Open the client card');
await go(s, 'office', '/clients/40000000-0000-4000-8000-000000000001', { wait: 1800 });
await soft('emails', async () => {
  await point(s, page.getByText('Allocation emails').first());
  await sleep(1600);
});
await say(s, 'Allocation emails lists everyone who should receive it. A client can have several, such as a manager and an operations desk', 7600);

await say(s, 'The sender is a fixed timesheets address, chosen in Settings under Sender addresses');
await go(s, 'office', '/settings', { wait: 1800 });
await soft('senders', async () => {
  await point(s, page.getByText('Sender addresses').first());
  await sleep(1800);
});
await say(s, 'Timesheets use their own sender, and send nothing else, so replies from the client land in the right place', 7400);

await say(s, 'You do not have to remember to send. The system sends it for you');
await go(s, 'office', `/events/${GALA}`, { wait: 1800 });
await soft('hint', async () => {
  await point(s, page.getByText(/Sent automatically/).first());
  await sleep(1800);
});
await say(s, 'The Allocation Timesheet goes out the day before the event at two in the afternoon, UK time. That is after the twelve o’clock I’m ready deadline, so it lists the people who are really coming', 11000);
await say(s, 'An event that is built or filled late still gets one, before its first shift starts', 5200);
await say(s, 'Send one by hand that morning, and the automatic one is skipped, so nothing goes twice', 5200);

await say(s, 'Two cases never produce a timesheet. A cancelled event, and an event with nobody confirmed', 6000);
await go(s, 'office', `/events/${CANCELLED}`, { wait: 1800 });
await soft('cancelled', async () => {
  await point(s, page.getByText(/This event is cancelled/).first());
  await sleep(1600);
});
await say(s, 'A cancelled event shows no timesheet buttons at all', 4200);
await hush(s);
await card(s, 'Next: the Completed Timesheet', 'Timesheets · part 3', 2400);
await finish(s);
