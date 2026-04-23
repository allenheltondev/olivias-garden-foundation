import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { FormFeedback, Input } from '@olivias/ui';
import { redirectAfterAuth } from '../../auth/redirect';
import type { AuthSession } from '../../auth/session';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="og-login-page__provider-icon">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.8-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12S6.7 21.6 12 21.6c6.9 0 9.1-4.8 9.1-7.3 0-.5 0-.8-.1-1.1H12Z" />
      <path fill="#34A853" d="M2.4 12c0 5.3 4.3 9.6 9.6 9.6 4 0 6.6-1.3 8.8-3.6l-3.4-2.6c-.9.7-2.2 1.2-5.4 1.2-3.3 0-6-2.2-7-5.2l-2.6 2V12Z" />
      <path fill="#4A90E2" d="M5 14.4c-.3-.8-.4-1.6-.4-2.4s.1-1.6.4-2.4l-2.6-2C1.7 9 1.3 10.4 1.3 12s.4 3 1.1 4.4l2.6-2Z" />
      <path fill="#FBBC05" d="M12 5.8c2.3 0 3.8 1 4.7 1.8l3.4-3.3C18.6 2.9 16 2 12 2 6.7 2 2.4 6.3 2.4 11.6c0 1.6.4 3 1.1 4.4l2.6-2c1-3 3.7-5.2 7-5.2Z" />
    </svg>
  );
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validatePassword(value: string) {
  if (value.length < 8) {
    return 'Use at least 8 characters.';
  }

  if (!/[A-Z]/.test(value)) {
    return 'Include at least one uppercase letter.';
  }

  if (!/[a-z]/.test(value)) {
    return 'Include at least one lowercase letter.';
  }

  if (!/[0-9]/.test(value)) {
    return 'Include at least one number.';
  }

  if (!/[^A-Za-z0-9]/.test(value)) {
    return 'Include at least one special character.';
  }

  return null;
}

const VERIFICATION_CODE_LENGTH = 6;

function normalizeVerificationCode(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, '').slice(0, VERIFICATION_CODE_LENGTH);
}

function VerificationCodeInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const characters = Array.from({ length: VERIFICATION_CODE_LENGTH }, (_, index) => value[index] ?? '');

  const updateValue = (nextValue: string, focusIndex?: number) => {
    const normalized = normalizeVerificationCode(nextValue);
    onChange(normalized);

    if (focusIndex === undefined) {
      return;
    }

    window.requestAnimationFrame(() => {
      inputRefs.current[focusIndex]?.focus();
      inputRefs.current[focusIndex]?.select();
    });
  };

  const handleInputChange = (index: number, nextCharacter: string) => {
    const sanitized = normalizeVerificationCode(nextCharacter);
    if (!sanitized) {
      const nextChars = [...characters];
      nextChars[index] = '';
      updateValue(nextChars.join(''), index);
      return;
    }

    if (sanitized.length > 1) {
      const nextChars = [...characters];
      for (let offset = 0; offset < sanitized.length && index + offset < VERIFICATION_CODE_LENGTH; offset += 1) {
        nextChars[index + offset] = sanitized[offset] ?? '';
      }
      updateValue(nextChars.join(''), Math.min(index + sanitized.length, VERIFICATION_CODE_LENGTH - 1));
      return;
    }

    const nextChars = [...characters];
    nextChars[index] = sanitized;
    updateValue(nextChars.join(''), Math.min(index + 1, VERIFICATION_CODE_LENGTH - 1));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'Backspace' && !characters[index] && index > 0) {
      event.preventDefault();
      const nextChars = [...characters];
      nextChars[index - 1] = '';
      updateValue(nextChars.join(''), index - 1);
    }

    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      inputRefs.current[index - 1]?.focus();
    }

    if (event.key === 'ArrowRight' && index < VERIFICATION_CODE_LENGTH - 1) {
      event.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    updateValue(event.clipboardData.getData('text'), VERIFICATION_CODE_LENGTH - 1);
  };

  return (
    <div className="og-verification-code" role="group" aria-label="Verification code">
      {characters.map((character, index) => (
        <input
          key={index}
          ref={(element) => {
            inputRefs.current[index] = element;
          }}
          className="og-verification-code__slot"
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={character}
          onChange={(event) => handleInputChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          onPaste={handlePaste}
          disabled={disabled}
          aria-label={`Verification code character ${index + 1}`}
        />
      ))}
    </div>
  );
}

