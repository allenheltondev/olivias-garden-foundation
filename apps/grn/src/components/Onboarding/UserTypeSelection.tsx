import { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import type { UserType } from '../../types/user';

export interface UserTypeSelectionProps {
  onSelect: (userType: UserType) => Promise<void>;
}

/**
 * UserTypeSelection Component
 *
 * Displays participation mode selection for new users.
 * Presents two clear options: Grower or Gatherer with human-readable descriptions.
 *
 * Features:
 * - Two interactive cards for user type selection
 * - Clear descriptions for each participation mode
 * - Visual feedback for selection
 * - Prevents proceeding without selection
 * - Accessible keyboard navigation
 */
export function UserTypeSelection({ onSelect }: UserTypeSelectionProps) {
  const [selectedType, setSelectedType] = useState<UserType | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCardClick = (type: UserType) => {
    if (!isSubmitting) {
      setSelectedType(type);
      setError(null);
    }
  };

  const handleContinue = async () => {
    if (!selectedType) {
      setError('Please select how you want to participate');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onSelect(selectedType);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save selection. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-neutral-50 to-neutral-100 px-4 py-8">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-neutral-900 mb-3">
            Welcome to Good Roots Network
          </h1>
          <p className="text-lg text-neutral-600">
            How would you like to participate?
          </p>
        </div>

        {/* Selection Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Grower Card */}
          <Card
            elevation={selectedType === 'grower' ? 'lg' : 'base'}
            padding="6"
            interactive
            onClick={() => handleCardClick('grower')}
            className={`
              border-2 transition-all
              ${selectedType === 'grower'
                ? 'border-primary-600 ring-2 ring-primary-200'
                : 'border-transparent hover:border-primary-300'
              }
              ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            role="button"
            tabIndex={0}
            aria-pressed={selectedType === 'grower'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleCardClick('grower');
              }
            }}
          >
            <div className="text-center">
              {/* Icon */}
              <div className="mb-4 flex justify-center">
                <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-primary-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                    />
                  </svg>
                </div>
              </div>

              {/* Title */}
              <h2 className="text-xl font-semibold text-neutral-900 mb-2">
                I'm a Grower
              </h2>

              {/* Description */}
              <p className="text-neutral-600 text-sm leading-relaxed">
                I grow food and want to share my surplus with the community.
                I'll post what's available from my garden.
              </p>

              {/* Selected Indicator */}
              {selectedType === 'grower' && (
                <div className="mt-4 flex items-center justify-center text-primary-600">
                  <svg
                    className="w-5 h-5 mr-1"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm font-medium">Selected</span>
                </div>
              )}
            </div>
          </Card>

          {/* Gatherer Card */}
          <Card
            elevation={selectedType === 'gatherer' ? 'lg' : 'base'}
            padding="6"
            interactive
            onClick={() => handleCardClick('gatherer')}
            className={`
              border-2 transition-all
              ${selectedType === 'gatherer'
                ? 'border-primary-600 ring-2 ring-primary-200'
                : 'border-transparent hover:border-primary-300'
              }
              ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            role="button"
            tabIndex={0}
            aria-pressed={selectedType === 'gatherer'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleCardClick('gatherer');
              }
            }}
          >
            <div className="text-center">
              {/* Icon */}
              <div className="mb-4 flex justify-center">
                <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-primary-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </div>
              </div>

              {/* Title */}
              <h2 className="text-xl font-semibold text-neutral-900 mb-2">
                I'm a Gatherer
              </h2>

              {/* Description */}
              <p className="text-neutral-600 text-sm leading-relaxed">
                I'm looking for locally grown food in my community.
                I'll search for and collect available produce.
              </p>

              {/* Selected Indicator */}
              {selectedType === 'gatherer' && (
                <div className="mt-4 flex items-center justify-center text-primary-600">
                  <svg
                    className="w-5 h-5 mr-1"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm font-medium">Selected</span>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Error Message */}
        {error && (
          <div
            className="mb-4 p-4 bg-red-50 border border-red-200 rounded-base text-red-700 text-sm"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Continue Button */}
        <div className="flex justify-center">
          <Button
            variant="primary"
            size="lg"
            onClick={handleContinue}
            disabled={!selectedType || isSubmitting}
            loading={isSubmitting}
            className="min-w-[200px]"
          >
            Continue
          </Button>
        </div>

        {/* Helper Text */}
        <p className="text-center text-sm text-neutral-500 mt-6">
          You can update your participation mode later in your profile settings
        </p>
      </div>
    </div>
  );
}
