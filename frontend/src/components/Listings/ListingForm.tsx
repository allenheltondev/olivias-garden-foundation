import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import type {
  CatalogCrop,
  CatalogVariety,
  Listing,
  UpsertListingRequest,
} from '../../types/listing';

export interface ListingQuickPickOption {
  id: string;
  label: string;
  cropId: string;
  growerCropId?: string;  // For user-defined crops
  varietyId?: string;
  defaultUnit?: string;
  suggestedTitle: string;
}

interface ListingFormProps {
  mode: 'create' | 'edit';
  crops: CatalogCrop[];
  varieties: CatalogVariety[];
  quickPickOptions?: ListingQuickPickOption[];
  isLoadingVarieties: boolean;
  isLoadingQuickPicks?: boolean;
  initialListing?: Listing | null;
  defaultLat?: number;
  defaultLng?: number;
  isSubmitting: boolean;
  isOffline: boolean;
  submitError: string | null;
  onCropChange: (cropId: string) => void;
  onSubmit: (request: UpsertListingRequest) => Promise<void>;
  onCancelEdit?: () => void;
}

interface ListingFormState {
  title: string;
  cropId: string;
  growerCropId: string;
  varietyId: string;
  quantityTotal: string;
  unit: string;
  availableStart: string;
  availableEnd: string;
  lat: string;
  lng: string;
  pickupLocationText: string;
  pickupNotes: string;
}

interface ListingFormErrors {
  title?: string;
  cropId?: string;
  quantityTotal?: string;
  availableStart?: string;
  availableEnd?: string;
  lat?: string;
  lng?: string;
}

const listingStatuses = ['active', 'pending', 'claimed', 'expired', 'completed'] as const;

function isListingStatus(value: string): value is NonNullable<UpsertListingRequest['status']> {
  return listingStatuses.includes(value as (typeof listingStatuses)[number]);
}

function toLocalDateTimeInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseIsoToLocal(isoValue: string): string {
  if (!isoValue) {
    return '';
  }

  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return toLocalDateTimeInput(parsed);
}

function buildDefaultForm(defaultLat?: number, defaultLng?: number): ListingFormState {
  const now = new Date();
  const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

  return {
    title: '',
    cropId: '',
    growerCropId: '',
    varietyId: '',
    quantityTotal: '',
    unit: 'lb',
    availableStart: toLocalDateTimeInput(now),
    availableEnd: toLocalDateTimeInput(oneHourLater),
    lat: defaultLat !== undefined ? String(defaultLat) : '',
    lng: defaultLng !== undefined ? String(defaultLng) : '',
    pickupLocationText: '',
    pickupNotes: '',
  };
}

function buildEditForm(listing: Listing): ListingFormState {
  return {
    title: listing.title,
    cropId: listing.cropId,
    growerCropId: listing.growerCropId ?? '',
    varietyId: listing.varietyId ?? '',
    quantityTotal: listing.quantityTotal,
    unit: listing.unit,
    availableStart: parseIsoToLocal(listing.availableStart),
    availableEnd: parseIsoToLocal(listing.availableEnd),
    lat: String(listing.lat),
    lng: String(listing.lng),
    pickupLocationText: listing.pickupLocationText ?? '',
    pickupNotes: listing.pickupNotes ?? '',
  };
}

