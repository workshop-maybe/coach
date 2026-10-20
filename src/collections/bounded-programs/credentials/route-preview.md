# Route preview

## Learning targets

1. I can turn a described job into a bounded QDL 1 program that compiles and passes its fixtures.
2. I can find a shortest route that keeps the given neighbor order and gate a walking proposal on it.

## Task

Write a QDL 1 program for this job: preview a walking route from `A` to `D` on a supplied map of four places. Search breadth first, visiting each place's neighbors in the order listed, so the route has the fewest edges. A blocked place cannot be entered. When there is no route, `found` is false, the path is an empty list and the distance is null. The program proposes walking the path. A map that is not current still shows its route, but its proposal is skipped. A route preview is not arrival.

Inputs, named exactly as here:

- `streets`: a record with fields `A`, `B`, `C` and `D`, each an ordered list of neighbor names (text)
- `blocked`: a list of place names (text)
- `current`: true or false, whether the map is current

Outputs, in this order:

1. `route`: a record with `found`, `path` and `distance`
2. `proposal`: a `walk-proposal` action whose payload is the path, simulated when ready and skipped when not
3. `ready`: true when a route is found and the map is current

The program's `thought` declaration is required. The language is defined in the QDL 1 spec at the `qdl-v1.0.0` release: https://github.com/CharlesHoskinson/quinelings/blob/qdl-v1.0.0/docs/QDL-V1.md

Reply with one `qdl-intent` record in one fenced `json` block.

## Rubric

The job's fixtures, in order:

- stable neighbor order: inputs `{"streets":{"A":["C","B"],"B":["D"],"C":["D"],"D":[]},"blocked":[],"current":true}` give `[{"found":true,"path":["A","C","D"],"distance":2},{"status":"simulated","action":"walk-proposal","payload":["A","C","D"]},true]`
- blocked goal: inputs `{"streets":{"A":["C","B"],"B":["D"],"C":["D"],"D":[]},"blocked":["D"],"current":true}` give `[{"found":false,"path":[],"distance":null},{"status":"skipped","action":"walk-proposal","payload":[]},false]`
- stale route snapshot: inputs `{"streets":{"A":["C","B"],"B":["D"],"C":["D"],"D":[]},"blocked":[],"current":false}` give `[{"found":true,"path":["A","C","D"],"distance":2},{"status":"skipped","action":"walk-proposal","payload":["A","C","D"]},false]`

Met when every fixture matches.

## Source

Written for Andamio Desktop, from the `route-preview` job in the Quinelings QDL 1 library at its qdl-v1.0.0 release (github.com/CharlesHoskinson/quinelings, Apache-2.0 license). The rubric is the job's own fixtures.
