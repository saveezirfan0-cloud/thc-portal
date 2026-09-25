import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocType } from '@thc/domain';
import { documentExtractor, type ExtractionInput } from '../extractor';
import {
  ANSWER_SCHEMA,
  DEFAULT_ANTHROPIC_MODEL,
  DOUBTFUL_CONFIDENCE,
  MAX_IMAGE_BYTES,
  createAnthropicExtractor,
  detectMedia,
  isoDateOrNull,
  parseEffort,
  type MessagesClient,
} from '../extractors/anthropic';

/**
 * ADR-0031 — §2.6 extraction with Claude. No network: the SDK client is a
 * fake (`MessagesClient`), and `documentExtractor()` is only ever asked to
 * build one, never to call it. Every document below is synthetic.
 */

const PDF = new TextEncoder().encode('%PDF-1.7 synthetic').buffer as ArrayBuffer;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  .buffer as ArrayBuffer;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]).buffer as ArrayBuffer;
const HEIC = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypheic')])
  .buffer as ArrayBuffer;

/** A marker that must never reach a log line. */
const SECRET_TEXT = 'JANE-DOE-PASSPORT-123456789';

function input(docType: DocType, bytes: ArrayBuffer = PDF, mimeType = 'application/pdf') {
  return { docType, path: `staff/s1/${docType}.bin`, mimeType, bytes } satisfies ExtractionInput;
}

function answer(fields: Record<string, unknown>) {
  return {
    matchesDocType: true,
    legible: true,
    expiryDate: null,
    holidays: null,
    completionDate: null,
    completionDateKind: null,
    awardingInstitution: null,
    confidence: 0.95,
    notes: '',
    ...fields,
  };
}

function message(body: unknown, stop: Anthropic.Message['stop_reason'] = 'end_turn') {
  return {
    id: 'msg_synthetic',
    type: 'message',
    role: 'assistant',
    model: DEFAULT_ANTHROPIC_MODEL,
    stop_reason: stop,
    stop_sequence: null,
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      {
        type: 'text',
        text: typeof body === 'string' ? body : JSON.stringify(body),
        citations: null,
      },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Message;
}

function fakeClient(reply: Anthropic.Message | Error) {
  const create = vi.fn(
    async (
      _body: Anthropic.MessageCreateParamsNonStreaming,
      _options?: Anthropic.RequestOptions,
    ) => {
      if (reply instanceof Error) throw reply;
      return reply;
    },
  );
  const client: MessagesClient = { messages: { create } };
  return { client, create };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe('documentExtractor() — switched off until a key exists', () => {
  it('returns null with no key, exactly as before', () => {
    expect(documentExtractor({})).toBeNull();
    expect(documentExtractor({ ANTHROPIC_API_KEY: '   ' })).toBeNull();
    expect(documentExtractor({ DOCUMENT_EXTRACTOR: 'anthropic' })).toBeNull();
  });

  it('returns null when DOCUMENT_EXTRACTOR names anything but anthropic', () => {
    expect(
      documentExtractor({ ANTHROPIC_API_KEY: 'sk-test', DOCUMENT_EXTRACTOR: 'off' }),
    ).toBeNull();
    expect(
      documentExtractor({ ANTHROPIC_API_KEY: 'sk-test', DOCUMENT_EXTRACTOR: 'gemini' }),
    ).toBeNull();
  });

  it('selects Claude when the key is set (DOCUMENT_EXTRACTOR unset or anthropic)', () => {
    expect(documentExtractor({ ANTHROPIC_API_KEY: 'sk-test' })?.provider).toBe('anthropic');
    expect(
      documentExtractor({ ANTHROPIC_API_KEY: 'sk-test', DOCUMENT_EXTRACTOR: ' Anthropic ' })
        ?.provider,
    ).toBe('anthropic');
  });

  it('reads the effort setting', () => {
    expect(parseEffort(undefined)).toBe('medium');
    expect(parseEffort('low')).toBe('low');
    expect(parseEffort('OFF')).toBeNull();
    expect(parseEffort('bogus')).toBe('medium');
  });
});

describe('the request', () => {
  it('sends a PDF as a document block with the doc-type instruction and a JSON schema', async () => {
    const { client, create } = fakeClient(message(answer({ expiryDate: '2031-03-12' })));
    await createAnthropicExtractor({ client }).extract(input('passport'));

    const [body, options] = create.mock.calls[0]!;
    expect(body.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(body.output_config).toEqual({
      format: { type: 'json_schema', schema: ANSWER_SCHEMA },
      effort: 'medium',
    });
    expect(body.tool_choice).toBeUndefined();
    const content = body.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf' },
    });
    expect(content[1]).toMatchObject({ type: 'text' });
    expect((content[1] as Anthropic.TextBlockParam).text).toMatch(/passport/i);
    expect(options).toMatchObject({ timeout: 45_000, maxRetries: 1 });
  });

  it('sends a photo as an image block, typed from its own bytes', async () => {
    const { client, create } = fakeClient(message(answer({ expiryDate: '2030-01-31' })));
    await createAnthropicExtractor({ client, model: 'claude-opus-5', effort: null }).extract(
      input('visa_document', JPEG, 'application/octet-stream'),
    );
    const [body] = create.mock.calls[0]!;
    expect(body.model).toBe('claude-opus-5');
    expect(body.output_config).toEqual({ format: { type: 'json_schema', schema: ANSWER_SCHEMA } });
    const content = body.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg' },
    });
  });

  it('asks the term letter for holidays and the completion letter for date + institution', async () => {
    const { client, create } = fakeClient(message(answer({})));
    const extractor = createAnthropicExtractor({ client });
    await extractor.extract(input('university_term_dates_letter'));
    await extractor.extract(input('university_completion_letter'));
    const text = (i: number) =>
      (
        (
          create.mock.calls[i]![0].messages[0]!.content as Anthropic.ContentBlockParam[]
        )[1] as Anthropic.TextBlockParam
      ).text;
    expect(text(0)).toMatch(/vacation/i);
    expect(text(0)).toMatch(/inclusive/i);
    expect(text(1)).toMatch(/completionDate/);
    expect(text(1)).toMatch(/awardingInstitution/);
  });
});

