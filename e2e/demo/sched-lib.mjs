// Shared by the scheduling "how it works" scripts (sched-*.mjs).
import { point, rest, sleep } from './lib.mjs';

// Demo events (supabase/demo/review-data.sql).
export const EVENT = {
  gala: '60000000-0000-4000-8000-000000000001', // tomorrow, 9 confirmed, none "ready" yet
  marquee: '60000000-0000-4000-8000-000000000003', // invited only, auto-assign on
  lunch: '60000000-0000-4000-8000-000000000004', // auto-assign OFF for the event
  awards: '60000000-0000-4000-8000-000000000005', // Host: 3 confirmed, used for the changes
};

/** Choose an option of a select, the way a person would: move there, click, pick. */
export async function pick(s, select, label) {
  await point(s, select, 150);
  await select.first().selectOption({ label });
  await sleep(600);
}

/** Set a field's value (date and time inputs cannot be typed into key by key). */
export async function setValue(s, field, value) {
  await point(s, field, 150);
  await field.first().click();
  await field.first().fill(String(value));
  await sleep(600);
}

/** The event part 1 builds (every real pool in the demo data is otherwise empty). */
export async function summerEvent() {
  const [e] = await rest(`events?select=id&title=eq.Summer%20Reception&order=created_at.desc&limit=1`);
  if (!e) throw new Error('Run sched-1-build-event.mjs first: Summer Reception does not exist.');
  return e.id;
}
