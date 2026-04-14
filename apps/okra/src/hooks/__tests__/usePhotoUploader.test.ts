import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePhotoUploader, validateFile } from '../usePhotoUploader';

// Mock URL.createObjectURL / revokeObjectURL
let objectUrlCounter = 0;
const revokedUrls = new Set<string>();

beforeEach(() => {
  objectUrlCounter = 0;
  revokedUrls.clear();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => `blob:mock-${++objectUrlCounter}`),
    revokeObjectURL: vi.fn((url: string) => revokedUrls.add(url)),
  });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeFile(name: string, size: number, type: string): File {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
}

function mockSuccessfulUpload(photoId: string) {
  const fetchMock = vi.mocked(fetch);
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ photoId, uploadUrl: `https://s3.example.com/${photoId}` }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
}

describe('validateFile', () => {
  it('accepts valid JPEG file', () => {
    const file = makeFile('test.jpg', 1024, 'image/jpeg');
    expect(validateFile(file)).toBeNull();
  });

  it('accepts valid PNG file', () => {
    const file = makeFile('test.png', 1024, 'image/png');
    expect(validateFile(file)).toBeNull();
  });

  it('accepts valid WebP file', () => {
    const file = makeFile('test.webp', 1024, 'image/webp');
    expect(validateFile(file)).toBeNull();
  });

  it('rejects invalid MIME type', () => {
    const file = makeFile('test.gif', 1024, 'image/gif');
    expect(validateFile(file)).toBe('Only JPEG, PNG, and WebP images are accepted');
  });

  it('rejects file exceeding 3 MB', () => {
    const file = makeFile('big.jpg', 3 * 1024 * 1024 + 1, 'image/jpeg');
    expect(validateFile(file)).toBe('File exceeds the 3 MB size limit');
  });

  it('accepts file exactly 3 MB', () => {
    const file = makeFile('exact.jpg', 3 * 1024 * 1024, 'image/jpeg');
    expect(validateFile(file)).toBeNull();
  });
});

