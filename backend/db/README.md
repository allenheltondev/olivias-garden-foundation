# Database schema and migrations

## Source of truth
- `ddl.sql` contains the full schema definition for the Community Garden Postgres database.

## Migrations
- Migration scripts are stored in `backend/db/migrations`.
- Migration runner scripts apply migrations in filename order and record applied versions in `schema_migrations`.

### Check migration status

**Linux/Mac:**
```bash
export DATABASE_URL='postgres://user:pass@host/db'
./backend/db/check-migrations.sh
```

**Windows (PowerShell):**
```powershell
$env:DATABASE_URL = 'postgres://user:pass@host/db'
.\backend\db\check-migrations.ps1
```

This will show:
- Which migrations have been applied
- Which migrations are pending
- When each migration was applied

### Run migrations locally

**Linux/Mac:**
```bash
export DATABASE_URL='postgres://user:pass@host/db'
./backend/db/migrate.sh
```

**Windows (PowerShell):**
```powershell
$env:DATABASE_URL = 'postgres://user:pass@host/db'
.\backend\db\migrate.ps1
```

The script will:
- Create the `schema_migrations` table if it doesn't exist
- Apply any pending migrations in order
- Skip migrations that have already been applied
- Skip test migrations (files starting with `test_`)

### CI behavior
PR checks start a Postgres service and run `./db/migrate.sh` from the `backend` directory before linting and tests.

### Troubleshooting

**"psql: command not found" or "psql is not recognized"**
Install PostgreSQL client tools:
- Mac: `brew install postgresql`
- Ubuntu/Debian: `sudo apt-get install postgresql-client`
- Windows: Install from [postgresql.org](https://www.postgresql.org/download/windows/)
  - After installation, add `C:\Program Files\PostgreSQL\16\bin` to your PATH
  - Or use the SQL Shell (psql) that comes with the installer

**"DATABASE_URL must be set"**
Set your database connection string:

Linux/Mac:
```bash
export DATABASE_URL='postgres://username:password@host:port/database'
```

Windows (PowerShell):
```powershell
$env:DATABASE_URL = 'postgres://username:password@host:port/database'
```

Windows (CMD):
```cmd
set DATABASE_URL=postgres://username:password@host:port/database
```

**Check if a specific migration was applied**
```bash
psql "$DATABASE_URL" -c "select * from schema_migrations where version = '0021_user_experience_levels.sql'"
```
