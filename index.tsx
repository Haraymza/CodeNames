import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  // Removing StrictMode to avoid double-firing PeerJS connections in dev, 
  // though handled in production, it makes testing P2P locally smoother.
  // In a robust app, we'd handle strict mode cleanup meticulously.
  <>
    <App />
  </>
);
