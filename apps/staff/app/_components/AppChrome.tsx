'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { AppHeader, Avatar, Button, Logo, Pill, Sheet, useCollapsedHeader } from '@thc/ui';

/**
 * The Staff App's top bar and profile sheet — §10.1,
 * wireframes/staff/profile.html.
 *
 * Frosted, and collapsing: on scroll the title shrinks while the logo
 * stays left and the profile avatar stays right, so the way out of any
 * screen is always in the same place. `useCollapsedHeader` is the shared
 * scroll listener; the state has to live in a client component, which is
 * why the header sits here rather than in the server shell.
 *
 * The avatar is the only way into the profile sheet (§10.1) — there is no
 * profile TAB, because the four tabs are Documents · Shifts · Invites ·
 * Radar and nothing else.
 */

export const OFFICE_EMAIL = 'admin@thehospitalitycompany.co.uk';

export interface ChromeWorker {
  name: string;
  employeeId: number | null;
  photoUrl: string | null;
  /** Compliance state as a chip, e.g. "Compliant" / "On hold". */
  standing?: { label: string; tone: 'green' | 'amber' | 'coral' | 'neutral' };
}

export function AppChrome({
  title,
  sub,
  below,
  worker,
  /** §10.6: the request is unavailable for the duration of a shift. */
  checkedIn = false,
}: {
  title: ReactNode;
  sub?: ReactNode;
  below?: ReactNode;
  worker: ChromeWorker | null;
  checkedIn?: boolean;
}) {
  const collapsed = useCollapsedHeader();
  const [open, setOpen] = useState(false);

  return (
    <>
      <AppHeader
        title={title}
        {...(sub ? { sub } : {})}
        collapsed={collapsed}
        brand={<Logo size="sm" label="The Hospitality Company" />}
        {...(below ? { below } : {})}
        actions={
          worker ? (
            <button
              type="button"
              className="avatar-btn"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-label="Your profile"
              onClick={() => setOpen(true)}
            >
              <Avatar
                name={worker.name}
                {...(worker.photoUrl ? { src: worker.photoUrl } : {})}
                className="photo"
              />
            </button>
          ) : null
        }
      />

      {worker ? (
        <ProfileSheet
          open={open}
          onClose={() => setOpen(false)}
          worker={worker}
          checkedIn={checkedIn}
        />
      ) : null}
    </>
  );
}

/**
 * The profile sheet (§10.1): the worker's details, the three links, sign
 * out, the help line — which is a LINE, not a screen, confirmed against
 * the approved design — and Request my P45 at the very bottom, below sign
 * out, separated and not styled as a primary action (§10.6).
 *
 * The three links and the P45 action open screens built in their own
 * sessions. They are rendered here, in their specified positions and with
 * their specified prominence, marked as not yet reachable rather than
 * silently left out: their POSITION is part of §10.1, and a sheet that
 * grows new rows later is a different sheet to learn.
 */
function ProfileSheet({
  open,
  onClose,
  worker,
  checkedIn,
}: {
  open: boolean;
  onClose: () => void;
  worker: ChromeWorker;
  checkedIn: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} label="Your profile">
      <div className="row" style={{ gap: 'var(--sp-12)' }}>
        <Avatar
          name={worker.name}
          {...(worker.photoUrl ? { src: worker.photoUrl } : {})}
          size="xl"
          className="photo"
        />
        <div>
          <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 600 }}>
            {worker.name}
          </div>
          {worker.employeeId !== null ? (
            <div className="mono xs muted">
              Employee ID THC-{String(worker.employeeId).padStart(5, '0')}
            </div>
          ) : null}
          {worker.standing ? (
            <div className="row" style={{ gap: 'var(--sp-6)', marginTop: 4 }}>
              <Pill tone={worker.standing.tone}>{worker.standing.label}</Pill>
            </div>
          ) : null}
        </div>
      </div>

      <div className="links">
        <SheetLink label="Profile details" />
        <SheetLink label="Security settings" />
        <SheetLink label="Payment information" />
      </div>

      <form action="/auth/signout" method="post">
        <Button type="submit" block>
          Sign out
        </Button>
      </form>

      <div className="xs muted" style={{ textAlign: 'center' }}>
        Need help? Please contact us at:{' '}
        <b className="cyan">
          <a href={`mailto:${OFFICE_EMAIL}`}>{OFFICE_EMAIL}</a>
        </b>
      </div>

      <div className="p45">
        <span className="xs muted" aria-disabled="true">
          Request my P45 — leaving The Hospitality Company
        </span>
        <span className="xs muted">
          {checkedIn
            ? 'Available once you’ve checked out'
            : 'Opens a confirmation before anything happens'}
        </span>
      </div>
    </Sheet>
  );
}

/** A row in the sheet. No `href` yet: the screen is built in a later session. */
function SheetLink({ label, href }: { label: string; href?: string }) {
  if (!href) {
    return (
      <span className="link" aria-disabled="true">
        {label}
        <span className="chev">›</span>
      </span>
    );
  }
  return (
    <a className="link" href={href}>
      {label}
      <span className="chev">›</span>
    </a>
  );
}
