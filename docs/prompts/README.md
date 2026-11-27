# Prompt pack — index

One task card per task. Run one card per fresh AI session. Attach `docs/AI_CONTEXT.md` and the card. Before every PR run `docs/prompts/REVIEW.md`.

**Batch 1** covers tasks due 23 to 29 Nov. Later batches are not written yet. Dates are the guide's original target dates. Overdue tasks have a must-finish date (decision D5). Task splits and new tasks are in `docs/DECISIONS.md` (D3, D6, D10, D11).

## Who works on what now (Abdul updates this)

A task is yours only when it is listed here for you or Abdul sends you a card. After finishing, stop and report. Do not pick the next task from `docs/guide.md`.

| Member | Open card(s) | Next |
|---|---|---|
| Abdul | T1.2c, T1.6, T1.5, T4.1a to T4.1c, I2 | Abdul decides |
| Afnan | none open from batch 1 | Abdul assigns |
| Divejikan | T8.2b (key generator safety), the real Preprod run for T8.3b | Abdul assigns |
| Prabhath | T0.4b (seed script, no PR yet), then T4.2 after T4.1a | Abdul assigns |
| Shahnas | T9.4, T9.5a to T9.5c, T10.2 | Abdul assigns |

Security-critical paths (`tools/verifier`, `keys/`, `tools/keygen`, `apps/api`, `contracts/cardano`, escrow and receipt code) need a review by someone other than the author before merge (decision D42).

## How to use a card

1. Open a fresh session. Attach `docs/AI_CONTEXT.md` and your card (`docs/prompts/<member>/<TaskID>.md`).
2. Tell the AI: "Do this task only. Write a plan and list assumptions first."
3. Read the plan. Fix it if it adds anything the card does not name.
4. Build in small steps. Run the tests in the card.
5. Run `docs/prompts/REVIEW.md` on the diff. Open the PR with the evidence the card lists.

## Task order and dependencies (batch 1)

| Order | Task | Owner | Target (must finish) | Depends on | Card |
|---|---|---|---|---|---|
| 1 | T0.1 | Abdul | 23 Nov (OVERDUE, 25 Nov) | none | [abdul/T0.1](abdul/T0.1.md) |
| 2 | T0.5 | Abdul | 23 Nov (OVERDUE, 25 Nov) | none | [abdul/T0.5](abdul/T0.5.md) |
| 3 | T0.2a | Abdul | 23 Nov (OVERDUE, 25 Nov) | T0.1 | [abdul/T0.2a](abdul/T0.2a.md) |
| 4 | T0.3a | Abdul | 23 Nov (OVERDUE, 25 Nov) | T0.1 | [abdul/T0.3a](abdul/T0.3a.md) |
| 5 | T0.3b | Abdul | 23 Nov (OVERDUE, 25 Nov) | T0.3a (Section 8 table list only) | [abdul/T0.3b](abdul/T0.3b.md) |
| 6 | T0.2b | Abdul | 23 Nov (OVERDUE, 26 Nov) | T0.2a | [abdul/T0.2b](abdul/T0.2b.md) |
| 7 | T6.1 | Afnan | 25 Nov | none | [afnan/T6.1](afnan/T6.1.md) |
| 8 | T6.2 | Afnan | 25 Nov | T6.1 | [afnan/T6.2](afnan/T6.2.md) |
| 9 | T5.1 | Afnan | 25 Nov | none | [afnan/T5.1](afnan/T5.1.md) |
| 10 | T0.4 | Abdul | 25 Nov | T0.3b, T0.2b (check the draft against the migrations) | [abdul/T0.4](abdul/T0.4.md) |
| 11 | T9.1 | Shahnas | 25 Nov | T0.1 | [shahnas/T9.1](shahnas/T9.1.md) |
| 12 | T5.2 | Afnan | 26 Nov | T5.1 | [afnan/T5.2](afnan/T5.2.md) |
| 13 | T9.1b | Shahnas | 26 Nov | T9.1 | [shahnas/T9.1b](shahnas/T9.1b.md) |
| 14 | T9.4 | Shahnas | 26 Nov | T0.3b | [shahnas/T9.4](shahnas/T9.4.md) |
| 15 | T5.3 | Afnan | 27 Nov | T5.2 | [afnan/T5.3](afnan/T5.3.md) |
| 16 | T7.1 | Divejikan | 27 Nov | T6.1, T0.3b | [divejikan/T7.1](divejikan/T7.1.md) |
| 16b | T2.1 | Abdul | 27 Nov (moved from 30 Nov, D19) | T0.2b, T0.3b | [abdul/T2.1](abdul/T2.1.md) |
| 17 | T1.1a | Abdul | 28 Nov | T0.2b, T0.3b | [abdul/T1.1a](abdul/T1.1a.md) |
| 18 | T1.1b | Abdul | 28 Nov | T1.1a, T0.3b, T2.1 (stub allowed until it lands) | [abdul/T1.1b](abdul/T1.1b.md) |
| 19 | T1.2a | Abdul | 28 Nov | T1.1a, T1.1b, T0.3b | [abdul/T1.2a](abdul/T1.2a.md) |
| 20 | T1.2b | Abdul | 28 Nov | T1.2a, T0.3a | [abdul/T1.2b](abdul/T1.2b.md) |
| 21 | T1.2c | Abdul | 28 Nov | T1.2b | [abdul/T1.2c](abdul/T1.2c.md) |
| 22 | T4.1a | Abdul | 28 Nov | T0.2b, T0.3b | [abdul/T4.1a](abdul/T4.1a.md) |
| 23 | T4.1b | Abdul | 28 Nov | T4.1a, T1.1a, T1.2a | [abdul/T4.1b](abdul/T4.1b.md) |
| 24 | T4.1c | Abdul | 28 Nov | T0.3b | [abdul/T4.1c](abdul/T4.1c.md) |
| 25 | T1.6 | Abdul | 28 Nov | T0.2b, T0.3b, T1.1a, T2.1 (stub allowed until it lands) | [abdul/T1.6](abdul/T1.6.md) |
| 26 | T5.7 | Afnan | 28 Nov | T5.2, T5.3 | [afnan/T5.7](afnan/T5.7.md) |
| 27 | T0.4b | Prabhath | 28 Nov | T0.4, T0.2b, T0.3b | [prabhath/T0.4b](prabhath/T0.4b.md) |
| 28 | T4.2 | Prabhath | 29 Nov | T4.1a, T0.4b | [prabhath/T4.2](prabhath/T4.2.md) |
| 29 | T7.2a | Divejikan | 29 Nov | T6.1 | [divejikan/T7.2a](divejikan/T7.2a.md) |
| 30 | T7.2b | Divejikan | 29 Nov | T7.2a | [divejikan/T7.2b](divejikan/T7.2b.md) |
| 31 | T9.5a | Shahnas | 29 Nov | T9.1b, T9.4 | [shahnas/T9.5a](shahnas/T9.5a.md) |
| 32 | T9.5b | Shahnas | 29 Nov | T9.5a | [shahnas/T9.5b](shahnas/T9.5b.md) |
| 33 | T9.5c | Shahnas | 29 Nov | T9.5a | [shahnas/T9.5c](shahnas/T9.5c.md) |
| 34 | I1 | Prabhath | 29 Nov | none | [prabhath/I1](prabhath/I1.md) |
| 35 | I2 | Abdul | 29 Nov | none | [abdul/I2](abdul/I2.md) |
| 36 | I3 | Divejikan | 29 Nov | none | [divejikan/I3](divejikan/I3.md) |
| 37 | T10.2 | Shahnas | 29 Nov (final 3 Dec) | I1, I2, I3 | [shahnas/T10.2](shahnas/T10.2.md) |

