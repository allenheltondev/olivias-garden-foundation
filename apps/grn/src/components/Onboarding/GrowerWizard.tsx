import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card } from '../ui/Card';
import type { GrowerProfileInput } from '../../hooks/useOnboarding';
import { logger } from '../../utils/logging';

export interface GrowerWizardProps {
  onComplete: (data: GrowerProfileInput) => Promise<void>;
  onBack?: () => void;
}

type WizardStep = 'location' | 'zone' | 'preferences';

interface FormData {
  homeZone: string;
  address: string;
  shareRadiusMiles: number;
  units: 'metric' | 'imperial';
  locale: string;
}

interface ValidationErrors {
  homeZone?: string;
  location?: string;
  shareRadiusMiles?: string;
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

export function GrowerWizard({ onComplete, onBack }: GrowerWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('location');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    homeZone: '',
    address: '',
    shareRadiusMiles: 5,
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

  const validateZone = (): boolean => {
    const newErrors: ValidationErrors = {};

    if (!formData.homeZone.trim()) {
      newErrors.homeZone = 'Growing zone is required';
    } else if (!/^[0-9]{1,2}[a-z]?$/i.test(formData.homeZone.trim())) {
      newErrors.homeZone = 'Enter a valid zone (e.g., 8a, 9b, 10)';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validatePreferences = (): boolean => {
    const newErrors: ValidationErrors = {};

    if (formData.shareRadiusMiles <= 0) {
      newErrors.shareRadiusMiles = 'Share radius must be greater than 0';
    } else if (formData.shareRadiusMiles > 100) {
      newErrors.shareRadiusMiles = 'Share radius must be 100 or less';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (currentStep === 'location') {
      if (validateLocation()) {
        setCurrentStep('zone');
      }
    } else if (currentStep === 'zone') {
      if (validateZone()) {
        setCurrentStep('preferences');
      }
    }
  };

  const handleBack = () => {
    if (currentStep === 'zone') {
      setCurrentStep('location');
    } else if (currentStep === 'preferences') {
      setCurrentStep('zone');
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
      const profileData: GrowerProfileInput = {
        homeZone: formData.homeZone.trim(),
        address: formData.address.trim(),
        shareRadiusMiles: formData.shareRadiusMiles,
        units: formData.units,
        locale: formData.locale,
      };

      await onComplete(profileData);
    } catch (error) {
      logger.error('Failed to submit grower profile', error as Error);
      setIsSubmitting(false);
    }
  };

  const steps: WizardStep[] = ['location', 'zone', 'preferences'];
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
                Where are you growing?
              </h2>
              <p className="text-neutral-600">
                Share your address so nearby neighbors can coordinate pickup safely.
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
                placeholder="123 Main St, Springfield, IL"
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

        {currentStep === 'zone' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-2xl font-semibold text-neutral-900 mb-2">
                What's your growing zone?
              </h2>
              <p className="text-neutral-600">
                This helps us provide relevant seasonal guidance.
              </p>
            </div>

            <Input
              label="USDA Hardiness Zone"
              type="text"
              value={formData.homeZone}
              onChange={(e) => {
                setFormData((prev) => ({
                  ...prev,
                  homeZone: e.target.value,
                }));
                if (errors.homeZone) {
                  setErrors((prev) => ({ ...prev, homeZone: undefined }));
                }
              }}
              placeholder="e.g., 8a, 9b, 10"
              error={errors.homeZone}
              required
            />

            <p className="text-sm text-neutral-500">
              Don't know your zone?{' '}
              <a
                href="https://planthardiness.ars.usda.gov/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 hover:text-primary-700 underline"
              >
                Find it here
              </a>
            </p>
          </div>
        )}

        {currentStep === 'preferences' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-2xl font-semibold text-neutral-900 mb-2">
                Set your preferences
              </h2>
              <p className="text-neutral-600">
                Customize how you share with your community.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-neutral-700 mb-2 block">
                  Share Radius
                  <span className="text-error ml-1" aria-label="required">*</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="50"
                    step="1"
                    value={formData.shareRadiusMiles}
                    onChange={(e) => {
                      setFormData((prev) => ({
                        ...prev,
                        shareRadiusMiles: parseInt(e.target.value, 10),
                      }));
                      if (errors.shareRadiusMiles) {
                        setErrors((prev) => ({ ...prev, shareRadiusMiles: undefined }));
                      }
                    }}
                    className="flex-1"
                    aria-label="Share radius in miles"
                  />
                  <span className="text-neutral-700 font-medium min-w-[4rem] text-right">
                    {formData.shareRadiusMiles} mi
                  </span>
                </div>
                {errors.shareRadiusMiles && (
                  <p className="text-sm text-error mt-1" role="alert">
                    {errors.shareRadiusMiles}
                  </p>
                )}
                <p className="text-sm text-neutral-500 mt-1">
                  How far you're willing to share surplus
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
