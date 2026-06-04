# Copilot Doctor

A Chrome extension that helps developers of Copilot-based systems verify orders against their corresponding jobs in **UiPath Orchestrator**.

## How It Works

1. You browse your Copilot page showing orders
2. Click the extension icon → **Scan This Page**
3. The content script extracts order IDs from the page
4. It queries UiPath Orchestrator for matching queue items and jobs
5. Results (job state, key, timing) appear in the popup

## Setup

### 1. Install
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder

### 2. Configure
Click the extension icon → **Settings**, then click **+ Add Site**.

Each site config ties a **hostname** (e.g. `copilot-prod.example.com`) to a UiPath environment:

| Field | Description |
|---|---|
| **Hostname** | The Copilot page domain this config applies to |
| **Organization** | Your UiPath organization name (the slug in your cloud URL) |
| **Tenant** | Your UiPath tenant name |
| **Folder** | The Orchestrator folder your jobs run under |
| **Queue Name** | The queue containing your order items |
| **Personal Access Token** | Your UiPath PAT (see below) |

Add separate configs for each environment (prod, preprod, staging, etc.). When you visit a Copilot page, the extension picks the config matching that page's hostname.

### 3. Create a PAT
1. Go to [cloud.uipath.com](https://cloud.uipath.com) → your tenant
2. **Settings** → **Integrations** → **OAuth** → **Add new token**
3. Grant scope `OR.Administration` (or `OR.Jobs` + `OR.Queues` + `OR.Monitoring`)
4. Copy the token and paste it into the extension settings

### 4. Use
- Navigate to any Copilot page displaying orders
- Click the extension icon → **Scan This Page**
- The popup will show matched orders and their UiPath job status

## Order ID Detection

By default, the extension scans page text for patterns like `Order: ABC123`, `ID: XYZ789`, etc.

You can set a custom CSS selector in Settings (e.g. `[data-order-id]`, `.order-ref`) to target specific elements. If empty, the default heuristic is used.

## Architecture

```
background.js      - Service worker; relays UiPath API calls (avoids CORS)
content.js         - Injected into all pages; scans for order IDs, queries Orchestrator
popup.html/js/css  - Quick status and scan trigger
options.html/js/css - Full configuration page
```

## Development

The codebase is structured as a plain MV3 Chrome extension with no build step. Edit any file and reload the extension at `chrome://extensions` to test changes.

## Credits

Based on a prior Tampermonkey userscript (`old/his_orchestrator_jobs.js`) by Maged Rifaat that integrated with a medical Copilot app.
