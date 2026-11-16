import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile } from '../types/user';
import { SettingsPage } from './SettingsPage';

vi.mock('../components/Settings/ApiKeysPanel', () => ({
  ApiKeysPanel: () => <div>API key management</div>,
}));

vi.mock('../services/api', () => ({
  updateMe: vi.fn(),
  listMyListings: vi.fn().mockResolvedValue({ items: [], limit: 50, offset: 0, hasMore: false, nextOffset: null }),
  updateListing: vi.fn(),
}));

function renderSettings(profile: UserProfile) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsPage user={profile} refreshUser={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const user: UserProfile = {
  id: 'grower-1',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  userType: 'grower',
  onboardingCompleted: true,
  subscription: { tier: 'supporter', subscriptionStatus: 'active' },
  growerProfile: {
    homeZone: '8a',
    address: 'Redacted',
    geoKey: 'geo',
    shareRadiusMiles: 5,
    isOrganization: false,
    units: 'imperial',
    locale: 'en-US',
  },
};

describe('SettingsPage', () => {
  it('provides addressable profile, membership, settings, and API key surfaces', () => {
    const { container } = renderSettings(user);

    expect(container.querySelector('#profile')).toHaveTextContent('Ada Lovelace');
    expect(container.querySelector('#membership')).toHaveTextContent('Supporter');
    expect(container.querySelector('#api-keys')).toHaveTextContent('Manage API keys');
    // The reference is reachable from settings too, so a grower who has not
    // yet asked for a key can still read what the API offers.
    expect(container.querySelector('#api-keys')).toHaveTextContent('API reference');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('lets a grower open their location and sharing details for editing', () => {
    const { container } = renderSettings(user);

    const profileCard = container.querySelector('#profile');
    expect(profileCard).toHaveTextContent('Redacted');
    expect(profileCard).toHaveTextContent('8a');
    expect(
      screen.getByRole('button', { name: 'Edit location and sharing' })
    ).toBeInTheDocument();
  });

  it('explains the gap instead of offering an editor when no grower profile exists', () => {
    renderSettings({ ...user, growerProfile: null });

    expect(screen.getByText(/growing location has not been set up yet/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit location and sharing' })
    ).not.toBeInTheDocument();
  });
});
