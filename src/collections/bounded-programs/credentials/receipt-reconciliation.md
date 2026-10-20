# Receipt reconciliation

## Learning targets

1. I can turn a described job into a bounded QDL 1 program that compiles and passes its fixtures.
2. I can reconcile partial results without counting a pending or unknown attempt as done.

## Task

Write a QDL 1 program for this job: reconcile the supplied attempt history for one operation, without sending or retrying anything. Confirmed attempts add their units once; other attempts carry 0 units. A repeated identical receipt counts once. A pending or unknown attempt stops any advice to retry, and confirmed units already counted stay counted. Changed data under one receipt id, conflicting receipts at the same sequence, or an attempt that goes back from a final status to pending makes the evaluation fail. With no attempts yet, the state is `ready` and a retry may be advised.

Inputs, named exactly as here:

- `receipts`: a list of records with `id`, `operation` and `attempt` (text), `sequence` (a whole number in unit `revision`), `status` (`confirmed`, `failed`, `pending` or `unknown`) and `units` (a whole number in unit `item`), numbers 0 or more
- `policy`: a record with `operation` (text), `requested` (a whole number in unit `item`, 0 or more) and `maxAttempts` (a whole number in unit `count`, from 1 to 8)

Outputs, in this order:

1. `result`: a record with `state`, `confirmedUnits`, `confirmedAttempts`, `failedAttempts`, `pendingAttempts`, `unknownAttempts`, `attempts` and `mayRetry`

The program's `thought` declaration is required. The language is defined in the QDL 1 spec at the `qdl-v1.0.0` release: https://github.com/CharlesHoskinson/quinelings/blob/qdl-v1.0.0/docs/QDL-V1.md

Reply with one `qdl-intent` record in one fenced `json` block.

## Rubric

The job's fixtures, in order:

- no attempts yet: inputs `{"receipts":[],"policy":{"operation":"craft","requested":3,"maxAttempts":4}}` give `[{"state":"ready","confirmedUnits":0,"confirmedAttempts":0,"failedAttempts":0,"pendingAttempts":0,"unknownAttempts":0,"attempts":0,"mayRetry":true}]`
- partial confirmations and exhausted fourth: inputs `{"receipts":[{"id":"a","operation":"craft","attempt":"attempt1","sequence":1,"status":"confirmed","units":1},{"id":"b","operation":"craft","attempt":"attempt2","sequence":1,"status":"confirmed","units":1},{"id":"c","operation":"craft","attempt":"attempt3","sequence":1,"status":"confirmed","units":1},{"id":"d","operation":"craft","attempt":"attempt4","sequence":1,"status":"failed","units":0}],"policy":{"operation":"craft","requested":4,"maxAttempts":4}}` give `[{"state":"exhausted","confirmedUnits":3,"confirmedAttempts":3,"failedAttempts":1,"pendingAttempts":0,"unknownAttempts":0,"attempts":4,"mayRetry":false}]`
- unknown stops retry advice: inputs `{"receipts":[{"id":"a","operation":"craft","attempt":"attempt1","sequence":1,"status":"confirmed","units":1},{"id":"z","operation":"craft","attempt":"attempt2","sequence":1,"status":"unknown","units":0}],"policy":{"operation":"craft","requested":3,"maxAttempts":4}}` give `[{"state":"unknown","confirmedUnits":1,"confirmedAttempts":1,"failedAttempts":0,"pendingAttempts":0,"unknownAttempts":1,"attempts":2,"mayRetry":false}]`
- pending is not confirmation: inputs `{"receipts":[{"id":"p","operation":"craft","attempt":"attempt1","sequence":1,"status":"pending","units":0}],"policy":{"operation":"craft","requested":3,"maxAttempts":4}}` give `[{"state":"pending","confirmedUnits":0,"confirmedAttempts":0,"failedAttempts":0,"pendingAttempts":1,"unknownAttempts":0,"attempts":1,"mayRetry":false}]`
- duplicate acknowledgement counted once: inputs `{"receipts":[{"id":"a","operation":"craft","attempt":"attempt1","sequence":1,"status":"confirmed","units":1},{"id":"a","operation":"craft","attempt":"attempt1","sequence":1,"status":"confirmed","units":1}],"policy":{"operation":"craft","requested":1,"maxAttempts":4}}` give `[{"state":"completed","confirmedUnits":1,"confirmedAttempts":1,"failedAttempts":0,"pendingAttempts":0,"unknownAttempts":0,"attempts":1,"mayRetry":false}]`
- terminal regression is failed evaluation: inputs `{"receipts":[{"id":"a","operation":"craft","attempt":"attempt1","sequence":1,"status":"confirmed","units":1},{"id":"later","operation":"craft","attempt":"attempt1","sequence":2,"status":"pending","units":0}],"policy":{"operation":"craft","requested":3,"maxAttempts":4}}` fail with diagnostic `receipt-conflict`

Met when every fixture matches.

## Source

Written for Andamio Desktop, from the `receipt-reconciliation` job in the Quinelings QDL 1 library at its qdl-v1.0.0 release (github.com/CharlesHoskinson/quinelings, Apache-2.0 license). The rubric is the job's own fixtures.
