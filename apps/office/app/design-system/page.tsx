import {
  Alert,
  Avatar,
  Button,
  Chip,
  Content,
  DocRow,
  EmptyState,
  Input,
  Note,
  PageHead,
  Panel,
  Pill,
  Progress,
  Select,
  Stepper,
  Textarea,
  Toast,
  Topbar,
} from '@thc/ui';
import { ModeSwitch } from './ModeSwitch';
import './design-system.css';

/**
 * The live design system, mirroring `wireframes/design-system.html`.
 *
 * This route is the acceptance reference for `packages/ui`: if a component
 * looks wrong here, it is wrong everywhere. Every element below reads tokens
 * only — no page in this repo may hard-code a colour or a radius.
 */
const TONES = ['cyan', 'green', 'amber', 'coral', 'purple'] as const;

export default function Page() {
  return (
    <>
      <Topbar title="Design system" actions={<ModeSwitch />} />
      <Content>
        <PageHead
          title="Components"
          description="Two token axes, one switch (ADR-0003). Mirrors wireframes/design-system.html."
        />

        <Panel title="Buttons">
          <div className="toolbar">
            <Button tone="primary">Primary</Button>
            <Button>Default</Button>
            <Button tone="outline">Outline</Button>
            <Button tone="purple">Purple</Button>
            <Button tone="green">Green</Button>
            <Button tone="danger">Danger</Button>
            <Button tone="danger" solid>
              Danger solid
            </Button>
            <Button tone="ghost">Ghost</Button>
            <Button disabled>Disabled</Button>
          </div>
          <hr />
          <div className="toolbar">
            <Button size="sm">Small</Button>
            <Button>Medium</Button>
            <Button size="lg" tone="primary">
              Large
            </Button>
          </div>
        </Panel>

        <Panel title="Pills and chips">
          <div className="toolbar">
            <Pill>Neutral</Pill>
            {TONES.map((tone) => (
              <Pill key={tone} tone={tone} dot>
                {tone}
              </Pill>
            ))}
          </div>
          <hr />
          <div className="toolbar">
            {TONES.map((tone) => (
              <Pill key={tone} tone={tone} solid>
                {tone}
              </Pill>
            ))}
          </div>
          <hr />
          <div className="toolbar">
            <Chip>Black tie</Chip>
            <Chip tone="cyan">Qualified</Chip>
            <Chip tone="purple">Applied</Chip>
          </div>
        </Panel>

        <Panel title="Inputs">
          <div className="grid-2">
            <Input label="Start (UK time)" defaultValue="17:00" />
            <Input label="Share code" mono placeholder="W12 ABC 34D" />
            <Input
              label="National Insurance number"
              mono
              defaultValue="QQ 12 34 56 C"
              hint="Masked on every screen except the payroll export."
            />
            <Input label="Email" defaultValue="not-an-email" error="Enter a valid email address." />
            <Select label="Role" defaultValue="waiter">
              <option value="waiter">Waiter</option>
              <option value="bartender">Bartender</option>
              <option value="supervisor">Supervisor</option>
            </Select>
            <Textarea label="Reason (required)" placeholder="Why is this document rejected?" />
          </div>
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
          <Toast tone="green">Document verified.</Toast>
          <hr />
          <Progress value={9} max={12} />
          <hr />
          <EmptyState>No events on this day.</EmptyState>
        </Panel>

        <Panel title="People and documents">
          <div className="toolbar">
            <Avatar name="Amira Khan" size="sm" />
            <Avatar name="Jonah Whitfield" />
            <Avatar name="Priya Raman" size="lg" />
          </div>
          <hr />
          <DocRow
            title="Passport"
            meta="Expires 14 Mar 2029 · AI confidence high"
            state="verified"
            actions={<Pill tone="green">Verified</Pill>}
          />
          <DocRow
            title="Share code result"
            meta="Uploaded 2 days ago · awaiting manager review"
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
          <DocRow title="Right to Work" meta="Expired 3 Jan 2026 — blocking" state="expired" />
        </Panel>

        <Panel title="Stepper">
          <Stepper
            steps={[
              { label: 'Right to work' },
              { label: 'Documents' },
              { label: 'Health & safety' },
              { label: 'HMRC' },
              { label: 'Contract' },
            ]}
            current={2}
          />
        </Panel>
      </Content>
    </>
  );
}
