# SEYVIXA TrustOS

UniHack 2026 prototype (Cardano + Midnight, test networks only). A trust layer for AI agents in SME procurement. No real money is used; LKR is a simulated budget.

Status: repository skeleton only. No application code yet.

## Prerequisites

Pinned versions are in [docs/VERSIONS.md](docs/VERSIONS.md): Node LTS, pnpm, Docker.

## Run steps (verified)

```
pnpm install
cp .env.example .env     # then edit values locally; never commit .env
docker compose up -d db  # Postgres
```

## Networks (T0.2a)

`docker-compose.yml` defines two networks (Blueprint Section 6.2 and Section 9 item 1):

- `agent_net`: the only network the agent runtime may join.
- `internal_net` (`internal: true`): for the gateway and the connector services. No route to the host or internet.

The database is on `internal_net` and the implicit default network (so the host can reach it on `POSTGRES_PORT`). It is not on `agent_net`. Connector ports are never published to the host. Compose only creates `agent_net` once a service uses it, so it does not exist until the agent runtime is added.

Check the database: `docker compose exec db pg_isready -U seyvixa` (use the `POSTGRES_USER` value from your `.env`).

## Layout

`apps/` (api, web), `services/` (connectors, agents, chain, budget), `contracts/` (cardano, midnight), `packages/shared/`, `tools/verifier/`, `keys/` (public keys only), `docs/`.

## License

Apache 2.0, see `LICENSE`.
