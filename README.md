# Copilot Doctor

Chrome extension that matches orders on Copilot pages to their corresponding UiPath Orchestrator jobs.

![Demo](media/demo.gif)

## Setup

### 1. Install

**Option A — GitHub Releases (recommended)**
1. Go to the [Releases page](https://github.com/belal-elsabbagh-apex/copilot-doctor/releases)
2. Download the latest `copilot-doctor-v*.zip`
3. Unzip it to a folder
4. Go to `chrome://extensions`, enable **Developer mode**
5. Click **Load unpacked** and select the extracted folder

**Option B — Build from source**
1. Run `bun run build` (or `bun run pack` for a `.zip`)
2. Go to `chrome://extensions`, enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` folder

### 2. Configure
Click the extension icon → **Settings** → **+ Add Site**.

Each config ties a **hostname** (e.g. `copilot.example.com`) to a UiPath environment:

| Field | Description |
|---|---|
| **Hostname** | The Copilot page domain this config applies to |
| **Organization** | Your UiPath org slug |
| **Tenant** | Your UiPath tenant |
| **Folder** | Orchestrator folder |
| **Personal Access Token** | UiPath PAT |

### 3. Create a PAT
1. Go to [cloud.uipath.com](https://cloud.uipath.com) → your tenant
2. **Settings** → **Integrations** → **OAuth** → **Add new token**
3. Grant scope including `OR.Jobs`
4. Paste the token into extension settings

## Usage

1. Navigate to a Copilot page showing orders
2. Click the extension icon — a **side panel** opens and stays docked while you work, auto-scanning the selected order card for matching UiPath jobs. The panel follows the active tab as you switch tabs.
3. The toolbar **badge** shows how many jobs matched the selected order, so you can see at a glance without opening the panel
4. If multiple jobs match, click between them in the panel to compare
5. Click **Refresh** to re-scan

For each matched job the panel shows:

- **Analysis comments** — severity-tagged notes flagging likely problems (e.g. `out_Result` = "Failure", error/warning log entries, or failure language in otherwise-benign log messages)
- **Output** — the full `OutputArguments` rendered as pretty, syntax-highlighted JSON (nested JSON strings expanded), with copy buttons
- **Recording** — the job's video recording, when available
- **Logs** — the robot execution logs (**View logs**); failure terms are highlighted and failing rows are flagged

### Browse Jobs

The **Browse Jobs** page lets you search any configured site for jobs by order ID directly (independent of the Copilot page), with the same job detail, analysis, and logs view.

## Development

```
src/
  background.ts      — Service worker; proxies UiPath API calls (avoids CORS)
  content.ts         — Injected into Copilot pages; scans orders, triggers matching
  api.ts             — UiPath request helpers (jobs, logs, video, search/confirm)
  jobMatcher.ts      — Resolves an order ID to its matching jobs
  orderParser.ts     — Copilot-page DOM scraping (order IDs, dates, selection)
  outputSchema.ts    — Normalizes the different OutputArguments shapes
  outputAnalysis.ts  — Rule engine producing analysis comments over output + logs
  render.ts          — Shared job-detail rendering (comments, JSON, video, logs)
  config.ts          — Per-hostname config singleton (chrome.storage)
  cache.ts           — Scan-result cache/storage shapes
  popup.ts           — Side panel UI (opened from the toolbar icon)
  badge.ts           — Toolbar badge state derived from a scan
  options.ts         — Settings page
  jobs.ts            — Browse Jobs page (search + saved results)
```

```bash
bun run watch     # Auto-compile on save
bun run build     # Compile + copy assets to dist/
bun run pack      # Build + create copilot-doctor-v<version>.zip
bun run test      # Run the unit test suite
bun run lint      # Biome lint
bun run typecheck # tsc --noEmit (the build does not type-check)
```

Load `dist/` as an unpacked extension. Changes apply after refreshing on `chrome://extensions`.

## How it works

The content script watches for selected order cards and queries UiPath via the background worker (which proxies all `cloud.uipath.com` traffic to avoid CORS). For each visible order it searches recent jobs whose `OutputArguments` contain the order ID, then confirms each candidate by parsing its output — a job matches when its **normalized order UID** equals the order. Normalization (`outputSchema.ts`) handles multiple output shapes, so both flat `out_OrderUid` outputs and queue transaction items are matched uniformly.

Matched jobs are rendered with semantic **analysis comments** (`outputAnalysis.ts`), the full output as JSON, the video recording, and on-demand robot logs. Results are saved locally for later review in the **Browse Jobs** page, which can also search any configured site by order ID directly.

## Releases

Bump `version` in **both** `package.json` and `manifest.json`, then push a `v*` tag. The release workflow runs `bun run pack` and attaches `copilot-doctor-v<version>.zip` to a generated GitHub Release.
