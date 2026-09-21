import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';

import { Avatar, AvatarGroup, Person, initials } from '../components/Avatar';
import { AuthCard } from '../components/AuthCard';
import { Button } from '../components/Button';
import { Checkbox, OptionRow, Radio, Switch } from '../components/Controls';
import {
  KpiTile,
  Rating,
  Score,
  SegBar,
  StatStrip,
  TileGrid,
  ratingTone,
} from '../components/Data';
import { DocRow } from '../components/DocRow';
import { Addon, Input, InputRow, SearchInput, Select, Slider, Textarea } from '../components/Input';
import { Kanban, KanbanCard, KanbanColumn } from '../components/Kanban';
import {
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
} from '../components/Mobile';
import { Modal, Toast } from '../components/Modal';
import { Alert, EmptyState, Note, Panel } from '../components/Panel';
import { Chip, Pill } from '../components/Pill';
import { SegToggle, Tabs } from '../components/SegToggle';
import {
  Content,
  PageHead,
  Shell,
  Sidebar,
  TableScroll,
  Topbar,
  UserChip,
} from '../components/Shell';
import { Progress, Stepper } from '../components/Stepper';

const html = (node: ReactElement) => renderToStaticMarkup(node);
const noop = () => {};

const TONES = ['cyan', 'green', 'amber', 'coral', 'purple'] as const;

/* -------------------------------------------------------------------------
   Snapshots. These lock the class contract: if a component starts emitting a
   class the stylesheets do not define, or stops emitting one they do, the
   snapshot moves and the diff says so.
   ------------------------------------------------------------------------- */

describe('Web/Button', () => {
  it('renders every tone, size and state', () => {
    expect(
      html(
        <div>
          <Button>Default</Button>
          <Button tone="primary">Primary</Button>
          <Button tone="outline">Outline</Button>
          <Button tone="purple">Auto-assign</Button>
          <Button tone="green">Verify</Button>
          <Button tone="amber">I&apos;m ready</Button>
          <Button tone="danger">Reject</Button>
          <Button tone="danger" solid>
            Cancel event
          </Button>
          <Button tone="ghost">Ghost</Button>
          <Button size="sm">Small</Button>
          <Button size="lg" block tone="primary">
            Check in
          </Button>
          <Button icon aria-label="Close">
            ×
          </Button>
          <Button disabled>Disabled</Button>
        </div>,
      ),
    ).toMatchSnapshot();
  });
});

describe('Web/Pill', () => {
  it('renders every tone, tinted and solid', () => {
    expect(
      html(
        <div>
          <Pill>Neutral</Pill>
          {TONES.map((tone) => (
            <Pill key={tone} tone={tone} dot>
              {tone}
            </Pill>
          ))}
          {TONES.map((tone) => (
            <Pill key={tone} tone={tone} solid>
              {tone}
            </Pill>
          ))}
          <Pill large tone="cyan">
            Large
          </Pill>
          <Chip>Black tie</Chip>
          <Chip tone="cyan">Qualified — Claridge&apos;s · Chef</Chip>
          <Chip tone="purple">Applied 2h ago</Chip>
          <Chip outline>Wave 2 — not qualified here</Chip>
        </div>,
      ),
    ).toMatchSnapshot();
  });
});

describe('Web/Sidebar and Web/Topbar', () => {
  it('renders the nav, the danger count and the identical active state', () => {
    expect(
      html(
        <Shell
          sidebar={
            <Sidebar
              activeHref="/dashboard"
              brand={
                <>
                  <span className="logo">THC</span>
                  <span>
                    <span className="name">The Hospitality Company</span>
                    <span className="sub">Back office</span>
                  </span>
                </>
              }
              items={[
                { href: '/dashboard', label: 'Dashboard' },
                { href: '/onboarding', label: 'Onboarding', count: 14 },
                { href: '/compliance', label: 'Compliance', count: 9, alert: true },
                { href: '/staff', label: 'Staff', dividerBefore: true },
              ]}
            />
          }
        >
          <Topbar
            title="Dashboard"
            timezone="All times UK (Europe/London)"
            actions={
              <UserChip>
                <Avatar name="Gisela Santos" size="sm" /> Gisela S.
              </UserChip>
            }
          />
          <Content>
            <PageHead title="Components" description="Gallery" />
          </Content>
        </Shell>,
      ),
    ).toMatchSnapshot();
  });
});

