import { AppBody, AppHeader, BottomNav, MobileCard } from '@thc/ui';

/** Staff App (PWA). Wireframes: wireframes/staff/*.html (ADR-0001). */
const NAV = [
  { href: '/', label: 'Shifts' },
  { href: '/invites', label: 'Invites', pending: true },
  { href: '/radar', label: 'Radar', pending: true },
  { href: '/documents', label: 'Documents', pending: true },
  { href: '/profile', label: 'Profile', pending: true },
];

export default function Page() {
  return (
    <>
      <AppHeader title="Shifts" sub="Phase 0 shell" />
      <AppBody>
        <MobileCard title="Foundation">
          The Staff App is an installable PWA (ADR-0001). Screens land in Phases 1, 3, 4 and 5.
        </MobileCard>
      </AppBody>
      <BottomNav items={NAV} activeHref="/" />
    </>
  );
}
