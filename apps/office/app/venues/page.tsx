import { Alert, Content, Topbar } from '@thc/ui';
import { loadVenuesPage } from './data';
import { VenuesScreen } from './VenuesScreen';

export const metadata = { title: 'Venues · THC Back Office' };

/**
 * /venues — §9.11, `wireframes/backoffice/venues.html`.
 *
 * Read on the server so the list, the map and the modal all work from the
 * same rows, and so the venue-type defaults reach the modal without a
 * second round trip. Nothing on this screen holds a copy of the standard
 * radii: they come from `venue_types`.
 */
export default async function Page() {
  const { venues, venueTypes, problem } = await loadVenuesPage();

  return (
    <>
      <Topbar
        title="Venues"
        crumbs={
          <>
            geofences · <b>{venues.length}</b> {venues.length === 1 ? 'venue' : 'venues'} · whether
            a worker can check in at all depends on the radius
          </>
        }
        timezone="All times UK (Europe/London)"
      />
      <Content>
        {problem ? <Alert tone="coral">{problem}</Alert> : null}
        <VenuesScreen venues={venues} venueTypes={venueTypes} />
      </Content>
    </>
  );
}
