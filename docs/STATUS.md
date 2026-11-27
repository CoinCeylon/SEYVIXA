# SEYVIXA TrustOS — Current status

Updated by Abdul. Last update: 28 Nov 2026 (from `development` after PR #52). The plan is `docs/blueprint-v4.4.md` (design) and `docs/guide.md` (who builds what). Decisions are in `docs/DECISIONS.md`. Who works on what is in `docs/prompts/README.md`. If this file disagrees with the Blueprint, the Blueprint wins.

A task is yours only when Abdul assigned it to you. When it is done, stop and report. Do not pick the next task from the guide.

## What exists in the repo

| Area | State |
|---|---|
| `apps/api` (Abdul) | Agent credentials, grants, owner session, `POST /api/actions/evaluate` with the policy check, `policy_events`, and the immutable action record (hash, salt, status, reservation binding). Only 3 routes exist: `/api/auth/login`, `/api/actions/evaluate`, `/api/agents/:id/grants`. Evaluate returns 501 for `ALLOW` until the execution ticket (T1.2c) is built. |
| `packages/shared` (Abdul) | Canonical JSON, SHA-256, zod schemas, reason codes, grant integrity tag. |
| Database | Blueprint Section 8 tables plus additive columns. Migration `0002` adds `suppliers.payee_address` and makes the action record immutable. |
| `contracts/cardano` (Afnan) | Datum spec, Aiken escrow validator, and a manual lock and release run on Preprod (evidence in `docs/evidence/`). |
| `contracts/midnight` (Afnan) | Toolchain pinned, spike deployed, credential design and the Screen 3 privacy panel lists. Midnight is at spike and design level: nothing is wired to the API. |
| `services/chain` (Divejikan) | Transaction status and `buildLockTx`. Release, refund, inspect and submit are not built. |
| `apps/web` (Shahnas, Divejikan) | Next.js app with three routes (workspace, trust, settlement), stage indicator, persistent labels, Screen 1 request form, quote table and agent feed on mock data, and the CIP-30 wallet helper. Nothing is connected to the real API yet. |
| Receipts (Divejikan) | Receipt format v0 and schema, the published receipt-signing public key (`keys/`), the key generator (`tools/keygen`), the standalone verifier (`tools/verifier`) and the tamper demo script. The receipt generator (T8.1) is not built, so there are no real receipts yet. |
| `services/agents`, `services/budget`, `services/connectors` | Empty (connectors hold only the quote fixtures and `payroll.csv`). |

## Open work

| Owner | Open |
|---|---|
| Abdul | T1.2c ticket, T1.3 execute, T1.4 connectors, T1.5, T1.6 procurement routes, T2.2 to T2.4 wallet registration and approvals, T4.1a to T4.1c budget, I2. |
| Afnan | No batch-1 task open. Abdul assigns the next one. |
| Divejikan | T8.2b (make the key generator safe), the real Preprod run for the verifier. Later: T7.4 to T7.7, T8.1, T8.6. |
| Prabhath | T0.4b seed script (no PR yet, so `pnpm seed` does not exist), then T4.2. |
| Shahnas | T10.2 interview notes. Later: Screens 2 and 3 on mock data. |

## Known gaps and risks

- **Seeded suppliers cannot yet be used for an action:** `suppliers.payee_address` is empty until the seed script sets it.
- **Server start-up must pass the escrow settings** (`escrow` option of `buildApp`). No env names exist for them yet.
- **Second public place for the receipt-key fingerprint** (slide, video or submission document) is not done. Only the README has it (Blueprint 6.8).
- **The private receipt key** must reach the server `.env` through a channel Abdul decides. Never chat or git.
- **Verifier evidence:** no real Preprod run and no stored real wallet signature yet.
- **Review:** security-critical paths (`tools/verifier`, `keys/`, `tools/keygen`, `apps/api`, `contracts/cardano`, escrow and receipt code) need a review by someone other than the author (D42). Branch protection is not set yet, so this is enforced by hand.
- **Node:** the repo pins 26.13.1. Some local runs use 24.x. Tests have not been run on 26.13.1 here.

## What is not built and must stay out

No new modules, agents, screens, networks or endpoints beyond the Blueprint. Test networks only, no real money, never commit keys or secrets.
