'use client';

import { useState } from 'react';
import { Alert } from '@thc/ui';
import { RadarTab } from './RadarTab';
import { ChecksTab } from './ChecksTab';
import { ReviewTab } from './ReviewTab';
import { checkCounts } from './checks';
import { radarCounts } from './queue';
import type { CompliancePageData } from './types';

/**
 * /compliance — §4.1, `wireframes/backoffice/compliance.html`.
 *
 * Three tabs. Needs review is every item waiting on the office; Radar is every
 * dated document on a live worker; gov.uk checks watches the automated
 * share-code check (ADR-0025). The tab strip is written out rather than
 * taken from `Tabs` because the wireframe's Radar badge is a phrase ("9
 * expired · 14 expiring"), not a number, and `Tabs` counts only numbers — the
 * markup and classes are the design system's own (`.tabs`, `.n`, `.alert`).
 */
export function ComplianceScreen({
  data,
  initialTab = 'review',
}: {
  data: CompliancePageData;
  /** `/compliance?tab=radar` — the dashboard's "view radar →" (§9.1). */
  initialTab?: 'review' | 'radar' | 'checks';
}) {
  const [tab, setTab] = useState<'review' | 'radar' | 'checks'>(initialTab);
  const counts = radarCounts(data.radar);
  const checks = checkCounts(data.checkMonitor.checks);

  return (
    <div className="stack compliance">
      {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}

      <div className="tabs" role="tablist" aria-label="Compliance">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'review'}
          className={tab === 'review' ? 'active' : undefined}
          onClick={() => setTab('review')}
        >
          Needs review{' '}
          <span className={data.queue.length > 0 ? 'n alert' : 'n'}>{data.queue.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'radar'}
          className={tab === 'radar' ? 'active' : undefined}
          onClick={() => setTab('radar')}
        >
          Radar{' '}
          <span className="n">
            {counts.expired} expired · {counts.expiring} expiring
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'checks'}
          className={tab === 'checks' ? 'active' : undefined}
          onClick={() => setTab('checks')}
        >
          gov.uk checks{' '}
          <span className={checks.problems > 0 ? 'n alert' : 'n'}>
            {checks.progress} running
            {checks.problems > 0 ? ` · ${checks.problems} stopped` : ''}
          </span>
        </button>
      </div>

      {tab === 'review' ? (
        <ReviewTab rows={data.queue} rtwCheckEnabled={data.rtwCheckEnabled} />
      ) : tab === 'radar' ? (
        <RadarTab rows={data.radar} warnings={data.warnings} mode={data.rotaGuardMode} />
      ) : (
        <ChecksTab
          monitor={data.checkMonitor}
          enabled={data.rtwCheckEnabled}
          onOpenReview={() => setTab('review')}
        />
      )}
    </div>
  );
}
