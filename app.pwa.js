/* ============================================================
   PWA LIFECYCLE: MANIFEST, SERVICE-WORKER UPDATES, CHANGELOG
   Split out of app.logic.js. Dynamic manifest generation, the update-banner
   flow (detect -> prompt -> apply new Service Worker), and the "What's new?"
   changelog modal.
   Loaded AFTER app.ui.js and BEFORE app.main.js. Calls flushIdbBackup
   (app.core.js) and driveSyncToCloud (app.drive.js) at runtime only.
============================================================ */
function _buildManifestBlob(isLight, isBlack){
  // must match applyTheme()'s <meta name="theme-color"> (app.core.js) exactly,
  // INCLUDING the matte-black variant — collapsing black into the same value as
  // regular dark here left the installed splash/OS-chrome color subtly wrong
  // for that theme specifically.
  const themeColor = isLight ? '#f4f2ed' : (isBlack ? '#0b0b0d' : '#15171c');
  const scopeUrl = new URL('.', location.href).pathname;
  const lang = _currentLang();
  const appName = t({ar:'محفظتيييي', en:'Mahfazty'});
  const manifest = {
    name: appName,
    short_name: appName,
    start_url: scopeUrl,
    // the manifest is served as a blob: URL, so its own "directory" is meaningless —
    // without an explicit scope the browser can't derive one from the blob URL,
    // which can break standalone-window navigation scoping. Pin it to the app's
    // real deployed path (works at root or in a subdirectory).
    scope: scopeUrl,
    display: 'standalone',
    background_color: themeColor,
    theme_color: themeColor,
    orientation: 'portrait',
    dir: _langDir(lang),
    lang: lang,
    icons: [
      {
        src: 'data:image/svg+xml,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="%23dcb674"/><text x="50" y="65" font-size="50" text-anchor="middle">💰</text></svg>'
        ),
        sizes: '192x192 512x512',
        type: 'image/svg+xml',
        // 'maskable' would tell Android it can crop to the inner 80% safe-zone circle —
        // this icon's emoji isn't padded for that and would clip at the edges. 'any'
        // only, so the OS applies its own shape mask without assuming safe-zone padding.
        purpose: 'any'
      }
    ]
  };
  return new Blob([JSON.stringify(manifest)], {type:'application/json'});
}
let _manifestBlobUrl = null; // tracked separately from the link's href so a revoke
// can't be skipped by a failed/never-applied previous toggle (getAttribute() would
// silently miss that case and leak the blob for the rest of the session).
function applyManifest(isLight, isBlack){
  try{
    const link = document.getElementById('manifestLink');
    if(!link) return;
    const next = URL.createObjectURL(_buildManifestBlob(isLight, isBlack));
    link.setAttribute('href', next);
    if(_manifestBlobUrl) URL.revokeObjectURL(_manifestBlobUrl);
    _manifestBlobUrl = next;
  }catch(e){}
}
/* ─── PWA Update Banner ─── */
let _updateBannerTimer = null;
let _updateBannerShowing = false;
// #updateBanner is role="alert" (assertive) — the moment it becomes visible, a
// screen reader interrupts WHATEVER it's currently speaking, including an
// in-progress #saveStatus toast announcement (aria-live="polite") OR the
// #driveBanner sign-in prompt's own dialog announcement (it moves focus into
// itself on reveal — see showDriveBanner, app.drive.js — so a screen-reader
// user could be sitting right inside it when this interrupts). The update
// banner can be triggered at any time by a background SW check (15-min poll,
// or a background download finishing) completely independent of what the
// user is doing, so it revealing itself while ANOTHER banner/toast is
// already up is a real, not contrived, scenario — the same class of bug
// whichever of the two it races. #updateBanner is also top-anchored with a
// HIGHER z-index than the bottom-anchored #driveBanner, so on a short
// viewport (landscape, or the on-screen keyboard shrinking visible height)
// it would visually render on top of / cover the still-open sign-in prompt
// instead of merely competing for the screen reader's attention. Defer the
// reveal (and its own 8s auto-apply countdown, so the user still gets a full
// 8s once it's actually shown) until any currently-visible toast or the
// drive banner's own window ends, with a bounded number of rechecks so a
// stuck '.show' class can't defer this forever.
function _revealUpdateBanner(el, attemptsLeft){
  // Dismissed elsewhere (e.g. the multi-tab teardown in the controllerchange
  // handler below) while this deferred reveal was still pending — abort quietly
  // instead of reviving a banner that was just correctly torn down.
  if(!_updateBannerShowing) return;
  const toastEl = document.getElementById('saveStatus');
  const driveBannerEl = document.getElementById('driveBanner');
  const blocked = (toastEl && toastEl.classList.contains('show')) || (driveBannerEl && driveBannerEl.classList.contains('show'));
  if(blocked && attemptsLeft > 0){
    setTimeout(() => _revealUpdateBanner(el, attemptsLeft - 1), 400);
    return;
  }
  requestAnimationFrame(()=> requestAnimationFrame(()=> el.classList.add('show')));
  _restartUpdateBannerTimer();
}
// Auto-apply after 8 s if the user doesn't interact — "يحدث من وحده". Split out
// so a tab resuming from an OS/mobile-browser freeze can re-arm it (see the
// visibilitychange handler in app.main.js): a frozen setTimeout doesn't count
// down while suspended — it fires ASAP once thawed, since its original
// deadline already elapsed. Without re-arming, a user who backgrounds the app
// with the banner showing and returns 20 minutes later would get reloaded
// abruptly a second or two after looking back at the screen, instead of the
// intended 8-second warning window.
function _restartUpdateBannerTimer(){
  clearTimeout(_updateBannerTimer);
  _updateBannerTimer = setTimeout(() => applyUpdate(), 8000);
}
function showUpdateBanner(){
  const el = document.getElementById('updateBanner');
  if(!el || _updateBannerShowing) return;
  _updateBannerShowing = true;
  const laterBtn = document.getElementById('btnUpdateLater');
  const nowBtn   = document.getElementById('btnUpdateNow');
  if(laterBtn) laterBtn.onclick = dismissUpdate;
  if(nowBtn)   nowBtn.onclick   = applyUpdate;
  _revealUpdateBanner(el, 15); // ~6s max wait (15 × 400ms) before showing anyway
}
function dismissUpdate(){
  clearTimeout(_updateBannerTimer); _updateBannerTimer = null;
  _updateBannerShowing = false;
  _pendingWorker = null;
  const el = document.getElementById('updateBanner');
  if(el) el.classList.remove('show');
  _updateChangelogDot();
}
function applyUpdate(){
  // Don't silently discard a half-typed transaction on reload.
  if(addDrawerOpen){
    const amt = document.getElementById('amountInput');
    const desc = document.getElementById('descInput');
    if((amt && amt.value) || (desc && desc.value)){
      if(!confirm(t({ar:'لديك معاملة غير محفوظة في نموذج الإضافة — التحديث الآن سيتجاهلها. متابعة؟', en:'You have an unsaved transaction in the add form — updating now will discard it. Continue?'}))) return;
    }
  }
  // Same guard for an in-progress transaction edit.
  if(editingTxId != null){
    if(!confirm(t({ar:'لديك تعديل معاملة لم يُحفظ — التحديث الآن سيتجاهله. متابعة؟', en:'You have an unsaved transaction edit — updating now will discard it. Continue?'}))) return;
  } else if(document.querySelector('.modal-overlay.open')){
    // Any other open dialog (تحويل/اشتراك/محفظة/توزيع الدخل، إلخ) can also hold
    // unsaved form input the two specific checks above don't know about — the
    // cross-tab storage listener already treats "any modal open" as unsafe to
    // reload over (see _anyOverlayOpen below); applyUpdate() is a user-initiated
    // reload so it asks instead of silently deferring.
    if(!confirm(t({ar:'هناك نافذة مفتوحة قد تحتوي بيانات غير محفوظة — التحديث الآن سيُغلقها. متابعة؟', en:'There is an open dialog that may contain unsaved data — updating now will close it. Continue?'}))) return;
  }
  // Flush any pending Drive sync before the reload interrupts it.
  if(typeof driveSyncTimer !== 'undefined' && driveSyncTimer){
    clearTimeout(driveSyncTimer); driveSyncTimer = null;
    if(driveAccessToken){ try{ driveSyncToCloud(); }catch(_){} }
  }
  // Flush the debounced IndexedDB write too — the SKIP_WAITING/controllerchange
  // reload below can land inside the 400ms window and drop the last save.
  flushIdbBackup();
  clearTimeout(_updateBannerTimer); _updateBannerTimer = null;
  _updateBannerShowing = false;
  const btn = document.getElementById('btnUpdateNow');
  if(btn){ btn.disabled = true; btn.textContent = t({ar:'...جاري', en:'Working...'}); }
  _reloadOnControllerChange = true;
  if(_pendingWorker){
    try{ _pendingWorker.postMessage({type:'SKIP_WAITING'}); }catch(e){}
  }
  // Fallback reload — covers browsers where controllerchange is unreliable
  setTimeout(() => window.location.reload(), 3000);
}

