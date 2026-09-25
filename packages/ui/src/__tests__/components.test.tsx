import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';

import { Avatar, AvatarGroup, Person, initials } from '../components/Avatar';
import { AuthCard } from '../components/AuthCard';
import { Button } from '../components/Button';
import { Checkbox, OptionRow, Radio, RadioGroup, Switch } from '../components/Controls';
import { SignOut } from '../components/SignOut';
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
import { Logo, LogoMark } from '../components/Logo';
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

/* The inlined logo is ~1.6kB of path coordinates that says nothing about a
   class contract, and that the component and brand/thc-mark.svg agree is
   asserted directly below. Collapse it so a snapshot diff stays readable. */
const html = (node: ReactElement) => renderToStaticMarkup(node).replace(/ d="[^"]+"/g, ' d="…"');
const noop = () => {};

const TONES = ['cyan', 'green', 'amber', 'coral', 'purple'] as const;

/* -------------------------------------------------------------------------
   Snapshots. These lock the class contract: if a component starts emitting a
   class the stylesheets do not define, or stops emitting one they do, the
   snapshot moves and the diff says so.
   ------------------------------------------------------------------------- */

describe('Logo', () => {
  it('renders the real mark in the tile, at every size', () => {
    expect(
      html(
        <>
          <Logo size="sm" />
          <Logo />
          <Logo size="lg" />
          <LogoMark label="The Hospitality Company" />
        </>,
      ),
    ).toMatchSnapshot();
  });

  it('inlines brand/thc-mark.svg rather than drifting from it', () => {
    // The mark was cut out of the stacked lockup by hand (brand/README.md).
    // If THC supply a new logo that work has to be redone and this file
    // regenerated — so the guard is that the two agree, not that either is
    // some particular shape.
    const svg = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        '..',
        '..',
        'brand',
        'thc-mark.svg',
      ),
      'utf8',
    );
    const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]!);
    expect(paths).toHaveLength(2);

    const rendered = renderToStaticMarkup(<LogoMark />);
    for (const d of paths) expect(rendered).toContain(d);
    expect(rendered).toContain(`viewBox="${/viewBox="([^"]+)"/.exec(svg)![1]}"`);
    // Neither file names a colour: one mark, every ground, both themes.
    expect(rendered).toContain('fill="currentColor"');
    expect(rendered).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('is decorative unless it is given a label', () => {
    // The company name is written next to the mark everywhere it appears, so
    // announcing it twice is noise.
    expect(html(<Logo />)).toContain('aria-hidden="true"');
    expect(html(<Logo />)).not.toContain('aria-label');
    expect(html(<LogoMark label="THC" />)).toContain('aria-label="THC"');
  });
});

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
          <Button tone="link">Link</Button>
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
                  <Logo />
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
          <Input id="h" label="Password" type="password" reveal />
        </div>,
      ),
    ).toMatchSnapshot();
  });

  it('welds a "Show" toggle to a password field and keeps it a password until pressed (§1.4)', () => {
    // wireframes/client/login.html:64 — `.input-row` with the addon on the
    // right. The first paint is the masked field: revealing is the reader's
    // act, never the default.
    const markup = html(<Input id="pw" label="Password" type="password" reveal />);
    expect(markup).toContain(
      '<div class="input-row"><input type="password" id="pw" class="input"/>',
    );
    expect(markup).toContain(
      '<button type="button" class="addon" style="cursor:pointer" aria-pressed="false" aria-controls="pw">Show</button>',
    );
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
            brand={<Logo size="sm" />}
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
            brand={<Logo size="sm" />}
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
          {/* Grouped radios: one shared `name` is what gives the arrow keys
              and the single tab stop (D1, §1.2). */}
          <RadioGroup className="wiz-choices" aria-label="Right to work" name="rtw">
            <Radio checked onChange={noop}>
              UK / Irish citizen
            </Radio>
            <Radio checked={false} onChange={noop}>
              International student
            </Radio>
          </RadioGroup>
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

  it('renders the public card without the appearance switch', () => {
    expect(
      html(
        <AuthCard
          product="Account activation"
          heading="Welcome — set your password"
          appearance="none"
        >
          <Input id="password" label="Password" type="password" />
        </AuthCard>,
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

describe('SignOut', () => {
  /**
   * The regression this guards is the one that shipped: `/auth/signout`
   * answers POST only, both call sites used a link, and every click on a
   * Sign out button in the product returned 405. All three apps now get the
   * control from here, so pinning it here pins it everywhere.
   */
  it('submits by POST and is never a link', () => {
    const html = renderToStaticMarkup(<SignOut />);
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/auth/signout"');
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('<a ');
  });

  it("puts the caller's class on the button, not the display:contents form", () => {
    // A margin or alignment class on the form would do nothing: it generates
    // no box. The Back Office's `ml-auto` depends on this.
    const html = renderToStaticMarkup(<SignOut className="ml-auto" />);
    expect(html).toMatch(/<form[^>]*class="signout"/);
    expect(html).not.toMatch(/<form[^>]*class="[^"]*ml-auto/);
    expect(html).toMatch(/<button[^>]*class="[^"]*ml-auto[^"]*"/);
  });
});
