import React from 'react';
import ReactDOM from 'react-dom/client';
import { WorkspaceGate } from './WorkspaceGate';
import { ThemeProvider } from './Theme';
import { ConfirmationProvider } from './Confirmation';
import './theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ConfirmationProvider><WorkspaceGate /></ConfirmationProvider>
    </ThemeProvider>
  </React.StrictMode>
);
