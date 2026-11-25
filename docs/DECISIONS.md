# Decisions Log

| ID | Decision | Reason / Context |
|---|---|---|
| T6.1 | **Cardano environment (25 Nov):** Standardize the whole team on **Cardano Preprod** testnet and **Blockfrost** (`BLOCKFROST_PROJECT_ID` in `.env`, fake placeholder in `.env.example`). Pin **Aiken `1.1.24`** (`aikup 0.0.11`), **`@meshsdk/core` `1.9.1`**, and **`@meshsdk/common` `1.9.1`** in [`docs/VERSIONS.md`](VERSIONS.md). (Blueprint Section 5, Section 13; D12) | One shared testnet, one chain-data API, and pinned Aiken/Mesh versions for T6.2/T6.3 and backend integration. |