export function ListingForm({
  mode,
  crops,
  varieties,
  quickPickOptions = [],
  isLoadingVarieties,
  isLoadingQuickPicks = false,
  initialListing,
  defaultLat,
  defaultLng,
  isSubmitting,
  isOffline,
  submitError,
  onCropChange,
  onSubmit,
  onCancelEdit,
}: ListingFormProps) {
  const [errors, setErrors] = useState<ListingFormErrors>({});
  const [selectedQuickPickId, setSelectedQuickPickId] = useState<string>('');

  const initialState = useMemo(() => {
    if (mode === 'edit' && initialListing) {
      return buildEditForm(initialListing);
    }
    return buildDefaultForm(defaultLat, defaultLng);
  }, [mode, initialListing, defaultLat, defaultLng]);

  const [formState, setFormState] = useState<ListingFormState>(initialState);

  const validateForm = (): boolean => {
    const nextErrors: ListingFormErrors = {};

    if (!formState.title.trim()) {
      nextErrors.title = 'Title is required';
    }

    if (!formState.cropId && !selectedGrowerCropId) {
      nextErrors.cropId = 'Crop is required';
    }

    const quantity = Number(formState.quantityTotal);
    if (!formState.quantityTotal.trim()) {
      nextErrors.quantityTotal = 'Quantity is required';
    } else if (Number.isNaN(quantity) || quantity <= 0) {
      nextErrors.quantityTotal = 'Quantity must be greater than 0';
    }

    if (!formState.availableStart) {
      nextErrors.availableStart = 'Start time is required';
    }

    if (!formState.availableEnd) {
      nextErrors.availableEnd = 'End time is required';
    }

    if (formState.availableStart && formState.availableEnd) {
      const start = new Date(formState.availableStart);
      const end = new Date(formState.availableEnd);
      if (start > end) {
        nextErrors.availableEnd = 'End time must be after start time';
      }
    }

    const lat = Number(formState.lat);
    if (!formState.lat.trim()) {
      nextErrors.lat = 'Latitude is required';
    } else if (Number.isNaN(lat) || lat < -90 || lat > 90) {
      nextErrors.lat = 'Latitude must be between -90 and 90';
    }

    const lng = Number(formState.lng);
    if (!formState.lng.trim()) {
      nextErrors.lng = 'Longitude is required';
    } else if (Number.isNaN(lng) || lng < -180 || lng > 180) {
      nextErrors.lng = 'Longitude must be between -180 and 180';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleQuickPickChange = (quickPickId: string) => {
    setSelectedQuickPickId(quickPickId);

    if (!quickPickId) {
      return;
    }

    const selected = quickPickOptions.find((option) => option.id === quickPickId);
    if (!selected) {
      return;
    }

    setFormState((current) => ({
      ...current,
      title: selected.suggestedTitle,
      cropId: selected.cropId || '',  // Empty for user-defined crops
      growerCropId: selected.growerCropId || selected.id,  // Use growerCropId if available, otherwise the option id
      varietyId: selected.varietyId ?? '',
      unit: selected.defaultUnit ?? current.unit,
    }));

    // For catalog crops, trigger variety loading
    if (selected.cropId) {
      onCropChange(selected.cropId);
    }

    setErrors((current) => ({
      ...current,
      title: undefined,
      cropId: undefined,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!validateForm() || isOffline) {
      return;
    }

    const status: UpsertListingRequest['status'] =
      mode === 'edit' && initialListing && isListingStatus(initialListing.status)
        ? initialListing.status
        : 'active';

    const request: UpsertListingRequest = {
      title: formState.title.trim(),
      cropId: formState.cropId || undefined,  // Only include if we have a catalog crop
      growerCropId: formState.growerCropId || undefined,  // Include for user-defined crops
      quantityTotal: Number(formState.quantityTotal),
      unit: formState.unit,
      availableStart: new Date(formState.availableStart).toISOString(),
      availableEnd: new Date(formState.availableEnd).toISOString(),
      lat: Number(formState.lat),
      lng: Number(formState.lng),
      pickupLocationText: formState.pickupLocationText.trim() || undefined,
      pickupNotes: formState.pickupNotes.trim() || undefined,
      varietyId: formState.varietyId || undefined,
      status,
      pickupDisclosurePolicy: 'after_confirmed',
      contactPref: 'app_message',
    };

    await onSubmit(request);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {mode === 'create' && (
        <div className="space-y-1">
          <label htmlFor="quick-pick-select" className="text-sm font-medium text-neutral-700">
            Share something you already grow
          </label>
          <select
            id="quick-pick-select"
            value={selectedQuickPickId}
            onChange={(event) => handleQuickPickChange(event.target.value)}
            className="w-full rounded-base border-2 border-primary-200 bg-primary-50 px-4 py-2 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            disabled={isLoadingQuickPicks || quickPickOptions.length === 0}
          >
            <option value="">
              {isLoadingQuickPicks ? 'Loading your crops...' : 'Select from my crop library'}
            </option>
            {quickPickOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {!isLoadingQuickPicks && quickPickOptions.length === 0 && (
            <p className="text-sm text-neutral-600">No saved grower crops yet. Fill the form manually below.</p>
          )}
        </div>
      )}

      <Input
        label="Listing title"
        value={formState.title}
        onChange={(event) => {
          setFormState((current) => ({ ...current, title: event.target.value }));
          if (errors.title) {
            setErrors((current) => ({ ...current, title: undefined }));
          }
        }}
        placeholder="Fresh tomatoes ready this afternoon"
        required
        error={errors.title}
      />

      <div className="space-y-1">
        <label htmlFor="crop-select" className="text-sm font-medium text-neutral-700">
          Crop<span className="text-error ml-1" aria-label="required">*</span>
        </label>
        <select
          id="crop-select"
          value={formState.cropId}
          onChange={(event) => {
            const nextCrop = event.target.value;
            setFormState((current) => ({
              ...current,
              cropId: nextCrop,
              varietyId: '',
            }));
            onCropChange(nextCrop);
            if (errors.cropId) {
              setErrors((current) => ({ ...current, cropId: undefined }));
            }
          }}
          className="w-full rounded-base border-2 border-neutral-300 bg-white px-4 py-2 text-base text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          aria-invalid={!!errors.cropId}
          aria-describedby={errors.cropId ? 'crop-select-error' : undefined}
          required
        >
          <option value="">Select a crop</option>
          {crops.map((crop) => (
            <option key={crop.id} value={crop.id}>
              {crop.commonName}
            </option>
          ))}
        </select>
        {errors.cropId && (
          <p id="crop-select-error" className="text-sm text-error" role="alert">
            {errors.cropId}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="variety-select" className="text-sm font-medium text-neutral-700">
          Variety (optional)
        </label>
        <select
          id="variety-select"
          value={formState.varietyId}
          onChange={(event) => {
            setFormState((current) => ({ ...current, varietyId: event.target.value }));
          }}
          className="w-full rounded-base border-2 border-neutral-300 bg-white px-4 py-2 text-base text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          disabled={!formState.cropId || isLoadingVarieties}
        >
          <option value="">
            {isLoadingVarieties ? 'Loading varieties...' : 'No variety selected'}
          </option>
          {varieties.map((variety) => (
            <option key={variety.id} value={variety.id}>
              {variety.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="quantity-total" className="text-sm font-medium text-neutral-700">
            Quantity<span className="text-error ml-1" aria-label="required">*</span>
          </label>
          <input
            id="quantity-total"
            type="number"
            min="0"
            step="0.1"
            value={formState.quantityTotal}
            onChange={(event) => {
              setFormState((current) => ({ ...current, quantityTotal: event.target.value }));
              if (errors.quantityTotal) {
                setErrors((current) => ({ ...current, quantityTotal: undefined }));
              }
            }}
            className="w-full rounded-base border-2 border-neutral-300 bg-white px-4 py-2 text-base text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            required
            aria-invalid={!!errors.quantityTotal}
            aria-describedby={errors.quantityTotal ? 'quantity-total-error' : undefined}
          />
          {errors.quantityTotal && (
            <p id="quantity-total-error" className="text-sm text-error" role="alert">
              {errors.quantityTotal}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="unit" className="text-sm font-medium text-neutral-700">
            Unit
          </label>
          <select
            id="unit"
            value={formState.unit}
            onChange={(event) => {
              setFormState((current) => ({ ...current, unit: event.target.value }));
            }}
            className="w-full rounded-base border-2 border-neutral-300 bg-white px-4 py-2 text-base text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="lb">lb</option>
            <option value="kg">kg</option>
            <option value="bunch">bunch</option>
            <option value="item">item</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="available-start" className="text-sm font-medium text-neutral-700">
            Available from<span className="text-error ml-1" aria-label="required">*</span>
          </label>
          <input
            id="available-start"
            type="datetime-local"
            value={formState.availableStart}
            onChange={(event) => {
              setFormState((current) => ({ ...current, availableStart: event.target.value }));
              if (errors.availableStart) {
                setErrors((current) => ({ ...current, availableStart: undefined }));
              }
            }}
            className="w-full rounded-base border-2 border-neutral-300 bg-white px-4 py-2 text-base text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            required
            aria-invalid={!!errors.availableStart}
            aria-describedby={errors.availableStart ? 'available-start-error' : undefined}
          />
          {errors.availableStart && (
            <p id="available-start-error" className="text-sm text-error" role="alert">
              {errors.availableStart}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="available-end" className="text-sm font-medium text-neutral-700">
            Available until<span className="text-error ml-1" aria-label="required">*</span>
          </label>
          <input
            id="available-end"
            type="datetime-local"
            value={formState.availableEnd}
            onChange={(event) => {
              setFormState((current) => ({ ...current, availableEnd: event.target.value }));
              if (errors.availableEnd) {
                setErrors((current) => ({ ...current, availableEnd: undefined }));
              }
            }}
            className="w-full rounded-base border-2 border-neutral-300 bg-white px-4 py-2 text-base text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            required
            aria-invalid={!!errors.availableEnd}
            aria-describedby={errors.availableEnd ? 'available-end-error' : undefined}
          />
          {errors.availableEnd && (
            <p id="available-end-error" className="text-sm text-error" role="alert">
              {errors.availableEnd}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Latitude"
          value={formState.lat}
          inputMode="decimal"
          onChange={(event) => {
            setFormState((current) => ({ ...current, lat: event.target.value }));
            if (errors.lat) {
              setErrors((current) => ({ ...current, lat: undefined }));
            }
          }}
          placeholder="37.7749"
          required
          error={errors.lat}
        />
        <Input
          label="Longitude"
          value={formState.lng}
          inputMode="decimal"
          onChange={(event) => {
            setFormState((current) => ({ ...current, lng: event.target.value }));
            if (errors.lng) {
              setErrors((current) => ({ ...current, lng: undefined }));
            }
          }}
          placeholder="-122.4194"
          required
          error={errors.lng}
        />
      </div>

      <Input
        label="Pickup hint (optional)"
        value={formState.pickupLocationText}
        onChange={(event) => {
          setFormState((current) => ({ ...current, pickupLocationText: event.target.value }));
        }}
        placeholder="Front porch cooler"
      />

      <Input
        label="Pickup notes (optional)"
        value={formState.pickupNotes}
        onChange={(event) => {
          setFormState((current) => ({ ...current, pickupNotes: event.target.value }));
        }}
        placeholder="Please text before pickup"
      />

      {isOffline && (
        <p className="rounded-base border border-warning bg-accent-50 px-3 py-2 text-sm text-neutral-800" role="status">
          You are offline. Reconnect to submit this listing.
        </p>
      )}

      {submitError && (
        <p className="rounded-base border border-error bg-red-50 px-3 py-2 text-sm text-error" role="alert">
          {submitError}
        </p>
      )}

      <div className="flex gap-3">
        {mode === 'edit' && onCancelEdit && (
          <Button type="button" variant="outline" className="flex-1" onClick={onCancelEdit}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          className="flex-1"
          loading={isSubmitting}
          disabled={isSubmitting || isOffline}
        >
          {mode === 'create' ? 'Post listing' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
