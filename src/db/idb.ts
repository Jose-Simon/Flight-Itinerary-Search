const IDB_NAME = 'flight-itinerary-discovery-sqlite'
const STORE = 'kv'
const KEY = 'flight_db'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onerror = () => reject(req.error)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
  })
}

export async function idbLoadSqlite(): Promise<Uint8Array | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const v = req.result
      resolve(v instanceof Uint8Array ? v : v ? new Uint8Array(v) : null)
    }
  })
}

export async function idbSaveSqlite(data: Uint8Array): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).put(data, KEY)
  })
}
