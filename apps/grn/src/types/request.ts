export type RequestStatus = 'open' | 'matched' | 'closed';

export interface RequestItem {
  id: string;
  userId: string;
  cropId: string;
  varietyId: string | null;
  unit: string | null;
  quantity: string;
  neededBy: string;
  notes: string | null;
  geoKey: string | null;
  lat: number | null;
  lng: number | null;
  status: RequestStatus;
  createdAt: string;
}

export interface UpsertRequestPayload {
  cropId: string;
  varietyId?: string;
  unit?: string;
  quantity: number;
  neededBy: string;
  notes?: string;
  status?: RequestStatus;
}
