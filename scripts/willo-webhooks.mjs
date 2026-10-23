#!/usr/bin/env node
/**
 * List our Willo webhooks, and switch them to follow EVERY interview
 * (ADR-0202).
 *
 *   WILLO_API_KEY=… node scripts/willo-webhooks.mjs list
 *   WILLO_API_KEY=… node scripts/willo-webhooks.mjs follow-all            # dry run
 *   WILLO_API_KEY=… node scripts/willo-webhooks.mjs follow-all --apply
 *   WILLO_API_KEY=… node scripts/willo-webhooks.mjs follow-interview --apply   # undo
 *
 * Why: candidates who record on an older interview (the invitation from the
 * previous system, an old advert) are accepted by the office in Willo, and
 * because our webhooks follow one interview only, nothing reaches us and the
 * card never moves. The receiver already answers strangers quietly
 * (willo_stranger), so following everything is safe.
 *
 * Only webhooks whose address is this project's willo-webhook function are
 * touched. THC's own two (Accelerate, 4-com.pro) are never changed. The
 * address carries our secret, so it is never printed — only its host, path
 * and event.
 *
 * `follow_all_interviews` on a PATCH is Willo's documented field name (it is
 * the one POST accepts, OWNER-TODO §4) but the PATCH has only been proven for
 * `url`. Run `list` afterwards: if it still says follow_all_interviews=false,
 * the PATCH ignored it — delete and re-create the two webhooks instead, with
 * the curl in OWNER-TODO §4 and "follow_all_interviews": true.
 *
 * Env: WILLO_API_KEY (required), WILLO_INTERVIEW_KEY (for follow-interview),
 * WILLO_API_BASE (default https://api.willotalent.com/api/integrations/v2).
 * The key is sent bare in the Authorization header (ADR-0066 §3).
 */

const BASE = (
  process.env.WILLO_API_BASE || 'https://api.willotalent.com/api/integrations/v2'
).replace(/\/+$/, '');
const KEY = process.env.WILLO_API_KEY;
const [command = 'list', ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');

if (!KEY) {
  console.error('Set WILLO_API_KEY (Willo → Integrations → Developer tools).');
  process.exit(2);
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // leave json null; the status and text below say what came back
  }
  return { status: response.status, json, text };
}

/** Our function's address, without the token. */
function describeUrl(raw) {
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname}${url.searchParams.get('event') ? `?event=${url.searchParams.get('event')}` : ''}`;
  } catch {
    return '(unreadable address)';
  }
}

const isOurs = (hook) =>
  typeof hook.url === 'string' && hook.url.includes('/functions/v1/willo-webhook');

async function listAll() {
  const out = [];
  let path = '/webhooks/';
  for (let page = 0; path && page < 20; page += 1) {
    const { status, json, text } = await call('GET', path);
    if (status !== 200 || json === null) {
      console.error(`GET ${path} → ${status}`, text.slice(0, 300));
      process.exit(1);
    }
    const rows = Array.isArray(json) ? json : (json.results ?? []);
    out.push(...rows);
    const next = Array.isArray(json) ? null : json.next;
    path = next ? next.replace(BASE, '') : null;
  }
  return out;
}

function show(hooks) {
  for (const hook of hooks) {
    const interviews = Array.isArray(hook.interviews) ? hook.interviews.length : '?';
    console.log(
      [
        isOurs(hook) ? 'OURS  ' : 'theirs',
        hook.key ?? hook.id ?? '?',
        `event=${hook.event ?? '?'}`,
        `follow_all_interviews=${hook.follow_all_interviews ?? '?'}`,
        `interviews=${interviews}`,
        `status=${hook.status ?? '?'}`,
        describeUrl(hook.url),
      ].join('  '),
    );
  }
}

const hooks = await listAll();
show(hooks);
if (command === 'list') process.exit(0);

const ours = hooks.filter(isOurs);
if (ours.length === 0) {
  console.error('\nNo webhook of ours found (address must contain /functions/v1/willo-webhook).');
  process.exit(1);
}

let patch;
if (command === 'follow-all') {
  patch = { follow_all_interviews: true };
} else if (command === 'follow-interview') {
  const interview = process.env.WILLO_INTERVIEW_KEY;
  if (!interview) {
    console.error('Set WILLO_INTERVIEW_KEY to follow only that interview again.');
    process.exit(2);
  }
  patch = { follow_all_interviews: false, interviews: [interview] };
} else {
  console.error(`Unknown command "${command}". Use list, follow-all or follow-interview.`);
  process.exit(2);
}

console.log(
  `\n${apply ? 'Applying' : 'Dry run — would apply'} ${JSON.stringify(patch)} to ${ours.length} webhook(s) of ours.`,
);
if (!apply) {
  console.log('Add --apply to do it.');
  process.exit(0);
}

for (const hook of ours) {
  const key = hook.key ?? hook.id;
  const { status, text } = await call('PATCH', `/webhooks/${key}/`, patch);
  console.log(`PATCH ${key} → ${status}${status >= 300 ? ` ${text.slice(0, 300)}` : ''}`);
}
console.log('\nRun `list` again: follow_all_interviews should now read as requested.');
