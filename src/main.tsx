import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './remoteLog'

// Diagnosis on a screen: `?slot=N&gltest=1` measures plain WebGL instead of showing a head.
if (new URLSearchParams(window.location.search).has('gltest')) window.location.replace(`/gltest.html${window.location.search}`)
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
