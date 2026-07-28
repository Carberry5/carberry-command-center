import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { App } from './App.tsx'
import { FamilyStoreProvider } from './store/FamilyStore.tsx'
import { ModalStoreProvider } from './store/ModalStore.tsx'

const root = document.getElementById('root')
if (!root) throw new Error('No #root element')

createRoot(root).render(
  <StrictMode>
    <FamilyStoreProvider>
      <ModalStoreProvider>
        <App />
      </ModalStoreProvider>
    </FamilyStoreProvider>
  </StrictMode>
)
