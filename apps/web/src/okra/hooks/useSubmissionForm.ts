import { useState, useCallback, useMemo } from 'react';
import type { LocationData } from './useLocationPicker';
import type { PhotoEntry } from './usePhotoUploader';
import { okraApiUrl } from '../api';

export type PrivacyMode = 'exact' | 'nearby' | 'neighborhood' | 'city';

export interface UseSubmissionFormReturn {
  contributorName: string;
  setContributorName: (v: string) => void;
  storyText: string;
  setStoryText: (v: string) => void;
  privacyMode: PrivacyMode;
  setPrivacyMode: (v: PrivacyMode) => void;
  canSubmit: boolean;
  missingFields: string[];
  isSubmitting: boolean;
  submitError: string | null;
  submitSuccess: boolean;
  submit: (photoIds: string[], location: LocationData) => Promise<void>;
  reset: () => void;
  hasUnsavedProgress: (photos: PhotoEntry[], location: LocationData) => boolean;
}

const MAX_NAME_LENGTH = 100;
const MAX_STORY_LENGTH = 2000;

interface ValidationInput {
  uploadedPhotoIds: string[];
  hasUploadingPhotos: boolean;
  hasFailedPhotos: boolean;
  location: LocationData;
}

function computeValidation(input: ValidationInput): { canSubmit: boolean; missingFields: string[] } {
  const missing: string[] = [];

  if (input.uploadedPhotoIds.length < 1) {
    missing.push(input.hasFailedPhotos ? 'Photo uploads failed — retry or add new photos' : 'At least one photo is required');
  }

  if (input.location.rawLocationText.trim().length === 0) {
    missing.push('Location text is required');
  }

  const lat = input.location.displayLat;
  const lng = input.location.displayLng;

  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    missing.push('Select a location on the map');
  }

  if (input.hasUploadingPhotos) {
    missing.push('Wait for photo uploads to complete');
  }

  return { canSubmit: missing.length === 0, missingFields: missing };
}

export function useSubmissionForm(
  uploadedPhotoIds: string[],
  hasUploadingPhotos: boolean,
  location: LocationData,
  hasFailedPhotos: boolean = false,
): UseSubmissionFormReturn {
  const [contributorName, setContributorNameRaw] = useState('');
  const [storyText, setStoryTextRaw] = useState('');
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>('city');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const setContributorName = useCallback((v: string) => {
    setContributorNameRaw(v.slice(0, MAX_NAME_LENGTH));
  }, []);

  const setStoryText = useCallback((v: string) => {
    setStoryTextRaw(v.slice(0, MAX_STORY_LENGTH));
  }, []);

  const { canSubmit, missingFields } = useMemo(
    () => computeValidation({ uploadedPhotoIds, hasUploadingPhotos, hasFailedPhotos, location }),
    [uploadedPhotoIds, hasUploadingPhotos, hasFailedPhotos, location],
  );

  const submit = useCallback(
    async (photoIds: string[], loc: LocationData): Promise<void> => {
      setSubmitError(null);
      setIsSubmitting(true);

      try {
        const payload = {
          photoIds,
          rawLocationText: loc.rawLocationText,
          displayLat: loc.displayLat,
          displayLng: loc.displayLng,
          contributorName: contributorName || undefined,
          storyText: storyText || undefined,
          privacyMode,
        };

        const res = await fetch(okraApiUrl('/submissions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.status === 201) {
          setSubmitSuccess(true);
          return;
        }

        if (res.status === 422) {
          const body = await res.json().catch(() => ({}));
          const issues = body?.details?.issues;
          if (Array.isArray(issues) && issues.length > 0) {
            setSubmitError(issues.map((i: { message?: string }) => i.message ?? String(i)).join('. '));
          } else {
            setSubmitError(body?.message ?? 'Validation error. Please check your submission.');
          }
          return;
        }

        setSubmitError('Something went wrong. Please try again.');
      } catch {
        setSubmitError('Unable to reach the server. Check your connection and try again.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [contributorName, storyText, privacyMode],
  );

  const reset = useCallback(() => {
    setContributorNameRaw('');
    setStoryTextRaw('');
    setPrivacyMode('city');
    setIsSubmitting(false);
    setSubmitError(null);
    setSubmitSuccess(false);
  }, []);

  const hasUnsavedProgress = useCallback(
    (photos: PhotoEntry[], loc: LocationData): boolean => {
      const hasNonFailedPhoto = photos.some((p) => p.state !== 'failed');
      const hasName = contributorName.trim().length > 0;
      const hasStory = storyText.trim().length > 0;
      const hasLocationText = loc.rawLocationText.trim().length > 0;
      const hasCoords = loc.displayLat !== null;

      return hasNonFailedPhoto || hasName || hasStory || hasLocationText || hasCoords;
    },
    [contributorName, storyText],
  );

  return {
    contributorName,
    setContributorName,
    storyText,
    setStoryText,
    privacyMode,
    setPrivacyMode,
    canSubmit,
    missingFields,
    isSubmitting,
    submitError,
    submitSuccess,
    submit,
    reset,
    hasUnsavedProgress,
  };
}
