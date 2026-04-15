import { useEffect, useRef, useState, useCallback } from 'react';
import type { PinData } from './PinLayer';
import './PinPopup.css';

export interface PinPopupProps {
  pin: PinData;
  onClose: () => void;
}

/**
 * Returns display name for a contributor.
 * Returns "Anonymous Grower" for null, undefined, or empty/whitespace-only strings.
 */
export function getContributorDisplayName(name: string | null | undefined): string {
  if (!name || name.trim() === '') return 'Anonymous Grower';
  return name;
}

/**
 * Returns alt text for a photo in the popup gallery.
 * Includes contributor context for accessibility (Requirement 13.5).
 */
export function getPhotoAltText(contributorName: string | null | undefined, index: number): string {
  const displayName = getContributorDisplayName(contributorName);
  return `Garden photo ${index + 1} from ${displayName}`;
}

/** Placeholder SVG shown when a pin has no photos */
function PhotoPlaceholder() {
  return (
    <div className="pin-popup-placeholder" aria-label="No photos available">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path
          d="M32 8c-2 0-4 2-4 5 0 4 2 8 4 11 2-3 4-7 4-11 0-3-2-5-4-5z"
          fill="currentColor" opacity="0.6"
        />
        <path d="M32 18v20M26 28c2-2 6-2 8 0" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        <ellipse cx="32" cy="44" rx="10" ry="4" fill="currentColor" opacity="0.2" />
      </svg>
    </div>
  );
}

/** Photo gallery with horizontal swipe and dot indicators */
function PhotoGallery({ photos, contributorName }: { photos: string[]; contributorName: string | null }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const goTo = useCallback((index: number) => {
    setCurrentIndex(Math.max(0, Math.min(index, photos.length - 1)));
  }, [photos.length]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(currentIndex - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(currentIndex + 1);
    }
  }, [currentIndex, goTo]);

  const touchStartX = useRef(0);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 40) {
      goTo(dx > 0 ? currentIndex - 1 : currentIndex + 1);
    }
  }, [currentIndex, goTo]);

  return (
    <div
      className="pin-popup-gallery"
      role="region"
      aria-label="Photo gallery"
      aria-roledescription="carousel"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="pin-popup-gallery-track"
        ref={trackRef}
        style={{ transform: `translateX(-${currentIndex * 100}%)` }}
      >
        {photos.map((url, i) => (
          <div className="pin-popup-gallery-slide" key={url} aria-hidden={i !== currentIndex}>
            <img
              src={url}
              alt={getPhotoAltText(contributorName, i)}
              loading={i === 0 ? 'eager' : 'lazy'}
            />
          </div>
        ))}
      </div>

      {photos.length > 1 && currentIndex > 0 && (
        <button
          className="pin-popup-gallery-btn pin-popup-gallery-btn--prev"
          onClick={() => goTo(currentIndex - 1)}
          aria-label="Previous photo"
        >
          &#8249;
        </button>
      )}
      {photos.length > 1 && currentIndex < photos.length - 1 && (
        <button
          className="pin-popup-gallery-btn pin-popup-gallery-btn--next"
          onClick={() => goTo(currentIndex + 1)}
          aria-label="Next photo"
        >
          &#8250;
        </button>
      )}

      {photos.length > 1 && (
        <div className="pin-popup-dots" role="tablist" aria-label="Photo indicators">
          {photos.map((_, i) => (
            <button
              key={i}
              className={`pin-popup-dot${i === currentIndex ? ' pin-popup-dot--active' : ''}`}
              onClick={() => goTo(i)}
              role="tab"
              aria-selected={i === currentIndex}
              aria-label={`Photo ${i + 1} of ${photos.length}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * PinPopup — rendered as a DOM overlay positioned over the map.
 * Displays photo gallery, contributor name, and story text.
 * Focus trap when open, Escape to dismiss.
 */
export function PinPopup({ pin, onClose }: PinPopupProps) {
  const [expanded, setExpanded] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  const displayName = getContributorDisplayName(pin.contributor_name);
  const hasStory = pin.story_text != null && pin.story_text.trim() !== '';
  const hasPhotos = pin.photo_urls.length > 0;

  // Focus trap + Escape to dismiss
  useEffect(() => {
    const el = popupRef.current;
    if (!el) return;

    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = Array.from(el.querySelectorAll<HTMLElement>(focusableSelector));
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    el.addEventListener('keydown', handleKeyDown);

    const gallery = el.querySelector<HTMLElement>('.pin-popup-gallery');
    if (gallery) {
      gallery.focus();
    } else {
      el.focus();
    }

    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid closing immediately from the pin click itself
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  return (
    <div className="pin-popup-overlay">
      <div ref={popupRef} className="pin-popup-card" tabIndex={-1} role="dialog" aria-label={`Garden by ${displayName}`}>
        <button className="pin-popup-close" onClick={onClose} aria-label="Close popup">&times;</button>

        {hasPhotos ? (
          <PhotoGallery photos={pin.photo_urls} contributorName={pin.contributor_name} />
        ) : (
          <PhotoPlaceholder />
        )}

        <div className="pin-popup-body">
          <p className="pin-popup-contributor">{displayName}</p>

          {hasStory && (
            <>
              <p className={`pin-popup-story ${expanded ? 'pin-popup-story--expanded' : 'pin-popup-story--truncated'}`}>
                {pin.story_text}
              </p>
              <button
                className="pin-popup-read-more"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
              >
                {expanded ? 'Show less' : 'Read more'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
