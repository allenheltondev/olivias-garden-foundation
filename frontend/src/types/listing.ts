export interface CatalogCrop {
  id: string;
  slug: string;
  commonName: string;
  scientificName: string | null;
  category: string | null;
  description: string | null;
}

export interface CatalogVariety {
  id: string;
  cropId: string;
  slug: string;
  name: string;
  description: string | null;
}

export interface GrowerCropItem {
  id: string;
  userId: string;
  canonicalId: string | null;
  cropName: string;
  varietyId: string | null;
  status: string;
  visibility: string;
  surplusEnabled: boolean;
  nickname: string | null;
  defaultUnit: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Listing {
  id: string;
  userId: string;
  growerCropId: string | null;
  cropId: string;
  varietyId: string | null;
  title: string;
  unit: string;
  quantityTotal: string;
  quantityRemaining: string;
  availableStart: string;
  availableEnd: string;
  status: string;
  pickupLocationText: string | null;
  pickupAddress: string | null;
  pickupDisclosurePolicy: string;
  pickupNotes: string | null;
  contactPref: string;
  geoKey: string | null;
  lat: number;
  lng: number;
  createdAt: string;
}

export interface ListMyListingsResponse {
  items: Listing[];
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface DiscoverListingsResponse {
  items: Listing[];
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface UpsertListingRequest {
  title: string;
  cropId: string;
  varietyId?: string;
  quantityTotal: number;
  unit: string;
  availableStart: string;
  availableEnd: string;
  pickupLocationText?: string;
  pickupAddress?: string;
  pickupDisclosurePolicy?: 'immediate' | 'after_confirmed' | 'after_accepted';
  pickupNotes?: string;
  contactPref?: 'app_message' | 'phone' | 'knock';
  lat: number;
  lng: number;
  status?: 'active' | 'pending' | 'claimed' | 'expired' | 'completed';
}