describe('each document type maps 1:1 onto ExtractionResult', () => {
  it('passport / visa / status / national ID → expiryDate only', async () => {
    for (const docType of [
      'passport',
      'visa_document',
      'status_document',
      'national_id',
    ] as const) {
      const { client } = fakeClient(
        message(
          answer({
            expiryDate: '2031-03-12',
            // Fields another type would carry are ignored.
            completionDate: '2026-06-30',
            holidays: [{ from: '2026-12-19', to: '2027-01-04' }],
          }),
        ),
      );
      const result = await createAnthropicExtractor({ client }).extract(input(docType));
      expect(result).toMatchObject({
        expiryDate: '2031-03-12',
        holidays: null,
        completionDate: null,
        awardingInstitution: null,
        confidence: 0.95,
      });
      expect(result.raw).toMatchObject({ model: DEFAULT_ANTHROPIC_MODEL, docType, issues: [] });
    }
  });

  it('share code report → the right-to-work-until date as expiryDate', async () => {
    const { client } = fakeClient(message(answer({ expiryDate: '2028-09-30', confidence: 0.9 })));
    const result = await createAnthropicExtractor({ client }).extract(input('share_code_report'));
    expect(result.expiryDate).toBe('2028-09-30');
    expect(result.confidence).toBe(0.9);
  });

  it('term letter → sorted inclusive holiday ranges, no expiry', async () => {
    const { client } = fakeClient(
      message(
        answer({
          expiryDate: '2026-12-31',
          holidays: [
            { from: '2027-03-27', to: '2027-04-18' },
            { from: '2026-12-19', to: '2027-01-10' },
          ],
        }),
      ),
    );
    const result = await createAnthropicExtractor({ client }).extract(
      input('university_term_dates_letter'),
    );
    expect(result.expiryDate).toBeNull();
    expect(result.holidays).toEqual([
      { from: '2026-12-19', to: '2027-01-10' },
      { from: '2027-03-27', to: '2027-04-18' },
    ]);
    expect(result.confidence).toBe(0.95);
  });

  it('completion letter → completion date and awarding institution', async () => {
    const { client } = fakeClient(
      message(
        answer({
          completionDate: '2026-06-30',
          completionDateKind: 'completion',
          awardingInstitution: '  University of   Westminster ',
        }),
      ),
    );
    const result = await createAnthropicExtractor({ client }).extract(
      input('university_completion_letter'),
    );
    expect(result).toMatchObject({
      completionDate: '2026-06-30',
      awardingInstitution: 'University of Westminster',
      expiryDate: null,
      holidays: null,
      confidence: 0.95,
    });
  });

  it('birth certificate / NI evidence → nothing to pre-fill, confidence as read', async () => {
    for (const docType of ['birth_certificate', 'ni_evidence'] as const) {
      const { client } = fakeClient(message(answer({ expiryDate: '2031-01-01' })));
      const result = await createAnthropicExtractor({ client }).extract(input(docType));
      expect(result).toMatchObject({
        expiryDate: null,
        holidays: null,
        completionDate: null,
        awardingInstitution: null,
        confidence: 0.95,
      });
    }
  });
});

