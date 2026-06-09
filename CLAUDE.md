# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run watch     # Rebuild on save (no type-check, no asset copy)
bun run build     # Bundle src/*.ts → dist/ (IIFE, minified) + copy HTML/CSS/manifest/icons
bun run pack      # build + zip dist/ → copilot-doctor-v<version>.zip (version from dist/manifest.json)
bun run lint      # Biome lint src/
bun run lint:fix  # Biome lint with autofix
bun run typecheck # tsc --noEmit (type-check only; emits nothing)
```

There is no test suite, and the build does **not** type-check — `bun build` strips types without checking them, so type errors compile silently. Bun has no built-in type checker; `bun run typecheck` shells out to `tsc` (config in `tsconfig.json`). Run it before committing type-sensitive changes.

After building, load `dist/` as an unpacked extension at `chrome://extensions` (Developer mode). Reload the extension there after each rebuild to pick up changes.

## Adding a new entry point

Each top-level script (`content`, `popup`, `jobs`, `options`, `background`) is an independent bundle entry. The entry list is **hardcoded** in the `build` and `watch` scripts in `package.json`. Adding a new page/script requires editing both commands, and copying any new HTML/CSS in the `build` script's `cp` step. Shared modules (`api.ts`, `cache.ts`, `config.ts`, `jobMatcher.ts`, `orderParser.ts`, `render.ts`) are imported, not listed as entries.

## Architecture

Chrome Manifest V3 extension. Orders shown on Copilot web pages are matched to UiPath Orchestrator jobs by `out_OrderUid`.

**CORS proxy via the background worker.** Content/popup/page scripts never call UiPath directly (the pages' origin can't reach `cloud.uipath.com`). All UiPath traffic goes through `background.ts`: callers use `sendUiPathRequest()` in `api.ts`, which posts a `UIPATH_REQUEST` message; the worker looks up the per-hostname config, builds the authenticated `cloud.uipath.com` URL, fetches, and returns `{data}` or `{error}`. When adding any UiPath call, add it to `api.ts` and route it through this message — do not `fetch` UiPath from a content/popup script.

**Endpoint path rule (in `background.ts`):** endpoints starting with `/api/` are used as-is; everything else (OData) is prefixed with `orchestrator_`. The `X-UIPATH-FolderPath` header scopes the request to the configured folder.

