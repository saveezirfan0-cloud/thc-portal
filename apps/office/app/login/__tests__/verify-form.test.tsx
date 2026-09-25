import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/** The code step's field (ADR-0037): a phone offers its keypad and the code. */
vi.mock('../verify/actions', () => ({ verifyTwoStep: async () => null }));

const { VerifyForm } = await import('../verify/VerifyForm');

describe('VerifyForm', () => {
  const markup = renderToStaticMarkup(<VerifyForm next="/events/42" intro="Type the code." />);
  const input = markup.match(/<input [^>]*name="code"[^>]*>/)?.[0] ?? '';

  it('is a numeric one-time-code field', () => {
    expect(input).toContain('inputMode="numeric"');
    expect(input).toContain('autoComplete="one-time-code"');
    expect(input).toContain('required=""');
  });

  it('carries next through', () => {
    expect(markup).toContain('<input type="hidden" name="next" value="/events/42"/>');
  });

  it('has no next field when there is nowhere special to go', () => {
    expect(renderToStaticMarkup(<VerifyForm intro="x" />)).not.toContain('name="next"');
  });
});
