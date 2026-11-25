# Version pins

Checked on 2026-11-24 from the official sources below. Decision D12: Midnight, Aiken and Mesh pins are added by Afnan in T5.1 and T6.1, not here.

| Tool | Pinned version | Source |
|---|---|---|
| Node.js (LTS) | 26.13.1 ("Lithium", LTS) | https://nodejs.org/dist/index.json |
| TypeScript | 7.0.2 | https://www.npmjs.com/package/typescript |
| pnpm | 12.23.0 | https://www.npmjs.com/package/pnpm |
| Fastify | 5.12.8 | https://www.npmjs.com/package/fastify |
| zod | 4.6.7 | https://www.npmjs.com/package/zod |
| Next.js | 16.4.6 | https://www.npmjs.com/package/next |
| Tailwind CSS | 4.3.5 | https://www.npmjs.com/package/tailwindcss |
| Postgres image | `postgres:18.7-alpine` | https://hub.docker.com/_/postgres |
| @types/node (Node type definitions, type checking only) | 26.6.6 | https://www.npmjs.com/package/@types/node |
| pg (node-postgres, used by `scripts/migrate.mjs`, D25) | 8.23.1 | https://www.npmjs.com/package/pg |
| Compact Devtools (`compact` CLI, T5.1) | 0.5.3 | https://docs.midnight.network |
| Compact Toolchain (`compact compile`, Language `0.28.0`, T5.1) | 0.36.0 | https://docs.midnight.network |
| `@midnight-ntwrk/compact-runtime` (T5.1) | 0.21.0 | https://docs.midnight.network |
| `@midnight-ntwrk/compact-js` (T5.1) | 3.0.0 | https://docs.midnight.network |
| `@midnight-ntwrk/midnight-js` (T5.1) | 5.0.0 | https://docs.midnight.network |
| `@midnight-ntwrk/platform-js` (T5.1) | 3.0.0 | https://docs.midnight.network |
| `@midnight-ntwrk/wallet-sdk` (T5.1) | 2.0.0 | https://docs.midnight.network |
| Midnight Proof Server (`midnightntwrk/proof-server`, T5.1) | 9.0.2 | https://docs.midnight.network |

Notes:
- Postgres 19 also exists on Docker Hub. 18.7 is kept on purpose: the previous major, enough for everything we use.
- Docker is not pinned (not in decision D12). Tested locally with Docker Engine 29.1.2 and Compose 2.40.3.
- `engines.node` in the root `package.json` is a minimum (`>=26.13.1`) by design; the pinned version above is what we test with.
- The Postgres image must be 13 or newer (D25); `pnpm migrate` checks this.
- Pin exact versions in each `package.json`; no `^` ranges.
