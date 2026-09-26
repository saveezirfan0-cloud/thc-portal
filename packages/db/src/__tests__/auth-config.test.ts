import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The local Auth project (supabase/config.toml) as the reset flow and the
 * login rules need it (audit D13, ADR-0039). The hosted project is set by
 * hand to the same values; this pins the file CI and `supabase start` read.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const toml = readFileSync(join(REPO, 'supabase', 'config.toml'), 'utf8');

/** The body of one `[section]`, up to the next header. */
function section(name: string): string {
  const lines = toml.split('\n');
  const start = lines.findIndex((l) => l.trim() === `[${name}]`);
  if (start < 0) throw new Error(`no [${name}] in config.toml`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\[/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

describe('supabase/config.toml [auth]', () => {
  const auth = section('auth');

  it('nobody self-registers: sign-up is off for the project', () => {
    expect(auth).toMatch(/^enable_signup = false$/m);
  });

  it('but the email provider stays on, or email + password sign-in would stop', () => {
    expect(section('auth.email')).toMatch(/^enable_signup = true$/m);
  });

  it('passwords are at least 10 characters with letters and digits', () => {
    expect(auth).toMatch(/^minimum_password_length = 10$/m);
    expect(auth).toMatch(/^password_requirements = "letters_digits"$/m);
  });

  it('a password change needs a recent sign-in', () => {
    expect(section('auth.email')).toMatch(/^secure_password_change = true$/m);
  });

  it('allows /auth/callback and /auth/confirm on all three apps, and nothing else', () => {
    const list = /additional_redirect_urls = \[([^\]]*)\]/.exec(auth)?.[1] ?? '';
    const urls = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const expected = [3000, 3001, 3002].flatMap((port) => [
      `http://127.0.0.1:${port}/auth/callback**`,
      `http://127.0.0.1:${port}/auth/confirm**`,
    ]);
    expect(urls.sort()).toEqual(expected.sort());
  });

  it('wires the token_hash recovery template', () => {
    const recovery = section('auth.email.template.recovery');
    expect(recovery).toMatch(/^content_path = "\.\/supabase\/templates\/recovery\.html"$/m);
    const html = readFileSync(join(REPO, 'supabase', 'templates', 'recovery.html'), 'utf8');
    expect(html).toContain(
      'href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery&next=/reset"',
    );
  });
});
