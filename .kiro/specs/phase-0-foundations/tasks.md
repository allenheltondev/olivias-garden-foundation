# Phase 0: Foundations - Tasks

## 1. Infrastructure Updates

### 1.1 Update SAM Template - Add Derived Table
- [x] Add DerivedTable resource to template.yaml
- [x] Configure with pk/sk schema, PAY_PER_REQUEST billing, TTL enabled
- [x] Add DeletionPolicy: Retain and UpdateReplacePolicy: Retain
- [x] Add SSESpecification for encryption
- [x] Add DerivedTableName to Outputs section

### 1.2 Update SAM Template - Add EventBridge Bus
- [x] Add EventBus resource to template.yaml
- [x] Name: `${AWS::StackName}-events`
- [x] Add EventBusName to Outputs section

### 1.3 Update SAM Template - Fix Security Issues
- [x] Add DeletionPolicy: Retain to UserPool
- [x] Add UpdateReplacePolicy: Retain to UserPool
- [x] Add DeletionPolicy: Retain to CoreTable
- [x] Add UpdateReplacePolicy: Retain to CoreTable
- [x] Add SSESpecification to CoreTable
- [x] Add BucketEncryption to FrontendBucket (AES256)
- [x] Add secure transport policy to FrontendBucketPolicy

### 1.4 Update SAM Template - API Function Configuration
- [x] Add TABLE_NAME environment variable to ApiFunction
- [x] Add EVENT_BUS_NAME environment variable to ApiFunction
- [x] Add DynamoDB permissions to ApiFunction (GetItem, PutItem, UpdateItem, Query on CoreTable)
- [x] Add EventBridge permissions to ApiFunction (PutEvents on EventBus)

### 1.5 Update SAM Template - Outputs
- [x] Add ApiUrl output
- [x] Add EventBusName output
- [x] Add CoreTableName output
- [x] Add DerivedTableName output
- [x] Ensure UserPoolId, UserPoolClientId, UserPoolDomain outputs exist
- [x] Ensure FrontendUrl and FrontendBucket outputs exist

## 2. Backend - Rust API

### 2.1 Add Dependencies to Cargo.toml
- [x] Add aws-sdk-dynamodb to dependencies
- [x] Add aws-sdk-eventbridge to dependencies
- [x] Add uuid with v4 and serde features to dependencies
- [x] Verify serde_json is available

### 2.2 Create User Model
- [x] Create `backend/src/api/models/mod.rs`
- [x] Create `backend/src/api/models/user.rs`
- [x] Define UserProfile struct with userId, email, firstName, lastName, tier
- [x] Implement Serialize for UserProfile
- [x] Add unit tests for serialization
- [x] Define UserProfile struct with userId, email, firstName, lastName, tier
- [x] Implement Serialize for UserProfile
- [x] Add unit tests for serialization

### 2.3 Create Correlation ID Middleware
- [x] Create `backend/src/api/middleware/mod.rs`
- [x] Create `backend/src/api/middleware/correlation.rs`
- [x] Implement function to extract or generate correlation ID from request
- [x] Implement function to add correlation ID to response headers
- [x] Add unit tests for correlation ID extraction and generation

### 2.4 Implement GET /me Handler
- [x] Create `backend/src/api/handlers/mod.rs`
- [x] Create `backend/src/api/handlers/me.rs`
- [x] Implement handler that extracts user info from request context
- [x] Map authorizer context fields to UserProfile struct
- [x] Return 200 with JSON profile on success
- [x] Return 500 on unexpected errors
- [x] Add structured logging

### 2.5 Create Router
- [x] Create `backend/src/api/router.rs`
- [x] Implement route matching for GET /me
- [x] Integrate correlation ID middleware
- [x] Return 404 for unknown routes

### 2.6 Update Main Entry Point
- [x] Update `backend/src/api/main.rs`
- [x] Initialize DynamoDB and EventBridge clients (for future use)
- [x] Pass clients to router via shared state
- [x] Ensure structured logging is configured correctly

