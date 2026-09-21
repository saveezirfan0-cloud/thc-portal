'use client';

import { SegToggle, useAppearance } from '@thc/ui';
import type { Mode } from '@thc/ui';

const OPTIONS = [
  { value: 'light' as const, label: 'Light · Warm' },
  { value: 'dark' as const, label: 'Dark · Scope §1.6' },
];

/** ADR-0003: one switch. Light renders Warm, dark renders the Scope §1.6 look. */
export function ModeSwitch() {
  const { mode, setMode } = useAppearance();
  return (
    <SegToggle<Mode> options={OPTIONS} value={mode} onChange={setMode} aria-label="Appearance" />
  );
}
