const CACHE = 'mhfzty-v47.17';
// Note: sw.js itself is intentionally NOT precached — the browser fetches and
// byte-compares it directly to drive updates; caching it via the Cache API is a
// no-op at best and can interfere with that update check.
const PRECACHE = [
  './index.html', './style.css', './i18n.js', './app.core.js', './app.ui.js', './app.logic.js',
  // referenced from index.html's <head> (favicon/apple-touch-icon) and footer
  // (privacy/terms) — omitted before, undermining the "works offline from the
  // very first visit" guarantee the install handler below is meant to provide.
  './favicon-32.png', './apple-touch-icon.png', './privacy.html', './terms.html'
];

self.addEventListener('install', e => {
  // Pre-cache core files so the app works offline from the very first visit.
  // No skipWaiting() here — the app shows an in-page update banner and posts
  // SKIP_WAITING when the user approves, giving them control over the timing.
  // addAll() is all-or-nothing — one transient 404/network blip on a single asset
  // would otherwise sink offline support for every other file too. Cache each file
  // independently so a single failure doesn't cost the rest.
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(PRECACHE.map(url => c.add(url).catch(() => {})))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// The app posts this message when the user taps "تحديث الآن"
self.addEventListener('message', e => {
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if(url.origin !== self.location.origin) return;

  // Navigation requests: NETWORK-FIRST so a returning online user always gets the
  // current app shell (cache-first here was the classic "stuck on an old version"
  // trap). On success we refresh the cached shell so the next OFFLINE load is also
  // current; offline, we fall back to the cached shell (keyed as "index.html"
  // because the bare directory path "/mahfazty/" isn't a stored key).
  if(e.request.mode === 'navigate'){
    e.respondWith(
      fetch(e.request).then(res => {
        if(res && res.ok){
          const clone = res.clone();
          // Best-effort cache refresh — a rejected put() (e.g. storage pressure)
          // must not become an unhandled rejection or affect the navigation response.
          caches.open(CACHE).then(c => c.put('./index.html', clone)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('./index.html').then(r =>
        // never resolve to undefined (respondWith would turn it into a confusing
        // TypeError); fall back to the cached request, then a clean 503.
        r || caches.match(e.request).then(c => c || new Response('', {status:503, statusText:'Offline'}))
      ))
    );
    return;
  }

  // Only cache-manage known static asset types. Anything else (e.g. a future API
  // call) passes straight to the network instead of being silently cached.
  if(!/\.(html|css|js|json|png|svg|ico|webmanifest|woff2?)(\?|$)/i.test(url.pathname)){
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if(res && res.ok){
          const clone = res.clone();
          // Best-effort cache refresh — a rejected put() (e.g. storage pressure)
          // must not become an unhandled rejection or affect the fetch response.
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return res;
      }).catch(() => cached || new Response('', {status:503, statusText:'Offline'}));
      // never resolve to null/undefined — that turns into a confusing network error
      return cached || fresh;
    })
  );
});
