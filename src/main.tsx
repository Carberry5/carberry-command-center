import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { App } from './App.tsx'
import { SignIn } from './components/SignIn.tsx'
import { AuthProvider, useAuth } from './store/auth.tsx'
import { FamilyStoreProvider } from './store/FamilyStore.tsx'
import { ModalStoreProvider } from './store/ModalStore.tsx'

/**
 * Auth wraps everything: the store needs to know whether there's a session
 * before it decides between Supabase and this device's own storage.
 */
function Root() {
  const { phase } = useAuth()

  // A brief blank while the stored session is read — showing the sign-in screen
  // first would flash it at an already-signed-in family every morning.
  if (phase === 'loading') return null
  if (phase === 'signed-out') return <SignIn />

  return (
    <FamilyStoreProvider>
      <ModalStoreProvider>
        <App />
      </ModalStoreProvider>
    </FamilyStoreProvider>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('No #root element')

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <Root />
    </AuthProvider>
  </StrictMode>
)
