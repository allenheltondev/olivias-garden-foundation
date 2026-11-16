import { useCallback, useState } from 'react';
import { Button, Card, Input } from '@olivias/ui';
import type { GrowerProfileInput } from '../../hooks/useOnboarding';
import { logger } from '../../utils/logging';
import {
  defaultUnitsForLocale,
  lookupHardinessZone,
  reverseGeocode,
} from '../../utils/geolocation';

export interface GrowerWizardProps {
  onComplete: (data: GrowerProfileInput) => Promise<void>;
  onBack?: () => void;
}

type WizardStep = 'welcome' | 'location' | 'zone';

/**
 * What a new grower can expect, in the order it happens. Setting expectations
 * up front is the cheapest fix for "I signed up — now what?", and it is also
 * where we say plainly that sharing is optional.
 */
const WHAT_HAPPENS_NEXT: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Tell us where you grow',
    body: 'Your area and growing zone make planting windows and timing advice local to you. Two questions, then you are in.',
  },
  {
    title: 'Add what you are growing',
    body: 'One plant is enough to start. You can sketch beds and add more whenever you like.',
  },
  {
    title: 'Check Today',
    body: 'A short list of what will help your garden most right now — watering, harvest windows, and ideas for the season.',
  },
  {
    title: 'Share extra food, only if you want to',
    body: 'Offering surplus to neighbors is optional and always your call. Nothing is ever shared automatically.',
  },
];

interface FormData {
  homeZone: string;
  address: string;
  shareRadiusMiles: number;
  isOrganization: boolean;
  organizationName: string;
  units: 'metric' | 'imperial';
  locale: string;
}

interface ValidationErrors {
  homeZone?: string;
  location?: string;
  shareRadiusMiles?: string;
  organizationName?: string;
}

