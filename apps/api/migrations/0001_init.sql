-- T0.2b: Blueprint Section 8 tables plus the additive note (decisions D7, D15, D16, D27).
-- Types and constraints follow decision D26. No ON DELETE CASCADE anywhere.
-- Owner-scoped tables carry owner_id: agent_grants, procurements, actions, challenges (D27).

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  role             text NOT NULL,
  owner_address    text,
  payment_pubkey   text,
  payment_key_hash text
);

CREATE TABLE suppliers (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE agents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  status          text NOT NULL,
  credential_hash text -- hash only, never the token
);

CREATE TABLE agent_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid NOT NULL REFERENCES agents (id),
  owner_id      uuid NOT NULL REFERENCES users (id),
  scopes        text[] NOT NULL,
  spend_limit   numeric(14,2) NOT NULL,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  issuer        text NOT NULL,
  integrity_tag text NOT NULL -- HMAC with a server key over the grant fields
);

CREATE TABLE procurements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users (id),
  description text NOT NULL,
  budget      numeric(14,2) NOT NULL, -- simulated LKR
  status      text NOT NULL
);

CREATE TABLE supplier_quotes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id uuid NOT NULL REFERENCES procurements (id),
  supplier_id    uuid NOT NULL REFERENCES suppliers (id),
  amount         numeric(14,2) NOT NULL,
  quote_data     jsonb NOT NULL -- untrusted supplier data
);
CREATE INDEX supplier_quotes_procurement_id_idx ON supplier_quotes (procurement_id);

CREATE TABLE budget_reservations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id  uuid NOT NULL REFERENCES procurements (id),
  agent_id        uuid NOT NULL REFERENCES agents (id),
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  status          text NOT NULL CHECK (status IN ('RESERVED', 'COMMITTED', 'RELEASED')),
  idempotency_key text NOT NULL UNIQUE
);
CREATE INDEX budget_reservations_procurement_id_idx ON budget_reservations (procurement_id);

CREATE TABLE approvals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_hash text NOT NULL,
  approver_id uuid NOT NULL REFERENCES users (id),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  nonce       text NOT NULL UNIQUE,
  signature   text NOT NULL
);

CREATE TABLE actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_id    uuid NOT NULL REFERENCES procurements (id),
  owner_id          uuid NOT NULL REFERENCES users (id),
  action_type       text NOT NULL,
  canonical_payload text NOT NULL, -- exact canonical bytes that are hashed
  action_hash       text NOT NULL,
  commitment_salt   text,
  status            text NOT NULL CHECK (status IN
                      ('PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
  ticket_nonce      text,
  ticket_expires_at timestamptz,
  idempotency_key   text,
  external_ref      text, -- transaction ID or connector reference
  last_error        text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  reservation_id    uuid REFERENCES budget_reservations (id), -- set by evaluate when it binds the reservation
  policy_version    text NOT NULL -- POLICY_VERSION at evaluation time
);
CREATE UNIQUE INDEX actions_ticket_nonce_key ON actions (ticket_nonce) WHERE ticket_nonce IS NOT NULL;
CREATE UNIQUE INDEX actions_idempotency_key_key ON actions (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX actions_procurement_id_idx ON actions (procurement_id);

CREATE TABLE policy_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       uuid REFERENCES agents (id),
  action         text NOT NULL,
  decision       text NOT NULL,
  reason_code    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  procurement_id uuid REFERENCES procurements (id), -- D27
  action_id      uuid REFERENCES actions (id),      -- D27
  resource       text                               -- D27
);
CREATE INDEX policy_events_procurement_id_idx ON policy_events (procurement_id);

CREATE TABLE challenges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose        text NOT NULL CHECK (purpose IN ('wallet_registration', 'midnight_proof')),
  owner_id       uuid NOT NULL REFERENCES users (id),
  procurement_id uuid REFERENCES procurements (id),
  supplier_id    uuid REFERENCES suppliers (id),
  nonce          text NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz
);
CREATE INDEX challenges_procurement_id_idx ON challenges (procurement_id);

-- Linked to a procurement through actions.external_ref = chain_transactions.tx_hash (D27).
CREATE TABLE chain_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain             text NOT NULL,
  network           text NOT NULL,
  kind              text NOT NULL,
  tx_hash           text NOT NULL,
  escrow_utxo_ref   text,
  action_commitment text,
  status            text NOT NULL,
  UNIQUE (chain, network, tx_hash)
);

CREATE TABLE receipts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  view           text NOT NULL,
  payload        text NOT NULL, -- exact canonical bytes that were signed (D26)
  signature      text NOT NULL,
  key_id         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  procurement_id uuid NOT NULL REFERENCES procurements (id) -- D27
);
CREATE INDEX receipts_procurement_id_idx ON receipts (procurement_id);
