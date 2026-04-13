import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card } from '../ui/Card';
import type { GathererProfileInput } from '../../hooks/useOnboarding';
import { logger } from '../../utils/logging';

export interface GathererWizardProps {
  onComplete: (data: GathererProfileInput) => Promise<void>;
  onBack?: () => void;
}

type WizardStep = 'location' | 'preferences';

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

async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`,
      {
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { display_name?: string };
    if (typeof data.display_name === 'string' && data.display_name.trim().length > 0) {
      return data.display_name;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function GathererWizard({ onComplete, onBack }: GathererWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('location');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    address: '',
    searchRadiusMiles: 10,
    organizationAffiliation: '',
    units: 'imperial',
    locale: navigator.language || 'en-US',
  });
  const [errors, setErrors] = useState<ValidationErrors>({});
  const hasRequestedLocation = useRef(false);

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
        const derivedAddress = await reverseGeocode(latitude, longitude);

        if (derivedAddress) {
          setFormData((prev) => ({
            ...prev,
            address: derivedAddress,
          }));
          setErrors((prev) => ({ ...prev, location: undefined }));
          logger.info('Location-derived address obtained', {
            latitude,
            longitude,
          });
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

  useEffect(() => {
    if (!hasRequestedLocation.current && formData.address.trim().length === 0) {
      hasRequestedLocation.current = true;
      setTimeout(() => {
        requestGeolocation();
      }, 0);
    }
  }, [formData.address, requestGeolocation]);

  const validateLocation = (): boolean => {
    const newErrors: ValidationErrors = {};

    if (!formData.address.trim()) {
      newErrors.location = 'Address is required';
    } else if (formData.address.trim().length < 6) {
      newErrors.location = 'Enter a complete address';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validatePreferences = (): boolean => {
    const newErrors: ValidationErrors = {};

    if (formData.searchRadiusMiles <= 0) {
      newErrors.searchRadiusMiles = 'Search radius must be greater than 0';
    } else if (formData.searchRadiusMiles > 100) {
      newErrors.searchRadiusMiles = 'Search radius must be 100 or less';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (currentStep === 'location') {
      if (validateLocation()) {
        setCurrentStep('preferences');
      }
    }
  };

  const handleBack = () => {
    if (currentStep === 'preferences') {
      setCurrentStep('location');
    } else if (onBack) {
      onBack();
    }
  };

  const handleSubmit = async () => {
    if (!validatePreferences()) {
      return;
    }

    if (!formData.address.trim()) {
      setErrors({ location: 'Address is required' });
      setCurrentStep('location');
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

  const steps: WizardStep[] = ['location', 'preferences'];
  const currentStepIndex = steps.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-neutral-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md" padding="8">
        <div className="mb-6">
          <div className="flex justify-between text-sm text-neutral-600 mb-2">
            <span>Step {currentStepIndex + 1} of {steps.length}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-neutral-200 rounded-full h-2">
            <div
              className="bg-primary-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>

        {currentStep === 'location' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-2xl font-semibold text-neutral-900 mb-2">
                Where are you located?
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
                  setFormData((prev) => ({
                    ...prev,
                    address: e.target.value,
                  }));
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
                {isLoadingLocation ? 'Finding your address...' : 'Use my current location (PWA)'}
              </Button>
            </div>
          </div>
        )}

        {currentStep === 'preferences' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-2xl font-semibold text-neutral-900 mb-2">
                Set your preferences
              </h2>
              <p className="text-neutral-600">
                Customize your search settings.
              </p>
            </div>

            <div className="space-y-4">
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

              <Input
                label="Organization (Optional)"
                type="text"
                value={formData.organizationAffiliation}
                onChange={(e) => {
                  setFormData((prev) => ({
                    ...prev,
                    organizationAffiliation: e.target.value,
                  }));
                }}
                placeholder="e.g., SF Food Bank, Community Garden"
              />
              <p className="text-sm text-neutral-600 mt-1">
                If you're gathering on behalf of an organization
              </p>

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
          </div>
        )}

        <div className="flex gap-3 mt-8">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={isSubmitting}
            className="flex-1"
          >
            Back
          </Button>

          {currentStep !== 'preferences' ? (
            <Button
              variant="primary"
              onClick={handleNext}
              className="flex-1"
            >
              Next
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleSubmit}
              loading={isSubmitting}
              disabled={isSubmitting}
              className="flex-1"
            >
              Complete Setup
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
