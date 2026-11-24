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

Notes:
- Postgres 19 also exists on Docker Hub; 18.7 is pinned as the previous major (assumption, confirm with Abdul).
- Docker is not pinned (not in decision D12). Tested locally with Docker Engine 29.1.2 and Compose 2.40.3.
- Pin exact versions in each `package.json`; no `^` ranges.
