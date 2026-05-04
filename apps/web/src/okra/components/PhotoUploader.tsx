import { useCallback, useEffect, useRef, useState } from 'react';
import type { PhotoEntry } from '../hooks/usePhotoUploader';
import './PhotoUploader.css';

export interface PhotoUploaderProps {
  photos: PhotoEntry[];
  onAddFiles: (files: File[]) => void;
  onRetry: (localId: string) => void;
  onRetryAll?: () => void;
  onRemove: (localId: string) => void;
  disabled: boolean;
  rateLimitUntil: number | null;
  hasError?: boolean;
}

const MAX_PHOTOS = 5;
const ACCEPT = 'image/jpeg,image/png,image/webp';

export function PhotoUploader({
  photos,
  onAddFiles,
  onRetry,
  onRetryAll,
  onRemove,
  disabled,
  rateLimitUntil,
  hasError = false,
}: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);

  const maxReached = photos.length >= MAX_PHOTOS;
  const isRateLimited = rateLimitUntil !== null && Date.now() < rateLimitUntil;
  const inputDisabled = disabled || maxReached || isRateLimited;
  const count = photos.length;

  // Detect if multiple photos share the same error (consolidated message)
  const failedPhotos = photos.filter((p) => p.state === 'failed' && p.errorMessage);
  const uniqueErrors = new Set(failedPhotos.map((p) => p.errorMessage));
  const showConsolidatedError = failedPhotos.length > 1 && uniqueErrors.size === 1;

  useEffect(() => {
    if (!rateLimitUntil) { setRateLimitMsg(null); return; }
    const remaining = rateLimitUntil - Date.now();
    if (remaining <= 0) { setRateLimitMsg(null); return; }
    setRateLimitMsg('Too many uploads. Please wait and try again.');
    const timer = setTimeout(() => setRateLimitMsg(null), remaining);
    return () => clearTimeout(timer);
  }, [rateLimitUntil]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      onAddFiles(Array.from(fileList));
      if (inputRef.current) inputRef.current.value = '';
    },
    [onAddFiles],
  );

  const triggerPicker = useCallback(() => {
    if (!inputDisabled) inputRef.current?.click();
  }, [inputDisabled]);

  const inputId = 'photo-upload-input';
  const isEmpty = count === 0;
  const zoneBorderClass = maxReached
    ? 'photo-uploader__zone--full'
    : hasError
      ? 'photo-uploader__zone--error'
      : '';

  return (
    <div className="photo-uploader">
      <input
        ref={inputRef}
        id={inputId}
        className="photo-uploader__file-input"
        type="file"
        accept={ACCEPT}
        multiple
        disabled={inputDisabled}
        onChange={handleChange}
        aria-label="Upload photos (JPEG, PNG, or WebP, max 10 MB each)"
      />

      {rateLimitMsg && (
        <p className="photo-uploader__message photo-uploader__message--warning">{rateLimitMsg}</p>
      )}

      <div
        className={`photo-uploader__zone ${zoneBorderClass}`}
        onClick={isEmpty && !inputDisabled ? triggerPicker : undefined}
        role={isEmpty ? 'button' : undefined}
        tabIndex={isEmpty && !inputDisabled ? 0 : undefined}
        onKeyDown={isEmpty && !inputDisabled ? (e) => { if (e.key === 'Enter' || e.key === ' ') triggerPicker(); } : undefined}
      >
        {isEmpty ? (
          <div className="photo-uploader__empty">
            <svg className="photo-uploader__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M12 16V8m0 0l-3 3m3-3l3 3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 16.5V18a3 3 0 003 3h12a3 3 0 003-3v-1.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="photo-uploader__empty-label">Add up to 5 photos</span>
            <span className="photo-uploader__browse-btn">Browse files</span>
            <span className="photo-uploader__empty-hint">JPEG, PNG, or WebP · max 10 MB each</span>
          </div>
        ) : (
          <>
            {showConsolidatedError && (
              <div className="photo-uploader__consolidated-error">
                <span>{failedPhotos[0].errorMessage}</span>
                {onRetryAll && (
                  <button className="photo-uploader__retry-all-btn" type="button" onClick={onRetryAll} disabled={disabled}>
                    Retry all
                  </button>
                )}
              </div>
            )}
            <div className="photo-uploader__grid" role="list" aria-label="Uploaded photos">
              {photos.map((photo) => (
                <PhotoThumb key={photo.localId} photo={photo} onRetry={onRetry} onRemove={onRemove} disabled={disabled} hideInlineError={showConsolidatedError} />
              ))}
              {!maxReached && Array.from({ length: MAX_PHOTOS - count }).map((_, i) => (
                <button
                  key={`placeholder-${i}`}
                  className="photo-uploader__placeholder"
                  type="button"
                  onClick={triggerPicker}
                  disabled={inputDisabled}
                  aria-label="Add another photo"
                >
                  <span className="photo-uploader__placeholder-plus">+</span>
                </button>
              ))}
            </div>
            <span className="photo-uploader__counter">{count}/{MAX_PHOTOS}</span>
          </>
        )}
      </div>
    </div>
  );
}

function PhotoThumb({
  photo, onRetry, onRemove, disabled, hideInlineError = false,
}: {
  photo: PhotoEntry;
  onRetry: (localId: string) => void;
  onRemove: (localId: string) => void;
  disabled: boolean;
  hideInlineError?: boolean;
}) {
  const isFailed = photo.state === 'failed';
  return (
    <div className={`photo-uploader__thumb${isFailed ? ' photo-uploader__thumb--failed' : ''}`} role="listitem">
      {photo.previewUrl && <img src={photo.previewUrl} alt={`Photo ${photo.localId}`} />}
      <button className="photo-uploader__remove-btn" onClick={() => onRemove(photo.localId)} aria-label={`Remove photo`} disabled={disabled} type="button">✕</button>
      {photo.state === 'uploading' && (
        <div className="photo-uploader__overlay photo-uploader__overlay--uploading">
          <div className="photo-uploader__spinner" role="status" aria-label="Uploading" />
        </div>
      )}
      {photo.state === 'uploaded' && (
        <div className="photo-uploader__overlay photo-uploader__overlay--uploaded">
          <span className="photo-uploader__checkmark" aria-label="Upload complete">✓</span>
        </div>
      )}
      {isFailed && (
        <div className="photo-uploader__overlay photo-uploader__overlay--failed">
          <span className="photo-uploader__error-icon" aria-hidden="true">!</span>
          {!hideInlineError && photo.errorMessage && <span className="photo-uploader__error-msg">{photo.errorMessage}</span>}
          {!hideInlineError && (
            <button className="photo-uploader__retry-btn" onClick={() => onRetry(photo.localId)} disabled={disabled} type="button">Retry</button>
          )}
        </div>
      )}
    </div>
  );
}
