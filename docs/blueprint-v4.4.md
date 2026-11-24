# SEYVIXA TrustOS — Focused MVP Blueprint

**Team:** AgniX  
**Competition:** UniHack 2026 — Blockchain for Real-World Adoption (Cardano + Midnight)  
**Version:** 4.4 — Focused MVP, adoption-ready, consistency corrections  
**Date:** 21 November 2026  
**Supersedes:** v4.3

------------------------------------------------------------------------

## What changed in v4.4 (from v4.3)

Targeted consistency corrections only. No new endpoints, modules, agents, screens or networks, and the scope and timeline are unchanged.

| # | Area | Change in v4.4 |
|---|---|---|
| 1 | Rejection demo | The on-chain rejection clip is optional and gated by its P1 test. P0 stays at seven because P0 tests must hold at every fallback level (6.7, 10, 11). |
| 2 | Interviews | New question 9 tests demand for the same controls for staff, software and AI (15.2). |
| 3 | Receipt privacy | Fields are classified, and two signed views (full and verification) support verification without unnecessary disclosure (6.8). |
| 4 | Budget ownership | Abdul owns the locking logic and the reservations route. Prabhath owns the read-only `getBudget` helper and the P0-3 test (12). |
| 5 | Release verification | The receipt carries the escrow UTxO reference and the release transaction ID. The verifier checks the release, not only the lock (6.8, 8). |
| 6 | Product claim | A claim boundary separates implemented AI-agent enforcement from the future extension to staff and software (1, 15.1, 16, 18). |

## What changed in v4.3 (from v4.2)

Small refinements to framing, evidence, demo and the team split. No new endpoints, modules, agents, screens or networks, and the architecture and timeline are unchanged.

| # | Area | Change in v4.3 |
|---|---|---|
| 1 | Framing | The trust layer is described as delegated authority for any actor (staff, automation or AI). The prototype still demonstrates it with AI agents (Sections 1, 15.1, 16). |
| 2 | Adoption evidence | Interviews must capture the cost of a past wrong purchase and willingness to pay. The pitch uses only real figures (15.2, 16, 18). |
| 3 | Privacy panel | Screen 3 shows what the verifier learns versus what stays private (4.3, 6.6). |
| 4 | On-chain refusal | Recorded evidence of the validator rejecting an invalid release on test escrow B (6.7, 10). |
| 5 | Open receipt format | Receipt format v0 (document, JSON Schema, verifier) is published in the repository (6.8, 13, 18). |
| 6 | Optional stretch | A judge's "break-it" box, only after all P0 tests pass (10). |
| 7 | Team split | Prabhath moves to basic-level work. Budget locking logic moves to Abdul, and the seed script moves to Prabhath (12). |

## What changed in v4.2 (from v4.1)

Targeted engineering corrections only. No new endpoints, product modules, agents, screens or blockchain networks, and no change to the team or timeline. Several corrections make earlier claims weaker and more honest.

| # | Gap in v4.1 | Correction in v4.2 |
|---|---|---|
| 1 | Execution implied one database transaction around external calls | Transition transaction, external call with idempotency, separate outcome transaction; `EXECUTING`, `FAILED`, `UNKNOWN` states and reconciliation (6.2, 8) |
| 2 | Escrow looked neutral | Labelled a buyer-controlled prototype escrow; attestor or dispute mechanism described as future work only (6.7, 6.9, 13, 16) |
| 3 | Supplier ID as a public input did not bind the credential | In-circuit assertion that the credential subject equals the requested supplier (6.6) |
| 4 | `/api/actions/execute` and the escrow endpoints conflicted | Escrow endpoints only prepare transactions for approved actions; `execute` alone submits (6.2, 7) |
| 5 | Wallet registration and signature checks undefined | Proof of address control, CIP-30 `signData` verification, key hash derivation, buyer-key matching; message and transaction signing kept distinct (6.5) |
| 6 | Receipt key bootstrap incomplete | Public-key fingerprint, published in several places and checked by the verifier (6.8) |
| 7 | Refund demo ambiguous | Two separate test escrows: A for live lock and release, B for the pre-tested refund (6.7) |
| 8 | No test for interrupted execution | New P0 test for interruption and idempotent retry (11) |
| 9 | Fallback key claim overstated | A browser-held approval key is not the escrow buyer key, and the receipt must say so (6.5) |

## What changed in v4.1 (from v4.0)

Targeted corrections only. No new product modules, agents, blockchain networks or screens. One endpoint was added (`POST /api/actions/execute`) because evaluation and execution are different operations.

| # | Gap in v4.0 | Correction in v4.1 |
|---|---|---|
| 1 | An on-chain action hash does not prove human approval | Owner wallet signature over the canonical action hash, verified server-side; salted commitment in the escrow **datum** (metadata cannot be enforced by the validator) (6.5, 6.7) |
| 2 | Midnight issuer undefined | One simulated issuer, one credential, one claim, with key, expiry, revocation and replay protection defined (6.6) |
| 3 | Execution-time security gap | Separate evaluate and execute steps; full revalidation and TOCTOU controls; no connector bypass (6.2, 7) |
| 4 | LKR versus test ADA unclear | Explicit rule: test ADA is not payment for the simulated LKR budget (3, 4.3, 10, 16) |
| 5 | Owner identity not secured | Owner derived from a server-side session, never from the frontend (6.1, 9) |
| 6 | Receipt trust model incomplete | Pinned public key, key ID, verification steps, proves/cannot-prove list (6.8) |
| 7 | Three screens not specified | Responsibilities of each screen defined (4.3) |
| 8 | Fallbacks overstated | Each fallback labelled for what it actually demonstrates (13) |

## What changed in v4.0 (from v3)

| Area | Change in v4 |
|---|---|
| Pitch | Leads with the SME benefit (buy from suppliers safely, even when AI does the legwork). The AI trust layer is the differentiator. |
| Target user | Narrowed to one segment: small hotels and guesthouses buying recurring supplies. |
| Adoption evidence | New plan: 3–5 discovery interviews, a one-page evidence summary and a business model (Section 15). |
| Why blockchain | New Section 6.9. The approved action is committed in the Cardano escrow, so settlement is tied to what the owner approved (refined in v4.1). |
| Scope | Simplified: scope-list grants, a rules-based Finance Agent, one demo tenant, three UI screens, refund recorded rather than live. |
| Tests | P0 tests are mandatory; the rest are stretch (Section 11). |
| Risk control | Fallback ladders for Midnight and Cardano with a go/no-go on 28 Nov (Section 13). |
| Timeline | Rebuilt around three parallel tracks: adoption, blockchain and build (Section 14). |
| Submission | New checklist for the repo, documentation, video and deadlines (Section 18). |

------------------------------------------------------------------------

## 1. Executive Summary

**SEYVIXA helps small businesses buy from suppliers safely when AI agents do the legwork.**

An AI procurement team researches suppliers and prepares a purchase. SEYVIXA makes sure the agents stay inside the authority the owner gave them, the owner approves the exact purchase, supplier eligibility is proven without exposing private credentials, payment is held in escrow until the buyer accepts, and a verifiable receipt records what happened.

What makes SEYVIXA different is its **independent trust and control layer for AI agents**. It decides what agents may access, change, approve and spend. The language model never decides its own permissions.

**Claim boundary.**

| Status | Scope |
|---|---|
| Implemented in the MVP | Enforcement for two AI agents (Procurement and Finance) through the gateway |
| Future extension, not built | The same grant-and-gateway model for staff, software and other delegated actors |

Interviews test whether owners would want the extension (Section 15.2), but the prototype does not enforce it.

The MVP demonstrates this through one practical use case: **AI-assisted procurement for a small Sri Lankan hotel or guesthouse**.

A business owner gives an AI procurement team a purchasing task. The agents compare suppliers and prepare a purchase, but they cannot exceed their permissions, access unrelated business data, or spend beyond the approved budget. A privacy-preserving supplier eligibility proof is verified through Midnight, and a Cardano smart contract demonstrates conditional escrow settlement.

**Core promise:** Let AI agents act, but never beyond the authority granted by a human. The same promise for staff and software is a future extension.

### What we are building

A working prototype with five essential technical capabilities:

1.  Human-defined agent permissions.
2.  An independent policy gateway that allows or blocks protected actions.
3.  AI-assisted supplier comparison and purchase preparation.
4.  Privacy-preserving supplier eligibility verification using Midnight.
5.  Cardano testnet escrow and a verifiable transaction receipt.

### What we are also delivering (non-code)

Viability & Adoption and Pitch & Demo together carry 55% of the judging weight, so these are deliverables, not extras:

-   Discovery interviews and a one-page evidence summary.
-   A business model with clearly labelled assumptions.
-   A "why on-chain" explanation for each blockchain component.
-   A public Apache 2.0 repository, documentation and a 2–4 minute demo video.

Everything else is out of scope for this MVP.

### How the MVP maps to the judging criteria

| Criterion (weight) | How SEYVIXA addresses it |
|---|---|
| Innovation (20%) | Independent control of AI agents, linked to private verification and escrow settlement in one workflow. |
| Technical Execution (25%) | Working gateway, atomic budget, exact approval, real Midnight proof, real Cardano escrow, verifiable receipt, test evidence. |
| Viability & Adoption (30%) | A named first user, interview evidence, a payer and revenue model, and a staged adoption path. |
| Pitch & Demo (25%) | One continuous story, a repeatable live demo and a 3-minute video. |

------------------------------------------------------------------------

## 2. The Problem

Businesses increasingly use AI tools to research, communicate, and
automate operational tasks. Giving an AI agent access to business tools
creates a serious control problem:

-   An agent may attempt an action outside its assigned responsibility.
-   Malicious or manipulated content may try to influence an agent into
    exposing sensitive information.
-   Multiple agents may independently commit more money than the
    business has approved.
-   A business may be unable to prove exactly what was authorised,
    executed, or settled.

The problem is not simply that AI can make mistakes. The deeper problem
is that **AI agents can be given access to real tools without a
reliable, independent authority boundary**.

