import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { configureAmplify } from './config/amplify'

// Configure AWS Amplify
configureAmplify()

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
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
