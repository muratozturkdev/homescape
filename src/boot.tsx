import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './index.css'
import App from './App.tsx'

// Developer labs (src/dev): #characters shows only the people (HumanLab), #pets the cat, dog, visitors and their props
// (PetLab), #sounds every sound (SoundLab)
const petLab = location.hash.startsWith('#pets')
const soundLab = location.hash.startsWith('#sounds')
const Lab = lazy(() => (soundLab ? import('./dev/SoundLab') : petLab ? import('./dev/PetLab') : import('./dev/HumanLab')))
const lab = location.hash.startsWith('#characters') || petLab || soundLab

// Development: writes the active plan to a local file for debugging (src/dev/planDump.ts)
if (import.meta.env.DEV && !lab) void import('./dev/planDump')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {lab ? (
      <Suspense>
        <Lab />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
