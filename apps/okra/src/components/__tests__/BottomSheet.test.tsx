import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { BottomSheet } from '../BottomSheet';
import type { PinData } from '../PinLayer';

function makePinData(overrides: Partial<PinData> = {}): PinData {
  return {
    id: 'pin-1',
    display_lat: 40.7,
    display_lng: -74.0,
    contributor_name: 'Jane',
    story_text: 'My okra garden story',
    country: null,
    photo_urls: ['https://cdn.example.com/photo1.jpg'],
    ...overrides,
  };
}

describe('BottomSheet', () => {
  // Requirement 11.3: bottom sheet renders on mobile viewport
  describe('rendering', () => {
    it('renders a dialog with role="dialog" and aria-label', () => {
      render(<BottomSheet pin={makePinData({ contributor_name: 'Bob' })} onClose={vi.fn()} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeTruthy();
      expect(dialog.getAttribute('aria-label')).toBe('Garden by Bob');
    });

    it('renders the contributor name', () => {
      render(<BottomSheet pin={makePinData({ contributor_name: 'Alice' })} onClose={vi.fn()} />);
      expect(screen.getByText('Alice')).toBeTruthy();
    });

    it('renders "Anonymous Grower" when contributor_name is null', () => {
      render(<BottomSheet pin={makePinData({ contributor_name: null })} onClose={vi.fn()} />);
      expect(screen.getByText('Anonymous Grower')).toBeTruthy();
    });

    it('renders a drag handle for swipe-to-dismiss', () => {
      render(<BottomSheet pin={makePinData()} onClose={vi.fn()} />);
      expect(screen.getByLabelText('Drag to dismiss')).toBeTruthy();
    });

    it('renders an overlay behind the sheet', () => {
      const { container } = render(<BottomSheet pin={makePinData()} onClose={vi.fn()} />);
      const overlay = container.querySelector('.bottom-sheet-overlay');
      expect(overlay).not.toBeNull();
    });
  });

  // Requirement 8.11 (applied to BottomSheet): Escape key dismissal
  describe('Escape key dismissal', () => {
    it('calls onClose when Escape is pressed', () => {
      vi.useFakeTimers();
      const onClose = vi.fn();
      render(<BottomSheet pin={makePinData()} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      // BottomSheet animates out then calls onClose after 300ms
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(onClose).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });

  // Requirement 8.4: no photos shows placeholder
  describe('no photos placeholder', () => {
    it('renders a placeholder illustration when photo_urls is empty', () => {
      render(<BottomSheet pin={makePinData({ photo_urls: [] })} onClose={vi.fn()} />);
      const placeholder = screen.getByLabelText('No photos available');
      expect(placeholder).toBeTruthy();

      const svg = placeholder.querySelector('svg');
      expect(svg).not.toBeNull();
    });
  });

  // Story text behavior
  describe('story text', () => {
    it('omits story section when story_text is null', () => {
      render(<BottomSheet pin={makePinData({ story_text: null })} onClose={vi.fn()} />);
      expect(screen.queryByText('Read more')).toBeNull();
    });

    it('shows "Read more" toggle when story_text is present', () => {
      render(<BottomSheet pin={makePinData({ story_text: 'A long story' })} onClose={vi.fn()} />);
      expect(screen.getByText('Read more')).toBeTruthy();
    });

    it('toggles expanded state on "Read more" click', () => {
      render(<BottomSheet pin={makePinData({ story_text: 'A long story' })} onClose={vi.fn()} />);
      const toggle = screen.getByText('Read more');
      fireEvent.click(toggle);
      expect(screen.getByText('Show less')).toBeTruthy();
    });
  });

  // Photo gallery with multiple photos
  describe('photo gallery', () => {
    it('renders gallery with dot indicators for multiple photos', () => {
      const pin = makePinData({ photo_urls: ['a.jpg', 'b.jpg', 'c.jpg'] });
      render(<BottomSheet pin={pin} onClose={vi.fn()} />);

      const gallery = screen.getByRole('region', { name: 'Photo gallery' });
      expect(gallery).toBeTruthy();

      const dots = screen.getAllByRole('tab');
      expect(dots).toHaveLength(3);
    });
  });
});
