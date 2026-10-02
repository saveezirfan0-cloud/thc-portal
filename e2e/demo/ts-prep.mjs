// Downloads the real timesheet PDFs the video shows, through the Back Office's own
// download route, and renders them to PNG (needs pymupdf). Run before ts-*.mjs.
//   DEMO_DOCS  where they go (default ./out/docs)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finish, login, start, BASE } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = process.env.DEMO_DOCS || path.join(here, 'out', 'docs');
fs.mkdirSync(DOCS, { recursive: true });

const s = await start('ts-prep');
s.narrate = false;
await login(s, 'office', 'gisela@thehospitalitycompany.example');
const files = [];
for (const [name, id, kind] of [
  ['allocation-gala', '60000000-0000-4000-8000-000000000001', 'allocation'],
  ['completed-lunch', '60000000-0000-4000-8000-000000000006', 'signout'],
]) {
  const r = await s.ctx.request.get(`${BASE.office}/api/documents/${id}?kind=${kind}`);
  if (!r.ok()) throw new Error(`${name}: ${r.status()}`);
  const f = path.join(DOCS, `${name}.pdf`);
  fs.writeFileSync(f, await r.body());
  files.push(f);
}
await finish(s).catch(() => {});
execFileSync('python3', [path.join(here, 'pdf2png.py'), ...files], { stdio: 'inherit' });
console.log('docs in', DOCS);
