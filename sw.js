// Versienummer van de cache. Wijzig dit nummer (bv. v2) als je de HTML-code update!
const CACHE_NAME = 'biolights-cache-v11';

// De lijst met bestanden die ALTIJD offline beschikbaar moeten zijn
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/pwm_controller.uf2',
  '/llms.txt',
  '/schema/profile-v1.json',
  '/biolights_default_config.json',
  '/js/interpolation.js',
  '/js/sensor-protocol.js',
  '/js/sensor-mock.js',
  '/js/wavelength-color.js',
  '/js/spectrum-curve.js',
  '/js/profile-loader.js',
  '/mock-sensor-scenario.json',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// 1. INSTALLATIE: Sla alle bestanden op in de browser-cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Forceer het downloaden van de CDN scripts en lokale HTML
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      // Zorg dat de Service Worker direct actief wordt zonder te wachten
      return self.skipWaiting();
    })
  );
});

// 2. ACTIVATIE: Gooi oude caches weg als het versienummer is gewijzigd
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            // Oude cache gedetecteerd -> verwijderen
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      // Neem direct de controle over alle tabbladen
      return self.clients.claim();
    })
  );
});

// 3. NETWERK INTERCEPTIE: Serveer bestanden uit de cache als je offline bent
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Als het bestand in de cache staat, geef die direct terug (supersnel + offline)
      if (cachedResponse) {
        return cachedResponse;
      }
      // Anders: haal het alsnog op van internet (indien online)
      return fetch(event.request);
    })
  );
});