# Phase 0: Foundations - Design

## Architecture Overview

Phase 0 establishes the foundational infrastructure for the Community Food Coordination Platform. The system consists of:

1. **Frontend**: React PWA (Vite) hosted on S3/CloudFront
2. **Auth**: Cognito User Pool with JWT-based authentication
3. **API**: Rust Lambda behind API Gateway with Lambda authorizer
4. **Data**: Two DynamoDB tables (core and derived)
5. **Events**: EventBridge custom bus (infrastructure only)
6. **Observability**: Structured JSON logging with correlation IDs

## Component Design

### 1. Cognito User Pool

**Configuration:**
- Username attribute: email
- Auto-verified attributes: email
- Password policy: 8+ chars, uppercase, lowercase, numbers
- Three user groups for tier management:
  - `free-tier` (precedence 3) - free tier
  - `supporter-tier` (precedence 2) - supporter tier
  - `caretake
r.rs` (already exists, may need updates)

**Flow:**
1. Extract Authorization header from request
2. If OPTIONS request, allow through for CORS
3. Validate JWT token:
   - Fetch JWKS from Cognito
   - Verify signature, expiration, issuer
   - Validate token_use=access and client_id
4. Fetch user attributes from Cognito using access token
5. Determine user tier from Cognito groups
6. Return IAM policy with user context

**Context passed to API:**
- `userId`: JWT sub claim
- `email`: User email
- `firstName`: Given name
- `lastName`: Family name
- `tier`: User tier (neighbor/supporter/caretaker)

**Updates needed:**
- Map existing tier groups (free-tier, supporter-tier, pro-tier) to tier values
- Ensure correlation ID is extracted from headers and passed through

### 3. Rust API Lambda

**Endpoint:** `GET /me`

**Purpose:** Return authenticated user's profile information.

**Implementation:**

**File structure:**
```
backend/src/api/
â”œâ”€â”€ main.rs           # Lambda entry point
â”œâ”€â”€ router.rs         # Route handling
â”œâ”€â”€ handlers/
â”‚   â””â”€â”€ me.rs         # GET /me handler
â”œâ”€â”€ middleware/
â”‚   â””â”€â”€ correlation.rs # Correlation ID middleware
â””â”€â”€ models/
    â””â”€â”€ user.rs       # User profile model
```

**Request flow:**
1. API Gateway receives request with Authorization header
2. Lambda authorizer validates JWT and returns policy with context
3. API Gateway invokes Rust Lambda with authorizer context
4. Correlation ID middleware extracts or generates correlation ID
5. Router dispatches to GET /me handler
6. Handler extracts user info from authorizer context
7. Handler returns user profile as JSON

**Response format:**
```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "tier": "free"
}
```

**Error responses:**
- 401 Unauthorized: Missing or invalid token (handled by authorizer)
- 500 Internal Server Error: Unexpected error

**Logging:**
- Log request received with correlationId
- Log authorizer context received
- Log response sent
- Log any errors with full context

### 4. DynamoDB Tables

**Core Table:**
- Name: `${StackName}-core`
- Billing: PAY_PER_REQUEST
- Schema:
  - PK (String, Hash Key)
  - SK (String, Range Key)
- TTL: Enabled on `ttl` attribute
- Encryption: AWS managed (default)
- Point-in-time recovery: Disabled for Phase 0
- Deletion policy: Retain

**Derived Table:**
- Name: `${StackName}-derived`
- Billing: PAY_PER_REQUEST
- Schema:
  - PK (String, Hash Key)
  - SK (String, Range Key)
- TTL: Enabled on `ttl` attribute
- Encryption: AWS managed (default)
- Point-in-time recovery: Disabled for Phase 0
- Deletion policy: Retain

**Note:** Tables are created but not used in Phase 0. They will be populated in Phase 1+.

### 5. EventBridge Custom Bus

**Name:** `${StackName}-events`

**Purpose:** Central event bus for domain events emitted by the API and consumed by workers.

**Event Envelope Structure:**
```json
{
  "version": "1.0",
  "eventType": "listing.created",
  "correlationId": "uuid",
  "timestamp": "2024-01-15T10:30:00Z",
  "userId": "uuid",
  "source": "api",
  "payload": {
    // Event-specific data
  }
}
```

