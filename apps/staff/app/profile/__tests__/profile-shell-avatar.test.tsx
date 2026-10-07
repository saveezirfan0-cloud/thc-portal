import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ClampTitle } from '../../_components/ClampTitle';
import { ProfileShell } from '../_components/ProfileShell';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/profile/security' }));

describe('the profile screens’ header avatar', () => {
  const shell = (lock: 'none' | 'hold', nav = true) =>
    renderToStaticMarkup(
      <ProfileShell
        title="Security settings"
        back={{ href: '/profile', label: 'Profile' }}
        lock={lock}
        name="Priya R."
        nav={nav}
      >
        x
      </ProfileShell>,
    );

  it('is the same link into /profile as the tab screens’ header, with its 44 px target', () => {
    expect(shell('none')).toMatch(
      /<a href="\/profile" class="avatar-btn" aria-label="Your profile"><span[^>]*avatar/,
    );
  });

  it('is a plain avatar when the account could not be read (no nav, fail closed)', () => {
    expect(shell('none', false)).not.toContain('avatar-btn');
  });
});

describe('ClampTitle', () => {
  it('keeps the whole text in the title attribute for the two-line clamp', () => {
    const html = renderToStaticMarkup(<ClampTitle>Gala · Captain</ClampTitle>);
    expect(html).toBe('<span class="title-clamp" title="Gala · Captain">Gala · Captain</span>');
  });
});
