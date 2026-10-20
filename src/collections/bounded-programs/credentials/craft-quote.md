# Craft quote

## Learning targets

1. I can turn a described job into a bounded QDL 1 program that compiles and passes its fixtures.
2. I can bound a quantity by several limits without changing the inventory it reads.

## Task

Write a QDL 1 program for this job: quote how many batches of a fixed recipe can be made, up to the number requested. Each batch uses 2 ore and 1 wood and takes 2 spaces of net capacity. Find ore and wood in the inventory by the ids `ore` and `wood`; a material that is absent counts as 0. The feasible number of batches is the smallest of the request, the ore divided by 2 and rounded down, the wood, and the free capacity divided by 2 and rounded down. The quote predicts what would be used and never changes the inventory. Negative amounts and duplicate inventory ids are refused.

Inputs, named exactly as here:

- `inventory`: a list of records with `id` (text) and `amount` (a whole number in unit `item`, 0 or more), each `id` unique
- `requested`: a whole number in unit `batch`, 0 or more
- `freeCapacity`: a whole number in unit `space`, 0 or more

Outputs, in this order:

1. `quote`: a report with `requested`, `feasible`, `oreUsed` and `woodUsed`
2. `fullRequest`: true when the feasible number equals the request

The program's `thought` declaration is required. The language is defined in the QDL 1 spec at the `qdl-v1.0.0` release: https://github.com/CharlesHoskinson/quinelings/blob/qdl-v1.0.0/docs/QDL-V1.md

Reply with one `qdl-intent` record in one fenced `json` block.

## Rubric

The job's fixtures, in order:

- capacity binds: inputs `{"inventory":[{"id":"ore","amount":7},{"id":"wood","amount":8}],"requested":4,"freeCapacity":5}` give `[{"requested":4,"feasible":2,"oreUsed":4,"woodUsed":2},false]`
- materials bind: inputs `{"inventory":[{"id":"ore","amount":7},{"id":"wood","amount":8}],"requested":4,"freeCapacity":100}` give `[{"requested":4,"feasible":3,"oreUsed":6,"woodUsed":3},false]`
- absent ore is explicit empty data: inputs `{"inventory":[{"id":"wood","amount":8}],"requested":4,"freeCapacity":100}` give `[{"requested":4,"feasible":0,"oreUsed":0,"woodUsed":0},false]`
- zero request: inputs `{"inventory":[],"requested":0,"freeCapacity":0}` give `[{"requested":0,"feasible":0,"oreUsed":0,"woodUsed":0},true]`
- negative inventory refused: inputs `{"inventory":[{"id":"ore","amount":-1}],"requested":1,"freeCapacity":3}` are refused with diagnostic `refinement`

Met when every fixture matches.

## Source

Written for Andamio Desktop, from the `craft-quote` job in the Quinelings QDL 1 library at its qdl-v1.0.0 release (github.com/CharlesHoskinson/quinelings, Apache-2.0 license). The rubric is the job's own fixtures.
