'use client';

import { SegToggle, useAppearance } from '@thc/ui';
import type { Mode } from '@thc/ui';

const OPTIONS = [
  { value: 'light' as const, label: 'Light · Scope §1.6' },
  { value: 'dark' as const, label: 'Dark · Fluid' },
];

/** ADR-0007: one switch. Light renders the Scope §1.6 look, dark renders Fluid. */
export function ModeSwitch() {
  const { mode, setMode } = useAppearance();
  return (
    <SegToggle<Mode> options={OPTIONS} value={mode} onChange={setMode} aria-label="Appearance" />
  );
}
