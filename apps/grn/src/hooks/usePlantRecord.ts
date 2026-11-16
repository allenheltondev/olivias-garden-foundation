import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listHarvests, updateMyCrop } from '../services/api';
import type { GrowerCropItem } from '../types/listing';
import { cropUpdatePayload } from '../services/cropUpdatePayload';
import { createLogger } from '../utils/logging';

const logger = createLogger('plant-record');

export function usePlantRecord(crop: GrowerCropItem) {
  const client = useQueryClient();
  const harvests = useQuery({
    queryKey: ['harvests', crop.id],
    queryFn: () => listHarvests(crop.id),
  });
  const notes = useMutation({
    mutationKey: ['crop-record', crop.id],
    mutationFn: (text: string) => {
      const current = client.getQueryData<GrowerCropItem[]>(['myCrops'])?.find((item) => item.id === crop.id) ?? crop;
      return updateMyCrop(crop.id, { ...cropUpdatePayload(current, current.bedId), notes: text.trim() });
    },
    onSuccess: (updated) => {
      client.setQueryData<GrowerCropItem[]>(['myCrops'], (items) => items?.map((item) => item.id === updated.id ? updated : item));
      void client.invalidateQueries({ queryKey: ['myCrops'] });
      logger.info('Plant notes saved', { cropId: crop.id });
    },
    onError: (error) => logger.error('Plant notes could not be saved', error instanceof Error ? error : undefined),
  });
  return { harvests, notes };
}
