#!/usr/bin/env node
/**
 * Report the files that more than one OPEN pull request is editing.
 *
 * Why this exists
 * ---------------
 * Five times in one day, two sessions built the same thing at the same time:
 *
 *   - the RULE-20 cap SQL (one landed unverified; main stayed red for hours)
 *   - accept_invite's weekly-cap gate (#31 and #35, independently)
 *   - the spatial_ref_sys assertions (#15 and a branch that dropped its copy)
 *   - the --radius / --accent design tokens
 *   - the §9.8 penny sweep timeout (#47 closed unmerged against main's copy)
 *
 * Every one cost a merge resolution, and the accept_invite pair came within
 * one editing decision of silently deleting a shipped rule: 20260922160000
 * happened to build on 20260922153000's body. Written as a straight
 * replacement it would have dropped the cap gate with a green build.
 *
 * scripts/check-file-numbering.mjs already catches the version of this that
 * shows up as a filename clash. This catches the version that shows up as
 * two people editing the same lines, which git does not report until merge
 * and which no test can see, because on each branch the change is coherent.
 *
 * How to use it
 * -------------
 * The moment that matters is BEFORE you start, not after you open a PR:
 *
 *   pnpm check:overlap                 every open PR and what it touches
 *   pnpm check:overlap -- --pr 47      just what PR 47 collides with
 *
 * CI runs it on every pull request and writes the result to the job summary.
 * It does NOT fail the build. Overlap is often legitimate — a base merge, or
 * two slices that both touch docs/14-handover.md — and a guard that cries
 * wolf on those would be turned off within a day. What was missing was never
 * enforcement, it was knowing.
 *
 * Auth: GITHUB_TOKEN or GH_TOKEN if set; falls back to unauthenticated,
 * which works for a public repository and is rate-limited. This repository is
 * private, so a local run needs a token with `pull-requests: read`. CI passes
 * `secrets.GITHUB_TOKEN` and needs nothing.
 */
import { execFileSync } from 'node:child_process';

const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

/** Files every branch touches for bookkeeping; overlap on these means nothing. */
export const NOISE = [
  'docs/00-how-to-build-with-claude.md',
  'docs/13-remaining-work.md',
  'docs/14-handover.md',
  'CLAUDE.md',
  'pnpm-lock.yaml',
];

export function isNoise(file) {
  return NOISE.includes(file);
}

/**
 * Files touched by more than one PR, loudest first. Pure, so the tests can
 * drive it without a network.
 *
 * @param {{number:number,title:string,files:string[]}[]} prs
 */
export function overlaps(prs) {
  const byFile = new Map();
  for (const pr of prs) {
    for (const file of pr.files) {
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(pr.number);
    }
  }
  return [...byFile.entries()]
    .filter(([, numbers]) => numbers.length > 1)
    .map(([file, numbers]) => ({ file, prs: numbers.sort((a, b) => a - b), noise: isNoise(file) }))
    .sort((a, b) =>
      a.noise !== b.noise
        ? a.noise
          ? 1
          : -1
        : b.prs.length - a.prs.length || a.file.localeCompare(b.file),
    );
}

async function api(path) {
  const headers = { accept: 'application/vnd.github+json' };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`${API}${path}`, { headers });
  if (!res.ok) {
    // 401/403 unauthenticated is the one failure worth explaining: the repo is
    // private, so the answer is a token, not a retry.
    const hint =
      !TOKEN && (res.status === 401 || res.status === 403)
        ? ' — set GITHUB_TOKEN to a token with pull-requests: read'
        : '';
    throw new Error(`${path} → ${res.status} ${res.statusText}${hint}`);
  }
  return res.json();
}

/**
 * owner/repo from `origin`, so the documented local run needs no setup. Both
 * URL shapes GitHub hands out:
 *
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 *
 * @param {string} url
 */
export function repoSlugFromRemote(url) {
  const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\s*$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

function repoSlug() {
  // CI sets this, and it is also the escape hatch for a checkout whose origin
  // is not the repository you want to ask about.
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  let url;
  try {
    url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      // git's own "not a git repository" would print ahead of our message.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error('no git remote `origin`; set GITHUB_REPOSITORY (owner/repo) instead');
  }
  const slug = repoSlugFromRemote(url);
  if (!slug) throw new Error(`could not read owner/repo from origin (${url.trim()})`);
  return slug;
}

async function main() {
  const only = process.argv.includes('--pr')
    ? Number(process.argv[process.argv.indexOf('--pr') + 1])
    : null;

  const slug = repoSlug();
  const open = await api(`/repos/${slug}/pulls?state=open&per_page=100`);
  if (open.length < 2) {
    console.log(`No overlap possible: ${open.length} open pull request(s).`);
    return;
  }

  const prs = [];
  for (const pr of open) {
    const files = await api(`/repos/${slug}/pulls/${pr.number}/files?per_page=100`);
    prs.push({ number: pr.number, title: pr.title, files: files.map((f) => f.filename) });
  }

  let found = overlaps(prs);
  if (only !== null) found = found.filter((o) => o.prs.includes(only));

  const titles = new Map(prs.map((p) => [p.number, p.title]));
  const real = found.filter((o) => !o.noise);

  if (found.length === 0) {
    console.log(`✓ ${prs.length} open pull requests, no file touched by more than one.`);
    return;
  }

  console.log(`${real.length} file(s) are being edited by more than one open pull request:\n`);
  for (const { file, prs: numbers, noise } of found) {
    console.log(`  ${noise ? '·' : '!'} ${file}`);
    for (const n of numbers) console.log(`      #${n}  ${titles.get(n)}`);
  }
  if (real.length > 0) {
    console.log(
      '\nBefore writing more: read the other PR. One of you is probably solving the\n' +
        'problem the other has already solved, and the merge will cost more than the\n' +
        'conversation. Lines marked · are shared bookkeeping files and are expected.',
    );
  }
}

// Only run when executed directly, so the tests can import the helpers.
if (process.argv[1] && process.argv[1].endsWith('check-pr-overlap.mjs')) {
  main().catch((err) => {
    // Never fail the build on this: it is advisory, and a rate limit or a
    // token without pull-requests:read must not turn a green PR red.
    console.log(`Could not check for overlapping pull requests: ${err.message}`);
  });
}
