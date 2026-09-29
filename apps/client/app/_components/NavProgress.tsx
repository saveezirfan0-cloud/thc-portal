'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { NavProgress as Bar } from '@thc/ui';

/** The shared loading bar (packages/ui), told where the app is now. */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return <Bar routeKey={`${pathname}?${search}`} />;
}
