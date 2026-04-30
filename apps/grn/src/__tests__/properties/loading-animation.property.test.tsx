import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../App';
import * as useAuthModule from '../../hooks/useAuth';
import fc from 'fast-check';

// Stub the shell + page tree to avoid API calls when authenticated paths render.
vi.mock('../../shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../pages/DashboardPage', () => ({
  DashboardPage: () => <div>Dashboard</div>,
}));
vi.mock('../../pages/CropsPage', () => ({ CropsPage: () => <div /> }));
vi.mock('../../pages/ListingsPage', () => ({ ListingsPage: () => <div /> }));
vi.mock('../../pages/RequestsPage', () => ({ RequestsPage: () => <div /> }));
vi.mock('../../pages/RemindersPage', () => ({ RemindersPage: () => <div /> }));

/**
 * Property 3: Loading Animation Consistency
 *
 * **Validates: Requirements 6.1, 6.6, 6.7**
 *
 * For any loading state in the application, the system SHALL display the PlantLoader
 * component with the plant lifecycle animation.
 */
describe('Property 3: Loading Animation Consistency', () => {
  let matchMediaMock: typeof window.matchMedia;

  beforeAll(() => {
    // Mock matchMedia for PlantLoader
    matchMediaMock = vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    window.matchMedia = matchMediaMock;

    // Mock window.location.assign for redirect testing
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, assign: vi.fn(), href: 'https://goodroots.network/' },
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use PlantLoader for all loading states', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (isLoading) => {
          // Mock loading state
          vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
            isAuthenticated: false,
            isLoading,
            refreshAuth: vi.fn(),
            signOut: vi.fn(),
            signIn: vi.fn(),
            clearError: vi.fn(),
            user: null,
            error: null,
          });

          const { container, unmount } = render(
            <MemoryRouter>
              <App />
            </MemoryRouter>
          );

          try {
            if (isLoading) {
              // Should render PlantLoader (check for plant-loader class or SVG)
              const plantLoader = container.querySelector('.plant-loader') ||
                                  container.querySelector('svg');
              expect(plantLoader, 'Loading state should render PlantLoader').toBeTruthy();

              // Should not render old spinner
              const oldSpinner = container.querySelector('.animate-spin.rounded-full.border-b-2');
              expect(oldSpinner, 'Should not use old spinner').not.toBeTruthy();
            }
          } finally {
            unmount();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('should render PlantLoader in App loading state', () => {
    vi.spyOn(useAuthModule, 'useAuth').mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      refreshAuth: vi.fn(),
      signOut: vi.fn(),
      signIn: vi.fn(),
      clearError: vi.fn(),
      user: null,
      error: null,
    });

    const { container } = render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    // Check for PlantLoader
    const plantLoader = container.querySelector('.plant-loader') ||
                        container.querySelector('svg');
    expect(plantLoader).toBeTruthy();

    // Check for loading text
    expect(container.textContent).toContain('Loading');
  });
});
