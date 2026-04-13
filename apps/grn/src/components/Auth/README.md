# Authentication Components

This directory contains authentication-related components for the Community Food Coordination Platform.

## SignIn Component

The `SignIn.tsx` component provides a mobile-first authentication interface for users to sign in with their email and password via AWS Cognito.

### Features

- **Mobile-First Design**: Optimized for one-handed use on phones
- **Accessible**: Proper ARIA labels, semantic HTML, keyboard navigation support
- **Touch-Friendly**: Minimum 44x44px touch targets for all interactive elements
- **Loading States**: Clear visual feedback during authentication
- **Error Handling**: User-friendly error messages for common authentication failures
- **Auto-Redirect**: Automatically redirects to profile view after successful sign-in

### Usage

```tsx
import { SignIn } from './components/Auth/SignIn';

function App() {
  return <SignIn />;
}
```

The component integrates with the `useAuth` hook to manage authentication state and automatically handles the sign-in flow.

### Styling

The component uses Tailwind CSS for styling and follows the mobile-first approach:
- Responsive layout that works on all screen sizes
- Large, easy-to-tap buttons and input fields
- Clear visual hierarchy
- Accessible color contrast ratios

### Error Messages

The component maps common Amplify authentication errors to user-friendly messages:
- Incorrect credentials
- User not found
- Too many failed attempts
- Network errors

### Phase 0 Notes

For Phase 0, users must be created manually in the Cognito console. User registration will be added in a future phase.

### Testing

To test the component locally:

1. Ensure backend is deployed and Amplify is configured with correct Cognito details
2. Create a test user in Cognito console
3. Run the frontend: `npm run dev`
4. Navigate to the sign-in page
5. Enter test user credentials

### Future Enhancements

- Password reset flow
- Multi-factor authentication
- Social sign-in providers
- Remember me functionality
- Biometric authentication for mobile