async function forceClearAndUpdate(){
  // Offline guard: this wipes every cache bucket BEFORE re-fetching — run it
  // with no network and the PWA has no cached shell to boot from (503 until
  // connectivity returns). Refuse instead of bricking offline availability.
  if(!navigator.onLine){
    toast(t({ar:'⚠ لا يوجد اتصال بالإنترنت — التحديث القسري يحتاج الشبكة لإعادة تحميل الملفات', en:'⚠ No internet connection — force refresh needs the network to re-download files'}));
    return;
  }
  const btn = document.querySelector('.btn-cache-refresh');
  if(btn){ btn.disabled = true; btn.textContent = `⏳ ${t({ar:'جاري...', en:'Working...'})}`; }
  flushIdbBackup(); // don't let the hard reload race the debounced save
  _reloadOnControllerChange = true; // also reload via controllerchange if the new SW takes over before our explicit reload below
  try{
    // Wipe every cache bucket the browser holds for this origin
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    // If a new SW is already waiting, activate it immediately
    const reg = await navigator.serviceWorker.getRegistration();
    if(reg){
      if(reg.waiting){
        reg.waiting.postMessage({type:'SKIP_WAITING'});
        await new Promise(r => setTimeout(r, 600));
      } else {
        // Force the browser to re-fetch sw.js and install a fresh SW
        await reg.update();
        await new Promise(r => setTimeout(r, 800));
      }
    }
  }catch(e){}
  // Hard reload — cache is empty so browser fetches everything fresh
  window.location.reload();
}

