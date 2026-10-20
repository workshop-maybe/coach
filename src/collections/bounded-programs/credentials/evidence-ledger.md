# Evidence ledger

## Learning targets

1. I can turn a described job into a bounded QDL 1 program that compiles and passes its fixtures.
2. I can assess a claim from evidence while keeping every record I used or skipped in view.

## Task

Write a QDL 1 program for this job: assess exactly one supplied claim from evidence records. Records of all three kinds count, but only for that exact claim. A record whose `value` is null is skipped with the reason `unknown`. A record older than `maxAge`, or with a `revision` below `minRevision`, is skipped with the reason `stale`; both bounds are inclusive. Identical records from one source count once. One source that supplies both true and false counts once in each of support and refute and is listed once as a source conflict. No evidence gives the state `unknown` with zero counts. Every used or skipped entry keeps its complete record. A source's name does not prove it is independent or genuine.

Inputs, named exactly as here:

- `records`: a list of evidence records, each with `id`, `source` and `claim` (text), `value` (true, false or null), `kind` (`observation`, `testimony` or `inference`), `observedAt` (a whole number in unit `tick`) and `revision` (a whole number in unit `revision`), numbers 0 or more
- `claim`: the claim to assess, as text
- `clock`: a record with `now` and `maxAge` (whole numbers in unit `tick`) and `minRevision` (a whole number in unit `revision`), all 0 or more

Outputs, in this order:

1. `ledger`: a record with `state`, `support`, `refute`, `sources`, `sourceConflicts`, `used` and `skipped`, where each skipped entry holds its `record` and a `reason`

The program's `thought` declaration is required. The language is defined in the QDL 1 spec at the `qdl-v1.0.0` release: https://github.com/CharlesHoskinson/quinelings/blob/qdl-v1.0.0/docs/QDL-V1.md

Reply with one `qdl-intent` record in one fenced `json` block.

## Rubric

The job's fixtures, in order:

- no supplied evidence: inputs `{"records":[],"claim":"ready","clock":{"now":10,"maxAge":10,"minRevision":2}}` give `[{"state":"unknown","support":0,"refute":0,"sources":0,"sourceConflicts":[],"used":[],"skipped":[]}]`
- inclusive age and revision: inputs `{"records":[{"id":"a","source":"sensor","claim":"ready","value":true,"kind":"observation","observedAt":0,"revision":2}],"claim":"ready","clock":{"now":10,"maxAge":10,"minRevision":2}}` give `[{"state":"supported","support":1,"refute":0,"sources":1,"sourceConflicts":[],"used":[{"id":"a","source":"sensor","claim":"ready","value":true,"kind":"observation","observedAt":0,"revision":2}],"skipped":[]}]`
- same source contradiction retained: inputs `{"records":[{"id":"a","source":"sensor","claim":"ready","value":true,"kind":"observation","observedAt":0,"revision":2},{"id":"z","source":"sensor","claim":"ready","value":false,"kind":"observation","observedAt":0,"revision":2}],"claim":"ready","clock":{"now":10,"maxAge":10,"minRevision":2}}` give `[{"state":"conflict","support":1,"refute":1,"sources":1,"sourceConflicts":["sensor"],"used":[{"id":"a","source":"sensor","claim":"ready","value":true,"kind":"observation","observedAt":0,"revision":2},{"id":"z","source":"sensor","claim":"ready","value":false,"kind":"observation","observedAt":0,"revision":2}],"skipped":[]}]`
- unknown value remains unknown: inputs `{"records":[{"id":"u","source":"sensor","claim":"ready","value":null,"kind":"observation","observedAt":0,"revision":2}],"claim":"ready","clock":{"now":10,"maxAge":10,"minRevision":2}}` give `[{"state":"unknown","support":0,"refute":0,"sources":0,"sourceConflicts":[],"used":[],"skipped":[{"record":{"id":"u","source":"sensor","claim":"ready","value":null,"kind":"observation","observedAt":0,"revision":2},"reason":"unknown"}]}]`
- stale value remains unavailable: inputs `{"records":[{"id":"a","source":"sensor","claim":"ready","value":true,"kind":"observation","observedAt":0,"revision":2}],"claim":"ready","clock":{"now":11,"maxAge":10,"minRevision":2}}` give `[{"state":"unknown","support":0,"refute":0,"sources":0,"sourceConflicts":[],"used":[],"skipped":[{"record":{"id":"a","source":"sensor","claim":"ready","value":true,"kind":"observation","observedAt":0,"revision":2},"reason":"stale"}]}]`

Met when every fixture matches.

## Source

Written for Andamio Desktop, from the `evidence-ledger` job in the Quinelings QDL 1 library at its qdl-v1.0.0 release (github.com/CharlesHoskinson/quinelings, Apache-2.0 license). The rubric is the job's own fixtures.
