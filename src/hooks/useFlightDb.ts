import { useCallback, useEffect, useRef, useState } from 'react'
import type { RegionId } from '../data/regions'
import { cloneDefaultRegions } from '../data/regions'
import { getFlightDb, schedulePersist, resetFlightDatabase } from '../db/flightDb'
import {
  deleteSerpCapture,
  listSerpCaptures,
  loadSerpCaptureRecord,
  type SerpCaptureListRow,
  type SerpCaptureStoredRecord,
  saveSerpApiCapture,
} from '../db/serpCaptureRepo'
import type { SerpCaptureDownloadPayload } from '../lib/serpDebugExport'
import { loadAirportUiRegionsFromDb, replaceAllAirportUiRegions } from '../db/airportRegionRepo'
import {
  DEFAULT_AIRLINE_UI_REGION_ROWS,
  loadAirlineUiRegionsFromDb,
  replaceAllAirlineUiRegions,
} from '../db/airlineRegionRepo'
import { loadRegionsFromDb, replaceAllRegions } from '../db/regionRepo'
import { setCacheTtlHours, storeSearchResults, tryLoadCachedSearch } from '../db/searchRepo'
import { appendSearchHistory, deleteSearchHistoryEntry, listSearchHistory } from '../db/searchHistoryRepo'
import type { SearchHistoryRow, SearchHistorySnapshotV1 } from '../db/searchHistoryTypes'
import { deleteSavedResultByKey, listSavedResults, upsertSavedResult } from '../db/savedResultRepo'
import type { SavedResultLeg, SavedResultPayloadV1, SavedResultRow } from '../db/savedResultTypes'
import {
  deleteSavedSearch,
  getDefaultSavedSearchPayload,
  insertSavedSearch,
  listSavedSearches,
  setDefaultSavedSearchPayload,
} from '../db/savedSearchRepo'
import type { SavedSearchPayloadV1, SavedSearchRow } from '../db/savedSearchTypes'
import type { HashParts } from '../db/searchHash'
import type { NormalizedItinerary } from '../lib/types'

