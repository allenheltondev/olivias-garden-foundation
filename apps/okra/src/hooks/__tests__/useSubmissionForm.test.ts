import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSubmissionForm } from '../useSubmissionForm';
import type { LocationData } from '../useLocationPicker';
import type { PhotoEntry } from '../usePhotoUploader';

const validLocation: LocationData = {
  rawLocationText: 'Austin, TX',
  displayLat: 30.2672,
  displayLng: -97.7431,
};

const emptyLocation: LocationData = {
  rawLocationText: '',
  displayLat: null,
  displayLng: null,
};

function makePhoto(overrides: Partial<PhotoEntry> = {}): PhotoEntry {
  return {
    localId: 'p1',
    file: new File(['x'], 'test.jpg', { type: 'image/jpeg' }),
    photoId: 'photo-1',
    state: 'uploaded',
    previewUrl: 'blob:test',
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSubmissionForm', () => {
  describe('initial state', () => {
    it('initializes with default values', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, emptyLocation),
      );
      expect(result.current.contributorName).toBe('');
      expect(result.current.storyText).toBe('');
      expect(result.current.privacyMode).toBe('city');
      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.submitError).toBeNull();
      expect(result.current.submitSuccess).toBe(false);
    });
  });

  describe('text field max length', () => {
    it('truncates contributorName to 100 chars', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, emptyLocation),
      );
      act(() => result.current.setContributorName('a'.repeat(150)));
      expect(result.current.contributorName.length).toBe(100);
    });

    it('truncates storyText to 2000 chars', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, emptyLocation),
      );
      act(() => result.current.setStoryText('b'.repeat(3000)));
      expect(result.current.storyText.length).toBe(2000);
    });
  });

  describe('canSubmit and missingFields', () => {
    it('returns false when no photos uploaded', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, validLocation),
      );
      expect(result.current.canSubmit).toBe(false);
      expect(result.current.missingFields).toContain('At least one photo is required');
    });

    it('returns false when location text is empty', () => {
      const { result } = renderHook(() =>
        useSubmissionForm(['id1'], false, { ...validLocation, rawLocationText: '' }),
      );
      expect(result.current.canSubmit).toBe(false);
      expect(result.current.missingFields).toContain('Location text is required');
    });

    it('returns false when coordinates are null', () => {
      const { result } = renderHook(() =>
        useSubmissionForm(['id1'], false, { rawLocationText: 'Austin', displayLat: null, displayLng: null }),
      );
      expect(result.current.canSubmit).toBe(false);
      expect(result.current.missingFields).toContain('Select a location on the map');
    });

    it('returns false when lat is out of range', () => {
      const { result } = renderHook(() =>
        useSubmissionForm(['id1'], false, { rawLocationText: 'Test', displayLat: 91, displayLng: 0 }),
      );
      expect(result.current.canSubmit).toBe(false);
      expect(result.current.missingFields).toContain('Select a location on the map');
    });

    it('returns false when lng is out of range', () => {
      const { result } = renderHook(() =>
        useSubmissionForm(['id1'], false, { rawLocationText: 'Test', displayLat: 0, displayLng: -181 }),
      );
      expect(result.current.canSubmit).toBe(false);
    });

    it('returns false when photos are uploading', () => {
      const { result } = renderHook(() =>
        useSubmissionForm(['id1'], true, validLocation),
      );
      expect(result.current.canSubmit).toBe(false);
      expect(result.current.missingFields).toContain('Wait for photo uploads to complete');
    });

    it('returns true when all conditions met', () => {
      const { result } = renderHook(() =>
        useSubmissionForm(['id1'], false, validLocation),
      );
      expect(result.current.canSubmit).toBe(true);
      expect(result.current.missingFields).toEqual([]);
    });

    it('accepts boundary lat/lng values', () => {
      const { result } = renderHook(() =>
        useSubmissionForm(['id1'], false, { rawLocationText: 'Pole', displayLat: 90, displayLng: -180 }),
      );
      expect(result.current.canSubmit).toBe(true);
    });
  });

  describe('submit', () => {
    it('sends correct payload and sets submitSuccess on 201', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ submissionId: 's1', status: 'pending_review' }), { status: 201 }),
      );

      const { result } = renderHook(() =>
        useSubmissionForm(['photo-1'], false, validLocation),
      );

      act(() => result.current.setContributorName('Jane'));
      act(() => result.current.setStoryText('My garden'));

      await act(async () => {
        await result.current.submit(['photo-1'], validLocation);
      });

      expect(fetch).toHaveBeenCalledWith('/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoIds: ['photo-1'],
          rawLocationText: 'Austin, TX',
          displayLat: 30.2672,
          displayLng: -97.7431,
          contributorName: 'Jane',
          storyText: 'My garden',
          privacyMode: 'city',
        }),
      });
      expect(result.current.submitSuccess).toBe(true);
      expect(result.current.isSubmitting).toBe(false);
    });

    it('handles 422 validation errors with issues array', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({ message: 'Validation failed', details: { issues: [{ message: 'Invalid photo IDs' }] } }),
          { status: 422 },
        ),
      );

      const { result } = renderHook(() =>
        useSubmissionForm(['photo-1'], false, validLocation),
      );

      await act(async () => {
        await result.current.submit(['photo-1'], validLocation);
      });

      expect(result.current.submitError).toBe('Invalid photo IDs');
      expect(result.current.submitSuccess).toBe(false);
    });

    it('handles 422 with fallback message', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Bad request' }), { status: 422 }),
      );

      const { result } = renderHook(() =>
        useSubmissionForm(['photo-1'], false, validLocation),
      );

      await act(async () => {
        await result.current.submit(['photo-1'], validLocation);
      });

      expect(result.current.submitError).toBe('Bad request');
    });

    it('handles server errors', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 }),
      );

      const { result } = renderHook(() =>
        useSubmissionForm(['photo-1'], false, validLocation),
      );

      await act(async () => {
        await result.current.submit(['photo-1'], validLocation);
      });

      expect(result.current.submitError).toBe('Something went wrong. Please try again.');
    });

    it('handles network errors', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network failure'));

      const { result } = renderHook(() =>
        useSubmissionForm(['photo-1'], false, validLocation),
      );

      await act(async () => {
        await result.current.submit(['photo-1'], validLocation);
      });

      expect(result.current.submitError).toBe('Unable to reach the server. Check your connection and try again.');
    });

    it('omits empty optional fields from payload', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ submissionId: 's1', status: 'pending_review' }), { status: 201 }),
      );

      const { result } = renderHook(() =>
        useSubmissionForm(['photo-1'], false, validLocation),
      );

      await act(async () => {
        await result.current.submit(['photo-1'], validLocation);
      });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
      expect(body.contributorName).toBeUndefined();
      expect(body.storyText).toBeUndefined();
    });
  });

  describe('hasUnsavedProgress', () => {
    it('returns false for empty form', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, emptyLocation),
      );
      expect(result.current.hasUnsavedProgress([], emptyLocation)).toBe(false);
    });

    it('returns true when non-failed photo exists', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, emptyLocation),
      );
      expect(result.current.hasUnsavedProgress([makePhoto({ state: 'uploaded' })], emptyLocation)).toBe(true);
    });

    it('returns true when uploading photo exists', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, emptyLocation),
      );
      expect(result.current.hasUnsavedProgress([makePhoto({ state: 'uploading' })], emptyLocation)).toBe(true);
    });

    it('returns false when only failed photos exist', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, emptyLocation),
      );
      expect(result.current.hasUnsavedProgress([makePhoto({ state: 'failed' })], emptyLocation)).toBe(false);
    });

    it('returns true when contributorName is set', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, emptyLocation),
      );
      act(() => result.current.setContributorName('Jane'));
      expect(result.current.hasUnsavedProgress([], emptyLocation)).toBe(true);
    });

    it('returns true when storyText is set', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, emptyLocation),
      );
      act(() => result.current.setStoryText('My garden'));
      expect(result.current.hasUnsavedProgress([], emptyLocation)).toBe(true);
    });

    it('returns true when location text is set', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, emptyLocation),
      );
      expect(result.current.hasUnsavedProgress([], { ...emptyLocation, rawLocationText: 'Austin' })).toBe(true);
    });

    it('returns true when displayLat is set', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, emptyLocation),
      );
      expect(result.current.hasUnsavedProgress([], { ...emptyLocation, displayLat: 30 })).toBe(true);
    });
  });

  describe('reset', () => {
    it('clears all fields to initial state', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ submissionId: 's1', status: 'pending_review' }), { status: 201 }),
      );

      const { result } = renderHook(() =>
        useSubmissionForm(['photo-1'], false, validLocation),
      );

      act(() => result.current.setContributorName('Jane'));
      act(() => result.current.setStoryText('Story'));
      act(() => result.current.setPrivacyMode('exact'));

      await act(async () => {
        await result.current.submit(['photo-1'], validLocation);
      });

      expect(result.current.submitSuccess).toBe(true);

      act(() => result.current.reset());

      expect(result.current.contributorName).toBe('');
      expect(result.current.storyText).toBe('');
      expect(result.current.privacyMode).toBe('city');
      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.submitError).toBeNull();
      expect(result.current.submitSuccess).toBe(false);
    });
  });

  describe('privacyMode', () => {
    it('defaults to city', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, emptyLocation),
      );
      expect(result.current.privacyMode).toBe('city');
    });

    it('can be changed to any valid mode', () => {
      const { result } = renderHook(() =>
        useSubmissionForm([], false, emptyLocation),
      );
      for (const mode of ['exact', 'nearby', 'neighborhood', 'city'] as const) {
        act(() => result.current.setPrivacyMode(mode));
        expect(result.current.privacyMode).toBe(mode);
      }
    });
  });
});
