'use client';

import { useState } from 'react';
import {
  Avatar,
  Button,
  Checkbox,
  Modal,
  OptionRow,
  Panel,
  Radio,
  SegToggle,
  Sheet,
  Slider,
  Switch,
  Tabs,
} from '@thc/ui';

/** The parts of the gallery that need state. Everything else is server-rendered. */
export function InteractiveControls() {
  const [seg, setSeg] = useState('active');
  const [tab, setTab] = useState('events');
  const [auto, setAuto] = useState(true);
  const [notify, setNotify] = useState(false);
  const [agreed, setAgreed] = useState(true);
  const [branch, setBranch] = useState('student');
  const [radius, setRadius] = useState(250);

  return (
    <Panel title="Toggles, switches and markers">
      <div className="toolbar">
        <SegToggle
          aria-label="Candidates"
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'active', label: 'Active', count: 38 },
            { value: 'rejected', label: 'Rejected', count: 4, alert: true },
          ]}
        />
        <SegToggle
          small
          aria-label="Venues view"
          value={seg === 'active' ? 'list' : 'map'}
          onChange={(value) => setSeg(value === 'list' ? 'active' : 'rejected')}
          options={[
            { value: 'list', label: 'List' },
            { value: 'map', label: 'On map' },
          ]}
        />
        <Switch checked={auto} onChange={setAuto} label="Auto-Assign" purple />
        <Switch checked={notify} onChange={setNotify} label="Email me" />
      </div>
      <hr />
      <Tabs
        aria-label="Client portal"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'events', label: 'My events' },
          { value: 'timesheets', label: 'Timesheets' },
          { value: 'feedback', label: 'Feedback' },
        ]}
      />
      <hr />
      <div className="stack">
        <Checkbox checked={agreed} onChange={setAgreed}>
          Breaks are unpaid for this client
        </Checkbox>
        <Radio checked={branch === 'student'} onChange={() => setBranch('student')}>
          International student
        </Radio>
        <Radio checked={branch === 'settled'} onChange={() => setBranch('settled')}>
          Settled or pre-settled status
        </Radio>
      </div>
      <hr />
      <div className="stack">
        <OptionRow
          selected={branch === 'student'}
          onSelect={() => setBranch('student')}
          title="International student"
          description="You have a visa with a weekly hours limit. We read your term dates from your university letter."
        />
        <OptionRow
          selected={branch === 'settled'}
          onSelect={() => setBranch('settled')}
          title="Settled or pre-settled status"
          description="We check your share code with gov.uk using your date of birth."
        />
      </div>
      <hr />
      <Slider
        value={radius}
        min={100}
        max={3000}
        onChange={setRadius}
        aria-label="Geofence radius"
        label={`Geofence radius — ${radius} m`}
      />
    </Panel>
  );
}

/** Overlays. Shown on demand so the page below stays readable. */
export function Overlays() {
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);

  return (
    <Panel title="Overlays">
      <div className="toolbar">
        <Button onClick={() => setModal(true)}>Open modal</Button>
        <Button onClick={() => setSheet(true)}>Open bottom sheet</Button>
      </div>
      <Modal
        open={modal}
        title="Delete venue"
        onClose={() => setModal(false)}
        footer={
          <>
            <Button onClick={() => setModal(false)}>Cancel</Button>
            <Button tone="danger" solid onClick={() => setModal(false)}>
              Delete venue
            </Button>
          </>
        }
      >
        <p>
          <b>Claridge&apos;s · The Ballroom</b> is used by 2 upcoming events. Deleting it leaves
          those events without a venue and without a geofence.
        </p>
      </Modal>
      <div className="phones">
        <div className="phone short">
          <div className="app-body center">
            <p className="muted">The sheet opens over this frame.</p>
          </div>
          <Sheet open={sheet} onClose={() => setSheet(false)} label="Profile">
            <div className="row">
              <Avatar name="Joy Nwosu" size="lg" />
              <div>
                <div className="strong">Joy Nwosu</div>
                <div className="sm muted">Employee ID 10318 · Waiting Staff, Bar Staff</div>
              </div>
            </div>
            <Button tone="danger" block onClick={() => setSheet(false)}>
              Request my P45
            </Button>
            <p className="xs muted">
              You&apos;ll be taken off every shift you&apos;re booked on and won&apos;t be invited
              again unless you re-apply.
            </p>
          </Sheet>
        </div>
      </div>
    </Panel>
  );
}
