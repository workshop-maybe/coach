# Quinelings runtime

`quinelings-runtime.js` is Quinelings' bundled browser runtime, copied byte for byte from the `qdl-v1.0.0` release with its source map, `quinelings-runtime.js.map`. Nothing in either is changed. The map is kept so the runtime's own `sourceMappingURL` comment resolves in development and tests; production builds don't ship it.

- Upstream: https://github.com/CharlesHoskinson/quinelings
- Release tag: `qdl-v1.0.0`
- Commit: `4d63e49feaae05295a5ad8933f2cd070b9447700`
- Upstream path: `assets/ranch/quinelings-runtime.js`
- SHA-256: `92d6d7e84b9abe4aecee8f8b8da1999aec86e5506b212bb4d8eafb85e3e054ea`
- Source map SHA-256: `8ab91d87282bab3bfd07bf9001ee320fe432fa0823025d6a5d2171e0a5530d11`
- License: Apache-2.0 (`LICENSE` beside this file)

The tagged commit has no license file of its own. The author licensed the repository under Apache-2.0 in the next commit (`63b791e`, "License under Apache-2.0"), and `LICENSE` here is that file.

## What the app uses

Only `src/domain/quinelings.ts` imports the runtime, on demand. The app uses:

- `V1Session`: `compile`, `verify`, `run` and `frame`, to check a pasted program, run it on the job's fixtures and sample its body.
- `QDLV1Library`: the ten jobs of the QDL 1 library, with their reference programs and fixtures.
- `Quinelings.canon`: canonical JSON, to compare outputs regardless of key order.

A pasted program reaches the runtime only as parsed JSON, which its bounded interpreter reads as data. The runtime makes no network calls and has no `eval`. It bundles Zod 4, whose schema compiler builds functions with the `Function` constructor from the runtime's own schemas. `src/domain/quinelings.test.ts` pins this file's hash and those three constructor sites, so replacing the file is a deliberate change.

## Updating

Copy the file from a checkout of the new release tag, update the tag, commit and hash above and in `src/domain/quinelings.ts`, and rerun the tests. The ten badges in `src/collections/bounded-programs/` restate each job's fixtures, and their tests fail if the library changed.
