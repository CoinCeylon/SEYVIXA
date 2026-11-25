# Decisions Log

| ID | Decision | Reason / Context |
|---|---|---|
| T6.1 | **Cardano environment (25 Nov):** Standardize the whole team on **Cardano Preprod** testnet and **Blockfrost** (`BLOCKFROST_PROJECT_ID` in `.env`, fake placeholder in `.env.example`). Pin **Aiken `1.1.24`** (`aikup 0.0.11`), **`@meshsdk/core` `1.9.1`**, and **`@meshsdk/common` `1.9.1`** in [`docs/VERSIONS.md`](VERSIONS.md). (Blueprint Section 5, Section 13; D12) | One shared testnet, one chain-data API, and pinned Aiken/Mesh versions for T6.2/T6.3 and backend integration. |
| T5.2 | **Midnight spike result (26 Nov):** Compiled `counter.compact` (`compact 0.36.0`), deployed to Midnight **Preview** (`d28cfcc38b6510a2a486187e415c024b9bdd39f7e4522b203cf9aeca57c45323`), and verified `increment()` ZK proof (`0` → `1`) via `midnightntwrk/proof-server:9.0.2`. Supports **Midnight Level 2** (*"Midnight toolchain demo (example contract). Supplier eligibility is simulated."*). Evidence in `docs/evidence/T5.2-midnight-spike.md`. (Blueprint Section 13; D13) | Priority 0 Midnight toolchain spike completed on time; ready to proceed toward Level 1 (T5.4) or fall back cleanly to Level 2. |
