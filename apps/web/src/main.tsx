import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { client } from './api/client';
import { LocaleProvider } from './lib/locale';
import './styles.css';
const queryClient=new QueryClient({defaultOptions:{queries:{retry:1,staleTime:3000}}});
void (async () => {
  try { await client.bootstrapSession(); } catch { /* Unprotected local instances do not need a session. */ }
  createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><LocaleProvider><App/></LocaleProvider></QueryClientProvider></React.StrictMode>);
})();