export function LoginPage({
  authEnabled,
  hostedUiEnabled,
  authSession,
  authBusy,
  authError,
  defaultMode,
  onStartGoogleLogin,
  onSubmitLogin,
  onSubmitSignup,
  onConfirmSignup,
  onResendSignupCode,
  onRequestPasswordReset,
  onConfirmPasswordReset,
  onNavigate,
}: {
  authEnabled: boolean;
  hostedUiEnabled: boolean;
  authSession: AuthSession | null;
  authBusy: boolean;
  authError: string | null;
  defaultMode: 'login' | 'signup';
  onStartGoogleLogin: (mode: 'login' | 'signup') => void;
  onSubmitLogin: (email: string, password: string) => Promise<AuthSession>;
  onSubmitSignup: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    newsletterOptIn: boolean,
  ) => Promise<{ userConfirmed: boolean }>;
  onConfirmSignup: (email: string, code: string) => Promise<void>;
  onResendSignupCode: (email: string) => Promise<void>;
  onRequestPasswordReset: (email: string) => Promise<void>;
  onConfirmPasswordReset: (email: string, code: string, password: string) => Promise<void>;
  onNavigate: (path: string) => void;
}) {
  const [mode, setMode] = useState<'login' | 'signup' | 'verify' | 'forgot'>(defaultMode);
  const redirectedRef = useRef(false);
  const [forgotStep, setForgotStep] = useState<'request' | 'confirm'>('request');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showPasswordHint, setShowPasswordHint] = useState(false);

  useEffect(() => {
    setMode(defaultMode);
    setForgotStep('request');
    setLocalError(null);
    setStatusMessage(null);
    setShowPasswordHint(false);
  }, [defaultMode]);

  useEffect(() => {
    if (redirectedRef.current) return;
    if (!authEnabled || authBusy || !authSession) return;
    redirectedRef.current = true;
    redirectAfterAuth(authSession, onNavigate);
  }, [authEnabled, authBusy, authSession, onNavigate]);

  const handleModeChange = (nextMode: 'login' | 'signup') => {
    setMode(nextMode);
    setForgotStep('request');
    setLocalError(null);
    setStatusMessage(null);
    setShowPasswordHint(false);
  };

  const startForgotPassword = () => {
    setMode('forgot');
    setForgotStep('request');
    setLocalError(null);
    setStatusMessage(null);
    setShowPasswordHint(false);
    setPassword('');
    setConfirmPassword('');
    setResetCode('');
  };

  const startVerification = (nextEmail: string) => {
    setMode('verify');
    setForgotStep('request');
    setEmail(nextEmail);
    setPassword('');
    setConfirmPassword('');
    setResetCode('');
    setLocalError(null);
    setStatusMessage('Enter the verification code we sent to your email.');
    setShowPasswordHint(false);
  };

  const handleResendVerification = async () => {
    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      setLocalError('Please enter a valid email address.');
      return;
    }

    setLocalError(null);
    setStatusMessage(null);

    try {
      await onResendSignupCode(trimmedEmail);
      setStatusMessage('A new verification code is on the way.');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Unable to resend the code.');
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedEmail = email.trim();
    if (!isValidEmail(trimmedEmail)) {
      setShowPasswordHint(false);
      setLocalError('Please enter a valid email address.');
      return;
    }

    if ((mode === 'login' || mode === 'signup' || (mode === 'forgot' && forgotStep === 'confirm')) && !password) {
      setShowPasswordHint(false);
      setLocalError('Password is required.');
      return;
    }

    if (mode === 'signup') {
      if (!firstName.trim()) {
        setShowPasswordHint(false);
        setLocalError('First name is required.');
        return;
      }

      if (!lastName.trim()) {
        setShowPasswordHint(false);
        setLocalError('Last name is required.');
        return;
      }

      const passwordError = validatePassword(password);
      if (passwordError) {
        setShowPasswordHint(true);
        setLocalError(passwordError);
        return;
      }

      if (password !== confirmPassword) {
        setShowPasswordHint(false);
        setLocalError('Passwords do not match.');
        return;
      }
    }

    if (mode === 'forgot' && forgotStep === 'confirm') {
      if (normalizeVerificationCode(resetCode).length !== VERIFICATION_CODE_LENGTH) {
        setShowPasswordHint(false);
        setLocalError('Enter the 6-character verification code.');
        return;
      }

      const passwordError = validatePassword(password);
      if (passwordError) {
        setShowPasswordHint(true);
        setLocalError(passwordError);
        return;
      }

      if (password !== confirmPassword) {
        setShowPasswordHint(false);
        setLocalError('Passwords do not match.');
        return;
      }
    }

    if (mode === 'verify' && normalizeVerificationCode(resetCode).length !== VERIFICATION_CODE_LENGTH) {
      setShowPasswordHint(false);
      setLocalError('Enter the 6-character verification code.');
      return;
    }

    setShowPasswordHint(false);
    setLocalError(null);
    setStatusMessage(null);

    try {
      if (mode === 'login') {
        const session = await onSubmitLogin(trimmedEmail, password);
        redirectedRef.current = true;
        redirectAfterAuth(session, onNavigate);
        return;
      }

      if (mode === 'signup') {
        const result = await onSubmitSignup(
          trimmedEmail,
          password,
          firstName.trim(),
          lastName.trim(),
          newsletterOptIn,
        );
        setFirstName('');
        setLastName('');
        setPassword('');
        setConfirmPassword('');
        setNewsletterOptIn(false);
        if (result.userConfirmed) {
          setMode('login');
          setStatusMessage('Account created. You can log in now.');
        } else {
          startVerification(trimmedEmail);
        }
        return;
      }

      if (mode === 'verify') {
        await onConfirmSignup(trimmedEmail, normalizeVerificationCode(resetCode));
        setMode('login');
        setResetCode('');
        setStatusMessage('Email verified. You can log in now.');
        return;
      }

      if (mode === 'forgot' && forgotStep === 'request') {
        await onRequestPasswordReset(trimmedEmail);
        setForgotStep('confirm');
        setPassword('');
        setConfirmPassword('');
        setStatusMessage("If there's an account for that email, we've sent a verification code.");
        return;
      }

      if (mode === 'forgot' && forgotStep === 'confirm') {
        await onConfirmPasswordReset(trimmedEmail, normalizeVerificationCode(resetCode), password);
        setMode('login');
        setForgotStep('request');
        setPassword('');
        setConfirmPassword('');
        setResetCode('');
        setStatusMessage('Password reset. You can log in with your new password now.');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Please verify your email address before logging in.') {
        startVerification(trimmedEmail);
        return;
      }

      setLocalError(error instanceof Error ? error.message : 'Unable to continue.');
    }
  };

  return (
    <section className="og-login-page">
      <div className="og-login-page__backdrop">
        <div className="og-login-page__card">
          {authEnabled ? (
            authSession ? (
              <p className="og-login-page__note" role="status" aria-live="polite">
                Redirecting...
              </p>
            ) : (
              <>
                <p className="og-login-page__eyebrow">Olivia&apos;s Garden</p>
                <h1 className="og-login-page__title">
                  {mode === 'login'
                    ? 'Welcome back!'
                    : mode === 'signup'
                      ? 'Create your account.'
                      : mode === 'verify'
                        ? 'Verify your email.'
                        : forgotStep === 'request'
                          ? 'Reset your password.'
                          : 'Choose a new password.'}
                </h1>

                {mode === 'forgot' ? (
                  <p className="og-login-page__body">
                    {forgotStep === 'request'
                      ? 'Enter your email to get a reset code.'
                      : 'Enter the code from your email and choose a new password.'}
                  </p>
                ) : null}

                {mode === 'verify' ? (
                  <p className="og-login-page__body">Enter the code from your email.</p>
                ) : null}

                {mode !== 'forgot' && mode !== 'verify' ? (
                  <div className="og-login-page__switch" role="tablist" aria-label="Authentication mode">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'login'}
                      className={`og-login-page__switch-option ${mode === 'login' ? 'is-active' : ''}`.trim()}
                      onClick={() => handleModeChange('login')}
                    >
                      Log in
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'signup'}
                      className={`og-login-page__switch-option ${mode === 'signup' ? 'is-active' : ''}`.trim()}
                      onClick={() => handleModeChange('signup')}
                    >
                      Sign up
                    </button>
                  </div>
                ) : null}

                <form className="og-login-page__form" onSubmit={handleSubmit}>
                  {mode === 'signup' ? (
                    <div className="og-login-page__field-row">
                      <Input
                        label="First name"
                        type="text"
                        autoComplete="given-name"
                        placeholder="First name"
                        value={firstName}
                        onChange={(event) => setFirstName(event.target.value)}
                        disabled={authBusy}
                      />

                      <Input
                        label="Last name"
                        type="text"
                        autoComplete="family-name"
                        placeholder="Last name"
                        value={lastName}
                        onChange={(event) => setLastName(event.target.value)}
                        disabled={authBusy}
                      />
                    </div>
                  ) : null}

                  <Input
                    label="Email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={authBusy || mode === 'verify'}
                  />

                  {mode === 'verify' ? (
                    <label className="og-login-page__field">
                      <span>Verification code</span>
                      <VerificationCodeInput value={resetCode} onChange={setResetCode} disabled={authBusy} />
                    </label>
                  ) : null}

                  {mode === 'login' || mode === 'signup' || (mode === 'forgot' && forgotStep === 'confirm') ? (
                    <div className="og-login-page__password-block">
                      <Input
                        label={mode === 'login' ? 'Password' : 'New password'}
                        type="password"
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        placeholder={mode === 'login' ? 'Enter your password' : 'Create a password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        disabled={authBusy}
                      />

                      {mode === 'login' ? (
                        <div className="og-login-page__meta-action">
                          <button type="button" className="og-login-page__link og-login-page__link--inline" onClick={startForgotPassword}>
                            Forgot password?
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {mode === 'forgot' && forgotStep === 'confirm' ? (
                    <label className="og-login-page__field">
                      <span>Verification code</span>
                      <VerificationCodeInput value={resetCode} onChange={setResetCode} disabled={authBusy} />
                    </label>
                  ) : null}

                  {mode === 'signup' || (mode === 'forgot' && forgotStep === 'confirm') ? (
                    <>
                      <Input
                        label={mode === 'signup' ? 'Confirm password' : 'Confirm new password'}
                        type="password"
                        autoComplete="new-password"
                        placeholder="Repeat your password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        disabled={authBusy}
                      />
                      {showPasswordHint ? (
                        <p className="og-login-page__hint">
                          Use at least 8 characters with uppercase, lowercase, a number, and a symbol.
                        </p>
                      ) : null}

                      {mode === 'signup' ? (
                        <label className="og-login-page__checkbox">
                          <input
                            type="checkbox"
                            checked={newsletterOptIn}
                            onChange={(event) => setNewsletterOptIn(event.target.checked)}
                            disabled={authBusy}
                          />
                          <span>Keep me updated with foundation news and occasional newsletter emails.</span>
                        </label>
                      ) : null}
                    </>
                  ) : null}

                  <div className="og-login-page__actions">
                    <button type="submit" className="og-login-page__primary" disabled={authBusy}>
                      {authBusy
                        ? mode === 'login'
                          ? 'Logging in...'
                          : mode === 'signup'
                            ? 'Creating account...'
                            : mode === 'verify'
                              ? 'Verifying...'
                              : forgotStep === 'request'
                                ? 'Sending code...'
                                : 'Resetting password...'
                        : mode === 'login'
                          ? 'Log in'
                          : mode === 'signup'
                            ? 'Sign up'
                            : mode === 'verify'
                              ? 'Verify email'
                              : forgotStep === 'request'
                                ? 'Send reset code'
                                : 'Save new password'}
                    </button>
                  </div>
                </form>

                {mode !== 'forgot' && mode !== 'verify' && hostedUiEnabled ? (
                  <div className="og-login-page__social" aria-label="Social sign-in options">
                    <div className="og-login-page__divider">
                      <span>Or sign in with</span>
                    </div>
                    <div className="og-login-page__provider-row">
                      <button
                        type="button"
                        className="og-login-page__provider-button"
                        onClick={() => onStartGoogleLogin(mode === 'signup' ? 'signup' : 'login')}
                        disabled={authBusy}
                        aria-label="Continue with Google"
                        title="Continue with Google"
                      >
                        <GoogleIcon />
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="og-login-page__footer">
                  {mode === 'verify' ? (
                    <>
                      <button type="button" className="og-login-page__link og-login-page__link--inline" onClick={handleResendVerification}>
                        Resend code
                      </button>
                      <button type="button" className="og-login-page__link og-login-page__link--inline" onClick={() => handleModeChange('login')}>
                        Back to log in
                      </button>
                    </>
                  ) : null}
                  {mode === 'forgot' ? (
                    <button type="button" className="og-login-page__link og-login-page__link--inline" onClick={() => handleModeChange('login')}>
                      Back to log in
                    </button>
                  ) : null}
                </div>
              </>
            )
          ) : (
            <>
              <p className="og-login-page__eyebrow">Olivia&apos;s Garden</p>
              <h1 className="og-login-page__title">Login unavailable.</h1>
              <p className="og-login-page__note">
                Login is not configured for this environment yet.
              </p>
              <div className="og-login-page__footer">
                <button type="button" className="og-login-page__link" onClick={() => onNavigate('/okra')}>
                  Back to the Okra Project
                </button>
              </div>
            </>
          )}

          {statusMessage ? <FormFeedback tone="success">{statusMessage}</FormFeedback> : null}
          {localError || authError ? <FormFeedback tone="error">{localError ?? authError}</FormFeedback> : null}
        </div>
      </div>
    </section>
  );
}
