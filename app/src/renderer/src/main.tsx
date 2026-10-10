import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { connectStore, watchHealth } from './store'
import './theme/theme.css'
import './theme/global.css'

connectStore()
watchHealth()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
