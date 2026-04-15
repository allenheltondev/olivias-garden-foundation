import { useState, useCallback, useRef } from 'react';
import { okraApiUrl } from '../api';

export type PhotoState = 'uploading' | 'uploaded' | 'failed';

export interface PhotoEntry {
  localId: string;
  file: File;
  photoId: string | null;
  state: PhotoState;
  previewUrl: string;
  errorMessage?: string;
}

export interface UsePhotoUploaderReturn {
  photos: PhotoEntry[];
  addFiles: (files: File[]) => void;
  retryUpload: (localId: string) => void;
  retryAll: () => void;
  removePhoto: (localId: string) => void;
  reset: () => void;
  rateLimitUntil: number | null;
  uploadedPhotoIds: string[];
  hasUploaded: boolean;
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 3 * 1024 * 1024; // 3 MB
const MAX_PHOTOS = 5;
const CONCURRENCY_LIMIT = 3;

let idCounter = 0;
function generateLocalId(): string {
  return `photo-${Date.now()}-${++idCounter}`;
}

export function validateFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'Only JPEG, PNG, and WebP images are accepted';
  }
  if (file.size > MAX_SIZE) {
    return 'File exceeds the 3 MB size limit';
  }
  return null;
}

async function uploadSinglePhoto(
  file: File,
  onStateChange: (photoId: string | null, state: PhotoState, errorMessage?: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    // Step 1: Request upload intent
    const intentRes = await fetch(okraApiUrl('/photos'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: file.type }),
      signal,
    });

    if (intentRes.status === 429) {
      const body = await intentRes.json().catch(() => ({}));
      const retryAfter = body.retryAfterSeconds ?? 60;
      throw { rateLimited: true, retryAfterSeconds: retryAfter };
    }

    if (!intentRes.ok) {
      throw new Error('Upload failed — check your connection');
    }

    const { photoId, uploadUrl } = await intentRes.json();
    onStateChange(photoId, 'uploading');

    // Step 2: PUT file to pre-signed URL
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
      signal,
    });

    if (!putRes.ok) {
      throw new Error('Upload failed');
    }

    onStateChange(photoId, 'uploaded');
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'rateLimited' in err) {
      throw err; // Re-throw rate limit errors for the caller to handle
    }
    const message = err instanceof Error ? err.message : 'Upload failed';
    onStateChange(null, 'failed', message);
  }
}

export function usePhotoUploader(): UsePhotoUploaderReturn {
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const activeUploads = useRef(0);
  const uploadQueue = useRef<Array<() => void>>([]);

  const processQueue = useCallback(() => {
    while (activeUploads.current < CONCURRENCY_LIMIT && uploadQueue.current.length > 0) {
      const next = uploadQueue.current.shift()!;
      activeUploads.current++;
      next();
    }
  }, []);

  const enqueueUpload = useCallback(
    (localId: string, file: File) => {
      const task = () => {
        const onStateChange = (photoId: string | null, state: PhotoState, errorMessage?: string) => {
          setPhotos((prev) =>
            prev.map((p) =>
              p.localId === localId
                ? { ...p, photoId: photoId ?? p.photoId, state, errorMessage }
                : p,
            ),
          );
        };

        uploadSinglePhoto(file, onStateChange)
          .catch((err: unknown) => {
            if (err && typeof err === 'object' && 'rateLimited' in err) {
              const rlErr = err as unknown as { retryAfterSeconds: number };
              setRateLimitUntil(Date.now() + rlErr.retryAfterSeconds * 1000);
              setPhotos((prev) =>
                prev.map((p) =>
                  p.localId === localId
                    ? { ...p, state: 'failed', errorMessage: `Too many uploads. Please wait and try again.` }
                    : p,
                ),
              );
            }
          })
          .finally(() => {
            activeUploads.current--;
            processQueue();
          });
      };

      uploadQueue.current.push(task);
      processQueue();
    },
    [processQueue],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (rateLimitUntil && Date.now() < rateLimitUntil) return;

      setPhotos((prev) => {
        const slotsAvailable = MAX_PHOTOS - prev.length;
        if (slotsAvailable <= 0) return prev;

        const toAdd = files.slice(0, slotsAvailable);
        const newEntries: PhotoEntry[] = [];

        for (const file of toAdd) {
          const validationError = validateFile(file);
          if (validationError) {
            newEntries.push({
              localId: generateLocalId(),
              file,
              photoId: null,
              state: 'failed',
              previewUrl: '',
              errorMessage: validationError,
            });
          } else {
            const localId = generateLocalId();
            const previewUrl = URL.createObjectURL(file);
            newEntries.push({
              localId,
              file,
              photoId: null,
              state: 'uploading',
              previewUrl,
            });
            // Schedule upload outside of setState
            queueMicrotask(() => enqueueUpload(localId, file));
          }
        }

        return [...prev, ...newEntries];
      });
    },
    [enqueueUpload, rateLimitUntil],
  );

  const retryUpload = useCallback(
    (localId: string) => {
      if (rateLimitUntil && Date.now() < rateLimitUntil) return;

      setPhotos((prev) =>
        prev.map((p) =>
          p.localId === localId ? { ...p, state: 'uploading', photoId: null, errorMessage: undefined } : p,
        ),
      );
      // Find the file for this entry
      const entry = photos.find((p) => p.localId === localId);
      if (entry) {
        enqueueUpload(localId, entry.file);
      }
    },
    [enqueueUpload, photos, rateLimitUntil],
  );

  const retryAll = useCallback(() => {
    if (rateLimitUntil && Date.now() < rateLimitUntil) return;
    const failed = photos.filter((p) => p.state === 'failed' && p.previewUrl);
    setPhotos((prev) =>
      prev.map((p) =>
        p.state === 'failed' && p.previewUrl ? { ...p, state: 'uploading', photoId: null, errorMessage: undefined } : p,
      ),
    );
    for (const entry of failed) {
      enqueueUpload(entry.localId, entry.file);
    }
  }, [enqueueUpload, photos, rateLimitUntil]);

  const removePhoto = useCallback((localId: string) => {
    setPhotos((prev) => {
      const entry = prev.find((p) => p.localId === localId);
      if (entry && entry.previewUrl) {
        URL.revokeObjectURL(entry.previewUrl);
      }
      return prev.filter((p) => p.localId !== localId);
    });
  }, []);

  const reset = useCallback(() => {
    setPhotos((prev) => {
      for (const p of prev) {
        if (p.previewUrl) {
          URL.revokeObjectURL(p.previewUrl);
        }
      }
      return [];
    });
    setRateLimitUntil(null);
    uploadQueue.current = [];
  }, []);

  const uploadedPhotoIds = photos
    .filter((p) => p.state === 'uploaded' && p.photoId !== null)
    .map((p) => p.photoId!);

  const hasUploaded = uploadedPhotoIds.length > 0;

  return {
    photos,
    addFiles,
    retryUpload,
    retryAll,
    removePhoto,
    reset,
    rateLimitUntil,
    uploadedPhotoIds,
    hasUploaded,
  };
}