**Event Types (defined but not emitted in Phase 0):**
- `listing.created`
- `listing.updated`
- `listing.expired`
- `request.created`
- `request.updated`
- `commitment.created`
- `commitment.updated`
- `insight.requested`
- `insight.generated`
- `notification.requested`

**Note:** Bus is created but no events are emitted in Phase 0. Event emission begins in Phase 1.

### 6. Correlation ID Plumbing

**Purpose:** Enable end-to-end request tracing across all components.

**Implementation:**

**API Gateway:**
- Accept `X-Correlation-Id` header from client
- If not provided, generate UUID in Lambda

**Lambda Authorizer:**
- Extract correlation ID from headers
- Include in logs
- Pass to API via context (if possible) or rely on API to extract

**Rust API:**
- Extract correlation ID from `X-Correlation-Id` header
- If not present, generate new UUID
- Store in request-scoped context
- Include in all log entries
- Include in response header `X-Correlation-Id`

**EventBridge Events:**
- Include correlation ID in event envelope
- Workers can continue the trace

**Logging format:**
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "info",
  "correlationId": "uuid",
  "message": "Request received",
  "method": "GET",
  "path": "/me",
  "userId": "uuid"
}
```

### 7. Frontend PWA

**Technology Stack:**
- React 18+
- Vite 5+
- TypeScript
- AWS Amplify (for Cognito integration)
- TanStack Query (for API calls)
- Tailwind CSS (for styling)

**Project Structure:**
```
frontend/
â”œâ”€â”€ public/
â”‚   â”œâ”€â”€ manifest.json      # PWA manifest
â”‚   â””â”€â”€ icons/             # App icons
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ main.tsx           # Entry point
â”‚   â”œâ”€â”€ App.tsx            # Root component
â”‚   â”œâ”€â”€ config/
â”‚   â”‚   â””â”€â”€ amplify.ts     # Amplify configuration
â”‚   â”œâ”€â”€ components/
â”‚   â”‚   â”œâ”€â”€ Auth/
â”‚   â”‚   â”‚   â””â”€â”€ SignIn.tsx # Sign-in component
â”‚   â”‚   â””â”€â”€ Profile/
â”‚   â”‚       â””â”€â”€ ProfileView.tsx # Profile display
â”‚   â”œâ”€â”€ hooks/
â”‚   â”‚   â””â”€â”€ useAuth.ts     # Auth hook
â”‚   â”œâ”€â”€ services/
â”‚   â”‚   â””â”€â”€ api.ts         # API client
â”‚   â””â”€â”€ types/
â”‚       â””â”€â”€ user.ts        # User type definitions
â”œâ”€â”€ vite.config.ts         # Vite configuration
â”œâ”€â”€ vite-plugin-pwa.config.ts # PWA plugin config
â””â”€â”€ package.json
```

**Key Features:**

**PWA Configuration:**
- Service worker for offline capability (basic)
- Web app manifest with app name, icons, theme color
- Installable to home screen
- Responsive design (mobile-first)

**Authentication Flow:**
1. User lands on app
2. If not authenticated, show sign-in screen
3. User signs in via Cognito hosted UI or custom form
4. App receives JWT tokens
5. App stores tokens securely
6. App calls GET /me to fetch profile
7. App displays profile information

**API Client:**
- Axios or fetch wrapper
- Automatically includes Authorization header with JWT
- Automatically includes X-Correlation-Id header
- Handles 401 errors by redirecting to sign-in
- Handles network errors gracefully

**State Management:**
- React Context for auth state
- TanStack Query for server state (user profile)
- Local state for UI

### 8. CloudFront Distribution

**Configuration:**
- Origin: S3 bucket with OAC
- Default root object: index.html
- Custom error responses: 403/404 â†' 200 /index.html (SPA routing)
- HTTPS only (redirect HTTP to HTTPS)
- Security headers policy:
  - Strict-Transport-Security
  - X-Content-Type-Options
  - X-Frame-Options: DENY
  - X-XSS-Protection
  - Referrer-Policy
- Compression enabled
- HTTP/2 enabled

**Custom Domain (Optional):**
- ACM certificate for custom domain
- Route53 A record pointing to CloudFront
- Configured via template parameters

### 9. SAM Template Updates

**New Resources:**
- `DerivedTable`: DynamoDB table for derived data
- `EventBus`: EventBridge custom bus
- `EventBusPolicy`: Allow API Lambda to put events (for future use)

**Updated Resources:**
- `CoreTable`: Add DeletionPolicy: Retain, UpdateReplacePolicy: Retain
- `UserPool`: Add DeletionPolicy: Retain, UpdateReplacePolicy: Retain
- `ApiFunction`: Add environment variables:
  - `TABLE_NAME`: Core table name
  - `EVENT_BUS_NAME`: Event bus name
  - `CORRELATION_ID_HEADER`: X-Correlation-Id
- `ApiFunction`: Add IAM permissions:
  - DynamoDB: GetItem, PutItem, UpdateItem, Query on CoreTable
  - EventBridge: PutEvents on EventBus (for future use)

**Outputs:**
- `ApiUrl`: API Gateway endpoint URL
- `UserPoolId`: Cognito User Pool ID
- `UserPoolClientId`: Cognito User Pool Client ID
- `UserPoolDomain`: Cognito hosted UI domain
- `FrontendUrl`: CloudFront distribution URL
- `FrontendBucket`: S3 bucket name for frontend deployment
- `EventBusName`: EventBridge bus name
- `CoreTableName`: Core table name
- `DerivedTableName`: Derived table name

## Data Flow

### Sign-In and Profile Retrieval Flow

```
1. User opens PWA on phone
   â†“
