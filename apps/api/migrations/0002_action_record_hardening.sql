-- T1.2b (Blueprint 6.2, 6.5; decisions D15, D16, D2b): support for the immutable action record.
-- suppliers.payee_address: where the escrow pays out (payload field payee_address, D29). Additive and
--   nullable, so existing rows stay valid; an action cannot be built for a supplier with no address.
-- actions are immutable (Blueprint 6.2): the payload, hash, salt, owner, procurement and type can never change
--   after insert. Status, ticket and result columns stay updatable for later tasks.
-- One reservation binds to at most one action, so two evaluations cannot claim the same reservation.
ALTER TABLE suppliers ADD COLUMN payee_address text;

CREATE FUNCTION actions_immutable_fields() RETURNS trigger AS $$
BEGIN
  IF NEW.canonical_payload IS DISTINCT FROM OLD.canonical_payload
     OR NEW.action_hash IS DISTINCT FROM OLD.action_hash
     OR NEW.commitment_salt IS DISTINCT FROM OLD.commitment_salt
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.procurement_id IS DISTINCT FROM OLD.procurement_id
     OR NEW.action_type IS DISTINCT FROM OLD.action_type
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
    RAISE EXCEPTION 'actions payload fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER actions_immutable_fields_trg
  BEFORE UPDATE ON actions
  FOR EACH ROW EXECUTE FUNCTION actions_immutable_fields();

CREATE UNIQUE INDEX actions_reservation_id_key ON actions (reservation_id) WHERE reservation_id IS NOT NULL;
