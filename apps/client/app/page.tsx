import { redirect } from 'next/navigation';

/**
 * The portal lives at /client, which is the route
 * `docs/08-screen-inventory.md` names and the URL the wireframe's address
 * bar shows (`portal.thehospitalitycompany.co.uk/client`).
 *
 * This root exists only to send people there, so a bookmarked bare domain
 * still lands on the event list rather than on a dead index. It replaces
 * the Phase 0 placeholder, whose "Events" nav item pointed at `/` — that
 * item now has a real screen to point at.
 */
export default function Home() {
  redirect('/client');
}
