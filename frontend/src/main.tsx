import React from 'react';
import ReactDOM from 'react-dom/client';
import { WorkspaceGate } from './WorkspaceGate';
import { ThemeProvider } from './Theme';
import './theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider><WorkspaceGate /></ThemeProvider></React.StrictMode>);