### 2.7 Update Lambda Authorizer - Tier Mapping
- [x] Update `backend/src/auth/authorizer.rs` get_user_tier function
- [x] Map "free-tier" group to "free"
- [x] Map "supporter-tier" group to "supporter"
- [x] Map "pro-tier" group to "pro"
- [x] Default to "free" if no group found
- [x] Add unit tests for tier mapping

### 2.8 Backend Integration Tests
- [x] Create `backend/tests/integration_test.rs`
- [x] Test GET /me with valid authorizer context returns correct profile
- [x] Test GET /me with missing context returns error
- [x] Test correlation ID is generated when not provided
- [x] Test correlation ID is preserved when provided

## 3. Frontend - React PWA

### 3.1 Initialize Vite React Project
- [x] Run `npm create vite@latest frontend -- --template react-ts`
- [x] Install dependencies: `npm install`
- [x] Verify project runs: `npm run dev`

### 3.2 Install Required Dependencies
- [x] Install AWS Amplify: `npm install aws-amplify @aws-amplify/ui-react`
- [x] Install TanStack Query: `npm install @tanstack/react-query`
- [x] Install Axios: `npm install axios`
- [x] Install UUID: `npm install uuid @types/uuid`
- [x] Install Tailwind CSS: `npm install -D tailwindcss postcss autoprefixer`
- [x] Initialize Tailwind: `npx tailwindcss init -p`

### 3.3 Install PWA Plugin
- [x] Install vite-plugin-pwa: `npm install -D vite-plugin-pwa`
- [x] Configure PWA plugin in vite.config.ts
- [x] Create public/manifest.json with app metadata
- [x] Add app icons to public/icons/ (at least 192x192 and 512x512)

### 3.4 Configure Amplify
- [x] Create `frontend/src/config/amplify.ts`
- [x] Configure Auth with Cognito User Pool details (placeholder values)
- [x] Configure API endpoint (placeholder value)
- [x] Add instructions for updating config after deployment

### 3.5 Create Type Definitions
- [x] Create `frontend/src/types/user.ts`
- [x] Define UserProfile interface matching backend model
- [x] Export type

### 3.6 Create API Client
- [x] Create `frontend/src/services/api.ts`
- [x] Create Axios instance with base URL from config
- [x] Add request interceptor to include Authorization header with JWT
- [x] Add request interceptor to include X-Correlation-Id header
- [x] Add response interceptor to handle 401 errors
- [x] Implement getMe() function to call GET /me
- [x] Add error handling

### 3.7 Create Auth Hook
- [x] Create `frontend/src/hooks/useAuth.ts`
- [x] Use Amplify Auth to manage authentication state
- [x] Provide signIn, signOut, and user state
- [x] Handle token refresh
- [x] Export hook

### 3.8 Create Sign-In Component
- [x] Create `frontend/src/components/Auth/SignIn.tsx`
- [x] Use Amplify UI Authenticator component or custom form
- [x] Handle sign-in flow
- [x] Redirect to profile after successful sign-in
- [x] Add loading and error states
- [x] Style for mobile-first

### 3.9 Create Profile Component
- [x] Create `frontend/src/components/Profile/ProfileView.tsx`
- [x] Use TanStack Query to fetch user profile from GET /me
- [x] Display userId, email, firstName, lastName, tier
- [x] Add loading state
- [x] Add error state
- [x] Add sign-out button
- [x] Style for mobile-first

### 3.10 Create App Component
- [x] Update `frontend/src/App.tsx`
- [x] Set up TanStack Query provider
- [x] Set up Amplify configuration
- [x] Implement routing (sign-in vs profile view)
- [x] Check auth state and show appropriate component
- [x] Add basic layout and styling

### 3.11 Configure Tailwind CSS
- [x] Update `tailwind.config.js` with content paths
- [x] Add mobile-first breakpoints
- [x] Import Tailwind in `src/index.css`

