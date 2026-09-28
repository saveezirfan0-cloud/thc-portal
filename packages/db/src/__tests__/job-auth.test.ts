import { describe, expect, it } from 'vitest';

import { bearerMatches, jobCallerAuthorised, secretMatches } from '../job-auth';

const SERVICE = 'eyJhbGciOiJIUzI1NiJ9.service.signature';
const SECRET = 'synthetic-job-secret-0123456789abcdef';

describe('jobCallerAuthorised', () => {
  it('lets pg_cron in with the job secret, even when the bearer is not the injected key', () => {
    // The live case: the vault's legacy JWT is not what the runtime injects.
    expect(
      jobCallerAuthorised(
        { authorization: 'Bearer eyJ-a-different-but-valid-jwt', jobSecret: SECRET },
        { serviceRoleKey: 'sb_secret_injected', jobSecret: SECRET },
      ),
    ).toBe(true);
  });

  it('still lets the injected service key in as a bearer (local development)', () => {
    expect(
      jobCallerAuthorised(
        { authorization: `Bearer ${SERVICE}`, jobSecret: null },
        { serviceRoleKey: SERVICE, jobSecret: undefined },
      ),
    ).toBe(true);
  });

  it('refuses a wrong job secret with a wrong bearer', () => {
    expect(
      jobCallerAuthorised(
        { authorization: 'Bearer anon', jobSecret: `${SECRET}x` },
        { serviceRoleKey: SERVICE, jobSecret: SECRET },
      ),
    ).toBe(false);
  });

  it('refuses everything when JOB_SECRET is unset and the bearer does not match', () => {
    expect(
      jobCallerAuthorised(
        { authorization: 'Bearer anon', jobSecret: '' },
        { serviceRoleKey: SERVICE, jobSecret: undefined },
      ),
    ).toBe(false);
  });

  it('never lets an empty header match an empty expected value', () => {
    // The nudges send x-job-secret: '' when the vault has no job_secret.
    expect(
      jobCallerAuthorised(
        { authorization: null, jobSecret: '' },
        { serviceRoleKey: '', jobSecret: '' },
      ),
    ).toBe(false);
  });
});

describe('secretMatches / bearerMatches', () => {
  it('compares exactly', () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(secretMatches(null, SECRET)).toBe(false);
  });

  it('needs the Bearer scheme', () => {
    expect(bearerMatches(`Bearer ${SERVICE}`, SERVICE)).toBe(true);
    expect(bearerMatches(SERVICE, SERVICE)).toBe(false);
    expect(bearerMatches(`bearer ${SERVICE}`, SERVICE)).toBe(false);
    expect(bearerMatches(null, SERVICE)).toBe(false);
  });
});
