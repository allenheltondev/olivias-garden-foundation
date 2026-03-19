# Neon Database Setup Guide

This project uses Neon Postgres for database storage. Follow these steps to configure your database.

## 1. Create Neon Database

1. Go to [Neon Console](https://console.neon.tech)
2. Create a new project or use an existing one
3. Copy your connection string (format: `postgres://user:password@ep-xxx.region.aws.neon.tech/dbname`)

## 2. Configure GitHub Secrets

Add the following secrets to your GitHub repository:

**Settings → Secrets and variables → Actions → New repository secret**

- `DATABASE_URL_STAGING`: Your Neon connection string for staging environment
- `DATABASE_URL_PROD`: Your Neon connection string for production environment (can be the same as staging initially)

Example connection string:
```
postgres://username:password@ep-cool-mountain-123456.us-east-2.aws.neon.tech/neondb
```

## 3. Local Development Setup

For local development, set the DATABASE_URL environment variable:

```bash
# Windows (PowerShell)
$env:DATABASE_URL = "your-neon-connection-string"

# Windows (CMD)
set DATABASE_URL=your-neon-connection-string

# Linux/Mac
export DATABASE_URL='your-neon-connection-string'
```

## 4. Run Migrations Locally

```bash
cd backend
./db/migrate.sh
```

On Windows, you may need to run this in Git Bash or WSL, or use PowerShell with:
```powershell
bash ./db/migrate.sh
```

## 5. Local Deployment (Optional)

To deploy locally with your own DATABASE_URL:

```bash
node deploy-and-configure.mjs \
  --region us-east-1 \
  --stack-name community-garden-dev \
  --parameter-overrides "DatabaseUrl=your-neon-connection-string"
```

## 6. CI/CD Deployment

The GitHub Actions workflow will automatically:
1. Run migrations against your Neon database
2. Pass DATABASE_URL as a CloudFormation parameter to Lambda functions
3. Configure Lambda functions to use the database connection

The DATABASE_URL is passed as an environment variable to your Lambda functions, not stored in AWS Secrets Manager.

## What Gets Created

The migration script creates:
- All tables defined in `backend/db/migrations/0001_init.sql`
- User onboarding tables from `backend/db/migrations/0002_user_onboarding.sql`
- A `schema_migrations` table to track applied migrations

## Architecture Changes

This project has been updated to use Postgres (via Neon) instead of DynamoDB:
- ✅ Lambda functions now use DATABASE_URL environment variable
- ✅ DynamoDB tables removed from CloudFormation template
- ✅ Database connection string passed as CloudFormation parameter
- ✅ Migrations run automatically during CI/CD deployment

## Troubleshooting

### Migration fails with "psql: command not found"
Install PostgreSQL client tools:
- Windows: Install from [postgresql.org](https://www.postgresql.org/download/windows/)
- Mac: `brew install postgresql`
- Linux: `sudo apt-get install postgresql-client`

### Connection timeout
Check that your Neon database is active and the connection string is correct. Neon databases may suspend after inactivity.

### Permission denied on migrate.sh
Make the script executable:
```bash
chmod +x backend/db/migrate.sh
```

## Security Note

The DATABASE_URL contains credentials and is passed as a CloudFormation parameter. While this is simpler than Secrets Manager, be aware that:
- The connection string will be visible in CloudFormation stack parameters
- For production, consider using AWS Secrets Manager for additional security
- Ensure your GitHub secrets are properly protected