### 3.12 Update Vite Configuration
- [x] Configure build output directory
- [x] Configure PWA plugin with manifest and service worker
- [x] Add environment variable support for API URL and Cognito config

### 3.13 Frontend Manual Testing
- [ ] Test app runs locally: `npm run dev`
- [ ] Test sign-in flow (will fail until backend deployed)
- [ ] Test responsive design on mobile viewport
- [ ] Test PWA installability (after build)

## 4. Deployment and Integration

### 4.1 Build and Deploy Backend
- [ ] Build Rust Lambda binaries: `cargo lambda build --release --arm64`
- [ ] Deploy SAM template: `sam deploy --guided`
- [ ] Save stack outputs (API URL, User Pool ID, etc.)
- [ ] Verify all resources created in AWS Console

### 4.2 Create Test User
- [ ] Create user in Cognito console with email/password
- [ ] Verify email address
- [ ] Add user to free-tier group
- [ ] Note credentials for testing

### 4.3 Configure Frontend with Deployed Values
- [ ] Update `frontend/src/config/amplify.ts` with actual Cognito values
- [ ] Update API endpoint with actual API Gateway URL
- [ ] Commit configuration

### 4.4 Build and Deploy Frontend
- [ ] Build frontend: `npm run build`
- [ ] Deploy to S3: `aws s3 sync dist/ s3://<bucket>/ --delete`
- [ ] Invalidate CloudFront cache
- [ ] Note CloudFront URL

### 4.5 End-to-End Testing
- [ ] Open PWA on desktop browser
- [ ] Sign in with test user
- [ ] Verify profile displays correctly
- [ ] Verify correlation ID in browser network tab
- [ ] Check CloudWatch Logs for correlation IDs in API logs
- [ ] Check CloudWatch Logs for correlation IDs in authorizer logs

### 4.6 Mobile Testing
- [ ] Open PWA on phone browser (use CloudFront URL)
- [ ] Sign in with test user
- [ ] Verify profile displays correctly on phone
- [ ] Install PWA to home screen
- [ ] Open installed PWA
- [ ] Verify functionality works from installed app
- [ ] Test touch targets are appropriately sized

### 4.7 Verify Observability
- [ ] Check CloudWatch Logs for API Lambda
- [ ] Verify logs are JSON formatted
- [ ] Verify logs include correlation IDs
- [ ] Verify logs include user context
- [ ] Check CloudWatch Logs for Authorizer Lambda
- [ ] Verify authorizer logs include correlation IDs

## 5. Documentation

### 5.1 Create Deployment Guide
- [x] Document backend deployment steps
- [x] Document frontend deployment steps
- [x] Document how to create test users
- [x] Document how to update frontend configuration
- [x] Save as `docs/phase-0-deployment.md`

### 5.2 Create Local Development Guide
- [x] Document how to run backend locally (if applicable)
- [x] Document how to run frontend locally
- [x] Document how to configure local environment
- [x] Save as `docs/phase-0-local-dev.md`

### 5.3 Update README
- [x] Add Phase 0 completion status
- [x] Link to deployment guide
- [x] Link to local development guide
- [x] Document project structure

## 6. Validation

### 6.1 Verify Exit Criteria
- [ ] Confirm: A user can be created in Cognito
- [ ] Confirm: User can sign in via PWA on phone
- [ ] Confirm: User can see profile information in PWA
- [ ] Confirm: GET /me returns correct user data
- [ ] Confirm: All logs include correlation IDs
- [ ] Confirm: Infrastructure deploys successfully via SAM
- [ ] Confirm: PWA can be installed to phone home screen

### 6.2 Verify Acceptance Criteria
- [ ] Review requirements.md acceptance criteria
- [ ] Test each criterion
- [ ] Document any deviations or issues

## Notes

- Tasks can be executed in parallel where dependencies allow
- Backend tasks (section 2) can proceed independently of frontend tasks (section 3)
- Deployment tasks (section 4) require both backend and frontend completion
- Some tasks may reveal additional work needed - update this list as needed
