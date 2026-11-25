import '@fontsource-variable/bricolage-grotesque/wdth.css';
import '@fontsource-variable/dm-sans';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { watchNativeBars } from './lib/native';
import { getThemePref, watchSystemTheme, applyTheme } from './lib/theme';
import './styles/tokens.css';
import './styles/app.css';

applyTheme(getThemePref());
watchSystemTheme();
watchNativeBars();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
