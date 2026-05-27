/** Initial schema for sql.js (client-side SQLite). */
export const SCHEMA_V1 = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Canonical region ids and labels (same set as \`RegionId\` in src/data/regions.ts). Not user-edited here.
CREATE TABLE IF NOT EXISTS region_catalog (
  region_id TEXT PRIMARY KEY,
  display_label TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  is_computed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS region_country (
  region_id TEXT NOT NULL,
  country_iso TEXT NOT NULL,
  PRIMARY KEY (region_id, country_iso)
);

-- ui_region column stores \`RegionId\` (e.g. unitedStates, india), not a free-form display name.
CREATE TABLE IF NOT EXISTS airline_ui_region (
  iata TEXT NOT NULL PRIMARY KEY,
  ui_region TEXT NOT NULL
);

-- Optional: 3-letter airport IATA to RegionId for layover bucketing (overrides directory country).
CREATE TABLE IF NOT EXISTS airport_ui_region (
  iata TEXT NOT NULL PRIMARY KEY,
  ui_region TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  params_hash TEXT NOT NULL,
  direction TEXT NOT NULL,
  origins TEXT NOT NULL,
  destinations TEXT NOT NULL,
  center_date TEXT NOT NULL,
  flex_days INTEGER NOT NULL,
  max_segments INTEGER NOT NULL,
  mock_mode INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS itinerary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  search_run_id INTEGER NOT NULL,
  waypoint_key TEXT NOT NULL,
  total_duration_mins INTEGER NOT NULL,
  open_jaw INTEGER NOT NULL DEFAULT 0,
  airlines_json TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (search_run_id) REFERENCES search_run(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS segment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  itinerary_id INTEGER NOT NULL,
  leg_index INTEGER NOT NULL,
  dep_iata TEXT NOT NULL,
  arr_iata TEXT NOT NULL,
  dep_local TEXT,
  arr_local TEXT,
  dep_tz TEXT,
  arr_tz TEXT,
  dep_hour_local INTEGER,
  duration_mins INTEGER NOT NULL,
  airline TEXT,
  flight_number TEXT,
  airplane TEXT,
  FOREIGN KEY (itinerary_id) REFERENCES itinerary(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS layover_row (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  itinerary_id INTEGER NOT NULL,
  layover_index INTEGER NOT NULL,
  airport TEXT NOT NULL,
  duration_mins INTEGER NOT NULL,
  is_technical INTEGER NOT NULL DEFAULT 0,
  excluded_region_allowed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (itinerary_id) REFERENCES itinerary(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_search_run_hash_dir ON search_run(params_hash, direction, mock_mode);
CREATE INDEX IF NOT EXISTS idx_itinerary_run ON itinerary(search_run_id);
CREATE INDEX IF NOT EXISTS idx_segment_itin ON segment(itinerary_id);
CREATE INDEX IF NOT EXISTS idx_layover_itin ON layover_row(itinerary_id);

-- Full SerpApi JSON per search run (raw responses + derived analysis). Trimmed to the last N rows in app code.
CREATE TABLE IF NOT EXISTS serp_api_capture (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  mock_mode INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_serp_capture_created ON serp_api_capture(created_at);

-- Recent search form snapshots (for History). Separate from search_run cache rows.
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  outbound_count INTEGER NOT NULL DEFAULT 0,
  return_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at);

-- User-saved itinerary cards (outbound and/or return legs tracked separately).
CREATE TABLE IF NOT EXISTS saved_result (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  leg TEXT NOT NULL,
  schedule_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(leg, schedule_key)
);

CREATE INDEX IF NOT EXISTS idx_saved_result_leg ON saved_result(leg);

-- User-named full search form snapshots (separate from automatic search_history).
CREATE TABLE IF NOT EXISTS saved_search (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_search_created ON saved_search(created_at);
`
