import Anthropic from '@anthropic-ai/sdk';
import type { RtwExtraction } from '@thc/domain';
import { GOVUK_PAGE_KINDS, type GovUkPageKind } from './govuk-assumptions';

/**
 * Claude reads the gov.uk page (ADR-0025). The PDF goes in; a fixed JSON
 * shape comes out, enforced by structured outputs, so the runner never
 * parses prose. Claude reads and reports — `assessRtwResult()` in
 * @thc/domain decides what the office is shown, and the admin decides
 * what happens.
 *
 * The share code and date of birth are NOT sent: the page is enough, and
 * the fewer copies of them the better.
 */

export const RTW_EXTRACTION_MODEL = 'claude-opus-5';

export interface PageReading extends RtwExtraction {
  pageKind: GovUkPageKind;
}

const nullable = (type: 'string' | 'integer') => ({ anyOf: [{ type }, { type: 'null' }] });

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'pageKind',
    'found',
    'hasRightToWork',
    'holderName',
    'rightToWorkUntil',
    'noTimeLimit',
    'permissionType',
    'conditions',
    'termTimeWeeklyHours',
  ],
  properties: {
    pageKind: { type: 'string', enum: [...GOVUK_PAGE_KINDS] },
    found: { type: 'boolean' },
    hasRightToWork: { type: 'boolean' },
    holderName: nullable('string'),
    rightToWorkUntil: nullable('string'),
    noTimeLimit: { type: 'boolean' },
    permissionType: nullable('string'),
    conditions: nullable('string'),
    termTimeWeeklyHours: nullable('integer'),
  },
} as const;

const INSTRUCTIONS = `This PDF is a page from the UK Home Office service "View a job applicant's right to work details", reached by an employer entering a share code and date of birth.

Report what the page says. Do not infer anything it does not state.

- pageKind: "result" if it shows a person's right-to-work details; "not_found" if it says no details or record were found for the details entered; "form_error" if it is the entry form again with an error message; "other" for anything else (a start page, a service outage, a cookie or security page).
- found: true only for "result".
- hasRightToWork: true only if the result says the person has permission to work in the UK now.
- holderName: the person's full name exactly as printed, or null.
- rightToWorkUntil: the date their permission to work ends, as YYYY-MM-DD, or null if none is printed.
- noTimeLimit: true only if the page says there is no time limit on their permission (for example settled status or indefinite leave).
- permissionType: the status or visa as named on the page (for example "Settled status", "Pre-settled status", "Skilled Worker visa", "Student visa"), or null.
- conditions: the work conditions or restrictions exactly as printed, or null if none are printed.
- termTimeWeeklyHours: if the conditions limit weekly working hours during term time, that number of hours as an integer; otherwise null.`;

export interface ExtractorConfig {
  apiKey: string;
  /** Per-request budget; one retry on a transient failure. */
  timeoutMs?: number;
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

/** A value from Claude, checked against the shape once more before use. */
export function toPageReading(value: unknown): PageReading {
  if (!value || typeof value !== 'object')
    throw new ExtractionError('extraction is not an object', true);
  const v = value as Record<string, unknown>;
  const str = (k: string): string | null => {
    const x = v[k];
    if (x === null) return null;
    if (typeof x !== 'string') throw new ExtractionError(`extraction.${k} is not a string`, true);
    const t = x.trim();
    return t.length > 0 ? t : null;
  };
  const bool = (k: string): boolean => {
    if (typeof v[k] !== 'boolean')
      throw new ExtractionError(`extraction.${k} is not a boolean`, true);
    return v[k] as boolean;
  };
  const kind = v['pageKind'];
  if (typeof kind !== 'string' || !(GOVUK_PAGE_KINDS as readonly string[]).includes(kind)) {
    throw new ExtractionError('extraction.pageKind is not a known page', true);
  }
  const hours = v['termTimeWeeklyHours'];
  if (
    hours !== null &&
    (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 0 || hours > 168)
  ) {
    throw new ExtractionError('extraction.termTimeWeeklyHours is not a number of hours', true);
  }
  return {
    pageKind: kind as GovUkPageKind,
    found: bool('found'),
    hasRightToWork: bool('hasRightToWork'),
    holderName: str('holderName'),
    rightToWorkUntil: str('rightToWorkUntil'),
    noTimeLimit: bool('noTimeLimit'),
    permissionType: str('permissionType'),
    conditions: str('conditions'),
    termTimeWeeklyHours: hours as number | null,
  };
}

export async function readGovUkPage(pdf: Buffer, config: ExtractorConfig): Promise<PageReading> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    timeout: config.timeoutMs ?? 60_000,
    maxRetries: 1,
  });

  let response;
  try {
    response = await client.beta.messages.create({
      model: RTW_EXTRACTION_MODEL,
      max_tokens: 4096,
      // A refusal is re-run on Anthropic's recommended fallback model rather
      // than failing the check.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdf.toString('base64'),
              },
            },
            { type: 'text', text: INSTRUCTIONS },
          ],
        },
      ],
    });
  } catch (cause) {
    if (
      cause instanceof Anthropic.AuthenticationError ||
      cause instanceof Anthropic.PermissionDeniedError
    ) {
      throw new ExtractionError(`Claude refused the API key (${cause.status})`, false);
    }
    if (cause instanceof Anthropic.BadRequestError) {
      throw new ExtractionError(`Claude rejected the request (400): ${cause.message}`, false);
    }
    if (cause instanceof Anthropic.APIError) {
      throw new ExtractionError(`Claude API error ${cause.status ?? ''}: ${cause.message}`, true);
    }
    throw new ExtractionError(cause instanceof Error ? cause.message : String(cause), true);
  }

  if (response.stop_reason === 'refusal') {
    throw new ExtractionError('Claude declined to read the page', true);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new ExtractionError('Claude ran out of tokens reading the page', true);
  }
  const text = response.content
    .filter(
      (b): b is Extract<(typeof response.content)[number], { type: 'text' }> => b.type === 'text',
    )
    .map((b) => b.text)
    .join('');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExtractionError('Claude did not return JSON', true);
  }
  return toPageReading(parsed);
}
