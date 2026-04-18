# Amplify Configuration Guide

This directory contains the AWS Amplify configuration for the frontend application.

## Configuration File

`amplify.ts` - Main Amplify configuration with Cognito Auth and API Gateway settings.

## Setup Instructions

### 1. Deploy Backend Infrastructure

First, deploy the backend SAM template to get the required values:

```bash
cd services/grn-api
sam build
sam deploy --guided
```

Save the stack outputs from the deployment. You'll need:
- `UserPoolId`
- `UserPoolClientId`
- `UserPoolDomain`
- `ApiUrl`
- `FrontendUrl` (CloudFront distribution URL)

### 2. Update Configuration

You have two options for configuring the frontend:

#### Option A: Environment Variables (Recommended)

Create a `.env` file in the `apps/grn/` directory:

```env
VITE_USER_POOL_ID=us-east-1_ABC123XYZ
VITE_USER_POOL_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j1k2l3m
VITE_USER_POOL_DOMAIN=my-app-domain.auth.us-east-1.amazoncognito.com
VITE_API_URL=https://abc123xyz.execute-api.us-east-1.amazonaws.com
VITE_FRONTEND_URL=https://d123abc456xyz.cloudfront.net
VITE_AWS_REGION=us-east-1
```

#### Option B: Direct Configuration

Edit `amplify.ts` and replace the placeholder values:

```typescript
userPoolId: 'us-east-1_ABC123XYZ',
userPoolClientId: '1a2b3c4d5e6f7g8h9i0j1k2l3m',
domain: 'my-app-domain.auth.us-east-1.amazoncognito.com',
endpoint: 'https://abc123xyz.execute-api.us-east-1.amazonaws.com',
```

### 3. Update OAuth Redirect URLs

After deploying the frontend to CloudFront, you need to update the Cognito User Pool Client with the actual redirect URLs:

1. Go to AWS Cognito Console
2. Select your User Pool
3. Go to "App integration" â†' "App clients"
4. Edit your app client
5. Update "Allowed callback URLs" to include your CloudFront URL:
   - `https://d123abc456xyz.cloudfront.net`
6. Update "Allowed sign-out URLs" to include your CloudFront URL:
   - `https://d123abc456xyz.cloudfront.net`
7. Save changes

### 4. Local Development

For local development, the configuration defaults to `http://localhost:5173` for OAuth redirects.

Make sure your Cognito User Pool Client includes `http://localhost:5173` in:
- Allowed callback URLs
- Allowed sign-out URLs

### 5. Verify Configuration

After configuration, test the setup:

```bash
cd apps/grn
npm run dev
```

Open `http://localhost:5173` and try signing in. You should be redirected to the Cognito Hosted UI.

## Configuration Reference

### Auth Configuration

- `userPoolId`: The Cognito User Pool ID from SAM output
- `userPoolClientId`: The Cognito User Pool Client ID from SAM output
- `domain`: The Cognito hosted UI domain (without https://)
- `scopes`: OAuth scopes requested (openid, email, profile)
- `redirectSignIn`: URLs to redirect to after successful sign-in
- `redirectSignOut`: URLs to redirect to after sign-out
- `responseType`: OAuth response type (code for authorization code flow)

### API Configuration

- `endpoint`: The API Gateway endpoint URL from SAM output
- `region`: AWS region where resources are deployed

## Troubleshooting

### "Invalid redirect_uri" Error

This means the redirect URL in your app doesn't match what's configured in Cognito.

**Solution**: Update the Cognito User Pool Client's allowed callback URLs to include your frontend URL.

### "User pool client does not exist" Error

This means the `userPoolClientId` is incorrect.

**Solution**: Verify the client ID from SAM outputs or Cognito console.

### API Calls Failing with CORS Errors

This means the API Gateway CORS configuration doesn't allow your frontend domain.

**Solution**: Update the SAM template's CORS configuration to include your CloudFront URL.

### Environment Variables Not Loading

Vite requires environment variables to be prefixed with `VITE_`.

**Solution**: Ensure all variables in `.env` start with `VITE_` and restart the dev server.

## Security Notes

- Never commit `.env` files with real credentials to version control
- The `.env` file is already in `.gitignore`
- Use environment variables for production deployments
- Rotate credentials if accidentally exposed
