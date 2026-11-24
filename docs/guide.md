# SEYVIXA TrustOS — Team Build Guide

**Team:** AgniX  
**Project:** SEYVIXA TrustOS (UniHack 2026, Cardano + Midnight)  
**Guide version:** 1.2 — 22 November 2026  
**Source of truth for scope and design:** `SEYVIXA_TrustOS_Focused_MVP_Blueprint_v4.4.md` (called "the Blueprint" below)

> If this guide and the Blueprint disagree, the Blueprint wins. Scope changes go through Abdul. Nothing is added to the MVP without his approval.

**What changed in guide v1.4 (24 Nov 2026, decisions D15 to D24 in `docs/DECISIONS.md`)**

| Change | Detail |
|---|---|
| Action status | `PENDING_APPROVAL` added; `actions.policy_version` added |
| Action types | Approval rules fixed per action type (D17) |
| Chain status | `getTxStatus` meaning of found and confirmed; `CONFIRMATION_DEPTH` = 3 |
| Task T2.1 | Moved from 30 Nov to 27 Nov; `getSessionOwnerId(req)` stub allowed until then and removed before 5 Dec |
| Seed command | `pnpm seed` |
| Reason code | `GRANT_INTEGRITY_FAILED` added |

**What changed in guide v1.3 (24 Nov 2026, decisions in `docs/DECISIONS.md`)**

| Change | Detail |
|---|---|
| Screen 2 feed endpoint dropped | Screen 2 data comes from the existing `GET /api/procurements/:id` |
| Reservations route defined | DB-only route for the Finance Agent; `reserve(procurementId, agentId, amountLkr, idempotencyKey)`; `actions.reservation_id` |
| Route owners | Abdul owns every `apps/api` route except `/api/suppliers/:id/verify` (Afnan), `/api/escrows*` and `GET /api/receipts/:id/verify` (Divejikan) |
| New and split tasks | T1.6, I2, I3, T8.6; letter-suffix splits T0.2a/b, T0.3a/b, T1.1a/b, T1.2a/b/c, T4.1a/b/c, T7.2a/b, T9.5a/b/c |
| Overdue | T0.1, T0.2, T0.3, T0.5 marked OVERDUE with new must-finish dates |

**What changed in guide v1.2**

| Change | Detail |
|---|---|
| Budget ownership is split cleanly | Abdul owns `reserve`, `commit`, `release` and the reservations route. Prabhath owns the read-only `getBudget` helper and the P0-3 test. No new endpoint. |
| Receipt work updated | Two receipt views, field classification, and release verification (escrow UTxO, release transaction, supplier payment). |
| Optional rejection clip | Shown only if its P1 test passed at Cardano Level 1 or 2. P0 stays at seven. |
| Claim boundary | Only AI agents are enforced today. Staff and software are a future extension. |
| Interviews | The same-controls question is added (nine questions in total). |

**What changed in guide v1.1**

| Change | Detail |
|---|---|
| Prabhath is now basic level | Agents, seed data, the budget read helper and concurrency test, and read-only Screen 2 wiring. He works from clear specs with Divejikan as mentor. |
| Budget locking logic moves to Abdul | It is tied to the gateway's transition transaction. Prabhath keeps the endpoint and the P0-3 test. |
| Seed script moves to Prabhath | Abdul writes the seed spec first. |
| Approval panel wiring moves to Divejikan | He owns the wallet helper. |
| Blueprint v4.3 items added | Delegated-authority framing, interview figures, privacy panel, on-chain rejection clip, receipt spec v0, optional break-it box. |

------------------------------------------------------------------------

## 0. How to use this guide

1.  Read Sections 1 to 5. Everyone reads these.
2.  Read your own member section in Section 6.
3.  Read the Blueprint sections listed in your member card.
4.  Follow the AI tool rules in Section 5 before you write any code.
5.  Use the timeline in Section 7 and the checklists in Section 8 to stay on track.

------------------------------------------------------------------------

## 1. The project in one page

**What we build:** SEYVIXA helps small businesses buy from suppliers safely when AI agents do the legwork. An independent gateway decides what our AI agents may do. The same model is designed to extend to staff and software later, but only AI agents are enforced in the MVP. Never describe staff or software control as built. The owner approves the exact purchase with a wallet signature. Midnight proves supplier eligibility privately. Cardano holds test ADA in escrow. A signed receipt records what happened.

**First user:** small hotels and guesthouses in Sri Lanka (a hypothesis we test with interviews).

**The demo story (about 3 minutes):**

1.  The owner creates a 100-kit request with a simulated LKR 120,000 budget.
2.  Two agents get different permissions.
3.  A supplier quote contains a malicious instruction. The Procurement Agent tries to read `payroll.csv`. The gateway blocks it.
4.  Agents compare quotes. Midnight verifies supplier eligibility without exposing the credential.
5.  Two agents try to overspend the shared budget at once. Only the valid reservation succeeds.
6.  The owner signs the approval. Cardano testnet escrow A locks and releases test ADA. A short recorded clip shows the validator rejecting a release without the buyer's signature.
7.  The receipt verifies, then fails after tampering.

**Non-negotiable rules (every member):**

-   Test networks only. No real money. Never commit seed phrases, private keys or API keys.
-   LKR is a simulated budget. Test ADA is not payment for it. Never show a conversion.
-   The gateway is the only thing that executes protected actions. Agents never hold connector credentials.
-   Label every feature for what it actually does (fallback labels in Blueprint Section 13). Never claim more than we built.
-   The escrow is a **buyer-controlled prototype**, not neutral or trustless.
-   Every interview number in the pitch must be real. Never estimate or invent one.
-   No scope creep: no new modules, agents, screens, networks or endpoints.

**Key dates:**

| Date | What |
|---|---|
| 28 Nov | Go/no-go for Midnight and Cardano (fallback level chosen). Saturday integration demo. |
| 5 Dec | Request GitHub access by this date. Saturday integration demo. |
| 12 Dec | Saturday integration demo (full dress rehearsal). |
| 13 Dec | Internal freeze. No new features. |
| 14 Dec, 12:00 noon | Submission deadline (confirm with the organisers). |
| 17 Dec | Finale at the University of Kelaniya, if selected. |

------------------------------------------------------------------------

## 2. Team, levels and tools

| Member | Level | AI tool | Main role | Features |
|---|---|---|---|---|
| **Abdul Basith** | Advanced | Claude Code | Team lead, integrator, gateway and trust core | F0, F1, F2 |
| **Afnan** | Advanced | Antigravity | Blockchain on-chain: Midnight proof and Cardano validator | F5, F6 |
| **Divejikan** | Intermediate | Antigravity | Cardano off-chain integration, wallet helper, receipt and verifier, Screen 3 and approval panel wiring; mentor for the basic members | F7, F8 |
| **Prabhath** | Basic | Antigravity | AI agents, seed data, budget read helper and concurrency test, Screen 2 read-only wiring | F3, F4 (part), F0 (seed) |
| **Shahnas** | Basic | Antigravity | Web UI shell and Screen 1, documentation, pitch support | F9, F10 |

The two **advanced** parts are the trust core (Abdul) and the on-chain work (Afnan). These carry the most technical risk. Divejikan is intermediate. Prabhath and Shahnas are basic: they work from clear specs, mock data and small tasks, and do not own security-critical code.