describe('Input', () => {
  it('renders the field shell, hints, errors and the welded addon', () => {
    expect(
      html(
        <div>
          <Input id="a" label="Start (UK time)" defaultValue="17:00" />
          <Input id="b" label="Share code" mono hint="9 characters beginning with W." />
          <Input id="c" label="Email" defaultValue="x" error="Enter a valid email address." />
          <Textarea id="d" label="Reason (required)" />
          <Select id="e" label="Role" defaultValue="waiter">
            <option value="waiter">Waiter</option>
          </Select>
          <SearchInput id="f" label="Search" />
          <InputRow>
            <Addon leading>£</Addon>
            <Input id="g" defaultValue="13.20" />
            <Addon>/h</Addon>
          </InputRow>
          <Slider value={250} min={100} max={3000} onChange={noop} label="Geofence radius" />
        </div>,
      ),
    ).toMatchSnapshot();
  });
});

describe('SegToggle', () => {
  it('renders segments, counts and tabs', () => {
    expect(
      html(
        <div>
          <SegToggle
            aria-label="Candidates"
            value="active"
            onChange={noop}
            options={[
              { value: 'active', label: 'Active', count: 38 },
              { value: 'rejected', label: 'Rejected', count: 4, alert: true },
            ]}
          />
          <SegToggle
            block
            small
            aria-label="Shifts"
            value="mine"
            onChange={noop}
            options={[
              { value: 'mine', label: 'My shifts', count: 2 },
              { value: 'open', label: 'Open shifts' },
            ]}
          />
          <Tabs
            aria-label="Portal"
            value="events"
            onChange={noop}
            options={[
              { value: 'events', label: 'My events' },
              { value: 'timesheets', label: 'Timesheets' },
            ]}
          />
        </div>,
      ),
    ).toMatchSnapshot();
  });
});

describe('DocRow', () => {
  it('renders every review state', () => {
    expect(
      html(
        <Panel title="Documents" flush>
          <DocRow title="Passport" meta="Expiry read by AI · 97%" state="verified" icon="PDF" />
          <DocRow title="University term dates" meta="62% · manual review" state="review" />
          <DocRow title="Proof of address" meta="Re-upload requested" state="rejected" />
          <DocRow title="Right to work" meta="Expired 3 Jan 2026" state="expired" />
          <DocRow title="Criminal convictions declaration" meta="Answered Yes" state="pending" />
        </Panel>,
      ),
    ).toMatchSnapshot();
  });
});

describe('AppHeader and Staff App chrome', () => {
  it('keeps the logo left and the avatar right, collapsed or not', () => {
    expect(
      html(
        <AppFrame>
          <StatusBar />
          <AppHeader
            brand={<span className="logo sm">THC</span>}
            title="Shifts"
            actions={<Avatar name="Joy Nwosu" size="sm" />}
            below={
              <SegToggle
                block
                aria-label="Shifts"
                value="mine"
                onChange={noop}
                options={[
                  { value: 'mine', label: 'My shifts', count: 2 },
                  { value: 'open', label: 'Open shifts' },
                ]}
              />
            }
          />
          <AppHeader
            collapsed
            brand={<span className="logo sm">THC</span>}
            title="Shifts"
            actions={<Avatar name="Joy Nwosu" size="sm" />}
          />
          <AppBody>
            <MobileCard
              tone="today"
              title="Autumn Partners Dinner"
              meta="Claridge's · The Ballroom"
              badge={<Pill tone="cyan">Today</Pill>}
            >
              <StatStrip
                stats={[
                  { label: 'Your hours', value: '17:00 – 23:30' },
                  { label: 'Role', value: 'Waiting Staff' },
                  { label: 'Rate', value: '£13.20/h' },
                ]}
              />
              <GpsChip inside>GPS on site</GpsChip>
              <Timer>2:14</Timer>
              <Button tone="primary" size="lg" block>
                Check in — opens 16:30
              </Button>
            </MobileCard>
            <MobileList>
              <MobileRow right="›">Profile details</MobileRow>
              <MobileRow right="›">Payment information</MobileRow>
            </MobileList>
            <WizardHeader step={1} total={11} title="Your right to work" />
            <StaticScreen title="Your account is on hold">
              Please contact us at admin@thehospitalitycompany.co.uk
            </StaticScreen>
          </AppBody>
          <Sheet open onClose={noop} label="Profile">
            <Person name="Joy Nwosu" sub="Employee ID 10318" size="lg" />
          </Sheet>
          <BottomNav
            activeHref="/shifts"
            items={[
              { href: '/documents', label: 'Documents' },
              { href: '/shifts', label: 'Shifts' },
              { href: '/invites', label: 'Invites', count: 3 },
              { href: '/radar', label: 'Radar', locked: true },
            ]}
          />
        </AppFrame>,
      ),
    ).toMatchSnapshot();
  });

  it('renders the gallery phone frame', () => {
    expect(
      html(
        <PhoneRow>
          <PhoneFrame caption="M1 Shifts" short>
            <AppBody>shift</AppBody>
          </PhoneFrame>
        </PhoneRow>,
      ),
    ).toMatchSnapshot();
  });
});

