# Needs triage

## Learning targets

1. I can turn a described job into a bounded QDL 1 program that compiles and passes its fixtures.
2. I can choose one item by a ranked rule with a stable tie break and propose it without consuming it.

## Task

Write a QDL 1 program for this job: choose a food to propose eating. Among the supplied foods that are both edible and fresh, choose the one with the highest restoration, breaking ties by the smallest id. The proposal is ready only when a food is found, hunger is above 0 and the needs are current. A ready proposal carries the chosen id; otherwise its payload is empty text. Nothing is eaten and no hunger or health changes.

Inputs, named exactly as here:

- `foods`: a list of records with `id` (text), `edible` and `fresh` (true or false) and `restoration` (a whole number in unit `one`, 0 or more), each `id` unique
- `hunger`: a whole number in unit `one`, 0 or more
- `current`: true or false, whether the needs are current

Outputs, in this order:

1. `proposal`: an `eat-proposal` action, simulated when ready and skipped when not
2. `ready`: true when the proposal is ready

The program's `thought` declaration is required. The language is defined in the QDL 1 spec at the `qdl-v1.0.0` release: https://github.com/CharlesHoskinson/quinelings/blob/qdl-v1.0.0/docs/QDL-V1.md

Reply with one `qdl-intent` record in one fenced `json` block.

## Rubric

The job's fixtures, in order:

- stable item ID breaks restoration tie: inputs `{"foods":[{"id":"b","edible":true,"fresh":true,"restoration":8},{"id":"a","edible":true,"fresh":true,"restoration":8}],"hunger":4,"current":true}` give `[{"status":"simulated","action":"eat-proposal","payload":"a"},true]`
- no hunger: inputs `{"foods":[{"id":"b","edible":true,"fresh":true,"restoration":8},{"id":"a","edible":true,"fresh":true,"restoration":8}],"hunger":0,"current":true}` give `[{"status":"skipped","action":"eat-proposal","payload":""},false]`
- absent food: inputs `{"foods":[],"hunger":4,"current":true}` give `[{"status":"skipped","action":"eat-proposal","payload":""},false]`
- stale needs: inputs `{"foods":[{"id":"b","edible":true,"fresh":true,"restoration":8},{"id":"a","edible":true,"fresh":true,"restoration":8}],"hunger":4,"current":false}` give `[{"status":"skipped","action":"eat-proposal","payload":""},false]`

Met when every fixture matches.

## Source

Written for Andamio Desktop, from the `needs-triage` job in the Quinelings QDL 1 library at its qdl-v1.0.0 release (github.com/CharlesHoskinson/quinelings, Apache-2.0 license). The rubric is the job's own fixtures.
