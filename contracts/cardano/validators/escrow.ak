// T6.3 — Cardano Conditional Escrow Validator (Buyer-Controlled Prototype)
// Blueprint Section 6.5, Section 6.7, Section 13; contracts/cardano/DATUM_SPEC.md (T6.2)
//
// Prototype boundary: buyer-controlled prototype escrow on Cardano Preprod testnet.
// Not neutral or trustless; no dispute resolution or physical delivery verification.

use aiken/collection/list
use aiken/interval
use cardano/address.{Address, VerificationKey}
use cardano/assets
use cardano/transaction.{Output, OutputReference, Transaction, placeholder}

pub type EscrowDatum {
  buyer: ByteArray,
  supplier: ByteArray,
  locked_amount: Int,
  refund_deadline: Int,
  action_commitment: ByteArray,
}

pub type EscrowRedeemer {
  Release
  Refund
}

fn has_buyer_signature(tx: Transaction, buyer: ByteArray) -> Bool {
  list.has(tx.extra_signatories, buyer)
}

fn pays_at_least(
  outputs: List<Output>,
  recipient_pkh: ByteArray,
  min_lovelace: Int,
) -> Bool {
  list.any(
    outputs,
    fn(output) {
      output.address.payment_credential == VerificationKey(recipient_pkh) && assets.lovelace_of(
        output.value,
      ) >= min_lovelace
    },
  )
}

fn pays_recipient(outputs: List<Output>, recipient_pkh: ByteArray) -> Bool {
  list.any(
    outputs,
    fn(output) {
      output.address.payment_credential == VerificationKey(recipient_pkh) && assets.lovelace_of(
        output.value,
      ) > 0
    },
  )
}

validator escrow {
  spend(
    datum_opt: Option<EscrowDatum>,
    redeemer: EscrowRedeemer,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum) = datum_opt
    expect True = datum.locked_amount > 0

    when redeemer is {
      Release ->
        has_buyer_signature(self, datum.buyer) && pays_at_least(
          self.outputs,
          datum.supplier,
          datum.locked_amount,
        )
      Refund ->
        interval.is_entirely_after(self.validity_range, datum.refund_deadline) && has_buyer_signature(
          self,
          datum.buyer,
        ) && pays_recipient(self.outputs, datum.buyer)
    }
  }

  else(_) {
    fail
  }
}

// ---------------------------------------------------------------------------
// Unit Tests (T6.3 Acceptance Criteria)
// ---------------------------------------------------------------------------

const fake_buyer: ByteArray =
  #"00000000000000000000000000000000000000000000000000000001"

const fake_supplier: ByteArray =
  #"00000000000000000000000000000000000000000000000000000002"

const fake_commitment: ByteArray =
  #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

const fake_ref: OutputReference =
  OutputReference {
    transaction_id: #"1111111111111111111111111111111111111111111111111111111111111111",
    output_index: 0,
  }

fn sample_datum() -> EscrowDatum {
  EscrowDatum {
    buyer: fake_buyer,
    supplier: fake_supplier,
    locked_amount: 5_000_000,
    refund_deadline: 1_795_600_000_000,
    action_commitment: fake_commitment,
  }
}

fn output_to(pkh: ByteArray, lovelace: Int) -> Output {
  Output {
    address: Address {
      payment_credential: VerificationKey(pkh),
      stake_credential: None,
    },
    value: assets.from_lovelace(lovelace),
    datum: transaction.NoDatum,
    reference_script: None,
  }
}

test release_succeeds_with_buyer_sig_and_supplier_paid() {
  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [fake_buyer],
      outputs: [output_to(fake_supplier, 5_000_000)],
    }
  escrow.spend(Some(sample_datum()), Release, fake_ref, tx)
}

test release_fails_without_buyer_signature() fail {
  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [fake_supplier],
      outputs: [output_to(fake_supplier, 5_000_000)],
    }
  escrow.spend(Some(sample_datum()), Release, fake_ref, tx)
}

test release_fails_when_supplier_underpaid() fail {
  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [fake_buyer],
      outputs: [output_to(fake_supplier, 4_999_999)],
    }
  escrow.spend(Some(sample_datum()), Release, fake_ref, tx)
}

test release_fails_when_datum_missing() fail {
  let tx =
    Transaction {
      ..placeholder,
      extra_signatories: [fake_buyer],
      outputs: [output_to(fake_supplier, 5_000_000)],
    }
  escrow.spend(None, Release, fake_ref, tx)
}

test refund_succeeds_after_deadline_with_buyer_sig_and_buyer_paid() {
  let tx =
    Transaction {
      ..placeholder,
      validity_range: interval.after(1_795_600_000_001),
      extra_signatories: [fake_buyer],
      outputs: [output_to(fake_buyer, 5_000_000)],
    }
  escrow.spend(Some(sample_datum()), Refund, fake_ref, tx)
}

test refund_fails_before_deadline() fail {
  let tx =
    Transaction {
      ..placeholder,
      validity_range: interval.after(1_795_599_999_999),
      extra_signatories: [fake_buyer],
      outputs: [output_to(fake_buyer, 5_000_000)],
    }
  escrow.spend(Some(sample_datum()), Refund, fake_ref, tx)
}

test refund_fails_at_exact_deadline() fail {
  let tx =
    Transaction {
      ..placeholder,
      validity_range: interval.after(1_795_600_000_000),
      extra_signatories: [fake_buyer],
      outputs: [output_to(fake_buyer, 5_000_000)],
    }
  escrow.spend(Some(sample_datum()), Refund, fake_ref, tx)
}

test refund_fails_without_buyer_signature() fail {
  let tx =
    Transaction {
      ..placeholder,
      validity_range: interval.after(1_795_600_000_001),
      extra_signatories: [],
      outputs: [output_to(fake_buyer, 5_000_000)],
    }
  escrow.spend(Some(sample_datum()), Refund, fake_ref, tx)
}
