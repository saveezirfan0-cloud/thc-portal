'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, MobileCard, Modal, Pill, Textarea, useTimeFormat } from '@thc/ui';
import { ActionButton } from '../../_components/ActionButton';
import { requestCover, withdrawShiftOffer } from '../../actions';
import type { Refusal } from '../../actions';
import {
  COVER_BUTTON,
  COVER_CHIP,
  COVER_EXPLAINER,
  COVER_EXPLAINER_AUTO_OFF,
  COVER_LEAD,
  COVER_NOTE_LABEL,
  COVER_REQUESTED,
  WITHDRAW_OFFER_BUTTON,
  offeredChip,
  offeredLine,
  offerPanel,
} from '../offers';
import type { BookingOffer } from '../offers';
import { YourTimeAt } from '../YourTimeAt';

/**
 * Ask the office for cover / Withdraw — ADR-0046 (amended), docs/19 §4,
 * `wireframes/staff/offer-shift.html` (c)–(f).
 *
 * Which panel shows is `offerPanel()` (../offers.ts). A worker cannot offer
 * their shift to other workers (THC, 02.10.2026): more than 72 hours out
 * with auto-assign on there is no panel — Cancel shift (RULE-04) is
 * elsewhere on the screen; inside 72 hours, or with auto-assign off, they
 * can ask the office for cover, and only the office opens it to the pool.
 * The server decides every press; this only shows what it would allow.
 */
export function OfferPanel({
  bookingId,
  startsAt,
  status,
  offer,
  now,
}: {
  bookingId: string;
  startsAt: string;
  status: string;
  offer: BookingOffer | null;
  now: Date;
}) {
  const format = useTimeFormat();
  const start = new Date(startsAt);
  const panel = offerPanel({ status, startsAt: start }, offer, now);

  if (panel === 'none') return null;

  if (panel === 'offered' && offer?.offerId && offer.expiresAt) {
    return (
      <MobileCard badge={<Pill tone="cyan">{offeredChip(offer.expiresAt, format)}</Pill>}>
        <p className="sm">
          {offeredLine(offer.expiresAt, format)}
          {/* §1.8: the close is scheduled UK time; a phone elsewhere gets its own clock too. */}
          <YourTimeAt at={offer.expiresAt} lead="Open until " />
        </p>
        <ActionButton
          label={WITHDRAW_OFFER_BUTTON}
          tone="ghost"
          block
          action={withdrawShiftOffer.bind(null, offer.offerId, bookingId)}
        />
      </MobileCard>
    );
  }

  if (panel === 'cover_requested') {
    return (
      <MobileCard badge={<Pill tone="amber">{COVER_CHIP}</Pill>}>
        <p className="sm">{COVER_REQUESTED}</p>
      </MobileCard>
    );
  }

  return <CoverRequest bookingId={bookingId} autoAssign={offer?.autoAssign ?? false} />;
}

/** Wireframe (e): the optional note, then the request. */
function CoverRequest({ bookingId, autoAssign }: { bookingId: string; autoAssign: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [pending, start] = useTransition();

  if (sent) {
    return (
      <MobileCard badge={<Pill tone="amber">{COVER_CHIP}</Pill>}>
        <p className="sm">{COVER_REQUESTED}</p>
      </MobileCard>
    );
  }

  const send = () =>
    start(async () => {
      const result = await requestCover(bookingId, note);
      if ('refusal' in result) {
        setRefusal(result.refusal);
        return;
      }
      setOpen(false);
      setSent(true);
    });

  return (
    <MobileCard>
      {open ? (
        <>
          <p className="sm">
            <b>{COVER_LEAD}</b> {autoAssign ? COVER_EXPLAINER : COVER_EXPLAINER_AUTO_OFF}
          </p>
          <Textarea
            label={COVER_NOTE_LABEL}
            value={note}
            maxLength={300}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button block tone="primary" solid disabled={pending} onClick={send}>
            {pending ? 'Working…' : COVER_BUTTON}
          </Button>
          <Button block tone="ghost" disabled={pending} onClick={() => setOpen(false)}>
            Keep my shift
          </Button>
        </>
      ) : (
        <p className="sm">
          {COVER_LEAD}{' '}
          <Button size="sm" tone="outline" onClick={() => setOpen(true)}>
            {COVER_BUTTON}
          </Button>
        </p>
      )}

      <Modal
        open={refusal !== null}
        title={refusal?.title ?? ''}
        onClose={() => setRefusal(null)}
        footer={<Button onClick={() => setRefusal(null)}>OK</Button>}
      >
        <Alert tone="coral">{refusal?.body}</Alert>
      </Modal>
    </MobileCard>
  );
}
