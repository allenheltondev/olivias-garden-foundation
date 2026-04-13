import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listMyCrops,
  createMyCrop,
  updateMyCrop,
  deleteMyCrop,
  listCatalogCrops,
} from '../../services/api';
import type { UpsertGrowerCropRequest } from '../../services/api';
import type { GrowerCropItem } from '../../types/listing';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { createLogger } from '../../utils/logging';

const logger = createLogger('crop-library');

interface CropLibraryPanelProps {
  viewerUserId?: string;
}

export function CropLibraryPanel({ viewerUserId }: CropLibraryPanelProps) {
  const [isAddingCrop, setIsAddingCrop] = useState(false);
  const [editingCrop, setEditingCrop] = useState<GrowerCropItem | null>(null);
  const [formData, setFormData] = useState({
    cropName: '',
    canonicalId: '',
    status: 'interested',
    visibility: 'local',
    surplusEnabled: false,
    nickname: '',
    defaultUnit: '',
    notes: '',
  });
  void viewerUserId;

  const queryClient = useQueryClient();

  const { data: myCrops, isLoading: isLoadingCrops } = useQuery({
    queryKey: ['myCrops'],
    queryFn: listMyCrops,
  });

  const { data: catalogCrops, isLoading: isLoadingCatalog } = useQuery({
    queryKey: ['catalogCrops'],
    queryFn: listCatalogCrops,
  });

  const createMutation = useMutation({
    mutationFn: createMyCrop,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myCrops'] });
      resetForm();
      setIsAddingCrop(false);
      logger.info('Crop added to library');
    },
    onError: (error) => {
      logger.error('Failed to add crop', error instanceof Error ? error : undefined);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpsertGrowerCropRequest }) =>
      updateMyCrop(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myCrops'] });
      resetForm();
      setEditingCrop(null);
      logger.info('Crop updated');
    },
    onError: (error) => {
      logger.error('Failed to update crop', error instanceof Error ? error : undefined);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMyCrop,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myCrops'] });
      logger.info('Crop removed from library');
    },
    onError: (error) => {
      logger.error('Failed to remove crop', error instanceof Error ? error : undefined);
    },
  });

  const resetForm = () => {
    setFormData({
      cropName: '',
      canonicalId: '',
      status: 'interested',
      visibility: 'local',
      surplusEnabled: false,
      nickname: '',
      defaultUnit: '',
      notes: '',
    });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    const data: UpsertGrowerCropRequest = {
      cropName: formData.cropName,
      canonicalId: formData.canonicalId || undefined,
      status: formData.status,
      visibility: formData.visibility,
      surplusEnabled: formData.surplusEnabled,
      nickname: formData.nickname || undefined,
      defaultUnit: formData.defaultUnit || undefined,
      notes: formData.notes || undefined,
    };

    if (editingCrop) {
      updateMutation.mutate({ id: editingCrop.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (crop: GrowerCropItem) => {
    setEditingCrop(crop);
    setFormData({
      cropName: crop.cropName,
      canonicalId: crop.canonicalId || '',
      status: crop.status,
      visibility: crop.visibility,
      surplusEnabled: crop.surplusEnabled,
      nickname: crop.nickname || '',
      defaultUnit: crop.defaultUnit || '',
      notes: crop.notes || '',
    });
  };

  const handleDelete = (cropId: string) => {
    if (confirm('Are you sure you want to remove this crop from your library?')) {
      deleteMutation.mutate(cropId);
    }
  };

  const handleCancel = () => {
    resetForm();
    setIsAddingCrop(false);
    setEditingCrop(null);
  };

  const catalogOptions = catalogCrops?.map(crop => ({
    value: crop.id,
    label: crop.commonName,
  })) || [];

  const getInputValue = (event: ChangeEvent<HTMLInputElement>) => event.target.value;

  const statusOptions = [
    { value: 'interested', label: 'Interested' },
    { value: 'planning', label: 'Planning' },
    { value: 'growing', label: 'Growing' },
    { value: 'paused', label: 'Paused' },
  ];

  const visibilityOptions = [
    { value: 'private', label: 'Private' },
    { value: 'local', label: 'Local' },
    { value: 'public', label: 'Public' },
  ];

  if (isLoadingCrops) {
    return (
      <Card>
        <div className="p-4 text-center">
          <p className="text-gray-600">Loading your crop library...</p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">My Crop Library</h3>
          <Button
            onClick={() => setIsAddingCrop(true)}
            variant="primary"
            size="sm"
            disabled={isAddingCrop || !!editingCrop}
          >
            Add Crop
          </Button>
        </div>

        {(isAddingCrop || editingCrop) && (
          <form onSubmit={handleSubmit} className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h4 className="text-md font-medium mb-3">
              {editingCrop ? 'Edit Crop' : 'Add New Crop'}
            </h4>

            <div className="space-y-4">
              <Input
                label="Crop Name"
                value={formData.cropName}
                onChange={(event) => setFormData(prev => ({ ...prev, cropName: getInputValue(event) }))}
                placeholder="e.g., Heirloom Tomatoes, Mystery Squash"
                required
              />

              <Select
                label="Link to Catalog Crop (Optional)"
                value={formData.canonicalId}
                onChange={(value) => setFormData(prev => ({ ...prev, canonicalId: value }))}
                options={[
                  { value: '', label: 'No catalog link (custom crop)' },
                  ...catalogOptions,
                ]}
                disabled={isLoadingCatalog}
              />

              <Select
                label="Status"
                value={formData.status}
                onChange={(value) => setFormData(prev => ({ ...prev, status: value }))}
                options={statusOptions}
                required
              />

              <Select
                label="Visibility"
                value={formData.visibility}
                onChange={(value) => setFormData(prev => ({ ...prev, visibility: value }))}
                options={visibilityOptions}
                required
              />

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="surplusEnabled"
                  checked={formData.surplusEnabled}
                  onChange={(e) => setFormData(prev => ({ ...prev, surplusEnabled: e.target.checked }))}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label htmlFor="surplusEnabled" className="ml-2 text-sm text-gray-700">
                  Enable surplus sharing
                </label>
              </div>

              <Input
                label="Nickname (Optional)"
                value={formData.nickname}
                onChange={(event) => setFormData(prev => ({ ...prev, nickname: getInputValue(event) }))}
                placeholder="e.g., Big Boy, Sweet 100s"
              />

              <Input
                label="Default Unit (Optional)"
                value={formData.defaultUnit}
                onChange={(event) => setFormData(prev => ({ ...prev, defaultUnit: getInputValue(event) }))}
                placeholder="e.g., lb, bunch, each"
              />

              <Input
                label="Notes (Optional)"
                value={formData.notes}
                onChange={(event) => setFormData(prev => ({ ...prev, notes: getInputValue(event) }))}
                placeholder="Any additional notes about this crop"
              />
            </div>

            <div className="flex gap-2 mt-4">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
              <Button
                type="button"
                onClick={handleCancel}
                variant="secondary"
                size="sm"
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          {myCrops?.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No crops in your library yet. Add your first crop above!
            </p>
          ) : (
            myCrops?.map((crop) => (
              <div
                key={crop.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">
                      {crop.nickname || crop.cropName}
                    </span>
                    {crop.canonicalId && (
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        Catalog
                      </span>
                    )}
                    {!crop.canonicalId && (
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                        Custom
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600">
                    Status: {crop.status} • Visibility: {crop.visibility}
                    {crop.surplusEnabled && ' • Surplus enabled'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleEdit(crop)}
                    variant="secondary"
                    size="sm"
                    disabled={isAddingCrop || !!editingCrop}
                  >
                    Edit
                  </Button>
                  <Button
                    onClick={() => handleDelete(crop.id)}
                    variant="outline"
                    size="sm"
                    disabled={deleteMutation.isPending}
                    className="!border-red-300 !text-red-600 hover:!bg-red-50"
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
