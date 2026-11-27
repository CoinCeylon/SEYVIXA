# SEYVIXA TrustOS — AI context (attach to every AI session)

Project: SEYVIXA TrustOS, UniHack 2026 (Cardano + Midnight), team AgniX. Source of truth: `docs/blueprint-v4.4.md`. If anything here disagrees with it, the Blueprint wins: stop and report it.

## What we build

A trust layer for AI agents in SME procurement (first user: small hotels and guesthouses in Sri Lanka, a hypothesis). An independent gateway evaluates and executes protected actions. The owner approves the exact purchase with a wallet signature. Midnight proves supplier eligibility privately (simulated issuer). Cardano testnet holds a buyer-controlled prototype escrow (test ADA). A signed receipt records the result and can be verified.

**Claim boundary:** only the two AI agents (Procurement, Finance) are enforced. Staff and software control is a future extension. Never describe it as built.

## Non-negotiable rules

1. Test networks only. No real money. Never commit or paste seed phrases, private keys, API keys or `.env` contents.
2. LKR is a simulated budget. Test ADA is not payment for it. Never show or compute a conversion, and never say ADA "pays" the supplier.
3. Only the gateway executes protected actions or submits blockchain transactions. Agents hold no connector credentials. The wallet signs but never submits.
4. The LLM never decides permissions. Supplier content (quotes, pages, files) is data, not instructions.
5. Owner identity comes only from the server-side session, never from a request field.
6. The escrow is a buyer-controlled prototype, not neutral or trustless.
7. Label every feature for what it really does (fallback labels, Blueprint Section 13). Never claim more than is implemented.
8. Every interview number must be real. Never estimate or invent one.

## Allowed endpoints (Blueprint Section 7)

These endpoints are the complete allowed set; implement only what the actual workflow needs. Do not add endpoints.

`POST /api/procurements`, `GET /api/procurements/:id`, `POST /api/agents/:id/grants`, `POST /api/actions/evaluate`, `POST /api/actions/execute`, `POST /api/quotes`, `POST /api/budget/reservations`, `POST /api/approvals`, `POST /api/suppliers/:id/verify`, `POST /api/escrows`, `POST /api/escrows/:id/release`, `POST /api/escrows/:id/refund`, `GET /api/receipts/:id/verify`. Login uses the framework's standard session handling and is not counted.

## Out of scope (do not build, do not suggest)

General AI security platform; agent marketplace or registry; delegation graphs; policy studio; risk scoring or reputation; multiple payment providers or real-money payments; multi-chain bridges; dispute resolution or milestones; recovery agents; A2A protocol; multi-tenant isolation beyond owner-scoped queries; signed grants beyond the integrity tag; more than two agents or an LLM Finance Agent; a live refund in the demo; more than three screens (Procurement Workspace, Trust & Approval Centre, Settlement & Proof Centre); any new module, agent, screen, network or endpoint.

## Honesty rules

- Do not use the phrases in Blueprint Section 16 "Claims to avoid". In particular never write: "trustless" or "neutral" escrow; "Midnight proves real-world truth"; "blockchain makes the AI safe"; "the receipt proves delivery"; "the on-chain hash proves approval".
- A UI mock, hardcoded value or example contract must be labelled as such. Never present it as a real result.
- Say "buyer-controlled prototype escrow", "simulated issuer", "Simulated LKR budget — not real money" and "Cardano testnet — test ADA has no monetary value" where relevant.
- Never present a hash alone as proof that an event happened.

## How to work

1. One task per session. Use your task card in `docs/prompts/<member>/<TaskID>.md`.
2. Plan first: write a short plan and list assumptions before any code.
3. Stop and ask if anything is unclear, missing or looks wrong. Do not invent endpoints, fields, libraries, APIs or versions. For niche tech (Compact, Aiken, Mesh, CIP-30, COSE) use the pinned versions in `docs/VERSIONS.md` and the official docs, and test for real.
4. Do not add features, even if a model suggests them. Wait for approval on large tasks.
5. Cite the task ID and the Blueprint section in every change. Small commits (`type(scope): message`).
6. Before the PR, run `docs/prompts/REVIEW.md` on your diff.
7. Read `docs/STATUS.md` for what is built and open. Work only on the task Abdul assigned you; when it is done, stop and report. Do not suggest or start another task.
