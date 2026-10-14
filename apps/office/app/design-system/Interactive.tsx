'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  AppBody,
  Avatar,
  Button,
  Checkbox,
  ColumnCells,
  ColumnChooser,
  ColumnHeads,
  ColumnPrefsProvider,
  Modal,
  ModeSwitch,
  OptionRow,
  Panel,
  PhoneFrame,
  PhoneRow,
  Radio,
  RadioGroup,
  SegToggle,
  Sheet,
  Slider,
  Switch,
  TableScroll,
  Tabs,
  UkDateField,
  useColumns,
} from '@thc/ui';
import type { ColumnDef } from '@thc/ui';

/** The parts of the gallery that need state. Everything else is server-rendered. */
export function InteractiveControls() {
  const [seg, setSeg] = useState('active');
  const [tab, setTab] = useState('events');
  const [auto, setAuto] = useState(true);
  const [notify, setNotify] = useState(false);
  const [agreed, setAgreed] = useState(true);
  const [branch, setBranch] = useState('student');
  const [radius, setRadius] = useState(250);
  const [until, setUntil] = useState('2027-06-30');

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
      {/* ADR-0007's one user-facing switch, in both of its forms. The pair
          is what the two web top bars and the sign-in cards carry; the icon
          is what the Staff App header carries, where there is no room for
          two words beside the title. Both are live: they drive the page you
          are reading. */}
      <div className="toolbar">
        <span className="label">Appearance</span>
        <ModeSwitch small />
        <ModeSwitch compact />
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
        <RadioGroup aria-label="Right to work" name="ds-branch">
          <Radio checked={branch === 'student'} onChange={() => setBranch('student')}>
            International student
          </Radio>
          <Radio checked={branch === 'settled'} onChange={() => setBranch('settled')}>
            Settled or pre-settled status
          </Radio>
        </RadioGroup>
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
      <hr />
      {/* ADR-0140: a date is typed dd/mm/yyyy whatever the device's locale;
          the calendar on the right only ever writes into the box. */}
      <div className="toolbar">
        <UkDateField
          label="Right to work until (UK date)"
          value={until}
          onChange={setUntil}
          hint={until ? `stored as ${until}` : 'dd/mm/yyyy'}
        />
      </div>
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
      <PhoneRow>
        <PhoneFrame caption="M5 · Profile sheet" short>
          <AppBody className="center">
            <p className="muted">The sheet opens over this frame.</p>
          </AppBody>
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
        </PhoneFrame>
      </PhoneRow>
    </Panel>
  );
}

/**
 * ADR-0139: the column chooser on the table-frame example. Its own
 * provider with no save, so trying it here never touches the profile.
 */
const VENUE_COLUMNS = [
  { id: 'name', label: 'Venue', required: true, width: 'l' },
  { id: 'address', label: 'Address' },
  { id: 'type', label: 'Type', width: 'm' },
  { id: 'radius', label: 'Geofence (m)', width: 's', className: 'num' },
  { id: 'events', label: 'Events', width: 'xs', className: 'num' },
  { id: 'added', label: 'Date added', width: 's' },
  { id: 'by', label: 'Added by', width: 's', defaultVisible: false },
  { id: 'actions', label: 'Actions', required: true, className: 'cell-actions' },
] as const satisfies readonly ColumnDef[];

type VenueColumn = (typeof VENUE_COLUMNS)[number]['id'];

const VENUE_ROWS = [
  ['Leonardo Royal Hotel', '10 Godliman St, London EC4V 5AJ', 'Hotel', 150, 47],
  ['ExCeL London', 'Royal Victoria Dock, London E16 1XL', 'Exhibition centre', 400, 72],
  ['Hurst Manor', 'Cuckfield, Haywards Heath RH17 5LB', 'Private residence', 250, 6],
] as const;

export function ColumnsPreview() {
  return (
    <ColumnPrefsProvider prefs={{}} save={async () => undefined}>
      <ColumnsPreviewTable />
    </ColumnPrefsProvider>
  );
}

function ColumnsPreviewTable() {
  const columns = useColumns('design-system.venues', VENUE_COLUMNS);
  return (
    <Panel title="Table frame · column chooser" flush>
      <div className="toolbar filters panel-b">
        <span className="sm muted">
          Hide, show and reorder; Venue and Actions stay first and last.
        </span>
        <div className="right">
          <ColumnChooser columns={columns} label="Venues" />
        </div>
      </div>
      <div className="panel-b tight">
        <TableScroll label="Table frame example" fixed minWidth={columns.minWidth('84rem')}>
          <table className="tbl card-rows">
            <thead>
              <tr>
                <ColumnHeads columns={columns} />
              </tr>
            </thead>
            <tbody>
              {VENUE_ROWS.map(([name, address, type, radius, events]) => {
                const cells: Record<VenueColumn, ReactNode> = {
                  name: (
                    <td className="cell-title">
                      <b>{name}</b>
                    </td>
                  ),
                  address: <td data-label="Address">{address}</td>,
                  type: (
                    <td data-label="Type" className="sm muted">
                      {type}
                    </td>
                  ),
                  radius: (
                    <td data-label="Geofence (m)" className="num">
                      {radius}
                    </td>
                  ),
                  events: (
                    <td data-label="Events" className="num">
                      {events}
                    </td>
                  ),
                  added: (
                    <td data-label="Date added" className="sm">
                      12 Jan 2026
                    </td>
                  ),
                  by: (
                    <td data-label="Added by" className="sm">
                      Gisela M.
                    </td>
                  ),
                  actions: (
                    <td className="cell-actions">
                      <Button size="sm">Edit</Button>
                      <Button size="sm" tone="danger">
                        Delete
                      </Button>
                    </td>
                  ),
                };
                return (
                  <tr key={name}>
                    <ColumnCells columns={columns} cells={cells} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </Panel>
  );
}