### Who feels this problem first

**Working hypothesis (to be validated by the interviews in Section 15):** small hotels and guesthouses buy guest supplies repeatedly, compare a handful of suppliers, approve spending informally, and have little audit evidence. If an AI assistant prepared those purchases, the owner would need clear limits on what it can see and spend, plus proof of what was approved and paid.

This is a hypothesis, not a validated market. Do not present it as proven.

### Our solution

SEYVIXA places a policy enforcement gateway between AI agents and
protected business tools.

The AI proposes actions. SEYVIXA checks those actions against
human-defined permissions and business rules. Only permitted actions
reach the connected tools.

The language model does not decide its own permissions.

------------------------------------------------------------------------

## 3. MVP Use Case: SME Procurement

**Target segment:** small hotels and guesthouses in Sri Lanka.

A hotel owner needs to purchase 100 guest kits before a specified
deadline.

-   **Budget:** LKR 120,000 (simulated off-chain)
-   **Quantity:** 100 guest kits
-   **Requirement:** Suppliers must satisfy a defined eligibility
    condition
-   **Agents:** Procurement Agent and Finance Agent
-   **Human authority:** The owner approves the final purchase
-   **Settlement demonstration:** Test ADA on Cardano testnet (a mechanics demo, not payment for the LKR purchase)

### User journey

1.  The owner creates a procurement request and sets the budget.
2.  The owner grants the Procurement Agent permission to research
    suppliers and prepare a purchase.
3.  The Finance Agent receives permission to check the budget and
    reserve funds, but not to approve or release payment.
4.  The agents collect and compare supplier quotes.
5.  A malicious instruction hidden in supplier content attempts to make
    an agent access an unrelated file, such as `payroll.csv`.
6.  The agent's attempted tool call passes through SEYVIXA. The gateway
    blocks it because the resource is outside the agent's scope.
7.  SEYVIXA verifies a supplier eligibility claim using a Midnight
    privacy-preserving proof.
8.  The agents prepare a final purchase proposal.
9.  The owner reviews the exact supplier, items, amount, and payment
    action, then approves it by signing the action hash with their wallet.
10. A Cardano testnet escrow contract locks test ADA, with a salted
    commitment to the approved action recorded in the escrow datum. A
    buyer acceptance action triggers release. The refund path is
    tested beforehand on a separate test escrow and shown as a recorded
    transaction.
11. SEYVIXA creates a signed receipt that can be independently verified.
    If the receipt is altered, verification fails.

### Important distinction: simulated LKR budget versus test ADA

-   LKR 120,000 is a **simulated** business budget held in the application database. No LKR is paid or moved.
-   Test ADA exists only on the Cardano testnet and has no monetary value. It is locked in the escrow to demonstrate the escrow mechanics (lock, release, refund).
-   **Test ADA is not the payment for the LKR purchase.** The escrow amount is a fixed demo value chosen by the team. It is not calculated from the LKR price, and the prototype has no exchange rate, currency conversion or fiat settlement.
-   Never say or show that "X ADA equals LKR Y", that ADA "pays" the supplier, or that the purchase was settled in ADA.
-   In the approved action record, the simulated LKR total and the test-ADA escrow amount are separate fields with no conversion between them.
-   The UI, demo and pitch must keep the two separate (labels are defined in Section 4.3).
-   Suggested wording: "The budget is simulated. We use test ADA on Cardano testnet to demonstrate how conditional settlement would work."

------------------------------------------------------------------------

## 4. Product Scope

### 4.1 Features included in the MVP

| Capability | What it does | MVP implementation |
|---|---|---|
| Agent permissions | Defines what each agent may do | Scope-list grants with expiry and revocation, checked server-side |
| Policy gateway | Checks every protected tool action | Separate evaluate and execute steps; execute revalidates everything, then runs as a transition, an idempotent external call and an outcome record; fails closed |
| Procurement agents | Research and compare suppliers | Procurement Agent (LLM-backed) and Finance Agent (rules-based service), each with its own identity and grant |
| Budget guard | Prevents spending beyond the shared budget | Atomic PostgreSQL reservations |
| Purchase approval | Lets the owner approve the exact purchase | Owner wallet signature over the canonical action hash, nonce and expiry, verified server-side |
| Midnight verification | Verifies one supplier eligibility claim privately | One credential, one claim from a simulated issuer, one genuine testnet proof |
| Cardano escrow | Demonstrates conditional settlement | One Aiken validator (buyer-controlled prototype escrow): lock and release live on escrow A, refund recorded on a separate test escrow B; salted commitment to the approved action stored in the datum |
| Verifiable receipt | Records and verifies the outcome | Signed receipt, verifier script with a pinned public key, and tamper detection |
| Adoption evidence (non-code) | Shows who the users are and how the product is sustained | 3–5 interviews, one-page summary, business model |

### 4.2 Explicitly out of scope

Do not build these for the competition MVP:

-   A general-purpose personal AI security platform.
-   A large agent marketplace or agent registry.
-   Complex multi-level delegation graphs.
-   A full policy studio or visual workflow builder.
-   Advanced risk scoring or supplier reputation networks.
-   Multiple payment providers or real-money payment processing.
-   Multi-chain bridges or atomic cross-chain transactions.
-   Advanced dispute resolution and partial milestone settlement.
-   Automated recovery agents and complex incident orchestration.
-   Full A2A protocol support unless it is already required by the working demo.
-   Multi-tenant isolation beyond owner-scoped queries (one demo tenant is enough).
-   Cryptographic signing of permission grants (stretch goal only).
-   More than two agents, or an LLM-backed Finance Agent.
-   A live refund transaction during the demo.
-   More than three UI screens.

These may be future roadmap items. They are not MVP deliverables.

### 4.3 The three screens

The MVP has exactly three screens in one application, with one navigation bar, one login session and one workflow progress indicator. They are three connected views of the same procurement workflow, not separate products.

| Screen | Responsibility | What it shows |
|---|---|---|
| 1. Procurement Workspace | Create and follow the procurement request; compare suppliers; show what the agents are doing | Request form (items, quantity, deadline, simulated LKR budget); supplier quote comparison with price, delivery and eligibility status; agent activity feed (proposals and tool calls) |
| 2. Trust & Approval Centre | Show and control authority and spending; approve the purchase | Agent permissions (scopes, expiry, revoke); gateway decision log (`ALLOW`, `DENY`, `APPROVAL_REQUIRED` with reason codes); budget gauge and reservations; exact purchase approval with action details, action hash and wallet signing |
| 3. Settlement & Proof Centre | Show the independent evidence | Midnight eligibility verification (challenge, proof, result) with a two-column panel (what the verifier learns, what stays private); Cardano escrow (lock, release, refund status, transaction IDs, explorer links); receipt generation, verification and the tamper test |

Connection rules:

-   A workflow stage indicator runs across all screens: Request, Quotes, Eligibility, Approval, Escrow, Receipt.
-   Screens link to each other: a supplier's eligibility status opens Screen 3; a denied agent action links to its entry in the Screen 2 log; a completed approval on Screen 2 leads to the escrow on Screen 3.
-   Every screen shows two persistent labels: "Simulated LKR budget — not real money" and "Cardano testnet — test ADA has no monetary value".
-   LKR amounts and test ADA amounts appear in separate fields and are never shown as a conversion.
-   Fallback labels from Section 13 appear on the relevant screen, so the UI never shows more than is implemented.
-   No additional dashboards or screens.

------------------------------------------------------------------------

## 5. System Architecture

``` text
                    BUSINESS OWNER
                          |
                  Procurement Request
                          |
                          v
                 SEYVIXA APPLICATION
                          |
              +-----------+-----------+
              |                       |
              v                       v
       PROCUREMENT AGENT         FINANCE AGENT
              |                       |
              +-----------+-----------+
                          |
                    Proposed Action
                          |
                          v
                SEYVIXA POLICY GATEWAY
                /        |           \
               /         |            \
          Permission   Budget       Approval
            Check      Check         Check
               \         |            /
                +--------+-----------+
                          |
                 ALLOW / DENY / APPROVAL
                          |
                          v
                 PROTECTED CONNECTORS
                 /         |          \
             Supplier   Business     Settlement
              Tools       Data          Flow
                          |
               +----------+----------+
               |                     |
               v                     v
        MIDNIGHT TESTNET       CARDANO TESTNET
       Supplier Eligibility   Conditional Escrow
               |                     |
               +----------+----------+
                          |
                          v
                SIGNED VERIFIABLE RECEIPT
```

### Architecture rules

-   Agents must not hold unrestricted connector credentials.
-   Every protected action must pass through the policy gateway.
-   The gateway, not the LLM, makes the allow/deny decision.
-   If policy evaluation fails or is unavailable, protected actions fail
    closed.
-   The database is the source of truth for workflow state and budget
    reservations. External calls are not part of database transactions;
    they run with idempotency keys and are reconciled (Section 6.2).
-   Midnight and Cardano are independently verified systems. A backend
    workflow coordinates them; there is no claim of atomic cross-chain
    execution.
-   Do not store personal or confidential business data directly
    on-chain.
-   Record a salted commitment to the approved action in the Cardano
    escrow datum, not in metadata (the validator cannot see metadata).
    The owner's signatures, not the commitment alone, prove approval.
-   Derive the owner's identity from an authenticated server-side
    session. Never trust an owner ID supplied by the frontend.
-   Only the gateway can execute protected actions or submit blockchain
    transactions. Agents hold no connector credentials and cannot reach
    connectors directly.
-   Use test networks only. Never commit seed phrases or private keys.

### Suggested technology stack

