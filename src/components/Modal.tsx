import type { CSSProperties, ReactNode } from 'react'
import { HEADING } from '../lib/theme.ts'

/** The shared dialog shell: scrim, centred panel, click-outside to dismiss. */
export function Modal({
  onClose,
  width = 460,
  title,
  children,
  panelStyle,
  zIndex = 90,
}: {
  onClose: () => void
  width?: number
  title?: string
  children: ReactNode
  panelStyle?: CSSProperties
  zIndex?: number
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20,25,43,.45)',
        zIndex,
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
          borderRadius: 24,
          padding: 24,
          width,
          maxWidth: '100%',
          maxHeight: '92vh',
          overflow: 'auto',
          animation: 'fadeUp .25s ease both',
          boxShadow: '0 30px 70px -30px rgba(20,25,43,.6)',
          ...panelStyle,
        }}
      >
        {title ? <h2 style={{ ...HEADING, fontSize: '1.3em', margin: '0 0 14px' }}>{title}</h2> : null}
        {children}
      </div>
    </div>
  )
}
