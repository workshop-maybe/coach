# Work schedule

## Learning targets

1. I can turn a described job into a bounded QDL 1 program that compiles and passes its fixtures.
2. I can schedule dependent work and compare how long it takes with a deadline.

## Task

Write a QDL 1 program for this job: predict start and end ticks for a set of jobs. Jobs run in parallel, and each starts as early as the jobs it depends on allow, taken in a fixed ready order. The makespan is the latest end. The schedule is within the deadline when the makespan is at most the deadline. A dependency cycle makes the evaluation fail. The schedule reserves no workstation and does not confirm any work was done.

Inputs, named exactly as here:

- `jobs`: a list of records with `id` (text), `depends` (a list of job ids) and `duration` (a whole number in unit `tick`, 0 or more)
- `deadline`: a whole number in unit `tick`, 0 or more

Outputs, in this order:

1. `schedule`: a record with `order`, `jobs` (each with `id`, `start` and `end`) and `makespan`
2. `withinDeadline`: true when the makespan is at most the deadline

The program's `thought` declaration is required. The language is defined in the QDL 1 spec at the `qdl-v1.0.0` release: https://github.com/CharlesHoskinson/quinelings/blob/qdl-v1.0.0/docs/QDL-V1.md

Reply with one `qdl-intent` record in one fenced `json` block.

## Rubric

The job's fixtures, in order:

- parallel work and inclusive deadline: inputs `{"jobs":[{"id":"a","depends":[],"duration":3},{"id":"b","depends":["a"],"duration":2},{"id":"c","depends":[],"duration":4}],"deadline":5}` give `[{"order":["a","b","c"],"jobs":[{"id":"a","start":0,"end":3},{"id":"b","start":3,"end":5},{"id":"c","start":0,"end":4}],"makespan":5},true]`
- missed deadline: inputs `{"jobs":[{"id":"a","depends":[],"duration":3},{"id":"b","depends":["a"],"duration":2},{"id":"c","depends":[],"duration":4}],"deadline":4}` give `[{"order":["a","b","c"],"jobs":[{"id":"a","start":0,"end":3},{"id":"b","start":3,"end":5},{"id":"c","start":0,"end":4}],"makespan":5},false]`
- empty schedule: inputs `{"jobs":[],"deadline":0}` give `[{"order":[],"jobs":[],"makespan":0},true]`
- cyclic supplied jobs fail evaluation: inputs `{"jobs":[{"id":"a","depends":["b"],"duration":1},{"id":"b","depends":["a"],"duration":1}],"deadline":5}` fail with diagnostic `refinement`

Met when every fixture matches.

## Source

Written for Andamio Desktop, from the `work-schedule` job in the Quinelings QDL 1 library at its qdl-v1.0.0 release (github.com/CharlesHoskinson/quinelings, Apache-2.0 license). The rubric is the job's own fixtures.
