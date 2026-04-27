import { useState, useCallback, useEffect, useMemo } from 'react';
import type { LocationData } from './useLocationPicker';
import type { PhotoEntry } from './usePhotoUploader';
import { createOkraHeaders, okraApiUrl } from '../api';

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
  submit: (photoIds: string[], location: LocationData, removePhotoIds?: string[]) => Promise<void>;
  reset: () => void;
  hasUnsavedProgress: (photos: PhotoEntry[], location: LocationData) => boolean;
}

const MAX_NAME_LENGTH = 100;
const MAX_STORY_LENGTH = 2000;

interface ValidationInput {
  uploadedPhotoIds: string[];
  existingPhotoCount?: number;
  hasUploadingPhotos: boolean;
  hasFailedPhotos: boolean;
  location: LocationData;
}

function computeValidation(input: ValidationInput): { canSubmit: boolean; missingFields: string[] } {
  const missing: string[] = [];

  if (input.uploadedPhotoIds.length + (input.existingPhotoCount ?? 0) < 1) {
    missing.push(input.hasFailedPhotos ? 'Photo uploads failed — retry or add new photos' : 'At least one photo is required');
  }

  const lat = input.location.displayLat;
  const lng = input.location.displayLng;

  const hasLocationText = input.location.rawLocationText.trim().length > 0;
  const hasValidCoordinates = lat !== null
    && lng !== null
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180;

  if (!hasLocationText || !hasValidCoordinates) {
    missing.push('Location is required');
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
  accessToken?: string | null,
  defaultContributorName?: string,
  options: {
    mode?: 'create' | 'edit';
    submissionId?: string;
    initialStoryText?: string;
    initialPrivacyMode?: PrivacyMode;
    existingPhotoCount?: number;
    editClientKey?: string;
  } = {},
): UseSubmissionFormReturn {
  const [contributorName, setContributorNameRaw] = useState(defaultContributorName ?? '');
  const [storyText, setStoryTextRaw] = useState(options.initialStoryText ?? '');
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>(options.initialPrivacyMode ?? 'city');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  useEffect(() => {
    if (options.mode === 'edit') {
      setContributorNameRaw(defaultContributorName ?? '');
      setStoryTextRaw(options.initialStoryText ?? '');
      setPrivacyMode(options.initialPrivacyMode ?? 'city');
      setSubmitError(null);
      setSubmitSuccess(false);
      return;
    }
    setContributorNameRaw((current) => (current.trim().length > 0 ? current : (defaultContributorName ?? '')));
  }, [defaultContributorName, options.initialPrivacyMode, options.initialStoryText, options.mode, options.submissionId]);

  const setContributorName = useCallback((v: string) => {
    setContributorNameRaw(v.slice(0, MAX_NAME_LENGTH));
  }, []);

  const setStoryText = useCallback((v: string) => {
    setStoryTextRaw(v.slice(0, MAX_STORY_LENGTH));
  }, []);

  const { canSubmit, missingFields } = useMemo(
    () => computeValidation({
      uploadedPhotoIds,
      hasUploadingPhotos,
      hasFailedPhotos,
      location,
      existingPhotoCount: options.existingPhotoCount ?? 0,
    }),
    [uploadedPhotoIds, hasUploadingPhotos, hasFailedPhotos, location, options.existingPhotoCount],
  );

  const submit = useCallback(
    async (photoIds: string[], loc: LocationData, removePhotoIds: string[] = []): Promise<void> => {
      setSubmitError(null);
      setIsSubmitting(true);

      try {
        const payload = {
          photoIds,
          removePhotoIds,
          rawLocationText: loc.rawLocationText,
          displayLat: loc.displayLat,
          displayLng: loc.displayLng,
          contributorName: contributorName || undefined,
          storyText: storyText || undefined,
          privacyMode,
          editClientKey: options.editClientKey,
        };

        const res = await fetch(
          options.mode === 'edit' && options.submissionId
            ? okraApiUrl(`/me/submissions/${options.submissionId}`)
            : okraApiUrl('/submissions'),
          {
            method: options.mode === 'edit' ? 'PATCH' : 'POST',
            headers: createOkraHeaders({ contentType: 'application/json', accessToken }),
            body: JSON.stringify(payload),
          },
        );

        if (res.status === 201 || res.status === 202) {
          setSubmitSuccess(true);
          return;
        }

        if (res.status === 422) {
          const body = await res.json().catch(() => ({}));
          const issues = body?.details?.issues;
          if (Array.isArray(issues) && issues.length > 0) {
            setSubmitError(issues.map((i: { message?: string }) => i.message ?? String(i)).join('. '));
          } else {
            setSubmitError(body?.message ?? body?.error?.message ?? 'Validation error. Please check your submission.');
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
    [accessToken, contributorName, storyText, privacyMode, options.mode, options.submissionId, options.editClientKey],
  );

  const reset = useCallback(() => {
    setContributorNameRaw(defaultContributorName ?? '');
    setStoryTextRaw(options.initialStoryText ?? '');
    setPrivacyMode(options.initialPrivacyMode ?? 'city');
    setIsSubmitting(false);
    setSubmitError(null);
    setSubmitSuccess(false);
  }, [defaultContributorName, options.initialPrivacyMode, options.initialStoryText]);

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
