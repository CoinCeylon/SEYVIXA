# SEYVIXA TrustOS — Web UI

Web UI shell for SEYVIXA TrustOS (UniHack 2026, Cardano + Midnight).

Built with Next.js and Tailwind CSS (T9.1, Feature F9, Blueprint §4.3).

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

## Routes (Blueprint §4.3)

The application provides exactly three connected screens sharing a single navigation bar in `app/layout.tsx`:

1. `/workspace` — **Procurement Workspace**: Create and follow procurement requests, compare suppliers, and display agent activity.
2. `/trust` — **Trust & Approval Centre**: Show and control spending authority and evaluate/approve purchase actions.
3. `/settlement` — **Settlement & Proof Centre**: Show Midnight eligibility verification, Cardano escrow state, and receipt generation.
