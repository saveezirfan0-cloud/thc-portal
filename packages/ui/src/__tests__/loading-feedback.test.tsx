// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from '../components/Button';
import { NavProgress, startNavProgress } from '../components/NavProgress';

afterEach(cleanup);

describe('Button loading', () => {
  it('shows a spinner, is busy and cannot be pressed twice', () => {
    const markup = renderToStaticMarkup(<Button loading>Saving…</Button>);
    expect(markup).toContain('class="btn loading"');
    expect(markup).toContain('class="spin"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('disabled=""');
  });

  it('is an ordinary button when it is not loading', () => {
    const markup = renderToStaticMarkup(<Button>Save</Button>);
    expect(markup).not.toContain('spin');
    expect(markup).not.toContain('aria-busy');
    expect(markup).not.toContain('disabled');
  });

  it('keeps a separate disabled state', () => {
    expect(renderToStaticMarkup(<Button disabled>Save</Button>)).toContain('disabled=""');
  });
});

describe('NavProgress', () => {
  const bar = () => document.querySelector('.nav-progress');

  it('starts on an internal link click, marks the link, and clears when the route changes', async () => {
    const { rerender } = render(
      <>
        <NavProgress routeKey="/a?" />
        <a href="/b" onClick={(event) => event.preventDefault()}>
          Go
        </a>
      </>,
    );
    expect(bar()?.getAttribute('data-busy')).toBeNull();

    await userEvent.click(screen.getByText('Go'));
    expect(bar()?.getAttribute('data-busy')).toBe('true');
    expect(screen.getByText('Go').getAttribute('data-pending')).toBe('true');

    rerender(
      <>
        <NavProgress routeKey="/b?" />
        <a href="/b">Go</a>
      </>,
    );
    expect(bar()?.getAttribute('data-busy')).toBeNull();
    expect(document.querySelector('[data-pending]')).toBeNull();
  });

  it('ignores a link to the page it is on, an external link and a new-tab link', async () => {
    render(
      <>
        <NavProgress routeKey="/a?" />
        <a
          href={window.location.pathname + window.location.search}
          onClick={(e) => e.preventDefault()}
        >
          Same
        </a>
        <a href="https://example.com/x" onClick={(e) => e.preventDefault()}>
          Away
        </a>
        <a href="/c" target="_blank" onClick={(e) => e.preventDefault()}>
          Tab
        </a>
      </>,
    );
    for (const name of ['Same', 'Away', 'Tab']) await userEvent.click(screen.getByText(name));
    expect(bar()?.getAttribute('data-busy')).toBeNull();
  });

  it('starts for navigation that is not a link', () => {
    render(<NavProgress routeKey="/a?" />);
    act(() => startNavProgress());
    expect(bar()?.getAttribute('data-busy')).toBe('true');
  });
});
