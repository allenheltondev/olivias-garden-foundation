import { useEffect, useRef, useCallback, useState } from 'react';
import type { AuthSession } from '../../auth/session';
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
  authEnabled?: boolean;
  authSession?: AuthSession | null;
  onLogin?: () => void;
  onSignup?: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SubmissionModal({
  open,
  onClose,
  authEnabled = false,
  authSession = null,
  onLogin,
  onSignup,
}: SubmissionModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const photoUploader = usePhotoUploader(authSession?.accessToken);
  const locationPicker = useLocationPicker();
  const form = useSubmissionForm(
    photoUploader.uploadedPhotoIds,
    photoUploader.photos.some((photo) => photo.state === 'uploading'),
    locationPicker.location,
    photoUploader.photos.some((photo) => photo.state === 'failed'),
    authSession?.accessToken,
    authSession?.user.name ?? authSession?.user.email ?? undefined,
  );

  const photosComplete = photoUploader.hasUploaded;
  const aboutComplete = form.contributorName.trim().length > 0 || form.storyText.trim().length > 0;

  const photosRef = useRef(photoUploader.photos);
  photosRef.current = photoUploader.photos;

  const locationRef = useRef(locationPicker.location);
  locationRef.current = locationPicker.location;

  const formRef = useRef(form);
  formRef.current = form;

  const initiateClose = useCallback(() => {
    if (formRef.current.hasUnsavedProgress(photosRef.current, locationRef.current)) {
      setShowConfirm(true);
    } else {
      onClose();
    }
  }, [onClose]);

  const handleDiscard = useCallback(() => {
    setShowConfirm(false);
    photoUploader.reset();
    locationPicker.reset();
    form.reset();
    onClose();
  }, [photoUploader, locationPicker, form, onClose]);

  const handleCancelClose = useCallback(() => {
    setShowConfirm(false);
  }, []);

  useEffect(() => {
    if (!open) return;

    const dialogElement = dialogRef.current;
    if (!dialogElement) return;

    const focusableElements = dialogElement.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        initiateClose();
        return;
      }

      if (event.key === 'Tab') {
        const activeDialog = dialogRef.current;
        if (!activeDialog) return;

        const focusable = activeDialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, initiateClose]);

  useEffect(() => {
    if (!form.submitSuccess) return;

    const timer = setTimeout(() => {
      photoUploader.reset();
      locationPicker.reset();
      form.reset();
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
        aria-label="Add my okra patch"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="submission-modal__header">
          <h2 className="submission-modal__title">Add my okra patch</h2>
          <button
            className="submission-modal__close-btn"
            type="button"
            onClick={initiateClose}
            aria-label="Close"
          >
            x
          </button>
        </div>

        <div className="submission-modal__body">
          {form.submitSuccess ? (
            <div className="submission-modal__success" role="status">
              <span className="submission-modal__success-icon">OK</span>
              <p>Your garden has been submitted and is pending review. Thank you.</p>
            </div>
          ) : (
            <>
              {authEnabled && !authSession ? (
                <section className="submission-modal__auth">
                  <>
                    <p className="submission-modal__auth-eyebrow">Anonymous is still fine</p>
                    <p className="submission-modal__auth-title">
                      Log in only if you want us to remember your okra submissions so you can update them later.
                    </p>
                    <div className="submission-modal__auth-actions">
                      <button type="button" className="submission-modal__auth-button" onClick={onLogin}>
                        Log in
                      </button>
                      <button type="button" className="submission-modal__auth-button submission-modal__auth-button--primary" onClick={onSignup}>
                        Sign up
                      </button>
                    </div>
                  </>
                </section>
              ) : null}

              <section className="submission-modal__section">
                <h3 className="submission-modal__section-heading">
                  Photos{' '}
                  {photosComplete ? (
                    <span className="submission-modal__check" aria-label="Section complete">
                      OK
                    </span>
                  ) : null}
                </h3>
                <PhotoUploader
                  photos={photoUploader.photos}
                  onAddFiles={photoUploader.addFiles}
                  onRetry={photoUploader.retryUpload}
                  onRetryAll={photoUploader.retryAll}
                  onRemove={photoUploader.removePhoto}
                  disabled={form.isSubmitting}
                  rateLimitUntil={photoUploader.rateLimitUntil}
                  hasError={
                    photoUploader.photos.length > 0 &&
                    !photoUploader.hasUploaded &&
                    photoUploader.photos.some((photo) => photo.state === 'failed')
                  }
                />
              </section>

              <section className="submission-modal__section">
                <h3 className="submission-modal__section-heading">
                  About Your Garden{' '}
                  {aboutComplete ? (
                    <span className="submission-modal__check" aria-label="Section complete">
                      OK
                    </span>
                  ) : null}
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
                <PrivacySelector
                  value={form.privacyMode}
                  onChange={form.setPrivacyMode}
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

        {showConfirm ? (
          <div className="submission-modal__confirm-overlay">
            <div className="submission-modal__confirm" role="alertdialog" aria-label="Discard changes?">
              <p>You have unsaved changes. Discard?</p>
              <div className="submission-modal__confirm-actions">
                <button
                  type="button"
                  className="submission-modal__confirm-discard"
                  onClick={handleDiscard}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="submission-modal__confirm-cancel"
                  onClick={handleCancelClose}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
