# Water total

## Learning targets

1. I can turn a described job into a bounded QDL 1 program that compiles and passes its fixtures.
2. I can total a list of supplied measurements and count them in one report.

## Task

Write a QDL 1 program for this job: add up the supplied water readings in liters and count them. There are no hidden sensors, no unit conversion and no total kept between runs. A negative reading is refused.

Inputs, named exactly as here:

- `readings`: a list of numbers in unit `L`, each 0 or more

Outputs, in this order:

1. `summary`: a report with `liters`, the total, and `measurements`, the count

The program's `thought` declaration is required. The language is defined in the QDL 1 spec at the `qdl-v1.0.0` release: https://github.com/CharlesHoskinson/quinelings/blob/qdl-v1.0.0/docs/QDL-V1.md

Reply with one `qdl-intent` record in one fenced `json` block.

## Rubric

The job's fixtures, in order:

- ordinary readings: inputs `{"readings":[1.5,2,0.5]}` give `[{"liters":4,"measurements":3}]`
- empty observation batch: inputs `{"readings":[]}` give `[{"liters":0,"measurements":0}]`
- one supplied observation: inputs `{"readings":[2.25]}` give `[{"liters":2.25,"measurements":1}]`
- negative reading refused: inputs `{"readings":[-1]}` are refused with diagnostic `refinement`

Met when every fixture matches.

## Source

Written for Coach, from the `water-total` job in the Quinelings QDL 1 library at its qdl-v1.0.0 release (github.com/CharlesHoskinson/quinelings, Apache-2.0 license). The rubric is the job's own fixtures.
