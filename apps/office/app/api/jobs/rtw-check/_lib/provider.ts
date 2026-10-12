import { rtwCheckError } from '@thc/domain';
import { looksLikePdf, looksLikePng, MAX_REPORT_BYTES } from './checker';
import type { CheckInput, CheckOutput, EnvReader, RightToWorkChecker } from './checker';
import {
  authHeaders,
  mapProviderResponse,
  providerAvailable,
  providerConfig,
  providerFailureCode,
  providerRequestBody,
} from './provider.config';

/**
 * The PRIMARY adapter: a third-party right-to-work provider's HTTP API
 * (ADR-0025). Every assumption about that API is in `provider.config.ts`;
 * this file is only the I/O around it — one POST, and the report fetched if
 * the provider hands back a link rather than the bytes.
 *
 * `fetchImpl` is injected so the tests run against synthetic responses
 * without a network.
 */
export function createProviderChecker(
  env: EnvReader,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): RightToWorkChecker | null {
  const config = providerConfig(env);
  if (!providerAvailable(config)) return null;

  const providerOrigin = originOf(config.url!);

  /**
   * The report behind a link the provider's answer named (security review,
   * item 3). The link is data from a response, so it is followed only on
   * the provider's OWN origin — the one `RTW_PROVIDER_URL` names — and
   * nowhere else: any other link (another host, http, a bucket, an internal
   * address) is not fetched at all and the check simply has no report,
   * rather than sending our API key, or even a bare server-side request, to
   * wherever a response pointed. Redirects are refused for the same reason.
   * The body is read as a stream and abandoned the moment it passes
   * MAX_REPORT_BYTES, so a huge answer never sits in memory whole.
   */
  async function fetchReport(url: string): Promise<Uint8Array | null> {
    if (providerOrigin === null || originOf(url) !== providerOrigin) return null;
    try {
      const response = await fetchImpl(url, {
        headers: authHeaders(config),
        redirect: 'error',
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) return null;
      const bytes = await readCapped(response, MAX_REPORT_BYTES);
      return bytes && looksLikePdf(bytes) ? bytes : null;
    } catch {
      return null;
    }
  }

  return {
    source: 'provider',
    async check(input: CheckInput): Promise<CheckOutput> {
      const checkedAt = now().toISOString();
      let response: Response;
      try {
        response = await fetchImpl(config.url!, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...authHeaders(config),
          },
          body: JSON.stringify(providerRequestBody(input)),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (cause) {
        return {
          result: rtwCheckError('provider', providerFailureCode(cause), checkedAt),
          report: null,
        };
      }

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      const mapped = mapProviderResponse(response.status, body, checkedAt);
      let report: Uint8Array | null = null;
      if (mapped.reportBase64) {
        const bytes = Uint8Array.from(Buffer.from(mapped.reportBase64, 'base64'));
        report = looksLikePdf(bytes) ? bytes : null;
      } else if (mapped.reportUrl) {
        report = await fetchReport(mapped.reportUrl);
      }
      // The photo is best effort, as on the gov.uk route: anything that is
      // not a PNG under the size limit is dropped, and the PDF stands in.
      let photo: Uint8Array | null = null;
      if (
        mapped.photoBase64 &&
        mapped.result.outcome !== 'not_found' &&
        mapped.result.outcome !== 'error'
      ) {
        const bytes = Uint8Array.from(Buffer.from(mapped.photoBase64, 'base64'));
        photo = looksLikePng(bytes) ? bytes : null;
      }
      return { result: mapped.result, report, photo };
    },
  };
}

/** The origin of an absolute URL, or null for anything that is not one. */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * A response body of at most `limit` bytes, or null when it is larger —
 * read chunk by chunk and cancelled as soon as it goes over, never buffered
 * whole first. A declared Content-Length over the limit is refused unread.
 */
export async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
