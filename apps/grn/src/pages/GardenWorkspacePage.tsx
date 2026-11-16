import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import './GardenWorkspacePage.css';

const GARDEN_VIEWS = [
  {
    id: 'map',
    label: 'Map',
    path: '/garden',
    description: 'Explore beds and what is planted.',
    end: true,
  },
  {
    id: 'plants',
    label: 'Plants',
    path: '/garden/plants',
    description: 'Manage crops, harvests, and bed assignments.',
    end: false,
  },
  {
    id: 'plan',
    label: 'Plan',
    path: '/garden/plan',
    description: 'Balance the garden pyramid and planting ideas.',
    end: false,
  },
  {
    id: 'journal',
    label: 'Journal',
    path: '/garden/journal',
    description: 'Remember what you planted, tended, harvested, and shared.',
    end: false,
  },
  {
    id: 'grow-more',
    label: 'Grow more',
    path: '/garden/grow-more',
    description: 'Optional practices for getting more from the garden.',
    end: false,
  },
] as const;

function readOnlineStatus(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

/**
 * Stable shell for every view of one garden. Query state is carried between
 * views so a crop, bed, tier, or season selected in one view remains useful
 * in the next instead of becoming a fresh navigation journey.
 */
export function GardenWorkspacePage() {
  const location = useLocation();
  const [isOnline, setIsOnline] = useState(readOnlineStatus);

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

  return (
    <section className="grn-garden-workspace" aria-labelledby="garden-workspace-title">
      <header className="grn-garden-workspace__header">
        <div>
          <h1 id="garden-workspace-title">Garden</h1>
          <p>
            See the whole garden, tend what is growing, and shape the season in one place.
          </p>
        </div>
      </header>

      <nav className="grn-garden-views" aria-label="Garden views">
        {GARDEN_VIEWS.map((view) => (
          <NavLink
            key={view.id}
            to={{ pathname: view.path, search: location.search }}
            end={view.end}
            className={({ isActive }) =>
              `grn-garden-views__link ${isActive ? 'is-active' : ''}`.trim()
            }
          >
            <span className="grn-garden-views__label">{view.label}</span>
            <span className="grn-garden-views__description">{view.description}</span>
          </NavLink>
        ))}
      </nav>

      {!isOnline ? (
        <p className="grn-garden-workspace__offline" role="status">
          You are offline. Showing garden information saved on this device; changes will
          need a connection.
        </p>
      ) : null}

      <div className="grn-garden-workspace__view">
        <Outlet />
      </div>
    </section>
  );
}

export default GardenWorkspacePage;
