'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Pill } from '@thc/ui';
import { refereeComplete, refereeErrors, referencesReady } from '@thc/domain';
import { saveReferences } from '../actions';
import type { Referee } from '../state';
import { WizardFoot, WizardTop } from './Wizard';

/**
 * 8/11 Two references — §2.10, wireframes/staff/onboarding-2.html.
 *
 * Mandatory, two, no relatives; phone AND email; tutors, lecturers,
 * teachers, course leaders, volunteering supervisors and coaches all count,
 * and the copy says so, for the candidate with no work history. Not
 * verified by anyone — stored and shown on the profile.
 */
const EMPTY: Referee = { name: '', relationship: '', phone: '', email: '' };

export function ReferencesStep({ initial }: { initial: Referee[] }) {
  const router = useRouter();
  const [refs, setRefs] = useState<Referee[]>([initial[0] ?? EMPTY, initial[1] ?? EMPTY]);
  const [editing, setEditing] = useState<boolean[]>(refs.map((r) => !refereeComplete(r)));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const update = (i: number, key: keyof Referee, value: string) =>
    setRefs((all) => all.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  const ready = referencesReady(refs);
  const sameTwice =
    refs.every(refereeComplete) && !ready
      ? 'Your two referees must be two different people.'
      : null;

  function submit() {
    setError(null);
    start(async () => {
      const result = await saveReferences(refs);
      if (!result.ok) setError(result.message);
      else router.push('/onboarding/9');
    });
  }

  return (
    <>
      <WizardTop
        step={8}
        heading="Two references"
        sub={
          <>
            <b>Not relatives.</b> Employers, university tutors, lecturers, teachers, course leaders,
            volunteering supervisors or coaches all count — so you can give references even with no
            work history. Phone <b>and</b> email are both required.
          </>
        }
      />

      {refs.map((r, i) => {
        const complete = refereeComplete(r);
        const errors = refereeErrors(r);
        const show = (k: keyof Referee) => (touched[`${i}.${k}`] ? errors[k] : undefined);
        const touch = (k: keyof Referee) => () =>
          setTouched((t) => ({ ...t, [`${i}.${k}`]: true }));
        return (
          <div className="wiz-block" key={i}>
            <div className="bh">
              <Pill tone="cyan">Referee {i + 1}</Pill>
              <Pill tone={complete ? 'green' : 'amber'} className="ml-auto">
                {complete ? 'Complete' : 'Incomplete'}
              </Pill>
              {complete && !editing[i] ? (
                <button
                  type="button"
                  className="linkbtn xs"
                  onClick={() => setEditing((e) => e.map((x, j) => (j === i ? true : x)))}
                >
                  Edit
                </button>
              ) : null}
            </div>
            {complete && !editing[i] ? (
              <>
                <div className="sm">
                  {r.name} · {r.relationship}
                </div>
                <div className="xs muted mono">
                  {r.phone} · {r.email}
                </div>
              </>
            ) : (
              <>
                <Input
                  label={
                    <>
                      Full name <span className="coral">*</span>
                    </>
                  }
                  value={r.name}
                  onChange={(e) => update(i, 'name', e.target.value)}
                  onBlur={touch('name')}
                  error={show('name')}
                />
                <Input
                  label={
                    <>
                      Relationship to you <span className="coral">*</span>
                    </>
                  }
                  placeholder="e.g. Personal tutor, UCL"
                  value={r.relationship}
                  onChange={(e) => update(i, 'relationship', e.target.value)}
                  onBlur={touch('relationship')}
                  error={show('relationship')}
                />
                <Input
                  label={
                    <>
                      Phone <span className="coral">*</span>
                    </>
                  }
                  mono
                  type="tel"
                  value={r.phone}
                  onChange={(e) => update(i, 'phone', e.target.value)}
                  onBlur={touch('phone')}
                  error={show('phone')}
                />
                <Input
                  label={
                    <>
                      Email <span className="coral">*</span>
                    </>
                  }
                  type="email"
                  placeholder="name@example.com"
                  value={r.email}
                  onChange={(e) => update(i, 'email', e.target.value)}
                  onBlur={touch('email')}
                  error={show('email')}
                />
              </>
            )}
          </div>
        );
      })}

      <div className="xs muted">
        References are stored on your profile as supporting information. The office may contact
        them; there is no separate reference-check stage.
      </div>
      {sameTwice ? <Alert tone="amber">{sameTwice}</Alert> : null}
      {error ? <Alert tone="coral">{error}</Alert> : null}

      <WizardFoot hint={ready ? undefined : 'Complete both referees to continue'}>
        <Button tone="primary" size="lg" block disabled={!ready || pending} onClick={submit}>
          {pending ? 'Saving…' : 'Continue'}
        </Button>
      </WizardFoot>
    </>
  );
}
