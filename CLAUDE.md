# SEYVIXA TrustOS (UniHack 2026, Cardano + Midnight)

Source of truth: docs/blueprint-v4.4.md (design and scope). docs/guide.md says who builds what.
If they disagree, the Blueprint wins. Report conflicts; never resolve them silently.

## What we build

A trust layer for AI agents in SME procurement. Gateway evaluates and executes actions,
the owner approves with a wallet signature, Midnight proves supplier eligibility privately,
Cardano testnet holds a buyer-controlled prototype escrow, a signed receipt records the result.
Only AI agents are enforced in the MVP. Staff and software are a future extension.

## Non-negotiable rules

- Test networks only. No real money. Never commit seed phrases, private keys or API keys.
- LKR is a simulated budget. Test ADA is not payment for it. Never show a conversion.
- Only the gateway executes protected actions. Agents hold no connector credentials.
- Label every feature for what it really does (fallback labels, Blueprint Section 13).
- No new modules, agents, screens, networks or endpoints. The endpoints in Blueprint Section 7 are the complete allowed set. Do not add endpoints.
- Never claim more than is implemented.

## How to work

- Plan first: write a short plan and list assumptions before any code. Wait for approval on large tasks.
- Every change cites a task ID (guide.md Section 6) and a Blueprint section.
- If anything is unclear or missing, stop and ask. Never invent endpoints, fields, libraries or APIs.
- Niche tech (Compact, Aiken, Mesh, CIP-30, COSE): use pinned versions and official docs; test for real.
- Small commits. One task per session.
