// Service worker : permet d'ouvrir l'appli sans connexion.
// Change VERSION à chaque mise à jour des fichiers pour forcer le rafraîchissement.
const VERSION = 'v7';
const CACHE = `presence-poker-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './cloud.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith('presence-poker-') && k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Réseau d'abord (pour avoir la dernière version), cache si hors ligne
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match('./index.html')))
  );
});
