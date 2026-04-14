import { useEffect, useRef, useState, useCallback } from 'react';
import type { PinData } from './PinLayer';
import { getContributorDisplayName, getPhotoAltText } from './PinPopup';
import './BottomSheet.css';

export interface BottomSheetProps {
  pin: PinData;
  onClose: () => void;
}

/** Threshold in px — if dragged down more than this, dismiss the sheet */
const DISMISS_THRESHOLD = 80;

/** Photo gallery with horizontal swipe and dot indicators (full-width variant) */
function BottomSheetGallery({
  photos,
  contributorName,
}: {
  photos: string[];
  contributorName: string | null;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const goTo = useCallback(
    (index: number) => {
      setCurrentIndex(Math.max(0, Math.min(index, photos.length - 1)));
    },
    [photos.length],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goTo(currentIndex - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goTo(currentIndex + 1);
      }
    },
    [currentIndex, goTo],
  );

  const touchStartX = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      if (Math.abs(dx) > 40) {
        goTo(dx > 0 ? currentIndex - 1 : currentIndex + 1);
      }
    },
    [currentIndex, goTo],
  );

  return (
    <div
      className="bottom-sheet-gallery"
      role="region"
      aria-label="Photo gallery"
      aria-roledescription="carousel"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="bottom-sheet-gallery-track"
        style={{ transform: `translateX(-${currentIndex * 100}%)` }}
      >
        {photos.map((url, i) => (
          <div className="bottom-sheet-gallery-slide" key={url} aria-hidden={i !== currentIndex}>
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
          className="bottom-sheet-gallery-btn bottom-sheet-gallery-btn--prev"
          onClick={() => goTo(currentIndex - 1)}
          aria-label="Previous photo"
        >
          &#8249;
        </button>
      )}
      {photos.length > 1 && currentIndex < photos.length - 1 && (
        <button
          className="bottom-sheet-gallery-btn bottom-sheet-gallery-btn--next"
          onClick={() => goTo(currentIndex + 1)}
          aria-label="Next photo"
        >
          &#8250;
        </button>
      )}

      {photos.length > 1 && (
        <div className="bottom-sheet-dots" role="tablist" aria-label="Photo indicators">
          {photos.map((_, i) => (
            <button
              key={i}
              className={`bottom-sheet-dot${i === currentIndex ? ' bottom-sheet-dot--active' : ''}`}
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

/** Placeholder SVG shown when a pin has no photos */
function PhotoPlaceholder() {
  return (
    <div className="bottom-sheet-placeholder" aria-label="No photos available">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path
          d="M32 8c-2 0-4 2-4 5 0 4 2 8 4 11 2-3 4-7 4-11 0-3-2-5-4-5z"
          fill="currentColor"
          opacity="0.6"
        />
        <path
          d="M32 18v20M26 28c2-2 6-2 8 0"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <ellipse cx="32" cy="44" rx="10" ry="4" fill="currentColor" opacity="0.2" />
      </svg>
    </div>
  );
}

/**
 * BottomSheet — mobile slide-up panel for pin details.
 * Slides up from the bottom of the viewport on mobile (<768px).
 * Draggable: swipe down to dismiss, swipe up to expand.
 * Map remains pannable/zoomable behind the sheet.
 */
export function BottomSheet({ pin, onClose }: BottomSheetProps) {
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);

  const displayName = getContributorDisplayName(pin.contributor_name);
  const hasStory = pin.story_text != null && pin.story_text.trim() !== '';
  const hasPhotos = pin.photo_urls.length > 0;

  // Animate in on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 300);
  }, [onClose]);

  // Escape to dismiss
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleDismiss]);

  // Drag handling via touch events on the handle area
  const handleDragStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  }, []);

  const handleDragMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging) return;
      const dy = e.touches[0].clientY - dragStartY.current;
      setDragOffset(Math.max(0, dy));
    },
    [isDragging],
  );

  const handleDragEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragOffset > DISMISS_THRESHOLD) {
      handleDismiss();
    } else {
      setDragOffset(0);
    }
  }, [isDragging, dragOffset, handleDismiss]);

  const sheetClasses = [
    'bottom-sheet',
    visible ? 'bottom-sheet--visible' : '',
    isDragging ? 'bottom-sheet--dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const sheetStyle =
    dragOffset > 0 ? { transform: `translateY(${dragOffset}px)` } : undefined;

  return (
    <>
      <div className="bottom-sheet-overlay" aria-hidden="true" />

      <div
        ref={sheetRef}
        className={sheetClasses}
        style={sheetStyle}
        role="dialog"
        aria-label={`Garden by ${displayName}`}
      >
        <div
          className="bottom-sheet-handle"
          onTouchStart={handleDragStart}
          onTouchMove={handleDragMove}
          onTouchEnd={handleDragEnd}
          aria-label="Drag to dismiss"
        >
          <div className="bottom-sheet-handle-bar" />
        </div>

        <div className="bottom-sheet-content">
          {hasPhotos ? (
            <BottomSheetGallery photos={pin.photo_urls} contributorName={pin.contributor_name} />
          ) : (
            <PhotoPlaceholder />
          )}

          <div className="bottom-sheet-body">
            <p className="bottom-sheet-contributor">{displayName}</p>

            {hasStory && (
              <>
                <p
                  className={`bottom-sheet-story ${
                    expanded ? 'bottom-sheet-story--expanded' : 'bottom-sheet-story--truncated'
                  }`}
                >
                  {pin.story_text}
                </p>
                <button
                  className="bottom-sheet-read-more"
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
    </>
  );
}
