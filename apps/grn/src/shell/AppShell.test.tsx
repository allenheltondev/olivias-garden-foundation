import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { UserProfile } from '../types/user';
import { AppShell } from './AppShell';

const signOut = vi.fn();

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ signOut }),
}));

const user: UserProfile = {
  id: 'grower-1',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  userType: 'grower',
  onboardingCompleted: true,
  subscription: { tier: 'supporter' },
};

function renderShell(pathname = '/') {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <AppShell user={user}>
        <p>Page content</p>
      </AppShell>
    </MemoryRouter>
  );
}

describe('AppShell navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('keeps three everyday destinations in the mobile bar and settings in the desktop rail', () => {
    renderShell();

    const navigationRegions = screen.getAllByRole('navigation', { name: 'Primary navigation' });
    expect(navigationRegions).toHaveLength(2);

    expect(within(navigationRegions[0]).getAllByRole('link').map((link) => link.textContent?.trim()))
      .toEqual(['Today', 'Garden', 'Share', 'Settings']);
    expect(within(navigationRegions[1]).getAllByRole('link').map((link) => link.textContent?.trim()))
      .toEqual(['Today', 'Garden', 'Share']);
    expect(within(navigationRegions[1]).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();

    expect(screen.queryByRole('link', { name: 'Planner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open sections/i })).not.toBeInTheDocument();
  });

  it.each([
    ['/today/reminders', 'Today'],
    ['/garden/plants/new', 'Garden'],
    ['/garden/plan/recommendations', 'Garden'],
    ['/share/find', 'Share'],
    ['/settings/api-keys', 'Settings'],
    ['/settings/api-keys/reference', 'Settings'],
  ])('keeps %s nested under %s', (pathname, activeLabel) => {
    renderShell(pathname);

    const currentLinks = screen.getAllByRole('link', { current: 'page' });
    expect(currentLinks).toHaveLength(activeLabel === 'Settings' ? 1 : 2);
    expect(currentLinks.every((link) => link.textContent?.trim() === activeLabel)).toBe(true);
  });

  it('keeps profile, membership, settings, and API keys in the avatar menu', async () => {
    renderShell('/garden');

    await userEvent.click(screen.getByRole('button', { name: 'Ada Lovelace' }));

    expect(screen.getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Membership' })).toHaveAttribute(
      'href',
      '/settings#membership'
    );
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    // API keys is a page of its own now, not an anchor within Settings.
    expect(screen.getByRole('menuitem', { name: 'API keys' })).toHaveAttribute(
      'href',
      '/settings/api-keys'
    );
  });

  it('logs only the selected destination and navigation surface', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    renderShell();

    const mobileNavigation = screen.getAllByRole('navigation', { name: 'Primary navigation' })[1];
    await userEvent.click(within(mobileNavigation).getByRole('link', { name: 'Garden' }));

    expect(info).toHaveBeenCalledWith(
      '[navigation]',
      'Primary navigation selected',
      { destination: 'garden', source: 'mobile_bottom_nav' }
    );
    info.mockRestore();
  });
});
