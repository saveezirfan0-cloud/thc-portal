// Timesheets, part 4: the client's side. Read-only. Needs a sent Allocation Timesheet
// for Rooftop Reception (the Back Office sends it on its own; or send it by hand first).
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start, tab } from './lib.mjs';

const s = await start('ts-4-client');
const { page } = s;
const settle = () => page.waitForLoadState('networkidle').catch(() => {});

await card(s, 'The client’s side', 'Timesheets in the Client Portal', 2600);
await login(s, 'client', 'sophie@mo-hydepark.example');
await settle();

await say(s, 'This is Sophie at Mandarin Oriental, signed in to the Client Portal');
await say(s, 'Every event in her list has a timesheet button in the last column', 4800);
await soft('button', async () => {
  await point(s, page.getByRole('button', { name: /Allocation Timesheet/ }).first());
  await sleep(1600);
});
await say(s, 'Once the office has issued the Allocation Timesheet, the client downloads it from here', 5600);
await say(s, 'The same button is on the event page, beside the P O number', 4800);
await soft('event', async () => {
  await press(s, page.getByRole('link', { name: /Details/ }).last(), { after: 1800 });
});
await settle();
await soft('download', async () => {
  await point(s, page.getByRole('button', { name: /Download Allocation Timesheet/ }).or(page.getByRole('link', { name: /Download Allocation Timesheet/ })));
  await sleep(1600);
});
await say(s, 'The client always gets the latest document the office has issued. It is the copy the office issued', 7400);
await say(s, 'After the event, the Completed Timesheet takes its place here, once it has been issued. Until then the row says Timesheet not issued yet', 8600);
await say(s, 'The client prints it, has the manager sign it, and keeps it as the record of the work done', 6200);
await hush(s);
await card(s, 'That is timesheets', 'The allocation sheet, sending, the completed sheet and the client’s view', 2800);
await finish(s);
