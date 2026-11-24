PROGRESSING....

## Migrations (T0.2b)

With the database running and `.env` in place:

```
pnpm migrate
```

This applies the SQL files in `apps/api/migrations/` in filename order, each in its own transaction, and records them in `schema_migrations`. A second run applies nothing. It reads `DATABASE_URL` from `.env` and needs Postgres 13 or newer. Tested on Windows only. Migration files must not contain their own `COMMIT` or statements that cannot run inside a transaction (such as `CREATE INDEX CONCURRENTLY`).
