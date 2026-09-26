'use client';

import { useEffect, useState } from 'react';
import { Button, EmptyState, Toast } from '@thc/ui';
import { AppQr } from '../../activate/done/ActivatedScreen';
import '../../activate/activate.css';
import { EMPTY_COPY, EMPTY_TITLE, INTRO_COPY, appliedLine, shareData } from './model';

/**
 * Refer a friend — `wireframes/staff/refer.html` (ADR-0046).
 *
 * The link, **Share** (the Web Share API, where the phone has it), **Copy
 * link**, the QR (the activation screen's own `AppQr`, so both QR codes in
 * the app are drawn the same way), and the count. No reward copy (Q19);
 * no names (Q20).
 */
export function ReferScreen({ link, applied }: { link: string; applied: number }) {
  const [canShare, setCanShare] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setToast('Link copied');
    } catch {
      setToast('Couldn’t copy — press and hold the link to copy it.');
    }
  }

  async function share() {
    try {
      await navigator.share(shareData(link));
    } catch (error) {
      // Dismissing the share sheet is not a failure worth a message.
      if ((error as { name?: string } | null)?.name !== 'AbortError') await copy();
    }
  }

  return (
    <div className="refer">
      <p className="sm muted">{INTRO_COPY}</p>
      <div className="refer-link">
        <span className="label">Your link</span>
        <span className="url mono" data-testid="referral-link">
          {link}
        </span>
      </div>
      <div className="row refer-actions">
        {canShare ? (
          <Button tone="primary" onClick={share}>
            Share
          </Button>
        ) : null}
        <Button tone={canShare ? 'outline' : 'primary'} onClick={copy}>
          Copy link
        </Button>
      </div>
      {toast ? <Toast tone="green">{toast}</Toast> : null}
      <div className="refer-qr">
        <AppQr url={link} />
        <div className="xs muted">Or let them scan this from your phone.</div>
      </div>
      {applied > 0 ? (
        <div className="refer-count">
          <span className="v">{applied}</span>
          <span className="sm">{appliedLine(applied).replace(/^\d+ /, '')}</span>
        </div>
      ) : (
        <EmptyState>
          <h3>{EMPTY_TITLE}</h3>
          {EMPTY_COPY}
        </EmptyState>
      )}
    </div>
  );
}
