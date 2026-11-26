# SEYVIXA TrustOS — Web UI

Web UI shell for SEYVIXA TrustOS (UniHack 2026, Cardano + Midnight).

Built with Next.js and Tailwind CSS (T9.1, T9.1b, Feature F9, Blueprint §4.3).

## Prerequisites

Pinned versions from `docs/VERSIONS.md`:
- Node.js LTS: `26.13.1`
- Next.js: `16.4.6`
- Tailwind CSS: `4.3.5`
- TypeScript: `7.0.2`
- pnpm: `12.23.0`

## Development

To start the development server:

```bash
pnpm --filter @seyvixa/web dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser. Visiting `/` automatically redirects to `/workspace`.

## Build & Typecheck

To run TypeScript verification:

```bash
pnpm --filter @seyvixa/web typecheck
```

To create a production build:

```bash
pnpm --filter @seyvixa/web build
```

To run the production build:

```bash
pnpm --filter @seyvixa/web start
```

## Layout & Components (Blueprint §4.3)

The application provides a single shared layout in `app/layout.tsx` that appears on all screens:

1. **Persistent Labels (`components/PersistentLabels.tsx`):**
   - `"Simulated LKR budget — not real money"`
   - `"Cardano testnet — test ADA has no monetary value"`
   - LKR and test ADA are strictly kept separate with no currency conversion.

2. **Workflow Stage Indicator (`components/StageIndicator.tsx`):**
   - Displays the six workflow stages in strict sequence: `Request`, `Quotes`, `Eligibility`, `Approval`, `Escrow`, `Receipt`.
   - Visual cues indicate current, completed, and upcoming stages.

3. **Routes (Blueprint §4.3):**
   - `/workspace` — **Procurement Workspace**: Create and follow procurement requests, compare suppliers, and display agent activity.
   - `/trust` — **Trust & Approval Centre**: Show and control spending authority and evaluate/approve purchase actions.
   - `/settlement` — **Settlement & Proof Centre**: Show Midnight eligibility verification, Cardano escrow state, and receipt generation.