**Buddy system** (each pair reviews each other's pull requests and unblocks each other):

-   Shahnas and Prabhath (peer buddies, both basic level)
-   Divejikan and Afnan
-   Divejikan also mentors Shahnas and Prabhath: he reviews their pull requests and answers their questions (aim to reply within a few hours)
-   Abdul reviews every security-critical pull request (gateway, approvals, signature checks, receipt signing). Afnan reviews contract changes.

------------------------------------------------------------------------

## 3. Feature map

| ID | Feature | Blueprint | Owner | Support | Difficulty |
|---|---|---|---|---|---|
| F0 | Foundation: repo, Docker, database schema, shared types, CI (seed script: Prabhath) | 5, 8 | Abdul | Prabhath (seed), All | Medium |
| F1 | Policy gateway: grants, evaluate, execute, state machine, connector isolation | 6.1, 6.2, 7, 9 | Abdul | Prabhath | **Advanced** |
| F2 | Owner session, wallet registration, approval signature verification | 6.1, 6.5 | Abdul | Divejikan, Afnan | **Advanced** |
| F3 | Agents: Procurement (LLM), Finance (rules), quote fixtures, injection scenario | 6.3 | Prabhath | Abdul (prompt template, review), Divejikan (mentor) | Basic |
| F4 | Budget guard. **Abdul:** `BudgetGuard` (`reserve`, `commit`, `release`) and the `POST /api/budget/reservations` route. **Prabhath:** read-only `getBudget` helper and the P0-3 test | 6.4 | Abdul, Prabhath | Divejikan (mentor) | Medium |
| F5 | Midnight eligibility proof (Compact contract, issuer tool, verify) | 6.6 | Afnan | Abdul | **Advanced** |
| F6 | Cardano escrow validator (Aiken), escrow A and B on testnet | 6.7 | Afnan | Divejikan | **Advanced** |
| F7 | Cardano off-chain: transaction building, chain status, escrow prepare endpoints, wallet helper | 6.7, 7 | Divejikan | Afnan | Intermediate |
| F8 | Receipt generation and the verifier tool | 6.8 | Divejikan | Abdul | Intermediate |
| F9 | Web UI: shell, Screen 1, layouts for Screens 2 and 3, wiring | 4.3 | Shahnas | Prabhath, Divejikan | Basic |
| F10 | Adoption and submission pack: interviews, business model, README, deck, video | 15, 18 | Shahnas (drafts), Abdul (owner) | All | Basic |

**Screen ownership** (three connected screens, Blueprint Section 4.3):

| Screen | Layout and mock data | Wiring to the real API |
|---|---|---|
| 1. Procurement Workspace | Shahnas | Shahnas |
| 2. Trust & Approval Centre | Shahnas (page composition and layout) | Prabhath (`PermissionsTable`, `DecisionLog`, `BudgetGauge` data hook), Divejikan (`ApprovalPanel` only). Each is in its own component file |
| 3. Settlement & Proof Centre | Shahnas | Divejikan |

**P0 test ownership** (all seven must pass, Blueprint Section 11):

| ID | Test | Owner |
|---|---|---|
| P0-1 | Agent requests `payroll.csv`, gateway denies | Abdul |
| P0-2 | Expired or revoked grant denied, including a revoke between evaluate and execute | Abdul |
| P0-3 | Concurrent reservations never exceed the budget | Prabhath (test), Abdul (locking logic) |
| P0-4 | Payload changed after evaluation or approval is rejected | Abdul |
| P0-5 | Direct connector call without the gateway is rejected | Abdul, Prabhath (attack script) |
| P0-6 | Interrupted execution then idempotent retry, no duplicate effect | Abdul, Divejikan (chain reconciliation) |
| P0-7 | Altered receipt fails verification | Divejikan |

P1 tests belong to whoever owns the feature (listed in each member section).

------------------------------------------------------------------------

## 4. Shared rules for everyone

### 4.1 Repository layout

```
seyvixa-trustos/
├── apps/
│   ├── api/            # gateway, approvals, routes (Abdul)
│   └── web/            # Next.js UI (Shahnas, Prabhath, Divejikan)
├── services/
│   ├── connectors/     # protected connectors, reachable only by the gateway (Abdul)
│   ├── agents/         # Procurement and Finance agents (Prabhath)
│   ├── chain/          # Cardano off-chain service (Divejikan)
│   └── budget/         # budget guard and reservations route (Abdul); read helper and test (Prabhath)
├── contracts/
│   ├── cardano/        # Aiken validator + DATUM_SPEC.md (Afnan)
│   └── midnight/       # Compact contract + issuer tool (Afnan)
├── packages/shared/    # types, zod schemas, canonical JSON, hashing (Abdul)
├── tools/verifier/     # receipt verifier CLI (Divejikan)
├── keys/               # public keys only (receipt public key)
├── docs/               # blueprint, AI_CONTEXT.md, evidence, README parts
├── docker-compose.yml
├── LICENSE             # Apache 2.0
└── .env.example
```

Stack: Node.js + TypeScript, PostgreSQL (Docker), Next.js + Tailwind, Aiken, Compact, Mesh SDK. Do not add new frameworks without Abdul's approval.

### 4.2 Git workflow

-   `main` is protected. Nobody pushes to it directly.
-   Branch names: `feat/<name>/<feature>`, for example `feat/afnan/aiken-validator`.
-   Small pull requests (one task each). Every PR needs your buddy's review. Security-critical PRs also need Abdul.
-   Commit messages: `type(scope): short message`, for example `feat(gateway): add execute state machine`.
-   Secrets live only in `.env` (ignored by git). Commit `.env.example` with fake values.
-   Rebase or merge `main` at least once a day.

### 4.3 Shared interfaces (freeze by 23 Nov, except the datum spec on 25 Nov)

Agree these early so five people can build in parallel. Everyone codes against the shared types in `packages/shared` and uses mock data until the real module is ready.

| Interface | Provider | Consumer | Shape |
|---|---|---|---|
| Shared types, zod schemas, reason codes, canonical JSON and SHA-256 helpers | Abdul | All | `packages/shared` |
| Gateway endpoints | Abdul | Agents, UI, chain | `POST /api/actions/evaluate`, `POST /api/actions/execute` |
| Budget guard (write) | Abdul | Gateway | `reserve(procurementId, agentId, amountLkr, idempotencyKey)`, `commit(reservationId)`, `release(reservationId)` |
| Budget read | Prabhath | Abdul's `GET /api/procurements/:id`, Screen 2 gauge | `getBudget(procurementId)`: read-only, no locks, no writes, returns total, reserved, committed, remaining and the reservation list |
| Chain service | Divejikan | Abdul | `buildLockTx(actionId)`, `buildReleaseTx(escrowId, actionId)`, `buildRefundTx(escrowId, actionId)`, `inspectSignedTx(signedTx, actionId)`, `submitTx(signedTx)`, `getTxStatus(txId)` |
| Datum and validator spec | Afnan | Divejikan, Abdul | `contracts/cardano/DATUM_SPEC.md`, compiled validator, script address |
| Midnight service | Afnan | Abdul, Divejikan | `issueChallenge(procurementId, supplierId)`, `verifyProof(challengeId, proof)` returning `{valid, reason}` |
| Wallet helper (browser) | Divejikan | Prabhath, Shahnas | `connectWallet()`, `getAddress()`, `signMessage(address, payload)`, `signTransaction(unsignedTx)` |
| Receipt | Divejikan | Abdul, Shahnas | `generateReceipt(procurementId)`, `tools/verifier` CLI |
| Mock API data | Shahnas | UI team | `apps/web/mocks/*.json`, same shape as the shared types |

**Boundary rule for the budget:** Prabhath never writes budget state, and Abdul does not write the read helper or the P0-3 test. The gauge data is included in the existing `GET /api/procurements/:id` response (Abdul adds one call to `getBudget`). There is no new endpoint.

### 4.4 Definition of done (every task)

A task is done only when all of these are true:

1.  It works end to end on a clean checkout (`docker compose up` plus the documented steps).
2.  It has at least one automated test, or a documented manual test for UI-only work.
3.  The relevant P0 or P1 test passes (if you own one).
4.  It has been reviewed by your buddy (and by Abdul if security-critical).
5.  Labels and wording match what is really implemented.
6.  The README or `docs/` note for your feature is updated.

### 4.5 Meetings

-   Daily 10-minute stand-up (what I finished, what I am doing, what blocks me).
-   If you are blocked for more than two hours, ask your buddy, then Abdul.
-   Saturday integration demo (28 Nov, 5 Dec, 12 Dec): run the full demo end to end, note what broke, assign fixes.
-   Decisions are written in `docs/DECISIONS.md` (date, decision, who).

------------------------------------------------------------------------

## 5. AI tools and model guide (read before you start)

Model line-ups change often. The information below was checked on 22 November 2026. Always confirm in your own tool's model selector.

### 5.1 Claude Code (Abdul only)

Claude Code uses aliases that always point to the latest model of each family:

| Alias | Use it for |
|---|---|
| `opusplan` | Opus while in plan mode, then Sonnet for execution. Best default for gateway, approvals and anything where the design matters. |
| `opus` | The hardest reasoning: concurrency, state machines, signature verification, security review. |
| `sonnet` | Everyday coding and tests. |
| `haiku` | Simple, fast tasks, boilerplate, small edits. |

Notes:

-   Run `claude update` first so you see the newest models, then `/model` to see exactly what your plan offers.
-   Switch during a session with `/model <alias>`, or start with `claude --model opusplan`.
-   There is also a top-tier `fable` alias in the docs. Check in `/model` whether your plan offers it and whether it needs extra usage credits before relying on it.
-   Put project rules in `CLAUDE.md` (see Section 5.5) so every session starts with the right context.
-   Start security-critical work in plan mode: ask for a plan, review it, then let it implement.

### 5.2 Antigravity (Afnan, Divejikan, Prabhath, Shahnas)

You choose the model in the selector under the prompt box and can set a thinking level (Low, Medium, High). Low is fast for small edits. High is for complex architecture and debugging. Which models you see depends on your Google plan:

| Model | Free / AI Plus | AI Pro (paid) | AI Ultra |
|---|---|---|---|
| Gemini 3.8 Flash | Yes | Yes | Yes |
| Gemini 4 Argon (not in the IDE; available in the Antigravity App, CLI and IDE extensions) | No | Yes | Yes |
| Claude Sonnet 5.5 (thinking) | No | Yes (non-trial paid plans only) | Yes |
| Claude Opus 5.5 (thinking) | No | Yes (non-trial paid plans only) | Yes |

Older models (Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS-120b) were scheduled for removal on 2 November 2026, so do not plan around them.

Each Antigravity user should do this on day one:

1.  Open the model selector and write down which models you can actually use.
2.  Tell Abdul. If you only have Gemini 3.8 Flash, use High thinking for hard tasks and split work into smaller steps (Section 5.5).
3.  Antigravity also has an image generation tool. Shahnas can use it for UI mockups and diagrams.

### 5.3 Which model for which feature

Use the strongest model your plan offers for **Tier A** work, a solid mid-level model for **Tier B**, and the fast model for **Tier C**.

| Tier | Meaning |
|---|---|
| A | Security-critical or niche-language work. Mistakes are expensive and hard to see. |
| B | Normal feature work with clear specs. |
| C | Boilerplate, UI layout, documentation. |

| Feature | Tier | Why | Abdul (Claude Code) | Others (Antigravity), best available first | Thinking |
|---|---|---|---|---|---|
| F0 Foundation | C/B | Setup and schema | `sonnet` | n/a | n/a |
| F1 Gateway, state machine | A | Concurrency, time-of-check/time-of-use, fail-closed | `opusplan`, `opus` for debugging | n/a | n/a |
| F2 Wallet and approval signatures | A | COSE signatures, key hashes, easy to get subtly wrong | `opusplan`, `opus` for review | n/a | n/a |
| F3 Agents | B | Prompt design, tool wiring | n/a | Claude Sonnet 5.5, then Gemini 3.8 Flash | Medium |
| F4 Budget guard | A/B | SQL locking is Abdul's; the read helper and concurrency test are Prabhath's | `opusplan` (locking logic) | Claude Sonnet 5.5, then Gemini 3.8 Flash (read helper and test) | Medium |
| F5 Midnight | A | New language, fast-changing toolchain, privacy logic | n/a | Claude Opus 5.5, then Claude Sonnet 5.5, then Gemini 3.8 Flash | High |
| F6 Aiken validator | A | New language, on-chain money logic | n/a | Claude Opus 5.5, then Claude Sonnet 5.5, then Gemini 3.8 Flash | High |
| F7 Cardano off-chain | B | SDK usage, transaction building | n/a | Claude Sonnet 5.5, then Gemini 3.8 Flash | Medium to High |
| F8 Receipt and verifier | B | Canonical JSON, signatures, a CLI tool | n/a | Claude Sonnet 5.5, then Gemini 3.8 Flash | Medium |
| F9 UI | C | Layouts and components with mock data | n/a | Gemini 3.8 Flash | Low to Medium |
| F10 Docs, deck, scripts | C | Writing | n/a | Gemini 3.8 Flash | Low |

**By activity:**

| Activity | Choose |
|---|---|
| Planning a feature or reviewing a design | Strongest model, High thinking (Claude Code: plan mode with `opusplan`) |
| Writing normal code from a clear spec | Mid-level model |
| Debugging a hard or intermittent bug | Strongest model, High thinking |
| Writing tests | Mid-level model, then ask the strongest model to review gaps (Tier A features) |
| UI layout, styling, copy | Fast model |
| Documentation, README, scripts | Fast model |

### 5.4 Special warnings for niche technology

Compact (Midnight), Aiken, CIP-30 and COSE signature details, and the Mesh SDK change quickly. Models often invent function names or use old versions. For these:

-   Pin the exact versions in the repo and tell the model the versions.
-   Paste the relevant official documentation or an official example into the prompt. Do not rely on the model's memory.
-   Compile, run and test everything. A model saying "this works" proves nothing.
-   Ask the model to list its assumptions, then check them against the docs.
-   If a result looks too easy, test it against a real wallet or the real testnet.

### 5.5 Rules for working with AI on this project

1.  **Give context every session.** Keep `docs/AI_CONTEXT.md` (a short summary of the Blueprint rules plus your feature's interface). Abdul also mirrors it in `CLAUDE.md`. Antigravity users attach `docs/AI_CONTEXT.md` to the first prompt of every session, or add it as a workspace rule if your version supports that.
2.  **One task per prompt.** Small tasks produce reviewable code. Do not ask for a whole module at once.
3.  **Specs before code.** Paste the task's acceptance criteria from this guide into the prompt.
4.  **Read the diff.** Do not merge code you cannot explain. Ask the AI to explain anything you do not understand.
5.  **No secrets in prompts.** Never paste seed phrases, private keys, API keys or `.env` files into any AI tool.
6.  **Security code is human-reviewed.** Gateway, approval, signature, contract and receipt code needs a second person.
7.  **Do not let AI expand scope.** If a model suggests extra features, ignore them.
8.  **Do not let AI soften claims.** Wording in the UI, README and pitch must match the real implementation.

### 5.6 Starter prompt template (copy for every task)

```
Project: SEYVIXA TrustOS (UniHack 2026). Read docs/AI_CONTEXT.md first.
My task: <task ID and title from guide.md>
Acceptance criteria: <paste from guide.md>
Files I may change: <paths>
Interfaces I must follow: <paste from Section 4.3>
Versions: <pinned tool versions>
Rules: test networks only; no secrets; do not add features or endpoints; label things for what they really do.
First, write a short plan and list your assumptions. Then implement in small steps with tests. Tell me how to run the tests.
```

------------------------------------------------------------------------

## 6. Member work packages

Each member section uses the same format: member card, mission, tasks with acceptance criteria, what you provide and need, tests you own, recommended models, risks and fallbacks, and definition of done. Task dates match the Blueprint timeline (Section 7 shows everyone on one page).

------------------------------------------------------------------------

### 6.1 Abdul Basith — Advanced — Claude Code

| Item | Detail |
|---|---|
| **Role** | Team lead, integrator, gateway and trust core |
| **Features** | F0 Foundation, F1 Policy gateway, F2 Owner session and approvals, F10 ownership |
| **Buddy** | Reviews everyone's security-critical work; Afnan reviews his contract-facing code |
| **Blueprint sections** | 3, 5, 6.1, 6.2, 6.5, 7, 8, 9, 11, 13, 18 |
| **Tool and models** | Claude Code: `opusplan` for F1 and F2, `opus` for hard debugging, `sonnet` for F0 |

**Mission:** Build the independent gateway that decides what agents may do, verify the owner's wallet-signed approval, and keep the whole team integrated and honest.

**Tasks**

| ID | Task | Acceptance criteria | Target |
|---|---|---|---|
| T0.1 | Create the repo: Apache 2.0 `LICENSE`, monorepo layout, `.gitignore`, `.env.example`, README stub, and `docs/VERSIONS.md` pinning Node LTS, TypeScript, pnpm, Fastify, zod, Next.js, Tailwind and the Postgres image | Clean clone runs with documented steps; no secrets committed; versions pinned. **OVERDUE** (must finish 25 Nov) | 23 Nov |
| T0.2a | `docker-compose.yml` with PostgreSQL and a separate internal network for connectors. **OVERDUE** (must finish 25 Nov) | `docker compose up` starts the database; connectors are unreachable from the agent service | 23 Nov |
| T0.2b | Migrations for the Blueprint Section 8 tables, including its additive note (`agents.credential_hash`, `agent_grants.owner_id`/`issuer`/`integrity_tag`, `suppliers`, `actions.reservation_id`). **OVERDUE** (must finish 26 Nov) | Migrations run on a clean database | 23 Nov |
| T0.3a | `packages/shared`: canonical JSON (RFC 8785) and SHA-256 helpers. **OVERDUE** (must finish 25 Nov) | One unit test per helper | 23 Nov |
| T0.3b | `packages/shared`: types, zod schemas and the reason codes listed in `docs/DECISIONS.md` (24 Nov 2026). **OVERDUE** (must finish 25 Nov) | Frozen and published to the team | 23 Nov |
| T0.4 | Seed data spec: demo owner, two agents with grants, three mock suppliers (A valid credential, B expired, C with the injected instruction) and `payroll.csv`. Prabhath writes the seed script from it | Spec published in `docs/SEED_SPEC.md`; Prabhath's `pnpm seed` matches it | 25 Nov |
| T0.5 | `docs/AI_CONTEXT.md`, `CLAUDE.md`, copy the Blueprint into `docs/`. **OVERDUE** (must finish 25 Nov) | Every member can attach one file as AI context | 23 Nov |
| T1.1a | Agents and agent credentials: `agents.credential_hash` (hash only, never the token), agent authentication with its own credential | An agent authenticates with its own credential, never the owner session; the token is never stored | 28 Nov |
| T1.1b | Grants: scope lists, expiry, revoke, `agent_grants.owner_id`, `issuer`, `integrity_tag` (HMAC with a server key over the grant fields), and `POST /api/agents/:id/grants` | Every grant has an `integrity_tag` verified on each check; a tampered grant is denied | 28 Nov |
| T1.2a | `POST /api/actions/evaluate`: the policy-check function (all Blueprint 6.2 checks) returning `ALLOW`, `DENY` or `APPROVAL_REQUIRED` with a reason code | Every reason code in `docs/DECISIONS.md` is reachable by a test | 28 Nov |
| T1.2b | Evaluate: immutable action record, server-side canonical payload and action hash; sets `actions.reservation_id` when it binds the reservation | Identical payload gives an identical hash; the agent cannot supply the hash | 28 Nov |
| T1.2c | Evaluate: single-use execution ticket bound to the action hash, the caller and the policy version | Ticket is bound, short-lived and single-use | 28 Nov |
| T1.3 | `POST /api/actions/execute`: transition transaction, external call with idempotency key, outcome transaction, states `APPROVED`, `EXECUTING`, `SUCCEEDED`, `FAILED`, `UNKNOWN`, reconciliation on retry and on start-up | Matches Blueprint 6.2; no lock held during the external call; retry never builds a second transaction | 3 Dec |
| T1.4 | Connectors service for supplier search, quote read and file read, accepting only the gateway credential | A direct agent call to a connector fails (P0-5) | 30 Nov |
| T1.6 | `POST /api/procurements`, `GET /api/procurements/:id` (request, workflow status, permissions, decision log and the budget summary from `getBudget`), `POST /api/quotes`. `owner_id` from the session only | Screens 1 and 2 read and write through these routes only; no new route | 28 Nov |
| I2 | Run 1 discovery interview with the nine Blueprint 15.2 questions and fill the shared evidence log (real answers only) | Notes shared with Shahnas | 29 Nov |
| T1.5 | `policy_events` audit log with reason codes. Screen 2 data (permissions, decision log, budget summary) is returned inside the existing `GET /api/procurements/:id`; there is no feed endpoint | Every allow and deny is logged with a reason | 30 Nov |
| T4.1a | `BudgetGuard` write logic: `reserve(procurementId, agentId, amountLkr, idempotencyKey)`, `commit`, `release` using a Postgres transaction with `SELECT … FOR UPDATE`; statuses `RESERVED`, `COMMITTED`, `RELEASED` | Matches Section 4.3; Prabhath's concurrency test passes | 28 Nov |
| T4.1b | `POST /api/budget/reservations`, the route for the Finance Agent's `reserveBudget` tool. DB-only: no evaluate/execute and no ticket. It (a) authenticates the agent credential, (b) calls the same policy-check function evaluate uses (agent active, grant valid, scope `budget:reserve`, spend limit), (c) writes a `policy_events` row, (d) calls `BudgetGuard.reserve` with an idempotency key. Execute later revalidates that the reservation is `RESERVED` with a matching amount, then commits it. Evaluate sets `actions.reservation_id` when it binds the reservation. Also call Prabhath's `getBudget` from `GET /api/procurements/:id` | A denied agent gets no reservation; a repeated idempotency key returns the same reservation | 28 Nov |
| T4.1c | Prompt template for the Procurement Agent, handed to Prabhath | Template saved in `docs/` and handed over | 28 Nov |
| T2.1 | Owner session: seeded login, HttpOnly cookie, `owner_id` always derived from the session | A forged `owner_id` in a request is ignored or rejected. Replaces the `getSessionOwnerId(req)` stub (same signature); remove the stub before 5 Dec | 27 Nov |
| T2.2 | Wallet registration challenge and COSE signature verification (use a maintained helper if available, otherwise follow Blueprint 6.5 steps) | Verified with a real wallet signature; script addresses rejected; key hash derived server-side | 3 Dec |
| T2.3 | `POST /api/approvals`: verify the signature, nonce, expiry and action hash; mark the nonce used atomically | Wrong key, reused nonce and changed payload are all rejected | 3 Dec |
| T2.4 | Pre-submit transaction checks using Divejikan's `inspectSignedTx` (datum buyer equals registered key hash, witness present, required signers) | A transaction that does not match the stored action is refused | 5 Dec |
| L1 | Lead duties: Saturday demos, the 28 Nov go/no-go with Afnan, PR reviews, GitHub access request (do it now, the repo does not exist yet; deadline 5 Dec), submission checklist, final business model, claims check, check that every interview figure in the pitch is real | Checklist in Blueprint Section 18 fully ticked by 13 Dec | ongoing |

**You provide:** shared types, gateway endpoints, owner session, seed data, repo and CI.
**You need:** the seed script and agents from Prabhath, chain service from Divejikan, datum spec from Afnan, UI needs from Shahnas.

**Tests you own:** P0-1, P0-2, P0-4, P0-5, P0-6 (with Divejikan), and the locking logic behind P0-3. P1: allowed search is allowed, out-of-scope tool denied, nonce reuse rejected, wrong approval key rejected, forged `owner_id`, wallet registration for the wrong address.

**Risks and fallbacks:** If wallet message signing blocks you, use the browser-held demo key fallback and apply the label "approval key not bound to escrow buyer key (fallback)". Do not hand-roll crypto if a maintained helper works; test with a real wallet signature either way.

**Definition of done:** P0-1, P0-2, P0-4, P0-5 and P0-6 pass; the end-to-end demo runs without manual database edits.

------------------------------------------------------------------------

### 6.2 Afnan — Advanced — Antigravity

| Item | Detail |
|---|---|
| **Role** | Blockchain on-chain: Midnight proof and Cardano validator |
| **Features** | F5 Midnight eligibility proof, F6 Cardano escrow validator |
| **Buddy** | Divejikan (off-chain Cardano) |
| **Blueprint sections** | 6.6, 6.7, 6.9, 13 (fallback levels), 16 (claims to avoid) |
| **Tool and models** | Antigravity: Claude Opus 5.5 or Sonnet 5.5 (thinking) if your plan has them, otherwise Gemini 3.8 Flash at High thinking. Paste official docs into every prompt. |

**Mission:** Deliver one real Midnight proof and one real Cardano escrow validator on testnet, and tell the team honestly which fallback level was reached.

**Tasks**

| ID | Task | Acceptance criteria | Target |
|---|---|---|---|
| T5.1 | Midnight environment: pin one toolchain version, wallet, tNIGHT from the faucet, DUST for fees; write `contracts/midnight/README.md` | A new teammate can reproduce the setup from the README | 25 Nov |
| T5.2 | Spike: deploy and verify the simplest official example on testnet (time-box about two days) | Proof generated and verified on testnet | 26 Nov |
| T5.3 | Design the credential and claim: fields `subject_id`, credential ID, issue and expiry dates; issuer key or registry commitment; public inputs `supplier_id`, issuer reference, verification date, challenge | One page in `contracts/midnight/DESIGN.md` reviewed by Abdul | 27 Nov |
| T5.4 | Implement the Compact contract with the in-circuit assertion `credential.subject_id == supplier_id`, issuer check and expiry check | A valid credential for supplier A fails when verified for supplier B | 2 Dec |
| T5.5 | `issueChallenge` and `verifyProof` service plus the route `POST /api/suppliers/:id/verify` (two modes: issue challenge, verify proof) | Challenge is single-use, bound to procurement and supplier, and expires | 3 Dec |
| T5.6 | Issuer seed tool: credentials for the mock suppliers (A valid, B expired, C from a non-allowlisted issuer) | Verification passes only for A | 3 Dec |
| T5.7 | Go/no-go report: which Midnight level (1, 2 or 3) was reached and the exact UI label to use | Posted in `docs/DECISIONS.md` | 28 Nov |
| T5.8 | Write the two lists for the Screen 3 privacy panel: what the verifier learns (public inputs and result) and what stays private | Lists match Blueprint 6.6 and the real contract; handed to Shahnas | 2 Dec |
| T6.1 | Cardano environment: pin Aiken and Mesh versions, choose one testnet for the whole team, chain-data API key | Decision posted by 25 Nov | 25 Nov |
| T6.2 | `contracts/cardano/DATUM_SPEC.md`: buyer key hash, supplier key hash, amount, refund deadline, action commitment; release and refund redeemers | Divejikan and Abdul can code against it | 25 Nov |
| T6.3 | Aiken validator: release needs the buyer signature and pays the supplier; refund needs the deadline passed, the buyer signature, and pays the buyer | Aiken unit tests: release without buyer signature fails, refund before deadline fails | 30 Nov |
| T6.4 | Deploy to testnet and run a manual lock and release | Transaction IDs recorded in `docs/evidence/` | 1 Dec |
| T6.5 | Create escrow B (short refund deadline), execute its refund in advance, and keep the evidence; prepare escrow A for the live demo | Escrow A is untouched until the demo; escrow B refund is confirmed with an explorer link | 8 Dec |
| T6.6 | Write the "why on-chain" slide and the buyer-controlled escrow wording | Slide uses the Blueprint 6.9 table without overclaiming | 9 Dec |
| T6.7 | Optional rejection evidence on escrow B (Cardano Level 1 or 2 only): attempt a release without the buyer's signature and a refund before the deadline, record that the validator rejects them (use the chain-data API's transaction evaluation or the node's rejection), then run the real refund after the deadline | Clips and transaction IDs saved in `docs/evidence/`. The release clip is used in the demo only if the matching P1 test passed. At Level 3, skip it and make no enforcement claim | 8 Dec |

**You provide:** `DATUM_SPEC.md`, compiled validator and script address, Midnight service functions, evidence files.
**You need:** transaction building from Divejikan, endpoint and database helpers from Abdul.

**Tests you own (P1):** valid credential for supplier A fails for supplier B, invalid or expired proof fails, challenge reuse fails, release without buyer signature fails on testnet, refund before the deadline fails on testnet.

**Risks and fallbacks:** Decide on 28 Nov. Midnight: Level 1 own claim with subject binding, Level 2 example contract (label "Midnight toolchain demo"), Level 3 simulated ("Midnight integration incomplete"). Cardano: Level 1 full validator, Level 2 release only, Level 3 anchoring only ("Not escrow"). If the circuit does not assert subject binding, do not claim Level 1.

**Definition of done:** Level reached is recorded, labels match it, and tests for that level pass on the real testnet.

------------------------------------------------------------------------

### 6.3 Divejikan — Intermediate — Antigravity

| Item | Detail |
|---|---|
| **Role** | Cardano off-chain integration, wallet helper, receipt and verifier |
| **Features** | F7 Cardano off-chain, F8 Receipt and verifier, Screen 3 wiring |
| **Buddy** | Afnan (peer); mentor for Prabhath and Shahnas, reviews their pull requests |
| **Blueprint sections** | 6.5 (wallet and signatures), 6.7, 6.8, 7, 10, 11 |
| **Tool and models** | Antigravity: Claude Sonnet 5.5 (thinking) if available, otherwise Gemini 3.8 Flash at Medium or High |

**Mission:** Turn the validator into working transactions, give the UI a safe wallet helper, and build the receipt and the verifier that prove what happened.

**Tasks**

| ID | Task | Acceptance criteria | Target |
|---|---|---|---|
| T7.1 | `services/chain` with the Mesh SDK and the chain-data API; connect to the team's testnet | `getTxStatus(txId)` returns found, confirmed or not found. `found` = the chain-data API returns the transaction in a block; `confirmed` = found with at least `CONFIRMATION_DEPTH` confirmations (default 3, in config, a prototype setting); anything else is not found | 27 Nov |
| T7.2a | Browser wallet helper: `connectWallet()` and `getAddress()` (CIP-30) | Works with a real testnet wallet | 29 Nov |
| T7.2b | Browser wallet helper: `signMessage` (CIP-30 `signData`) and `signTransaction` (the wallet signs but never submits). Delivered to Prabhath and Shahnas | Works with a real testnet wallet | 29 Nov |
| I3 | Run 1 discovery interview with the nine Blueprint 15.2 questions and fill the shared evidence log (real answers only) | Notes shared with Shahnas | 29 Nov |
| T7.3 | `buildLockTx(actionId)`: output to the script address with an inline datum, buyer key hash taken from the owner record, short transaction validity window | Unsigned transaction matches `DATUM_SPEC.md` | 2 Dec |
| T7.4 | `buildReleaseTx` and `buildRefundTx` with required signers and validity range | Release and refund work on the testnet with Afnan's validator | 3 Dec |
| T7.5 | `inspectSignedTx(signedTx, actionId)` and `submitTx(signedTx)` for the gateway | Rejects a transaction whose datum, amount or signer does not match the stored action | 4 Dec |
| T7.6 | Escrow prepare endpoints (`/api/escrows`, `/release`, `/refund`): require an evaluated `action_id`, build from the stored action only, return an unsigned transaction, never submit | Request fields cannot change the transaction | 4 Dec |
| T7.7 | Chain reconciliation for P0-6: look up the stored transaction ID, handle confirmed, not found with window open (resubmit identical transaction), not found after the window (failed) | Interrupted execution retried without a duplicate transaction | 5 Dec |
| T8.1 | Receipt generator `generateReceipt(procurementId, view)` for the `full` and `verification` views, using the field table in Blueprint 6.8. Include `escrow_utxo_ref`, `lock_tx_id` and, after settlement, `release_tx_id`, read from `chain_transactions` and `actions.external_ref` | Key ID only, never the public key. The verification view has no business details or resource names | 5 Dec |
| T8.2 | Generate the receipt key once, publish the public key file, compute the SHA-256 fingerprint of the raw public key, `kid` is its first 16 hex characters | Fingerprint ready for the README and slide; key is not regenerated afterwards | 5 Dec |
| T8.3 | `tools/verifier` CLI: `--receipt` and `--trusted-fingerprint`. Checks 1 to 6 from Blueprint 6.8, including release verification: confirmation, network, the release transaction spends `escrow_utxo_ref`, the supplier payment output and the buyer signature | `VERIFIED`, `REJECTED` or `UNVERIFIABLE`. Wrong fingerprint stops verification. A release that does not spend the escrow UTxO is rejected | 8 Dec |
| T8.6 | `GET /api/receipts/:id/verify`: wraps the verifier function and uses the server's configured fingerprint. The independent check stays the CLI (T8.3) | Returns `VERIFIED`, `REJECTED` or `UNVERIFIABLE` | 8 Dec |
| T8.4 | Tamper script for the demo (alter a field, show rejection) | P0-7 passes | 8 Dec |
| T8.5 | Publish receipt format v0: `docs/receipt-spec-v0.md` (with the field classification table), `schemas/receipt.v0.schema.json` for both views, and validate receipts against it. Label it "v0, prototype format". Sample receipts use simulated demo data only | A valid receipt passes; a receipt missing a field fails; a verification view containing business details fails | 9 Dec |
| T9.2b | Wire the approval panel on Screen 2: the sign button uses the wallet helper and posts to `/api/approvals` (Prabhath wires the read-only parts) | Panel shows the exact action and its hash, then submits the signed approval | 6 Dec |
| T9.3 | Wire Screen 3 to the real API: Midnight status, escrow A card with transaction IDs and explorer links, escrow B refund evidence, receipt verify and tamper button | Screen shows the real fallback level labels | 9 Dec |

**You provide:** chain service, wallet helper, escrow prepare endpoints, receipt and verifier, Screen 3 wiring.
**You need:** datum spec and validator from Afnan; shared types and canonical JSON from Abdul; layout components from Shahnas.

**Tests you own:** P0-7, and P0-6 chain reconciliation with Abdul. P1: receipt validates against the v0 schema (both views), release transaction checks (not spending the escrow UTxO, wrong network, missing supplier output, `released` without `release_tx_id`), receipt with an embedded key or unknown `kid` is rejected, commitment mismatch is rejected, unconfirmed transaction is not marked confirmed, chain API down gives `UNVERIFIABLE`.

**Risks and fallbacks:** If `signData` is blocked, tell Abdul at once so the demo-key fallback and its label are used. If Afnan's validator slips, build against his datum spec and test the transaction shape first.

**Definition of done:** The live demo can lock and release escrow A through the gateway, and the verifier outputs `VERIFIED` for the real receipt and `REJECTED` for the tampered one.

------------------------------------------------------------------------

### 6.4 Prabhath — Basic — Antigravity

| Item | Detail |
|---|---|
| **Role** | AI agents, seed data, budget read helper and concurrency test, Screen 2 read-only wiring |
| **Features** | F3 Agents, F4 Budget guard (read helper and test), F0 seed script |
| **Buddy** | Shahnas (peer); mentor: Divejikan |
| **Blueprint sections** | 3, 6.3, 6.4, 10, 11 |
| **Tool and models** | Antigravity: Claude Sonnet 5.5 (thinking) if your plan has it, otherwise Gemini 3.8 Flash at Medium thinking |

**Mission:** Build the two agents and the demo data from clear specs, and prove with a test that the budget cannot be overspent.

**Working style for you:** Work in small steps, one task per prompt. Abdul gives you the seed spec, the budget locking function and the Procurement Agent prompt template, so you are never designing security logic. You do not edit gateway, signing, contract or receipt code. If you are stuck for more than an hour, ask Divejikan or Shahnas.

**Tasks**

| ID | Task | Acceptance criteria | Target |
|---|---|---|---|
| T0.4b | Write the seed script from Abdul's `docs/SEED_SPEC.md`: demo owner, two agents with grants, three supplier quote fixtures (A valid credential and best eligible price, B expired credential, C with the injected instruction to read `payroll.csv`), and `payroll.csv` | `pnpm seed` gives the same demo data every time | 28 Nov |
| T4.2 | P0-3 concurrency test in `tests/p0/budget-concurrency.test.ts`. It calls only Abdul's public `reserve` (two parallel reservations that together exceed the budget, using `Promise.all`) | Passes every time you run it. You do not edit the locking code | 29 Nov |
| T4.3 | Write the read-only `getBudget(procurementId)` helper in `services/budget/read.ts`. It takes no locks and writes nothing. Abdul includes its result in the existing `GET /api/procurements/:id` | Returns total, reserved, committed, remaining and the reservation list for the Screen 2 gauge. No new endpoint is added | 30 Nov |
| I1 | Run 1 discovery interview with the nine Blueprint 15.2 questions (including the cost of the last wrong purchase, willingness to pay, and the same-controls question) and fill the shared evidence log | Notes shared with Shahnas, real answers only | 29 Nov |
| T3.1 | Agent scaffolding: two identities (Procurement, Finance) and tool functions (`searchSuppliers`, `getQuote`, `readFile`, `reserveBudget`, `proposePurchase`) that call only the gateway through the shared client; no connector credentials in agent code | A search for the code finds no connector credentials | 2 Dec |
| T3.3 | Finance Agent (rules-based, no LLM) with its own identity and grant: checks the budget and requests approval | Every protected action goes through the gateway | 3 Dec |
| T3.4 | Procurement Agent (LLM-backed) using Abdul's prompt template: reads quotes, compares suppliers, returns a proposal as JSON validated by zod | The model's output is only a proposal; it never decides permissions | 4 Dec |
| T3.5 | Injection scenario: the Procurement Agent reads quote C and then tries to read `payroll.csv` | Gateway log shows `DENY: RESOURCE_OUT_OF_SCOPE`; save a screenshot | 5 Dec |
| T3.6 | Bypass attack script: call a connector directly without the gateway | The call fails; hand the script to Abdul for P0-5 | 5 Dec |
| T9.2 | Wire the read-only parts of Screen 2 to the real API: permissions table, decision log, budget gauge (Divejikan wires the approval panel) | Shahnas's layout shows real data without redesign | 6 Dec |
| T3.7 | Recorded-response fallback for the LLM, switched by an environment flag | Demo works if the LLM API is slow or down | 8 Dec |
| S1 | Optional stretch: judge's break-it box on Screen 1 (Blueprint Section 10), only after all seven P0 tests pass | Works with the existing quotes route and a prepared example; drop it if not working by 10 Dec | 10 Dec |

**You provide:** seed script and quote fixtures, the two agents, the read-only `getBudget` helper, the concurrency test, the bypass attack script, Screen 2 read-only wiring.
**You need:** seed spec, `BudgetGuard` and prompt template from Abdul; gateway endpoints from Abdul; layout components from Shahnas; mentoring from Divejikan.

**Tests you own:** P0-3 (the concurrency test) and the attack script for P0-5.

**Risks and fallbacks:** Choose one LLM provider with an environment variable and keep the API key in `.env` only. Keep the recorded-response fallback. Never give an agent any shortcut to the connectors. If a task is too big, tell Divejikan so it can be shrunk or shared.

**Definition of done:** P0-3 passes, the injection attempt and the direct-bypass attempt both fail in the real gateway logs, and the seed script gives a repeatable demo dataset.

------------------------------------------------------------------------

### 6.5 Shahnas — Basic — Antigravity

| Item | Detail |
|---|---|
| **Role** | Web UI shell and Screen 1, documentation, pitch support |
| **Features** | F9 Web UI, F10 Adoption and submission pack (drafts) |
| **Buddy** | Prabhath (peer); mentor: Divejikan |
| **Blueprint sections** | 4.3, 10, 15, 16, 18 |
| **Tool and models** | Antigravity: Gemini 3.8 Flash at Low or Medium thinking. Use the image tool for mockups. |

**Mission:** Build the three connected screens with clear layouts and mock data, then connect Screen 1 to the real API. Write the documents the judges read.

**Working style for you:** Work in small steps. Make one component per prompt. Ask Prabhath when stuck. You do not edit gateway, signing, contract or receipt code. Use mock data first so you are never blocked.

**Tasks**

| ID | Task | Acceptance criteria | Target |
|---|---|---|---|
| T9.1 | Next.js app with Tailwind in `apps/web`; routes `/workspace`, `/trust`, `/settlement`; shared layout with navigation | All three routes load; one navigation bar | 25 Nov |
| T9.1b | Workflow stage indicator (Request, Quotes, Eligibility, Approval, Escrow, Receipt) and the two persistent labels: "Simulated LKR budget — not real money" and "Cardano testnet — test ADA has no monetary value" | Labels appear on every screen | 26 Nov |
| T9.4 | Mock data files in `apps/web/mocks/` that match the shared types | UI runs fully on mocks | 26 Nov |
| T9.5a | Screen 1 request form (items, quantity, deadline, simulated LKR budget), on mock data | Works with mock data; LKR and ADA never shown as a conversion | 29 Nov |
| T9.5b | Screen 1 supplier quote comparison table with eligibility status, on mock data | Works with mock data | 29 Nov |
| T9.5c | Screen 1 agent activity feed, on mock data | Works with mock data | 29 Nov |
| T9.6 | Screen 2 layout with mock data: permissions table, decision log with `ALLOW`, `DENY`, `APPROVAL_REQUIRED` badges, budget gauge, static approval panel | Prabhath can plug in real data without redesign | 2 Dec |
| T9.7 | Screen 3 layout with mock data: Midnight verification card, escrow card, receipt card, tamper button placeholder | Divejikan can plug in real data without redesign | 2 Dec |
| T9.7b | Add the two-column privacy panel (the verifier learns / stays private) to the Screen 3 layout, using Afnan's lists (T5.8); show the fallback label when the level is 2 or 3 | Panel matches the real contract; simulated data is never shown as a Midnight result | 3 Dec |
| T9.8 | Fallback label component (props: chain and level) that shows the exact label text from Blueprint Section 13, including "buyer-controlled prototype" | Wrong or missing labels are impossible to display | 3 Dec |
| T9.9 | Connect Screen 1 to the real API using the typed client from `packages/shared` | Create a request and see real quotes | 5 Dec |
| T9.10 | Loading, empty and error states on all screens | No blank or broken screens in the demo | 9 Dec |
| T10.1 | README draft: who it is for, how it could be sustained, where blockchain and privacy add value, how to run, how to verify a receipt (with the key fingerprint); state the claim boundary: only AI agents are enforced today, staff and software are a future extension | Covers the submission documentation requirement | 8 Dec |
| T10.2 | Run 1 to 2 interviews with all nine Blueprint 15.2 questions (including the cost of the last wrong purchase in LKR, willingness to pay, and whether owners want the same controls for staff and software) and keep the shared evidence log; draft the one-page summary (real answers only) | Summary states what was learned and what changed | 29 Nov, final 3 Dec |
| T10.3 | Draft the business model one-pager from Blueprint 15.3 for Abdul to review | Assumptions are labelled; prices marked "to validate" | 3 Dec |
| T10.4 | Pitch deck outline and 3-minute demo video script using the Blueprint 10 table, the delegated-authority framing and only real interview figures | Script fits 2 to 4 minutes; no invented numbers | 9 Dec |
| T10.5 | Demo checklist for each Saturday rehearsal, then record and edit the demo video | Final video is 2 to 4 minutes and shows only what works | 12 to 13 Dec |

**You provide:** the app shell, Screen 1, layouts for Screens 2 and 3, mock data, label component, documents, deck and video.
**You need:** shared types from Abdul, wallet helper from Divejikan, API endpoints as they become ready.

**Tests you own:** a manual UI checklist (labels visible, no conversion shown, no broken states). You own no P0 tests.

**Risks and fallbacks:** If real endpoints are late, keep working on mocks. Never invent interview answers or numbers. If you are stuck for more than an hour, ask your buddy.

**Definition of done:** All three screens work on mocks and the real API, labels are correct, and the README, interview summary, business model, deck and video are ready by 12 Dec.

------------------------------------------------------------------------

## 7. Timeline on one page

| Dates | Abdul | Afnan | Divejikan | Prabhath | Shahnas |
|---|---|---|---|---|---|
| 21 to 23 Nov | Repo, Docker, schema, shared types, AI context | Midnight and Cardano environments | Read wallet and Mesh docs | Read Blueprint 6.3 to 6.4, plan agents | Next.js setup |
| 24 to 29 Nov | Gateway skeleton, grants, evaluate, BudgetGuard locking (28 Nov) | Spikes, datum spec (25 Nov), **go/no-go 28 Nov** | Chain service, wallet helper | Seed script and fixtures, P0-3 test (29 Nov) | Screen 1, layout components, interviews |
| 30 Nov to 5 Dec | Execute state machine, sessions, approvals, **GitHub access by 5 Dec** | Compact contract, validator, testnet escrow | Transaction builders, inspect and submit, reconciliation, receipt generator | Agents, injection scenario, Screen 2 wiring | Screens 2 and 3 layouts, Screen 1 wired, business model draft |
| 6 to 10 Dec | End-to-end run, P0 tests, review | Escrow B rejection and refund evidence, "why on-chain" slide | Verifier, tamper test, receipt spec v0, Screen 3 wiring | LLM fallback, polish | Error states, README, deck, video script |
| 11 to 13 Dec | Freeze 13 Dec, claims check, checklist | Final label check | Final receipt and fingerprint check | Final demo data | Record and edit the video |

Saturday integration demos: 28 Nov, 5 Dec, 12 Dec.

------------------------------------------------------------------------

## 8. Checklists

### 8.1 Saturday integration demo

-   [ ] Fresh checkout starts with `docker compose up` and seed.
-   [ ] Agent injection attempt is blocked in the real gateway log.
-   [ ] Direct connector attempt fails.
-   [ ] Concurrent reservations never exceed the budget.
-   [ ] Eligibility check shows the correct fallback label for the level reached.
-   [ ] Owner signs the approval with the wallet; a changed payload is rejected.
-   [ ] Escrow A locks and releases on testnet; transaction ID and explorer link shown.
-   [ ] (Optional) The clip of the rejected release (no buyer signature, escrow B) is ready and its P1 test passed.
-   [ ] Receipt verifies with the trusted fingerprint; the tampered receipt is rejected.
-   [ ] Simulated LKR and test ADA labels visible; no conversion shown.
-   [ ] Anything that broke is assigned to a named person.

### 8.2 Evidence to collect for the submission

-   [ ] P0 test results (all seven) and P1 results
-   [ ] Gateway logs for allow, deny and the injection attempt
-   [ ] Midnight verification output (or the honest fallback label)
-   [ ] Cardano transaction IDs and explorer links for escrow A and escrow B
-   [ ] Receipt public key and fingerprint (repo, README, deck or video)
-   [ ] Interview summary and business model
-   [ ] Receipt spec v0 (document, JSON Schema for both views, verifier)

### 8.3 Submission (Abdul owns)

-   [ ] GitHub access requested by 5 Dec
-   [ ] Public repo, Apache 2.0 licence, README and documentation
-   [ ] 2 to 4 minute demo video
-   [ ] Test networks only, no secrets committed
-   [ ] Labels match what is really implemented
-   [ ] Every number in the pitch is a real interview figure
-   [ ] README, deck and video say only AI agents are enforced today
-   [ ] Submitted before 14 Dec, 12:00 noon (internal freeze 13 Dec)

------------------------------------------------------------------------

## 9. Risks and who owns them

| Risk | Owner | Fallback | Decide by |
|---|---|---|---|
| Midnight proof does not work in time | Afnan | Level 2 or 3 with the honest label | 28 Nov |
| Aiken validator or testnet transactions slip | Afnan, Divejikan | Level 2 or 3 with the honest label | 28 Nov |
| Wallet `signData` verification blocks the build | Abdul, Divejikan | Demo-key fallback with the fallback label | 3 Dec |
| LLM API slow or down during the demo | Prabhath | Recorded-response fallback flag | 8 Dec |
| Interfaces drift between members | Abdul | Shared types are the contract; update them first | continuous |
| UI waits on APIs | Shahnas | Work on mock data | continuous |
| Overclaiming in the README, UI or pitch | Abdul | Final claims check against Blueprint Section 16 | 13 Dec |
| Basic-level member blocked or off track | Divejikan (mentor), Abdul | Shrink the task, pair up, or move it to a stronger member | continuous |
| Member falls behind | Abdul | Cut UI polish and optional work before the gateway or evidence checks | continuous |

If anything must be cut, cut in this order: UI polish, optional features, P1 tests. Never cut the gateway, the approval check, or the receipt verification.

------------------------------------------------------------------------

## 10. Pull request checklist (copy into every PR)

-   [ ] Task ID and feature ID in the title
-   [ ] Acceptance criteria met (list them)
-   [ ] Tests added or manual test steps written
-   [ ] No secrets, keys or seed phrases in the diff
-   [ ] Interfaces unchanged, or shared types updated and announced
-   [ ] Labels and wording match the real implementation
-   [ ] Buddy review done (and Abdul review if security-critical)
