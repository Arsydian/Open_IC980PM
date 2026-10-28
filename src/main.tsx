/**
 * @file src/main.tsx
 * @description React 18 application entrypoint for Open_IC980PM.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary
      title="Open_IC980PM hit an unexpected error"
      hint="Reload the app to continue. Changes that were not saved to a file are lost."
    >
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
