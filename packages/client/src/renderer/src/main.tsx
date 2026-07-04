import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { App } from './App'
import { ErrorBoundary } from './components/error-boundary'
import './index.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Renderer root element not found')
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <Toaster
        position="top-right"
        richColors
        toastOptions={{
          classNames: {
            toast: 'border-border bg-card text-foreground shadow-lg',
            title: 'text-foreground',
            description: 'text-muted-foreground',
            actionButton: 'bg-primary text-primary-foreground',
            cancelButton: 'bg-muted text-muted-foreground',
          },
        }}
      />
    </ErrorBoundary>
  </StrictMode>,
)
