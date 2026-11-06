import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import UploadApp from './UploadApp'
import { localizeDocument } from './i18n'

localizeDocument()

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const theme = matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => document.documentElement.classList.toggle('dark', theme.matches)
applyTheme()
theme.addEventListener('change', applyTheme)
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><UploadApp /></QueryClientProvider>)
