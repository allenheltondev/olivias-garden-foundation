import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, GardenIcon, Panel, SectionHeading } from '@olivias/ui';
import { getDerivedFeed, listMyBeds, listMyCrops, listReminders } from '../services/api';
import { listClaims } from '../services/claims';
import type { UserProfile } from '../types/user';
import { PlantLoader } from '../components/branding/PlantLoader';
import { createLogger } from '../utils/logging';
import { recordTodayActionOpen } from '../utils/todayActionTracking';
import { buildTodayActions } from './todayActions';
import { SeasonalGuide } from '../components/Seasonality/SeasonalGuide';
import { HarvestTimeline } from '../components/HarvestTimeline/HarvestTimeline';
import { FirstStepsPanel } from '../components/FirstSteps/FirstStepsPanel';
import './DashboardPage.css';

const logger = createLogger('today');

interface DashboardPageProps {
  user: UserProfile | null;
}

function firstName(displayName?: string | null, email?: string | null): string {
  const name = displayName?.trim();
  if (name) return name.split(/\s+/)[0];
  const local = email?.split('@')[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'there';
}

function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}

export function DashboardPage({ user }: DashboardPageProps) {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const lastImpression = useRef('');

  const cropsQuery = useQuery({
    queryKey: ['myCrops'],
    queryFn: listMyCrops,
    staleTime: 60 * 1000,
  });

  const remindersQuery = useQuery({
    queryKey: ['reminders'],
    queryFn: listReminders,
    staleTime: 60 * 1000,
  });

  const claimsQuery = useQuery({
    queryKey: ['claims', 'today'],
    queryFn: () => listClaims({ limit: 50 }),
    staleTime: 30 * 1000,
  });

  // Only the getting-started checklist needs beds, so it stays out of the
  // Today action sources and never blocks or fails the page.
  const bedsQuery = useQuery({
    queryKey: ['myBeds'],
    queryFn: listMyBeds,
    staleTime: 5 * 60 * 1000,
  });

  const geoKey = user?.growerProfile?.geoKey;
  const feedQuery = useQuery({
    queryKey: ['todayDerivedFeed', geoKey, 7],
    queryFn: () => getDerivedFeed({ geoKey: geoKey ?? '', windowDays: 7, limit: 1 }),
    enabled: Boolean(geoKey),
    staleTime: 5 * 60 * 1000,
  });

  const crops = useMemo(() => cropsQuery.data ?? [], [cropsQuery.data]);
  const actions = useMemo(
    () =>
      buildTodayActions({
        userId: user?.id,
        crops,
        cropsLoaded: cropsQuery.isSuccess,
        reminders: remindersQuery.data?.items ?? [],
        claims: claimsQuery.data?.items ?? [],
        signals: feedQuery.data?.signals ?? [],
      }),
    [
      claimsQuery.data?.items,
      crops,
      cropsQuery.isSuccess,
      feedQuery.data?.signals,
      remindersQuery.data?.items,
      user?.id,
    ]
  );

  const stats = useMemo(() => {
    const growing = crops.filter((crop) => crop.status === 'growing').length;
    const planning = crops.filter(
      (crop) => crop.status === 'planning' || crop.status === 'interested'
    ).length;
    const sharing = crops.filter((crop) => crop.surplusEnabled).length;
    return { growing, planning, sharing };
  }, [crops]);

  const relevantQueries = geoKey
    ? [cropsQuery, remindersQuery, claimsQuery, feedQuery]
    : [cropsQuery, remindersQuery, claimsQuery];
  const failedQueries = relevantQueries.filter((query) => query.isError);
  const hasLoadedData =
    cropsQuery.data !== undefined ||
    remindersQuery.data !== undefined ||
    claimsQuery.data !== undefined ||
    feedQuery.data !== undefined;
  const isInitialLoading = !hasLoadedData && relevantQueries.some((query) => query.isPending);
  const greetingName = firstName(user?.displayName, user?.email);
  const isNewGarden = cropsQuery.isSuccess && crops.length === 0;

  useEffect(() => {
    if (isInitialLoading) return;
    const impression = actions.map((action) => action.kind).join(',');
    if (!impression || impression === lastImpression.current) return;
    lastImpression.current = impression;
    logger.info('Today actions shown', {
      actionKinds: actions.map((action) => action.kind),
      actionCount: actions.length,
    });
  }, [actions, isInitialLoading]);

  const retryFailed = () => {
    void Promise.all(failedQueries.map((query) => query.refetch()));
  };

  return (
    <section className="grn-section grn-dashboard">
      <SectionHeading
        title={`Today, ${greetingName}`}
        body={isNewGarden
          ? 'One plant is enough to begin. Let’s make this garden yours.'
          : 'Your next useful step, and a little perspective on the season ahead.'}
      />

      {!isOnline ? (
        <div className="grn-today-notice" role="status">
          You are offline. Showing the latest garden information saved on this device.
        </div>
      ) : null}

      {failedQueries.length > 0 ? (
        <div className="grn-today-notice grn-today-notice--warning" role="alert">
          <span>Some of Today could not refresh. The available actions are still shown.</span>
          <Button variant="ghost" size="sm" onClick={retryFailed}>
            Try again
          </Button>
        </div>
      ) : null}

      {isInitialLoading ? (
        <Panel className="grn-page-status">
          <PlantLoader size="md" />
          <p>Finding your next steps…</p>
        </Panel>
      ) : (
        <ol className="grn-today-actions grn-today-focus" aria-label="Your top actions today">
          {actions.map((action, index) => (
            <li key={action.id}>
              <Card
                padding="6"
                className={`grn-today-action ${index === 0 ? 'grn-today-action--primary' : 'grn-today-action--supporting'}`}
              >
                {index === 0 ? (
                  <span className="grn-today-action__botanical" aria-hidden="true">
                    <GardenIcon name="seeds" />
                  </span>
                ) : null}
                <div className="grn-today-action__topline">
                  <span className="grn-today-action__rank" aria-label={`Priority ${index + 1}`}>
                    {index + 1}
                  </span>
                  <span className="grn-today-action__label">{index === 0 ? `Your next step · ${action.label}` : action.label}</span>
                </div>
                <h2>{action.title}</h2>
                <p>{action.body}</p>
                <Button
                  variant={index === 0 ? 'primary' : 'secondary'}
                  size="md"
                  onClick={() => {
                    recordTodayActionOpen(action.kind, index + 1, action.destination);
                    navigate(action.to);
                  }}
                >
                  {action.cta}
                </Button>
              </Card>
            </li>
          ))}
        </ol>
      )}

      {isNewGarden ? (
        <FirstStepsPanel
          userId={user?.id}
          homeZone={user?.growerProfile?.homeZone}
          crops={crops}
          bedCount={bedsQuery.data?.length ?? 0}
          reminderCount={remindersQuery.data?.items.length ?? 0}
          ready={remindersQuery.isSuccess && bedsQuery.isSuccess}
        />
      ) : null}

      {crops.length > 0 ? <HarvestTimeline crops={crops} /> : null}

      {crops.length > 0 ? (
        <section className="grn-dashboard__glance" aria-labelledby="garden-glance-heading">
          <div className="grn-dashboard__panel-head">
            <h2 id="garden-glance-heading">Garden at a glance</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate('/garden')}>
              Open garden
            </Button>
          </div>
          <div className="grn-stat-grid">
            <button type="button" className="grn-stat-tile" onClick={() => navigate('/garden/plants')}>
              <span className="grn-stat-tile__value">{stats.growing}</span>
              <span className="grn-stat-tile__label">Growing now</span>
            </button>
            <button type="button" className="grn-stat-tile" onClick={() => navigate('/garden/plan')}>
              <span className="grn-stat-tile__value">{stats.planning}</span>
              <span className="grn-stat-tile__label">Still planning</span>
            </button>
            <button type="button" className="grn-stat-tile" onClick={() => navigate('/share/listings')}>
              <span className="grn-stat-tile__value">{stats.sharing}</span>
              <span className="grn-stat-tile__label">Sharing enabled</span>
            </button>
          </div>
        </section>
      ) : null}

      <SeasonalGuide growerProfile={user?.growerProfile} crops={crops} />

      <section className="grn-today-explore" aria-labelledby="today-explore-heading">
        <h2 id="today-explore-heading">When you have a moment</h2>
        <Card padding="6" className="grn-dashboard__connect">
          <div className="grn-dashboard__connect-copy">
            <h2>Share when you are ready</h2>
            <p>Offer surplus, coordinate pickup, or see what people nearby need. Sharing is always optional.</p>
          </div>
          <Button variant="secondary" size="md" onClick={() => navigate('/share')}>
            Open Share
          </Button>
        </Card>

        <Card padding="6" className="grn-dashboard__connect grn-dashboard__grow-more">
          <div className="grn-dashboard__connect-copy">
            <h2>Grow more of your own</h2>
            <p>
              Composting, seed saving, keeping a harvest — practices that make a garden feed you
              further. Ideas to browse, not a checklist to finish.
            </p>
          </div>
          <Button variant="secondary" size="md" onClick={() => navigate('/garden/grow-more')}>
            Browse ideas
          </Button>
        </Card>
      </section>
    </section>
  );
}

export default DashboardPage;
