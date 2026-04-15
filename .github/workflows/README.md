# GitHub Actions CI/CD Workflows

This directory contains the CI/CD pipelines for Good Roots Network.

## Workflows

### 1. Pull Request Checks (`pull-request-checks.yml`)

Runs on every pull request to `main` or `develop` branches.

**Jobs:**
- **Backend Checks**
  - Code formatting check (`cargo fmt`)
  - Linting with Clippy
  - Type checking (`cargo check`)
  - Unit tests
  - Integration tests

- **Frontend Checks**
  - ESLint linting
  - TypeScript type checking
  - Build verification

**Purpose:** Ensure code quality and prevent broken code from being merged.

**Status Badge:**
```markdown
![PR Checks](https://github.com/YOUR_ORG/YOUR_REPO/workflows/Pull%20Request%20Checks/badge.svg)
```

### 2. Deploy to AWS (`deploy-main.yml`)

Runs on:
- Every push to `main` branch (auto-deploys to dev)
- Manual trigger via workflow_dispatch (can choose environment)

**Jobs:**

1. **Lint & Test**
   - Runs all backend and frontend checks
   - Must pass before deployment proceeds

2. **Deploy Backend**
   - Builds Rust Lambda functions with cargo-lambda
   - Deploys SAM stack to AWS
   - Extracts CloudFormation outputs
   - Passes outputs to frontend deployment

3. **Deploy Frontend**
   - Creates `.env` file with backend outputs
   - Builds production frontend bundle
   - Deploys to S3 with appropriate cache headers
   - Invalidates CloudFront cache

4. **Deployment Summary**
   - Prints deployment information
   - Reports success/failure status

**Status Badge:**
```markdown
![Deploy](https://github.com/YOUR_ORG/YOUR_REPO/workflows/Deploy%20to%20AWS/badge.svg)
```

### 3. Foundation Web PR Checks (`web-pull-request-checks.yml`)

Runs on pull requests that touch the foundation site or its shared hosting stack.

**Jobs:**
- Foundation web infrastructure template validation (`infra/foundation-web/template.yaml`)
- Foundation web TypeScript check
- Foundation web production build
- Shared staging deploy for the foundation site
- PR comment with the staging URL

### 4. Deploy Foundation Web (`web-deploy.yml`)

Runs on pushes to `main` that touch the foundation site or can be triggered manually.

**Jobs:**
- Template validation
- Foundation web typecheck/build
- Root stack deploy for the foundation web shared resources
- Static asset publish to the frontend S3 bucket
- CloudFront invalidation

## Required GitHub Secrets

Configure these in your repository settings under Settings â†’ Secrets and variables â†’ Actions:

### Required for all environments:

**For shared staging deployments used by PR validation (separate AWS account recommended):**
- `AWS_STAGING_ROLE_ARN` - ARN of the IAM role for the shared staging environment
  - Example: `arn:aws:iam::111111111111:role/GitHubActionsDeploymentRole`
  - Used by: PR checks workflow, foundation web PR preview deploys

**For dev/staging/prod deployments from main branch:**
- `AWS_DEV_ROLE_ARN` - ARN of the IAM role for dev/staging deployments
  - Example: `arn:aws:iam::222222222222:role/GitHubActionsDeploymentRole`
  - Used by: Main deployment workflow (dev/staging environments)

- `AWS_PROD_ROLE_ARN` - ARN of the IAM role for production deployments
  - Example: `arn:aws:iam::333333333333:role/GitHubActionsDeploymentRole`
  - Used by: Main deployment workflow (prod environment only), foundation web production deploys

### Optional repository variables for foundation web deployments

- `FOUNDATION_WEB_DOMAIN_NAME_STAGING`
- `FOUNDATION_WEB_DOMAIN_HOSTED_ZONE_ID_STAGING`
- `FOUNDATION_WEB_DOMAIN_NAME_PROD`
- `FOUNDATION_WEB_DOMAIN_HOSTED_ZONE_ID_PROD`

If the domain variables are omitted, the foundation web workflow publishes to the CloudFront default domain exposed by the stack outputs.

### Required for production only:
- `DOMAIN_NAME` - Custom domain name (e.g., `app.example.com`)
- `HOSTED_ZONE_ID` - Route53 hosted zone ID for the domain

## Multi-Account Strategy

The workflows support deploying to different AWS accounts:

- **Shared staging PR validation** -> `AWS_STAGING_ROLE_ARN` (persistent non-prod environment)
- **Dev/Staging** -> `AWS_DEV_ROLE_ARN` (persistent non-prod environments)
- **Production** -> `AWS_PROD_ROLE_ARN` (production account with strict controls)

This separation provides:
- Cost isolation (shared staging in separate account)
- Security boundaries (production in isolated account)
- Independent IAM policies per environment type

## Setting Up AWS OIDC for GitHub Actions

The workflows use OpenID Connect (OIDC) to authenticate with AWS, which is more secure than using long-lived access keys. No AWS credentials are stored in GitHub.

### Prerequisites

You'll need:
- AWS CLI configured with admin access
- Your GitHub organization and repository name
- Your AWS account ID

### Quick Setup

Run this script for each AWS account to create the OIDC provider and deployment role:

