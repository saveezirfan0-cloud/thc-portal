// Video 1 of the Back Office series: sign in, the dashboard, the events list
// and calendar, the event board, and the Shift Builder (opened, not saved).
import {
  card,
  finish,
  nextFriday,
  go,
  hush,
  login,
  point,
  press,
  say,
  scroll,
  sleep,
  start,
} from './lib.mjs';

const s = await start('office-1-dashboard-and-scheduling');
const { page } = s;
const nav = (name) => page.getByRole('link', { name, exact: true }).first();

await card(s, 'Back Office Portal', '1 · Sign in, dashboard and scheduling');

await say(s, 'Staff in the office sign in with their work email and password');
await login(s, 'office', 'gisela@thehospitalitycompany.example');

// ── Dashboard ────────────────────────────────────────────────────────────
await say(s, 'The Dashboard is where the day starts. Everything is live.', 2600);
await say(s, 'Open positions: hours sold to clients that are not yet staffed', 500);
await point(s, page.getByText('Open positions').first());
await sleep(2200);
await say(s, 'On shift now: workers who have checked in and are on site this minute');
await point(s, page.getByText('On shift now').first());
await sleep(2200);
await say(s, 'Staff available: compliant workers who are not booked or blocked');
await point(s, page.getByText('Staff available').first());
await sleep(2200);
await say(s, 'Compliance blocks: workers held back because a document has lapsed');
await point(s, page.getByText('Compliance blocks').first());
await sleep(2400);

await say(s, 'Short-staffed lists every role starting in the next 48 hours that is not full');
await scroll(s, 280, { pause: 600 });
await point(s, page.getByText('Short-staffed').first());
await sleep(2600);
await say(s, 'One click opens that event’s board to fix it');
await point(s, page.getByRole('link', { name: /open board/i }).first());
await sleep(2200);

await say(
  s,
  'The financial snapshot for the week. Holiday pay is always shown separately, never blended',
);
await scroll(s, 360, { pause: 600 });
await point(s, page.getByText(/financial snapshot/i).first());
await sleep(3800);

await say(s, 'Upcoming events for the next ten days, with fill and margin per hour for each role');
await scroll(s, 420, { pause: 3600 });
await scroll(s, -1200, { pause: 600 });

// ── Scheduling: list ─────────────────────────────────────────────────────
await say(s, 'Scheduling holds every event. Open it from the menu');
await press(s, nav('Scheduling'));
await page.waitForLoadState('networkidle').catch(() => {});
await say(s, 'The list shows the event window, each role, how full it is and its status', 3200);
await say(s, 'Fill counts only confirmed workers. “6 (+1)” means 6 needed plus 1 spare, never 7');
await point(s, page.getByText(/\(\+1\)/).first());
await sleep(3800);

await say(s, 'Use the arrows to move to the next month');
await press(s, page.getByRole('link', { name: 'Next period' }), { after: 1800 });
await say(s, 'October: the upcoming events, including one that was cancelled by the client', 3600);

await say(s, 'Switch to the Calendar for a month, week or day view');
await press(s, page.getByRole('link', { name: 'Calendar', exact: true }), { after: 2000 });
await say(s, 'Each day shows its events. Click any event to open it', 3200);
await say(s, 'Week and Day views show the same events hour by hour');
await press(s, page.getByRole('link', { name: 'Today', exact: true }), { after: 1200 });
await press(s, page.getByRole('link', { name: 'Week', exact: true }), { after: 3200 });
await press(s, page.getByRole('link', { name: 'List', exact: true }), { after: 1400 });
await go(s, 'office', `/events?view=list&date=${nextFriday()}`);

// ── Event board ──────────────────────────────────────────────────────────
await say(s, 'Open the Gala Dinner to see its board');
await press(s, page.getByRole('link', { name: 'Gala Dinner' }), { after: 1600 });
await page.waitForLoadState('networkidle').catch(() => {});

await say(s, 'The event board: client, venue, the event window and the on-site contact', 3400);
await say(
  s,
  'The event window is the earliest role start to the latest role end. Each role has its own times',
);
await point(s, page.getByText('Event window').first());
await sleep(3400);
await say(s, 'Auto-assign can be switched on or off for the whole event, or per role');
await point(s, page.getByText(/Auto-assign · event level/));
await sleep(3200);

await say(
  s,
  'Each role section shows who is confirmed, who is invited and who is in the potential pool',
);
await scroll(s, 420, { pause: 3000 });
await say(
  s,
  'Workers are scored on show rate, client rating, proximity, fair rotation and venue history',
);
await scroll(s, 420, { pause: 3600 });
await say(
  s,
  'Qualified workers for this client are invited first. Everyone else is invited in the second wave',
);
await scroll(s, 420, { pause: 3800 });
await scroll(s, -1600, { pause: 600 });

await say(
  s,
  'From here: edit the event, duplicate it, send the allocation timesheet, or message the staff',
);
await point(
  s,
  page.getByRole('link', { name: 'Edit' }).or(page.getByRole('button', { name: 'Edit' })),
);
await sleep(1600);
await point(
  s,
  page
    .getByRole('button', { name: /Message staff/ })
    .or(page.getByRole('link', { name: /Message staff/ })),
);
await sleep(1600);
await point(
  s,
  page
    .getByRole('button', { name: /Send Allocation Timesheet/ })
    .or(page.getByRole('link', { name: /Send Allocation Timesheet/ })),
);
await sleep(2400);

// ── Shift Builder ────────────────────────────────────────────────────────
await say(s, 'To book a new event, press New event to open the Shift Builder');
await go(s, 'office', '/events');
await press(s, page.getByRole('link', { name: /New event/ }), { after: 1600 });
await page.waitForLoadState('networkidle').catch(() => {});
await say(
  s,
  'Pick the client and venue, then the date. Rates and dress codes come from the client’s rate card',
  4200,
);
await scroll(s, 420, { pause: 2600 });
await say(s, 'Add a section for each role with its own start, end, headcount and buffer');
await scroll(s, 420, { pause: 3600 });
await say(s, 'Times typed here are UK time, always');
await sleep(2400);
await hush(s);

await card(s, 'Next: check-in, staff and compliance', 'Back Office Portal · part 2', 2600);
await finish(s);