describe('bad dates and low confidence → manual review', () => {
  it('validates ISO calendar dates', () => {
    expect(isoDateOrNull('2028-02-29')).toBe('2028-02-29');
    expect(isoDateOrNull('2027-02-29')).toBeNull();
    expect(isoDateOrNull('2027-13-01')).toBeNull();
    expect(isoDateOrNull('2027-04-31')).toBeNull();
    expect(isoDateOrNull('31/12/2027')).toBeNull();
    expect(isoDateOrNull('2027-1-5')).toBeNull();
    expect(isoDateOrNull('1066-10-14')).toBeNull();
    expect(isoDateOrNull('9999-12-31')).toBeNull();
    expect(isoDateOrNull(20271231)).toBeNull();
    expect(isoDateOrNull(null)).toBeNull();
  });

  it('drops an impossible expiry and caps the confidence', async () => {
    const { client } = fakeClient(message(answer({ expiryDate: '2031-02-30' })));
    const result = await createAnthropicExtractor({ client }).extract(input('passport'));
    expect(result.expiryDate).toBeNull();
    expect(result.confidence).toBe(DOUBTFUL_CONFIDENCE);
    expect(result.raw['issues']).toEqual(['bad_expiry_date', 'no_expiry_date']);
  });

  it('keeps the good holiday ranges, drops the bad ones, caps the confidence', async () => {
    const { client } = fakeClient(
      message(
        answer({
          holidays: [
            { from: '2026-12-19', to: '2027-01-10' },
            { from: '2027-04-18', to: '2027-03-27' }, // backwards
            { from: '2027-06-31', to: '2027-09-20' }, // no 31 June
          ],
        }),
      ),
    );
    const result = await createAnthropicExtractor({ client }).extract(
      input('university_term_dates_letter'),
    );
    expect(result.holidays).toEqual([{ from: '2026-12-19', to: '2027-01-10' }]);
    expect(result.confidence).toBe(DOUBTFUL_CONFIDENCE);
  });

  it('caps the confidence when a needed field is missing', async () => {
    const { client } = fakeClient(
      message(answer({ completionDate: '2026-06-30', awardingInstitution: null })),
    );
    const result = await createAnthropicExtractor({ client }).extract(
      input('university_completion_letter'),
    );
    expect(result.completionDate).toBe('2026-06-30');
    expect(result.confidence).toBe(DOUBTFUL_CONFIDENCE);
  });

  it('passes a low model confidence straight through', async () => {
    const { client } = fakeClient(message(answer({ expiryDate: '2031-03-12', confidence: 0.42 })));
    const result = await createAnthropicExtractor({ client }).extract(input('passport'));
    expect(result.expiryDate).toBe('2031-03-12');
    expect(result.confidence).toBe(0.42);
  });

  it('treats an out-of-range confidence as zero', async () => {
    const { client } = fakeClient(message(answer({ expiryDate: '2031-03-12', confidence: 7 })));
    const result = await createAnthropicExtractor({ client }).extract(input('passport'));
    expect(result.confidence).toBe(0);
  });

  it('zeroes the confidence when the file is not the document asked for', async () => {
    const { client } = fakeClient(
      message(answer({ matchesDocType: false, expiryDate: '2031-03-12' })),
    );
    const result = await createAnthropicExtractor({ client }).extract(input('passport'));
    expect(result.confidence).toBe(0);
  });

  it('caps the confidence when the document is not legible', async () => {
    const { client } = fakeClient(message(answer({ legible: false, expiryDate: '2031-03-12' })));
    const result = await createAnthropicExtractor({ client }).extract(input('passport'));
    expect(result.confidence).toBe(DOUBTFUL_CONFIDENCE);
  });
});

