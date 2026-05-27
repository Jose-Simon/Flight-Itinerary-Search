import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { SCHEMA_V1 } from './schema'
import { idbLoadSqlite, idbSaveSqlite } from './idb'
import { seedAirlineUiRegionsIfEmpty } from './airlineRegionRepo'
import { migrateRegionModelV2, seedRegionsIfEmpty, syncRegionCatalog } from './regionRepo'

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

function migrate(db: Database) {
  db.run('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA_V1)
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
    void persistNow(db)
  }, 400)
}

export async function persistNow(db: Database) {
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
