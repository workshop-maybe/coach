# Gather readiness

## Learning targets

1. I can turn a described job into a bounded QDL 1 program that compiles and passes its fixtures.
2. I can gate an action on a set of ordered checks and an inclusive freshness window.

## Task

Write a QDL 1 program for this job: decide whether one gather can go ahead, and propose it. Six supplied checks come in this order: skill, route, reservation, capacity, owner permission, remaining uses. Every check must be true. The observation is fresh when `observedAt` is not after `now` and its age, `now` minus `observedAt`, is at most `maxAge`; an age equal to `maxAge` is fresh. Work out the age so that a future `observedAt` cannot take it below zero. The program proposes gathering 3 items. A proposal is not a confirmed haul.

Inputs, named exactly as here:

- `checks`: a list of exactly six true or false values
- `observedAt`: a whole number in unit `tick`, 0 or more
- `now`: a whole number in unit `tick`, 0 or more
- `maxAge`: a whole number in unit `tick`, 0 or more

Outputs, in this order:

1. `proposal`: a `gather-proposal` action with payload 3, simulated when ready and skipped when not
2. `ready`: true when every check holds and the observation is fresh

The program's `thought` declaration is required. The language is defined in the QDL 1 spec at the `qdl-v1.0.0` release: https://github.com/CharlesHoskinson/quinelings/blob/qdl-v1.0.0/docs/QDL-V1.md

Reply with one `qdl-intent` record in one fenced `json` block.

## Rubric

The job's fixtures, in order:

- inclusive freshness boundary: inputs `{"checks":[true,true,true,true,true,true],"observedAt":10,"now":12,"maxAge":2}` give `[{"status":"simulated","action":"gather-proposal","payload":3},true]`
- resource reserved check: inputs `{"checks":[true,true,false,true,true,true],"observedAt":10,"now":12,"maxAge":2}` give `[{"status":"skipped","action":"gather-proposal","payload":3},false]`
- stale observation: inputs `{"checks":[true,true,true,true,true,true],"observedAt":10,"now":13,"maxAge":2}` give `[{"status":"skipped","action":"gather-proposal","payload":3},false]`
- future observation: inputs `{"checks":[true,true,true,true,true,true],"observedAt":14,"now":12,"maxAge":2}` give `[{"status":"skipped","action":"gather-proposal","payload":3},false]`
- missing required snapshot: inputs `{"checks":[true,true,true,true,true,true],"now":12,"maxAge":2}` are refused with diagnostic `missing-input`

Met when every fixture matches.

## Source

Written for Andamio Desktop, from the `gather-readiness` job in the Quinelings QDL 1 library at its qdl-v1.0.0 release (github.com/CharlesHoskinson/quinelings, Apache-2.0 license). The rubric is the job's own fixtures.
