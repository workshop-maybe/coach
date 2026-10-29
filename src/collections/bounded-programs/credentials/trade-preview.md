# Trade preview

## Learning targets

1. I can turn a described job into a bounded QDL 1 program that compiles and passes its fixtures.
2. I can quote an exact quantity only when every limit allows it, and quote zero otherwise.

## Task

Write a QDL 1 program for this job: quote a sale against the supplied offer whose id is `offer`. An absent offer is read as an explicit default record. The quote is ready only when the offer is found, `now` is at most its `expiry`, the quantity is above 0, and the inventory, the offer's `available` stock and the allowance are each at least the quantity. A ready quote carries the exact quantity and predicted proceeds of price times quantity; otherwise both are 0. Crystals are a symbolic quantity, and the quote settles nothing.

Inputs, named exactly as here:

- `offers`: a list of records with `id` (text), `price` (a number in unit `crystal*item^-1`), `expiry` (a whole number in unit `tick`) and `available` (a whole number in unit `item`), numbers 0 or more and each `id` unique
- `now`: a whole number in unit `tick`, 0 or more
- `quantity`: a whole number in unit `item`, 0 or more
- `inventory`: a whole number in unit `item`, 0 or more
- `allowance`: a whole number in unit `item`, 0 or more

Outputs, in this order:

1. `quote`: a report with `ready`, `quantity` and `predictedProceeds`
2. `ready`: true when the quote is ready

The program's `thought` declaration is required. The language is defined in the QDL 1 spec at the `qdl-v1.0.0` release: https://github.com/CharlesHoskinson/quinelings/blob/qdl-v1.0.0/docs/QDL-V1.md

Reply with one `qdl-intent` record in one fenced `json` block.

## Rubric

The job's fixtures, in order:

- inclusive live-offer boundary: inputs `{"offers":[{"id":"offer","price":3,"expiry":10,"available":5}],"now":10,"quantity":2,"inventory":5,"allowance":2}` give `[{"ready":true,"quantity":2,"predictedProceeds":6},true]`
- expired offer: inputs `{"offers":[{"id":"offer","price":3,"expiry":10,"available":5}],"now":11,"quantity":2,"inventory":5,"allowance":2}` give `[{"ready":false,"quantity":0,"predictedProceeds":0},false]`
- absent offer: inputs `{"offers":[],"now":10,"quantity":2,"inventory":5,"allowance":2}` give `[{"ready":false,"quantity":0,"predictedProceeds":0},false]`
- allowance exhausted: inputs `{"offers":[{"id":"offer","price":3,"expiry":10,"available":5}],"now":10,"quantity":2,"inventory":5,"allowance":1}` give `[{"ready":false,"quantity":0,"predictedProceeds":0},false]`

Met when every fixture matches.

## Source

Written for Coach, from the `trade-preview` job in the Quinelings QDL 1 library at its qdl-v1.0.0 release (github.com/CharlesHoskinson/quinelings, Apache-2.0 license). The rubric is the job's own fixtures.
