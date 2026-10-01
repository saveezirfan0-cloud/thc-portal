// Scheduling video, part 6 (closing): the office sees the tick. Read-only.
import { card, finish, go, hush, login, point, say, scroll, sleep, soft, start } from './lib.mjs';
import { EVENT } from './sched-lib.mjs';

const s = await start('sched-6c-office-sees-ready');
const { page } = s;

await card(s, 'How the office knows', 'The board updates the moment the worker presses', 2400);
await login(s, 'office', 'gisela@thehospitalitycompany.example');
await go(s, 'office', `/events/${EVENT.gala}`);
await say(s, 'Back on the gala dinner board, Amara’s line has changed from not yet to a tick, with the time she pressed it', 5600);
await soft('tick', async () => {
  await scroll(s, 1500, { pause: 400 });
  await point(s, page.getByText(/I'm ready ✓/).first());
  await sleep(1800);
});
await say(s, 'Everyone else is still waiting. That is the list to chase before twelve noon', 4400);
await hush(s);
await card(s, 'Next: how auto-assign works', 'Scheduling · part 7', 2400);
await finish(s);