export function GrowerWizard({ onComplete, onBack }: GrowerWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('welcome');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [zoneAutoFilled, setZoneAutoFilled] = useState(false);
  const [formData, setFormData] = useState<FormData>(() => ({
    homeZone: '',
    address: '',
    shareRadiusMiles: 5,
    isOrganization: false,
    organizationName: '',
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

        if (!resolved) {
          setErrors((prev) => ({
            ...prev,
            location: 'Could not determine your address. Please enter it manually.',
          }));
          logger.warn('Reverse geocoding failed', { latitude, longitude });
          setIsLoadingLocation(false);
          return;
        }

        setFormData((prev) => ({ ...prev, address: resolved.address }));
        setErrors((prev) => ({ ...prev, location: undefined }));
        logger.info('Location-derived address obtained', { latitude, longitude });

        if (resolved.postcode) {
          const zone = await lookupHardinessZone(resolved.postcode);
          if (zone) {
            setFormData((prev) => ({ ...prev, homeZone: zone }));
            setZoneAutoFilled(true);
            logger.info('Auto-filled hardiness zone from postcode', {
              postcode: resolved.postcode,
              zone,
            });
          }
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

    if (formData.isOrganization && !formData.organizationName.trim()) {
      newErrors.organizationName = 'Organization name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (currentStep === 'welcome') {
      setCurrentStep('location');
    } else if (currentStep === 'location') {
      if (validateLocation()) {
        setCurrentStep('zone');
      }
    }
  };

  const handleBack = () => {
    if (currentStep === 'location') {
      setCurrentStep('welcome');
    } else if (currentStep === 'zone') {
      setCurrentStep('location');
    } else if (onBack) {
      onBack();
    }
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!validateZone()) return;
    if (!validatePreferences()) {
      setPreferencesOpen(true);
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
        isOrganization: formData.isOrganization,
        organizationName: formData.organizationName.trim() || undefined,
        units: formData.units,
        locale: formData.locale,
      };

      await onComplete(profileData);
    } catch (error) {
      logger.error('Failed to submit grower profile', error as Error);
      setSubmitError(error instanceof Error ? error.message : 'Could not finish setup. Please try again.');
      setIsSubmitting(false);
    }
  };

  // The welcome screen is orientation rather than a form step, so it sits
  // outside the numbered progress.
  const steps: WizardStep[] = ['location', 'zone'];
  const currentStepIndex = steps.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  return (
    <div className="w-full flex justify-center p-4">
      <Card className="w-full max-w-md" padding="8">
        {currentStep !== 'welcome' ? (
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
                aria-label="Garden setup progress"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          </div>
        ) : null}

        {currentStep === 'welcome' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-2xl font-semibold text-neutral-900 mb-2">
                Welcome to Good Roots
              </h2>
              <p className="text-neutral-600">
                Good Roots helps you plan a garden, keep track of what is growing, and — only if
                you want to — share extra food with neighbors nearby. Here is how it goes.
              </p>
            </div>

            <ol className="space-y-3">
              {WHAT_HAPPENS_NEXT.map((item, index) => (
                <li key={item.title} className="flex gap-3">
                  <span
                    className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary-50 text-sm font-semibold text-primary-700"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-neutral-900">{item.title}</span>
                    <span className="block text-sm text-neutral-600">{item.body}</span>
                  </span>
                </li>
              ))}
            </ol>

            <p className="text-sm text-neutral-500">
              Two questions, then add your first plant. Your address, growing zone, and preferences can
              be updated later in Settings, so nothing here is permanent.
            </p>
          </div>
        )}

        {currentStep === 'location' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-2xl font-semibold text-neutral-900 mb-2">
                Where are you growing?
              </h2>
              <p className="text-neutral-600">
                Your growing location helps us provide local planting guidance. Sharing food is optional.
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
                {isLoadingLocation ? 'Finding your address...' : 'Use my current location'}
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
                {zoneAutoFilled
                  ? 'We auto-detected your zone from your address. Edit it if it looks wrong.'
                  : 'This helps us provide relevant seasonal guidance.'}
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
                setZoneAutoFilled(false);
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

        {currentStep === 'zone' && (
          <details
            className="mt-6 rounded-base border border-neutral-200 p-4"
            open={preferencesOpen}
            onToggle={(event) => setPreferencesOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer font-medium text-primary-800">Optional preferences and organization details</summary>
            <div className="space-y-4 mt-4">
              <div>
                <h2 className="text-2xl font-semibold text-neutral-900 mb-2">
                  Make it yours
                </h2>
                <p className="text-neutral-600">
                  Start with a 5-mile sharing radius and units based on your device language.
                  Adjust these now or later in Settings. Nothing is shared until you create an offer.
                </p>
              </div>

              <div className="space-y-4">
                <div className="rounded-base border border-neutral-200 bg-white p-4">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={formData.isOrganization}
                      onChange={(e) => {
                        const isOrganization = e.target.checked;
                        setFormData((prev) => ({
                          ...prev,
                          isOrganization,
                          organizationName: isOrganization ? prev.organizationName : '',
                        }));
                        if (errors.organizationName) {
                          setErrors((prev) => ({ ...prev, organizationName: undefined }));
                        }
                      }}
                      className="mt-1 h-4 w-4 rounded border-neutral-300 text-primary-600"
                    />
                    <span>
                      <span className="block text-sm font-medium text-neutral-900">
                        We are growing as an organization
                      </span>
                      <span className="block text-sm text-neutral-600">
                        Use this for community gardens, schools, churches, food pantries, and other groups sharing surplus together.
                      </span>
                    </span>
                  </label>
                </div>

                {formData.isOrganization && (
                  <Input
                    label="Organization name"
                    type="text"
                    value={formData.organizationName}
                    onChange={(e) => {
                      setFormData((prev) => ({
                        ...prev,
                        organizationName: e.target.value,
                      }));
                      if (errors.organizationName) {
                        setErrors((prev) => ({ ...prev, organizationName: undefined }));
                      }
                    }}
                    placeholder="North Austin Community Garden"
                    error={errors.organizationName}
                    required
                  />
                )}

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
                    How far away neighbors will see your listings
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
          </details>
        )}

        {submitError ? <p className="mt-4 text-sm text-error" role="alert">{submitError}</p> : null}

        <div className="flex gap-3 mt-8">
          {currentStep !== 'welcome' || onBack ? (
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={isSubmitting}
              className="flex-1"
            >
              Back
            </Button>
          ) : null}

          {currentStep !== 'zone' ? (
            <Button
              variant="primary"
              onClick={handleNext}
              className="flex-1"
            >
              {currentStep === 'welcome' ? 'Set up my garden' : 'Next'}
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
