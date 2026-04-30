import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './styles.css'
import './index.css'
import App from './App.tsx'
import { configureAmplify, getConfig } from './config/amplify'
import { consumeSessionFragment } from './auth/sessionTransfer'

// Configure AWS Amplify
configureAmplify()

// If redirected from the foundation login with tokens in the URL fragment,
// write them into Amplify's localStorage before the React tree mounts.
// This only fires for cross-origin redirects (dev/staging); in production
// both apps share a domain so localStorage is already shared.
const amplifyConfig = getConfig()
consumeSessionFragment(amplifyConfig.userPoolClientId)

// Create TanStack Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // Data is fresh for 1 minute
      retry: 2, // Retry failed requests twice
      refetchOnWindowFocus: false, // Don't refetch on window focus for Phase 0
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
