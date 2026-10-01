// Scheduling video, part 2: the ways staff get booked onto an event.
// Presses Invite once (Summer Reception, built by part 1); opens Accept application and cancels.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';
import { EVENT, summerEvent } from './sched-lib.mjs';

const SUMMER = await summerEvent();

const s = await start('sched-2-booking-options');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'How staff get booked on', 'Four ways onto an event', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'There are four ways a worker ends up on an event. First, and most common: auto-assign');
await go(s, 'office', `/events/${EVENT.marquee}`);
await say(s, 'This is the Wedding marquee. Nobody here was invited by hand', 3200);
await soft('invited', async () => {
  await scroll(s, 520, { pause: 400 });
  await point(s, page.getByText(/Invited · awaiting response/).first());
  await sleep(1200);
});
await say(
  s,
  'Auto-assign sends invitations on its own, every hour, to the best-scored workers. The word auto on each line shows where the invitation came from',
  6600,
);
await say(s, 'An invitation has no deadline. The worker accepts in the app, and only then do they appear as Confirmed', 5400);

await say(s, 'Second: invite people yourself. This is the summer reception we just built. Auto-assign sent its first round, and more people are still waiting in the pool');
await go(s, 'office', `/events/${SUMMER}`);
await say(s, 'The Potential pool lists every eligible worker not yet invited, ranked. You can invite from it whether auto-assign is on or off', 6000);
await soft('pool', async () => {
  await scroll(s, 420, { pause: 500 });
  await point(s, page.getByText(/Potential pool/).first());
  await sleep(1400);
});
await say(s, 'Search by name, or filter by whether they applied. Press Invite next to the person you want', 4400);
await soft('invite', async () => {
  await press(s, page.getByRole('button', { name: /^Invite \S/ }), { after: 2800 });
});
await say(s, 'They now sit under Invited, and get a push notification straight away. Every rule is checked again at the moment you press', 5400);
await soft('invited row', async () => {
  await point(s, page.getByText(/Invited · awaiting response/).first());
  await sleep(1400);
});

await say(s, 'Third: workers can apply themselves, from Radar in the Staff App. Back on the summer reception');
await go(s, 'office', `/events/${SUMMER}`);
await soft('applied', async () => {
  await scroll(s, 900, { pause: 500 });
  await press(s, page.getByRole('button', { name: /^Applied/ }).first(), { after: 1400 });
});
await say(s, 'A worker who applied carries an Applied marker with how long ago. Filter the pool by Applied to find them', 5600);
await soft('accept', async () => {
  const accept = page.getByRole('button', { name: /^Accept application/ });
  await press(s, accept, { after: 1600 });
});
await say(s, 'Accept application books them and tells them. Workers who applied and were not needed are told the role filled', 6000);
await soft('cancel', async () => {
  await press(s, page.getByRole('button', { name: 'Cancel', exact: true }), { after: 1200 });
});

await say(s, 'Fourth: a worker can hand their shift to a colleague. The office sees it as a chip on the booking and can open it to the pool', 6000);
await say(s, 'Whichever way they arrive, a worker only counts toward the fill once they have confirmed', 4200);
await hush(s);
await card(s, 'Next: changing the time', 'Scheduling · part 3', 2400);
await finish(s);
