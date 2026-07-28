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
import { seed } from '../data/seed.ts'
import { today } from '../lib/dates.ts'
import { fetchHistory, type HistoryFact } from '../lib/onThisDay.ts'
import { fetchWeather, type Weather } from '../lib/weather.ts'
import * as sync from './sync.ts'

/**
 * One store for the whole app, mirroring the single stateful component the
 * design was prototyped as: family data, navigation, the parent lock, ambient
 * data (weather / history) and per-device display preferences.
 */

export interface DisplayPrefs {
  /** Bigger type for the living-room TV. */
  tvMode: boolean
  showWeather: boolean
  weekStartMonday: boolean
}

const PREFS_KEY = 'carberry.prefs.v1'

function loadPrefs(): DisplayPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) return { tvMode: false, showWeather: true, weekStartMonday: false, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { tvMode: false, showWeather: true, weekStartMonday: false }
}

interface PinPrompt {
  msg: string
  cb: () => void
}

interface StoreValue {
  data: FamilyData
  mode: sync.SyncMode
  vaultPath: string | null
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
  const [data, setData] = useState<FamilyData>(() => sync.loadLocal())
  const [mode, setMode] = useState<sync.SyncMode>('connecting')
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [parentUntil, setParentUntil] = useState(0)
  const [pinPrompt, setPinPrompt] = useState<PinPrompt | null>(null)
  const [pinEntry, setPinEntry] = useState('')
  const [pinShake, setPinShake] = useState(0)
  const [page, setPage] = useState<PageId>('today')
  const [memberSel, setMemberSel] = useState<string | null>(null)
  const [wx, setWx] = useState<Weather | null>(null)
  const [history, setHistory] = useState<HistoryFact[] | null>(null)
  const [prefs, setPrefsState] = useState<DisplayPrefs>(loadPrefs)
  const [now, setNow] = useState(() => Date.now())
  const [width, setWidth] = useState(() => window.innerWidth)

  const dataRef = useRef(data)
  const modeRef = useRef(mode)
  const revRef = useRef(0)
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
    if (modeRef.current !== 'vault') {
      sync.saveLocal(dataRef.current)
      return
    }
    const seq = editSeq.current
    pushing.current = true
    const result = await sync.pushState(revRef.current, dataRef.current)
    pushing.current = false

    if (result.status === 'offline') {
      setMode('local')
      modeRef.current = 'local'
      sync.saveLocal(dataRef.current)
      toast('Vault sidecar unreachable — saving on this device for now')
      return
    }
    revRef.current = result.envelope.rev
    if (result.status === 'conflict') {
      applyData(result.envelope.data)
      editSeq.current += 1
      toast('The vault changed elsewhere — reloaded the newer version')
      return
    }
    // Only take the server's normalised copy if nothing was typed meanwhile.
    if (seq === editSeq.current) applyData(result.envelope.data)
  }, [applyData, toast])

  const schedulePush = useCallback(() => {
    if (pushTimer.current) window.clearTimeout(pushTimer.current)
    pushTimer.current = window.setTimeout(() => {
      pushTimer.current = null
      void flush()
    }, 250)
  }, [flush])

  const update = useCallback(
    (fn: (draft: FamilyData) => void) => {
      const next = structuredClone(dataRef.current)
      fn(next)
      editSeq.current += 1
      applyData(next)
      if (modeRef.current === 'vault') schedulePush()
      else sync.saveLocal(next)
    },
    [applyData, schedulePush]
  )

  const resetDemoData = useCallback(() => {
    const fresh = migrate(seed())
    editSeq.current += 1
    applyData(fresh)
    if (modeRef.current === 'vault') schedulePush()
    else sync.saveLocal(fresh)
    toast('Demo data reset')
  }, [applyData, schedulePush, toast])

  // --- connect to the sidecar ---------------------------------------------

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    void (async () => {
      const h = await sync.health()
      if (cancelled) return
      if (!h) {
        setMode('local')
        modeRef.current = 'local'
        return
      }
      setVaultPath(h.vault)
      const envelope = await sync.fetchState()
      if (cancelled) return
      if (!envelope) {
        setMode('local')
        modeRef.current = 'local'
        return
      }
      revRef.current = envelope.rev
      applyData(migrate(envelope.data))
      setMode('vault')
      modeRef.current = 'vault'

      unsubscribe = sync.subscribe(
        (env) => {
          // Ignore our own echo and anything older than what we already have.
          if (pushing.current || pushTimer.current) return
          if (env.rev === revRef.current) return
          revRef.current = env.rev
          applyData(migrate(env.data))
        },
        () => {
          /* EventSource retries on its own; nothing to do here */
        }
      )
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [applyData])

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
      vaultPath,
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
      data, mode, vaultPath, update, resetDemoData, toast, toastMsg, parentUnlocked, requirePin,
      toggleParentLock, pinPrompt, pinEntry, pinShake, pressPin, page, memberSel, go, openMember,
      wx, reloadWeather, history, prefs, setPrefs, now, width,
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
