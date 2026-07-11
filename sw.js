const CACHE = 'mhfzty-v48.21';
// The ?v= suffix on every script/stylesheet URL below MUST match this CACHE
// version AND index.html's script tags (enforced by tests/version.test.js).
// Why: cache keys include the query string, so each release gets FRESH keys for
// the whole 16-file set. Without this, the runtime stale-while-revalidate
// below refreshed each file's single fixed cache entry independently and
// asynchronously — after a deploy, a tab could load some files already
// refreshed to the new release alongside others still at the old one, from
// the SAME cache bucket. That mixed old/new set is the exact fatal
// "Identifier has already been declared" class v47.74 fixed for the browser's
// OWN HTTP cache (_freshFetch below) but which remained open through the SW's
// cache. With per-release keys, the new (network-first) index.html references
// URLs the old bucket never had → every file misses cache and fetches fresh
// together; offline, the old index.html keeps referencing its own fully-cached
// old set. Old-version entries die with their bucket on activate.
const ASSET_V = CACHE.split('-v')[1];
// Note: sw.js itself is intentionally NOT precached — the browser fetches and
// byte-compares it directly to drive updates; caching it via the Cache API is a
// no-op at best and can interfere with that update check.
const PRECACHE = [
  './index.html',
  `./style.css?v=${ASSET_V}`,
  ...['i18n.js','changelog.js','app.core.js','app.ui.js','app.voice.js','app.layout.js','app.charts.js','app.drive.js',
      'app.quicknotes.js','app.data.js','app.engage.js','app.pwa.js','app.overlay.js','app.logic.js','app.main.js']
    .map(f => `./${f}?v=${ASSET_V}`),
  // referenced from index.html's <head> (favicon/apple-touch-icon) and footer
  // (privacy/terms) — omitted before, undermining the "works offline from the
  // very first visit" guarantee the install handler below is meant to provide.
  // Unversioned: standalone leaf documents/images with no cross-file coupling.
  './favicon-32.png', './apple-touch-icon.png', './privacy.html', './terms.html'
];

// Fetch bypassing the BROWSER's own HTTP cache (Cache-Control/ETag/heuristic
// freshness) — every place this SW populates its own Cache API storage MUST
// use this, not a plain fetch()/cache.add(). Without {cache:'reload'}, a
// browser that already has e.g. app.ui.js sitting in its ordinary HTTP cache
// from a much older visit can hand that STALE response back to the SW during
// precache, even while the SW correctly fetches a brand-new file (like one
// introduced by a later split) fresh — silently mixing an old and a new file
// version in the same page load. That exact mix (old app.ui.js, still
// containing a declaration later moved to a new app.voice.js, loaded
// alongside the new app.voice.js) is what caused the "Identifier ... has
// already been declared" fatal error some users hit updating across the
// v47.72 file split — the Cache API bucket was rebuilt correctly, but the
// browser's OWN cache handed back a stale response before that ever ran.
function _freshFetch(url){
  return fetch(url, { cache: 'reload' });
}

self.addEventListener('install', e => {
  // Cache each file independently — addAll() is all-or-nothing and a single
  // transient 404 would sink offline support for every other file.
  // skipWaiting() is NOT called here — the page shows an update banner and
  // either the user clicks "تحديث الآن" or the banner auto-applies after ~8s,
  // both of which post a SKIP_WAITING message handled below.
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(PRECACHE.map(url =>
        _freshFetch(url).then(res => res.ok ? c.put(url, res) : null).catch(() => {})
      ))
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

// The app posts SKIP_WAITING when the user taps "تحديث الآن". It posts
// GET_VERSION (with a MessagePort) at every boot to let the page detect a
// stale controller — e.g. a tab left open across a deploy whose controller
// never updated because the update banner was dismissed/missed — and react
// via the normal non-destructive update flow.
self.addEventListener('message', e => {
  if(!e.data) return;
  if(e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if(e.data.type === 'GET_VERSION' && e.ports && e.ports[0]){
    e.ports[0].postMessage({ version: CACHE });
  }
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
      _freshFetch(e.request).then(res => {
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
      const fresh = _freshFetch(e.request).then(res => {
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
