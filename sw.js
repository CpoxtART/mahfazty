const CACHE = 'mhfzty-v16';
// Note: sw.js itself is intentionally NOT precached — the browser fetches and
// byte-compares it directly to drive updates; caching it via the Cache API is a
// no-op at best and can interfere with that update check.
const PRECACHE = ['./index.html', './style.css', './app.core.js', './app.ui.js', './app.logic.js'];

self.addEventListener('install', e => {
  // Pre-cache core files so the app works offline from the very first visit.
  // No skipWaiting() here — the app shows an in-page update banner and posts
  // SKIP_WAITING when the user approves, giving them control over the timing.
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
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

  // Navigation requests (e.g. root path "/mahfazty/" without the filename) may
  // miss the cache because the stored key is "index.html", not the bare directory
  // path. Serve the cached shell explicitly so the app loads offline regardless
  // of how the URL was typed.
  if(e.request.mode === 'navigate'){
    e.respondWith(
      caches.match('./index.html').then(r => r || fetch(e.request))
        .catch(() => caches.match('./index.html'))
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
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached || new Response('', {status:503, statusText:'Offline'}));
      // never resolve to null/undefined — that turns into a confusing network error
      return cached || fresh;
    })
  );
});
