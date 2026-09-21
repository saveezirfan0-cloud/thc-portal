'use client';

import { SegToggle, useAppearance } from '@thc/ui';
import type { Mode } from '@thc/ui';

const OPTIONS = [
  { value: 'light' as const, label: 'Light' },
  { value: 'dark' as const, label: 'Dark' },
];

/** ADR-0007: one switch, and it changes the ground only — both grounds
 *  render the same rounded look. */
export function ModeSwitch() {
  const { mode, setMode } = useAppearance();
  return (
    <SegToggle<Mode> options={OPTIONS} value={mode} onChange={setMode} aria-label="Appearance" />
  );
}
