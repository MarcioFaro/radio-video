self.addEventListener('install', (e) => {
  console.log('[Service Worker] Install');
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  console.log('[Service Worker] Activate');
});

self.addEventListener('fetch', (e) => {
  // Apenas deixa passar, sem cache por enquanto para simplificar o spike
});
