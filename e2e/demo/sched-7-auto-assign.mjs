// Scheduling video, part 7: how auto-assign decides. Read-only.
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';
import { summerEvent } from './sched-lib.mjs';

const SUMMER = await summerEvent();

const s = await start('sched-7-auto-assign');
const { page } = s;

await card(s, 'How auto-assign works', 'Who is invited, in what order, and when', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'Auto-assign fills each role for you. It runs every hour, and invites people in batches');
await go(s, 'office', `/events/${SUMMER}`);
await soft('pool', async () => {
  await scroll(s, 420, { pause: 500 });
  await point(s, page.getByText(/Potential pool/).first());
  await sleep(900);
});
await say(s, 'The Potential pool on every role is what auto-assign works from. The numbers on the left are its order', 5000);

await say(s, 'First it removes anyone who cannot work the shift. Wrong role, blocked, already booked elsewhere, too close to another venue, over the hours limit, or someone who cancelled this event', 8800);
await say(s, 'Those people never appear in the pool at all. Look under Unavailable to see who was left out, and why', 5400);
await soft('unavailable', async () => {
  await point(s, page.getByText(/^Unavailable/).first());
  await sleep(1200);
});

await say(s, 'Then it ranks everyone who is left. Wave one is workers qualified for this client and role. Wave two is everyone else', 7000);
await soft('wave', async () => {
  await scroll(s, -200, { pause: 400 });
  await point(s, page.locator('.wave-break, .rank').first());
  await sleep(1400);
});
await say(s, 'Wave one is used up before anybody in wave two is invited, however high they score', 5000);

await say(s, 'Within a wave, each person gets a score out of one hundred', 3600);
await soft('legend', async () => {
  await point(s, page.getByText(/^Score =/).first());
  await sleep(600);
});
await say(s, 'Thirty percent their show rate. Twenty-five percent client rating. Twenty-five percent how close they live. Ten percent fair rotation, favouring people with fewer shifts. And ten percent history at this venue', 11000);
await soft('hover', async () => {
  const tip = page.locator('.score-tip').first();
  await point(s, tip);
  await tip.hover();
  await sleep(2600);
});
await say(s, 'Hover over any score to see exactly how it was made up', 3800);

await say(s, 'Each round invites as many people as the allocation per hour, usually the headcount plus the buffer. Rounds are additive. Invitations are never withdrawn by auto-assign', 8400);
await soft('toggle', async () => {
  await scroll(s, -1200, { pause: 400 });
  await point(s, page.getByText(/Auto-assign · event level/).first());
  await sleep(1400);
});
await say(s, 'The event switch is off here, which is why no further rounds will run for it. Switch auto-assign off for a whole event, or for one role, and no round runs. Both switches must be on', 8000);

await say(s, 'The weights are not fixed. They live in Settings, and a change applies from the next round', 5000);
await go(s, 'office', '/settings');
await soft('weights', async () => {
  await point(s, page.getByText('Auto-assign scoring weights').first());
  await sleep(1600);
});
await say(s, 'Qualification is never a weight. It is an ordering, so a nearby worker can never jump ahead of a qualified one', 5600);

await say(s, 'Once a shift has started and is still short, auto-assign switches to escalation. Every ten minutes it invites the nearest workers, within a few miles', 7400);
await hush(s);
await card(s, 'Next: when a role shrinks', 'Scheduling · part 8', 2400);
await finish(s);
