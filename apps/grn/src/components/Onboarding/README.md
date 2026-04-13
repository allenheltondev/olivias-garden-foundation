# Onboarding Components

This directory contains components for the user onboarding flow.

## OnboardingGuard

The `OnboardingGuard` component wraps the main application and enforces onboarding completion.

### Features

- Shows loading screen while fetching user data
- Redirects to OnboardingFlow if onboarding is incomplete
- Renders children (main app) if onboarding is complete

### Usage

To integrate the OnboardingGuard into the app, wrap the authenticated view:

```tsx
import { OnboardingGuard } from './components/Onboarding';

// In your App component, after authentication check:
if (isAuthenticated) {
  return (
    <OnboardingGuard>
      <ProfileView />
    </OnboardingGuard>
  );
}
```

### Implementation Status

- [x] Task 4.1: OnboardingGuard component
- [ ] Task 4.2: OnboardingFlow orchestrator component
- [ ] Task 4.3: UserTypeSelection component
- [ ] Task 4.4: GrowerWizard component
- [ ] Task 4.5: GathererWizard component

### Requirements Validated

- **Requirement 1.1**: First-time user detection
- **Requirement 1.2**: Onboarding completion check
- **Requirement 7.1**: Progressive disclosure
- **Requirement 7.2**: Blocking access until onboarding complete

## OnboardingFlow

Placeholder component for the onboarding wizard. Will be implemented in task 4.2.
