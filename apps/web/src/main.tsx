import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AppProviders from './providers/AppProviders'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
)
