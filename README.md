# SEYVIXA TrustOS

UniHack 2026 prototype (Cardano + Midnight, test networks only). A trust layer for AI agents in SME procurement. No real money is used; LKR is a simulated budget. Test ADA has no monetary value.

## Migrations (T0.2b)

With the database running and `.env` in place:

```bash
pnpm migrate
```

This applies the SQL files in `apps/api/migrations/` in filename order, each in its own transaction, and records them in `schema_migrations`. A second run applies nothing. It reads `DATABASE_URL` from `.env` and needs Postgres 13 or newer. Tested on Windows only. Migration files must not contain their own `COMMIT` or statements that cannot run inside a transaction (such as `CREATE INDEX CONCURRENTLY`).

## Web UI (T9.1, T9.1b)

Next.js web application with Tailwind CSS (pinned in `docs/VERSIONS.md`, Blueprint §4.3).

To run the web app in development mode:

```bash
pnpm --filter @seyvixa/web dev
```

The app is accessible at `http://localhost:3000`.

To build and check types:

```bash
pnpm --filter @seyvixa/web typecheck
pnpm --filter @seyvixa/web build
```

### Screens and Layout (Blueprint §4.3)

The application provides exactly three connected screens sharing a single navigation bar, workflow progress indicator, and persistent disclaimer labels:

- **Persistent Disclaimer Labels:**
  - `Simulated LKR budget — not real money`
  - `Cardano testnet — test ADA has no monetary value`
- **Workflow Stage Indicator:**
  - Six connected stages: `Request` → `Quotes` → `Eligibility` → `Approval` → `Escrow` → `Receipt`
- **Routes:**
  - `/workspace` — Procurement Workspace
  - `/trust` — Trust & Approval Centre
  - `/settlement` — Settlement & Proof Centre
