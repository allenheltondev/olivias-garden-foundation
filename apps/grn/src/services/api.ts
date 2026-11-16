import { fetchAuthSession } from 'aws-amplify/auth';
import { v4 as uuidv4 } from 'uuid';
import { getApiEndpoint } from '../config/amplify';
import type { UserProfile, UserType, GrowerProfile } from '../types/user';
import type {
  AnnotationShape,
  BedPolygonPoint,
  BedShape,
  BedType,
  CatalogCrop,
  CatalogVariety,
  DiscoverListingsResponse,
  GardenAnnotation,
  GardenBed,
  GardenCanvas,
  GrowerCropItem,
  Listing,
  ListMyListingsResponse,
  SunExposure,
  UpsertListingRequest,
} from '../types/listing';
import type { RequestItem, UpsertRequestPayload } from '../types/request';
import type { DerivedFeedResponse } from '../types/feed';

/**
 * API Client for the Community Food Coordination Platform
 *
 * Features:
 * - Automatic JWT token injection
 * - Correlation ID tracking
 * - 401 error handling
 * - Type-safe API methods
 */

/**
 * API Error class for better error handling
 */
export class ApiError extends Error {
  statusCode?: number;
  correlationId?: string;

  constructor(
    message: string,
    statusCode?: number,
    correlationId?: string
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.correlationId = correlationId;
  }
}

interface FetchOptions extends RequestInit {
  timeout?: number;
}

/**
 * Enhanced fetch wrapper with auth, correlation ID, and error handling
 */
async function apiFetch<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { timeout = 10000, ...fetchOptions } = options;
  const correlationId = uuidv4();
  const baseURL = getApiEndpoint();

  const headers = new Headers(fetchOptions.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('X-Correlation-Id', correlationId);

  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.accessToken?.toString();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  } catch (error) {
    console.error('Failed to get auth session:', error);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${baseURL}${endpoint}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401) {
      console.error('Unauthorized request - redirecting to sign in');
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      throw new ApiError('Unauthorized', 401, correlationId);
    }

    if (!response.ok) {
      let message = response.statusText;
      try {
        const errorData = await response.json();
        message = errorData.message || errorData.error || message;
      } catch {
        // noop
      }

      throw new ApiError(
        message,
        response.status,
        correlationId
      );
    }

    // 204 No Content (and any other empty body) has no JSON to parse.
    // Returning undefined cast to T keeps the type-untyped void callers
    // working without forcing every call site to special-case the
    // response.
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as T;
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new ApiError('Request timeout', undefined, correlationId);
      }
      throw new ApiError(error.message, undefined, correlationId);
    }

    throw new ApiError('An unexpected error occurred', undefined, correlationId);
  }
}

/**
 * `GET /me` reports `shareRadiusMiles` as a decimal string ("20.0") because the
 * value is stored in kilometres and converted through text, while `PUT /me`
 * expects a number. Left as-is the string flows straight back into a profile
 * save and the API rejects the payload, so it is normalised at the boundary
 * and the declared `number` type is true from here on.
 */
export function normalizeUserProfile(profile: UserProfile): UserProfile {
  if (!profile.growerProfile) return profile;

  return {
    ...profile,
    growerProfile: {
      ...profile.growerProfile,
      shareRadiusMiles: Number(profile.growerProfile.shareRadiusMiles),
    },
  };
}

export async function getMe(): Promise<UserProfile> {
  try {
    return normalizeUserProfile(await apiFetch<UserProfile>('/me'));
  } catch (error) {
    if (error instanceof ApiError) {
      throw new ApiError(
        `Failed to fetch user profile: ${error.message}`,
        error.statusCode,
        error.correlationId
      );
    }
    throw new ApiError('An unexpected error occurred while fetching user profile');
  }
}

export interface UpdateUserProfileRequest {
  displayName?: string;
  userType?: UserType;
  growerProfile?: {
    homeZone: string;
    address: string;
    shareRadiusMiles: number;
    isOrganization?: boolean;
    organizationName?: string;
    units: GrowerProfile['units'];
    locale: string;
  };
}

export async function updateMe(data: UpdateUserProfileRequest): Promise<void> {
  const correlationId = uuidv4();
  const baseURL = getApiEndpoint();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Correlation-Id': correlationId,
  };

  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.accessToken?.toString();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch (error) {
    console.error('Failed to get auth session:', error);
  }

  const response = await fetch(`${baseURL}/me`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const errorData = await response.json();
      message = errorData.message || errorData.error || message;
    } catch {
      // noop
    }
    throw new ApiError(
      `Failed to update user profile: ${message}`,
      response.status,
      correlationId
    );
  }
}

interface RawCatalogCrop {
  id: string;
  slug: string;
  common_name: string;
  scientific_name: string | null;
  category: string | null;
  description: string | null;
  pyramid_tier?: number | null;
}

interface RawCatalogVariety {
  id: string;
  crop_id: string;
  slug: string;
  name: string;
  description: string | null;
}

interface RawGrowerCropItem {
  id: string;
  user_id: string;
  canonical_id: string | null;
  crop_name: string;
  variety_id: string | null;
  status: string;
  visibility: string;
  surplus_enabled: boolean;
  nickname: string | null;
  default_unit: string | null;
  notes: string | null;
  bed_id: string | null;
  bed_name: string | null;
  planting_date: string | null;
  expected_harvest_date: string | null;
  plant_count: number | null;
  spacing_inches: number | null;
  pyramid_tier?: number | null;
  created_at: string;
  updated_at: string;
}

