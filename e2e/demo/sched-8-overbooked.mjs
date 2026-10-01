// Scheduling video, part 8: a role shrinks and more people are confirmed than needed.
// Run after sched-4-headcount.mjs (Host now needs 1, three confirmed).
// Presses Withdraw on two bookings. Reset with sched-reset.sql.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';
import { EVENT } from './sched-lib.mjs';

const s = await start('sched-8-overbooked');
const { page } = s;

await card(s, 'When a role shrinks', 'What happens to the people already confirmed', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'The awards night host role was cut to one person the day before. Three have confirmed');
await go(s, 'office', `/events/${EVENT.awards}`);
await soft('header', async () => {
  await point(s, page.getByText(/confirmed ·/).first());
  await sleep(1600);
});
await say(s, 'The system does not remove anyone for you. Everyone who confirmed is still booked, still counted, and still expecting to work', 6600);
await say(s, 'That is deliberate. Dropping a worker the night before is a decision for a person, not a rule', 5000);

await say(s, 'You decide who stays. Common choices: keep the people who confirmed first, or the ones the client knows and likes', 6000);
await soft('lines', async () => {
  await point(s, page.getByText(/confirmed 1\d:\d\d/).first());
  await sleep(1200);
});
await say(s, 'To release someone, press Withdraw on their line', 3400);
await soft('withdraw 1', async () => {
  await press(s, page.getByRole('button', { name: 'Withdraw', exact: true }).last(), { after: 2600 });
});
await say(s, 'They get a push saying they have been removed from the shift, and their line disappears', 4800);
await soft('withdraw 2', async () => {
  await press(s, page.getByRole('button', { name: 'Withdraw', exact: true }).last(), { after: 2600 });
});
await say(s, 'Withdraw the second one the same way. The role is now exactly full', 4000);

await say(s, 'Withdrawing someone releases the slot, and auto-assign may fill it again. Here the role is full, so nothing changes', 5600);
await say(s, 'If the cut is small, you may choose to leave the extra person where they are. Overbooking is what the buffer is for. Anyone who does not turn up is covered', 7600);
await say(s, 'A withdrawn worker can be invited again by hand later. Auto-assign will not invite them again for that event', 5600);
await hush(s);
await card(s, 'That is the whole scheduling cycle', 'Build, book, change, confirm, send', 2400);
await finish(s);
