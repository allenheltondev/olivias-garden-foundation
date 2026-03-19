# Deployment Guide

This guide explains how to deploy the backend and configure the frontend using the automated deployment script.

## Prerequisites

Before running the deployment script, ensure you have the following installed:

1. **Node.js 24+** - The deployment script is written in Node.js
2. **AWS SAM CLI** - For building and deploying the backend
   ```bash
   # Via Homebrew (macOS/Linux)
   brew install aws-sam-cli
   ```
3. **AWS CLI** - For retrieving stack outputs
   ```bash
   # Via Homebrew (macOS/Linux)
   brew install awscli
   ```
4. **Rust and Cargo Lambda** - For building the Rust Lambda functions
   ```bash
   # Install Rust
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

   # Install cargo-lambda
   brew install cargo-lambda
   ```

## AWS Configuration

Configure your AWS credentials and profile:

```bash
# Configure default profile
aws configure

# Or configure a named profile
aws configure --profile sandbox
```

### SAM Configuration

The repository includes a `backend/samconfig.template.toml` file that serves as a template for SAM CLI configuration. All build and deploy flags are configured in this template to avoid CLI argument conflicts.

**For CI/CD**: The GitHub Actions workflow automatically generates `samconfig.toml` from the template by substituting environment-specific values:
- `{{STACK_NAME}}` - CloudFormation stack name (e.g., `community-garden-prod`)
- `{{REGION}}` - AWS region (e.g., `us-east-1`)
- `{{DATABASE_URL}}` - PostgreSQL connection string from secrets

The template includes all necessary flags:
- `beta_features = true` - Enables Rust cargo-lambda build method
- `cached = false` - Disables build caching in CI for clean builds
- `confirm_changeset = false` - Auto-confirms changesets in CI
- `fail_on_empty_changeset = false` - Allows deployments with no changes

**For local development**: Create your own `backend/samconfig.toml` (which is gitignored):

```toml
version = 0.1

[default.build.parameters]
beta_features = true

[default.deploy.parameters]
stack_name = "community-garden"
resolve_s3 = true
s3_prefix = "community-garden"
region = "us-east-1"
profile = "sandbox"
capabilities = "CAPABILITY_IAM"
parameter_overrides = [
  "DatabaseUrl=postgresql://user:pass@host:5432/dbname"
]

[default.global.parameters]
region = "us-east-1"
```

The deployment script passes minimal CLI arguments and relies on `samconfig.toml` for configuration.

## Quick Start

### Deploy Everything (Build + Deploy + Configure)

```bash
# Using default profile
node deploy-and-configure.mjs

# Using a specific profile
node deploy-and-configure.mjs --profile sandbox

# Using a specific region
node deploy-and-configure.mjs --profile sandbox --region us-west-2

# Using a custom stack name
node deploy-and-configure.mjs --stack-name my-custom-stack
```

### Update Frontend Config Only

If the backend is already deployed and you just need to update the frontend `.env` file:

```bash
node deploy-and-configure.mjs --config-only --profile sandbox

# Or using the longer form:
node deploy-and-configure.mjs --skip-build --skip-deploy --profile sandbox
```

### Deploy Without Building

If you've already built the backend and just want to deploy:

```bash
node deploy-and-configure.mjs --skip-build --profile sandbox
```

## Script Options

```
usage: node deploy-and-configure.mjs [-h] [--profile PROFILE] [--region REGION]
                                     [--stack-name STACK_NAME] [--skip-build]
                                     [--skip-deploy] [--config-only] [--no-color]
                                     [--ci]

Deploy backend and configure frontend environment

optional arguments:
  --profile PROFILE     AWS profile to use (default: from samconfig.toml or default profile)
  --region REGION       AWS region (default: us-east-1)
  --stack-name STACK_NAME
                        CloudFormation stack name (default: community-garden)
  --skip-build          Skip the build step (use existing build)
  --skip-deploy         Skip deployment (only update .env from existing stack)
  --config-only         Only update frontend .env from existing stack (same as --skip-build --skip-deploy)
  --no-color            Disable colored output
  --ci                  CI mode (non-interactive)
```

## What the Script Does

1. **Checks Prerequisites** - Verifies that SAM CLI and AWS CLI are installed
2. **Builds Backend** - Runs `sam build` in the backend directory
3. **Deploys Backend** - Runs `sam deploy` with the specified profile and region
4. **Retrieves Outputs** - Gets CloudFormation stack outputs using AWS CLI
5. **Creates .env File** - Generates `frontend/.env` with the following variables:
   - `VITE_USER_POOL_ID` - Cognito User Pool ID
   - `VITE_USER_POOL_CLIENT_ID` - Cognito User Pool Client ID
   - `VITE_USER_POOL_DOMAIN` - Cognito Hosted UI Domain
   - `VITE_API_URL` - API Gateway endpoint URL
   - `VITE_FRONTEND_URL` - Frontend URL (defaults to localhost:5173 for local dev)
   - `VITE_AWS_REGION` - AWS region

## After Deployment

Once the script completes successfully:

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies (if not already done):
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser to http://localhost:5173

## Troubleshooting

### "sam: command not found"

Install AWS SAM CLI:
```bash
brew install aws-sam-cli
```

### "aws: command not found"

Install AWS CLI:
```bash
brew install awscli
```

### "No credentials found"

Configure AWS credentials:
```bash
aws configure --profile sandbox
```

### Build fails with Rust errors

Ensure Rust and cargo-lambda are installed:
```bash
# Check Rust installation
rustc --version

# Install cargo-lambda if missing
brew install cargo-lambda
```

### Stack already exists error

If you need to update an existing stack, the script will automatically update it. If you want to use a different stack name:
```bash
node deploy-and-configure.mjs --stack-name my-new-stack
```

## Manual Deployment

If you prefer to deploy manually:

### Backend

```bash
cd backend
sam build
sam deploy --profile sandbox
```

### Frontend Configuration

After deployment, manually copy the outputs from CloudFormation and update `frontend/.env`:

```bash
# Get stack outputs
aws cloudformation describe-stacks \
  --stack-name community-garden \
  --profile sandbox \
  --query 'Stacks[0].Outputs'

# Copy frontend/.env.example to frontend/.env
cp frontend/.env.example frontend/.env

# Edit frontend/.env with the output values
```

## CI/CD Integration

This script can be integrated into CI/CD pipelines. For GitHub Actions, see `.github/workflows/deploy-main.yml`.

For CI environments, use the `--ci` flag:

```bash
node deploy-and-configure.mjs --ci --region us-east-1 --stack-name community-garden-prod
```