Not in batch 1 and not written: L1 (ongoing lead duties), T1.3 and later tasks, and every task due 30 Nov or later.

## Cards per member

- **Abdul (18):** T0.1, T0.2a, T0.2b, T0.3a, T0.3b, T0.4, T0.5, T1.1a, T1.1b, T1.2a, T1.2b, T1.2c, T1.6, T2.1, T4.1a, T4.1b, T4.1c, I2
- **Afnan (6):** T5.1, T5.2, T5.3, T5.7, T6.1, T6.2
- **Divejikan (4):** T7.1, T7.2a, T7.2b, I3
- **Prabhath (3):** T0.4b, T4.2, I1
- **Shahnas (7):** T9.1, T9.1b, T9.4, T9.5a, T9.5b, T9.5c, T10.2

## Open items: all resolved (see `docs/DECISIONS.md`)

| Open item | Resolution | Decision |
|---|---|---|
| Status for an evaluated action waiting for approval | `PENDING_APPROVAL`; verified approval moves it to `APPROVED`; `ALLOW` without approval goes to `APPROVED`; `DENY` creates no action record | D15 |
| Source of the policy version | Config constant `POLICY_VERSION`, stored as `actions.policy_version`; mismatch gives `POLICY_VERSION_STALE` | D16 |
| Which action types need approval | Escrow types need `APPROVAL_REQUIRED`; the four read/propose types are `ALLOW` or `DENY` by grant; `BUDGET_RESERVE` is not an action type | D17 |
| Meaning of found and confirmed | Found = in a block; confirmed = found with at least `CONFIRMATION_DEPTH` (default 3, prototype setting) | D18 |
| Owner session needed before 28 Nov | T2.1 moved to 27 Nov; `getSessionOwnerId(req)` stub allowed until then; remove before 5 Dec | D19 |
| Seed command | `pnpm seed` | D20 |
| Reason code for a tampered grant | `GRANT_INTEGRITY_FAILED` | D21 |
| Paths, T0.3b dependency, T5.7 Cardano level, T8.6 date (8 Dec) | Approved | D22 |
| Interview log privacy | Anonymised: role and business type only; quotes need permission | D23 |
| Blueprint note for the reservations route | Added to Blueprint Section 6.4 | D24 |

## Rules for every card

Test networks only, no secrets, plan first, no invented endpoints, fields or libraries, stop and ask if unclear. Blueprint excerpts in the cards are copied verbatim from `docs/blueprint-v4.4.md` by a script and checked against it. If you find a mismatch, tell Abdul.
