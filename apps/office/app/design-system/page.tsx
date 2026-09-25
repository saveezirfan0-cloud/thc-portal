import {
  Addon,
  Alert,
  AppBody,
  AppHeader,
  Avatar,
  AvatarGroup,
  BottomNav,
  Button,
  Chip,
  Content,
  DocRow,
  EmptyState,
  GpsChip,
  Input,
  InputRow,
  Kanban,
  KanbanCard,
  KanbanColumn,
  KpiTile,
  Logo,
  MobileCard,
  MobileList,
  MobileRow,
  ModeSwitch,
  Note,
  PageHead,
  Panel,
  Person,
  PhoneFrame,
  PhoneRow,
  Pill,
  Progress,
  Rating,
  Score,
  SearchInput,
  SegBar,
  Select,
  StatStrip,
  StaticScreen,
  StatusBar,
  Stepper,
  TableScroll,
  TileGrid,
  Textarea,
  Timer,
  Toast,
  Topbar,
  UserChip,
  WizardHeader,
} from '@thc/ui';
import { InteractiveControls, Overlays } from './Interactive';
import './design-system.css';

/**
 * The live design system. This route is the acceptance reference for
 * `packages/ui`: if something looks wrong here it is wrong everywhere.
 *
 * It is derived from the four boards in `design-handoff/`. Light and dark
 * both render the rounded look — light on the warm ground, dark on navy
 * (ADR-0007). The §1.6 literal rendering is `data-style="scope"`, set by
 * hand, never by the switch. Every element below reads tokens only — no
 * page in this repo may hard-code a colour or a radius.
 */
const TONES = ['cyan', 'green', 'amber', 'coral', 'purple'] as const;

const GROUND = ['--canvas', '--bg', '--panel', '--panel-2', '--line'] as const;
const ROLE = ['--cyan', '--purple', '--green', '--amber', '--coral'] as const;
const INK = ['--text', '--muted', '--cyan-ink', '--green-ink', '--amber-ink', '--coral-ink'];

const SHAPES: [string, string][] = [
  ['--r-card', 'Cards'],
  ['--r-tile', 'Tiles'],
  ['--r-control', 'Controls'],
  ['--r-pill', 'Pills'],
  ['--r-avatar', 'Avatars'],
  ['--r-logo', 'Logo'],
];

const TYPE: [string, string][] = [
  ['--fs-40', 'KPI value'],
  ['--fs-26', 'Mobile title'],
  ['--fs-24', 'Page title'],
  ['--fs-20', 'Top bar'],
  ['--fs-16', 'Panel heading'],
  ['--fs-13', 'Body'],
  ['--fs-11', 'Meta'],
];

