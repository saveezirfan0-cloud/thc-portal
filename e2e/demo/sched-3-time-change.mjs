// Scheduling video, part 3: a time change re-confirms everyone booked on that role.
// Moves Awards Night · Host from 17:00 to 17:30 (UK). Reset with sched-reset.sql.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';
import { EVENT, setValue } from './sched-lib.mjs';

const s = await start('sched-3-time-change');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'Changing the time', 'What happens to staff who have already confirmed', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'The client has moved the awards night host start by half an hour. Open the event and press Edit');
await go(s, 'office', `/events/${EVENT.awards}`);
await soft('before', async () => {
  await point(s, page.getByText(/Host/).first());
  await sleep(900);
});
await say(s, 'Three hosts have confirmed. Nothing is wrong on the board right now', 3200);
await press(s, page.getByRole('link', { name: 'Edit', exact: true }), { after: 1800 });
await settle();

await say(s, 'Each role has its own times, so change only the host role’s start', 3400);
await soft('start', async () => {
  await scroll(s, 640, { pause: 500 });
  await setValue(s, page.getByLabel('Start (UK time)', { exact: true }).nth(0), '17:30');
});
await say(s, 'The form warns you before you save: confirmed workers will be asked to confirm again', 4200);
await soft('warn', async () => {
  await point(s, page.getByText(/re-confirm/i).first());
  await sleep(1800);
});
await soft('panel', async () => {
  await scroll(s, 900, { pause: 500 });
  await point(s, page.getByText('What triggers re-confirmation').first());
  await sleep(600);
});
await say(
  s,
  'These changes ask everyone on the role to confirm again: start or end time, the date, the venue address and the dress code',
  6200,
);
await say(s, 'These do not: headcount, buffer, rates, the P O number and notes. Those are applied quietly', 5000);
await say(s, 'Save the event');
await soft('save', async () => {
  await press(s, page.getByRole('button', { name: 'Save event' }), { after: 3500 });
});
await settle();
await go(s, 'office', `/events/${EVENT.awards}`);
await say(s, 'On the board, every confirmed host now shows Awaiting re-confirm. They are still counted, and still booked', 5600);
await soft('pills', async () => {
  await point(s, page.getByText('Awaiting re-confirm').first());
  await sleep(1400);
});
await say(s, 'Each worker received a notification, and their shift in the app says Time changed, with a button to confirm the new time', 6200);
await say(s, 'As each one confirms, their marker disappears. A worker who cannot do the new time can still cancel, while more than seventy-two hours remain. Closer than that, they contact the office', 6200);
await hush(s);
await card(s, 'Next: the worker’s side of a change', 'Scheduling · part 3 continued', 2400);
await finish(s);
