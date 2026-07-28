import { useState } from 'react'
import { BG, HEADING, INK, card, input, line, linkBtn, primaryBtn } from '../lib/theme.ts'
import { useAuth } from '../store/auth.tsx'

/**
 * The whole family shares one login, so this is a parent-only screen — it's
 * shown once per device and then effectively never again.
 */
export function SignIn() {
  const { sendLink, continueOffline } = useAuth()
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.includes('@')) {
      setError('That does not look like an email address')
      return
    }
    setState('sending')
    setError(null)
    const err = await sendLink(email)
    if (err) {
      setError(err)
      setState('idle')
      return
    }
    setState('sent')
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: BG,
        color: INK,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      <div style={{ ...card, padding: '30px 28px', width: '100%', maxWidth: 420 }}>
        <h1 style={{ ...HEADING, fontSize: '1.5em', margin: '0 0 4px' }}>Carberry Command Center</h1>

        {state === 'sent' ? (
          <>
            <p style={{ fontWeight: 600, fontSize: '.92em', color: line(0.7), lineHeight: 1.5 }}>
              Check <strong style={{ color: INK }}>{email}</strong> for a sign-in link. Open it on
              this device — the link signs in whichever browser opens it.
            </p>
            <button type="button" style={linkBtn} onClick={() => setState('idle')}>
              Use a different address
            </button>
          </>
        ) : (
          <>
            <p style={{ fontWeight: 600, fontSize: '.92em', color: line(0.7), lineHeight: 1.5 }}>
              Sign in once on this device and it stays signed in. Everyone in the house shares the
              one account; kids pick their profile with a PIN.
            </p>

            <form onSubmit={submit} style={{ display: 'grid', gap: 12, marginTop: 18 }}>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ ...input, width: '100%' }}
                aria-label="Email address"
              />
              <button type="submit" style={primaryBtn} disabled={state === 'sending'}>
                {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
              </button>
            </form>
          </>
        )}

        {error && (
          <p style={{ color: '#B23B22', fontWeight: 700, fontSize: '.85em', marginTop: 12 }}>
            {error}
          </p>
        )}

        <div style={{ borderTop: `1px solid ${line(0.1)}`, marginTop: 20, paddingTop: 14 }}>
          <button type="button" style={linkBtn} onClick={continueOffline}>
            Use this device only
          </button>
          <p style={{ fontSize: '.78em', fontWeight: 600, color: line(0.55), margin: '2px 6px 0' }}>
            Saves to this browser and doesn't sync anywhere. Useful off wifi; sign in later to join
            the family's data.
          </p>
        </div>
      </div>
    </div>
  )
}