export default function Page() {
  return (
    <>
      <Topbar
        title="Design system"
        timezone="All times UK (Europe/London)"
        actions={
          <>
            <ModeSwitch />
            <UserChip>
              <Avatar name="Gisela Santos" size="sm" />
              Gisela S.
            </UserChip>
          </>
        }
      />
      <Content>
        <PageHead
          title="Components"
          description="Derived from design-handoff/ and the ADR-0007 boards. Two token axes; the switch moves the theme only, because every supplied board is the same rounded language on a different ground."
        />

        {/* ---------------- tokens ---------------- */}
        <Panel title="Colour">
          <span className="label">Ground</span>
          <div className="ds-swatches mt-8">
            {GROUND.map((name) => (
              <div className="ds-swatch" key={name}>
                <div className="chipbox" style={{ background: `var(${name})` }} />
                <span className="n">{name}</span>
              </div>
            ))}
          </div>
          <hr />
          <span className="label">Roles — purple is reserved for Auto-Assign, coral is danger</span>
          <div className="ds-swatches mt-8">
            {ROLE.map((name) => (
              <div className="ds-swatch" key={name}>
                <div className="chipbox" style={{ background: `var(${name})` }} />
                <span className="n">{name}</span>
              </div>
            ))}
          </div>
          <hr />
          <span className="label">Ink — the tone used for text on the current ground</span>
          <div className="ds-swatches mt-8">
            {INK.map((name) => (
              <div className="ds-swatch" key={name}>
                <div
                  className="chipbox"
                  style={{
                    background: 'var(--panel)',
                    color: `var(${name})`,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  Aa
                </div>
                <span className="n">{name}</span>
              </div>
            ))}
          </div>
          <hr />
          <Note>
            Light is <b>not</b> a mechanical inversion: raw cyan fails contrast on a light ground,
            so deep teal carries the accent and the neutrals are warmed. Every ink tone here clears
            4.5:1 on the panel, on the page ground and on its own tinted fill.
          </Note>
        </Panel>

        <Panel title="Shape and type">
          <span className="label">
            Radius — the fluid scale in both themes; zero only in the §1.6 rendering
          </span>
          <div className="ds-shapes mt-8">
            {SHAPES.map(([token, label]) => (
              <div className="ds-shape" key={token} style={{ borderRadius: `var(${token})` }}>
                {label}
              </div>
            ))}
          </div>
          <hr />
          <div className="ds-type">
            {TYPE.map(([token, label]) => (
              <div key={token}>
                <span className="k">{label}</span>
                <span style={{ fontFamily: 'var(--font-head)', fontSize: `var(${token})` }}>
                  The Hospitality Company
                </span>
              </div>
            ))}
            <div>
              <span className="k">Label</span>
              <span className="label">Open positions · uppercase mono in scope</span>
            </div>
            <div>
              <span className="k">Mono</span>
              <span className="mono">17:00 – 23:30 · £13.20/h · 6 (+1)</span>
            </div>
          </div>
        </Panel>

        {/* ---------------- buttons ---------------- */}
        <Panel title="Buttons">
          <div className="toolbar">
            <Button tone="primary">Primary</Button>
            <Button>Default</Button>
            <Button tone="outline">Outline</Button>
            <Button tone="purple">Auto-assign</Button>
            <Button tone="green">Verify</Button>
            <Button tone="amber">I&apos;m ready — confirm</Button>
            <Button tone="danger">Reject candidate</Button>
            <Button tone="danger" solid>
              Cancel event
            </Button>
            <Button tone="ghost">Ghost</Button>
            <Button tone="link" className="xs">
              Link
            </Button>
            <Button disabled>Disabled</Button>
          </div>
          <hr />
          <div className="toolbar">
            <Button size="sm">Small</Button>
            <Button>Medium</Button>
            <Button size="lg" tone="primary">
              Large
            </Button>
            <Button icon aria-label="Close">
              ×
            </Button>
          </div>
          <hr />
          <Button size="lg" tone="primary" block>
            Check in — opens 16:30
          </Button>
          <hr />
          <Note>
            Every button animates on hover (§1.6): solid accent lightens, outlined takes the accent
            border and text, outlined danger fills 12% danger. In the fluid look the primary carries
            the cyan→violet gradient, and Auto-assign carries the violet one. Depth follows the
            ground: a soft warm card shadow in light, frosted glass and coloured glow in dark. Never
            a neutral black cast (ADR-0007).
          </Note>
        </Panel>

        {/* ---------------- pills ---------------- */}
        <Panel title="Pills and chips">
          <span className="label">Tinted — every tone</span>
          <div className="toolbar mt-8">
            <Pill>Neutral</Pill>
            {TONES.map((tone) => (
              <Pill key={tone} tone={tone}>
                {tone}
              </Pill>
            ))}
          </div>
          <hr />
          <span className="label">Tinted with a status dot — every tone</span>
          <div className="toolbar mt-8">
            <Pill dot>Neutral</Pill>
            {TONES.map((tone) => (
              <Pill key={tone} tone={tone} dot>
                {tone}
              </Pill>
            ))}
          </div>
          <hr />
          <span className="label">Solid — every tone</span>
          <div className="toolbar mt-8">
            <Pill solid>Neutral</Pill>
            {TONES.map((tone) => (
              <Pill key={tone} tone={tone} solid>
                {tone}
              </Pill>
            ))}
          </div>
          <hr />
          <span className="label">Large — every tone</span>
          <div className="toolbar mt-8">
            <Pill large>Neutral</Pill>
            {TONES.map((tone) => (
              <Pill key={tone} tone={tone} large>
                {tone}
              </Pill>
            ))}
          </div>
          <hr />
          <span className="label">In use</span>
          <div className="toolbar mt-8">
            {/* design-system.html:97 — the fill counts are the solid ones,
                statuses stay tinted (docs/07 vocabulary). */}
            <Pill tone="green" solid>
              12 of 12 (+2)
            </Pill>
            <Pill tone="amber" solid>
              3 of 5 (+1)
            </Pill>
            <Pill tone="coral" solid>
              9 of 18 (+3)
            </Pill>
            <Pill tone="cyan">Upcoming</Pill>
            <Pill tone="coral">No show</Pill>
            <Pill tone="amber">Needs confirmation</Pill>
          </div>
          <hr />
          <div className="toolbar">
            <Chip>PO number · CLA-44192</Chip>
            <Chip tone="cyan">Qualified — Claridge&apos;s · Chef</Chip>
            <Chip tone="purple">Applied 2h ago</Chip>
            <Chip outline>Wave 2 — not qualified here</Chip>
          </div>
        </Panel>

        {/* ---------------- inputs ---------------- */}
        <Panel title="Inputs">
          <div className="ds-grid-2">
            <Input label="Start (UK time)" defaultValue="17:00" />
            <Input
              label="Share code"
              mono
              defaultValue="W12 3AB 4CD"
              className="accent"
              hint="9 characters beginning with W. We check it with gov.uk using your date of birth — you don't upload anything."
            />
            <Input label="Email" defaultValue="not-an-email" error="Enter a valid email address." />
            <Input label="Employee ID" defaultValue="10442" readOnly />
            <Select label="Role" defaultValue="waiter">
              <option value="waiter">Waiting Staff</option>
              <option value="bar">Bar Staff</option>
              <option value="chef">Chef de Partie</option>
            </Select>
            <div className="field">
              <span className="label">Base rate</span>
              <InputRow>
                <Addon leading>£</Addon>
                <Input defaultValue="13.20" />
                <Addon>/h</Addon>
              </InputRow>
            </div>
            <SearchInput label="Search staff" placeholder="Search by name or employee ID" />
            <Textarea label="Reason (required)" placeholder="Why is this document rejected?" />
          </div>
        </Panel>

        <InteractiveControls />

        {/* ---------------- surfaces ---------------- */}
        <Panel title="Tiles and tables">
          <TileGrid columns={4}>
            <KpiTile
              label="Open positions"
              value="47"
              description="Sold but not staffed — all events, any date"
              tone="accent"
            />
            <KpiTile
              label="On shift now"
              value="128"
              description="Checked in and on site"
              tone="ok"
            />
            <KpiTile
              label="Staff available"
              value="612"
              description="Compliant and unbooked today"
            />
            <KpiTile
              label="Compliance blocks"
              value="9"
              description="Blocked on an expired document"
              tone="danger"
            />
          </TileGrid>
          <hr />
          <TableScroll>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Window</th>
                  <th>Client</th>
                  <th>Role</th>
                  <th>Fill</th>
                  <th>Match</th>
                  <th className="num">Margin</th>
                </tr>
              </thead>
              <tbody>
                <tr className="clickable">
                  <td>
                    <b>Tue 22 Sep</b>
                  </td>
                  {/* §1.8: a scheduled window is never a single unlabelled clock —
                      the UK line, then "your time" when the reader's zone differs
                      (design-system.html §7). */}
                  <td className="mono sm">
                    17:00 – 23:30<span className="sub">UK time</span>19:00 – 01:30
                    <span className="sub">your time</span>
                  </td>
                  <td>Mandarin Oriental</td>
                  <td>Waiting Staff</td>
                  <td>
                    <Pill tone="green">12 of 12 (+2)</Pill>
                  </td>
                  <td>
                    <Score value={94} />
                  </td>
                  <td className="num green">+£9.40/h</td>
                </tr>
                <tr className="clickable violation">
                  <td>
                    <b>Sat 26 Sep</b>
                    <span className="sub">11:00 – 19:00</span>
                  </td>
                  <td>Ascot Racecourse</td>
                  <td>Bar Staff</td>
                  <td>
                    <Pill tone="coral">9 of 18 (+3)</Pill>
                  </td>
                  <td>
                    <Score value={71} wave2 />
                  </td>
                  <td className="num green">+£8.20/h</td>
                </tr>
              </tbody>
            </table>
          </TableScroll>
        </Panel>

        <Panel title="Status and feedback">
          <Alert tone="amber">
            This shift has an unresolved <b>No check-out</b> violation. Payroll holds the row until
            a manager enters the actual finish time (UK time).
          </Alert>
          <hr />
          <Note tone="cyan">
            Allocation is shown as <code>6 (+1)</code>, never <code>7</code>. Fill counts confirmed
            bookings only.
          </Note>
          <hr />
          <div className="stack">
            <Toast tone="green">Document verified.</Toast>
            <Toast tone="coral">Couldn&apos;t reach gov.uk. Nothing was recorded.</Toast>
          </div>
          <hr />
          <div className="stack">
            <Progress value={9} max={12} />
            <Progress value={5} max={12} tone="amber" />
            <Progress value={1} max={12} tone="coral" />
            <SegBar segments={['ok', 'ok', 'pending', 'empty', 'empty']} />
          </div>
          <hr />
          <EmptyState>
            <h3>No events on this day</h3>
            Nothing is scheduled for Sun 27 Sep.
          </EmptyState>
        </Panel>

        {/* ---------------- people ---------------- */}
        <Panel title="People and documents">
          <div className="toolbar">
            <Avatar name="Amira Khan" size="sm" />
            <Avatar name="Jonah Whitfield" />
            <Avatar name="Priya Raman" size="lg" />
            <Avatar name="Marcus Bell" size="xl" />
            <Avatar name="Deleted account #8841" deleted />
            <AvatarGroup>
              <Avatar name="Amira Khan" />
              <Avatar name="Jonah Whitfield" />
              <Avatar name="Priya Raman" />
            </AvatarGroup>
            <Person name="Joy Nwosu" sub="Waiting Staff · show-rate 98%" />
            <Rating value={4.8} />
            <Rating value={3.4} />
            <Rating value={2.1} />
          </div>
          <hr />
          <Stepper
            steps={[
              { label: 'Right to work' },
              { label: 'Home address' },
              { label: 'Documents' },
              { label: 'Quiz · locked' },
              { label: 'Contract' },
            ]}
            current={2}
          />
        </Panel>

        <Panel title="Documents" flush>
          <DocRow
            icon="PDF"
            title="Passport"
            meta="Expiry read by AI · confidence 97%"
            state="verified"
            actions={<Pill tone="green">Verified</Pill>}
          />
          <DocRow
            icon="GOV"
            title="Right to Work — gov.uk share code check"
            meta="W12 3AB 4CD + DOB · right to work until 30.06.2028"
            state="verified"
            actions={<Pill tone="green">Verified</Pill>}
          />
          <DocRow
            icon="JPG"
            title="University Term Dates Letter"
            meta="Confidence 62% · needs manual review"
            state="review"
            actions={
              <>
                <Button size="sm" tone="primary">
                  Verify
                </Button>
                <Button size="sm" tone="danger">
                  Reject
                </Button>
              </>
            }
          />
          <DocRow
            icon="DEC"
            title="Criminal convictions declaration"
            meta="Answered Yes · manager review required"
            state="pending"
            actions={
              <>
                <Button size="sm" tone="primary">
                  Verify
                </Button>
                <Button size="sm" tone="danger">
                  Reject
                </Button>
              </>
            }
          />
          <DocRow
            icon="PDF"
            title="Proof of address"
            meta="Older than 3 months · re-upload requested"
            state="rejected"
            actions={<Pill tone="coral">Rejected</Pill>}
          />
          <DocRow
            icon="RTW"
            title="Right to Work"
            meta="Expired 3 Jan 2026 — blocking"
            state="expired"
            actions={<Pill tone="coral">Expired</Pill>}
          />
        </Panel>

        <Panel title="Onboarding pipeline">
          <Kanban>
            <KanbanColumn title="Interview requested" count={6} accent>
              <KanbanCard>
                <Person name="Amira Khan" sub="Applied 2 days ago" size="sm" />
                <Pill tone="amber">Willo sent</Pill>
              </KanbanCard>
              <KanbanCard returning>
                <Person name="Tomas Varga" sub="Applied today" size="sm" />
                <Pill tone="purple">Returning applicant</Pill>
                <span className="xs muted">
                  Matches an existing record — Employee ID 10442. Reset to candidate, or reject.
                </span>
              </KanbanCard>
            </KanbanColumn>
            <KanbanColumn title="Documents" count={9}>
              <KanbanCard>
                <Person name="Priya Raman" sub="2 awaiting review" size="sm" />
                <SegBar segments={['ok', 'ok', 'pending', 'pending', 'empty']} />
              </KanbanCard>
            </KanbanColumn>
            <KanbanColumn title="Quiz" count={3}>
              <KanbanCard>
                <Person name="Jonah Whitfield" sub="Attempt 2 of 3 · 65%" size="sm" />
                <span className="xs muted">Pass mark 80%</span>
              </KanbanCard>
            </KanbanColumn>
          </Kanban>
        </Panel>

        {/* ---------------- mobile ---------------- */}
        <Panel title="Staff App chrome">
          <Note>
            Frosted top bar, frosted bottom navigation and frosted sheets over two background glows
            — cyan and purple on the dark ground, clay and amber on the warm one. The header
            collapses on scroll: the logo stays left, the profile stays right.
          </Note>
          <hr />
          <PhoneRow>
            <PhoneFrame caption="M1 · Shifts">
              <StatusBar />
              <AppHeader
                brand={<Logo size="sm" />}
                title="Shifts"
                actions={<Avatar name="Joy Nwosu" size="sm" />}
              />
              <AppBody>
                <span className="label green">Today</span>
                <MobileCard
                  tone="today"
                  title="Autumn Partners Dinner"
                  meta="Claridge's · The Ballroom, Brook Street, W1K 4HR"
                  badge={<Pill tone="cyan">Today</Pill>}
                >
                  <StatStrip
                    stats={[
                      { label: 'Your hours', value: '17:00 – 23:30' },
                      { label: 'Role', value: 'Waiting Staff' },
                      { label: 'Rate', value: '£13.20/h' },
                    ]}
                  />
                  <span className="sm muted">
                    Dress code: Black tie · On-site contact: Marcus Bell, 07700 900188
                  </span>
                  <Button tone="primary" size="lg" block>
                    Check in — opens 16:30
                  </Button>
                </MobileCard>
                <span className="label">Upcoming</span>
                <MobileCard
                  tone="needs"
                  title="Harvest Gala"
                  meta="Mandarin Oriental · Sat 26 Sep"
                  badge={
                    <Pill tone="amber" solid>
                      Needs confirmation
                    </Pill>
                  }
                >
                  <span className="strong">11:00 – 19:00 · Bar Staff</span>
                  <span className="sm amber">
                    Confirm by 12:00 today or you&apos;ll be removed from this shift.
                  </span>
                  <Button tone="amber" size="lg" block>
                    I&apos;m ready — confirm
                  </Button>
                </MobileCard>
              </AppBody>
              <BottomNav
                activeHref="/shifts"
                items={[
                  { href: '/documents', label: 'Documents' },
                  { href: '/shifts', label: 'Shifts' },
                  { href: '/invites', label: 'Invites', count: 3 },
                  { href: '/radar', label: 'Radar' },
                ]}
              />
            </PhoneFrame>

            <PhoneFrame caption="M4 · On shift">
              <StatusBar />
              <AppHeader
                collapsed
                brand={<Logo size="sm" />}
                title="On shift"
                actions={<Avatar name="Joy Nwosu" size="sm" />}
              />
              <AppBody>
                <GpsChip inside>GPS on site</GpsChip>
                <MobileCard tone="live" title="Checked in 16:58 · on site">
                  <Timer>2:14</Timer>
                  <span className="label">Chargeable so far</span>
                  <Progress value={34} max={100} tone="green" />
                  <span className="sm muted">
                    Paid from 17:00, your scheduled start — arriving early isn&apos;t paid. Stay
                    inside the venue area or the office is alerted.
                  </span>
                </MobileCard>
                <MobileCard title="Breaks" meta="1 taken · last 18:05 · 22 min total">
                  <Alert tone="amber">
                    A break will be applied to all shifts over 6 hours — please check with your
                    Manager on site.
                  </Alert>
                  <Button tone="outline" block>
                    Start break
                  </Button>
                </MobileCard>
                <MobileList>
                  <MobileRow right="›">Profile details</MobileRow>
                  <MobileRow right="›">Payment information</MobileRow>
                </MobileList>
                <Button size="lg" block disabled>
                  Check out — available from 23:15
                </Button>
              </AppBody>
              <BottomNav
                activeHref="/shifts"
                items={[
                  { href: '/documents', label: 'Documents' },
                  { href: '/shifts', label: 'Shifts' },
                  { href: '/invites', label: 'Invites' },
                  { href: '/radar', label: 'Radar', locked: true },
                ]}
              />
            </PhoneFrame>

            <PhoneFrame caption="M3 · Wizard and app lock" short>
              <StatusBar />
              <AppHeader
                brand={<Logo size="sm" />}
                title="Get set up"
                actions={<Pill tone="cyan">1 / 11</Pill>}
                below={<Progress value={9} max={100} thin />}
              />
              <AppBody>
                <WizardHeader
                  step={1}
                  total={11}
                  title="Your right to work"
                  sub="We need to know which check applies to you before anything else."
                />
                <StaticScreen title="Your account is on hold">
                  Please contact us at admin@thehospitalitycompany.co.uk
                </StaticScreen>
              </AppBody>
            </PhoneFrame>
          </PhoneRow>
        </Panel>

        <Overlays />
      </Content>
    </>
  );
}
