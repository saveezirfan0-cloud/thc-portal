'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@thc/ui';
import { finishTutorial } from '../actions';
import { TUTORIAL_CARDS } from '../content/tutorial';
import { WizardFoot, WizardTop } from './Wizard';

/** 11/11 How it works — §10.3, wireframes/staff/onboarding-3.html. */
export function TutorialStep({ firstName }: { firstName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function open() {
    setError(null);
    start(async () => {
      const result = await finishTutorial();
      if (!result.ok) setError(result.message);
      else router.push('/shifts');
    });
  }

  return (
    <>
      <WizardTop step={11} heading={`You’re nearly there, ${firstName}`} />
      {TUTORIAL_CARDS.map((card, i) => (
        <div className="tut" key={card.title}>
          <span className="ic">{i + 1}</span>
          <div className="t">{card.title}</div>
          <div className="m">{card.body}</div>
        </div>
      ))}
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <WizardFoot>
        <Button tone="primary" size="lg" block disabled={pending} onClick={open}>
          Open app
        </Button>
      </WizardFoot>
    </>
  );
}
