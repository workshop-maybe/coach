# Find the hole in a validator

## Learning targets

1. I can find an exploitable flaw in a validator.
2. I can rate a finding's severity without inflating it.

## Task

Review this Aiken validator before it goes live. A seller locks an item at the script with a `Listing` datum. Anyone can buy the item by paying the price to the payout address. The owner can cancel the listing.

```aiken
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Address}
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}

pub type Listing {
  owner: VerificationKeyHash,
  payout: Address,
  price: Int,
}

pub type Action {
  Buy
  Cancel
}

validator market {
  spend(
    datum: Option<Listing>,
    action: Action,
    _own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(listing) = datum
    when action is {
      Buy ->
        list.any(
          self.outputs,
          fn(output) {
            output.address == listing.payout && assets.lovelace_of(
              output.value,
            ) >= listing.price
          },
        )
      Cancel -> list.has(self.extra_signatories, listing.owner)
    }
  }

  else(_) {
    fail
  }
}
```

It compiles with Aiken v1.1.24 and stdlib v4.0.0.

List each finding with a severity (critical, high, medium, low or informational), how someone would exploit it, and a fix. Then say which parts you checked and found sound.

## Rubric

- It finds that `Buy` is open to double satisfaction. One payment output can satisfy two or more listings with the same payout address when they are spent in one transaction, so a buyer takes several items for the price of one.
- It rates that finding critical or high.
- Its fix ties the payment to the input being spent, for example by requiring the payment output's datum to hold the listing's own `OutputReference`, or by allowing only one script input per transaction. A fix that only checks more of the payment fails.
- It does not flag `Cancel` as a flaw. Cancel checks the owner's signature and is correct.
- No other finding is rated critical or high. A note such as "an output sent without a datum can never be spent" is fine at low or informational.

Met when every point holds.

## Source

Written for Andamio Desktop, on a task the cardano-dev-skills `review-contract` skill covers (github.com/cardano-foundation/cardano-dev-skills, Apache-2.0). The scenarios are new and no text is copied.
