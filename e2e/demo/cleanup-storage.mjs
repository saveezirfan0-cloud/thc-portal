/* eslint-disable no-console -- command-line tool: printing is its output */
// Deletes the files the onboarding candidate uploaded (profile photo, documents)
// through the Storage API. Usage, from this folder:
//   DEMO_CANDIDATE_EMAIL=you+jordan@example.com NODE_USE_ENV_PROXY=1 node cleanup-storage.mjs
// Run it BEFORE cleanup-demo.sql, which deletes the staff row the prefix comes from.
import { CANDIDATE, rest, storageApi } from './lib.mjs';

const [staff] = await rest(`staff?select=id&email=eq.${encodeURIComponent(CANDIDATE.email)}`);
if (!staff) {
  console.log('No such candidate; nothing to delete.');
  process.exit(0);
}

async function listAll(bucket, prefix) {
  const out = [];
  const entries = await storageApi('POST', `object/list/${bucket}`, { prefix, limit: 1000 });
  for (const e of entries) {
    if (e.id === null) out.push(...(await listAll(bucket, `${prefix}${e.name}/`)));
    else out.push(`${prefix}${e.name}`);
  }
  return out;
}

for (const bucket of ['photos', 'documents']) {
  const files = await listAll(bucket, `${staff.id}/`).catch((e) => {
    console.log(`${bucket}: ${String(e.message).split('\n')[0]}`);
    return [];
  });
  if (files.length) await storageApi('DELETE', `object/${bucket}`, { prefixes: files });
  console.log(`${bucket}: deleted ${files.length} file(s)`);
}
