import { Navigate } from 'react-router-dom';
import { Panel, SectionHeading } from '@olivias/ui';
import { useQuery } from '@tanstack/react-query';
import { getMe } from '../services/api';
import { SearcherRequestPanel } from '../components/Listings/SearcherRequestPanel';
import { PlantLoader } from '../components/branding/PlantLoader';

export function RequestsPage() {
  const { data: profile, isLoading } = useQuery({
    queryKey: ['userProfile'],
    queryFn: getMe,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  if (isLoading) {
    return (
      <section className="grn-section">
        <SectionHeading eyebrow="Request flow" title="Requests" />
        <Panel className="grn-page-status">
          <PlantLoader size="md" />
          <p>Loading…</p>
        </Panel>
      </section>
    );
  }

  if (!profile || profile.userType !== 'gatherer') {
    return <Navigate to="/" replace />;
  }

  return (
    <section className="grn-section">
      <SectionHeading
        eyebrow="Request flow"
        title="Requests"
        body="Search nearby growers and coordinate pickup details."
      />
      <SearcherRequestPanel
        viewerUserId={profile.userId}
        gathererGeoKey={profile.gathererProfile?.geoKey}
        defaultLat={profile.gathererProfile?.lat}
        defaultLng={profile.gathererProfile?.lng}
        defaultRadiusMiles={profile.gathererProfile?.searchRadiusMiles}
      />
    </section>
  );
}

export default RequestsPage;
