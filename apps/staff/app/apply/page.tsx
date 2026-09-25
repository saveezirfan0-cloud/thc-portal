import { ApplyForm } from './ApplyForm';
import { PublicCard } from './PublicCard';
import './apply.css';

export const metadata = {
  title: 'Apply · The Hospitality Company',
  description: 'Apply to work with The Hospitality Company.',
};

/**
 * `/apply` (§2.1) — a public URL with no registration and no login. The
 * middleware already lists it as public; it deliberately renders none of the
 * app's chrome, and (PublicCard) none of the sign-in card's appearance
 * switch either, as the wireframe draws it.
 */
export default function Page() {
  return (
    <div className="apply-page">
      <PublicCard product="Join our team">
        <h2>Apply to work with us</h2>
        <ApplyForm />
      </PublicCard>
    </div>
  );
}
