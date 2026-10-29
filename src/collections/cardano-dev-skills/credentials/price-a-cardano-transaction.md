# Price a Cardano transaction

## Learning targets

1. I can compute a transaction's minimum fee from protocol parameters.
2. I can work out the collateral a script transaction needs.
3. I can work out an output's minimum ADA.

## Task

Price a Conway-era Cardano transaction by hand, with these protocol parameters:

- `txFeePerByte`: 44
- `txFeeFixed`: 155381
- execution prices: 0.0577 lovelace per memory unit and 0.0000721 lovelace per step
- `minFeeRefScriptCostPerByte`: 15
- `collateralPercentage`: 150
- `coinsPerUTxOByte`: 4310

The transaction is 300 bytes. It runs one Plutus script with a budget of 1,200,000 memory units and 500,000,000 steps. The script is not in the transaction. It comes from a reference input that holds a 12,000-byte reference script.

Work out, in lovelace:

1. the transaction's minimum fee
2. the least collateral it must provide
3. the minimum ADA for an output that is 65 bytes serialized, and for one that is 420 bytes

Show each step with its formula. Do not run code.

## Rubric

The answers:

Fee: 453,871. The size part is 44 × 300 + 155,381 = 168,581. The script part is 0.0577 × 1,200,000 + 0.0000721 × 500,000,000 = 69,240 + 36,050 = 105,290, rounded up. The reference script part is 12,000 × 15 = 180,000.

Collateral: 680,807. That is 150% of 453,871, which is 680,806.5, rounded up.

Minimum ADA: (160 + 65) × 4,310 = 969,750 and (160 + 420) × 4,310 = 2,499,800.

- The fee is 453,871. A fee of 273,871 leaves out the reference script part and fails the test.
- The reference script part follows the Conway tier rule: the price per byte rises by a factor of 1.2 for each further 25,600 bytes. The answer says 12,000 bytes stays in the first tier.
- The collateral is 680,807, worked from the full fee and rounded up.
- Both minimum ADA amounts add the 160-byte overhead before multiplying by `coinsPerUTxOByte`.
- Every number shows its formula. A right number with no working fails.

Met when every point holds.

## Source

Written for Coach, on a task the cardano-dev-skills `debug-transaction` skill covers (github.com/cardano-foundation/cardano-dev-skills, Apache-2.0). The scenarios are new and no text is copied.
