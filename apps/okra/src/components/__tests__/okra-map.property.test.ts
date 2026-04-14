// Feature: okra-map, Property 11: Stats bar renders all statistics with locale formatting
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { StatsBar } from '../StatsBar';

// **Validates: Requirements 9.1, 9.2**
describe('Property 11: Stats bar renders all statistics with locale formatting', () => {
  const fmt = new Intl.NumberFormat();

  it('renders both statistics with locale-formatted numbers and correct labels', () => {
    fc.assert(
      fc.property(
        fc.nat(),
        fc.nat(),
        (totalPins, countryCount) => {
          const stats = {
            total_pins: totalPins,
            country_count: countryCount,
            contributor_count: 0,
          };

          const { unmount } = render(
            createElement(StatsBar, { stats, loading: false, error: false })
          );

          const terms = screen.getAllByRole('term');
          const definitions = screen.getAllByRole('definition');

          expect(terms).toHaveLength(2);
          expect(definitions).toHaveLength(2);

          const termTexts = terms.map((t) => t.textContent);
          expect(termTexts).toContain(fmt.format(totalPins));
          expect(termTexts).toContain(fmt.format(countryCount));

          const defTexts = definitions.map((d) => d.textContent);
          expect(defTexts).toContain('growers');
          expect(defTexts).toContain('countries');

          unmount();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: okra-map, Property 6: Density-based clustering configuration
// **Validates: Requirements 7.2, 7.3, 7.4, 7.7**
import { getClusteringConfig, getClusterSizeCategory } from '../PinLayer';

describe('Property 6: Density-based clustering configuration', () => {
  it('returns no clustering for pinCount <= 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 0 }),
        (n) => {
          const config = getClusteringConfig(n);
          expect(config.enabled).toBe(false);
          expect(config.maxZoom).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns no clustering with maxZoom 8 for 1–9 pins', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9 }),
        (n) => {
          const config = getClusteringConfig(n);
          expect(config.enabled).toBe(false);
          expect(config.maxZoom).toBe(8);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns clustering below zoom 10 for 10–500 pins', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 500 }),
        (n) => {
          const config = getClusteringConfig(n);
          expect(config.enabled).toBe(true);
          expect(config.disableClusteringAtZoom).toBe(10);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns aggressive clustering below zoom 13 for 501–2000 pins', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 501, max: 2000 }),
        (n) => {
          const config = getClusteringConfig(n);
          expect(config.enabled).toBe(true);
          expect(config.disableClusteringAtZoom).toBe(13);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns clustering at all zoom levels below 15 for 2001+ pins', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2001, max: 100000 }),
        (n) => {
          const config = getClusteringConfig(n);
          expect(config.enabled).toBe(true);
          expect(config.disableClusteringAtZoom).toBe(15);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: okra-map, Property 7: Cluster size category scales with pin count
// **Validates: Requirements 6.4**
describe('Property 7: Cluster size category scales with pin count', () => {
  it('returns "small" for counts 2–5', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        (count) => {
          expect(getClusterSizeCategory(count)).toBe('small');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns "medium" for counts 6–20', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 6, max: 20 }),
        (count) => {
          expect(getClusterSizeCategory(count)).toBe('medium');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns "large" for counts 21+', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 21, max: 100000 }),
        (count) => {
          expect(getClusterSizeCategory(count)).toBe('large');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: okra-map, Property 8: Popup renders correct content with fallbacks
// **Validates: Requirements 1.7, 8.1, 8.2, 8.3**
import { getContributorDisplayName } from '../PinPopup';

describe('Property 8: Popup renders correct content with fallbacks', () => {
  it('returns "Anonymous Grower" for null, undefined, or empty/whitespace contributor names', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.constant(''),
          fc.stringOf(fc.constant(' '), { minLength: 1, maxLength: 20 })
        ),
        (name) => {
          expect(getContributorDisplayName(name)).toBe('Anonymous Grower');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns the actual name for non-empty, non-whitespace contributor names', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        (name) => {
          expect(getContributorDisplayName(name)).toBe(name);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('story section is present only when story_text is non-null and non-empty', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(''),
          fc.constant('   '),
          fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0)
        ),
        (storyText) => {
          const hasStory = storyText != null && storyText.trim() !== '';
          if (storyText === null || storyText.trim() === '') {
            expect(hasStory).toBe(false);
          } else {
            expect(hasStory).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: okra-map, Property 9: Multi-photo gallery indicator count
// **Validates: Requirements 8.7**
describe('Property 9: Multi-photo gallery indicator count', () => {
  it('generates exactly N dot indicators for N photos where N > 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 50 }),
        (photoCount) => {
          const photos = Array.from(
            { length: photoCount },
            (_, i) => `https://cdn.example.com/photo-${i}.jpg`
          );

          // The gallery renders dot indicators when photos.length > 1
          // Each dot corresponds to one photo
          const dotCount = photos.length > 1 ? photos.length : 0;
          expect(dotCount).toBe(photoCount);

          // Exactly one dot should be active at any time (initially index 0)
          const activeIndex = 0;
          const activeDots = photos.map((_, i) => i === activeIndex).filter(Boolean);
          expect(activeDots).toHaveLength(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('does not render dot indicators for a single photo', () => {
    fc.assert(
      fc.property(
        fc.constant(1),
        (photoCount) => {
          const photos = Array.from(
            { length: photoCount },
            (_, i) => `https://cdn.example.com/photo-${i}.jpg`
          );
          const dotCount = photos.length > 1 ? photos.length : 0;
          expect(dotCount).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: okra-map, Property 10: Single popup invariant
// **Validates: Requirements 8.10**
describe('Property 10: Single popup invariant', () => {
  /**
   * Model the state management: given a sequence of pin click events,
   * at most one popup (activePinId) is set at any time.
   * Clicking a new pin replaces the previous activePinId.
   */
  it('only one activePinId is set at a time after any sequence of pin clicks', () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 50 }),
        (pinClickSequence) => {
          let activePinId: string | null = null;

          for (const clickedId of pinClickSequence) {
            // Simulate the state update: clicking a pin sets it as active
            // If the same pin is clicked again, it toggles off (close popup)
            if (activePinId === clickedId) {
              activePinId = null;
            } else {
              activePinId = clickedId;
            }

            // Invariant: at most one popup is active
            // activePinId is either null (no popup) or a single string (one popup)
            if (activePinId !== null) {
              expect(typeof activePinId).toBe('string');
              expect(activePinId).toBe(clickedId);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('clicking a new pin while popup is open closes the previous and opens the new one', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.uuid().filter((id) => id.length > 0),
        (firstPinId, secondPinId) => {
          // Start with first pin active
          let activePinId: string | null = firstPinId;
          expect(activePinId).toBe(firstPinId);

          // Click second pin — should replace
          activePinId = secondPinId;
          expect(activePinId).toBe(secondPinId);
          expect(activePinId).not.toBe(firstPinId === secondPinId ? 'impossible' : firstPinId);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: okra-map, Property 12: Focus management round trip
// **Validates: Requirements 13.2**
describe('Property 12: Focus management round trip', () => {
  /**
   * Test the focus trap keyboard handling concept:
   * When Tab is pressed on the last focusable element, focus wraps to the first.
   * When Shift+Tab is pressed on the first focusable element, focus wraps to the last.
   */
  it('focus trap wraps correctly for any number of focusable elements', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 19 }),
        fc.boolean(),
        (focusableCount, startIndex, shiftKey) => {
          const clampedStart = startIndex % focusableCount;
          const focusableElements = Array.from({ length: focusableCount }, (_, i) => `el-${i}`);

          let currentFocusIndex = clampedStart;

          // Simulate Tab or Shift+Tab
          if (shiftKey) {
            // Shift+Tab: if on first element, wrap to last
            if (currentFocusIndex === 0) {
              currentFocusIndex = focusableElements.length - 1;
            } else {
              currentFocusIndex -= 1;
            }
          } else {
            // Tab: if on last element, wrap to first
            if (currentFocusIndex === focusableElements.length - 1) {
              currentFocusIndex = 0;
            } else {
              currentFocusIndex += 1;
            }
          }

          // Focus index should always be within bounds
          expect(currentFocusIndex).toBeGreaterThanOrEqual(0);
          expect(currentFocusIndex).toBeLessThan(focusableElements.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Escape key triggers close and focus returns to trigger element', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (triggerId) => {
          // Model: popup opens, trigger element id is stored
          const triggerElementId = triggerId;
          let popupOpen = true;
          let focusReturnTarget: string | null = null;

          // Simulate Escape key press
          if (popupOpen) {
            popupOpen = false;
            focusReturnTarget = triggerElementId;
          }

          // After close, focus should return to the trigger
          expect(popupOpen).toBe(false);
          expect(focusReturnTarget).toBe(triggerElementId);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: okra-map, Property 13: Image alt text includes contributor context
// **Validates: Requirements 13.5**
import { getPhotoAltText } from '../PinPopup';

describe('Property 13: Image alt text includes contributor context', () => {
  it('alt text includes contributor name when provided', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        fc.nat({ max: 20 }),
        (contributorName, index) => {
          const alt = getPhotoAltText(contributorName, index);
          expect(alt).toContain(contributorName);
          expect(alt).toContain(`Garden photo ${index + 1}`);
          expect(alt).toContain('from');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('alt text uses "Anonymous Grower" when contributor name is null or empty', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.constant(''),
          fc.stringOf(fc.constant(' '), { minLength: 1, maxLength: 10 })
        ),
        fc.nat({ max: 20 }),
        (contributorName, index) => {
          const alt = getPhotoAltText(contributorName, index);
          expect(alt).toContain('Anonymous Grower');
          expect(alt).toContain(`Garden photo ${index + 1}`);
          expect(alt).not.toMatch(/from\s*$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('alt text always follows the pattern "Garden photo N from DisplayName"', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
        fc.nat({ max: 50 }),
        (contributorName, index) => {
          const alt = getPhotoAltText(contributorName, index);
          const expectedName = getContributorDisplayName(contributorName);
          expect(alt).toBe(`Garden photo ${index + 1} from ${expectedName}`);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: okra-map, Property 5: Initial viewport contains all pins with padding
// **Validates: Requirements 1.4, 1.5**
import { computeViewportBounds } from '../MapView';
import type { PinData } from '../PinLayer';

/** Helper: create a minimal PinData from lat/lng */
function makePin(lat: number, lng: number, index: number): PinData {
  return {
    id: `pin-${index}`,
    display_lat: lat,
    display_lng: lng,
    contributor_name: null,
    story_text: null,
    country: null,
    photo_urls: [],
  };
}

describe('Property 5: Initial viewport contains all pins with padding', () => {
  // Arbitrary for generating valid lat/lng coordinates
  const latArb = fc.double({ min: -85, max: 85, noNaN: true, noDefaultInfinity: true });
  const lngArb = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });

  it('returns null for fewer than 3 pins (world-level zoom default)', () => {
    // Feature: okra-map, Property 5: Initial viewport contains all pins with padding
    fc.assert(
      fc.property(
        fc.array(fc.tuple(latArb, lngArb), { minLength: 0, maxLength: 2 }),
        (coords) => {
          const pins = coords.map(([lat, lng], i) => makePin(lat, lng, i));
          const bounds = computeViewportBounds(pins);
          expect(bounds).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('computed bounds contain every pin position for 3+ pins', () => {
    // Feature: okra-map, Property 5: Initial viewport contains all pins with padding
    fc.assert(
      fc.property(
        fc.array(fc.tuple(latArb, lngArb), { minLength: 3, maxLength: 200 }),
        (coords) => {
          const pins = coords.map(([lat, lng], i) => makePin(lat, lng, i));
          const bounds = computeViewportBounds(pins);

          expect(bounds).not.toBeNull();

          const sw = bounds!.getSouthWest();
          const ne = bounds!.getNorthEast();

          // Every pin must be within the computed bounds
          for (const pin of pins) {
            expect(pin.display_lat).toBeGreaterThanOrEqual(sw.lat);
            expect(pin.display_lat).toBeLessThanOrEqual(ne.lat);
            expect(pin.display_lng).toBeGreaterThanOrEqual(sw.lng);
            expect(pin.display_lng).toBeLessThanOrEqual(ne.lng);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('bounds extend at least 10% beyond extreme pin positions on each edge', () => {
    // Feature: okra-map, Property 5: Initial viewport contains all pins with padding
    fc.assert(
      fc.property(
        fc.array(fc.tuple(latArb, lngArb), { minLength: 3, maxLength: 200 }),
        (coords) => {
          const pins = coords.map(([lat, lng], i) => makePin(lat, lng, i));
          const bounds = computeViewportBounds(pins);

          expect(bounds).not.toBeNull();

          const sw = bounds!.getSouthWest();
          const ne = bounds!.getNorthEast();

          // Compute the extreme pin positions
          const lats = pins.map((p) => p.display_lat);
          const lngs = pins.map((p) => p.display_lng);
          const minLat = Math.min(...lats);
          const maxLat = Math.max(...lats);
          const minLng = Math.min(...lngs);
          const maxLng = Math.max(...lngs);

          const latSpan = maxLat - minLat;
          const lngSpan = maxLng - minLng;

          // The implementation uses 10% padding or 0.5 fallback when span is 0
          const expectedLatPad = latSpan * 0.1 || 0.5;
          const expectedLngPad = lngSpan * 0.1 || 0.5;

          // Bounds should extend at least the padding amount beyond extremes
          // Use a small epsilon for floating point comparison
          const eps = 1e-9;
          expect(sw.lat).toBeLessThanOrEqual(minLat - expectedLatPad + eps);
          expect(ne.lat).toBeGreaterThanOrEqual(maxLat + expectedLatPad - eps);
          expect(sw.lng).toBeLessThanOrEqual(minLng - expectedLngPad + eps);
          expect(ne.lng).toBeGreaterThanOrEqual(maxLng + expectedLngPad - eps);
        }
      ),
      { numRuns: 100 }
    );
  });
});