**Matching flow** (`content.ts` → `jobMatcher.ts` → `api.ts`):
1. `content.ts` runs only on Copilot pages. A `MutationObserver` watches `.order-card` class changes and auto-scans (400ms debounce) when the selected card or the visible-order set changes. All DOM scraping is isolated in `orderParser.ts` (`getVisibleOrderIds`, `getSelectedOrderId`, `getCardDate`) — it owns every Copilot-page selector (`.order-card`, `.patient-card-selected`, `.date p`); `content.ts` works only with plain order IDs and dates. Change selectors there, not in `content.ts`.
2. For each visible order, `getJobByOrderId()` calls `searchJobsByOrderId(orderId, since)` — an OData query filtered by `contains(OutputArguments, '<orderUid>')`, bounded by `CreationTime gt <card date>` for specificity. The lookback date comes from `getCardDate()` (parses the card's `.date p` `MM/DD/YYYY` text, defaulting to 30 days). The jobs page (`jobs.ts`) calls the same function without a date (free-form order-ID search).
3. Candidates are confirmed by `confirmJobsForOrder()` — it fetches each candidate's `OutputArguments` in detail (batched, 10 at a time via `Promise.allSettled`) and keeps only jobs whose **normalized output** resolves to `orderId`. The `contains` filter is a raw substring test, so this drops incidental hits. Confirmed jobs are then hydrated into full matches via `fetchJobMatch()` (video + deep link).
4. **Output-schema normalization** (`outputSchema.ts`): a job's `OutputArguments` JSON can take multiple shapes (flat `out_OrderUid`, or a queue transaction item with `transactionItem.SpecificContent.orderUid`). Each shape is an `OutputAdapter`; `normalizeOutput()` collapses them to `{ schema, orderUid, fields }`, and `outputMatchesOrder()` is the schema-agnostic match used by both the scan and the jobs page. Add a new shape by registering an adapter — matching and rendering pick it up automatically.
5. **Semantic analysis** (`outputAnalysis.ts`): `analyzeOutput(output, logs)` runs a registry of `AnalysisRule`s over an `AnalysisContext` (`{ output, normalized, logs }`) and returns severity-tagged `OutputComment`s — e.g. `out_Result === "Failure"` (output) or error/fatal entries in the robot logs (logs). `render.ts` paints these as callouts above the raw JSON: output-based comments show immediately, log-based ones fold in once the shared `logsPromise` resolves (the same fetch backs the "View logs" panel). Add a check by registering a rule in `RULES`.
6. Results stream to the popup via `SCAN_RESULTS` messages and are persisted (see storage below).

**Config is per-hostname, accessed through a singleton.** `siteConfigs` (the storage key) maps a Copilot hostname → `SiteConfig` (`org`, `tenant`, `folder`, `token`). `config.ts` owns a process-singleton cache of that map: `getConfig(hostname)` loads it from storage on first call, caches it, and refreshes it via a `storage.onChanged` listener so options-page edits propagate without a reload. It always resolves to a `SiteConfig` (`EMPTY_CONFIG` when the host has none), so callers (`content.ts`, `background.ts`) never guard for "not loaded yet" or re-read `chrome.storage.local` — use `getConfig`. The only meaningful config *validation* lives in `background.ts` (checks all four fields are non-empty before issuing a request); `EMPTY_CONFIG` is truthy-but-empty, so presence is tested per-field, not by null-check. Exception: `popup.ts` reads the raw `siteConfigs` map directly for its config-status banner — it needs to distinguish "host absent" from "host present", which `getConfig`'s EMPTY fallback would mask.

**`chrome.storage.local` keys:**
- `siteConfigs` — per-hostname UiPath credentials (written by `options.ts`)
- `latestScanResult` — cache of the most recent scan, tagged with `cachedHost`; `getCache()` returns it only on a hostname match (helpers in `cache.ts`)
- `savedJobs` — append-only history of matched scans, browsed in `jobs.ts`. `jobs.ts` has a `normalizeSavedJob()` shim that upgrades an older `matchedJob`/`matchedOutput` record shape to the current `matches[]` array — preserve this when changing `SavedJob`.
- `cachedOrderIds` — visible order IDs per hostname

**Message types** (string `type` field on `chrome.runtime`/`tabs` messages): `UIPATH_REQUEST` (→ background), `SCAN_ORDERS` (popup → content, triggers a scan), `SCAN_RESULTS` / `SCAN_STATUS` (content → popup).

## Hosts

`manifest.json` `content_scripts.matches` / `host_permissions` define where the content script is injected. `content.ts` separately gates real work behind `VALID_HOSTS` — note this set is **narrower** than the manifest matches (it omits the `pre-prod.apexmedicalai.com` variant). Keep these two in sync intentionally when changing supported domains.

## Conventions

- Strict TypeScript targeting the DOM + `chrome` types; messages arrive as `unknown` and are cast to the relevant `api.ts`/`cache.ts` interface — keep those interfaces as the single source of truth for wire/storage shapes.
- Biome enforces 2-space indent, double quotes, and `noForEach: "error"` (use `for...of`, not `Array.forEach`).
- DOM-building UI scripts (`render.ts`, `popup.ts`, `jobs.ts`) inject HTML strings — route any user/job-derived text through `escHtml()` in `render.ts`.

## Releases

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which runs `bun run pack` and attaches `copilot-doctor-v<version>.zip` to a generated GitHub Release (the workflow's `files:` uses the `copilot-doctor-v*.zip` glob). The zip's version comes from `manifest.json` copied into `dist/`, so bump `version` in **both** `package.json` and `manifest.json`.
