import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsBar } from '../StatsBar';

describe('StatsBar', () => {
  // Requirement 9.4: skeleton placeholders while loading
  describe('loading state', () => {
    it('renders a <dl> with aria-busy while loading', () => {
      render(<StatsBar stats={null} loading={true} error={false} />);
      const dl = screen.getByLabelText('Community statistics');
      expect(dl.tagName).toBe('DL');
      expect(dl.getAttribute('aria-busy')).toBe('true');
    });

    it('renders skeleton placeholders (aria-hidden spans) while loading', () => {
      const { container } = render(<StatsBar stats={null} loading={true} error={false} />);
      const skeletons = container.querySelectorAll('[aria-hidden="true"]');
      // 2 items × 2 skeletons each (value + label) = 4
      expect(skeletons.length).toBe(4);
    });
  });

  // Requirement 9.5: hides gracefully on error
  describe('error state', () => {
    it('renders nothing when error is true', () => {
      const { container } = render(<StatsBar stats={null} loading={false} error={true} />);
      expect(container.innerHTML).toBe('');
    });

    it('renders nothing even if stats are provided alongside error', () => {
      const stats = { total_pins: 10, country_count: 3, contributor_count: 5 };
      const { container } = render(<StatsBar stats={stats} loading={false} error={true} />);
      expect(container.innerHTML).toBe('');
    });
  });

  // Requirement 13.4: uses <dl> semantic HTML
  describe('semantic HTML', () => {
    it('renders stats inside a <dl> element', () => {
      const stats = { total_pins: 42, country_count: 7, contributor_count: 12 };
      const { container } = render(<StatsBar stats={stats} loading={false} error={false} />);
      const dl = container.querySelector('dl');
      expect(dl).not.toBeNull();
    });

    it('uses <dt> for values and <dd> for labels', () => {
      const stats = { total_pins: 1000, country_count: 25, contributor_count: 300 };
      render(<StatsBar stats={stats} loading={false} error={false} />);
      const terms = screen.getAllByRole('term');
      const definitions = screen.getAllByRole('definition');
      expect(terms).toHaveLength(2);
      expect(definitions).toHaveLength(2);
    });

    it('includes an aria-label on the <dl> for screen readers', () => {
      const stats = { total_pins: 1, country_count: 1, contributor_count: 1 };
      render(<StatsBar stats={stats} loading={false} error={false} />);
      expect(screen.getByLabelText('Community statistics')).toBeTruthy();
    });
  });
});
