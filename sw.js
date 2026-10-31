/* FeeFlow service worker.
 *
 * Goal: the app OPENS on a phone with no connection and looks like an app, not an
 * error page. Strategy:
 *   - app shell (HTML, CSS, JS, icons)  -> cache first, network in the background
 *   - Supabase API calls               -> network only (money data must be live)
 *   - navigations                      -> cached shell when offline
 * The cache is versioned so a new deploy takes over on the next load. */
/* Bump this whenever the shell changes. `activate` deletes every cache whose name is not
   this one, so the bump is what evicts files that were removed from SHELL and guarantees
   existing installs pick up new code instead of serving a stale copy. */
const VERSION = 'feeflow-v2';
const SHELL = [
  './',
  './index.html',
  './portal.html',
  './parent.html',
  './schooladmin.html',
  './superadmin.html',
  './fee-structure-manager.html',
  './fee-adjustments.html',
  './legal/privacy.html',
  './legal/terms.html',
  './legal/data-protection.html',
  './preview.html',
  './legal/privacy.html',
  './legal/terms.html',
  './legal/data-protection.html',
  './css/ff.css',
  './js/ff-client.js',
  './js/ff-ui.js',
  './js/fee-manager.js',
  './js/fee-adjustments.js',
  './js/config.js',
  './js/vendor/supabase-2.117.2.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll fails the whole install if one file 404s, so add them one by one
    await Promise.all(SHELL.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) { /* ignore */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

function isApi(url) {
  return url.pathname.startsWith('/rest/v1/') ||
         url.pathname.startsWith('/auth/v1/') ||
         url.pathname.startsWith('/functions/v1/') ||
         url.hostname.endsWith('.supabase.co');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never cache writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // fonts, mpesa callbacks: leave alone
  if (isApi(url)) return;                                 // live money data must never be stale

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(VERSION);
        return (await cache.match(req)) ||
               (await cache.match('./portal.html')) ||
               (await cache.match('./index.html')) ||
               new Response('<h1>FeeFlow is offline</h1><p>Reconnect to load your fees.</p>',
                            { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || network;
  })());
});
