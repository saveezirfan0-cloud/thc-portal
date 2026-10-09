import { renderToReadableStream, renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { OfficeShell } = await import('../OfficeShell');
const { NavCountsProvider } = await import('../OfficeSidebar');
const { SignedInAsProvider } = await import('../SignedInAs');

/**
 * The root layout no longer waits for the operator or the menu counters: it
 * hands the shell promises, and the page below starts at once. The shell
 * must therefore (a) draw without them, and (b) draw them when they arrive.
 */
async function streamed(node: React.ReactNode): Promise<string> {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

const page = (
  <OfficeShell activeHref="/staff" title="Staff">
    <p>the page body</p>
  </OfficeShell>
);

describe("the shell while the layout's lookups are still running", () => {
  it('draws the page and the brand, with no menu, instead of waiting', () => {
    const never = new Promise<never>(() => {});
    const markup = renderToString(
      <SignedInAsProvider user={never}>
        <NavCountsProvider counts={never}>{page}</NavCountsProvider>
      </SignedInAsProvider>,
    );
    expect(markup).toContain('the page body');
    expect(markup).toContain('The Hospitality Company');
    expect(markup).not.toContain('Compliance');
    expect(markup).not.toContain('Reports');
  });
});

describe('the shell once they arrive', () => {
  it('draws the menu, the counter and the operator', async () => {
    const markup = await streamed(
      <SignedInAsProvider
        user={Promise.resolve({ name: 'Ada Admin', role: 'Owner', officeRole: 'owner' as const })}
      >
        <NavCountsProvider counts={Promise.resolve({ '/compliance': 7 })}>{page}</NavCountsProvider>
      </SignedInAsProvider>,
    );
    expect(markup).toContain('Compliance');
    expect(markup).toContain('>7<');
    expect(markup).toContain('Ada Admin');
    expect(markup).toContain('the page body');
  });

  it('still hides what a scheduler cannot use (ADR-0056)', async () => {
    const markup = await streamed(
      <SignedInAsProvider
        user={Promise.resolve({ name: 'Sam', role: 'Scheduler', officeRole: 'scheduler' as const })}
      >
        <NavCountsProvider counts={Promise.resolve({})}>{page}</NavCountsProvider>
      </SignedInAsProvider>,
    );
    expect(markup).toContain('Compliance');
    expect(markup).not.toContain('Reports');
  });

  it('shows the read-only banner to a viewer', async () => {
    const markup = await streamed(
      <SignedInAsProvider
        user={Promise.resolve({ name: 'Vic', role: 'Viewer', officeRole: 'viewer' as const })}
      >
        <NavCountsProvider counts={Promise.resolve({})}>{page}</NavCountsProvider>
      </SignedInAsProvider>,
    );
    expect(markup).toContain('Read-only access');
  });

  it('a failed lookup is a menu without a name, not a broken page', async () => {
    const markup = await streamed(
      <SignedInAsProvider user={Promise.resolve(null)}>
        <NavCountsProvider counts={Promise.resolve({})}>{page}</NavCountsProvider>
      </SignedInAsProvider>,
    );
    expect(markup).toContain('the page body');
    expect(markup).toContain('Compliance');
  });
});
