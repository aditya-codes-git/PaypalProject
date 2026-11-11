import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { Landing } from './Landing';
import { ThemeProvider } from './Theme';
import { ConfirmationProvider } from './Confirmation';
import './theme.css';

const WorkspaceGate = lazy(() => import('./WorkspaceGate').then(module => ({ default: module.WorkspaceGate })));
const url = new URL(window.location.href);
const callback = new URLSearchParams(url.hash.slice(1));
const openWorkspace = url.searchParams.has('workspace')
  || ['code', 'error', 'payment'].some(key => url.searchParams.has(key))
  || ['error', 'access_token'].some(key => callback.has(key));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      {openWorkspace ? <ConfirmationProvider>
        <Suspense fallback={<div className="auth-shell"><p role="status">Opening your workspace…</p></div>}>
          <WorkspaceGate />
        </Suspense>
      </ConfirmationProvider> : <Landing />}
    </ThemeProvider>
  </React.StrictMode>
);