describe('panels, status and metrics', () => {
  it('renders panels, notes, alerts, toasts, progress and empty states', () => {
    expect(
      html(
        <div>
          <Panel title="This week" actions={<Pill tone="green">Full</Pill>}>
            <Note tone="cyan">
              Allocation reads <code>6 (+1)</code>, never <code>7</code>.
            </Note>
            <Alert tone="amber">Unresolved No check-out.</Alert>
            <Toast tone="green">Document verified.</Toast>
            <Progress value={9} max={12} />
            <Progress value={5} max={12} tone="amber" />
            <SegBar segments={['ok', 'ok', 'pending', 'empty', 'empty']} />
            <EmptyState>No events on this day.</EmptyState>
          </Panel>
          <TableScroll>
            <table className="tbl">
              <tbody>
                <tr className="clickable">
                  <td>Claridge&apos;s</td>
                  <td className="num">+£10.75/h</td>
                </tr>
              </tbody>
            </table>
          </TableScroll>
          <TileGrid columns={4}>
            <KpiTile
              label="Open positions"
              value="47"
              description="Sold, not staffed"
              tone="warn"
            />
            <KpiTile label="Compliance blocks" value="9" tone="danger" flat small />
          </TileGrid>
          <Score value={94} />
          <Score value={94} wave2 />
          <Rating value={4.8} />
          <Rating value={3.4} />
          <Rating value={2.1} />
        </div>,
      ),
    ).toMatchSnapshot();
  });
});

describe('controls, people and pipeline', () => {
  it('renders switches, markers, avatars and the kanban', () => {
    expect(
      html(
        <div>
          <Switch checked onChange={noop} label="Auto-Assign" purple />
          <Switch checked={false} onChange={noop} label="Off" />
          <Checkbox checked onChange={noop}>
            Breaks are unpaid
          </Checkbox>
          <Radio checked={false} onChange={noop}>
            International student
          </Radio>
          <OptionRow
            selected
            title="International student"
            description="You have a visa with a weekly hours limit."
            onSelect={noop}
          />
          <Avatar name="Amira Khan" size="sm" />
          <Avatar name="Jonah Whitfield" />
          <Avatar name="Priya Raman" size="lg" />
          <Avatar name="Priya Raman" size="xl" src="/selfie.jpg" />
          <Avatar name="Deleted account #8841" deleted />
          <AvatarGroup>
            <Avatar name="Amira Khan" />
            <Avatar name="Jonah Whitfield" />
          </AvatarGroup>
          <Person name="Joy Nwosu" sub="Waiting Staff · ★4.8" />
          <Stepper
            current={2}
            steps={[{ label: 'Right to work' }, { label: 'Documents' }, { label: 'Quiz · locked' }]}
          />
          <Kanban>
            <KanbanColumn title="Interview requested" count={6} accent>
              <KanbanCard onOpen={noop}>Amira Khan</KanbanCard>
              <KanbanCard returning>Matches Employee ID 10442</KanbanCard>
            </KanbanColumn>
          </Kanban>
        </div>,
      ),
    ).toMatchSnapshot();
  });
});

describe('modal and auth card', () => {
  it('renders the dialog and the shared sign-in card', () => {
    expect(
      html(
        <div>
          <Modal open title="Delete venue" onClose={noop} footer={<Button>Cancel</Button>}>
            Two upcoming events use this venue.
          </Modal>
          <AuthCard product="Back Office" footer="Trouble signing in? Contact the office.">
            <Input id="email" label="Email" />
          </AuthCard>
        </div>,
      ),
    ).toMatchSnapshot();
  });
});

describe('initials and rating bands', () => {
  it('falls back to a monogram', () => {
    expect(initials('Amira Khan')).toBe('AK');
    expect(initials('Deleted account #8841')).toBe('DA');
    expect(initials('   ')).toBe('?');
  });

  it('colour-codes ratings the way §9.6 says', () => {
    expect(ratingTone(2.9)).toBe('coral');
    expect(ratingTone(3.0)).toBe('amber');
    expect(ratingTone(3.9)).toBe('amber');
    expect(ratingTone(4.0)).toBe('green');
  });
});