interface RawGardenBed {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  sun_exposure: SunExposure | null;
  soil_type: string | null;
  length_inches: number | null;
  width_inches: number | null;
  location_notes: string | null;
  sort_order: number;
  bed_type: BedType;
  shape: BedShape;
  position_x: number | null;
  position_y: number | null;
  rotation_deg: number;
  points: BedPolygonPoint[] | null;
  color: string | null;
  created_at: string;
  updated_at: string;
}

interface RawGardenCanvas {
  id: string;
  user_id: string;
  width_inches: number;
  height_inches: number;
  background_image_key: string | null;
  background_image_url: string | null;
  background_opacity: number;
  north_offset_deg: number;
  created_at: string;
  updated_at: string;
}

interface RawGardenAnnotation {
  id: string;
  user_id: string;
  label: string;
  icon: string | null;
  shape: AnnotationShape;
  position_x: number | null;
  position_y: number | null;
  length_inches: number | null;
  width_inches: number | null;
  rotation_deg: number;
  points: BedPolygonPoint[] | null;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface RawBackgroundUploadIntentResponse {
  upload_url: string;
  method: string;
  headers: Record<string, string>;
  s3_key: string;
  expires_in_seconds: number;
}

interface RawListingItem {
  id: string;
  user_id: string;
  grower_crop_id: string | null;
  crop_id: string;
  variety_id: string | null;
  title: string | null;
  unit: string | null;
  quantity_total: string | null;
  quantity_remaining: string | null;
  available_start: string | null;
  available_end: string | null;
  status: string;
  pickup_location_text: string | null;
  pickup_address: string | null;
  pickup_disclosure_policy: string;
  pickup_notes: string | null;
  contact_pref: string;
  geo_key: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

interface RawListingWriteResponse {
  id: string;
  userId: string;
  cropId: string;
  varietyId: string | null;
  title: string;
  quantityTotal: string;
  quantityRemaining: string;
  unit: string;
  availableStart: string;
  availableEnd: string;
  status: string;
  pickupLocationText: string | null;
  pickupAddress: string | null;
  pickupDisclosurePolicy: string;
  pickupNotes: string | null;
  contactPref: string;
  geoKey: string;
  lat: number;
  lng: number;
  createdAt: string;
}

interface RawListMyListingsResponse {
  items: RawListingItem[];
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
}

interface RawDiscoverListingsResponse {
  items: Array<Record<string, unknown>>;
  limit: number;
  offset: number;
  has_more?: boolean;
  hasMore?: boolean;
  next_offset?: number | null;
  nextOffset?: number | null;
}

interface RawRequestWriteResponse {
  id: string;
  userId?: string;
  user_id?: string;
  cropId?: string;
  crop_id?: string;
  varietyId?: string | null;
  variety_id?: string | null;
  unit?: string | null;
  quantity: string;
  neededBy?: string;
  needed_by?: string;
  notes?: string | null;
  geoKey?: string | null;
  geo_key?: string | null;
  lat?: number | null;
  lng?: number | null;
  status: string;
  createdAt?: string;
  created_at?: string;
}

interface RawDerivedFeedResponse {
  items: Array<Record<string, unknown>>;
  signals: Array<Record<string, unknown>>;
  freshness: {
    asOf?: string;
    as_of?: string;
    isStale?: boolean;
    is_stale?: boolean;
    staleFallbackUsed?: boolean;
    stale_fallback_used?: boolean;
    staleReason?: string | null;
    stale_reason?: string | null;
  };
  aiSummary?: {
    summaryText?: string;
    summary_text?: string;
    modelId?: string;
    model_id?: string;
    modelVersion?: string;
    model_version?: string;
    generatedAt?: string;
    generated_at?: string;
    expiresAt?: string;
    expires_at?: string;
    fromCache?: boolean;
    from_cache?: boolean;
  } | null;
  growerGuidance?: {
    guidanceText?: string;
    guidance_text?: string;
    explanation?: {
      season?: string;
      strategy?: string;
      windowDays?: number;
      window_days?: number;
      sourceSignalCount?: number;
      source_signal_count?: number;
      strongestScarcitySignal?: Record<string, unknown> | null;
      strongest_scarcity_signal?: Record<string, unknown> | null;
      strongestAbundanceSignal?: Record<string, unknown> | null;
      strongest_abundance_signal?: Record<string, unknown> | null;
    };
  } | null;
  limit: number;
  offset: number;
  hasMore?: boolean;
  has_more?: boolean;
  nextOffset?: number | null;
  next_offset?: number | null;
}

function mapCatalogCrop(raw: RawCatalogCrop): CatalogCrop {
  return {
    id: raw.id,
    slug: raw.slug,
    commonName: raw.common_name,
    scientificName: raw.scientific_name,
    category: raw.category,
    description: raw.description,
    pyramidTier: raw.pyramid_tier ?? null,
  };
}

function mapCatalogVariety(raw: RawCatalogVariety): CatalogVariety {
  return {
    id: raw.id,
    cropId: raw.crop_id,
    slug: raw.slug,
    name: raw.name,
    description: raw.description,
  };
}

function mapGrowerCropItem(raw: RawGrowerCropItem): GrowerCropItem {
  return {
    id: raw.id,
    userId: raw.user_id,
    canonicalId: raw.canonical_id,
    cropName: raw.crop_name,
    varietyId: raw.variety_id,
    status: raw.status,
    visibility: raw.visibility,
    surplusEnabled: raw.surplus_enabled,
    nickname: raw.nickname,
    defaultUnit: raw.default_unit,
    notes: raw.notes,
    bedId: raw.bed_id ?? null,
    bedName: raw.bed_name ?? null,
    plantingDate: raw.planting_date ?? null,
    expectedHarvestDate: raw.expected_harvest_date ?? null,
    plantCount: raw.plant_count ?? null,
    spacingInches: raw.spacing_inches ?? null,
    pyramidTier: raw.pyramid_tier ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapGardenBed(raw: RawGardenBed): GardenBed {
  return {
    id: raw.id,
    userId: raw.user_id,
    name: raw.name,
    description: raw.description,
    sunExposure: raw.sun_exposure,
    soilType: raw.soil_type,
    lengthInches: raw.length_inches,
    widthInches: raw.width_inches,
    locationNotes: raw.location_notes,
    sortOrder: raw.sort_order,
    bedType: raw.bed_type,
    shape: raw.shape,
    positionX: raw.position_x,
    positionY: raw.position_y,
    rotationDeg: raw.rotation_deg,
    points: raw.points,
    color: raw.color,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapGardenAnnotation(raw: RawGardenAnnotation): GardenAnnotation {
  return {
    id: raw.id,
    userId: raw.user_id,
    label: raw.label,
    icon: raw.icon,
    shape: raw.shape,
    positionX: raw.position_x,
    positionY: raw.position_y,
    lengthInches: raw.length_inches,
    widthInches: raw.width_inches,
    rotationDeg: raw.rotation_deg,
    points: raw.points,
    color: raw.color,
    sortOrder: raw.sort_order,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapGardenCanvas(raw: RawGardenCanvas): GardenCanvas {
  return {
    id: raw.id,
    userId: raw.user_id,
    widthInches: raw.width_inches,
    heightInches: raw.height_inches,
    backgroundImageKey: raw.background_image_key,
    backgroundImageUrl: raw.background_image_url,
    backgroundOpacity: raw.background_opacity,
    northOffsetDeg: raw.north_offset_deg,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapListingItem(raw: RawListingItem): Listing {
  return {
    id: raw.id,
    userId: raw.user_id,
    growerCropId: raw.grower_crop_id,
    cropId: raw.crop_id,
    varietyId: raw.variety_id,
    title: raw.title ?? '',
    unit: raw.unit ?? '',
    quantityTotal: raw.quantity_total ?? '0',
    quantityRemaining: raw.quantity_remaining ?? '0',
    availableStart: raw.available_start ?? '',
    availableEnd: raw.available_end ?? '',
    status: raw.status,
    pickupLocationText: raw.pickup_location_text,
    pickupAddress: raw.pickup_address,
    pickupDisclosurePolicy: raw.pickup_disclosure_policy,
    pickupNotes: raw.pickup_notes,
    contactPref: raw.contact_pref,
    geoKey: raw.geo_key,
    lat: raw.lat ?? 0,
    lng: raw.lng ?? 0,
    createdAt: raw.created_at,
  };
}

function mapWriteResponse(raw: RawListingWriteResponse): Listing {
  return {
    id: raw.id,
    userId: raw.userId,
    growerCropId: null,
    cropId: raw.cropId,
    varietyId: raw.varietyId,
    title: raw.title,
    unit: raw.unit,
    quantityTotal: raw.quantityTotal,
    quantityRemaining: raw.quantityRemaining,
    availableStart: raw.availableStart,
    availableEnd: raw.availableEnd,
    status: raw.status,
    pickupLocationText: raw.pickupLocationText,
    pickupAddress: raw.pickupAddress,
    pickupDisclosurePolicy: raw.pickupDisclosurePolicy,
    pickupNotes: raw.pickupNotes,
    contactPref: raw.contactPref,
    geoKey: raw.geoKey,
    lat: raw.lat,
    lng: raw.lng,
    createdAt: raw.createdAt,
  };
}

function getStringValue(raw: Record<string, unknown>, camel: string, snake: string): string {
  const value = raw[camel] ?? raw[snake];
  return typeof value === 'string' ? value : '';
}

function getNullableStringValue(
  raw: Record<string, unknown>,
  camel: string,
  snake: string
): string | null {
  const value = raw[camel] ?? raw[snake];
  return typeof value === 'string' ? value : null;
}

function getNullableNumberValue(
  raw: Record<string, unknown>,
  camel: string,
  snake: string
): number | null {
  const value = raw[camel] ?? raw[snake];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mapDiscoveredListingItem(raw: Record<string, unknown>): Listing {
  return {
    id: getStringValue(raw, 'id', 'id'),
    userId: getStringValue(raw, 'userId', 'user_id'),
    growerCropId: getNullableStringValue(raw, 'growerCropId', 'grower_crop_id'),
    cropId: getStringValue(raw, 'cropId', 'crop_id'),
    varietyId: getNullableStringValue(raw, 'varietyId', 'variety_id'),
    title: getStringValue(raw, 'title', 'title'),
    unit: getStringValue(raw, 'unit', 'unit'),
    quantityTotal: getStringValue(raw, 'quantityTotal', 'quantity_total') || '0',
    quantityRemaining: getStringValue(raw, 'quantityRemaining', 'quantity_remaining') || '0',
    availableStart: getStringValue(raw, 'availableStart', 'available_start'),
    availableEnd: getStringValue(raw, 'availableEnd', 'available_end'),
    status: getStringValue(raw, 'status', 'status'),
    pickupLocationText: getNullableStringValue(raw, 'pickupLocationText', 'pickup_location_text'),
    pickupAddress: getNullableStringValue(raw, 'pickupAddress', 'pickup_address'),
    pickupDisclosurePolicy:
      getStringValue(raw, 'pickupDisclosurePolicy', 'pickup_disclosure_policy') ||
      'after_confirmed',
    pickupNotes: getNullableStringValue(raw, 'pickupNotes', 'pickup_notes'),
    contactPref: getStringValue(raw, 'contactPref', 'contact_pref') || 'app_message',
    geoKey: getNullableStringValue(raw, 'geoKey', 'geo_key'),
    lat: getNullableNumberValue(raw, 'lat', 'lat') ?? 0,
    lng: getNullableNumberValue(raw, 'lng', 'lng') ?? 0,
    createdAt: getStringValue(raw, 'createdAt', 'created_at'),
  };
}

function mapRequestWriteResponse(raw: RawRequestWriteResponse): RequestItem {
  return {
    id: raw.id,
    userId: raw.userId ?? raw.user_id ?? '',
    cropId: raw.cropId ?? raw.crop_id ?? '',
    varietyId: raw.varietyId ?? raw.variety_id ?? null,
    unit: raw.unit ?? null,
    quantity: raw.quantity,
    neededBy: raw.neededBy ?? raw.needed_by ?? '',
    notes: raw.notes ?? null,
    geoKey: raw.geoKey ?? raw.geo_key ?? null,
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    status: raw.status as RequestItem['status'],
    createdAt: raw.createdAt ?? raw.created_at ?? '',
  };
}

function getNumberValue(raw: Record<string, unknown>, camel: string, snake: string): number {
  const value = raw[camel] ?? raw[snake];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function mapDerivedFeedResponse(raw: RawDerivedFeedResponse): DerivedFeedResponse {
  const signals = (raw.signals ?? []).map((signal) => ({
    geoBoundaryKey: getStringValue(signal, 'geoBoundaryKey', 'geo_boundary_key'),
    cropId: getNullableStringValue(signal, 'cropId', 'crop_id'),
    windowDays: getNumberValue(signal, 'windowDays', 'window_days'),
    listingCount: getNumberValue(signal, 'listingCount', 'listing_count'),
    requestCount: getNumberValue(signal, 'requestCount', 'request_count'),
    supplyQuantity: getStringValue(signal, 'supplyQuantity', 'supply_quantity'),
    demandQuantity: getStringValue(signal, 'demandQuantity', 'demand_quantity'),
    scarcityScore: getNumberValue(signal, 'scarcityScore', 'scarcity_score'),
    abundanceScore: getNumberValue(signal, 'abundanceScore', 'abundance_score'),
    computedAt: getStringValue(signal, 'computedAt', 'computed_at'),
    expiresAt: getStringValue(signal, 'expiresAt', 'expires_at'),
  }));

  const strongestScarcitySignal =
    raw.growerGuidance?.explanation?.strongestScarcitySignal ??
    raw.growerGuidance?.explanation?.strongest_scarcity_signal;
  const strongestAbundanceSignal =
    raw.growerGuidance?.explanation?.strongestAbundanceSignal ??
    raw.growerGuidance?.explanation?.strongest_abundance_signal;

  return {
    items: raw.items ?? [],
    signals,
    freshness: {
      asOf: raw.freshness.asOf ?? raw.freshness.as_of ?? '',
      isStale: raw.freshness.isStale ?? raw.freshness.is_stale ?? false,
      staleFallbackUsed: raw.freshness.staleFallbackUsed ?? raw.freshness.stale_fallback_used ?? false,
      staleReason: raw.freshness.staleReason ?? raw.freshness.stale_reason ?? null,
    },
    aiSummary: raw.aiSummary
      ? {
          summaryText: raw.aiSummary.summaryText ?? raw.aiSummary.summary_text ?? '',
          modelId: raw.aiSummary.modelId ?? raw.aiSummary.model_id ?? '',
          modelVersion: raw.aiSummary.modelVersion ?? raw.aiSummary.model_version ?? '',
          generatedAt: raw.aiSummary.generatedAt ?? raw.aiSummary.generated_at ?? '',
          expiresAt: raw.aiSummary.expiresAt ?? raw.aiSummary.expires_at ?? '',
          fromCache: raw.aiSummary.fromCache ?? raw.aiSummary.from_cache ?? false,
        }
      : null,
    growerGuidance: raw.growerGuidance
      ? {
          guidanceText: raw.growerGuidance.guidanceText ?? raw.growerGuidance.guidance_text ?? '',
          explanation: {
            season: raw.growerGuidance.explanation?.season ?? '',
            strategy: raw.growerGuidance.explanation?.strategy ?? '',
            windowDays:
              raw.growerGuidance.explanation?.windowDays ??
              raw.growerGuidance.explanation?.window_days ??
              0,
            sourceSignalCount:
              raw.growerGuidance.explanation?.sourceSignalCount ??
              raw.growerGuidance.explanation?.source_signal_count ??
              0,
            strongestScarcitySignal: strongestScarcitySignal
              ? {
                  geoBoundaryKey: getStringValue(strongestScarcitySignal, 'geoBoundaryKey', 'geo_boundary_key'),
                  cropId: getNullableStringValue(strongestScarcitySignal, 'cropId', 'crop_id'),
                  scarcityScore: getNumberValue(strongestScarcitySignal, 'scarcityScore', 'scarcity_score'),
                  abundanceScore: getNumberValue(strongestScarcitySignal, 'abundanceScore', 'abundance_score'),
                  listingCount: getNumberValue(strongestScarcitySignal, 'listingCount', 'listing_count'),
                  requestCount: getNumberValue(strongestScarcitySignal, 'requestCount', 'request_count'),
                }
              : null,
            strongestAbundanceSignal: strongestAbundanceSignal
              ? {
                  geoBoundaryKey: getStringValue(strongestAbundanceSignal, 'geoBoundaryKey', 'geo_boundary_key'),
                  cropId: getNullableStringValue(strongestAbundanceSignal, 'cropId', 'crop_id'),
                  scarcityScore: getNumberValue(strongestAbundanceSignal, 'scarcityScore', 'scarcity_score'),
                  abundanceScore: getNumberValue(strongestAbundanceSignal, 'abundanceScore', 'abundance_score'),
                  listingCount: getNumberValue(strongestAbundanceSignal, 'listingCount', 'listing_count'),
                  requestCount: getNumberValue(strongestAbundanceSignal, 'requestCount', 'request_count'),
                }
              : null,
          },
        }
      : null,
    limit: raw.limit,
    offset: raw.offset,
    hasMore: raw.hasMore ?? raw.has_more ?? false,
    nextOffset: raw.nextOffset ?? raw.next_offset ?? null,
  };
}

export async function listCatalogCrops(): Promise<CatalogCrop[]> {
  const response = await apiFetch<RawCatalogCrop[]>('/catalog/crops');
  return response.map(mapCatalogCrop);
}

export async function listCatalogVarieties(cropId: string): Promise<CatalogVariety[]> {
  const response = await apiFetch<RawCatalogVariety[]>(`/catalog/crops/${cropId}/varieties`);
  return response.map(mapCatalogVariety);
}

export async function listMyCrops(): Promise<GrowerCropItem[]> {
  const response = await apiFetch<RawGrowerCropItem[]>('/crops');
  return response.map(mapGrowerCropItem);
}

export interface UpsertGrowerCropRequest {
  canonicalId?: string;
  cropName: string;
  varietyId?: string;
  status: string;
  visibility: string;
  surplusEnabled: boolean;
  nickname?: string;
  defaultUnit?: string;
  notes?: string;
  bedId?: string | null;
  plantingDate?: string | null;
  expectedHarvestDate?: string | null;
  plantCount?: number | null;
  spacingInches?: number | null;
}

export async function createMyCrop(data: UpsertGrowerCropRequest): Promise<GrowerCropItem> {
  const response = await apiFetch<RawGrowerCropItem>('/crops', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return mapGrowerCropItem(response);
}

export async function updateMyCrop(cropId: string, data: UpsertGrowerCropRequest): Promise<GrowerCropItem> {
  const response = await apiFetch<RawGrowerCropItem>(`/crops/${cropId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return mapGrowerCropItem(response);
}

export async function deleteMyCrop(cropId: string): Promise<void> {
  await apiFetch(`/crops/${cropId}`, {
    method: 'DELETE',
  });
}

// --- Harvest tracking -------------------------------------------------------
// Private per-crop bookkeeping: how much has been brought in. Amounts are
// serialized as strings to preserve precision. Responses are camelCase.

export interface HarvestItem {
  id: string;
  growerCropId: string;
  amount: string;
  unit: string | null;
  harvestedOn: string;
  notes: string | null;
  createdAt: string;
}

export interface HarvestLogResponse {
  growerCropId: string;
  totalHarvested: string;
  harvestCount: number;
  harvests: HarvestItem[];
}

export interface RecordHarvestResponse {
  harvest: HarvestItem;
  totalHarvested: string;
  harvestCount: number;
}

export interface RecordHarvestInput {
  amount: number;
  unit?: string;
  harvestedOn?: string;
  notes?: string;
}

export async function listHarvests(cropId: string): Promise<HarvestLogResponse> {
  return apiFetch<HarvestLogResponse>(`/crops/${encodeURIComponent(cropId)}/harvests`);
}

export async function recordHarvest(
  cropId: string,
  input: RecordHarvestInput
): Promise<RecordHarvestResponse> {
  return apiFetch<RecordHarvestResponse>(`/crops/${encodeURIComponent(cropId)}/harvests`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateHarvest(
  cropId: string,
  harvestId: string,
  input: RecordHarvestInput
): Promise<RecordHarvestResponse> {
  return apiFetch<RecordHarvestResponse>(
    `/crops/${encodeURIComponent(cropId)}/harvests/${encodeURIComponent(harvestId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    }
  );
}

export async function deleteHarvest(cropId: string, harvestId: string): Promise<void> {
  await apiFetch(
    `/crops/${encodeURIComponent(cropId)}/harvests/${encodeURIComponent(harvestId)}`,
    { method: 'DELETE' }
  );
}

export interface UpsertGardenBedRequest {
  name: string;
  description?: string | null;
  sunExposure?: SunExposure | null;
  soilType?: string | null;
  lengthInches?: number | null;
  widthInches?: number | null;
  locationNotes?: string | null;
  sortOrder?: number;
  bedType?: BedType;
  shape?: BedShape;
  positionX?: number | null;
  positionY?: number | null;
  rotationDeg?: number;
  points?: BedPolygonPoint[] | null;
  color?: string | null;
}

export interface UpsertGardenCanvasRequest {
  widthInches?: number;
  heightInches?: number;
  backgroundImageKey?: string | null;
  backgroundOpacity?: number;
  northOffsetDeg?: number;
}

export interface RequestBackgroundUploadUrlInput {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  contentLength: number;
}

export interface BackgroundUploadIntent {
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
  s3Key: string;
  expiresInSeconds: number;
}

export type JournalEntryKind =
  | 'planned'
  | 'planted'
  | 'garden'
  | 'harvest'
  | 'reminder'
  | 'share'
  | 'note';

export interface JournalEntry {
  id: string;
  kind: JournalEntryKind;
  occurredAt: string;
  title: string;
  detail: string | null;
  sourceType: string;
  sourceId: string;
  sourcePath: string | null;
  isPrivate: boolean;
  manual: boolean;
  photoUrl: string | null;
}

export interface JournalSummary {
  season: number;
  plantedCount: number;
  harvestCount: number;
  reminderCompletionCount: number;
  completedShareCount: number;
  foodSharedBeforeExpiryCount: number;
  activeMonthCount: number;
  explanation: string;
  explanationSource: 'recorded_facts';
  isAiGenerated: false;
}

export interface JournalResponse {
  season: number;
  entries: JournalEntry[];
  summary: JournalSummary;
}

export interface CreateJournalNoteRequest {
  occurredOn: string;
  title: string;
  body?: string;
  photoKey?: string;
}

export interface JournalPhotoUploadIntent {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  photoKey: string;
  expiresInSeconds: number;
}

// --- AI garden review -------------------------------------------------------

export interface GardenReviewInsight {
  severity: 'warning' | 'tip' | 'info';
  category: string;
  title: string;
  detail: string;
  bedId?: string;
  bedName?: string;
}

export interface GardenReviewResponse {
  modelId: string;
  modelVersion: string;
  structuredJson: boolean;
  generatedAt: string;
  insights: GardenReviewInsight[];
}

/** Pro feature: throws ApiError with status 403 (feature_locked) on free tier. */
export async function generateGardenReview(): Promise<GardenReviewResponse> {
  return apiFetch<GardenReviewResponse>('/almanac/garden-review', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function listMyBeds(): Promise<GardenBed[]> {
  const response = await apiFetch<RawGardenBed[]>('/beds');
  return response.map(mapGardenBed);
}

export async function createMyBed(data: UpsertGardenBedRequest): Promise<GardenBed> {
  const response = await apiFetch<RawGardenBed>('/beds', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return mapGardenBed(response);
}

export async function updateMyBed(bedId: string, data: UpsertGardenBedRequest): Promise<GardenBed> {
  const response = await apiFetch<RawGardenBed>(`/beds/${bedId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return mapGardenBed(response);
}

export async function deleteMyBed(bedId: string): Promise<void> {
  await apiFetch(`/beds/${bedId}`, {
    method: 'DELETE',
  });
}

export interface UpsertGardenAnnotationRequest {
  label: string;
  icon?: string | null;
  shape?: AnnotationShape;
  positionX?: number | null;
  positionY?: number | null;
  lengthInches?: number | null;
  widthInches?: number | null;
  rotationDeg?: number;
  points?: BedPolygonPoint[] | null;
  color?: string | null;
  sortOrder?: number;
}

export async function listMyAnnotations(): Promise<GardenAnnotation[]> {
  const response = await apiFetch<RawGardenAnnotation[]>('/annotations');
  return response.map(mapGardenAnnotation);
}

export async function createMyAnnotation(
  data: UpsertGardenAnnotationRequest
): Promise<GardenAnnotation> {
  const response = await apiFetch<RawGardenAnnotation>('/annotations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return mapGardenAnnotation(response);
}

export async function updateMyAnnotation(
  annotationId: string,
  data: UpsertGardenAnnotationRequest
): Promise<GardenAnnotation> {
  const response = await apiFetch<RawGardenAnnotation>(
    `/annotations/${annotationId}`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    }
  );
  return mapGardenAnnotation(response);
}

export async function deleteMyAnnotation(annotationId: string): Promise<void> {
  await apiFetch(`/annotations/${annotationId}`, {
    method: 'DELETE',
  });
}

export async function getMyGardenCanvas(): Promise<GardenCanvas> {
  const response = await apiFetch<RawGardenCanvas>('/garden');
  return mapGardenCanvas(response);
}

export async function updateMyGardenCanvas(
  data: UpsertGardenCanvasRequest
): Promise<GardenCanvas> {
  const response = await apiFetch<RawGardenCanvas>('/garden', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return mapGardenCanvas(response);
}

export async function requestBackgroundUploadUrl(
  data: RequestBackgroundUploadUrlInput
): Promise<BackgroundUploadIntent> {
  const response = await apiFetch<RawBackgroundUploadIntentResponse>(
    '/garden/background-upload-url',
    {
      method: 'POST',
      body: JSON.stringify(data),
    }
  );
  return {
    uploadUrl: response.upload_url,
    method: response.method,
    headers: response.headers,
    s3Key: response.s3_key,
    expiresInSeconds: response.expires_in_seconds,
  };
}

export async function getGardenJournal(season: number): Promise<JournalResponse> {
  return apiFetch<JournalResponse>(`/journal?season=${encodeURIComponent(String(season))}`);
}

export async function createJournalNote(
  payload: CreateJournalNoteRequest,
  idempotencyKey = uuidv4()
): Promise<JournalEntry> {
  return apiFetch<JournalEntry>('/journal/notes', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  });
}

export async function deleteJournalNote(noteId: string): Promise<void> {
  await apiFetch(`/journal/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
}

export async function requestJournalPhotoUpload(
  file: File
): Promise<JournalPhotoUploadIntent> {
  return apiFetch<JournalPhotoUploadIntent>('/journal/photo-upload-url', {
    method: 'POST',
    body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
  });
}

export async function uploadJournalPhoto(
  intent: JournalPhotoUploadIntent,
  file: File
): Promise<void> {
  const response = await fetch(intent.uploadUrl, {
    method: intent.method,
    headers: intent.headers,
    body: file,
  });
  if (!response.ok) {
    throw new ApiError('Could not upload that photo. Please try again.', response.status);
  }
}

export async function listMyListings(
  limit = 20,
  offset = 0,
  status?: 'active' | 'expired' | 'completed'
): Promise<ListMyListingsResponse> {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (status) {
    params.set('status', status);
  }

  const response = await apiFetch<RawListMyListingsResponse>(`/my/listings?${params.toString()}`);
  return {
    items: response.items.map(mapListingItem),
    limit: response.limit,
    offset: response.offset,
    hasMore: response.has_more,
    nextOffset: response.next_offset,
  };
}

export async function getMyListing(listingId: string): Promise<Listing> {
  const response = await apiFetch<RawListingItem>(`/my/listings/${listingId}`);
  return mapListingItem(response);
}

export async function createListing(
  data: UpsertListingRequest,
  idempotencyKey = uuidv4()
): Promise<Listing> {
  const response = await apiFetch<RawListingWriteResponse>('/listings', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  });

  return mapWriteResponse(response);
}

export async function updateListing(listingId: string, data: UpsertListingRequest): Promise<Listing> {
  const response = await apiFetch<RawListingWriteResponse>(`/listings/${listingId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

  return mapWriteResponse(response);
}

export interface DiscoverListingsQuery {
  geoKey: string;
  radiusMiles?: number;
  status?: 'active';
  limit?: number;
  offset?: number;
}

export async function discoverListings({
  geoKey,
  radiusMiles,
  status = 'active',
  limit = 20,
  offset = 0,
}: DiscoverListingsQuery): Promise<DiscoverListingsResponse> {
  const params = new URLSearchParams();
  params.set('geoKey', geoKey);
  params.set('status', status);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (radiusMiles !== undefined) {
    params.set('radiusMiles', String(radiusMiles));
  }

  const response = await apiFetch<RawDiscoverListingsResponse>(`/listings/discover?${params.toString()}`);

  return {
    items: response.items.map(mapDiscoveredListingItem),
    limit: response.limit,
    offset: response.offset,
    hasMore: response.has_more ?? response.hasMore ?? false,
    nextOffset: response.next_offset ?? response.nextOffset ?? null,
  };
}

export interface DerivedFeedQuery {
  geoKey: string;
  windowDays?: 7 | 14 | 30;
  limit?: number;
  offset?: number;
}

export interface EntitlementsResponse {
  tier: string;
  entitlementsVersion: string;
  entitlements: string[];
  policy: {
    aiIsProOnly: boolean;
    freeRemindersDeterministicOnly: boolean;
  };
}

export interface CreateCheckoutSessionRequest {
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCheckoutSessionResponse {
  checkoutUrl: string;
  checkoutSessionId: string;
}

export type ReminderType = 'watering' | 'harvest' | 'fertilizer' | 'checkin' | 'custom';

export interface ReminderItem {
  id: string;
  title: string;
  reminderType: ReminderType;
  cadenceDays: number;
  startDate: string;
  timezone: string;
  status: 'active' | 'paused';
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
}

export interface ReminderListResponse {
  items: ReminderItem[];
}

export interface CreateReminderRequest {
  title: string;
  reminderType: ReminderType;
  cadenceDays: number;
  startDate: string;
  timezone?: string;
}

export interface WeeklyPlanRecommendation {
  recommendation: string;
  confidence: number;
  rationale: string[];
}

export interface WeeklyPlanResponse {
  modelId: string;
  modelVersion: string;
  structuredJson: boolean;
  geoKey: string;
  windowDays: number;
  recommendations: WeeklyPlanRecommendation[];
}

export async function getDerivedFeed({
  geoKey,
  windowDays = 7,
  limit = 20,
  offset = 0,
}: DerivedFeedQuery): Promise<DerivedFeedResponse> {
  const params = new URLSearchParams();
  params.set('geoKey', geoKey);
  params.set('windowDays', String(windowDays));
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  const response = await apiFetch<RawDerivedFeedResponse>(`/feed/derived?${params.toString()}`);
  return mapDerivedFeedResponse(response);
}

export async function getEntitlements(): Promise<EntitlementsResponse> {
  return apiFetch<EntitlementsResponse>('/me/entitlements');
}

export async function createCheckoutSession(
  payload: CreateCheckoutSessionRequest
): Promise<CreateCheckoutSessionResponse> {
  return apiFetch<CreateCheckoutSessionResponse>('/billing/checkout-session', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listReminders(): Promise<ReminderListResponse> {
  return apiFetch<ReminderListResponse>('/reminders');
}

export async function createReminder(payload: CreateReminderRequest): Promise<ReminderItem> {
  return apiFetch<ReminderItem>('/reminders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateReminderStatus(
  reminderId: string,
  status: 'active' | 'paused' | 'completed',
  idempotencyKey?: string
): Promise<ReminderItem> {
  const headers: Record<string, string> = {};
  if (status === 'completed') {
    headers['Idempotency-Key'] = idempotencyKey ?? uuidv4();
  }
  return apiFetch<ReminderItem>(`/reminders/${encodeURIComponent(reminderId)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ status }),
  });
}

export async function getWeeklyGrowPlan(geoKey: string, windowDays = 7): Promise<WeeklyPlanResponse> {
  return apiFetch<WeeklyPlanResponse>('/almanac/weekly-plan', {
    method: 'POST',
    body: JSON.stringify({ geoKey, windowDays }),
  });
}

export async function createRequest(
  data: UpsertRequestPayload,
  idempotencyKey = uuidv4()
): Promise<RequestItem> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const response = await apiFetch<RawRequestWriteResponse>('/requests', {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });

  return mapRequestWriteResponse(response);
}

export async function updateRequest(
  requestId: string,
  data: UpsertRequestPayload
): Promise<RequestItem> {
  const response = await apiFetch<RawRequestWriteResponse>(`/requests/${requestId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

  return mapRequestWriteResponse(response);
}

// --- Garden sharing ---------------------------------------------------------
// The owner manages one public link; anyone with the token reads a
// privacy-trimmed snapshot without authentication.

export interface GardenShareLink {
  token: string;
  createdAt: string;
}

export interface SharedGardenBed {
  id: string;
  name: string;
  bedType: BedType;
  shape: BedShape;
  sunExposure: SunExposure | null;
  soilType: string | null;
  lengthInches: number | null;
  widthInches: number | null;
  positionX: number | null;
  positionY: number | null;
  rotationDeg: number;
  points: BedPolygonPoint[] | null;
  color: string | null;
  sortOrder: number;
}

export interface SharedGardenAnnotation {
  id: string;
  label: string;
  icon: string | null;
  shape: AnnotationShape;
  positionX: number | null;
  positionY: number | null;
  lengthInches: number | null;
  widthInches: number | null;
  rotationDeg: number;
  points: BedPolygonPoint[] | null;
  color: string | null;
  sortOrder: number;
}

export interface SharedGardenSnapshot {
  canvas: {
    widthInches: number;
    heightInches: number;
    northOffsetDeg: number;
  };
  beds: SharedGardenBed[];
  annotations: SharedGardenAnnotation[];
  crops: Array<{ bedId: string; cropName: string; plantCount: number | null }>;
}

export async function getMyGardenShare(): Promise<GardenShareLink> {
  return apiFetch<GardenShareLink>('/garden/share');
}

export async function createMyGardenShare(): Promise<GardenShareLink> {
  return apiFetch<GardenShareLink>('/garden/share', { method: 'POST' });
}

export async function revokeMyGardenShare(): Promise<void> {
  await apiFetch<void>('/garden/share', { method: 'DELETE' });
}

/**
 * Public fetch for the shared-garden page: no Amplify session, no auth
 * header — visitors are anonymous by design.
 */
export async function fetchSharedGarden(token: string): Promise<SharedGardenSnapshot> {
  const response = await fetch(`${getApiEndpoint()}/gardens/${encodeURIComponent(token)}`, {
    headers: { 'X-Correlation-Id': uuidv4() },
  });
  if (!response.ok) {
    throw new ApiError('Shared garden not found', response.status);
  }
  return (await response.json()) as SharedGardenSnapshot;
}

// --- API keys ---------------------------------------------------------------
// Personal keys for programmatic access. The plaintext secret is only ever
// returned once, by createApiKey; afterwards only non-secret metadata is
// available. Backend responses are already camelCase, so no mapping is needed.

export interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKey extends ApiKeyItem {
  /** The full plaintext key. Shown once; store it securely. */
  key: string;
}

export interface ApiKeyListResponse {
  items: ApiKeyItem[];
}

export async function listApiKeys(): Promise<ApiKeyListResponse> {
  return apiFetch<ApiKeyListResponse>('/me/api-keys');
}

export async function createApiKey(name: string): Promise<CreatedApiKey> {
  return apiFetch<CreatedApiKey>('/me/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function renameApiKey(apiKeyId: string, name: string): Promise<ApiKeyItem> {
  return apiFetch<ApiKeyItem>(`/me/api-keys/${encodeURIComponent(apiKeyId)}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export async function deleteApiKey(apiKeyId: string): Promise<void> {
  await apiFetch(`/me/api-keys/${encodeURIComponent(apiKeyId)}`, {
    method: 'DELETE',
  });
}

export default apiFetch;
