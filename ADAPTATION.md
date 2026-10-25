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
- `engines.dsh` is a range, `>=0.2.1-rc.2 <0.3.0`, so every 0.2.1 prerelease (rc.2, rc.3, …) and the 0.2 line pass the host preflight while 0.3+ stays rejected — no per-runtime exemption required. Runtime peers follow the same range.
- Package / client ID becomes `dsh-session-sorts`; display name becomes `DSH session sorts`. The legacy configuration ID, locale namespace, view storage key, routes, sidecar paths, file shapes and drag MIME are preserved.

Core grouping / tree / search / drag handlers and CSS are retained from upstream. The adaptation does not replace the UI with a simplified mock. Test-only React hook fixtures instrument the existing handlers.

## 0.1.0 → 0.1.1

DSH `0.2.1-rc.3` rejects the 0.1.0 manifest (`engines.dsh` pinned to `0.2.1-rc.2`) with `incompatible-version` before any plugin code loads. 0.1.1 changes the declaration only:

- `engines.dsh` → `>=0.2.1-rc.2 <0.3.0`; the two `@deepseek-ai/dsh-*` peers follow the same range.
- `lib/client.js` and `lib/index.js` are byte-identical to 0.1.0 (see the hashes in `out/test-results.json`); no runtime behavior changed.
- Verified against an installed `0.2.1-rc.3` tree: 13/13 checks pass, and preflight returns `undefined` for `0.2.1-rc.2` / `0.2.1-rc.3` / `0.2.1` / `0.2.9` while still reporting `engines.dsh` for `0.2.0` / `0.2.1-rc.1` / `0.3.0`. The client-side surface the plugin uses (`dsh-client-store.defineStore`, all 14 `ui-primitives` symbols, `uiWorkspace.openSession/startSession/archiveSession/pickDirectory`, `retainedBy.mainView`, `projectionsBySession`, `useSessionStatus`) is present in rc.3.

## Evidence boundary

The full offline suite performs 13 checks: retired runtime failure; actual host ClientModuleSystem; current shell seed symbols; service injection; bridge calls; main/live/child projection; grouping/search/order; group CRUD handlers; drag handlers; real Node host routes and YAML round-trip; request limits/methods; and host compatibility preflight (range acceptance plus rejection of older/newer lines). Three require `DSH_TEST_HOST`; the other ten run with the project's npm dependency installation. Test results are generated locally and ignored, not shipped as user logs.

Node v26.7.0 was used for publication checks. Both runtime files pass `node --check`. Full browser rendering, actual pointer interactions, runtime dependency resolution in a newly installed profile, real session mutations, reconnect, concurrent windows and performance remain unverified. No installed plugin, profile setting or running host was modified for this publication.
