# Adaptation notes

## Provenance

Derived from https://github.com/z-col/dsh-workspace-groups under MIT, using its published JavaScript distribution as the baseline. The baseline subset in `tests/fixtures/upstream/` keeps exactly the files needed by `adapt.mjs` and the retired-runtime regression: client.js, index.js, package.json and LICENSE. The original machine-specific inline-CSS region comment has been replaced with `upstream-inline-css`, and the dangling source-map reference removed; executable baseline logic is unchanged. Original source maps, declaration files and unrelated packaging files were intentionally omitted.

`lib/` is the maintained runnable JavaScript source for this derivative; the original TypeScript source tree is not included. Always update adaptation anchors alongside generated runtime changes. Re-running `npm run build` must leave the checked-in runtime and manifest unchanged.

## 0.1 → 0.2 changes

- Old `dsh-client-runtime/client.defineStore` → shell-seeded `dsh-client-store.defineStore`.
- Size-named UI icons → Regular-weight icons while preserving pixel sizes.
- Session start/open/archive and directory selection → official `uiWorkspace` service.
- Rename uses `sessions.using` with `workspaceOperation` retain/ready/release scope.
- Main selection derives from `retainedBy.mainView`; status uses `useSessionStatus`; child count uses session projection catalogs.
- Removed unused connection hostDescription hook and discarded indexing computation.
- Host imports the declared `js-yaml` dependency instead of bundling a second YAML implementation.
- Exact target `engines.dsh = 0.2.1-rc.2`; no compatibility bypass. Runtime peers follow the target version.
- Package / client ID becomes `dsh-session-sorts`; display name becomes `DSH session sorts`. The legacy configuration ID, locale namespace, view storage key, routes, sidecar paths, file shapes and drag MIME are preserved.

Core grouping / tree / search / drag handlers and CSS are retained from upstream. The adaptation does not replace the UI with a simplified mock. Test-only React hook fixtures instrument the existing handlers.

## Evidence boundary

The full offline suite performs 13 checks: retired runtime failure; actual host ClientModuleSystem; current shell seed symbols; service injection; bridge calls; main/live/child projection; grouping/search/order; group CRUD handlers; drag handlers; real Node host routes and YAML round-trip; request limits/methods; and host compatibility preflight. Three require `DSH_TEST_HOST`; the other ten run with the project's npm dependency installation. Test results are generated locally and ignored, not shipped as user logs.

Node v26.7.0 was used for publication checks. Both runtime files pass `node --check`. Full browser rendering, actual pointer interactions, runtime dependency resolution in a newly installed profile, real session mutations, reconnect, concurrent windows and performance remain unverified. No installed plugin, profile setting or running host was modified for this publication.
