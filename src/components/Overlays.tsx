import { CREAM, HEADING, INK, PURPLE, line } from '../lib/theme.ts'
import { abortVoice } from '../lib/voice.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { useModals } from '../store/ModalStore.tsx'
import { MicIcon } from './Icon.tsx'

/** The parent PIN pad. Shakes on a wrong code, unlocks for five minutes. */
export function PinPad() {
  const { pinPrompt, pinEntry, pinShake, pressPin, backspacePin, cancelPin } = useFamily()
  if (!pinPrompt) return null

  const key = {
    height: 60,
    borderRadius: 18,
    border: `1px solid ${line(0.13)}`,
    background: '#F7F9FF',
    fontFamily: "'Outfit', sans-serif",
    fontWeight: 600,
    fontSize: '1.4em',
    cursor: 'pointer',
    color: INK,
  } as const

  return (
    <div
      onClick={cancelPin}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,25,43,.55)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FFFFFF',
          borderRadius: 26,
          padding: 28,
          width: 330,
          maxWidth: '100%',
          boxShadow: '0 30px 70px -30px rgba(20,25,43,.6)',
          animation: `${pinShake % 2 ? 'shakeA' : 'shakeB'} .4s ease, fadeUp .25s ease`,
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: '50%',
            background: 'rgba(35,42,61,.07)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 10px',
          }}
        >
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="11" width="12" height="9" rx="2.2" />
            <path d="M9 11V8a3 3 0 0 1 6 0v3" />
          </svg>
        </div>

        <div style={{ ...HEADING, fontSize: '1.15em', textAlign: 'center' }}>{pinPrompt.msg}</div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', margin: '16px 0 18px' }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                transition: 'all .15s',
                background: pinEntry.length > i ? INK : line(0.15),
              }}
            />
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,72px)', gap: 9, justifyContent: 'center' }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button key={n} onClick={() => pressPin(String(n))} className="key-hover" style={key}>
              {n}
            </button>
          ))}
          <div />
          <button onClick={() => pressPin('0')} className="key-hover" style={key}>
            0
          </button>
          <button onClick={backspacePin} style={{ ...key, fontWeight: 700, fontSize: '1em' }}>
            ⌫
          </button>
        </div>

        <div style={{ textAlign: 'center', color: line(0.45), fontWeight: 600, fontSize: '.78em', marginTop: 14 }}>
          Set your own PIN in Settings
        </div>
      </div>
    </div>
  )
}

/** Voice command overlay — listening state, transcript, and Claude's spoken reply. */
export function VoiceOverlay() {
  const { voice, setVoice } = useModals()
  if (!voice) return null

  const close = () => {
    abortVoice()
    setVoice(null)
  }

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,25,43,.55)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FFFFFF',
          borderRadius: 26,
          padding: 30,
          width: 430,
          maxWidth: '100%',
          textAlign: 'center',
          animation: 'fadeUp .25s ease both',
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: PURPLE,
            ...(voice.status === 'Listening…' ? { animation: 'pulseRing 1.6s ease-out infinite' } : {}),
          }}
        >
          <MicIcon size={30} color={CREAM} />
        </div>

        <div style={{ ...HEADING, fontSize: '1.2em', marginTop: 14 }}>{voice.status}</div>
        <div style={{ fontWeight: 600, color: line(0.6), marginTop: 8, minHeight: 24, fontSize: '.95em' }}>
          {voice.text ? `“${voice.text.replace(/^“|”$/g, '')}”` : ''}
        </div>

        {voice.reply ? (
          <div
            style={{
              background: 'rgba(124,92,224,.12)',
              borderRadius: 16,
              padding: '12px 16px',
              fontWeight: 700,
              marginTop: 12,
              color: INK,
            }}
          >
            {voice.reply}
          </div>
        ) : null}

        <div style={{ color: line(0.45), fontWeight: 600, fontSize: '.78em', marginTop: 14 }}>
          Try: “Add milk to the grocery list” · “Cannon did brush teeth” · “What's for dinner?”
        </div>

        <button
          onClick={close}
          style={{
            marginTop: 14,
            border: `1px solid ${line(0.16)}`,
            background: 'none',
            borderRadius: 999,
            padding: '11px 22px',
            fontWeight: 700,
            cursor: 'pointer',
            color: INK,
          }}
        >
          Close
        </button>
      </div>
    </div>
  )
}

export function Toast() {
  const { toastMsg } = useFamily()
  if (!toastMsg) return null
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 26,
        transform: 'translateX(-50%)',
        background: INK,
        color: CREAM,
        borderRadius: 999,
        padding: '13px 24px',
        fontWeight: 700,
        fontSize: '.95em',
        zIndex: 120,
        boxShadow: '0 16px 40px -14px rgba(20,25,43,.6)',
        animation: 'fadeUp .25s ease both',
        maxWidth: '88vw',
      }}
    >
      {toastMsg}
    </div>
  )
}
