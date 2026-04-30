import { useCallback, useState } from 'react';
import { Button, Card, Input } from '@olivias/ui';
import type { GathererProfileInput } from '../../hooks/useOnboarding';
import { logger } from '../../utils/logging';
import { defaultUnitsForLocale, reverseGeocode } from '../../utils/geolocation';

export interface GathererWizardProps {
  onComplete: (data: GathererProfileInput) => Promise<void>;
  onBack?: () => void;
}

interface FormData {
  address: string;
  searchRadiusMiles: number;
  organizationAffiliation: string;
  units: 'metric' | 'imperial';
  locale: string;
}

interface ValidationErrors {
  location?: string;
  searchRadiusMiles?: string;
}

export function GathererWizard({ onComplete, onBack }: GathererWizardProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [formData, setFormData] = useState<FormData>(() => ({
    address: '',
    searchRadiusMiles: 10,
    organizationAffiliation: '',
    units: defaultUnitsForLocale(),
    locale: navigator.language || 'en-US',
  }));
  const [errors, setErrors] = useState<ValidationErrors>({});

  const requestGeolocation = useCallback(() => {
    if (!navigator.geolocation) {
      setErrors((prev) => ({
        ...prev,
        location: 'Location services are not available on this device',
      }));
      logger.warn('Geolocation not supported by browser');
      return;
    }

    setIsLoadingLocation(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const resolved = await reverseGeocode(latitude, longitude);

        if (resolved) {
          setFormData((prev) => ({ ...prev, address: resolved.address }));
          setErrors((prev) => ({ ...prev, location: undefined }));
          logger.info('Location-derived address obtained', { latitude, longitude });
        } else {
          setErrors((prev) => ({
            ...prev,
            location: 'Could not determine your address. Please enter it manually.',
          }));
          logger.warn('Reverse geocoding failed', { latitude, longitude });
        }

        setIsLoadingLocation(false);
      },
      (error) => {
        logger.warn('Geolocation request failed', {
          code: error.code,
          message: error.message,
        });
        setErrors((prev) => ({
          ...prev,
          location: 'Could not access your location. Please enter your address manually.',
        }));
        setIsLoadingLocation(false);
      }
    );
  }, []);

  const validate = (): boolean => {
    const newErrors: ValidationErrors = {};

    if (!formData.address.trim()) {
      newErrors.location = 'Address is required';
    } else if (formData.address.trim().length < 6) {
      newErrors.location = 'Enter a complete address';
    }

    if (formData.searchRadiusMiles <= 0) {
      newErrors.searchRadiusMiles = 'Search radius must be greater than 0';
    } else if (formData.searchRadiusMiles > 100) {
      newErrors.searchRadiusMiles = 'Search radius must be 100 or less';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const profileData: GathererProfileInput = {
        address: formData.address.trim(),
        searchRadiusMiles: formData.searchRadiusMiles,
        organizationAffiliation: formData.organizationAffiliation.trim() || undefined,
        units: formData.units,
        locale: formData.locale,
      };

      await onComplete(profileData);
    } catch (error) {
      logger.error('Failed to submit gatherer profile', error as Error);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-neutral-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md" padding="8">
        <div className="space-y-5">
          <div>
            <h2 className="text-2xl font-semibold text-neutral-900 mb-2">
              Where are you looking?
            </h2>
            <p className="text-neutral-600">
              Use your address to discover nearby food without sharing exact coordinates.
            </p>
          </div>

          <div className="space-y-3">
            <Input
              label="Address"
              type="text"
              value={formData.address}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, address: e.target.value }));
                if (errors.location) {
                  setErrors((prev) => ({ ...prev, location: undefined }));
                }
              }}
              placeholder="456 Oak Ave, Springfield, IL"
              required
              disabled={isLoadingLocation}
              error={errors.location}
            />

            <Button
              variant="outline"
              fullWidth
              onClick={requestGeolocation}
              loading={isLoadingLocation}
              disabled={isLoadingLocation}
            >
              {isLoadingLocation ? 'Finding your address...' : 'Use my current location'}
            </Button>
          </div>

          <div>
            <label className="text-sm font-medium text-neutral-700 mb-2 block">
              Search Radius
              <span className="text-error ml-1" aria-label="required">*</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="50"
                step="1"
                value={formData.searchRadiusMiles}
                onChange={(e) => {
                  setFormData((prev) => ({
                    ...prev,
                    searchRadiusMiles: parseInt(e.target.value, 10),
                  }));
                  if (errors.searchRadiusMiles) {
                    setErrors((prev) => ({ ...prev, searchRadiusMiles: undefined }));
                  }
                }}
                className="flex-1"
                aria-label="Search radius in miles"
              />
              <span className="text-neutral-700 font-medium min-w-[4rem] text-right">
                {formData.searchRadiusMiles} mi
              </span>
            </div>
            {errors.searchRadiusMiles && (
              <p className="text-sm text-error mt-1" role="alert">
                {errors.searchRadiusMiles}
              </p>
            )}
            <p className="text-sm text-neutral-500 mt-1">
              How far you're willing to travel for food
            </p>
          </div>

          <div>
            <Input
              label="Organization (Optional)"
              type="text"
              value={formData.organizationAffiliation}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  organizationAffiliation: e.target.value,
                }))
              }
              placeholder="e.g., SF Food Bank, Community Garden"
            />
            <p className="text-sm text-neutral-500 mt-1">
              If you're gathering on behalf of an organization
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-neutral-700 mb-2 block">
              Units
              <span className="text-error ml-1" aria-label="required">*</span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, units: 'metric' }))}
                className={`flex-1 px-4 py-2 rounded-base border-2 transition-all ${
                  formData.units === 'metric'
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400'
                }`}
                aria-pressed={formData.units === 'metric'}
              >
                Metric
              </button>
              <button
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, units: 'imperial' }))}
                className={`flex-1 px-4 py-2 rounded-base border-2 transition-all ${
                  formData.units === 'imperial'
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400'
                }`}
                aria-pressed={formData.units === 'imperial'}
              >
                Imperial
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-3 mt-8">
          <Button
            variant="outline"
            onClick={onBack}
            disabled={isSubmitting || !onBack}
            className="flex-1"
          >
            Back
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={isSubmitting}
            disabled={isSubmitting}
            className="flex-1"
          >
            Complete Setup
          </Button>
        </div>
      </Card>
    </div>
  );
}
