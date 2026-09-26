'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@thc/ui';
import { rtwCheckPhotos } from '../_lib/rtwCheckActions';
import type { RtwPhotosResult } from '../_lib/rtwCheckActions';

/**
 * "Compare the photos before you verify" (ADR-0041): the applicant photo
 * gov.uk showed beside the worker's app selfie, so the admin — not the
 * automation — makes the Home Office photo match.
 *
 * The URLs come from rtwCheckPhotos(), which checks the caller is an admin,
 * reads both paths through the session and signs them for a short while;
 * the browser only ever holds the check id. A link that has expired by the
 * time the image loads offers "Reload photos". When either photo is
 * missing the panel says so plainly, with where to look instead.
 */
export function RtwCheckPhotos({ checkId }: { checkId: string }) {
  const [result, setResult] = useState<RtwPhotosResult | null>(null);
  const [broken, setBroken] = useState<{ gov: boolean; selfie: boolean }>({
    gov: false,
    selfie: false,
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let live = true;
    setLoading(true);
    setBroken({ gov: false, selfie: false });
    rtwCheckPhotos(checkId)
      .then((next) => {
        if (live) setResult(next);
      })
      .catch(() => {
        if (live) setResult({ ok: false, message: 'Could not load the photos.' });
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [checkId]);

  useEffect(() => load(), [load]);

  const expired = broken.gov || broken.selfie;

  return (
    <div className="rtwcheck-photos" aria-label="Compare the photos before you verify">
      <div className="row wrap">
        <b className="sm">Compare the photos before you verify</b>
        {!loading && (expired || (result && !result.ok)) ? (
          <Button size="sm" tone="ghost" onClick={() => load()}>
            Reload photos
          </Button>
        ) : null}
      </div>
      {loading && !result ? (
        <div className="muted sm">Loading the photos…</div>
      ) : result && !result.ok ? (
        <div className="coral sm">{result.message}</div>
      ) : result ? (
        <div className="rtwcheck-photo-pair">
          <figure className="rtwcheck-photo">
            {result.govPhotoUrl && !broken.gov ? (
              <img
                src={result.govPhotoUrl}
                alt="The photo gov.uk shows for this share code"
                onError={() => setBroken((b) => ({ ...b, gov: true }))}
              />
            ) : (
              <div className="rtwcheck-photo-missing sm">
                {broken.gov
                  ? 'The link to the gov.uk photo has expired — reload the photos.'
                  : result.hasGovPhoto
                    ? 'Could not open the gov.uk photo — compare with the photo in the gov.uk report.'
                    : 'No photo captured — compare with the photo in the gov.uk report.'}
              </div>
            )}
            <figcaption>gov.uk photo</figcaption>
          </figure>
          <figure className="rtwcheck-photo">
            {result.selfieUrl && !broken.selfie ? (
              <img
                src={result.selfieUrl}
                alt="The worker’s selfie from the app"
                onError={() => setBroken((b) => ({ ...b, selfie: true }))}
              />
            ) : (
              <div className="rtwcheck-photo-missing sm">
                {broken.selfie
                  ? 'The link to the selfie has expired — reload the photos.'
                  : result.hasSelfie
                    ? 'Could not open the selfie — check the profile photo before you verify.'
                    : 'No selfie on file yet — the worker takes it in the app.'}
              </div>
            )}
            <figcaption>App selfie</figcaption>
          </figure>
        </div>
      ) : null}
    </div>
  );
}
