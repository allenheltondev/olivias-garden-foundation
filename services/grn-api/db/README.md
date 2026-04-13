# Database schema and migrations

## Source of truth
- `ddl.sql` contains the full schema definition for the Community Garden Postgres database.

## Migrations
- Migration scripts are stored in `services/grn-api/db/migrations`.
- `services/grn-api/db/migrate.sh` applies migrations in filename order and records applied versions in `schema_migrations`.

### Run locally
```bash
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/community_garden'
./services/grn-api/db/migrate.sh
```

### CI behavior
PR checks now start a Postgres service and run `./db/migrate.sh` from the `services/grn-api` directory before linting and tests.