| Layer | Suggested technology |
|---|---|
| Frontend | React / Next.js, three screens |
| Backend API | Node.js + TypeScript |
| Database | PostgreSQL (Docker for local and demo use) |
| Agent orchestration | TypeScript workflow: one LLM-backed agent, one rules-based agent |
| Policy engine | Small custom policy service for the MVP |
| Midnight | Compact + Midnight.js, one pinned toolchain version; tNIGHT from the Preview or Preprod faucet and DUST for fees |
| Cardano | Aiken validator, Mesh SDK for transactions, Blockfrost or Demeter for chain data; test ADA from the testnet faucet; Lace or Eternl wallet |
| Owner approval | Cardano wallet message signing (CIP-30 `signData`, CIP-8) for approvals and `signTx` for transactions, for example through the Mesh SDK and its signature-check helpers if available in the pinned version |
| Receipt signing | Ed25519 with a server-held key; the SHA-256 fingerprint of the public key is published in several places and checked by the verifier |
| Deployment | One application deployment with environment-based configuration |

Use tools the team can implement and debug confidently. Do not introduce a new framework unless it solves a concrete MVP requirement.

------------------------------------------------------------------------

## 6. Core Components

### 6.1 Agent Permissions

The owner grants each agent a limited permission set.

Example:

**Procurement Agent** - May search supplier information. - May read
supplier quotes. - May compare prices and availability. - May prepare a
purchase proposal. - May not read payroll or unrelated employee
records. - May not approve or execute payment.

**Finance Agent** - May read the procurement budget. - May create a
budget reservation. - May check whether a proposed purchase is within
budget. - May not change the approved budget. - May not approve its own
reservation or release escrow.

A permission grant should contain:

-   Grant ID
-   Owner/user ID
-   Agent ID
-   Allowed tools and resource scopes
-   Maximum spend, if applicable
-   Expiry time
-   Issuer
-   Signature or trusted server-side integrity protection
-   Revocation status

For the MVP, use simple scope-list grants stored in the database with
server-side integrity protection, rather than building a complex
delegation graph. Cryptographic signing of grants is a stretch goal.

