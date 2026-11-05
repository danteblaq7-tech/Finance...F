import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './features/auth/AuthProvider';
import { queryClient } from './lib/queryClient';
import { initTheme } from './lib/theme';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SetupNeeded } from './components/SetupNeeded';
import { supabaseConfigured } from './lib/supabase';
import './index.css';

// Saved choice, else the operating system's setting (index.html applies it before first paint to avoid a flash).
initTheme();

createRoot(document.getElementById('root')!).render(
  !supabaseConfigured ? (
    <SetupNeeded />
  ) : (
    <StrictMode>
      <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>
  ),
);
