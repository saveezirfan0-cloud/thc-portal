export { Button } from './components/Button';
export type { ButtonProps, ButtonSize, ButtonTone } from './components/Button';

export { Chip, Pill } from './components/Pill';
export type { ChipProps, PillProps, Tone } from './components/Pill';

export { Addon, Input, InputRow, SearchInput, Select, Slider, Textarea } from './components/Input';
export type { InputProps, SelectProps, SliderProps, TextareaProps } from './components/Input';

export { Kanban, KanbanCard, KanbanColumn } from './components/Kanban';

export { Logo, LogoMark } from './components/Logo';
export type { LogoMarkProps, LogoProps } from './components/Logo';

export { Avatar, AvatarGroup, Person, initials } from './components/Avatar';
export type { AvatarGroupProps, AvatarProps } from './components/Avatar';

export { PasswordRules } from './components/PasswordRules';
export type { PasswordRuleState, PasswordRulesProps } from './components/PasswordRules';

export { Content, PageHead, Shell, Sidebar, Topbar, UserChip } from './components/Shell';
export type { NavItem, PageHeadProps, SidebarProps, TopbarProps } from './components/Shell';
export { TableScroll } from './components/Table';
export type { TableScrollProps } from './components/Table';
export {
  ColumnCells,
  ColumnCellsFor,
  ColumnChooser,
  ColumnChooserFor,
  ColumnHeads,
  ColumnHeadsFor,
  ColumnPrefsProvider,
  TableScrollFor,
  useColumns,
} from './components/ColumnChooser';
export type {
  ColumnChooserProps,
  ColumnListProps,
  ColumnPrefsSource,
  Columns,
  SaveColumnPref,
  UseColumnsOptions,
} from './components/ColumnChooser';
// Server-safe: a plain module, so a server action can validate a stored choice.
export {
  COLUMN_ID_PATTERN,
  LIST_KEY_PATTERN,
  MAX_COLUMNS_PER_LIST,
  columnRem,
  isDefaultLayout,
  moveColumnTo,
  normaliseColumnPref,
  normaliseColumnPrefs,
  offeredColumns,
  prefOf,
  resolveColumns,
  scaledMinWidth,
  setColumnVisible,
  widthClass,
} from './components/columns';
export type {
  ColumnDef,
  ColumnPref,
  ColumnPrefs,
  ColumnWidth,
  ResolvedColumn,
} from './components/columns';
export { MenuButton } from './components/MenuButton';
export type { MenuButtonProps } from './components/MenuButton';

export { Alert, EmptyState, Note, Panel } from './components/Panel';
export type { NoteTone, PanelProps } from './components/Panel';

export { PhoneNav } from './components/PhoneNav';
export type { PhoneNavProps } from './components/PhoneNav';

export { ModeSwitch } from './components/ModeSwitch';
export type { ModeSwitchProps } from './components/ModeSwitch';

export { SegToggle, Tabs } from './components/SegToggle';
export type { SegOption, SegToggleProps } from './components/SegToggle';

export { Progress, Stepper } from './components/Stepper';
export type { Step, StepperProps } from './components/Stepper';

export { KpiTile, Rating, Score, SegBar, StatStrip, TileGrid, ratingTone } from './components/Data';
export type { KpiTileProps, MetricTone, SegState, Stat } from './components/Data';

export { Checkbox, OptionRow, Radio, RadioGroup, Switch } from './components/Controls';
export type {
  CheckProps,
  OptionRowProps,
  RadioGroupProps,
  SwitchProps,
} from './components/Controls';

export { SaveBar } from './components/SaveBar';
export type { SaveBarProps } from './components/SaveBar';

export {
  Skeleton,
  SkeletonKpis,
  SkeletonPanel,
  SkeletonScreen,
  SkeletonText,
  SkeletonToolbar,
} from './components/Skeleton';
export type { SkeletonProps, SkeletonShape } from './components/Skeleton';

export { DocRow } from './components/DocRow';
export type { DocRowProps, DocState } from './components/DocRow';

export { AuthCard } from './components/AuthCard';
export type { AuthCardProps } from './components/AuthCard';

export { TimeFormatProvider, TimeField, useTimeFormat } from './components/TimeFormat';
export type { TimeFieldProps } from './components/TimeFormat';

export { ScheduledWindow, useViewerZone } from './components/ScheduledWindow';
export type { ScheduledWindowProps } from './components/ScheduledWindow';

export { SignOut } from './components/SignOut';
export type { SignOutProps } from './components/SignOut';

export { Modal, Toast } from './components/Modal';
export type { ModalProps, ToastTone } from './components/Modal';
export { Toaster, dismissToast, toast } from './components/Toaster';
export type { ToastOptions } from './components/Toaster';
export { useUnsavedChanges } from './components/UnsavedChanges';
export type { UnsavedChanges, UnsavedChangesOptions } from './components/UnsavedChanges';

export {
  AppBody,
  AppFrame,
  AppHeader,
  BottomNav,
  GpsChip,
  MobileCard,
  MobileList,
  MobileRow,
  PhoneFrame,
  PhoneRow,
  Sheet,
  StaticScreen,
  StatusBar,
  Timer,
  WizardHeader,
  useCollapsedHeader,
} from './components/Mobile';
export type {
  AppHeaderProps,
  BottomNavItem,
  MobileCardProps,
  MobileCardTone,
} from './components/Mobile';

export {
  AppearanceScript,
  MODE_STORAGE_KEY,
  applyMode,
  appearanceScript,
  resolveMode,
  styleForMode,
  useAppearance,
} from './components/Appearance';
export type { Mode } from './components/Appearance';
// Server-safe: a plain module, so a root layout's `viewport` and an app's
// manifest.ts get the strings (Appearance.tsx is 'use client').
export { THEME_COLOR } from './components/theme-color';

export { useVisibleInterval } from './components/AutoRefresh';