/* ============================================================
   CHANGELOG ("ما الجديد؟")
============================================================ */
// Shows/hides the "جديد" dot on the settings entry point by comparing the
// newest CHANGELOG version against the last one the user actually opened —
// runs at startup (so the dot is right before Settings is ever opened) and
// again right after openChangelog() marks the latest version as seen.
function _updateChangelogDot(){
  const dot = document.getElementById('changelogDot');
  if(!dot || !CHANGELOG.length) return;
  let seen = null;
  try{ seen = localStorage.getItem(LS_PREFIX + 'changelogSeen'); }catch(e){}
  dot.hidden = (seen === CHANGELOG[0].version);
}
function renderChangelog(){
  const host = document.getElementById('changelogList');
  if(!host) return;
  // title/items are {ar,en} bilingual objects — t() resolves to the current language
  host.innerHTML = CHANGELOG.map(e => `
    <div class="changelog-entry">
      <div class="changelog-entry-head">
        <span class="changelog-entry-title">${escHtml(t(e.title))}</span>
        <span class="changelog-entry-date">${escHtml(e.date)}</span>
      </div>
      <ul>${e.items.map(it => `<li>${escHtml(t(it))}</li>`).join('')}</ul>
    </div>
  `).join('');
}
function openChangelog(){
  renderChangelog();
  try{ localStorage.setItem(LS_PREFIX + 'changelogSeen', CHANGELOG[0].version); }catch(e){}
  _updateChangelogDot();
  openModal('changelogModal');
}

// Ask the browser to re-check sw.js for a new version. `force` skips the 30s
// throttle (used for the initial check). The throttle stops rapid tab-switching
// from hammering the network while still letting a return-after-hours check run.
let _lastSWUpdateCheck = 0;
function checkForSWUpdate(force){
  const reg = _swRegistration;
  if(!reg) return;
  const now = Date.now();
  if(!force && now - _lastSWUpdateCheck < 30000) return;
  _lastSWUpdateCheck = now;
  // a SW may already be installed and waiting (detected on a previous check) —
  // surface its banner immediately instead of waiting for another updatefound
  if(reg.waiting && !_pendingWorker){
    _pendingWorker = reg.waiting;
    showUpdateBanner();
  }
  try{ reg.update(); }catch(_){}
}

