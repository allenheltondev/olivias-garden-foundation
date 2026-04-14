import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PinData } from '../PinLayer';

import { PinPopup, getContributorDisplayName, getPhotoAltText } from '../PinPopup';

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

describe('PinPopup', () => {
  // Requirement 8.11: popup closes on Escape key
  describe('Escape key dismissal', () => {
    it('calls onClose when Escape is pressed inside the popup', () => {
      const onClose = vi.fn();
      render(<PinPopup pin={makePinData()} onClose={onClose} />);
      const dialog = screen.getByRole('dialog');
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // Requirement 8.12: popup is keyboard-navigable
  describe('keyboard navigation', () => {
    it('renders a dialog with role="dialog" and aria-label', () => {
      render(
        <PinPopup pin={makePinData({ contributor_name: 'Bob' })} onClose={vi.fn()} />,
      );
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeTruthy();
      expect(dialog.getAttribute('aria-label')).toBe('Garden by Bob');
    });

    it('has focusable elements inside the dialog for Tab navigation', () => {
      const pin = makePinData({
        photo_urls: ['a.jpg', 'b.jpg'],
        story_text: 'A story',
      });
      render(<PinPopup pin={pin} onClose={vi.fn()} />);
      const dialog = screen.getByRole('dialog');
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );
      expect(focusable.length).toBeGreaterThan(0);
    });

    it('gallery region is focusable with tabIndex', () => {
      const pin = makePinData({ photo_urls: ['a.jpg', 'b.jpg'] });
      render(<PinPopup pin={pin} onClose={vi.fn()} />);
      const gallery = screen.getByRole('region', { name: 'Photo gallery' });
      expect(gallery.getAttribute('tabindex')).toBe('0');
    });
  });

  // Requirement 8.4: pin with no photos shows placeholder illustration
  describe('no photos placeholder', () => {
    it('renders a placeholder illustration when photo_urls is empty', () => {
      render(<PinPopup pin={makePinData({ photo_urls: [] })} onClose={vi.fn()} />);
      const placeholder = screen.getByLabelText('No photos available');
      expect(placeholder).toBeTruthy();
      const svg = placeholder.querySelector('svg');
      expect(svg).not.toBeNull();
    });

    it('does not render a photo gallery when there are no photos', () => {
      render(<PinPopup pin={makePinData({ photo_urls: [] })} onClose={vi.fn()} />);
      expect(screen.queryByRole('region', { name: 'Photo gallery' })).toBeNull();
    });
  });

  // Requirement 8.2: anonymous grower fallback
  describe('contributor name fallback', () => {
    it('displays "Anonymous Grower" when contributor_name is null', () => {
      render(<PinPopup pin={makePinData({ contributor_name: null })} onClose={vi.fn()} />);
      expect(screen.getByText('Anonymous Grower')).toBeTruthy();
    });
  });

  // Requirement 8.3: omit story section when null
  describe('story text', () => {
    it('omits story section when story_text is null', () => {
      render(<PinPopup pin={makePinData({ story_text: null })} onClose={vi.fn()} />);
      expect(screen.queryByText('Read more')).toBeNull();
    });

    it('shows "Read more" toggle when story_text is present', () => {
      render(
        <PinPopup pin={makePinData({ story_text: 'A long story' })} onClose={vi.fn()} />,
      );
      expect(screen.getByText('Read more')).toBeTruthy();
    });
  });
});

describe('getContributorDisplayName', () => {
  it('returns the name when provided', () => {
    expect(getContributorDisplayName('Alice')).toBe('Alice');
  });

  it('returns "Anonymous Grower" for null', () => {
    expect(getContributorDisplayName(null)).toBe('Anonymous Grower');
  });

  it('returns "Anonymous Grower" for undefined', () => {
    expect(getContributorDisplayName(undefined)).toBe('Anonymous Grower');
  });

  it('returns "Anonymous Grower" for empty string', () => {
    expect(getContributorDisplayName('')).toBe('Anonymous Grower');
  });

  it('returns "Anonymous Grower" for whitespace-only string', () => {
    expect(getContributorDisplayName('   ')).toBe('Anonymous Grower');
  });
});

describe('getPhotoAltText', () => {
  it('includes contributor name in alt text', () => {
    expect(getPhotoAltText('Alice', 0)).toBe('Garden photo 1 from Alice');
  });

  it('uses "Anonymous Grower" for null contributor', () => {
    expect(getPhotoAltText(null, 2)).toBe('Garden photo 3 from Anonymous Grower');
  });

  it('uses 1-based index in alt text', () => {
    expect(getPhotoAltText('Bob', 4)).toBe('Garden photo 5 from Bob');
  });
});
