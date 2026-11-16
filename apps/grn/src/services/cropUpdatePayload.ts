import type { GrowerCropItem } from '../types/listing';
import type { UpsertGrowerCropRequest } from './api';

export function cropUpdatePayload(
  crop: GrowerCropItem,
  bedId: string | null
): UpsertGrowerCropRequest {
  return {
    canonicalId: crop.canonicalId ?? undefined,
    cropName: crop.cropName,
    varietyId: crop.varietyId ?? undefined,
    status: crop.status,
    visibility: crop.visibility,
    surplusEnabled: crop.surplusEnabled,
    nickname: crop.nickname ?? undefined,
    defaultUnit: crop.defaultUnit ?? undefined,
    notes: crop.notes ?? undefined,
    bedId,
    plantingDate: crop.plantingDate,
    expectedHarvestDate: crop.expectedHarvestDate,
    plantCount: crop.plantCount,
    spacingInches: crop.spacingInches,
  };
}
