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

## Layout

`apps/` (api, web), `services/` (connectors, agents, chain, budget), `contracts/` (cardano, midnight), `packages/shared/`, `tools/verifier/`, `keys/` (public keys only), `docs/`.

## License

Apache 2.0, see `LICENSE`.
