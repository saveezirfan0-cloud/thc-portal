import { rtwCheckError } from '@thc/domain';
import { looksLikePdf, MAX_REPORT_BYTES } from './checker';
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

  async function fetchReport(url: string): Promise<Uint8Array | null> {
    try {
      const response = await fetchImpl(url, {
        headers: authHeaders(config),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length <= MAX_REPORT_BYTES && looksLikePdf(bytes) ? bytes : null;
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
      return { result: mapped.result, report };
    },
  };
}
