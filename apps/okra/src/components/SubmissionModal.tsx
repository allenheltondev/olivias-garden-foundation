import { useEffect, useRef, useCallback, useState } from 'react';
import { usePhotoUploader } from '../hooks/usePhotoUploader';
import { useLocationPicker } from '../hooks/useLocationPicker';
import { useSubmissionForm } from '../hooks/useSubmissionForm';
import { PhotoUploader } from './PhotoUploader';
import { ContributorFields } from './ContributorFields';
import { LocationInput } from './LocationInput';
import { PrivacySelector } from './PrivacySelector';
import { SubmitSection } from './SubmitSection';
import './SubmissionModal.css';

export interface SubmissionModalProps {
  open: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SubmissionModal({ open, onClose }: SubmissionModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Initialize hooks
  const photoUploader = usePhotoUploader();
  const locationPicker = useLocationPicker();
  const form = useSubmissionForm(
    photoUploader.uploadedPhotoIds,
    photoUploader.photos.some((p) => p.state === 'uploading'),
    locationPicker.location,
    photoUploader.photos.some((p) => p.state === 'failed'),
  );

  // Section completion indicators
  const photosComplete = photoUploader.hasUploaded;
  const aboutComplete = form.contributorName.trim().length > 0 || form.storyText.trim().length > 0;
  const locationComplete = locationPicker.location.displayLat !== null && locationPicker.location.displayLng !== null;
  const [privacyTouched, setPrivacyTouched] = useState(false);

  // Use refs to avoid re-creating initiateClose on every state change
  const photosRef = useRef(photoUploader.photos);
  photosRef.current = photoUploader.photos;
  const locationRef = useRef(locationPicker.location);
  locationRef.current = locationPicker.location;
  const formRef = useRef(form);
  formRef.current = form;

  // Close flow: check for unsaved progress
  const initiateClose = useCallback(() => {
    if (formRef.current.hasUnsavedProgress(photosRef.current, locationRef.current)) {
      setShowConfirm(true);
    } else {
      onClose();
    }
  }, [onClose]);

  const handleDiscard = useCallback(() => {
    setShowConfirm(false);
    setPrivacyTouched(false);
    photoUploader.reset();
    locationPicker.reset();
    form.reset();
    onClose();
  }, [photoUploader, locationPicker, form, onClose]);

  const handleCancelClose = useCallback(() => {
    setShowConfirm(false);
  }, []);

  // Focus trap
  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    // Focus first focusable element on mount
    const focusableElements = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        initiateClose();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = dialog!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
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
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, initiateClose]);

  // Handle successful submission: show success ~2s, then reset and close
  useEffect(() => {
    if (!form.submitSuccess) return;

    const timer = setTimeout(() => {
      photoUploader.reset();
      locationPicker.reset();
      form.reset();
      setPrivacyTouched(false);
      onClose();
    }, 2000);

    return () => clearTimeout(timer);
  }, [form.submitSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = useCallback(() => {
    form.submit(photoUploader.uploadedPhotoIds, locationPicker.location);
  }, [form, photoUploader.uploadedPhotoIds, locationPicker.location]);

  if (!open) return null;

  return (
    <div className="submission-modal__backdrop" onClick={initiateClose}>
      <div
        ref={dialogRef}
        className="submission-modal__dialog"
        role="dialog"
        aria-label="Submit your garden"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="submission-modal__header">
          <h2 className="submission-modal__title">Submit your garden</h2>
          <button
            className="submission-modal__close-btn"
            type="button"
            onClick={initiateClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="submission-modal__body">
          {form.submitSuccess ? (
            <div className="submission-modal__success" role="status">
              <span className="submission-modal__success-icon">✓</span>
              <p>Your garden has been submitted and is pending review. Thank you!</p>
            </div>
          ) : (
            <>
              <section className="submission-modal__section">
                <h3 className="submission-modal__section-heading">
                  Photos {photosComplete && <span className="submission-modal__check" aria-label="Section complete">✓</span>}
                </h3>
                <PhotoUploader
                  photos={photoUploader.photos}
                  onAddFiles={photoUploader.addFiles}
                  onRetry={photoUploader.retryUpload}
                  onRetryAll={photoUploader.retryAll}
                  onRemove={photoUploader.removePhoto}
                  disabled={form.isSubmitting}
                  rateLimitUntil={photoUploader.rateLimitUntil}
                  hasError={photoUploader.photos.length > 0 && !photoUploader.hasUploaded && photoUploader.photos.some(p => p.state === 'failed')}
                />
              </section>

              <section className="submission-modal__section">
                <h3 className="submission-modal__section-heading">
                  About Your Garden {aboutComplete && <span className="submission-modal__check" aria-label="Section complete">✓</span>}
                </h3>
                <ContributorFields
                  name={form.contributorName}
                  story={form.storyText}
                  onNameChange={form.setContributorName}
                  onStoryChange={form.setStoryText}
                  disabled={form.isSubmitting}
                />
              </section>

              <section className="submission-modal__section">
                <h3 className="submission-modal__section-heading">
                  Location {locationComplete && <span className="submission-modal__check" aria-label="Section complete">✓</span>}
                </h3>
                <LocationInput
                  location={locationPicker.location}
                  onTextChange={locationPicker.setRawText}
                  onCoordinatesChange={locationPicker.setCoordinates}
                  onGeocode={locationPicker.geocode}
                  geocodeError={locationPicker.geocodeError}
                  isGeocoding={locationPicker.isGeocoding}
                  disabled={form.isSubmitting}
                  privacyMode={form.privacyMode}
                />
              </section>

              <section className="submission-modal__section">
                <h3 className="submission-modal__section-heading">
                  Privacy {privacyTouched && <span className="submission-modal__check" aria-label="Section complete">✓</span>}
                </h3>
                <PrivacySelector
                  value={form.privacyMode}
                  onChange={(mode) => { setPrivacyTouched(true); form.setPrivacyMode(mode); }}
                  disabled={form.isSubmitting}
                />
              </section>

              <section className="submission-modal__section submission-modal__section--submit">
                <SubmitSection
                  canSubmit={form.canSubmit}
                  isSubmitting={form.isSubmitting}
                  missingFields={form.missingFields}
                  submitError={form.submitError}
                  onSubmit={handleSubmit}
                />
              </section>
            </>
          )}
        </div>

        {showConfirm && (
          <div className="submission-modal__confirm-overlay">
            <div className="submission-modal__confirm" role="alertdialog" aria-label="Discard changes?">
              <p>You have unsaved changes. Discard?</p>
              <div className="submission-modal__confirm-actions">
                <button type="button" className="submission-modal__confirm-discard" onClick={handleDiscard}>
                  Discard
                </button>
                <button type="button" className="submission-modal__confirm-cancel" onClick={handleCancelClose}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
