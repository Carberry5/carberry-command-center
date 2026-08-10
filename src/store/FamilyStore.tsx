import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { FamilyData, PageId } from '../types.ts'
import { migrate } from '../data/migrate.ts'
import { deepClone } from '../lib/clone.ts'
import { seed } from '../data/seed.ts'
import { today } from '../lib/dates.ts'
import { fetchHistory, type HistoryFact } from '../lib/onThisDay.ts'
import { fetchWeather, type Weather } from '../lib/weather.ts'
import * as cloud from './cloudSync.ts'
import * as sync from './sync.ts'
import { useAuth } from './auth.tsx'

/**
 * One store for the whole app, mirroring the single stateful component the
 * design was prototyped as: family data, navigation, the parent lock, ambient
 * data (weather / history) and per-device display preferences.
 *
 * Storage is Supabase. The store keeps the last snapshot it knows the database
 * holds, and every edit is diffed against that — so the `update(draft => …)`
 * call sites throughout the app are unchanged from the vault era, while the
 * traffic is proportional to the edit rather than to the whole document.
 */

export interface DisplayPrefs {
  /** Bigger type for the living-room TV. */
  tvMode: boolean
  showWeather: boolean
  weekStartMonday: boolean
  /**
   * Wall-display mode: no navigation, no controls, one screenful that never
   * scrolls. Meant for an Echo Show or a spare tablet propped in the kitchen,
   * where nobody is going to scroll and nothing should need tapping.
   */
  display: boolean
}

const PREFS_KEY = 'carberry.prefs.v1'

const DEFAULT_PREFS: DisplayPrefs = {
  tvMode: false,
  showWeather: true,
  weekStartMonday: false,
  display: false,
}

/**
 * `?display` / `?display=0` in the URL wins over the stored preference, so an
 * Echo Show can be pointed at one bookmark and get the wall layout without
 * anyone having to find Settings on a 5-inch screen. It is written back to
 * localStorage, which means the query string only has to be right once.
 */
function displayFromUrl(): boolean | null {
  try {
    const v = new URLSearchParams(window.location.search).get('display')
    if (v === null) return null
    return v !== '0' && v !== 'false'
  } catch {
    return null
  }
}

function loadPrefs(): DisplayPrefs {
  let prefs = DEFAULT_PREFS
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) prefs = { ...DEFAULT_PREFS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  const fromUrl = displayFromUrl()
  return fromUrl === null ? prefs : { ...prefs, display: fromUrl }
}

interface PinPrompt {
  msg: string
  cb: () => void
}

export type SyncMode = 'connecting' | 'cloud' | 'local'

interface StoreValue {
  data: FamilyData
  mode: SyncMode
  /** The household this device is reading and writing, when signed in. */
  householdId: string | null
  /**
   * Whether a server is answering /api — the sidecar in development, the
   * Cloudflare Functions in production. ICS syncing and 1Password reveals need
   * one; the rest of the app does not.
   */
  serverOk: boolean
  /** Mutate a structural copy of the data; persists and syncs automatically. */
  update: (fn: (draft: FamilyData) => void) => void
  resetDemoData: () => void

  toast: (message: string) => void
  toastMsg: string | null

  parentUnlocked: boolean
  requirePin: (cb: () => void, msg?: string) => void
  toggleParentLock: () => void
  pinPrompt: PinPrompt | null
  pinEntry: string
  pinShake: number
  pressPin: (digit: string) => void
  backspacePin: () => void
  cancelPin: () => void

  page: PageId
  memberSel: string | null
  go: (page: PageId) => void
  openMember: (id: string) => void

  wx: Weather | null
  reloadWeather: () => void
  history: HistoryFact[] | null

  prefs: DisplayPrefs
  setPrefs: (patch: Partial<DisplayPrefs>) => void

  /** Ticks every 30s so clocks and the departure countdown stay live. */
  now: number
  width: number
}

const Ctx = createContext<StoreValue | null>(null)