2. PWA checks for auth tokens
   â†“
3. If not authenticated, redirect to Cognito sign-in
   â†“
4. User enters email/password
   â†“
5. Cognito validates credentials
   â†“
6. Cognito redirects to PWA with authorization code
   â†“
7. PWA exchanges code for JWT tokens
   â†“
8. PWA calls GET /me with JWT in Authorization header
   â†“
9. API Gateway invokes Lambda Authorizer
   â†“
10. Authorizer validates JWT and returns policy with context
    â†“
11. API Gateway invokes Rust API Lambda
    â†“
12. Rust API extracts user info from authorizer context
    â†“
13. Rust API returns user profile JSON
    â†“
14. PWA displays profile information
```

### Correlation ID Flow

```
1. PWA generates UUID for request
   â†“
2. PWA includes X-Correlation-Id header in API call
   â†“
3. API Gateway passes header to Lambda Authorizer
   â†“
4. Authorizer logs with correlation ID
   â†“
5. API Gateway passes header to Rust API Lambda
   â†“
6. Rust API extracts correlation ID
   â†“
7. Rust API includes correlation ID in all logs
   â†“
8. Rust API includes correlation ID in response header
   â†“
9. PWA receives response with correlation ID
```

## Security Considerations

### Authentication
- JWT tokens are validated for signature, expiration, and issuer
- Tokens are stored securely in browser (httpOnly cookies or secure storage)
- Refresh tokens are used to obtain new access tokens

### Authorization
- All API endpoints require authentication (except OPTIONS for CORS)
- User tier is extracted from Cognito groups
- Tier information is passed to API for future authorization checks

### Data Protection
- All data in transit uses HTTPS/TLS
- DynamoDB tables use AWS managed encryption at rest
- S3 bucket blocks public access
- CloudFront uses OAC for S3 access

### CORS
- API Gateway CORS configured for frontend domain
- OPTIONS requests bypass authentication
- Appropriate headers allowed (Authorization, X-Correlation-Id, etc.)

## Testing Strategy

### Backend Testing

**Lambda Authorizer:**
- Unit tests for JWT validation logic
- Unit tests for tier extraction from groups
- Unit tests for policy generation
- Mock Cognito API calls

**Rust API:**
- Unit tests for GET /me handler
- Unit tests for correlation ID middleware
- Unit tests for error handling
- Integration test: Deploy to AWS and call GET /me with real JWT

**Infrastructure:**
- Deploy SAM template to test AWS account
- Verify all resources are created
- Verify outputs are correct

### Frontend Testing

**Component Tests:**
- Sign-in component renders correctly
- Profile component displays user data
- Error states are handled

**Integration Tests:**
- Sign-in flow works end-to-end
- GET /me call succeeds with valid token
- GET /me call fails with invalid token
- Correlation ID is included in requests

**Manual Testing:**
- Install PWA to phone home screen
- Sign in on phone
- Verify profile displays correctly
- Verify app is responsive on phone

## Deployment Process

### Backend Deployment

1. Build Rust Lambda binaries:
   ```bash
   cd backend
   cargo lambda build --release --arm64
   ```

2. Deploy SAM template:
   ```bash
   sam deploy --guided
   ```

3. Note outputs (API URL, User Pool ID, etc.)

### Frontend Deployment

1. Configure Amplify with Cognito details:
   ```typescript
   // src/config/amplify.ts
   Amplify.configure({
     Auth: {
       region: 'us-east-1',
       userPoolId: '<from SAM output>',
       userPoolWebClientId: '<from SAM output>',
       oauth: {
         domain: '<from SAM output>',
         redirectSignIn: '<frontend URL>',
         redirectSignOut: '<frontend URL>/logout',
         responseType: 'code'
       }
     },
     API: {
       endpoints: [
         {
           name: 'api',
           endpoint: '<from SAM output>'
         }
       ]
     }
   });
   ```

2. Build frontend:
   ```bash
   cd frontend
   npm run build
   ```

3. Deploy to S3:
   ```bash
   aws s3 sync dist/ s3://<bucket-name>/ --delete
   ```

4. Invalidate CloudFront cache:
   ```bash
   aws cloudfront create-invalidation \
     --distribution-id <distribution-id> \
     --paths "/*"
   ```

### Post-Deployment

1. Create test user in Cognito console
2. Assign user to free-tier group
3. Open PWA on phone
4. Sign in with test user
5. Verify profile displays correctly
6. Check CloudWatch Logs for correlation IDs

## Correctness Properties

### Property 1: JWT Validation
**Statement:** All requests with valid JWT tokens from the configured Cognito User Pool are authorized, and all requests with invalid or missing tokens are denied (except OPTIONS).

**Test Strategy:** Property-based test with various JWT token scenarios (valid, expired, wrong issuer, wrong signature, missing, malformed).

### Property 2: Correlation ID Propagation
**Statement:** Every request either includes a correlation ID from the client or has one generated by the API, and this correlation ID appears in all log entries for that request.

**Test Strategy:** Property-based test that makes requests with and without correlation IDs, then verifies all log entries contain the expected correlation ID.

### Property 3: User Context Extraction
**Statement:** For every authenticated request, the user context (userId, email, firstName, lastName, tier) extracted by the authorizer matches the JWT token claims and Cognito user attributes.

**Test Strategy:** Property-based test with various user profiles and tier assignments, verifying the GET /me response matches the expected values.

### Property 4: CORS Preflight
**Statement:** All OPTIONS requests are allowed through without authentication and return appropriate CORS headers.

**Test Strategy:** Property-based test that sends OPTIONS requests to various paths and verifies they succeed without authentication.

### Property 5: Idempotency of Infrastructure
**Statement:** Deploying the SAM template multiple times with the same parameters results in the same infrastructure state (no duplicate resources, no errors).

**Test Strategy:** Deploy template twice, verify no errors and resource counts match.

## Open Questions

1. Should we use Cognito Hosted UI or build custom sign-in form?
   - **Decision:** Start with Hosted UI for Phase 0, can customize later

2. Should correlation IDs be UUIDs or another format?
   - **Decision:** UUIDs (v4) for simplicity and uniqueness

3. Should we store user profiles in DynamoDB or rely on Cognito?
   - **Decision:** Phase 0 relies on Cognito only. DynamoDB profiles added in Phase 1.

4. Should GET /me fetch from DynamoDB or just return authorizer context?
   - **Decision:** Phase 0 returns authorizer context only. Phase 1 adds DynamoDB lookup.

5. Should we enable CloudWatch Logs Insights or X-Ray tracing?
   - **Decision:** CloudWatch Logs only for Phase 0. X-Ray can be added later.

## Future Enhancements (Post-Phase 0)

- User registration endpoint
- Profile editing endpoint
- DynamoDB user profile storage
- Event emission from API
- Node.js workers for event processing
- Advanced PWA features (offline mode, push notifications)
- Performance optimization
- Monitoring dashboards
- Alerting
- CI/CD pipeline
- Multiple environments
