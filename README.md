# Flight itinerary discovery

Single-page app to discover flight **routing** options (no booking, no fares). Data comes from the [SerpApi Google Flights API](https://serpapi.com/google-flights-api) via a small same-origin proxy (SerpApi does not allow browser `fetch` directly).

## Project layout

- `src/` — React (Vite + TypeScript) UI and client logic
- `server/index.js` — Express: `POST /api/google-flights` proxies to SerpApi; in production serves the Vite `dist/` SPA
- `scripts/build-airports.mjs` — Downloads OpenFlights `airports.dat` / `countries.dat` and generates `src/data/airports.json` and `countryToAirports.json` (includes IANA `tz` per airport where available)
- **Browser SQLite** — [sql.js](https://sql.js.org/) persists to **IndexedDB** (`flight-itinerary-discovery-sqlite`). It stores editable **region→country** rows, **search snapshots** (full itinerary JSON plus normalized `segment` / `layover_row` tables for durations and first-leg local hours), and a configurable **cache TTL** for skipping repeat SerpApi calls.

## Local development

```bash
npm install
npm run dev
```

This runs Vite (with `/api` and `/health` proxied to the local server) and the API server on port `8787`. Open the URL Vite prints (usually `http://localhost:5173`).

**Mock mode** (default in a fresh browser) uses bundled sample JSON so you can validate the UI without SerpApi quota.

## Production build

```bash
npm run build
npm start
```

`npm start` sets `NODE_ENV=production` and serves `dist/` plus the API routes.

## Render.com

1. Create a **Web Service** (not a Static Site) and point it at this repository.
2. Use **Build command**: `npm install --no-audit --no-fund && npm run build` (prefer this over `npm ci` when the lockfile was generated elsewhere: Linux CI may resolve optional wasm peers like `@emnapi/*` differently.)
3. **Start command**: `npm start`
4. Set **Health check path** to `/health` (optional; also configured in `render.yaml` if you use [Blueprint](https://render.com/docs/blueprint-spec)).

Render injects `PORT`; the server listens on that value.

## Settings

- **SerpApi API key** is stored only in `localStorage` in the user’s browser and sent to **your** server on each search; the server forwards it to SerpApi and does not persist it.
- **Region → country lists** (ISO 3166-1 alpha-2) are editable in Settings and stored in **SQLite** (browser). On first launch, legacy `regionCountries` from an older `localStorage` export may be imported once.
- **Reset local database** (Settings) wipes IndexedDB SQLite and reseeds regions; use if you change schema or need a clean slate.

## Round trip behavior

Outbound and return are two **independent** one-way-style SerpApi searches (destinations ↔ origins on the return leg). This avoids chained `departure_token` calls and matches “routing discovery only,” not a single round-trip fare quote.
