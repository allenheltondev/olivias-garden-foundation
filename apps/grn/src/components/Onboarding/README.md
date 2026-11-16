# Onboarding Components

The first-run experience for a new grower, from sign-in to a garden that Today
can say something useful about.

Good Roots is grower-only: there is no participation-mode picker, and sharing
surplus is an opt-in layer available to anyone after setup.

## The flow

1. **OnboardingGuard** — wraps the authenticated routes. It shows a loader
   while the profile loads, renders `OnboardingFlow` when onboarding is
   incomplete, and otherwise renders the app.
2. **OnboardingFlow** — owns `useOnboarding`, submits the grower profile,
   refreshes the user, and opens first-plant entry for new growers who started
   on Today. Existing profiles and intended deep links retain their destination.
3. **GrowerWizard** — the setup itself:
   - a **welcome screen** that says what Good Roots is for and what happens
     next (set location → add a plant → check Today → share only if you want
     to). It sits outside the numbered progress because it is orientation, not
     a form step.
   - **Step 1 – location**, with optional geolocation and reverse geocoding.
   - **Step 2 – zone**, auto-filled from the postcode when possible.
     Organization details, share radius, and units are available in an optional
     disclosure on this step, with defaults of an individual grower, a 5-mile
     radius, and units based on device language. These can be changed in Settings.
     Nothing is shared until the grower creates an offer.
   - Failed saves keep the answers and show an error so setup can be retried.

## After the wizard

Setup does not end at the wizard. `components/FirstSteps` renders a
getting-started checklist on Today covering growing zone, first plant, garden
map, and one reminder. Its steps are derived from real records rather than a
"user clicked it" flag, so it stays honest across devices and out-of-order
setup, disappears once everything is satisfied, and can be hidden at any time.

## Tests

- `GrowerWizard.test.tsx` — welcome screen, step order, validation, submission
- `OnboardingFlow.test.tsx` — entry point and back-button behavior
- `OnboardingGuard.test.tsx` — loading, redirect, and pass-through states
- `../FirstSteps/*.test.*` — checklist derivation and panel behavior
