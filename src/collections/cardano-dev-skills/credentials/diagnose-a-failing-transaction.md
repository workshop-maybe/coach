# Diagnose a failing transaction

## Learning targets

1. I can name the ledger rule a failing transaction breaks.
2. I can find a failure's root cause from the transaction's own numbers.

## Task

A node rejected each of the four Cardano transactions below. For each one, name the ledger failure the node reported, find the root cause in the numbers, and give the fix you would make in the code that built it.

1. A wallet app sends a payment. The one input holds 10,000,000 lovelace. The outputs pay 5,000,000 to the recipient and 4,800,000 back as change. The fee field is 180,000. The app's log reads: "fee estimate 200,000, change computed, fee recomputed from final size: 180,000, signed".
2. A dApp spends a script output. The fee is 400,000 and `collateralPercentage` is 150. The collateral input is an ADA-only UTxO of 5,000,000 lovelace, and the collateral return output holds 4,500,000. The dApp's config sets `collateralAmount: 500000`.
3. A two-party escrow release needs both parties to sign. It was built at slot 1,000,000 with a validity interval that ends at slot 1,000,900. The first party signed at once. The second signed the next day, and the transaction was submitted at slot 1,086,400.
4. A sale through an escrow script that checks both the buyer and the seller signed. The transaction lists both key hashes as required signers. Its witness set holds only the buyer's signature, made in the buyer's wallet.

## Rubric

1. Report 1 is `ValueNotConservedUTxO`. The input holds 10,000,000 and the outputs plus the fee hold 9,980,000. The missing 20,000 is the gap between the two fee estimates. The fix computes change after the final fee.
2. Report 2 is `InsufficientCollateral`. The collateral is the 5,000,000 input minus the 4,500,000 return, so 500,000, against the 600,000 a 400,000 fee needs. The fix derives the collateral from the fee instead of a fixed setting.
3. Report 3 is `OutsideValidityIntervalUTxO`. The transaction expired at slot 1,000,900 and was submitted 85,500 slots later. The fix sets the validity interval once the last signer is ready, or makes the window cover the time signing takes.
4. Report 4 is `MissingVKeyWitnessesUTXOW`. The seller's key hash is a required signer, and only the buyer signed. The fix sends the transaction to the seller to sign before it is submitted.

Met when all four rules and root causes are right. A fix that treats the symptom fails the test: a hand-edited fee or collateral number, a resubmit, a new interval on the already signed transaction, or the seller dropped from the required signers.

## Source

Written for Coach, on a task the cardano-dev-skills `debug-transaction` skill covers (github.com/cardano-foundation/cardano-dev-skills, Apache-2.0). The scenarios are new and no text is copied.
