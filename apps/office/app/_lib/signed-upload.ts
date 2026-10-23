/**
 * Send a file to a Storage signed upload URL with one plain `fetch` PUT, so
 * the Ticket button — which is on every Back Office page — does not load the
 * whole Supabase browser client for it. The same request `uploadToSignedUrl`
 * makes for a raw body, and the same helper the Staff App uses
 * (apps/staff/app/_lib/signed-upload.ts).
 *
 * The server action that issued the URL decided the bucket, the object name
 * and who may write it; the token in the URL is good for that one object. A
 * `finish…` action reads back what Storage recorded, so nothing the browser
 * sends here is trusted.
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
  // A literal NEXT_PUBLIC_ name, so Next inlines it into the browser bundle.
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anonKey) headers['apikey'] = anonKey;
  try {
    const response = await fetchImpl(signedUrl, { method: 'PUT', body, headers });
    return response.ok;
  } catch {
    return false;
  }
}
