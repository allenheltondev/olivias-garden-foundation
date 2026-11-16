import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, GardenIcon, SectionHeading, type GardenIconName } from '@olivias/ui';
import { GardenScene } from '../components/branding/GardenArt';
import './ConnectPage.css';

interface ConnectOption {
  id: string;
  icon: GardenIconName;
  title: string;
  body: string;
  cta: string;
  to: string;
}

// The Share hub is the single optional door to GRN's social surfaces. Each
// card routes to an existing page — nothing here is required for individual
// growing, it's all opt-in.
const options: ConnectOption[] = [
  {
    id: 'share',
    icon: 'basket',
    title: 'Food to share',
    body: 'Share what is ready so a nearby neighbor can request a pickup before it goes to waste.',
    cta: 'Share food',
    to: '/share/listings',
  },
  {
    id: 'find',
    icon: 'map',
    title: 'Find food nearby',
    body: 'Browse fresh food shared by growers around you and request what your household needs.',
    cta: 'Discover food',
    to: '/share/find',
  },
  {
    id: 'insights',
    icon: 'seeds',
    title: 'What neighbors need',
    body: 'See what’s abundant and what’s scarce near you, and get ideas for what to plant next.',
    cta: 'View insights',
    to: '/garden/plan/recommendations',
  },
  {
    id: 'garden-link',
    icon: 'bed',
    title: 'Share your garden',
    body: 'Create a public link to your garden design so you can show friends and neighbors what you’re growing.',
    cta: 'Open Designer',
    to: '/garden',
  },
];

function ConnectCard({ option, action }: { option: ConnectOption; action: () => void }): ReactNode {
  return (
    <Card padding="6" className="grn-connect-card">
      <GardenIcon name={option.icon} />
      <h2 className="grn-connect-card__title">{option.title}</h2>
      <p className="grn-connect-card__body">{option.body}</p>
      <Button variant={option.id === 'share' ? 'primary' : 'secondary'} size="md" onClick={action}>
        {option.cta}
      </Button>
    </Card>
  );
}

export function ConnectPage() {
  const navigate = useNavigate();

  return (
    <section className="grn-section grn-share-home">
      <div className="grn-share-home__intro">
        <SectionHeading
          title="Share with people nearby"
          body="A little extra from your garden can make someone's day. Offer a harvest or see what neighbors have to share."
        />
        <GardenScene name="neighbor-harvest" className="grn-share-home__art" />
      </div>
      <div className="grn-connect-grid">
        {options.slice(0, 2).map((option) => (
          <ConnectCard key={option.id} option={option} action={() => navigate(option.to)} />
        ))}
      </div>
      <p className="grn-share-home__reassurance">You choose what to offer and when. Nothing is shared automatically.</p>
      <section className="grn-share-explore" aria-labelledby="share-explore-heading">
        <h2 id="share-explore-heading">More ways to connect</h2>
        <div className="grn-share-explore__links">
          {options.slice(2).map((option) => (
            <Link key={option.id} to={option.to} className="grn-share-explore__link">
              <GardenIcon name={option.icon} />
              <span>
                <strong>{option.title}</strong>
                <span>{option.body}</span>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      </section>
    </section>
  );
}

export default ConnectPage;