describe('usePhotoUploader', () => {
  it('starts with empty state', () => {
    const { result } = renderHook(() => usePhotoUploader());
    expect(result.current.photos).toEqual([]);
    expect(result.current.uploadedPhotoIds).toEqual([]);
    expect(result.current.hasUploaded).toBe(false);
    expect(result.current.rateLimitUntil).toBeNull();
  });

  it('adds valid files and creates preview URLs', async () => {
    mockSuccessfulUpload('photo-1');
    const { result } = renderHook(() => usePhotoUploader());

    act(() => {
      result.current.addFiles([makeFile('test.jpg', 1024, 'image/jpeg')]);
    });

    expect(result.current.photos).toHaveLength(1);
    expect(result.current.photos[0].state).toBe('uploading');
    expect(result.current.photos[0].previewUrl).toMatch(/^blob:mock-/);
  });

  it('rejects invalid files immediately with failed state', () => {
    const { result } = renderHook(() => usePhotoUploader());

    act(() => {
      result.current.addFiles([makeFile('test.gif', 1024, 'image/gif')]);
    });

    expect(result.current.photos).toHaveLength(1);
    expect(result.current.photos[0].state).toBe('failed');
    expect(result.current.photos[0].errorMessage).toBe('Only JPEG, PNG, and WebP images are accepted');
    expect(result.current.photos[0].previewUrl).toBe('');
  });

  it('enforces max 5 photos', () => {
    const { result } = renderHook(() => usePhotoUploader());
    const fetchMock = vi.mocked(fetch);

    // Mock uploads for 5 photos
    for (let i = 0; i < 5; i++) {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ photoId: `p${i}`, uploadUrl: `https://s3.example.com/p${i}` }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
    }

    act(() => {
      const files = Array.from({ length: 7 }, (_, i) => makeFile(`test${i}.jpg`, 1024, 'image/jpeg'));
      result.current.addFiles(files);
    });

    expect(result.current.photos).toHaveLength(5);
  });

  it('does not add more photos when already at max', () => {
    const { result } = renderHook(() => usePhotoUploader());
    const fetchMock = vi.mocked(fetch);

    for (let i = 0; i < 5; i++) {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ photoId: `p${i}`, uploadUrl: `https://s3.example.com/p${i}` }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
    }

    act(() => {
      result.current.addFiles(Array.from({ length: 5 }, (_, i) => makeFile(`a${i}.jpg`, 1024, 'image/jpeg')));
    });

    expect(result.current.photos).toHaveLength(5);

    act(() => {
      result.current.addFiles([makeFile('extra.jpg', 1024, 'image/jpeg')]);
    });

    expect(result.current.photos).toHaveLength(5);
  });

  it('removes a photo and revokes its object URL', async () => {
    mockSuccessfulUpload('photo-1');
    const { result } = renderHook(() => usePhotoUploader());

    act(() => {
      result.current.addFiles([makeFile('test.jpg', 1024, 'image/jpeg')]);
    });

    const localId = result.current.photos[0].localId;
    const previewUrl = result.current.photos[0].previewUrl;

    act(() => {
      result.current.removePhoto(localId);
    });

    expect(result.current.photos).toHaveLength(0);
    expect(revokedUrls.has(previewUrl)).toBe(true);
  });

  it('reset clears all photos and revokes all object URLs', () => {
    const fetchMock = vi.mocked(fetch);
    for (let i = 0; i < 2; i++) {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ photoId: `p${i}`, uploadUrl: `https://s3.example.com/p${i}` }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
    }

    const { result } = renderHook(() => usePhotoUploader());

    act(() => {
      result.current.addFiles([
        makeFile('a.jpg', 1024, 'image/jpeg'),
        makeFile('b.jpg', 1024, 'image/jpeg'),
      ]);
    });

    const urls = result.current.photos.map((p) => p.previewUrl);

    act(() => {
      result.current.reset();
    });

    expect(result.current.photos).toHaveLength(0);
    for (const url of urls) {
      expect(revokedUrls.has(url)).toBe(true);
    }
  });

  it('uploads file successfully and tracks uploaded state', async () => {
    mockSuccessfulUpload('photo-abc');
    const { result } = renderHook(() => usePhotoUploader());

    act(() => {
      result.current.addFiles([makeFile('test.jpg', 1024, 'image/jpeg')]);
    });

    // Wait for microtask + fetch to resolve
    await vi.waitFor(() => {
      expect(result.current.photos[0].state).toBe('uploaded');
    });

    expect(result.current.photos[0].photoId).toBe('photo-abc');
    expect(result.current.uploadedPhotoIds).toEqual(['photo-abc']);
    expect(result.current.hasUploaded).toBe(true);
  });

  it('handles upload failure and sets failed state', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => usePhotoUploader());

    act(() => {
      result.current.addFiles([makeFile('test.jpg', 1024, 'image/jpeg')]);
    });

    await vi.waitFor(() => {
      expect(result.current.photos[0].state).toBe('failed');
    });

    expect(result.current.photos[0].errorMessage).toBe('Network error');
  });

  it('handles 429 rate limit response', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ retryAfterSeconds: 30 }), { status: 429 }),
    );

    const { result } = renderHook(() => usePhotoUploader());

    act(() => {
      result.current.addFiles([makeFile('test.jpg', 1024, 'image/jpeg')]);
    });

    await vi.waitFor(() => {
      expect(result.current.rateLimitUntil).not.toBeNull();
    });

    expect(result.current.rateLimitUntil).toBeGreaterThan(Date.now());
    expect(result.current.photos[0].state).toBe('failed');
  });

  it('preserves upload order in uploadedPhotoIds', async () => {
    const fetchMock = vi.mocked(fetch);

    // Mock all 4 fetch calls (2 photos × 2 calls each: intent + PUT)
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

      if (url === '/photos') {
        // Determine which photo based on call order
        const callCount = fetchMock.mock.calls.filter(
          (c) => (typeof c[0] === 'string' ? c[0] : '') === '/photos',
        ).length;
        const photoId = callCount <= 1 ? 'first' : 'second';
        return new Response(
          JSON.stringify({ photoId, uploadUrl: `https://s3.example.com/${photoId}` }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // S3 PUT
      return new Response(null, { status: 200 });
    });

    const { result } = renderHook(() => usePhotoUploader());

    act(() => {
      result.current.addFiles([
        makeFile('first.jpg', 1024, 'image/jpeg'),
        makeFile('second.jpg', 1024, 'image/jpeg'),
      ]);
    });

    await vi.waitFor(() => {
      expect(result.current.photos.filter((p) => p.state === 'uploaded')).toHaveLength(2);
    });

    // Order should match selection order, not completion order
    expect(result.current.uploadedPhotoIds).toEqual(['first', 'second']);
  });
});
