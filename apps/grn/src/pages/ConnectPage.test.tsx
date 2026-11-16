import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ConnectPage } from './ConnectPage';

function LocationDisplay() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ConnectPage />
      <LocationDisplay />
    </MemoryRouter>
  );
}

describe('ConnectPage', () => {
  it('renders the four connect options', () => {
    renderPage();
    expect(screen.getByText('Food to share')).toBeInTheDocument();
    expect(screen.getByText('Find food nearby')).toBeInTheDocument();
    expect(screen.getByText('What neighbors need')).toBeInTheDocument();
    expect(screen.getByText('Share your garden')).toBeInTheDocument();
  });

  it('navigates to the listings flow from the share card', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /share food/i }));
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/share/listings');
    });
  });

  it('navigates to find-food from the discover card', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /discover food/i }));
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/share/find');
    });
  });

  it('keeps garden sharing and insights available as secondary links', async () => {
    renderPage();
    expect(screen.getByText(/nothing is shared automatically/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /what neighbors need/i }))
      .toHaveAttribute('href', '/garden/plan/recommendations');
    await userEvent.click(screen.getByRole('link', { name: /share your garden/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/garden');
  });
});
