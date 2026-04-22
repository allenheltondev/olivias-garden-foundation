import type { PrivacyMode } from '../hooks/useSubmissionForm';
import './PrivacySelector.css';

export interface PrivacySelectorProps {
  value: PrivacyMode;
  onChange: (mode: PrivacyMode) => void;
  disabled: boolean;
}

const OPTIONS: { mode: PrivacyMode; label: string; description: string }[] = [
  { mode: 'exact', label: 'Exact', description: 'Show your exact garden location' },
  { mode: 'nearby', label: 'Nearby', description: 'Show approximate location (within a few blocks)' },
  { mode: 'neighborhood', label: 'Neighborhood', description: 'Show neighborhood-level location' },
  { mode: 'city', label: 'City', description: 'Show city-level location only' },
];

export function PrivacySelector({ value, onChange, disabled }: PrivacySelectorProps) {
  return (
    <fieldset className="privacy-selector" disabled={disabled}>
      <legend className="privacy-selector__legend">Location privacy</legend>
      {OPTIONS.map(({ mode, label, description }) => (
        <label key={mode} className="privacy-selector__option">
          <input
            type="radio"
            name="privacy-mode"
            value={mode}
            checked={value === mode}
            onChange={() => onChange(mode)}
          />
          <span className="privacy-selector__copy">
            <span className="privacy-selector__label">{label}</span>
            <span className="privacy-selector__desc">{description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
