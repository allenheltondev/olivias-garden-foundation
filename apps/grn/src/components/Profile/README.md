# Profile Component

## Overview

The `ProfileView` component displays the authenticated user's profile information fetched from the `/me` API endpoint.

## Features

- **Data Fetching**: Uses TanStack Query to fetch and cache user profile data
- **Loading State**: Shows a spinner while loading profile data
- **Error State**: Displays error message with retry option
- **Sign Out**: Provides a button to sign out the user
- **Mobile-First Design**: Responsive layout optimized for mobile devices
- **Tier Display**: Shows user's membership tier with color-coded badges

## Usage

```tsx
import { ProfileView } from './components/Profile/ProfileView';

function App() {
  return <ProfileView />;
}
```

## Component Structure

### States

1. **Loading**: Displays a spinner and "Loading your profile..." message
2. **Error**: Shows error message with "Try Again" and "Sign Out" buttons
3. **Success**: Displays user profile information

### Profile Information Displayed

- User initials (avatar placeholder)
- Full name (firstName + lastName)
- Email address
- Membership tier (with color-coded badge)
- User ID (for debugging purposes)

### Tier Badges

- **Free**: Blue badge (default tier)
- **Supporter**: Purple badge
- **Pro**: Green badge

## Dependencies

- `@tanstack/react-query`: For data fetching and caching
- `../../services/api`: API client with `getMe()` function
- `../../hooks/useAuth`: Authentication hook for sign-out functionality

## Styling

- Uses Tailwind CSS for styling
- Mobile-first responsive design
- Touch-friendly button sizes (minimum 44x44px)
- Accessible color contrast ratios

## Testing

Component tests are available in `ProfileView.test.tsx` covering:
- Loading state rendering
- Successful profile display
- Error state handling
- Different tier badge displays

## Phase 0 Implementation

This component is part of Phase 0: Foundations and provides the basic profile view functionality. Future phases may extend this component with:
- Profile editing capabilities
- Additional user information
- Activity history
- Settings and preferences
