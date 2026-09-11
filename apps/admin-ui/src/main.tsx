import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { LocaleGate } from './components/LocaleGate';
import App from './App';
import AppBridge from './components/AppBridge';
import './i18n';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');
ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <LocaleGate>
        <AppBridge />
        <App />
      </LocaleGate>
    </BrowserRouter>
  </React.StrictMode>,
);
