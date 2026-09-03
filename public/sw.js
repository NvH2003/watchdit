self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Do not intercept fetches. A catch-all fetch handler can stall Instant
// (EventSource / WebSocket handshake) and leave the app on "Connecting…".
