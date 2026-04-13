import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserTypeSelection } from './UserTypeSelection';
import type { UserType } from '../../types/user';

describe('UserTypeSelection', () => {
  let mockOnSelect: (userType: UserType) => Promise<void>;

  beforeEach(() => {
    mockOnSelect = vi.fn().mockResolvedValue(undefined);
  });

  it('renders welcome message and both user type options', () => {
    render(<UserTypeSelection onSelect={mockOnSelect} />);

    expect(screen.getByText('Welcome to Good Roots Network')).toBeInTheDocument();
    expect(screen.getByText('How would you like to participate?')).toBeInTheDocument();
    expect(screen.getByText("I'm a Grower")).toBeInTheDocument();
    expect(screen.getByText("I'm a Gatherer")).toBeInTheDocument();
  });

  it('displays clear descriptions for each user type', () => {
    render(<UserTypeSelection onSelect={mockOnSelect} />);

    expect(
      screen.getByText(/I grow food and want to share my surplus/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/I'm looking for locally grown food/)
    ).toBeInTheDocument();
  });

  it('allows selecting gatherer type', () => {
    render(<UserTypeSelection onSelect={mockOnSelect} />);

    const gathererCard = screen.getByRole('button', { name: /gatherer/i });
    fireEvent.click(gathererCard);

    expect(screen.getByText('Selected')).toBeInTheDocument();
    expect(gathererCard).toHaveAttribute('aria-pressed', 'true');
  });

  it('allows switching between selections', () => {
    render(<UserTypeSelection onSelect={mockOnSelect} />);

    const growerCard = screen.getByRole('button', { name: /grower/i });
    const gathererCard = screen.getByRole('button', { name: /gatherer/i });

    fireEvent.click(growerCard);
    expect(growerCard).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(gathererCard);
    expect(gathererCard).toHaveAttribute('aria-pressed', 'true');
    expect(growerCard).toHaveAttribute('aria-pressed', 'false');
  });

  it('prevents proceeding without selection', async () => {
    render(<UserTypeSelection onSelect={mockOnSelect} />);

    const continueButton = screen.getByRole('button', { name: /continue/i });

    // Button should be disabled when no selection is made
    expect(continueButton).toBeDisabled();
    expect(mockOnSelect).not.toHaveBeenCalled();
  });

  it('calls onSelect with grower type when continue is clicked', async () => {
    render(<UserTypeSelection onSelect={mockOnSelect} />);

    const growerCard = screen.getByRole('button', { name: /grower/i });
    fireEvent.click(growerCard);

    const continueButton = screen.getByRole('button', { name: /continue/i });
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(mockOnSelect).toHaveBeenCalledWith('grower');
    });
  });

  it('calls onSelect with gatherer type when continue is clicked', async () => {
    render(<UserTypeSelection onSelect={mockOnSelect} />);

    const gathererCard = screen.getByRole('button', { name: /gatherer/i });
    fireEvent.click(gathererCard);

    const continueButton = screen.getByRole('button', { name: /continue/i });
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(mockOnSelect).toHaveBeenCalledWith('gatherer');
    });
  });

  it('shows loading state during submission', async () => {
    const slowOnSelect: (userType: UserType) => Promise<void> = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
    render(<UserTypeSelection onSelect={slowOnSelect} />);

    const growerCard = screen.getByRole('button', { name: /grower/i });
    fireEvent.click(growerCard);

    const continueButton = screen.getByRole('button', { name: /continue/i });
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(continueButton).toHaveAttribute('aria-busy', 'true');
    });
  });

  it('disables interaction during submission', async () => {
    const slowOnSelect: (userType: UserType) => Promise<void> = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
    render(<UserTypeSelection onSelect={slowOnSelect} />);

    const growerCard = screen.getByRole('button', { name: /grower/i });
    fireEvent.click(growerCard);

    const continueButton = screen.getByRole('button', { name: /continue/i });
    fireEvent.click(continueButton);

    // Try to change selection during submission
    const gathererCard = screen.getByRole('button', { name: /gatherer/i });
    fireEvent.click(gathererCard);

    await waitFor(() => {
      expect(continueButton).toHaveAttribute('aria-busy', 'true');
    });

    // Selection should not have changed
    expect(growerCard).toHaveAttribute('aria-pressed', 'true');
  });

  it('displays error message when onSelect fails', async () => {
    const errorMessage = 'Network error occurred';
    const mockOnSelectWithError: (userType: UserType) => Promise<void> = vi.fn().mockRejectedValueOnce(new Error(errorMessage));

    render(<UserTypeSelection onSelect={mockOnSelectWithError} />);

    const growerCard = screen.getByRole('button', { name: /grower/i });
    fireEvent.click(growerCard);

    const continueButton = screen.getByRole('button', { name: /continue/i });
    fireEvent.click(continueButton);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  it('clears error when making a new selection', async () => {
    const mockOnSelectWithError: (userType: UserType) => Promise<void> = vi.fn().mockRejectedValueOnce(new Error('Network error'));
    render(<UserTypeSelection onSelect={mockOnSelectWithError} />);

    // Make a selection
    const growerCard = screen.getByRole('button', { name: /grower/i });
    fireEvent.click(growerCard);

    // Try to continue - this will fail
    const continueButton = screen.getByRole('button', { name: /continue/i });
    fireEvent.click(continueButton);

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });

    // Make a different selection
    const gathererCard = screen.getByRole('button', { name: /gatherer/i });
    fireEvent.click(gathererCard);

    // Error should be cleared
    expect(screen.queryByText(/Network error/i)).not.toBeInTheDocument();
  });

  it('supports keyboard navigation for grower card', async () => {
    render(<UserTypeSelection onSelect={mockOnSelect} />);

    const growerCard = screen.getByRole('button', { name: /grower/i });

    // Simulate Enter key
    fireEvent.keyDown(growerCard, { key: 'Enter' });
    expect(growerCard).toHaveAttribute('aria-pressed', 'true');
  });

  it('supports keyboard navigation for gatherer card', async () => {
    render(<UserTypeSelection onSelect={mockOnSelect} />);

    const gathererCard = screen.getByRole('button', { name: /gatherer/i });

    // Simulate Space key
    fireEvent.keyDown(gathererCard, { key: ' ' });
    expect(gathererCard).toHaveAttribute('aria-pressed', 'true');
  });

  it('has proper accessibility attributes', () => {
    render(<UserTypeSelection onSelect={mockOnSelect} />);

    const growerCard = screen.getByRole('button', { name: /grower/i });
    const gathererCard = screen.getByRole('button', { name: /gatherer/i });

    expect(growerCard).toHaveAttribute('tabIndex', '0');
    expect(gathererCard).toHaveAttribute('tabIndex', '0');
    expect(growerCard).toHaveAttribute('aria-pressed');
    expect(gathererCard).toHaveAttribute('aria-pressed');
  });
});
