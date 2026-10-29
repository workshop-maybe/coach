# Confirmed checkpoints

## Learning targets

1. I can turn a described job into a bounded QDL 1 program that compiles and passes its fixtures.
2. I can require fresh observations, not testimony, before calling a checkpoint confirmed.

## Task

Write a QDL 1 program for this job: decide whether a mission is complete. It has two checkpoints, the claims `haul` and `arrival`, and each needs fresh support from records of kind `observation` only. Testimony and inference never confirm a checkpoint. A record is fresh when its age, `now` minus `observedAt`, is at most `maxAge` and its `revision` is at least `minRevision`; both bounds are inclusive. Fresh true and false observations of one claim are a conflict. The mission is complete only when both checkpoints are `supported`, and the output keeps each checkpoint's state so a false result still shows why.

Inputs, named exactly as here:

- `records`: a list of evidence records, each with `id`, `source` and `claim` (text), `value` (true, false or null), `kind` (`observation`, `testimony` or `inference`), `observedAt` (a whole number in unit `tick`) and `revision` (a whole number in unit `revision`), numbers 0 or more
- `clock`: a record with `now` and `maxAge` (whole numbers in unit `tick`) and `minRevision` (a whole number in unit `revision`), all 0 or more

Outputs, in this order:

1. `checkpointStates`: a report with `haul` and `arrival`, each that checkpoint's evidence state, such as `supported`, `unknown` or `conflict`
2. `completed`: true when both checkpoints are supported

The program's `thought` declaration is required. The language is defined in the QDL 1 spec at the `qdl-v1.0.0` release: https://github.com/CharlesHoskinson/quinelings/blob/qdl-v1.0.0/docs/QDL-V1.md

Reply with one `qdl-intent` record in one fenced `json` block.

## Rubric

The job's fixtures, in order:

- both confirmed: inputs `{"records":[{"id":"a","source":"a","claim":"haul","value":true,"kind":"observation","observedAt":10,"revision":1},{"id":"b","source":"b","claim":"arrival","value":true,"kind":"observation","observedAt":10,"revision":1}],"clock":{"now":12,"maxAge":2,"minRevision":1}}` give `[{"haul":"supported","arrival":"supported"},true]`
- testimony is not checkpoint confirmation: inputs `{"records":[{"id":"a","source":"a","claim":"haul","value":true,"kind":"testimony","observedAt":10,"revision":1},{"id":"b","source":"b","claim":"arrival","value":true,"kind":"observation","observedAt":10,"revision":1}],"clock":{"now":12,"maxAge":2,"minRevision":1}}` give `[{"haul":"unknown","arrival":"supported"},false]`
- stale checkpoint: inputs `{"records":[{"id":"a","source":"a","claim":"haul","value":true,"kind":"observation","observedAt":9,"revision":1},{"id":"b","source":"b","claim":"arrival","value":true,"kind":"observation","observedAt":10,"revision":1}],"clock":{"now":12,"maxAge":2,"minRevision":1}}` give `[{"haul":"unknown","arrival":"supported"},false]`
- contradictory checkpoint: inputs `{"records":[{"id":"a","source":"a","claim":"haul","value":true,"kind":"observation","observedAt":10,"revision":1},{"id":"z","source":"z","claim":"haul","value":false,"kind":"observation","observedAt":10,"revision":1},{"id":"b","source":"b","claim":"arrival","value":true,"kind":"observation","observedAt":10,"revision":1}],"clock":{"now":12,"maxAge":2,"minRevision":1}}` give `[{"haul":"conflict","arrival":"supported"},false]`

Met when every fixture matches.

## Source

Written for Coach, from the `confirmed-checkpoints` job in the Quinelings QDL 1 library at its qdl-v1.0.0 release (github.com/CharlesHoskinson/quinelings, Apache-2.0 license). The rubric is the job's own fixtures.
