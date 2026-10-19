import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { sharedMessage } from '@mataprm/shared'
import './style.css'

function App() {
  return <main>{sharedMessage()}</main>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