export function useFlightDb() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchHistory, setSearchHistory] = useState<SearchHistoryRow[]>([])
  const [savedResults, setSavedResults] = useState<SavedResultRow[]>([])
  const [savedSearches, setSavedSearches] = useState<SavedSearchRow[]>([])
  const [regionCountries, setRegionCountries] = useState<Record<RegionId, string[]>>(() => cloneDefaultRegions())
  const [airlineUiRegions, setAirlineUiRegions] = useState<Record<string, RegionId>>({})
  const [airportUiRegions, setAirportUiRegions] = useState<Record<string, RegionId>>({})
  const [cacheTtlHours, setCacheTtlHoursState] = useState(24)
  const airlineMapDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const airportMapDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const db = await getFlightDb()
        if (cancelled) return
        const r = db.exec("SELECT value FROM app_kv WHERE key = 'cache_ttl_hours'")
        const h = r[0]?.values[0]?.[0]
        if (h != null) {
          const n = Number(h)
          if (Number.isFinite(n)) setCacheTtlHoursState(n)
        }
        setRegionCountries(loadRegionsFromDb(db))
        setAirlineUiRegions(loadAirlineUiRegionsFromDb(db))
        setAirportUiRegions(loadAirportUiRegionsFromDb(db))
        setSearchHistory(listSearchHistory(db, 30))
        setSavedResults(listSavedResults(db))
        setSavedSearches(listSavedSearches(db))
        setReady(true)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Database failed to open')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const updateRegionText = useCallback(
    async (id: RegionId, text: string) => {
      const codes = text
        .split(/[\s,]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
      const db = await getFlightDb()
      const next = { ...regionCountries, [id]: codes }
      replaceAllRegions(db, next)
      setRegionCountries(loadRegionsFromDb(db))
      schedulePersist(db)
    },
    [regionCountries],
  )

  const resetRegions = useCallback(async () => {
    const db = await getFlightDb()
    replaceAllRegions(db, cloneDefaultRegions())
    replaceAllAirlineUiRegions(db, { ...DEFAULT_AIRLINE_UI_REGION_ROWS })
    replaceAllAirportUiRegions(db, {})
    setRegionCountries(loadRegionsFromDb(db))
    setAirlineUiRegions(loadAirlineUiRegionsFromDb(db))
    setAirportUiRegions(loadAirportUiRegionsFromDb(db))
    schedulePersist(db)
  }, [])

  const replaceAirlineMappings = useCallback((map: Record<string, RegionId>) => {
    if (airlineMapDebounceRef.current) clearTimeout(airlineMapDebounceRef.current)
    airlineMapDebounceRef.current = setTimeout(() => {
      airlineMapDebounceRef.current = null
      void (async () => {
        const db = await getFlightDb()
        replaceAllAirlineUiRegions(db, map)
        setAirlineUiRegions(loadAirlineUiRegionsFromDb(db))
        schedulePersist(db)
      })()
    }, 400)
  }, [])

  const replaceAirportMappings = useCallback((map: Record<string, RegionId>) => {
    if (airportMapDebounceRef.current) clearTimeout(airportMapDebounceRef.current)
    airportMapDebounceRef.current = setTimeout(() => {
      airportMapDebounceRef.current = null
      void (async () => {
        const db = await getFlightDb()
        replaceAllAirportUiRegions(db, map)
        setAirportUiRegions(loadAirportUiRegionsFromDb(db))
        schedulePersist(db)
      })()
    }, 400)
  }, [])

  const updateCacheTtl = useCallback(async (hours: number) => {
    const db = await getFlightDb()
    setCacheTtlHours(db, hours)
    setCacheTtlHoursState(Math.max(1, Math.min(168, Math.floor(hours))))
    schedulePersist(db)
  }, [])

  const persistSearch = useCallback(
    async (parts: HashParts, items: NormalizedItinerary[], tzByIata: Map<string, string>) => {
      const db = await getFlightDb()
      storeSearchResults(db, parts, items, tzByIata)
      schedulePersist(db)
    },
    [],
  )

  const loadCached = useCallback(async (parts: HashParts) => {
    const db = await getFlightDb()
    return tryLoadCachedSearch(db, parts)
  }, [])

  const refreshSearchHistory = useCallback(async () => {
    const db = await getFlightDb()
    setSearchHistory(listSearchHistory(db, 30))
  }, [])

  const recordSearchHistory = useCallback(
    async (snapshot: SearchHistorySnapshotV1, outboundCount: number, returnCount: number) => {
      const db = await getFlightDb()
      appendSearchHistory(db, snapshot, outboundCount, returnCount)
      schedulePersist(db)
      setSearchHistory(listSearchHistory(db, 30))
    },
    [],
  )

  const forgetSearchHistory = useCallback(async (id: number) => {
    const db = await getFlightDb()
    deleteSearchHistoryEntry(db, id)
    schedulePersist(db)
    setSearchHistory(listSearchHistory(db, 30))
  }, [])

  const saveSavedResult = useCallback(
    async (leg: SavedResultLeg, scheduleKey: string, payload: SavedResultPayloadV1) => {
      const db = await getFlightDb()
      upsertSavedResult(db, leg, scheduleKey, payload)
      schedulePersist(db)
      setSavedResults(listSavedResults(db))
    },
    [],
  )

  const removeSavedResult = useCallback(async (leg: SavedResultLeg, scheduleKey: string) => {
    const db = await getFlightDb()
    deleteSavedResultByKey(db, leg, scheduleKey)
    schedulePersist(db)
    setSavedResults(listSavedResults(db))
  }, [])

  const refreshSavedSearches = useCallback(async () => {
    const db = await getFlightDb()
    setSavedSearches(listSavedSearches(db))
  }, [])

  const addSavedSearch = useCallback(async (name: string, payload: SavedSearchPayloadV1) => {
    const db = await getFlightDb()
    insertSavedSearch(db, name, payload)
    schedulePersist(db)
    setSavedSearches(listSavedSearches(db))
  }, [])

  const removeSavedSearch = useCallback(async (id: number) => {
    const db = await getFlightDb()
    deleteSavedSearch(db, id)
    schedulePersist(db)
    setSavedSearches(listSavedSearches(db))
  }, [])

  const loadDefaultSavedSearchPayload = useCallback(async (): Promise<SavedSearchPayloadV1 | null> => {
    const db = await getFlightDb()
    return getDefaultSavedSearchPayload(db)
  }, [])

  const saveDefaultSavedSearch = useCallback(async (payload: SavedSearchPayloadV1) => {
    const db = await getFlightDb()
    setDefaultSavedSearchPayload(db, payload)
    schedulePersist(db)
  }, [])

  const resetEntireDb = useCallback(async () => {
    await resetFlightDatabase()
    const db = await getFlightDb()
    setRegionCountries(loadRegionsFromDb(db))
    setAirlineUiRegions(loadAirlineUiRegionsFromDb(db))
    setAirportUiRegions(loadAirportUiRegionsFromDb(db))
    setSearchHistory(listSearchHistory(db, 30))
    setSavedResults(listSavedResults(db))
    setSavedSearches(listSavedSearches(db))
    setReady(true)
    setError(null)
  }, [])

  const saveSerpApiSearchCapture = useCallback(
    async (summary: Omit<SerpCaptureStoredRecord, 'version' | 'savedAt' | 'data'>, data: SerpCaptureDownloadPayload) => {
      const db = await getFlightDb()
      saveSerpApiCapture(db, summary, data)
      schedulePersist(db)
    },
    [],
  )

  const getSerpCaptureRows = useCallback(async (): Promise<SerpCaptureListRow[]> => {
    const db = await getFlightDb()
    return listSerpCaptures(db, 30)
  }, [])

  const getSerpCaptureStoredRecord = useCallback(async (id: number): Promise<SerpCaptureStoredRecord | null> => {
    const db = await getFlightDb()
    return loadSerpCaptureRecord(db, id)
  }, [])

  const removeSerpCapture = useCallback(async (id: number) => {
    const db = await getFlightDb()
    deleteSerpCapture(db, id)
    schedulePersist(db)
  }, [])

  return {
    ready,
    error,
    regionCountries,
    airlineUiRegions,
    airportUiRegions,
    replaceAirlineMappings,
    replaceAirportMappings,
    updateRegionText,
    resetRegions,
    cacheTtlHours,
    updateCacheTtl,
    persistSearch,
    loadCached,
    resetEntireDb,
    saveSerpApiSearchCapture,
    getSerpCaptureRows,
    getSerpCaptureStoredRecord,
    removeSerpCapture,
    searchHistory,
    refreshSearchHistory,
    recordSearchHistory,
    forgetSearchHistory,
    savedResults,
    saveSavedResult,
    removeSavedResult,
    savedSearches,
    refreshSavedSearches,
    addSavedSearch,
    removeSavedSearch,
    loadDefaultSavedSearchPayload,
    saveDefaultSavedSearch,
  }
}