**Owner and agent identity.** The demo owner authenticates to a server-side session (for example a seeded login using the framework's standard session handling, with an HttpOnly session cookie). Every owner request derives `owner_id` from that session. Any `owner_id` in a request body or URL is ignored or rejected, and every owner-scoped query filters by the session's owner ID. The owner's approval public key is registered on the owner record at setup. Agents authenticate with their own agent credentials, never with the owner session, and can never approve.

### 6.2 Policy Gateway

This is the most important SEYVIXA component.

Every protected tool call must be sent to the gateway before execution.

The gateway checks:

1.  Is the agent registered and active?
2.  Does it have a valid permission grant?
3.  Is the requested tool allowed?
4.  Is the requested resource within scope?
5.  Does the action exceed a spending limit?
6.  Is human approval required?
7.  Is the grant still valid at execution time?

The gateway returns one of:

-   `ALLOW`
-   `DENY`
-   `APPROVAL_REQUIRED`

Example denial:

``` json
{
  "decision": "DENY",
  "reason_code": "RESOURCE_OUT_OF_SCOPE",
  "agent_id": "procurement-agent",
  "requested_resource": "payroll.csv",
  "message": "The agent is not authorised to access this resource."
}
```

The gateway must enforce the decision. Returning `DENY` in an API
response is not enough if the agent can still call the connector
directly.

**Evaluate and execute are separate steps.**

-   `POST /api/actions/evaluate` is a preflight with no side effects. For an `ALLOW` it stores an immutable action record (the canonical payload and its SHA-256 action hash, computed server-side) and returns a short-lived, single-use execution ticket bound to the action hash, the caller (an agent, or the owner session for owner-initiated escrow actions) and the policy version.
-   `POST /api/actions/execute` is the only path that can reach a protected connector. The caller sends only the ticket and the action ID (for owner-signed escrow transactions, also the signed transaction, which the gateway checks against the stored action before submission). The gateway loads the stored payload and never executes a payload supplied by the caller at execution time.
-   An `ALLOW` at evaluation time is never trusted at execution time.

**Revalidation at execution.** Immediately before executing, the gateway independently rechecks, from current database state:

1.  the agent is registered and active;
2.  the grant exists, has not expired and has not been revoked;
3.  the tool and resource are within the grant scope;
4.  the spending limit is not exceeded;
5.  where approval is required, it is valid: for the purchase, the owner's message signature matches the stored action hash, is unexpired and has not been used; for release and refund, the owner's transaction signature is on the exact stored transaction;
6.  an active budget reservation exists for this action and amount;
7.  the policy version is current and the ticket is unexpired, unused and bound to this action hash.

**Closing the time-of-check/time-of-use (TOCTOU) gap.**

-   Actions are immutable. Changing any material field creates a new action with a new hash, which needs a new evaluation and a new approval.
-   A PostgreSQL transaction protects database state only. It cannot atomically include a call to an external connector or a blockchain. Execution is therefore split into three phases, and the external call runs outside any database transaction.

1.  **Transition (transaction 1).** Lock the action, grant, reservation and approval rows (`SELECT … FOR UPDATE`), repeat all the checks above, and in the same transaction: move the action from `APPROVED` to `EXECUTING`, consume the ticket and bind the approval to this action (`… WHERE used_at IS NULL`), and store the idempotency key and, for a blockchain call, the transaction ID computed from the signed transaction before submission. Commit. No locks are held after the commit.
2.  **External call (no database transaction).** Call the connector or submit the transaction using the idempotency key. The stored payload never changes.
3.  **Outcome (transaction 2).** Record the result: `SUCCEEDED` (the budget reservation becomes `COMMITTED`), `FAILED` when the connector or chain definitively shows that nothing took effect (the reservation becomes `RELEASED`), or `UNKNOWN` when the result cannot be determined (timeout, crash or lost response).

| Action state | Meaning | Next states |
|---|---|---|
| `PENDING_APPROVAL` | Evaluated; waiting for the owner's approval | `APPROVED` |
| `APPROVED` | Evaluated and approved; not started | `EXECUTING` |
| `EXECUTING` | Transition committed; the external call may or may not have happened | `SUCCEEDED`, `FAILED`, `UNKNOWN` |
| `UNKNOWN` | Outcome not determined; needs reconciliation | `SUCCEEDED`, `FAILED` |
| `SUCCEEDED` | Effect confirmed (for a blockchain call, confirmed on testnet) | terminal |
| `FAILED` | Confirmed no effect; a new action and a new approval are needed to try again | terminal |

**Retry and reconciliation.** Reconciliation runs when an action is retried and when the gateway starts (for actions left in `EXECUTING` or `UNKNOWN`). It needs no separate worker or module.

-   A retry uses the same action ID, payload hash and idempotency key. It needs no new approval and can never change the payload.
-   Reconcile before resending anything.
    -   Blockchain call: the transaction ID is already stored, so query the chain-data API. If the transaction is confirmed, the outcome is `SUCCEEDED`. If it is not found and its validity window (TTL, set short) has passed, it can never be included, so the outcome is `FAILED`. If it is not found and the window is still open, resubmitting the identical signed transaction is safe because the transaction ID is the same. Never build a second transaction for the same action.
    -   Connector call: send the same idempotency key. The connector must return the stored result for a repeated key. Read-only calls are safe to repeat.
-   Resend only if reconciliation shows the effect has not been applied and the grant and agent are still valid. Otherwise do not resend. The action stays `UNKNOWN` until reconciliation can show the outcome (for a blockchain call, until the validity window has passed).
-   While an action is `UNKNOWN`, its budget reservation stays held.

**Remaining window.** A revocation that lands after the transition commits cannot stop a call already in flight. This is an accepted limitation of the prototype. The gateway logs it and blocks any retry or resend.

**No bypass.**

-   Connector credentials and protected data (for example `payroll.csv`) are held only by the gateway and the connector services. Agents hold only their own gateway credential. The chain-data API credentials used to submit Cardano transactions are also held only by the gateway; the owner's wallet signs but never submits.
-   Connectors accept calls only from the gateway (a service-to-service credential or an internal-only network). The agent runtime has neither.
-   The demo and the P0 tests include an agent attempting a direct connector call, which must fail.

### 6.3 Procurement Agents

Build only two agents.

**Procurement Agent** - Understands the purchase request. - Collects
supplier quotes. - Compares supplier price, delivery, and eligibility
status. - Recommends one supplier. - Prepares a purchase proposal.

**Finance Agent** - Checks the available procurement budget. - Reserves
funds for an eligible proposal. - Rejects reservations that would exceed
the shared budget.

Agents can recommend and prepare. They cannot grant themselves
permissions or approve their own high-impact actions.

**Implementation note:** only the Procurement Agent needs a real LLM,
because it is the agent exposed to untrusted supplier content. The Finance
Agent can be a rules-based service. It still has its own identity and
grant, and every one of its protected actions still goes through the
gateway.

### 6.4 Budget Guard

The budget must be shared across agents.

Example:

-   Approved budget: LKR 120,000
-   Agent A requests a reservation of LKR 70,000.
-   Agent B requests a reservation of LKR 65,000 at nearly the same
    time.
-   Only one reservation may succeed if accepting both would exceed the
    budget.

Implement reservations in PostgreSQL using a transaction and row-level
locking or an equivalent serialisable strategy.

Do not implement this as a simple frontend check. Two concurrent
requests can both pass a non-atomic balance check.

The Finance Agent's `reserveBudget` tool uses `POST /api/budget/reservations`. It is a database-only operation: it authenticates the agent, runs the same policy checks as evaluate, writes a policy event, and calls `BudgetGuard.reserve` with an idempotency key. No ticket is needed. Execute later checks that the reservation is active.

### 6.5 Exact Purchase Approval

Before payment or escrow creation, show the owner exactly what will
happen:

-   Supplier identity
-   Items and quantity
-   Total amount
-   Budget impact
-   Payment or escrow destination
-   Relevant quote reference

The owner approves this exact action.

Create a canonical representation of the action and calculate its hash.
Bind approval to:

-   Owner (user), taken from the authenticated session
-   Supplier/payee
-   Items and quantity
-   Amount and currency
-   Action hash
-   Expiry
-   One-time nonce

If any material field changes, the approval is invalid and must be
requested again. The gateway rechecks the approval and policy at
execution time (Section 6.2).

**Canonical action.** The server builds one immutable action record and computes `action_hash = SHA-256(canonical JSON)`, using a deterministic canonical form (sorted keys, no extra whitespace, UTF-8, for example RFC 8785). The record contains the procurement ID, owner ID, supplier/payee, items and quantity, the simulated LKR total, the settlement asset (`tADA`) with a fixed demo escrow amount as a separate field, the escrow script address, the refund deadline, the expiry and the nonce. It has no LKR-to-ADA conversion field. The agent never supplies the hash.

**Owner signature.** The owner signs the message `{domain: "seyvixa-approval-v1", action_hash, nonce, expires_at}` with the wallet registered for the owner (CIP-30 `signData`, CIP-8 message signing). The server verifies it in `POST /api/approvals`.

**Wallet registration (once, at setup).** The aim is to prove that the owner controls the key behind the registered address.

1.  The owner connects a Cardano testnet wallet through CIP-30 and selects a payment address. It must be a key-hash address; script addresses are rejected.
2.  The server issues a single-use registration challenge (random nonce, domain `seyvixa-register-v1`, the session's owner ID, short expiry), stored in `challenges`.
3.  The wallet signs the challenge with `signData(address, payload)`. The result is a COSE_Sign1 signature and a COSE_Key that contains the public key (CIP-8).
4.  The server verifies the signature (see below), marks the challenge used, and stores `owner_address`, `payment_pubkey` and `payment_key_hash` on the owner record. Nothing is taken from the request except the signature itself.

**Signature verification (at registration and at every approval).** Use a maintained helper if the pinned toolchain has one (for example in the Mesh SDK) and test it with a real wallet signature. Otherwise implement these checks:

1.  Decode the COSE_Sign1 and COSE_Key. The algorithm must be EdDSA (Ed25519). Take the 32-byte public key from the COSE_Key.
2.  Check that the address in the COSE_Sign1 protected header equals the registered address (at registration, the address the owner selected).
3.  Check that the payload bytes equal the expected message exactly: the challenge, or the approval message the server builds from the stored action.
4.  Verify the Ed25519 signature over the COSE `Sig_structure` (context `Signature1`, the protected header, empty external data and the payload).
5.  Derive the payment key hash as the Blake2b-224 hash of the public key, and check that it equals the payment credential inside the address. At approval time, also check that it equals the stored `payment_key_hash`.
6.  Check that the nonce is unused and unexpired, then mark it used atomically.

Never use a key, address or key hash supplied in the request.

**Message signing and transaction signing are different.**

| | Approval message | Escrow transaction |
|---|---|---|
| Wallet call | `signData` | `signTx` (the wallet signs but does not submit) |
| What is signed | The approval message with the action hash, nonce and expiry | The specific transaction body |
| Checked by | The server (steps above) | The gateway before submission, and the validator on-chain |
| What it shows | The key holder approved this exact action off-chain | The key holder authorised this exact on-chain transaction |

-   Never ask the wallet to sign a transaction hash with `signData`, and never treat an approval signature as a transaction authorisation or the reverse. The domain tags keep approval messages distinct from other messages.
-   The purchase approval uses the message signature. For release and refund, the owner's transaction signature on the exact stored transaction is the approval, and the validator enforces it on-chain.

**Matching the registered identity to the escrow buyer key.** The server builds every escrow transaction from the stored action and takes the buyer key hash from the owner record. Before submitting, the gateway checks that the script output's inline datum has `buyer = payment_key_hash`, that the transaction carries a valid witness from that key, and, for release and refund, that the key hash is listed in the transaction's required signers. The receipt verifier repeats the equality check between the approval key hash and the buyer key hash in the on-chain datum.

If wallet message signing blocks the build, fall back to a browser-held Ed25519 demo approval key registered at setup and labelled as a demo key. In this fallback the approval key is **not** the escrow buyer key, so the receipt cannot show that equality. The receipt must say "approval key not bound to escrow buyer key (fallback)", and the claim reduces to "the holder of the demo key approved this action".

The approval signature shows that the holder of the registered owner key approved this exact action. It does not identify a real person beyond control of that key.

### 6.6 Midnight: Supplier Eligibility Proof

Use Midnight for **one credential and one eligibility claim**.

**Issuer.** The issuer is a **simulated authority**, the "SEYVIXA Demo Supplier Registry", operated by the team for the prototype. It is not a real recognised organisation and must be labelled as simulated in the UI, README and demo. In a real deployment the issuer would be an organisation that buyers trust, such as a trade or licensing body, and that issuer's integrity would be the trust anchor. The issuer key is a demo key and must not be reused elsewhere.

**Credential.** One type, "Registered Supplier (simulated)", issued by a seed script to each mock supplier. Fields: `subject_id` (the identifier SEYVIXA uses for that supplier in its own records and quotes), credential identifier, issue date and expiry date. The issuer's attestation (signature or registry entry) covers every field, including `subject_id`, so the subject cannot be changed without invalidating the credential.

**Subject binding.** The proof must be cryptographically bound to the supplier being evaluated. Listing the supplier ID as a public input is not enough, because it would let any supplier present someone else's valid credential for any supplier ID.

-   The backend sets `supplier_id` from its own quote record, never from the party submitting the proof, and passes it as a public input.
-   The credential, including its `subject_id`, is a private witness that the circuit checks against the issuer attestation.
-   The Compact circuit asserts `credential.subject_id == supplier_id`. Without this assertion, the proof does not show that the quoted supplier is eligible.
-   Stretch, only if simple in the pinned toolchain: also require a holder secret whose commitment is part of the credential, so a leaked credential cannot be used by someone else. This is not required for the MVP.

**Claim proven.** "The supplier identified by `supplier_id` holds a credential issued to that subject by the allowlisted issuer, not expired as of the verification date."

**Issuer verification key.** The issuer's public verification key (or a registry commitment derived from it, depending on what the pinned toolchain supports) is fixed in the contract at deployment and in the backend allowlist. A credential from any other issuer fails verification. Choose the simplest mechanism that works in the 28 Nov spike.

**Expiry.** The expiry date is a private field checked against a public verification date supplied by the backend. That date is the backend's clock, not an independent time source.

**Revocation (stretch).** Preferred approach: the proof checks membership in the issuer's current registry commitment, so removing a credential from the registry revokes it. If this is not practical in the time available, state plainly that revocation is not supported in the prototype. Do not imply it.

**Replay protection.** `POST /api/suppliers/:id/verify` has two modes. Without a proof it issues a single-use challenge (random nonce bound to the procurement ID and supplier ID, with a short expiry). With a proof it verifies it. The proof must include the challenge as a public input. The backend rejects expired, unknown, mismatched or already-used challenges and marks a challenge used atomically, so a proof for one procurement cannot be reused for another.

**What the verifier learns and what stays private.** Screen 3 shows this as a two-column panel.

| The verifier learns (public) | Stays private |
|---|---|
| `supplier_id`, the issuer reference, the verification date, the challenge, and the result (valid or not) | The credential identifier, the issue and expiry dates, and the other credential details |

At fallback Levels 2 and 3 the panel must show the fallback label and must not present simulated data as a Midnight result.

**What this proves and what it does not.**

-   It proves that the requested supplier holds a valid, unexpired credential from the allowlisted issuer, without revealing the credential's other private fields.
-   It does **not** prove that the information in the credential is true in the real world, or that the issuer was honest or careful.
-   In the prototype the issuer is simulated, so the demo shows the privacy mechanism, not real supplier eligibility.

Use one compatible, pinned Midnight toolchain. Verify the current official compatibility matrix before implementation; do not mix package versions from different releases.

### 6.7 Cardano: Conditional Escrow

Use Cardano testnet to demonstrate a simple escrow lifecycle with one small validator:

1.  Create an escrow for the approved purchase.
2.  Lock test ADA at the validator address with an inline datum.
3.  Release funds when the buyer accepts. The validator requires the buyer's signature and payment to the supplier.
4.  Refund after the refund deadline. The validator requires the deadline to have passed and the buyer's signature.

**Buyer-controlled prototype escrow, not neutral.** In this validator the buyer alone decides both outcomes. Release needs the buyer's signature, and refund needs only the deadline and the buyer's signature. The supplier has no protection: a buyer could withhold acceptance and refund after the deadline even if the goods were delivered. This prototype shows escrow mechanics (locking, release and refund conditions enforced on-chain), not neutral dispute resolution, and must be labelled "buyer-controlled prototype escrow" in the UI, README, demo and pitch. A real deployment would need a mutually agreed attestor (for example a third key in the datum that can authorise release) or a dispute mechanism (for example an arbiter or multi-signature resolution). That is future work and not part of the MVP.

**Datum versus transaction metadata.**

-   The **datum** is part of the script output and is visible to the validator. Any condition the validator must enforce has to be in the datum.
-   **Transaction metadata** is attached to the transaction. Wallets, explorers and the backend can read it, but the validator cannot. It cannot enforce anything. Use it only as an optional label for explorers.

**Datum fields (all public on-chain):** buyer key hash (the owner's wallet), supplier key hash, locked test-ADA amount (the fixed demo value), refund deadline and the action commitment. Put no personal or confidential business data on-chain.

**Validator rules.**

-   Release: signed by the buyer key, and an output pays at least the locked amount to the supplier key hash.
-   Refund: the transaction validity range starts after the deadline, it is signed by the buyer key, and an output pays the buyer.
-   The validator does not interpret the action commitment. Carrying it in the datum fixes it at lock time. It cannot change without spending the escrow.

**Salted commitment.** A plain hash of a predictable purchase (for example a known supplier, 100 kits and a likely price) can be guessed and confirmed by anyone. Store `action_commitment = SHA-256("seyvixa-commit-v1" || action_hash || salt)` with a random 32-byte salt. The salt is kept in the database and in the receipt and is never put on-chain. Anyone given the receipt can recompute the commitment and compare. The amount, buyer key hash and supplier key hash remain public, because the transaction itself is public.

**What binds the owner to the escrow.** Two signatures together, not the commitment alone:

1.  the owner's signature on the action hash (Section 6.5);
2.  the owner's wallet signature on the lock transaction, whose datum carries the commitment.

The buyer key hash in the datum must equal the hash of the registered owner key. Before submitting the lock transaction, the gateway checks that its script output, datum, amount and keys match the approved action.

**Demo scope: two separate test escrows.** A UTxO can be spent only once, so release and refund cannot both happen on the same escrow.

-   **Escrow A (the demo purchase):** locked and released live. This is the escrow the receipt covers.
-   **Escrow B (refund test):** a separate test escrow created before the demo with the same validator and a short refund deadline. Its refund transaction is executed and checked in advance, then shown as a recorded transaction with its explorer link, labelled "separate test escrow, refund path test". It is not part of the live purchase or its receipt.
-   **Rejection evidence (escrow B, optional):** before running the real refund, attempt a release without the buyer's signature and a refund before the deadline. Use the chain-data API's transaction evaluation (or the node's rejection on submit) to capture each failure, and use test ADA only. Save short evidence clips for the evidence folder. The release-without-signature clip may be shown in the demo **only if** the matching P1 test (Section 11) passed on testnet at Cardano Level 1 or 2 and the rejection was actually captured. At Level 3 there is no validator, so there is nothing to reject. In that case omit the clip and do not claim on-chain enforcement.

**Do not claim that Cardano can detect physical delivery.** The blockchain verifies a transaction and the conditions encoded in the validator. Delivery acceptance must come from the buyer or a clearly identified trusted attestor.

The backend must verify the actual network and transaction state. Do not accept a frontend flag such as `payment_verified: true` as proof of settlement.

### 6.8 Verifiable Receipt

After the workflow, generate a receipt containing the important evidence:

-   Metadata: `schema_version` (`receipt.v0`), `view` (`full` or `verification`), `receipt_id`, `created_at`, `kid`, `signature`
-   `procurement_id`
-   `approved_action` (full view only) and its `action_hash`
-   Approval: `nonce`, `expires_at`, `owner_key_hash`, and the owner's approval signature
-   `commitment_salt` (needed in both views to check the on-chain commitment)
-   Chain evidence: `network`, `script_address`, `escrow_utxo_ref` (the lock transaction ID and output index), `lock_tx_id`, `locked_lovelace`, `outcome` (`locked`, `released` or `refunded`), and `release_tx_id` (when released) or `refund_tx_id` (when refunded)
-   Midnight evidence: `supplier_id`, `challenge_id`, `verification_reference`, `result`
-   Policy summary: the full view lists decisions (agent, action type, resource, reason code). The verification view lists counts and reason codes only.

**Receipt views and privacy.** The generator produces two signed receipts from the same stored data, using a `view` parameter on the existing `generateReceipt(procurementId, view)`. Both use the same key and the same schema, which has a `view` discriminator.

| Field group | Fields | Sensitivity | Full view | Verification view | Publish openly? |
|---|---|---|---|---|---|
| 1. Metadata | `schema_version`, `view`, `receipt_id`, `created_at`, `kid`, `signature` | Public-safe | Yes | Yes | Yes |
| 2. On-chain evidence | `network`, `script_address`, `escrow_utxo_ref`, `lock_tx_id`, `release_tx_id` or `refund_tx_id`, `locked_lovelace`, `outcome` | Already public on the blockchain | Yes | Yes | Yes (publishing it links the receipt to these on-chain items) |
| 3. Binding evidence | `action_hash`, `nonce`, `expires_at`, `owner_key_hash`, approval signature, `commitment_salt` | Linkable. Lets anyone connect the receipt to the escrow and test guesses about the action | Yes | Yes | No |
| 4. Midnight evidence | `supplier_id`, `challenge_id`, `verification_reference`, `result` | Links a supplier to a procurement | Yes | Yes | No |
| 5. Policy summary | Decisions with agent, action type, resource name and reason code | Resource names and grants can be confidential | Full detail | Counts and reason codes only | No |
| 6. Business details | `approved_action` (supplier, items, quantities, simulated LKR total and prices, deadlines), budget figures, quote contents | Confidential business information | Yes | **No** | **No** |
| 7. Never in any receipt | Credential private fields, private keys, seed phrases, API keys, session data | Secret | Never | Never | Never |

**What can safely be shared externally.**

-   **Openly** (public repository, README, video): group 1 and 2 fields, the verifier's output, and sample receipts generated from simulated demo data only.
-   **With a counterparty, auditor or verifier who needs it:** the verification view.
-   **Owner only (and auditors under agreement):** the full view.

**Independent verification without unnecessary disclosure.** The verification view contains everything needed for checks 1 to 6 below. It does not reveal what was bought. A verifier can confirm that the on-chain escrow commits to the action the owner signed (by hash), but cannot see the action's content. To check that `action_hash` matches specific purchase details, use the full view, which lets the verifier recompute the hash.

**Limits.** The verification view publishes `action_hash`, the nonce and the expiry together. Someone who can guess the entire action could confirm the guess against the hash, so the verification view is not for open publication. The schema rejects a verification view that contains group 6 fields or resource names.

**Trusted key and fingerprint.** SEYVIXA signs receipts with one Ed25519 receipt-signing key, generated once before the demo is recorded.

-   The **fingerprint** is the SHA-256 hash of the raw 32-byte public key, in lowercase hex. The `kid` is its first 16 characters.
-   The public key is committed in the repository (for example `keys/receipt-signing-public.json`).
-   The full fingerprint is also published in at least two places that do not depend on that file: the README, and the submission documentation or the demo video or slide.
-   The verifier is given the trusted fingerprint as a configuration constant or a command-line argument, copied from the published source and never from a receipt. It loads the public key, recomputes the fingerprint and stops if it differs from the trusted one.
-   The receipt carries only the `kid`, which must match the trusted fingerprint's prefix. A receipt that embeds its own public key, names a different `kid` or uses another algorithm is rejected.
-   The private key stays on the server and is never committed. Do not regenerate the key after publishing the fingerprint. If it is lost, publish a new fingerprint and re-issue receipts.

This is a simple trust anchor for the prototype. It holds only if the fingerprint is copied from a channel that an attacker did not also alter. There is no key rotation, revocation list or transparency log, and a verifier who trusts only the repository trusts whoever controls it.

**Verification steps (verifier script).**

1.  Load the public key, recompute its fingerprint and compare it with the trusted fingerprint. Validate the receipt against the schema for its `view`. Canonicalise the payload and verify the signature.
2.  Verify the owner's approval signature over `{domain, action_hash, nonce, expires_at}`. Confirm that `owner_key_hash` equals the buyer key hash in the on-chain datum (or report the "approval key not bound to escrow buyer key (fallback)" label). In the full view, also recompute `action_hash` from `approved_action`.
3.  **Lock transaction.** Through a chain-data API, confirm that `lock_tx_id` is confirmed on the expected network, that the output at `escrow_utxo_ref` sits at `script_address` with the stated amount, and that its inline datum carries the buyer key hash, supplier key hash, amount, refund deadline and commitment.
4.  Recompute the action commitment from `action_hash` and `commitment_salt` and compare it with the datum. (At Cardano fallback Level 3, the commitment is read from metadata.)
5.  **Settlement.**
    -   `released`: confirm `release_tx_id` is confirmed on the expected network, that one of its inputs is exactly `escrow_utxo_ref` (the escrow UTxO was spent by this transaction), that an output pays at least the locked amount to the supplier key hash from the datum, and that the buyer key hash is among its required signers.
    -   `refunded`: the same checks with `refund_tx_id`, an output paying the buyer key hash, and a validity range that starts after the refund deadline.
    -   `locked`: there is no settlement transaction. Report "locked, not settled" and make no release claim.
6.  Check the Midnight verification reference where the toolchain allows independent checking. Otherwise state that this item rests on SEYVIXA's signature.

The result is `VERIFIED`, `REJECTED` (any check fails) or `UNVERIFIABLE` (a chain API could not be reached). `UNVERIFIABLE` is never reported as `VERIFIED`. A receipt is rejected if its outcome says `released` but no release transaction exists, if the release transaction does not spend the escrow UTxO, if the network differs, or if the supplier payment output is missing. A hash by itself does not prove that an event happened.

**What the receipt proves.**

-   SEYVIXA's trusted key signed this record, and it has not been altered since.
-   The holder of the registered owner key signed approval of this exact action.
-   A confirmed testnet escrow exists whose datum commits to that action.
-   If the outcome is `released`: a confirmed transaction signed by the buyer key spent that escrow UTxO and paid at least the locked test-ADA amount to the supplier key hash from the datum. This does not prove that goods were delivered.

**What the receipt cannot prove.**

-   That the policy decisions and logs are complete or honest. They are attested only by SEYVIXA's signature, so SEYVIXA remains a trusted party.
-   That the goods were delivered or are of the stated quality, or that the escrow outcome was fair to the supplier. The prototype escrow is buyer-controlled.
-   That the supplier's credential reflects real-world facts, or that the Midnight issuer is honest (the issuer is simulated).
-   That a real person, rather than the key holder, gave the approval.
-   That any real LKR payment happened. The LKR budget is simulated and test ADA is not payment for it.

**Open receipt format (v0).** Publish the receipt layout as a documented, versioned format in the repository: `docs/receipt-spec-v0.md` (including the field classification table above), a JSON Schema (`schemas/receipt.v0.schema.json`, covering both views) and the verifier CLI, which also validates a receipt against the schema. Label it "v0, prototype format". It is not a standard, and no other tool uses it yet. Its purpose is to support the staged adoption path (Section 15.4, stage 2). The repository and the submission contain only receipts generated from simulated demo data.

### 6.9 Why Cardano and Midnight

The gateway and budget guard are off-chain by design: they must be fast, private and enforceable. The blockchains are used only where independent verification between parties adds value.

| Component | Problem it solves | Without blockchain |
|---|---|---|
| Cardano escrow (buyer-controlled prototype) | A validator, not the platform, holds the funds and enforces the release and refund rules. The buyer still controls acceptance, so the supplier relies on the buyer unless a future attestor or dispute mechanism is added | Funds depend on one party or the platform |
| Midnight eligibility proof | Supplier proves it meets the condition without exposing its credential or trade data | Documents are shared with the platform and every buyer |
| Salted action commitment in the escrow datum, plus the owner's signatures | Locked funds are tied to exactly what the owner signed for, without exposing purchase details | The record lives in a database that SEYVIXA controls |

Use one sentence per row in the demo video. Do not say the blockchain makes the AI safe; the gateway does that. The blockchain makes settlement and eligibility independently verifiable.

------------------------------------------------------------------------

## 7. Minimal API Design

Keep the API small. These endpoints are the complete allowed set;
implement only what the actual workflow needs. Do not add endpoints.

  -----------------------------------------------------------------------------
  Method                  Endpoint                      Purpose
  ----------------------- ----------------------------- -----------------------
  `POST`                  `/api/procurements`           Create a procurement
                                                        request

  `GET`                   `/api/procurements/:id`       Retrieve request and
                                                        workflow status

  `POST`                  `/api/agents/:id/grants`      Create an agent
                                                        permission grant

  `POST`                  `/api/actions/evaluate`       Evaluate a proposed
                                                        protected action

  `POST`                  `/api/actions/execute`        Revalidate and execute
                                                        an evaluated action

  `POST`                  `/api/quotes`                 Submit or store a
                                                        supplier quote

  `POST`                  `/api/budget/reservations`    Reserve budget
                                                        atomically

  `POST`                  `/api/approvals`              Submit the owner's signed
                                                        approval of an exact
                                                        purchase action

  `POST`                  `/api/suppliers/:id/verify`   Verify supplier
                                                        eligibility proof

  `POST`                  `/api/escrows`                Prepare the escrow lock
                                                        transaction for an
                                                        approved action

  `POST`                  `/api/escrows/:id/release`    Prepare the release
                                                        transaction for an
                                                        approved action

  `POST`                  `/api/escrows/:id/refund`     Prepare the refund
                                                        transaction for an
                                                        approved action

  `GET`                   `/api/receipts/:id/verify`    Verify the final
                                                        receipt
  -----------------------------------------------------------------------------

All endpoints that change state must authenticate the caller (owner
session or agent credential), derive owner identity from the session,
enforce idempotency where appropriate, and record an audit event.
`POST /api/actions/execute` is the only endpoint that may invoke a
protected connector or submit a blockchain transaction. The three escrow
endpoints only prepare unsigned transactions. Each requires an
`action_id` that has been evaluated, builds the transaction from the
stored action (never from request fields), and returns it for the owner's
wallet to sign. The wallet signs but does not submit. The signed
transaction goes to `/api/actions/execute`, which checks it against the
stored action and submits it. Escrow lock, release and refund are
therefore ordinary protected action types (`ESCROW_LOCK`,
`ESCROW_RELEASE`, `ESCROW_REFUND`) that pass through the same
evaluation, approval and execution boundary. Login uses the framework's
standard session handling and is not counted as a product API.

Do not build a separate API for every conceptual module in the original
blueprint. These are workflow endpoints, not a microservice-per-feature
architecture.

------------------------------------------------------------------------

## 8. Data Model

Use a small relational schema.

  -----------------------------------------------------------------------
  Table                               Key fields
  ----------------------------------- -----------------------------------
  `users`                             `id`, `name`, `role`,
                                      `owner_address`, `payment_pubkey`,
                                      `payment_key_hash`

  `agents`                            `id`, `name`, `status`

  `agent_grants`                      `id`, `agent_id`, `scopes`,
                                      `spend_limit`, `expires_at`,
                                      `revoked_at`

  `procurements`                      `id`, `owner_id`, `description`,
                                      `budget`, `status`

  `supplier_quotes`                   `id`, `procurement_id`,
                                      `supplier_id`, `amount`,
                                      `quote_data`

  `budget_reservations`               `id`, `procurement_id`, `agent_id`,
                                      `amount`, `status`,
                                      `idempotency_key`

  `approvals`                         `id`, `action_hash`, `approver_id`,
                                      `expires_at`, `used_at`, `nonce`,
                                      `signature`

  `policy_events`                     `id`, `agent_id`, `action`,
                                      `decision`, `reason_code`,
                                      `created_at`

  `actions`                           `id`, `procurement_id`,
                                      `owner_id`, `action_type`,
                                      `canonical_payload`,
                                      `action_hash`, `commitment_salt`,
                                      `status`, `ticket_nonce`,
                                      `ticket_expires_at`,
                                      `idempotency_key`,
                                      `external_ref`, `last_error`,
                                      `updated_at`

  `challenges`                        `id`, `purpose`, `owner_id`,
                                      `procurement_id`,
                                      `supplier_id`, `nonce`,
                                      `expires_at`, `used_at`

  `chain_transactions`                `id`, `chain`, `network`,
                                      `kind`, `tx_hash`,
                                      `escrow_utxo_ref`,
                                      `action_commitment`, `status`

  `receipts`                          `id`, `view`, `payload`,
                                      `signature`,
                                      `key_id`,
                                      `created_at`
  -----------------------------------------------------------------------

Every owner-scoped table carries `owner_id`, set from the authenticated
session and never from the request.

State values: `actions.status` is `PENDING_APPROVAL`, `APPROVED`, `EXECUTING`,
`SUCCEEDED`, `FAILED` or `UNKNOWN`; `budget_reservations.status` is `RESERVED`,
`COMMITTED` or `RELEASED`; `challenges.purpose` is `wallet_registration`
or `midnight_proof`. `external_ref` holds the transaction ID or connector
reference.

**Additive note (24 Nov 2026, see DECISIONS.md).** Minimal additions to the schema above, with no new product module: `agents.credential_hash` (hash only, never the token); `agent_grants.owner_id`, `issuer` and `integrity_tag` (HMAC with a server key over the grant fields); a `suppliers` table (`id`, `name`); `actions.reservation_id`, set by evaluate when it binds the reservation; `actions.policy_version`, the value of the `POLICY_VERSION` configuration constant at evaluation time (execute compares it with the current value). `policy_events.procurement_id`, `policy_events.action_id` and `policy_events.resource` (all nullable), and `receipts.procurement_id`, so events and receipts can be found per procurement. `actions.status` also gains `PENDING_APPROVAL`: evaluate sets it when it returns `APPROVAL_REQUIRED`, and a verified approval moves the action to `APPROVED`. An `ALLOW` that needs no approval goes straight to `APPROVED`. A `DENY` creates no action record, only a `policy_events` row. Supplier credential data for Midnight stays outside the main database, as simulated files from the issuer tool under `contracts/midnight/demo-credentials/`.

Store secrets and connector credentials in server-side secret storage or
environment configuration, never in frontend code or agent prompts.

------------------------------------------------------------------------

## 9. Security Requirements

These are non-negotiable. They are more important than adding more
features.

1.  **No gateway bypass:** All protected tools must be accessible only
    through controlled connectors. Connectors accept calls only from the
    gateway, and agents hold no connector credentials.
2.  **Least privilege:** Each agent receives only the minimum scopes
    required for its task.
3.  **Fail closed:** If the policy service is unavailable, protected
    actions are denied.
4.  **Untrusted supplier content:** Quotes, web pages, documents, and
    messages are data, not instructions.
5.  **Server-side enforcement:** Never trust frontend permission checks
    or status flags.
6.  **Approval integrity:** Approval is bound to the exact action hash
    and is single-use.
7.  **Execution-time checks:** Revalidate grants, resource scope,
    approval, budget, and policy at execution, in the transition
    transaction that consumes the ticket and approval. External calls
    run after commit with idempotency keys and are reconciled (TOCTOU
    control, Section 6.2).
8.  **Concurrency safety:** Budget reservations are atomic and
    idempotent.
9.  **Replay protection:** Use unique nonces and reject reused approvals
    or proof challenges.
10. **Owner authentication and isolation:** Owner identity comes only
    from the authenticated server-side session, never from a
    frontend-supplied owner ID. Every owner-scoped query filters by the
    session's owner ID. Full multi-tenant isolation is roadmap.
11. **No sensitive on-chain data:** Store only the minimum transaction
    or commitment data required.
12. **Evidence verification:** Verify signatures and chain transactions;
    do not treat a hash alone as proof. Verify against pinned trusted
    keys, never keys supplied inside the evidence.

------------------------------------------------------------------------

## 10. Demonstration Plan

The demo should tell one story from beginning to end. Do not present disconnected feature demos.

The submission video must be **2–4 minutes**. Target about 3 minutes, and confirm the live pitch length with the organisers for the finale.

### Demo sequence

| Step | What the judges see | What it proves | Video time |
|---|---|---|---|
| 1 | A small hotel owner creates a 100-kit request with a LKR 120,000 simulated budget | Real user and business problem | 0:00–0:20 |
| 2 | Two agents receive different permissions | Human-defined authority | 0:20–0:35 |
| 3 | Procurement Agent tries to access `payroll.csv` after malicious supplier content | Gateway blocks a prompt-injection-driven action | 0:35–0:55 |
| 4 | Gateway log shows `DENY: RESOURCE_OUT_OF_SCOPE` | Enforcement happens outside the LLM | (same) |
| 5 | Agents compare supplier quotes | Useful AI workflow | 0:55–1:10 |
| 6 | Midnight verifies supplier eligibility without exposing the credential (simulated issuer) | Privacy-preserving verification | 1:10–1:30 |
| 7 | Two concurrent reservations try to exceed the shared budget | Atomic financial control | 1:30–1:45 |
| 8 | Owner reviews the exact purchase and signs the approval with their wallet | Approval cryptographically bound to the exact action | 1:45–2:05 |
| 9 | Cardano testnet escrow A (buyer-controlled prototype) locks and releases test ADA, with the salted action commitment in the datum. Optionally, a short recorded clip of the validator rejecting a release without the buyer's signature (only if the P1 test passed) | Validator-enforced release tied to the approved action | 2:05–2:30 |
| 10 | Receipt verifies against SEYVIXA's published key and the on-chain escrow, then fails after tampering | Verifiable accountability | 2:30–2:50 |
| 11 | "Why on-chain", who pays, and the adoption path | Viability and adoption | 2:50–3:15 |

### Demo discipline

-   Use a prepared, repeatable dataset.
-   Have a backup recording of the blockchain transaction flow.
-   Show real policy gateway logs, not an LLM saying "I cannot do that."
-   Show actual Midnight proof verification output.
-   Show the Cardano testnet transaction ID and explorer evidence.
-   Clearly label simulated LKR values and test ADA. Never show an LKR-to-ADA conversion or say that ADA pays for the purchase.
-   Show the agent's direct connector attempt failing, not only the evaluate-time denial.
-   Say "buyer-controlled prototype escrow". Show the refund as the recorded transaction of the separate test escrow B, not as part of the live purchase.
-   Match every on-screen label to the fallback level actually reached (Section 13).
-   Never claim a feature works if it is only a UI mock or hardcoded response.
-   Run the full demo end to end every Saturday (28 Nov, 5 Dec, 12 Dec) so integration problems appear early.

### Optional stretch: judge's break-it box

Only after all seven P0 tests pass. On Screen 1, a text box lets a judge paste their own instruction into a supplier quote (using the existing `POST /api/quotes`). The Procurement Agent then runs as normal and the gateway log shows the decision. It uses the same agent and gateway, with no new endpoint, module or screen. Keep the recorded-response fallback and a prepared example. If it is not working by 10 Dec, drop it.

------------------------------------------------------------------------

## 11. Testing and Acceptance Criteria

The MVP is not complete until the seven P0 tests pass. P1 tests are added if time allows.

### P0 — mandatory

| Test | Expected result |
|---|---|
| Agent requests access to `payroll.csv` | Gateway denies it |
| Agent uses an expired or revoked grant, including a grant revoked between evaluate and execute | Execution is denied |
| Two agents reserve more than the shared budget | At most the valid reservation succeeds; total never exceeds budget |
| Action payload (amount, supplier) changes after evaluation or approval | Execution is rejected (hash mismatch); a new approval is required |
| Agent calls a protected connector directly, without the gateway | Request is rejected |
| External execution is interrupted after the transition commits (for example the gateway is killed after the call or transaction was sent), then retried with the same action and idempotency key | No duplicate side effect (at most one chain transaction or connector effect); reconciliation ends in `SUCCEEDED` or `FAILED`; the approval cannot be used for any other action |
| Receipt payload is altered | Receipt verification fails |

### P1 — stretch

| Test | Expected result |
|---|---|
| Agent requests an allowed supplier search | Gateway allows it |
| Agent attempts an action outside its tool scope | Gateway denies it |
| Approval nonce is reused | Second execution is rejected |
| Approval is signed by a key other than the registered owner key | Approval is rejected |
| Request carries a forged `owner_id` | The ID is ignored or the request is denied; the session owner is used |
| Supplier proof is invalid, expired or from a non-allowlisted issuer | Supplier verification fails |
| Midnight challenge is reused or issued for another procurement | Verification fails |
| A valid credential for supplier A is submitted for supplier B | Verification fails (subject binding) |
| Wallet registration signature is for a different address than the one selected, or uses a script address | Registration is rejected |
| Refund is attempted before the deadline (Cardano Level 1) | Validator rejects it on testnet |
| Cardano transaction is not confirmed | Workflow does not mark escrow as confirmed |
| Release is attempted without the buyer's signature (Cardano Level 1 or 2) | Validator rejects it on testnet. Prerequisite for showing the demo clip |
| On-chain commitment differs from the approved action | Receipt verification fails |
| Receipt embeds its own public key or an unknown `kid` | Receipt is rejected |
| Receipt is checked against the v0 JSON Schema, both views | A valid receipt passes; a receipt missing a required field fails; a verification view containing group 6 fields or resource names fails |
| Release transaction does not spend the escrow UTxO, is on another network, or lacks the supplier payment output | Receipt is rejected |
| Receipt says `released` but has no `release_tx_id` | Receipt is rejected |

Track these tests in the repository and include evidence in the submission documentation.

------------------------------------------------------------------------

## 12. Team Responsibilities

Five members own clear deliverables. Avoid everyone editing every layer. Everyone also takes part in discovery interviews.

| Member | Level | Ownership | Technical deliverable | Adoption and pitch duty |
|---|---|---|---|---|
| Abdul Basith | Advanced | Team lead and integrator: architecture, gateway (evaluate, execute, state machine), owner session, approvals, `BudgetGuard` (`reserve`, `commit`, `release`) and the `POST /api/budget/reservations` route | Enforced permissions, atomic budget, test evidence | Final business model, submission checklist, claims check, 1 interview |
| Afnan | Advanced | Blockchain: Midnight proof, Cardano validator, escrow A and B | Genuine testnet proof and escrow, rejection evidence | "Why on-chain" slide, runs the 28 Nov go/no-go |
| Divejikan | Intermediate | Cardano off-chain, wallet helper, receipt and verifier, receipt spec v0; mentor for the basic members | Transactions, receipt, verifier | 1 interview |
| Prabhath | Basic | Agents (Procurement with LLM, Finance rules), seed data and quote fixtures, the read-only `getBudget` helper, the P0-3 concurrency test, Screen 2 read-only wiring | Two agents calling protected tools, repeatable demo data, budget summary for the gauge | 1 interview |
| Shahnas | Basic | UI shell, Screen 1, layouts for Screens 2 and 3, documentation | Three connected screens | README, business model draft, pitch deck, demo video, 1 to 2 interviews |

Basic-level members work from clear specs, mock data and a mentor (Divejikan). Security-critical code stays with the advanced members.

### Integration rule

Define request/response contracts early. Each member should expose a working interface and a test fixture before integrating. Blockchain work must begin immediately because toolchain and contract issues are high-risk.

------------------------------------------------------------------------

## 13. Delivery Priorities

Work in this order. Do not build the dashboard first and leave the hard parts until the end.

### Priority 0 — Blockchain spikes (start on day 1, in parallel)

-   Midnight: deploy and verify one Compact proof on testnet. Time-box to about two days.
-   Cardano: lock test ADA at a script address and spend it. Time-box to about two days.

**Go/no-go on 28 Nov.** Choose the level for each chain and record it. Label the UI, demo, README and pitch for the level actually reached, and never claim more than that level demonstrates.

**Midnight fallback levels**

| Level | What is implemented | What it demonstrates | Required label | Must not be claimed |
|---|---|---|---|---|
| 1 (target) | Compact contract for the one eligibility claim (Section 6.6), including the in-circuit subject binding; proof generated and verified on testnet; challenge checked by the backend | A private proof of the SEYVIXA eligibility claim against a simulated issuer | "Midnight eligibility proof (simulated issuer)" | Real-world supplier eligibility |
| 2 | An official or modified example contract runs on testnet; the SEYVIXA claim is not implemented | The Midnight toolchain and selective-disclosure idea only | "Midnight toolchain demo (example contract). Supplier eligibility is simulated." | A SEYVIXA Midnight integration or a verified supplier eligibility claim |
| 3 | No Midnight proof; eligibility is a simulated off-chain check | Workflow only | "Eligibility simulated. Midnight integration incomplete." | Any Midnight verification |

**Cardano fallback levels**

| Level | What is implemented | What it demonstrates | Required label | Must not be claimed |
|---|---|---|---|---|
| 1 (target) | Aiken validator enforcing release (buyer signature, supplier paid) and refund (after deadline, buyer signature); salted commitment in the datum | Conditional escrow enforced by the validator | "Cardano testnet escrow (buyer-controlled prototype)" | Delivery verification, neutral or trustless escrow, or dispute resolution |
| 2 | Validator enforcing release only; refund is not enforced on-chain | Conditional release only | "Buyer-controlled conditional release. Refund not enforced on-chain." | Refund protection or full conditional settlement |
| 3 | Plain testnet transaction with the action commitment in metadata, no validator | A testnet anchoring record only. Metadata cannot be enforced by a validator. | "Testnet anchoring only. Not escrow." | Escrow, locked funds, conditional settlement, or enforceable release or refund |

**Midnight rule:** if the circuit does not assert the subject binding, the proof does not show that the quoted supplier is eligible. Do not claim Level 1.

**Cardano rule:** claim escrow or conditional settlement only if the on-chain validator actually enforces the release condition (and the refund condition for the full claim).

If a chain slips, cut UI polish and optional features before compromising the gateway or evidence verification.

### Priority 1 — Prove the trust boundary

-   Create two agents.
-   Issue distinct permission grants.
-   Route protected tool calls through the gateway.
-   Implement evaluate and execute (transition, external call, outcome, and the `UNKNOWN` reconciliation state), and demonstrate one allowed action and one denied action.
-   Show that an agent cannot reach a connector directly.
-   Record policy decisions.

**Exit condition:** The agent cannot bypass the gateway to perform the denied action.

### Priority 2 — Complete the procurement workflow

-   Create a purchase request.
-   Collect and compare supplier quotes.
-   Add shared budget reservations.
-   Add exact-action approval.

**Exit condition:** The owner can approve one purchase and the system rejects an over-budget or modified action.

### Priority 3 — Integrate both blockchain components

-   Verify one real Midnight eligibility proof from the backend.
-   Create and settle one Cardano testnet escrow with the salted action commitment in the datum (escrow A), and prepare a separate test escrow for the refund path (escrow B).
-   Verify transaction state from the backend.

**Exit condition:** Both integrations produce independently checkable evidence.

### Priority 4 — Complete the receipt and demo

-   Generate signed receipt.
-   Verify the receipt against the pinned SEYVIXA key, the owner's approval signature and the on-chain commitment.
-   Tamper with receipt and show failure.
-   Publish the receipt format v0 (specification, JSON Schema, verifier).
-   Run the complete demo repeatedly.
-   Record a backup demo.

**Exit condition:** The complete workflow can be demonstrated reliably without manual database edits.

------------------------------------------------------------------------

## 14. Suggested Timeline

The main UniHack 2026 page states the submission deadline as **14 December 2026, 12:00 noon**. An earlier review also found a GitHub/submission page indicating 15 December. Confirm the final deadline with the organisers, and use **13 December** as the team's internal freeze. The finale is on 17 December at the University of Kelaniya.

| Dates | Adoption track | Blockchain track | Build track |
|---|---|---|---|
| 21–23 Nov | Choose the segment; book 3–5 interviews | Start the Midnight and Cardano spikes | Create the Apache 2.0 repo; freeze API contracts; gateway skeleton |
| 24–29 Nov | Run interviews; draft the evidence summary | **Go/no-go on 28 Nov** | Permission gateway with separate evaluate and execute steps, two agents, supplier quote flow |
| 30 Nov–5 Dec | Write the business model; **request GitHub access by 5 Dec** | Wallet-signed approval, action commitment in the escrow datum; Midnight and Cardano integration | Atomic budget, exact approval |
| 6–10 Dec | Finish the pitch deck | Final "why on-chain" slide | End-to-end workflow, receipt, P0 tests, UI polish |
| 11–13 Dec | Write the video script; record the demo and a backup | Final claims check | README, test evidence, 2–4 minute video, submission checks; **13 Dec freeze, no new features** |

Run the full demo every Saturday (28 Nov, 5 Dec, 12 Dec).

------------------------------------------------------------------------

## 15. Business Viability and Adoption Plan

Viability & Adoption is the heaviest judging criterion (30%). The organisers state that clearly stated assumptions are enough and revenue is not required, so be honest about what is evidence and what is assumption.

### 15.1 First user

Small hotels and guesthouses in Sri Lanka that buy recurring supplies (for example guest kits, linens and cleaning supplies) and delegate purchase preparation to staff, an accountant or software, and may consider AI tools. The MVP enforces controls only for AI agents. Interviews also test whether owners would want the same controls for staff and software.

Do not claim that every SME needs a blockchain-based AI system. Validate the specific pain first.

### 15.2 Discovery interviews

**Target:** 3–5 conversations by 29 Nov with hotel or guesthouse owners, accountants or procurement staff. Family contacts and university networks are acceptable. Ask permission before quoting anyone.

Questions:

1.  How do you research, approve and pay suppliers today?
2.  Who can approve spending, and how are limits enforced?
3.  Have you had wrong, duplicate or unauthorised purchases?
4.  What business information must an AI assistant never see?
5.  Would you let an AI prepare a purchase if a separate system enforced permissions and your approval was still required?
6.  What evidence would you need for an audit or a supplier dispute?
7.  What did your last wrong, duplicate or unauthorised purchase cost (in LKR), and how long did it take to fix?
8.  Would you pay a monthly fee to prevent that, and roughly how much?
9.  Would you want the same limits and approval rules for staff, software and AI acting on your behalf? Which of them worries you most?

Evidence log (fill in with real answers only):

| # | Role and business type | Current process | Pain points | Cost of last incident (LKR) | Would pay? (amount) | Would use AI + approval? | Same controls for staff and software? | Useful quote (with permission) |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |

Output: a one-page summary that states what was learned, what surprised the team, and what changed in the product. If the interviews contradict the hypothesis, say so and adjust the pitch. Use only figures people actually gave you. If nobody gives a number, say so; do not estimate one for the pitch.

### 15.3 Business model (assumptions to validate)

| Element | Assumption |
|---|---|
| Customer | Small hospitality businesses that delegate procurement tasks to AI |
| Payer | The business owner |
| Core revenue | Subscription per workflow or per connected agent [price to validate through interviews] |
| Possible extra revenue | Small fee on escrow-settled purchases [to validate] |
| Value to the customer | Fewer unauthorised or incorrect purchases, owner control, audit evidence |
| Main costs | Hosting, chain transaction fees, support |

### 15.4 Adoption path

1.  **Stage 1:** hosted approval and escrow web app for one purchasing workflow.
2.  **Stage 2:** SDK so other AI tools and software can route protected actions through the gateway and emit receipts in the open v0 format.
3.  **Stage 3:** supplier network with reusable eligibility credentials.

### 15.5 Honest limits

-   The interviews are a small sample, not market validation.
-   Escrow does not verify physical delivery; acceptance comes from the buyer or a named trusted attestor.
-   Supplier eligibility proofs depend on the trustworthiness of the credential issuer. In the prototype the issuer is simulated.

------------------------------------------------------------------------

## 16. Positioning and Pitch

### Product positioning

**SEYVIXA — Buy from suppliers safely when AI agents do the legwork.**

*An independent trust layer keeps AI agents inside the authority the owner gives them. The same model is designed to extend to staff and software later.*

### Short pitch

Small businesses already hand purchasing tasks to staff, accountants and software, and AI tools are now an option too. When anyone, human or AI, can touch real tools and money on your behalf, who decides what they are allowed to do? Today SEYVIXA enforces that for AI agents. Staff and software are the next step, and we are testing demand for it in interviews.

SEYVIXA is an independent trust layer. In our hotel procurement demonstration, two AI agents compare suppliers while SEYVIXA enforces their permissions, blocks an attempt to read payroll data, and stops them from overspending a shared budget. The owner approves the exact purchase. Midnight lets the supplier prove eligibility without exposing its credential (in the prototype, the credential comes from a simulated issuer). On Cardano testnet, test ADA is locked in an escrow tied to the owner-approved action and released only when the buyer accepts. This is a buyer-controlled prototype; neutral dispute resolution is future work. The LKR budget is simulated, and test ADA is not payment for it. Every critical step leaves evidence that can be verified against published keys and the blockchain.

SEYVIXA gives AI agents room to work without giving them unlimited authority.

**Evidence line (use only with real results):** "We spoke to N owners. X told us their last wrong purchase cost LKR Y." Leave it out if no real figure exists.

### Claims to avoid

Do not say:

-   "We invented secure AI agents."
-   "Blockchain guarantees that the supplier is honest."
-   "Cardano verifies physical delivery."
-   "Midnight proves the real-world truth of every supplier claim."
-   "Our chains execute one atomic cross-chain transaction."
-   "All AI actions are controlled," unless every relevant tool is actually mediated by the gateway.
-   "Hotels and SMEs already demand this" or "the market is validated" before the interviews support it.
-   "SMEs already use AI agents widely", or any interview figure the team did not actually collect.
-   "SEYVIXA controls staff, software or any delegated actor." Only AI agents are enforced in the MVP. Staff and software are a future extension.
-   "The blockchain makes the AI safe." The gateway enforces permissions; the chains provide independent settlement and eligibility evidence.
-   "Test ADA pays for the LKR purchase", or any LKR-to-ADA conversion or fiat settlement.
-   "The on-chain hash proves the owner approved." The owner's signatures do, and only as proof of control of the registered key.
-   "Escrow" or "conditional settlement" when the validator does not enforce the release and refund conditions.
-   "Neutral", "trustless" or "dispute-resolving" escrow. The prototype escrow is buyer-controlled.
-   "Midnight eligibility proof" when only an example contract ran, or "real supplier eligibility" when the issuer is simulated.
-   "The receipt is trustless" or "proves delivery". It rests on SEYVIXA's signing key and cannot prove real-world events.

Say precisely what the prototype demonstrates.

------------------------------------------------------------------------

## 17. Final Product Principle

The original vision contained many modules. That breadth is useful as a
long-term product vision, but it is a liability during a short
competition build.

**Do not build a platform full of features. Build one complete,
defensible trust workflow.**

The judges should be able to see, in a single demonstration:

-   An AI agent proposes an action.
-   An independent gateway checks its authority.
-   An unauthorised action is genuinely blocked.
-   Shared spending limits prevent overspending.
-   A human approves the exact purchase.
-   Midnight verifies a private eligibility claim.
-   Cardano records a conditional settlement.
-   A tampered receipt is rejected.

If those things work, SEYVIXA has a credible MVP. If they do not work,
adding more modules will not save the project.

**Build the trust boundary first. Prove it. Then complete the
transaction.**

**Adoption matters as much as code.** A working workflow with no clear user, payer or reason to be on-chain scores poorly on the heaviest criterion. Spend real time on the interviews, the business model and the "why on-chain" explanation.

------------------------------------------------------------------------

## 18. Submission Checklist

Based on the UniHack 2026 page. Re-check the page and confirm anything unclear with the organisers.

| Item | Requirement | Done |
|---|---|---|
| Deadline | 14 December 2026, 12:00 noon (internal freeze 13 Dec) | [ ] |
| GitHub access | Request via the submissions page by 5 December | [ ] |
| Repository | Public GitHub repository under the Apache 2.0 licence | [ ] |
| Blockchain use | Cardano, Midnight or both used in a meaningful way (we use both) | [ ] |
| Documentation | Basic documentation covering who the product is for, how it could be sustained, and where blockchain or privacy adds value | [ ] |
| Demo video | 2–4 minutes, showing what actually works | [ ] |
| Test networks only | No mainnet use; no seed phrases or private keys committed | [ ] |
| Evidence | P0 test results, policy logs, Midnight verification output, Cardano transaction ID and explorer link, receipt tamper test, published receipt public key and fingerprint, refund evidence from the separate test escrow | [ ] |
| Claim boundary | README, deck and video say that only AI agents are enforced today and that staff and software are a future extension | [ ] |
| Receipt spec | `docs/receipt-spec-v0.md`, the JSON Schema (both views) and the verifier CLI are in the repository; sample receipts use simulated data only | [ ] |
| Interview figures | Every number in the pitch comes from a real interview; none are estimated | [ ] |
| Labels | Simulated LKR values and test ADA clearly labelled; no LKR-to-ADA conversion shown | [ ] |
| Honest fallbacks | Any Midnight or Cardano fallback is labelled for what it actually demonstrates; the escrow is labelled a buyer-controlled prototype | [ ] |
| Finale | 17 December, Faculty of Computing and Technology, University of Kelaniya (if selected) | [ ] |
