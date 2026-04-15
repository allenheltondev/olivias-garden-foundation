export interface SubmitSectionProps {
  canSubmit: boolean;
  isSubmitting: boolean;
  missingFields: string[];
  submitError: string | null;
  onSubmit: () => void;
}

const styles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.75rem',
  },
  buttonEnabled: {
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    fontWeight: 600,
    fontFamily: 'inherit',
    border: 'none',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    backgroundColor: '#3f7d3a',
    color: '#fff',
    opacity: 1,
    transition: 'background-color 0.15s',
  },
  buttonDisabled: {
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    fontWeight: 600,
    fontFamily: 'inherit',
    border: 'none',
    borderRadius: '0.5rem',
    cursor: 'not-allowed',
    backgroundColor: '#d6d3d1',
    color: '#44403c',
    opacity: 0.6,
    transition: 'background-color 0.15s',
  },
  missingList: {
    margin: 0,
    padding: '0 0 0 1.25rem',
    fontSize: '0.875rem',
    color: '#44403c',
  },
  error: {
    margin: 0,
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    color: '#b91c1c',
    backgroundColor: '#fef2f2',
    borderRadius: '0.375rem',
    border: '1px solid #fecaca',
  },
  success: {
    margin: 0,
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    color: '#15803d',
    backgroundColor: '#f0fdf4',
    borderRadius: '0.375rem',
    border: '1px solid #bbf7d0',
  },
};

export function SubmitSection({
  canSubmit,
  isSubmitting,
  missingFields,
  submitError,
  onSubmit,
}: SubmitSectionProps) {
  const isDisabled = !canSubmit || isSubmitting;
  const feedbackId = 'submit-feedback';
  const showMissing = !canSubmit && !isSubmitting && missingFields.length > 0;

  return (
    <div style={styles.wrapper}>
      <div id={feedbackId}>
        {showMissing && (
          <ul style={styles.missingList} aria-label="Missing fields">
            {missingFields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        )}

        {submitError && (
          <p style={styles.error} role="alert">
            {submitError}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={isDisabled}
        style={isDisabled ? styles.buttonDisabled : styles.buttonEnabled}
        aria-describedby={feedbackId}
      >
        {isSubmitting ? 'Submitting…' : 'Submit your garden'}
      </button>
    </div>
  );
}