// Query the active controller's sw.js CACHE constant over a MessageChannel.
// Resolves null (never rejects) on missing controller, no reply within
// timeoutMs, or a postMessage failure — every caller treats null as "unknown,
// skip" rather than an error.
function _querySWVersion(worker, timeoutMs){
  return new Promise(resolve => {
    if(!worker){ resolve(null); return; }
    const channel = new MessageChannel();
    let done = false;
    const timer = setTimeout(() => { if(!done){ done = true; resolve(null); } }, timeoutMs || 2000);
    channel.port1.onmessage = e => {
      if(done) return;
      done = true; clearTimeout(timer);
      resolve(e.data && e.data.version);
    };
    try{ worker.postMessage({type:'GET_VERSION'}, [channel.port2]); }
    catch(_){ if(!done){ done = true; clearTimeout(timer); resolve(null); } }
  });
}

// Boot-time safety net for the SW update path: most updates are caught by the
// updatefound/banner flow in setupPWA(), but a tab can end up with a stale
// controller the banner never fired for (e.g. it was open across a deploy,
// missed the updatefound event entirely, or the page was restored from bfcache
// after the update banner was already dismissed). On every load, compare the
// controlling SW's actual cache version against what this freshly-loaded page
// expects; on a mismatch, funnel into the existing non-destructive
// checkForSWUpdate(true) → banner → applyUpdate() flow rather than reloading
// or clearing caches outright (those stay manual-only, see forceClearAndUpdate).
async function _checkSWDriftAtBoot(){
  if(!('serviceWorker' in navigator)) return;
  const controller = navigator.serviceWorker.controller;
  if(!controller) return; // first install / no controlling SW yet — nothing to drift from
  const expected = 'mhfzty-' + ((CHANGELOG[0] && CHANGELOG[0].version) || '');
  const actual = await _querySWVersion(controller);
  if(actual && actual !== expected) checkForSWUpdate(true);
}

function setupPWA(){
  applyManifest(document.body.classList.contains('light'), document.body.classList.contains('theme-black'));

  if(!('serviceWorker' in navigator)) return;

  // Capture whether a SW was already controlling this page at load time.
  // Distinguishes a first install (no old SW → no reload needed) from an
  // update (old SW swapped out → reload to load fresh assets).
  const hadController = !!navigator.serviceWorker.controller;

  try{
    // updateViaCache:'none' → the browser always re-fetches sw.js from the
    // network (never the HTTP cache) so a new version is detected reliably.
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(reg => {
        _swRegistration = reg;
        // Watch for a new SW installing — show the update banner as soon as
        // it reaches "installed" (caching complete, waiting for skipWaiting).
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if(!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if(newWorker.state === 'installed' && navigator.serviceWorker.controller){
              _pendingWorker = newWorker;
              showUpdateBanner();
            }
          });
        });
        // Trigger an explicit check right away, then poll every 15 min so
        // long-running sessions pick up a new version promptly.
        checkForSWUpdate(true);
        setInterval(checkForSWUpdate, 15 * 60 * 1000);
        _checkSWDriftAtBoot();
      })
      .catch(e => console.warn('SW registration failed:', e));

    // When the new SW takes control (after skipWaiting), reload to serve fresh assets.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if(hadController && _reloadOnControllerChange){
        sessionStorage.setItem('_swJustUpdated', '1');
        window.location.reload();
      } else if(hadController){
        // This tab got CLAIMED by a new SW it never asked for — another tab (or
        // a dismissed/missed banner here) drove skipWaiting+activate, and
        // clients.claim() re-parents every open tab. This tab now runs OLD
        // in-memory JS under the NEW SW whose activate step already deleted
        // the old cache bucket; without a recheck it would stay stale
        // indefinitely (the 15-min poll can't help — the new SW is already
        // "current", so no waiting worker ever appears). Re-run the drift
        // check to funnel into the normal banner → applyUpdate flow.
        // If THIS tab was already showing its own update banner, it referenced
        // the worker that just activated globally — that worker is no longer
        // "waiting", so leaving the banner up would let a click on its Update
        // button hang for ~3s (posting SKIP_WAITING to an already-active worker,
        // no new controllerchange to react to, only the applyUpdate() fallback
        // timer eventually reloading). Tear it down now; _checkSWDriftAtBoot()
        // below will raise a fresh banner if a genuinely new update is waiting.
        if(_updateBannerShowing) dismissUpdate();
        _checkSWDriftAtBoot();
      }
    });
  }catch(e){}
}
