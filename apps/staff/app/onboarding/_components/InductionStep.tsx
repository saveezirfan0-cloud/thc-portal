'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@thc/ui';
import { completeInduction } from '../actions';
import { INDUCTION_DECK, INDUCTION_IS_PLACEHOLDER, minutesLeft } from '../content/induction';
import { WizardFoot, WizardTop } from './Wizard';

/**
 * 5/11 Health & Safety induction — §10.3, wireframes/staff/onboarding-2.html.
 *
 * The deck slide by slide; "Continue to the quiz" unlocks on the last
 * slide. Reached again from a failed quiz result ("Review the induction
 * slides"), in which case it is already complete and goes straight back.
 */
export function InductionStep({ alreadyDone }: { alreadyDone: boolean }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [seenLast, setSeenLast] = useState(alreadyDone);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const total = INDUCTION_DECK.length;
  const slide = INDUCTION_DECK[index]!;
  const last = index === total - 1;

  function go(to: number) {
    const next = Math.max(0, Math.min(total - 1, to));
    setIndex(next);
    if (next === total - 1) setSeenLast(true);
  }

  function next() {
    setError(null);
    start(async () => {
      if (!alreadyDone) {
        const result = await completeInduction();
        if (!result.ok) return setError(result.message);
      }
      router.push('/onboarding/6');
    });
  }

  return (
    <>
      <WizardTop
        step={5}
        heading="Health & Safety induction"
        sub="THC’s induction deck, slide by slide. Read every slide — the quiz that follows is based on it."
      />
      {INDUCTION_IS_PLACEHOLDER ? (
        <div className="note xs">
          Stand-in slides: THC’s own induction deck replaces these before go-live.
        </div>
      ) : null}
      <div className={slide.image ? 'slide slide-image' : 'slide'} aria-live="polite">
        {slide.image ? (
          // The deck is 16:9 and dense for a phone: a tap opens the page on its
          // own, where the browser lets the worker zoom in.
          <a
            href={slide.image}
            target="_blank"
            rel="noopener"
            aria-label={`${slide.title} — open full size`}
          >
            <img src={slide.image} alt={slide.title} />
          </a>
        ) : (
          <>
            <div className="label cyan">{slide.section}</div>
            <div className="st">{slide.title}</div>
            <p>{slide.body}</p>
          </>
        )}
      </div>
      <div className="row">
        <span className="mono sm">
          Slide {index + 1} of {total}
        </span>
        <span className="ml-auto xs muted">
          {last ? 'Last slide' : `≈ ${minutesLeft(index, total)} min left`}
        </span>
      </div>
      <div className="dots" aria-hidden="true">
        {INDUCTION_DECK.map((s, i) => (
          <i
            key={`${s.title}-${i}`}
            className={i === index ? 'on' : i < index ? 'done' : undefined}
          />
        ))}
      </div>
      <div className="row">
        <Button block className="grow" disabled={index === 0} onClick={() => go(index - 1)}>
          ‹ Previous
        </Button>
        <Button tone="primary" block className="grow" disabled={last} onClick={() => go(index + 1)}>
          Next ›
        </Button>
      </div>
      <div className="xs muted center-text">
        Pinch to zoom. You can come back to any slide before you start the quiz.
      </div>
      {error ? <Alert tone="coral">{error}</Alert> : null}
      <WizardFoot hint={seenLast ? undefined : `Unlocks on the last slide (${total} of ${total})`}>
        <Button tone="primary" size="lg" block disabled={!seenLast || pending} onClick={next}>
          Continue to the quiz
        </Button>
      </WizardFoot>
    </>
  );
}
