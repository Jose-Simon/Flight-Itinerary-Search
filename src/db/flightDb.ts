import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { SCHEMA_V1 } from './schema'
import { idbLoadSqlite, idbSaveSqlite } from './idb'
import { seedAirlineUiRegionsIfEmpty } from './airlineRegionRepo'
import { migrateRegionModelV2, seedRegionsIfEmpty, syncRegionCatalog } from './regionRepo'
import { backfillRtPairCacheRoutes } from './rtPairCacheRepo'

let sqlPromise: Promise<SqlJsStatic> | null = null
let dbPromise: Promise<Database> | null = null

function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => (file.endsWith('.wasm') ? sqlWasmUrl : file),
    })
  }
  return sqlPromise
}

function migrateSearchRunPaxDesc(db: Database) {
  const info = db.exec("SELECT name FROM pragma_table_info('search_run')")
  const cols = (info[0]?.values ?? []).map((r) => r[0] as string)
  if (!cols.includes('pax_desc')) {
    db.run("ALTER TABLE search_run ADD COLUMN pax_desc TEXT NOT NULL DEFAULT '1A'")
  }
}

function migratePriceVerificationCachedPrice(db: Database) {
  const info = db.exec("SELECT name FROM pragma_table_info('price_verification')")
  const cols = (info[0]?.values ?? []).map((r) => r[0] as string)
  if (cols.length && !cols.includes('cached_price')) {
    db.run('ALTER TABLE price_verification ADD COLUMN cached_price REAL')
  }
}

function migrateRtPairCache(db: Database) {
  db.run(`CREATE TABLE IF NOT EXISTS rt_pair_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    updated_at INTEGER NOT NULL,
    params_hash TEXT NOT NULL,
    out_date TEXT NOT NULL,
    ret_date TEXT NOT NULL,
    pax_desc TEXT NOT NULL,
    mock_mode INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    UNIQUE(params_hash, out_date, ret_date, pax_desc, mock_mode)
  )`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_rt_pair_cache_lookup
    ON rt_pair_cache(params_hash, out_date, ret_date, pax_desc, mock_mode)`)
  const info = db.exec("SELECT name FROM pragma_table_info('rt_pair_cache')")
  const cols = (info[0]?.values ?? []).map((r) => r[0] as string)
  if (cols.length && !cols.includes('origins')) {
    db.run('ALTER TABLE rt_pair_cache ADD COLUMN origins TEXT NOT NULL DEFAULT ""')
    db.run('ALTER TABLE rt_pair_cache ADD COLUMN destinations TEXT NOT NULL DEFAULT ""')
    db.run(`CREATE INDEX IF NOT EXISTS idx_rt_pair_cache_route
      ON rt_pair_cache(origins, destinations, out_date, ret_date, pax_desc, mock_mode)`)
  }
  backfillRtPairCacheRoutes(db)
}

function migratePriceVerificationV2(db: Database) {
  // price_verification was added without out_dep_time / ret_dep_time columns.
  // Since the table was introduced in the same release as these columns and
  // no user data exists yet, drop and recreate so the UNIQUE constraint is correct.
  const info = db.exec("SELECT name FROM pragma_table_info('price_verification')")
  const cols = (info[0]?.values ?? []).map((r) => r[0] as string)
  if (!cols.includes('out_dep_time')) {
    db.run('DROP TABLE IF EXISTS price_verification')
  }
}

function migrate(db: Database) {
  db.run('PRAGMA foreign_keys = ON')
  migratePriceVerificationV2(db)   // must run before SCHEMA_V1 recreates the table
  db.exec(SCHEMA_V1)
  migrateSearchRunPaxDesc(db)
  migrateRtPairCache(db)
  migratePriceVerificationCachedPrice(db)
  syncRegionCatalog(db)
  seedRegionsIfEmpty(db)
  migrateRegionModelV2(db)
  seedAirlineUiRegionsIfEmpty(db)
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

export function schedulePersist(db: Database) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    const run = () => void persistNow(db)
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 4000 })
    } else {
      void run()
    }
  }, 1200)
}

export async function persistNow(db: Database) {
  await new Promise<void>((r) => setTimeout(r, 0))
  const data = db.export()
  await idbSaveSqlite(data)
}

export function getFlightDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const SQL = await getSql()
      const buf = await idbLoadSqlite()
      const db = buf ? new SQL.Database(buf) : new SQL.Database()
      migrate(db)
      if (!buf) await persistNow(db)
      return db
    })()
  }
  return dbPromise
}

export async function resetFlightDatabase() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  const SQL = await getSql()
  const db = new SQL.Database()
  migrate(db)
  dbPromise = Promise.resolve(db)
  await persistNow(db)
}

/** Replace in-browser DB with a downloaded .sqlite file (e.g. after Download DB from another machine). */
export async function restoreFlightDatabaseFromBytes(bytes: Uint8Array) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  const SQL = await getSql()
  const db = new SQL.Database(bytes)
  migrate(db)
  dbPromise = Promise.resolve(db)
  await persistNow(db)
}