```bash
# Set your GitHub repository details
export GITHUB_ORG="your-org"
export GITHUB_REPO="your-repo"

# For staging account (handles the shared PR-validation staging environment plus other non-prod deploys)
export ROLE_NAME="GitHubActionsStagingRole"
bash .github/setup-oidc-role.sh
# Save output as AWS_STAGING_ROLE_ARN

# For production account
export ROLE_NAME="GitHubActionsProdRole"
bash .github/setup-oidc-role.sh
# Save output as AWS_PROD_ROLE_ARN
```

The script will output the role ARN to add as a GitHub secret.

### Manual Setup

If you prefer to set up manually:

#### 1. Create the OIDC Identity Provider

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

#### 2. Create IAM Role with Trust Policy

Create a file `trust-policy.json` (replace placeholders):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:YOUR_ORG/YOUR_REPO:*"
        }
      }
    }
  ]
}
```

Create the role:

```bash
aws iam create-role \
  --role-name GitHubActionsDeploymentRole \
  --assume-role-policy-document file://trust-policy.json
```

#### 3. Attach Deployment Permissions

Create a permissions policy with the required AWS permissions (see section below) and attach it:

```bash
aws iam attach-role-policy \
  --role-name GitHubActionsDeploymentRole \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/GitHubActionsDeploymentPolicy
```

#### 4. Add Role ARN to GitHub

1. Go to your repository settings: `https://github.com/YOUR_ORG/YOUR_REPO/settings/secrets/actions`
2. Click "New repository secret"
3. Add the appropriate secret based on the account:
   - For staging account: Name: `AWS_STAGING_ROLE_ARN`
   - For production account: Name: `AWS_PROD_ROLE_ARN`
4. Value: The role ARN from step 3

## Environment Configuration

The workflows support three environments:
- **dev** (default) - Development environment
- **staging** - Staging environment
- **prod** - Production environment with custom domain

Stack naming convention: `grn-{environment}`

## Manual Deployment

To manually trigger a deployment:

1. Go to Actions tab in GitHub
2. Select "Deploy to AWS" workflow
3. Click "Run workflow"
4. Choose the environment (dev/staging/prod)
5. Click "Run workflow"

## Caching Strategy

The workflows use GitHub Actions caching to speed up builds:

- **Rust dependencies:** Cached based on `Cargo.lock` hash
- **Node modules:** Cached based on `package-lock.json` hash
- **SAM build artifacts:** Cached based on service `Cargo.lock` and the relevant infrastructure template hash

## AWS Permissions Required

The AWS credentials need the following permissions:

### CloudFormation
- `cloudformation:CreateStack`
- `cloudformation:UpdateStack`
- `cloudformation:DescribeStacks`
- `cloudformation:GetTemplate`

### S3
- `s3:CreateBucket`
- `s3:PutObject`
- `s3:GetObject`
- `s3:DeleteObject`
- `s3:ListBucket`
- `s3:PutBucketPolicy`

### Lambda
- `lambda:CreateFunction`
- `lambda:UpdateFunctionCode`
- `lambda:UpdateFunctionConfiguration`
- `lambda:GetFunction`

### API Gateway
- `apigateway:*`

### Cognito
- `cognito-idp:CreateUserPool`
- `cognito-idp:UpdateUserPool`
- `cognito-idp:CreateUserPoolClient`

### DynamoDB
- `dynamodb:CreateTable`
- `dynamodb:UpdateTable`
- `dynamodb:DescribeTable`

### EventBridge
- `events:CreateEventBus`
- `events:PutRule`
- `events:PutTargets`

### CloudFront
- `cloudfront:CreateDistribution`
- `cloudfront:UpdateDistribution`
- `cloudfront:CreateInvalidation`
- `cloudfront:ListDistributions`

### IAM
- `iam:CreateRole`
- `iam:PutRolePolicy`
- `iam:AttachRolePolicy`
- `iam:PassRole`

### ACM (for custom domains)
- `acm:RequestCertificate`
- `acm:DescribeCertificate`

### Route53 (for custom domains)
- `route53:ChangeResourceRecordSets`
- `route53:GetHostedZone`

## Troubleshooting

### Build fails with "cargo-lambda not found"
The workflow installs cargo-lambda via a GitHub release action. Ensure the installation step completes successfully.

### SAM deployment fails
- Check AWS credentials are valid
- Verify the shared staging stack is not locked by an in-progress CloudFormation update
- Check CloudFormation console for detailed error messages

### Frontend deployment fails
- Ensure backend deployment completed successfully
- Verify S3 bucket was created by CloudFormation
- Check that all required outputs are available

### CloudFront invalidation fails
- This is a non-critical step and won't fail the deployment
- The distribution may take a few minutes to be available after creation
- Cache will eventually expire naturally

## Local Testing

To test the workflows locally before pushing:

### Backend checks:
```bash
cd services/grn-api
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```

### Frontend checks:
```bash
cd apps/grn
npm ci
npm run lint
npx tsc --noEmit
npm run build
```

## Workflow Optimization

Current optimizations:
- Parallel execution of backend and frontend checks in PR workflow
- Caching of dependencies and build artifacts
- Conditional deployment based on environment
- Efficient S3 sync with cache headers

Future improvements:
- Add smoke tests after deployment
- Implement blue-green deployments
- Add rollback capability
- Integrate with monitoring/alerting