export function FamilyStoreProvider({ children }: { children: ReactNode }) {
  const { phase } = useAuth()

  const [data, setData] = useState<FamilyData>(() => sync.loadLocal())
  const [mode, setMode] = useState<SyncMode>('connecting')
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [serverOk, setServerOk] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [parentUntil, setParentUntil] = useState(0)
  const [pinPrompt, setPinPrompt] = useState<PinPrompt | null>(null)
  const [pinEntry, setPinEntry] = useState('')
  const [pinShake, setPinShake] = useState(0)
  // The calendar is the front door. Elizabeth's feedback, and she is the
  // household's scheduler: the calendar is the primary interface, everything
  // else is supporting material. Today remains one tap away on the rail.
  const [page, setPage] = useState<PageId>('calendar')
  const [memberSel, setMemberSel] = useState<string | null>(null)
  const [wx, setWx] = useState<Weather | null>(null)
  const [history, setHistory] = useState<HistoryFact[] | null>(null)
  const [prefs, setPrefsState] = useState<DisplayPrefs>(loadPrefs)
  const [now, setNow] = useState(() => Date.now())
  const [width, setWidth] = useState(() => window.innerWidth)

  const dataRef = useRef(data)
  const modeRef = useRef(mode)
  const hhRef = useRef<string | null>(null)
  /** The last snapshot we know the database holds. Every diff is against this. */
  const syncedRef = useRef<FamilyData | null>(null)
  const editSeq = useRef(0)
  const pushTimer = useRef<number | null>(null)
  const pushing = useRef(false)

  const toast = useCallback((message: string) => {
    setToastMsg(message)
    window.setTimeout(() => setToastMsg((cur) => (cur === message ? null : cur)), 2800)
  }, [])

  const applyData = useCallback((next: FamilyData) => {
    dataRef.current = next
    setData(next)
  }, [])

  // --- persistence ---------------------------------------------------------

  const flush = useCallback(async () => {
    if (modeRef.current !== 'cloud' || !hhRef.current || !syncedRef.current) {
      sync.saveLocal(dataRef.current)
      return
    }
    // Capture what we're about to push: anything typed while the request is in
    // flight will diff against this snapshot on the next pass rather than being
    // lost or sent twice.
    const pushed = dataRef.current
    pushing.current = true
    try {
      await cloud.pushChanges(syncedRef.current, pushed, hhRef.current)
      syncedRef.current = pushed
    } catch {
      // Leave syncedRef alone so the same delta is retried on the next edit,
      // and keep a copy on the device meanwhile. Staying in cloud mode matters:
      // dropping to local on one failed request would strand the family on a
      // stale device copy for a blip.
      sync.saveLocal(pushed)
      toast('Could not save to the cloud just now — will retry')
    } finally {
      pushing.current = false
    }
  }, [toast])

  const schedulePush = useCallback(() => {
    if (pushTimer.current) window.clearTimeout(pushTimer.current)
    pushTimer.current = window.setTimeout(() => {
      pushTimer.current = null
      void flush()
    }, 250)
  }, [flush])

  const update = useCallback(
    (fn: (draft: FamilyData) => void) => {
      const next = deepClone(dataRef.current)
      fn(next)
      editSeq.current += 1
      applyData(next)
      if (modeRef.current === 'cloud') schedulePush()
      else sync.saveLocal(next)
    },
    [applyData, schedulePush]
  )

  const resetDemoData = useCallback(() => {
    const fresh = migrate(seed())
    editSeq.current += 1
    applyData(fresh)
    if (modeRef.current === 'cloud') schedulePush()
    else sync.saveLocal(fresh)
    toast('Demo data reset')
  }, [applyData, schedulePush, toast])

  /** Re-reads everything. Cheap enough at family scale to beat patching in place. */
  const refresh = useCallback(async () => {
    const hh = hhRef.current
    if (!hh) return
    // Our own writes echo back. Skip while anything local is in flight or
    // pending — the push we're mid-way through is newer than what we'd read.
    if (pushing.current || pushTimer.current) return
    try {
      const fresh = await cloud.loadSnapshot(hh, dataRef.current)
      if (pushing.current || pushTimer.current) return
      syncedRef.current = fresh
      applyData(fresh)
    } catch {
      /* a dropped read is not worth interrupting anyone over */
    }
  }, [applyData])

  // --- connect -------------------------------------------------------------

  useEffect(() => {
    if (phase === 'loading') return

    if (phase !== 'signed-in') {
      // Unconfigured build, or a deliberate "this device only" — localStorage.
      modeRef.current = 'local'
      setMode('local')
      applyData(sync.loadLocal())
      return
    }

    let cancelled = false
    let unsubscribe: (() => void) | undefined

    void (async () => {
      try {
        const hh = await cloud.currentHouseholdId()
        if (cancelled) return

        if (!hh) {
          modeRef.current = 'local'
          setMode('local')
          toast('This account is not linked to a household yet')
          return
        }

        hhRef.current = hh
        setHouseholdId(hh)

        // Deliberately not run through migrate(): that exists to repair old
        // localStorage shapes, and on an empty household it would substitute
        // the demo seed and then push it. An empty household should look empty.
        const snapshot = await cloud.loadSnapshot(hh, dataRef.current)
        if (cancelled) return

        syncedRef.current = snapshot
        applyData(snapshot)
        modeRef.current = 'cloud'
        setMode('cloud')

        unsubscribe = cloud.subscribe(hh, () => void refresh())
      } catch (err) {
        if (cancelled) return
        modeRef.current = 'local'
        setMode('local')
        toast(err instanceof Error ? err.message : 'Could not reach the family data')
      }
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [phase, applyData, refresh, toast])

  // Is anything answering /api? The sidecar in dev, Functions in production.
  useEffect(() => {
    void sync.health().then((h) => setServerOk(!!h))
  }, [])

  // Never lose the last edit when the tab goes away.
  useEffect(() => {
    const onHide = () => {
      if (pushTimer.current) {
        window.clearTimeout(pushTimer.current)
        pushTimer.current = null
        void flush()
      }
      sync.saveLocal(dataRef.current)
    }
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [flush])

  // --- ambient -------------------------------------------------------------

  const reloadWeather = useCallback(() => {
    const { lat, lon } = dataRef.current.settings
    void fetchWeather(lat, lon).then((w) => w && setWx(w))
  }, [])

  useEffect(() => {
    reloadWeather()
  }, [reloadWeather, data.settings.lat, data.settings.lon])

  const historyDay = useRef<string | null>(null)
  useEffect(() => {
    const td = today()
    if (historyDay.current === td) return
    historyDay.current = td
    void fetchHistory().then(setHistory)
  }, [now])

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30000)
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => {
      window.clearInterval(tick)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // --- parent lock ---------------------------------------------------------

  const parentUnlocked = now < parentUntil || Date.now() < parentUntil

  const requirePin = useCallback(
    (cb: () => void, msg = 'Parent PIN') => {
      if (Date.now() < parentUntil) {
        cb()
        return
      }
      setPinEntry('')
      setPinPrompt({ cb, msg })
    },
    [parentUntil]
  )

  const pressPin = useCallback(
    (digit: string) => {
      const entry = pinEntry + digit
      if (entry.length > 4) return
      if (entry.length < 4) {
        setPinEntry(entry)
        return
      }
      if (entry === dataRef.current.settings.pin) {
        const cb = pinPrompt?.cb
        setPinPrompt(null)
        setPinEntry('')
        setParentUntil(Date.now() + 5 * 60000)
        toast('Parent mode unlocked for 5 minutes')
        cb?.()
      } else {
        setPinEntry('')
        setPinShake((n) => n + 1)
      }
    },
    [pinEntry, pinPrompt, toast]
  )

  const toggleParentLock = useCallback(() => {
    if (Date.now() < parentUntil) {
      setParentUntil(0)
      toast('Parent mode locked')
    } else {
      requirePin(() => {})
    }
  }, [parentUntil, requirePin, toast])

  // --- navigation ----------------------------------------------------------

  const go = useCallback(
    (next: PageId) => {
      if (next === 'settings') {
        requirePin(() => setPage('settings'), 'Settings are parent-only')
        return
      }
      setPage(next)
    },
    [requirePin]
  )

  const openMember = useCallback((id: string) => {
    setMemberSel(id)
    setPage('member')
  }, [])

  const setPrefs = useCallback((patch: Partial<DisplayPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const value = useMemo<StoreValue>(
    () => ({
      data,
      mode,
      householdId,
      serverOk,
      update,
      resetDemoData,
      toast,
      toastMsg,
      parentUnlocked,
      requirePin,
      toggleParentLock,
      pinPrompt,
      pinEntry,
      pinShake,
      pressPin,
      backspacePin: () => setPinEntry((e) => e.slice(0, -1)),
      cancelPin: () => {
        setPinPrompt(null)
        setPinEntry('')
      },
      page,
      memberSel,
      go,
      openMember,
      wx: prefs.showWeather ? wx : null,
      reloadWeather,
      history,
      prefs,
      setPrefs,
      now,
      width,
    }),
    [
      data, mode, householdId, serverOk, update, resetDemoData, toast, toastMsg, parentUnlocked,
      requirePin, toggleParentLock, pinPrompt, pinEntry, pinShake, pressPin, page, memberSel, go,
      openMember, wx, reloadWeather, history, prefs, setPrefs, now, width,
    ]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useFamily(): StoreValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useFamily must be used inside <FamilyStoreProvider>')
  return ctx
}

/** Breakpoints and the root font size the whole layout scales from. */
export function useLayout() {
  const { width, prefs } = useFamily()
  const narrow = width < 760
  const mid = width >= 760 && width < 1180
  const rootFontSize = narrow ? 15 : prefs.tvMode ? 21 : width >= 1560 ? 18 : 16
  return { narrow, mid, wide: !narrow && !mid, rootFontSize }
}
