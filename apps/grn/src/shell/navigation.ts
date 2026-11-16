export type PrimaryDestinationId = 'today' | 'garden' | 'share' | 'settings';

export interface PrimaryNavigationItem {
  id: PrimaryDestinationId;
  label: string;
  path: string;
}

/**
 * The signed-in information architecture has four stable destinations.
 * Feature pages remain nested beneath these paths instead of becoming
 * additional top-level menu choices.
 *
 * The desktop rail includes Settings. On phones, the bottom bar is reserved
 * for the three everyday garden journeys; account controls stay in the
 * profile menu so the bar remains a single, comfortable row.
 */
export const PRIMARY_NAVIGATION: readonly PrimaryNavigationItem[] = [
  { id: 'today', label: 'Today', path: '/' },
  { id: 'garden', label: 'Garden', path: '/garden' },
  { id: 'share', label: 'Share', path: '/share' },
  { id: 'settings', label: 'Settings', path: '/settings' },
];

export const MOBILE_NAVIGATION: readonly PrimaryNavigationItem[] = PRIMARY_NAVIGATION.filter((item) => item.id !== 'settings');

export const LEGACY_ROUTE_REDIRECTS = {
  '/crops': '/garden/plants',
  '/crops/new': '/garden/plants/new',
  '/planner': '/garden/plan',
  '/recommendations': '/garden/plan/recommendations',
  '/listings': '/share/listings',
  '/connect': '/share',
  '/requests': '/share/find',
  '/reminders': '/today/reminders',
} as const;

export function isPrimaryDestinationActive(
  destination: PrimaryDestinationId,
  pathname: string
): boolean {
  switch (destination) {
    case 'today':
      return pathname === '/' || pathname.startsWith('/today/');
    case 'garden':
      return pathname === '/garden' || pathname.startsWith('/garden/');
    case 'share':
      return pathname === '/share' || pathname.startsWith('/share/');
    case 'settings':
      return pathname === '/settings' || pathname.startsWith('/settings/');
  }
}
