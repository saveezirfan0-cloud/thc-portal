/**
 * Send a file to a Storage signed upload URL with one plain `fetch` PUT
 * (go-live audit L1).
 *
 * The upload screens (a document upload or renewal, the completion letter,
 * the opt-out's signed copy, the onboarding uploads and the selfie) used to
 * load the whole Supabase browser client (auth, realtime, PostgREST, about
 * 54 KB gzipped) for its `uploadToSignedUrl`, which is this one request.
 * Nothing else on those screens talks to Supabase from the browser.
 *
 * The server action that issues the URL decides everything that matters:
 * the bucket, the object name (built from the session, never from the
 * browser), and who may write it (the service key for `documents`, the
 * worker's own session and `photos_worker_insert_own` for the selfie).
 * The token in the URL is good for that one object only. Afterwards a
 * `finish…` action reads back what Storage recorded, so nothing the
 * browser sends here is trusted.
 *
 * The headers are the ones `uploadToSignedUrl` sends for a raw body:
 *   · `content-type`: what Storage records as the object's type;
 *   · `x-upsert: false`: never replace an object that is already there;
 *   · `cache-control`: the library's default for an upload;
 *   · `apikey`: the public anon key. The Storage route reads only the
 *     token, but the API gateway sees the same request the library sent.
 */
export async function putSignedUpload(
  signedUrl: string,
  body: Blob,
  contentType: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const headers: Record<string, string> = {
    'content-type': contentType,
    'x-upsert': 'false',
    'cache-control': 'max-age=3600',
  };
  // A literal NEXT_PUBLIC_ name, so Next inlines it into the browser bundle
  // (packages/db/src/env.ts).
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anonKey) headers['apikey'] = anonKey;
  try {
    const response = await fetchImpl(signedUrl, { method: 'PUT', body, headers });
    return response.ok;
  } catch {
    // No signal, or the request was cut off: the caller says "try again".
    return false;
  }
}
