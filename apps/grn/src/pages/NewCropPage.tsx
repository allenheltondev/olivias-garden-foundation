import { useMemo } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Panel, SectionHeading } from '@olivias/ui';
import { CropForm } from '../components/CropPlanner/CropForm';
import { PlantLoader } from '../components/branding/PlantLoader';
import { getMe, listMyBeds } from '../services/api';
import { completeTodayAction } from '../utils/todayActionTracking';

/**
 * Standalone page wrapper around <CropForm/> — the full add-a-crop form
 * with planting plan and sharing options. The garden designer no longer
 * embeds this form; it uses a lightweight inline quick-add
 * (components/GardenDesigner/QuickAddCrop.tsx) so adding crops while
 * designing stays fast and doesn't interrupt the flow.
 */
export function NewCropPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedBedId = searchParams.get('bedId');
  const suggestedCropName = searchParams.get('suggestion');
  // Only known garden destinations can be used as return paths. Keep the
  // originating view's query context without allowing external redirects.
  const requestedReturn = searchParams.get('returnTo');
  const fallback = requestedBedId
    ? `/garden?${new URLSearchParams({ bed: requestedBedId })}`
    : '/garden/plants';
  let returnTo = fallback;
  if (requestedReturn) {
    try {
      const target = new URL(requestedReturn, 'https://garden.invalid');
      if (
        target.origin === 'https://garden.invalid' &&
        ['/garden', '/garden/plants', '/garden/plan'].includes(target.pathname)
      ) {
        returnTo = `${target.pathname}${target.search}${target.hash}`;
      }
    } catch {
      // Malformed context falls back to the plant list or originating bed.
    }
  }

  const { data: profile, isLoading: isLoadingProfile, isError: profileError, refetch: retryProfile } = useQuery({
    queryKey: ['userProfile'],
    queryFn: getMe,
    staleTime: 5 * 60 * 1000,
  });

  const { data: beds = [], isLoading: isLoadingBeds, isError: bedsError, refetch: retryBeds } = useQuery({
    queryKey: ['myBeds'],
    queryFn: listMyBeds,
    enabled: profile?.userType === 'grower' && requestedBedId !== null,
  });

  const lockedBed = useMemo(
    () => (requestedBedId ? beds.find((b) => b.id === requestedBedId) ?? null : null),
    [beds, requestedBedId]
  );

  if (isLoadingProfile || isLoadingBeds) {
    return (
      <section className="grn-section">
        <Panel className="grn-page-status">
          <PlantLoader size="md" />
          <p>Loading your garden…</p>
        </Panel>
      </section>
    );
  }

  if (profileError || bedsError) {
    return (
      <Panel className="grn-page-status" role="alert">
        <p>We could not load your garden. Please try again before adding a crop.</p>
        <Button onClick={() => { void (profileError ? retryProfile() : retryBeds()); }}>Try again</Button>
      </Panel>
    );
  }

  if (requestedBedId && profile?.userType === 'grower' && !lockedBed) {
    return (
      <Panel className="grn-page-status" role="alert">
        <p>This garden bed is no longer available. Open your garden to choose where to plant.</p>
        <Button onClick={() => navigate('/garden')}>Open garden</Button>
      </Panel>
    );
  }

  if (!profile || profile.userType !== 'grower') {
    return <Navigate to="/" replace />;
  }

  return (
    <section className="grn-section grn-new-crop">
      <SectionHeading
        title="Add a crop"
        body="Tell us what's going in the ground and where it belongs."
      />

      <CropForm
        lockedBed={lockedBed}
        initialBedId={requestedBedId}
        initialCropName={suggestedCropName}
        onCancel={() => navigate(returnTo)}
        onSuccess={(created) => {
          completeTodayAction('start');
          const destination = new URL(returnTo, 'https://garden.invalid');
          // The new plant should open its own record, never inherit an old
          // plant's harvest or timing modal. Cancel retains the original URL.
          destination.searchParams.delete('action');
          destination.searchParams.delete('harvest');
          destination.searchParams.set('crop', created.id);
          if (destination.pathname === '/garden' && created.bedId) {
            destination.searchParams.set('bed', created.bedId);
          }
          navigate(`${destination.pathname}${destination.search}${destination.hash}`, {
            replace: true,
            state: destination.pathname === '/garden/plan' ? { savedCropId: created.id } : null,
          });
        }}
      />
    </section>
  );
}

export default NewCropPage;
