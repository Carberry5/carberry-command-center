import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { isConfigured, supabase } from './cloudSync.ts'

/**
 * The household login. One account for the whole family — the parents sign in
 * with an email magic link, and per-kid PINs switch profiles inside the app.
 *
 * The PIN is a guardrail, not a boundary: once anyone is signed in, the device
 * holds credentials that can write anything in the household. Anything that
 * must genuinely be parent-only belongs in a Function that checks the session
 * server-side.
 */

export type AuthPhase =
  /** Still working out whether there's a stored session. */
  | 'loading'
  /** No Supabase credentials in this build — the app runs on local storage. */
  | 'unconfigured'
  | 'signed-out'
  | 'signed-in'
  /** Signed out on purpose, using this device's own storage. */
  | 'offline'

interface AuthValue {
  phase: AuthPhase
  session: Session | null
  email: string | null
  /** Sends the magic link. Resolves to an error message, or null on success. */
  sendLink: (email: string) => Promise<string | null>
  signOut: () => Promise<void>
  /** Carry on without an account, saving only on this device. */
  continueOffline: () => void
}

const Ctx = createContext<AuthValue | null>(null)

const OFFLINE_KEY = 'carberry.offline.v1'

/**
 * Where the magic link should land: this deployment's own base path. Whatever
 * this resolves to must also be listed under Supabase's Redirect URLs, or the
 * link bounces to the site's default URL instead.
 */
export function redirectUrl(): string {
  const base = (import.meta.env.BASE_URL as string | undefined) ?? '/'
  return new URL(base, window.location.origin).toString()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isConfigured()
  const [session, setSession] = useState<Session | null>(null)
  const [phase, setPhase] = useState<AuthPhase>(configured ? 'loading' : 'unconfigured')

  useEffect(() => {
    if (!configured) return
    let cancelled = false
    const sb = supabase()

    void sb.auth.getSession().then(({ data }) => {
      if (cancelled) return
      if (data.session) {
        setSession(data.session)
        setPhase('signed-in')
      } else {
        // Remember a deliberate "just this device" choice across reloads, so a
        // kitchen iPad doesn't ask again every morning.
        setPhase(localStorage.getItem(OFFLINE_KEY) === '1' ? 'offline' : 'signed-out')
      }
    })

    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return
      setSession(next)
      if (next) {
        localStorage.removeItem(OFFLINE_KEY)
        setPhase('signed-in')
      } else {
        setPhase(localStorage.getItem(OFFLINE_KEY) === '1' ? 'offline' : 'signed-out')
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [configured])

  const sendLink = useCallback(async (email: string): Promise<string | null> => {
    try {
      const { error } = await supabase().auth.signInWithOtp({
        email: email.trim(),
        // Not window.location.origin: a GitHub Pages project site lives at
        // /<repo>/, and returning to the bare origin would land on a 404 with
        // the session fragment attached — the link would appear to do nothing.
        options: { emailRedirectTo: redirectUrl() },
      })
      return error ? error.message : null
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not reach Supabase'
    }
  }, [])

  const signOut = useCallback(async () => {
    localStorage.removeItem(OFFLINE_KEY)
    if (isConfigured()) await supabase().auth.signOut()
    setSession(null)
    setPhase('signed-out')
  }, [])

  const continueOffline = useCallback(() => {
    localStorage.setItem(OFFLINE_KEY, '1')
    setPhase('offline')
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      phase,
      session,
      email: session?.user?.email ?? null,
      sendLink,
      signOut,
      continueOffline,
    }),
    [phase, session, sendLink, signOut, continueOffline]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
