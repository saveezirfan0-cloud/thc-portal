// Timesheets, part 3: the Completed Timesheet for a finished event. Read-only.
import path from 'node:path';
import { card, finish, go, hush, login, point, press, say, scroll, sleep, soft, start } from './lib.mjs';
import { COL, FINISH_COL_ROWS, FOOTER_LUNCH, HOURS_COL_ROWS, ROW_CHLOE, ROW_ISLA, TITLE_ROW, box, showDoc } from './doc-lib.mjs';

const DOCS = process.env.DEMO_DOCS || './out/docs';
const LUNCH = '60000000-0000-4000-8000-000000000006';
const s = await start('ts-3-completed');
const { page } = s;

await card(s, 'The Completed Timesheet', 'Filled in from check-in and check-out', 2600);
await login(s, 'office', 'gisela@thehospitalitycompany.example');

await say(s, 'After an event, the timesheet becomes the Completed Timesheet. This is the Lunch Service, which has finished');
await go(s, 'office', `/events/${LUNCH}`, { wait: 1800 });
await soft('buttons', async () => {
  await point(s, page.getByRole('button', { name: 'Send Completed Timesheet' }));
  await sleep(900);
  await point(s, page.getByRole('link', { name: 'Download Completed Timesheet' }));
  await sleep(1200);
});
await say(s, 'Once an event has started, two more buttons appear: Send Completed Timesheet and Download Completed Timesheet', 7000);

await showDoc(s, path.join(DOCS, 'completed-lunch-p1.png'));
await say(s, 'It is the same form, but now the system fills in everything from what really happened', 5400);
await box(s, FINISH_COL_ROWS);
await say(s, 'The finish time is the actual one, from each worker’s check-out', 5000);
await box(s, HOURS_COL_ROWS);
await say(s, 'Hours worked is calculated from check-in and check-out, inside the shift', 5400);
await box(s, ROW_ISLA);
await say(s, 'Isla left early, so her finish time and her hours are shorter. Four hours fifteen', 6000);
await box(s, ROW_CHLOE);
await say(s, 'Chloe never checked out. The system does not guess. Her finish time and hours are left blank, and everyone else’s are filled in as normal', 9000);
await box(s, COL.signature, 700);
await say(s, 'The signature column is still empty. The client signs it by hand', 4600);
await box(s, FOOTER_LUNCH);
await say(s, 'Total hours for the whole event is worked out at the bottom, with space for the manager’s name, signature and date', 8000);
await box(s, null, 300);

await say(s, 'To fix Chloe’s line, resolve her No check-out in the Violation log. Open Check In and Out');
await go(s, 'office', '/checkin', { wait: 2000 });
await scroll(s, 520, { pause: 700 });
await soft('violation', async () => {
  await point(s, page.getByText('No check-out').first());
  await sleep(1400);
});
await say(s, 'A manager opens Details and records the time she really left. Download the timesheet again, and her cells fill in from that time', 8400);

await say(s, 'You can send it yourself from the event page. Or leave it to the system');
await go(s, 'office', `/events/${LUNCH}`, { wait: 1800 });
await soft('hint', async () => {
  await point(s, page.getByText(/Sent automatically the morning after/).first());
  await sleep(1800);
});
await say(s, 'The Completed Timesheet goes out by itself the morning after, at ten o’clock, UK time, once every check-out window has closed', 8600);
await say(s, 'If anyone still has an unresolved No check-out, it waits, so the client never gets a sheet with a hole in it by mistake. It keeps trying for up to two weeks', 9800);
await hush(s);
await card(s, 'Next: what the client sees', 'Timesheets · part 4', 2400);
await finish(s);