describe('failures come back as a zero-confidence, all-null result', () => {
  const EMPTY = {
    expiryDate: null,
    holidays: null,
    completionDate: null,
    awardingInstitution: null,
    confidence: 0,
  };

  it.each([
    ['timeout', new Anthropic.APIConnectionTimeoutError({ message: SECRET_TEXT })],
    ['connection_error', new Anthropic.APIConnectionError({ message: SECRET_TEXT })],
    [
      'api_error_529',
      Anthropic.APIError.generate(
        529,
        { error: { message: SECRET_TEXT } },
        SECRET_TEXT,
        new Headers(),
      ),
    ],
    ['unexpected_error', new Error(SECRET_TEXT)],
  ])('%s', async (code, error) => {
    const { client } = fakeClient(error);
    const result = await createAnthropicExtractor({ client }).extract(input('passport'));
    expect(result).toMatchObject(EMPTY);
    expect(result.raw).toEqual({
      model: DEFAULT_ANTHROPIC_MODEL,
      docType: 'passport',
      error: code,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET_TEXT);
  });

  it('a refusal', async () => {
    const { client } = fakeClient(message(answer({}), 'refusal'));
    const result = await createAnthropicExtractor({ client }).extract(input('passport'));
    expect(result).toMatchObject(EMPTY);
    expect(result.raw['error']).toBe('stop_reason:refusal');
  });

  it('a truncated or non-JSON answer', async () => {
    const truncated = fakeClient(message('{"expiryDate": "2031', 'max_tokens'));
    expect(
      (await createAnthropicExtractor({ client: truncated.client }).extract(input('passport'))).raw[
        'error'
      ],
    ).toBe('stop_reason:max_tokens');

    const garbled = fakeClient(message(`not json ${SECRET_TEXT}`));
    const result = await createAnthropicExtractor({ client: garbled.client }).extract(
      input('passport'),
    );
    expect(result).toMatchObject(EMPTY);
    expect(result.raw['error']).toBe('unparseable_answer');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET_TEXT);
  });

  it('HEIC and oversized photos go to a person without calling the API', async () => {
    const { client, create } = fakeClient(message(answer({})));
    const extractor = createAnthropicExtractor({ client });

    const heic = await extractor.extract(input('passport', HEIC, 'image/heic'));
    expect(heic).toMatchObject(EMPTY);
    expect(heic.raw['error']).toBe('unsupported_input:heic');

    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set([0x89, 0x50, 0x4e, 0x47]);
    const large = await extractor.extract(
      input('passport', big.buffer as ArrayBuffer, 'image/png'),
    );
    expect(large.raw['error']).toBe('unsupported_input:image_too_large');

    expect(create).not.toHaveBeenCalled();
  });
});

describe('detectMedia', () => {
  it('trusts the bytes over the declared type', () => {
    expect(detectMedia(PDF, 'image/png')).toEqual({ kind: 'pdf' });
    expect(detectMedia(PNG, 'application/octet-stream')).toEqual({
      kind: 'image',
      mediaType: 'image/png',
    });
    expect(detectMedia(JPEG, '')).toEqual({ kind: 'image', mediaType: 'image/jpeg' });
    expect(detectMedia(HEIC, 'image/jpeg')).toEqual({ kind: 'unsupported', reason: 'heic' });
  });

  it('falls back to the declared type', () => {
    const blank = new ArrayBuffer(4);
    expect(detectMedia(blank, 'application/pdf')).toEqual({ kind: 'pdf' });
    expect(detectMedia(blank, 'image/jpg')).toEqual({ kind: 'image', mediaType: 'image/jpeg' });
    expect(detectMedia(blank, 'text/plain')).toEqual({
      kind: 'unsupported',
      reason: 'unknown_type',
    });
  });
});
