'use client';

import { useState } from 'react';
import { Alert } from '@thc/ui';
import { RadarTab } from './RadarTab';
import { ReviewTab } from './ReviewTab';
import { radarCounts } from './queue';
import type { CompliancePageData } from './types';

/**
 * /compliance — §4.1, `wireframes/backoffice/compliance.html`.
 *
 * Two tabs. Needs review is every item waiting on the office; Radar is every
 * dated document on a live worker. The tab strip is written out rather than
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
  initialTab?: 'review' | 'radar';
}) {
  const [tab, setTab] = useState<'review' | 'radar'>(initialTab);
  const counts = radarCounts(data.radar);

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
      </div>

      {tab === 'review' ? (
        <ReviewTab rows={data.queue} checks={data.rtwChecks ?? {}} />
      ) : (
        <RadarTab rows={data.radar} warnings={data.warnings} mode={data.rotaGuardMode} />
      )}
    </div>
  );
}
