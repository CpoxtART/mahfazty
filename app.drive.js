/* ============================================================
   GOOGLE DRIVE AUTO-SYNC  (split out of app.logic.js)
   Loaded via its own <script> tag BEFORE app.main.js so its
   const/function declarations are in scope when app.main.js's
   bottom-of-file init runs. This file is declaration-only — it
   has no top-level executable statements.
============================================================ */
const DRIVE_FILE_NAME = 'mahfazty-data.json';
// Older versions stored the file under an Arabic name with a repeated-letter typo.
// driveFindFile() looks for both and silently renames the legacy file on first
// sight so existing synced data isn't orphaned by the rename.
const DRIVE_FILE_NAME_LEGACY = 'محفظتيييي-data.json';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

let gisTokenClient = null;
let driveAccessToken = null;
let driveTokenExpiry = 0; // epoch ms when the current access token stops being valid
let _pendingDriveCloud = null;
let driveFileId = null;
let driveSyncTimer = null;
let driveClientId = '';
// Drive token-request state. _driveSilentMode marks an in-flight token request and
// how to recover / how to resolve the resulting sync:
//   'launch'    — desktop auto-open silent grant → on failure show the banner
//   'refresh'   — token nearing expiry while open → on failure quietly drop
//   'banner'    — desktop banner silent grant → on failure escalate to account picker
//   'reconnect' — mobile banner tap (gesture-backed interactive request)
//   'signin'    — explicit user-initiated sign-in from Settings
//   null        — idle (no request in flight)
// IMPORTANT: only 'signin' is treated as "interactive" for sync resolution (it alone
// may show the conflict modal). Every other mode resolves silently via the union
// merge, so an automatic/banner reconnect never nags the user to pick a copy.
let _driveSilentMode = null;
let _driveBannerEscalate = false; // next banner tap should force the account picker
let _driveTokenRefreshTimer = null; // proactive refresh 5 min before token expires
// The dataEditedAt value we last confirmed is reflected on Drive (either we just
// pushed it, or we just merged it in from a pull). Lets driveSyncToCloud tell
// "Drive still matches what we last saw" apart from "another device pushed since
// then" without re-merging on every single debounced push.
let _driveLastSyncedEditedAt = 0;

// A gesture-free silent token grab is reliable on desktop browsers, but on mobile /
// embedded / installed-PWA contexts it can redirect the top frame to
// accounts.google.com/gsi/transfer and hang on a blank page. So only attempt the
// no-tap silent path in safe contexts; elsewhere we use the one-tap banner (whose
// tap drives a gesture-backed interactive request that still tends to skip the
// account-chooser for an already-consented user, see driveReconnectInteractive()).
function _driveSilentSafe(){
  try{
    if(isEmbeddedOrStandalone()) return false;
    const ua = navigator.userAgent || '';
    if(/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
    return true;
  }catch(_){ return false; }
}

// Cookie helpers — used as a second-layer storage alongside localStorage so the
// Drive token survives when the browser wipes localStorage on force-close.
// Cookies are scoped to the app's own path (e.g. /mahfazty/) to avoid leaking
// the token to other GitHub-Pages sites that share the github.io domain.
function _driveCookiePath(){
  try{ return new URL('.', location.href).pathname; }catch(_){ return '/'; }
}
function _setDriveCookie(name, val){
  try{
    const path = _driveCookiePath();
    // Session cookie — no explicit expires so it disappears when the browser closes,
    // matching the sessionStorage lifecycle. The VALUE of mhfzty_dexp carries the
    // token's actual expiry timestamp so other tabs can still validate the token.
    document.cookie = `${name}=${encodeURIComponent(val)}; path=${path}; SameSite=Strict; Secure`;
  }catch(_){}
}
function _getDriveCookie(name){
  try{
    const entry = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith(name+'='));
    return entry ? decodeURIComponent(entry.slice(name.length+1)) : null;
  }catch(_){ return null; }
}
function _deleteDriveCookie(name){
  try{
    const path = _driveCookiePath();
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}; SameSite=Strict`;
  }catch(_){}
}

// Persist the access token in sessionStorage (primary) and a path-scoped session
// cookie (cross-tab fallback within the same browser session). Both are cleared
// when the browser closes, limiting the token theft window vs. the old approach
// of persisting in localStorage across sessions. Users who reopen the app will
// need one tap on the Drive banner (mobile) or a transparent ~300ms GIS silent
// grant (desktop) — same as any post-token-expiry reconnect, just more frequent.
function storeDriveToken(token, expiresInSec){
  driveAccessToken = token;
  driveTokenExpiry = Date.now() + (Math.max(0, (expiresInSec || 3600) - 60) * 1000); // 60s safety margin
  try{
    sessionStorage.setItem(LS_PREFIX + 'driveToken', token);
    sessionStorage.setItem(LS_PREFIX + 'driveTokenExp', String(driveTokenExpiry));
  }catch(e){}
  _setDriveCookie('mhfzty_dtok', token);
  _setDriveCookie('mhfzty_dexp', String(driveTokenExpiry));
  // schedule a silent refresh 5 min before the token expires so an active
  // session never suddenly loses Drive access mid-use
  _scheduleTokenRefresh();
}
function clearDriveToken(){
  clearTimeout(_driveTokenRefreshTimer); _driveTokenRefreshTimer = null;
  driveAccessToken = null;
  driveTokenExpiry = 0;
  try{
    sessionStorage.removeItem(LS_PREFIX + 'driveToken');
    sessionStorage.removeItem(LS_PREFIX + 'driveTokenExp');
    localStorage.removeItem(LS_PREFIX + 'driveToken');    // clear pre-v47.63 persisted token
    localStorage.removeItem(LS_PREFIX + 'driveTokenExp'); // clear pre-v47.63 persisted expiry
  }catch(e){}
  _deleteDriveCookie('mhfzty_dtok');
  _deleteDriveCookie('mhfzty_dexp');
}
function driveTokenValid(){
  return !!driveAccessToken && Date.now() < driveTokenExpiry;
}
function _scheduleTokenRefresh(){
  clearTimeout(_driveTokenRefreshTimer); _driveTokenRefreshTimer = null;
  if(!driveTokenExpiry) return;
  const delay = driveTokenExpiry - Date.now() - 5*60*1000; // 5 min before expiry
  if(delay <= 0) return;
  _driveTokenRefreshTimer = setTimeout(() => {
    _driveTokenRefreshTimer = null;
    if(!driveAccessToken) return;
    // On desktop/safe contexts we can silently re-acquire the token (active session +
    // prior consent → no UI), keeping a long session seamless. On mobile a gesture-free
    // call can hang on gsi/transfer, so there we drop the token and let the next open
    // reconnect via the banner.
    if(_driveSilentSafe()){
      driveRequestSilent('refresh');
    } else {
      clearDriveToken();
      refreshDriveSettingsUI();
      toast(t({ar:'⏱ انتهت جلسة Drive — اضغط على أيقونة ☁️ في الأعلى أو سجّل دخولك من الإعدادات', en:'⏱ Drive session expired — tap the ☁️ icon above or sign in from Settings'}), true);
    }
  }, delay);
}

function loadDriveConfig(){
  try{
    driveClientId = localStorage.getItem(LS_PREFIX + 'driveClientId') || '';
  }catch(e){}
}

// Auto-sign-in preference — persists across sessions as a simple boolean
function loadDriveAutoSignIn(){
  try{ return localStorage.getItem(LS_PREFIX + 'driveAutoSignIn') === 'true'; }catch(_){ return false; }
}
function setDriveAutoSignIn(enabled){
  try{ localStorage.setItem(LS_PREFIX + 'driveAutoSignIn', enabled ? 'true' : 'false'); }catch(_){}
  const chk = document.getElementById('driveAutoSignInChk');
  if(chk) chk.checked = !!enabled;
}
function enableDriveAutoSignIn(){
  setDriveAutoSignIn(true);
  const p = document.getElementById('driveAutoSignInPrompt');
  if(p) p.style.display = 'none';
  const row = document.getElementById('driveAutoSignInRow');
  if(row) row.style.display = 'block';
  toast(t({ar:'✓ سيتصل التطبيق بـ Drive تلقائياً في كل مرة تفتحه', en:'✓ The app will connect to Drive automatically every time you open it'}));
}
function dismissDriveAutoSignInPrompt(){
  const p = document.getElementById('driveAutoSignInPrompt');
  if(p) p.style.display = 'none';
  // mark as seen so we don't ask again this session; next sign-in it may show again
  try{ sessionStorage.setItem(LS_PREFIX + 'autoSignInAsked', '1'); }catch(_){}
}

/* ─── Launch Drive-connect banner ───
   Shown on app open when a Drive Client ID is configured but the session is
   disconnected (token expired). Brings the reconnect action to the user as a
   one-tap banner instead of making them hunt for the ☁️ button, and remembers
   their "always connect" choice. NOTE: we deliberately do NOT attempt a silent
   requestAccessToken({prompt:''}) — on mobile that can redirect the top frame to
   accounts.google.com/gsi/transfer and hang on a blank page. Re-auth needs a real
   tap, so even an "auto" user gets a frictionless one-tap banner on token expiry. */
let _driveBannerPrevFocus = null; // saved focus element to restore when banner closes
function showDriveBanner(retriesLeft){
  const b = document.getElementById('driveBanner');
  if(!b || b.classList.contains('show')) return;
  // Mirror of app.pwa.js's _revealUpdateBanner deferral (that side already
  // waits for THIS banner) — this direction covers the reverse ordering: the
  // update banner reveals first, then something calls showDriveBanner() while
  // it's still up. Without this, moving focus into "Yes, connect" (below)
  // while the update banner's role="alert" is active would fight over the
  // screen reader's attention exactly like the toast-vs-banner clash did.
  const updateBannerEl = document.getElementById('updateBanner');
  if(updateBannerEl && updateBannerEl.classList.contains('show') && (retriesLeft === undefined || retriesLeft > 0)){
    setTimeout(() => showDriveBanner(retriesLeft === undefined ? 15 : retriesLeft - 1), 400);
    return;
  }
  const chk = document.getElementById('driveBannerAuto');
  if(chk) chk.checked = true; // default to "remember me"
  const yes = document.getElementById('btnDriveYes');
  const later = document.getElementById('btnDriveLater');
  if(yes) yes.onclick = () => {
    setDriveAutoSignIn(!!(chk && chk.checked)); // remember the choice for next launch
    hideDriveBanner();
    // desktop: try a silent grant first, only escalate to the picker if needed.
    // mobile: use the gesture-backed interactive request (this tap is the gesture
    // GIS needs) — it still tends to skip the picker for an already-consented user.
    driveReconnectFromBanner();
  };
  if(later) later.onclick = () => {
    hideDriveBanner();
    try{ sessionStorage.setItem(LS_PREFIX + 'driveBannerDismissed', '1'); }catch(_){}
  };
  _driveBannerPrevFocus = document.activeElement;
  requestAnimationFrame(()=>{
    b.classList.add('show');
    // Move keyboard focus into the banner so keyboard and screen-reader users
    // don't get stranded on whatever element triggered the banner.
    const btn = document.getElementById('btnDriveYes');
    if(btn) try{ btn.focus({preventScroll:true}); }catch(_){}
  });
}
function hideDriveBanner(){
  const b = document.getElementById('driveBanner');
  if(b) b.classList.remove('show');
  // Restore focus to wherever it was before the banner appeared.
  if(_driveBannerPrevFocus && typeof _driveBannerPrevFocus.focus === 'function'){
    try{ _driveBannerPrevFocus.focus({preventScroll:true}); }catch(_){}
  }
  _driveBannerPrevFocus = null;
}
function maybePromptDriveConnect(){
  if(!driveClientId || driveTokenValid()) return; // nothing to prompt
  let dismissed = false;
  try{ dismissed = sessionStorage.getItem(LS_PREFIX + 'driveBannerDismissed') === '1'; }catch(_){}
  if(dismissed) return;
  if(loadDriveAutoSignIn()){
    // Auto-sign-in user. On desktop/safe contexts reconnect SILENTLY on open — no
    // banner, no tap, no re-consent (the whole point of "always connect"). On mobile
    // we can't do a gesture-free silent grant safely, so show the fast one-tap banner
    // (its tap drives a gesture-backed interactive request — see driveReconnectInteractive()
    // — which still tends to skip the picker for an already-consented user).
    if(_driveSilentSafe()){ setTimeout(driveAutoSilent, 300); }
    else { setTimeout(showDriveBanner, 200); }
    return;
  }
  // first-timer: gentle banner after a short beat so it doesn't fight first paint
  setTimeout(showDriveBanner, 1400);
}

function setDriveIndicator(state_){
  // state_: 'idle' | 'syncing' | 'ok' | 'error' | 'off'
  const el = document.getElementById('driveIndicator');
  if(state_ === 'off' || !driveClientId){
    el.style.display = 'none';
    return;
  }
  const map = {
    idle:    {icon:'☁️', label:t({ar:'جاهز',   en:'Ready'}),    color:'var(--muted)'},
    syncing: {icon:'🔄', label:t({ar:'يزامن',  en:'Syncing'}),  color:'var(--blue)'},
    ok:      {icon:'✅', label:t({ar:'متزامن', en:'Synced'}),   color:'var(--green)'},
    error:   {icon:'⚠️', label:t({ar:'خطأ',    en:'Error'}),    color:'var(--red)'},
    offline: {icon:'📡', label:t({ar:'غير متصل', en:'Offline'}), color:'var(--muted)'}
  };
  const cfg = map[state_] || map.idle;
  const clickable = (state_ === 'idle' || state_ === 'error'); // tap to sign in when disconnected (signing in also needs network, so 'offline' stays non-clickable)
  // Render as a real header button (same 44px rounded-square as the others) so it
  // reads as a control, not a mystery glyph. Always show the cloud ☁️ (universally
  // "sync/cloud") plus a small state badge, and tint the disconnected state with
  // the gold "tap me" look so a new user notices it's actionable. Full status in title.
  el.className = 'icon-btn drive-ind drive-ind--' + state_;
  el.style.display = 'flex';
  el.onclick = clickable ? driveSignIn : null;
  el.setAttribute('role', clickable ? 'button' : 'img');
  // It's a plain <span> (not a native <button>), so role="button" alone doesn't
  // make it keyboard-reachable — every other custom-interactive control in the
  // app pairs role="button" with tabindex+a keydown handler; this one was missing
  // both, leaving it completely unusable from the keyboard when clickable.
  if(clickable){
    el.setAttribute('tabindex', '0');
    el.onkeydown = (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); driveSignIn(); } };
  } else {
    el.removeAttribute('tabindex');
    el.onkeydown = null;
  }
  const badge = { idle:'', syncing:'🔄', ok:'✓', error:'!', offline:'⨯' }[state_] || '';
  el.innerHTML = `<span class="drive-ind-ic">${state_ === 'offline' ? '📡' : '☁️'}</span>${badge ? `<span class="drive-ind-badge">${badge}</span>` : ''}`;
  const fullLabel = {
    idle: t({ar:'مزامنة Drive: جاهز — اضغط لتسجيل الدخول', en:'Drive sync: ready — tap to sign in'}),
    syncing: t({ar:'مزامنة Drive: جاري المزامنة...', en:'Drive sync: syncing...'}),
    ok: t({ar:'مزامنة Drive: متزامن ✓', en:'Drive sync: synced ✓'}),
    error: t({ar:'مزامنة Drive: خطأ — اضغط لتسجيل الدخول مجدداً', en:'Drive sync: error — tap to sign in again'}),
    offline: t({ar:'مزامنة Drive: غير متصل بالإنترنت — سيتم المزامنة تلقائياً عند العودة للاتصال', en:'Drive sync: offline — will sync automatically when back online'})
  }[state_] || cfg.label;
  el.title = fullLabel;
  el.setAttribute('aria-label', fullLabel);
}

// Google's sign-in popup (accounts.google.com/gsi/...) often can't close itself
// and return the token when the app runs inside an in-app/embedded browser or as
// an installed PWA in standalone mode, leaving the user stuck on a blank page.
// Detect those contexts so we can advise opening a real browser tab instead.
function isEmbeddedOrStandalone(){
  try{
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true;
    const ua = navigator.userAgent || '';
    // common in-app browser signatures (Facebook, Instagram, Snapchat, Line,
    // Twitter, TikTok, WhatsApp, generic WebView)
    const inApp = /(FBAN|FBAV|FB_IAB|Instagram|Snapchat|Line\/|Twitter|TikTok|WhatsApp|; wv\)|GSA\/)/i.test(ua);
    return standalone || inApp;
  }catch(_){ return false; }
}

function refreshDriveSettingsUI(){
  const $ = id => document.getElementById(id);
  const setupEl = $('driveSetup');
  const actionsEl = $('driveActions');
  const statusEl = $('driveStatusText');
  const signInBtn = $('driveSignInBtn');
  const signedInActions = $('driveSignedInActions');
  const embeddedWarn = $('driveEmbeddedWarn');
  const autoSignInRow = $('driveAutoSignInRow');
  const autoSignInChk = $('driveAutoSignInChk');

  if(embeddedWarn) embeddedWarn.style.display = (!driveAccessToken && isEmbeddedOrStandalone()) ? 'block' : 'none';

  if(!driveClientId){
    setupEl.style.display = 'block';
    actionsEl.style.display = 'none';
    statusEl.textContent = t({ar:'غير مفعّل. أدخل Client ID الخاص بك للبدء.', en:'Not set up. Enter your Client ID to get started.'});
    setDriveIndicator('off');
    return;
  }
  setupEl.style.display = 'none';
  actionsEl.style.display = 'block';

  // The auto-connect toggle governs the NEXT app open, so it's relevant in both
  // the connected and disconnected states — and its checked state must reflect
  // the STORED preference every time Settings renders. It used to stay hidden
  // here (only enableDriveAutoSignIn ever showed it) and never re-read the
  // preference, so after a reload the toggle was invisible/desynced and the
  // user had no way to see or turn off "always connect".
  if(autoSignInRow) autoSignInRow.style.display = 'block';
  if(autoSignInChk) autoSignInChk.checked = loadDriveAutoSignIn();

  if(driveAccessToken){
    statusEl.textContent = t({ar:'متصل ✓ — البيانات تُحفظ تلقائيًا على Google Drive (مجلد بيانات التطبيق الخاص).', en:'Connected ✓ — data is saved automatically to Google Drive (private app data folder).'});
    signInBtn.style.display = 'none';
    signedInActions.style.display = 'flex';
    setDriveIndicator('ok');
  } else {
    statusEl.textContent = t({ar:'اضغط على زر أدناه أو على أيقونة ☁️ في الأعلى لتسجيل الدخول.', en:'Tap the button below or the ☁️ icon above to sign in.'});
    signInBtn.style.display = 'block';
    signedInActions.style.display = 'none';
    setDriveIndicator('idle');
  }
}

function saveDriveClientId(){
  const val = document.getElementById('driveClientId').value.trim();
  if(!val || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(val)){
    toast(t({ar:'⚠ تأكد من نسخ Client ID كاملاً (ينتهي بـ .apps.googleusercontent.com)', en:'⚠ Make sure you copied the full Client ID (ends with .apps.googleusercontent.com)'}), true);
    return;
  }
  driveClientId = val;
  try{
    localStorage.setItem(LS_PREFIX + 'driveClientId', val);
  }catch(e){
    toast(t({ar:'⚠ فشل حفظ Client ID محليًا — لن يبقى محفوظاً بعد إعادة فتح التطبيق', en:"⚠ Failed to save Client ID locally — it won't persist after reopening the app"}), true);
    refreshDriveSettingsUI();
    initGisClient();
    return;
  }
  refreshDriveSettingsUI();
  initGisClient();
  toast(t({ar:'✓ تم الحفظ. الآن سجّل الدخول بجوجل', en:'✓ Saved. Now sign in with Google'}));
}

function changeDriveClientId(){
  if(!confirm(t({ar:'سيتم تسجيل الخروج وحذف إعداد Drive الحالي. متابعة؟', en:'This will sign out and remove the current Drive setup. Continue?'}))) return;
  driveSignOut();
  driveClientId = '';
  driveFileId = null;
  try{ localStorage.removeItem(LS_PREFIX + 'driveClientId'); }catch(e){}
  document.getElementById('driveClientId').value = '';
  refreshDriveSettingsUI();
}

function initGisClient(){
  if(!driveClientId || typeof google === 'undefined' || !google.accounts){
    return;
  }
  try{
    gisTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: driveClientId,
      scope: DRIVE_SCOPE,
      callback: async (resp) => {
        const mode = _driveSilentMode; _driveSilentMode = null;
        if(resp.error){
          // a silent (prompt:'') grant wasn't possible — handle gracefully per context
          // instead of showing a hard error the user didn't trigger.
          if(mode === 'launch'){ setDriveIndicator('idle'); showDriveBanner(); return; }
          if(mode === 'refresh'){ clearDriveToken(); refreshDriveSettingsUI(); setDriveIndicator('idle'); return; }
          if(mode === 'banner'){ _driveBannerEscalate = true; showDriveBanner(); return; }
          setDriveIndicator('error');
          toast(t({ar:'⚠ تعذّر تسجيل الدخول بجوجل، حاول مجددًا', en:'⚠ Google sign-in failed, try again'}), true);
          refreshDriveSettingsUI();
          return;
        }
        _driveBannerEscalate = false;
        storeDriveToken(resp.access_token, parseInt(resp.expires_in, 10));
        refreshDriveSettingsUI();
        // stay quiet on background silent reconnects/refreshes; only announce when the
        // user explicitly acted (interactive sign-in or a banner tap)
        if(mode !== 'launch' && mode !== 'refresh') toast(t({ar:'✓ تم تسجيل الدخول بجوجل', en:'✓ Signed in with Google'}));
        // Only an explicit sign-in the user started from Settings ('signin') may
        // interrupt with the conflict-resolution modal. EVERY automatic/banner
        // reconnect ('launch'/'refresh'/'banner'/'reconnect') resolves silently via
        // the non-destructive union merge instead. Previously this passed interactive
        // = true for every banner reconnect, so a returning user with data on both
        // sides got the "which copy do you want?" modal on EVERY app open — the
        // repeated prompt. The union merge keeps everything from both sides (honoring
        // tombstones), so resolving silently is safe and loses nothing.
        await driveSyncFromCloud(true, mode === 'signin');
      }
    });
  }catch(e){
    console.error(e);
  }
}

// Interactive sign-in — shows the Google account picker. Used for the first
// connection and as the fallback when a silent grant needs real interaction.
function driveSignIn(){
  // _driveSilentMode is non-null for the whole lifetime of an in-flight token
  // request (cleared only once the callback fires) — reused here as a busy
  // guard so a rapid double-tap can't open a second competing OAuth popup.
  if(_driveSilentMode) return;
  if(!gisTokenClient){ initGisClient(); }
  if(!gisTokenClient){ toast(t({ar:'⚠ تعذر تهيئة جوجل، جرّب تحديث الصفحة', en:'⚠ Could not initialize Google, try refreshing the page'}), true); return; }
  _driveSilentMode = 'signin'; // explicit user-initiated sign-in from Settings — the ONLY path allowed to show the conflict-resolution modal
  try{
    gisTokenClient.requestAccessToken({
      prompt: 'select_account',
      // surface popup-level failures (blocked / closed / can't return) instead of
      // leaving the user staring at a blank google sign-in page with no feedback
      error_callback: (err) => {
        _driveSilentMode = null;
        setDriveIndicator('error');
        const t = (err && err.type) || '';
        if(t === 'popup_failed_to_open'){
          toast(t({ar:'⚠ تعذّر فتح نافذة جوجل — افتح التطبيق في متصفح Chrome/Safari', en:'⚠ Could not open the Google window — open the app in Chrome/Safari'}), true);
        } else if(t === 'popup_closed'){
          toast(t({ar:'أُغلقت نافذة تسجيل الدخول قبل اكتمالها', en:'The sign-in window was closed before completing'}), true);
        } else {
          toast(t({ar:'⚠ تعذّر تسجيل الدخول بجوجل، حاول مجددًا', en:'⚠ Google sign-in failed, try again'}), true);
        }
      }
    });
  }catch(e){ toast(t({ar:'⚠ تعذّر بدء تسجيل الدخول بجوجل', en:'⚠ Could not start Google sign-in'}), true); }
}

// Banner reconnect on mobile: an interactive (gesture-backed) request like driveSignIn,
// but WITHOUT forcing prompt:'select_account'. Leaving prompt unset is GIS's documented
// default — with an active Google session and prior consent it typically grants the
// token straight away (no account-chooser screen), while still using the same reliable
// popup/redirect path that's proven not to hang on mobile (unlike prompt:'' below).
function driveReconnectInteractive(){
  // see driveSignIn's matching guard comment
  if(_driveSilentMode) return;
  if(!gisTokenClient){ initGisClient(); }
  if(!gisTokenClient){ toast(t({ar:'⚠ تعذر تهيئة جوجل، جرّب تحديث الصفحة', en:'⚠ Could not initialize Google, try refreshing the page'}), true); return; }
  _driveSilentMode = 'reconnect'; // automatic banner reconnect — resolve via the silent union merge, never the conflict modal
  try{
    gisTokenClient.requestAccessToken({
      error_callback: (err) => {
        _driveSilentMode = null;
        setDriveIndicator('error');
        const t = (err && err.type) || '';
        if(t === 'popup_failed_to_open'){
          toast(t({ar:'⚠ تعذّر فتح نافذة جوجل — افتح التطبيق في متصفح Chrome/Safari', en:'⚠ Could not open the Google window — open the app in Chrome/Safari'}), true);
        } else if(t === 'popup_closed'){
          toast(t({ar:'أُغلقت نافذة تسجيل الدخول قبل اكتمالها', en:'The sign-in window was closed before completing'}), true);
        } else {
          toast(t({ar:'⚠ تعذّر تسجيل الدخول بجوجل، حاول مجددًا', en:'⚠ Google sign-in failed, try again'}), true);
        }
      }
    });
  }catch(e){ toast(t({ar:'⚠ تعذّر بدء تسجيل الدخول بجوجل', en:'⚠ Could not start Google sign-in'}), true); }
}

// Silent (no-UI) token request. With an active Google session AND consent already
// granted, prompt:'' returns a token WITHOUT any account picker/consent — so a
// returning auto-sign-in user reconnects with zero friction. `mode` tells the
// shared callback how to recover if a silent grant turns out to need interaction.
function driveRequestSilent(mode){
  if(!gisTokenClient){ initGisClient(); }
  if(!gisTokenClient) return false;
  _driveSilentMode = mode;
  try{
    gisTokenClient.requestAccessToken({
      prompt: '',
      error_callback: () => {
        const m = _driveSilentMode; _driveSilentMode = null;
        if(m === 'launch'){ showDriveBanner(); }
        else if(m === 'banner'){ _driveBannerEscalate = true; showDriveBanner(); }
        else if(m === 'refresh'){ clearDriveToken(); refreshDriveSettingsUI(); setDriveIndicator('idle'); }
      }
    });
    return true;
  }catch(e){ _driveSilentMode = null; return false; }
}

// Desktop auto-sign-in users: reconnect silently on app open — no banner, no tap,
// no consent. Falls back to the one-tap banner if the session can't grant silently.
function driveAutoSilent(){ driveRequestSilent('launch'); }

// Banner "نعم" tap. On desktop/safe contexts, try a silent grant first (consent-free
// for returning users) and only escalate to the account picker if the session truly
// needs interaction. On mobile, skip the silent prompt:'' request entirely — in
// practice it can hang on a blank accounts.google.com/gsi/transfer page even when
// fired from a tap, leaving the user stuck with no token and the banner reappearing
// next launch. Use the gesture-backed interactive request instead — it still tends to
// skip the account-chooser for a returning, already-consented user, but always completes.
function driveReconnectFromBanner(){
  if(_driveBannerEscalate){ _driveBannerEscalate = false; driveSignIn(); return; }
  if(_driveSilentSafe()){
    if(!driveRequestSilent('banner')) driveSignIn();
  } else {
    driveReconnectInteractive();
  }
}

function driveSignOut(){
  if(driveAccessToken && typeof google !== 'undefined' && google.accounts){
    try{ google.accounts.oauth2.revoke(driveAccessToken, ()=>{}); }catch(e){}
  }
  clearDriveToken();
  refreshDriveSettingsUI();
  toast(t({ar:'تم تسجيل الخروج من Drive', en:'Signed out of Drive'}));
}

// Plain fetch() has no built-in timeout — a stalled (not failed) connection on a
// flaky mobile network leaves the request neither resolved nor rejected forever,
// which would permanently wedge _driveSyncBusy and leave the indicator stuck on
// "syncing" with no recovery short of a page reload. Abort after timeoutMs so
// every Drive call's try/finally always gets a chance to run.
function driveFetch(url, opts, timeoutMs){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
  return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(() => clearTimeout(timer));
}

// Build an Error for a non-ok Drive response, tagging it with the specific reason
// (e.g. 'storageQuotaExceeded' on a 403, or 429 rate-limiting) when Drive's JSON
// error body provides one, so callers can show a precise message instead of a
// generic "permission denied"/"connection failed" toast. Reading the body is
// best-effort — a malformed/HTML body (Google outage page) must not throw here.
async function _driveErrFromRes(res, prefix){
  let reason = '';
  try{
    const body = await res.clone().json();
    reason = (body && body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason) || '';
  }catch(_){ /* non-JSON body (e.g. HTML error page) — fall back to status only */ }
  return new Error(`${prefix}: ${res.status}${reason ? ' (' + reason + ')' : ''}`);
}

// Shared failure handling for both sync directions (push/pull) so a token expiring
// or being revoked mid-pull gets the exact same detection + user-facing toast as
// it already got mid-push — previously driveSyncFromCloud's catch was silent
// (console.error + a tiny red header icon only), so a 401/403 during a pull left
// the user with no idea their data wasn't actually syncing, and a dead token
// would just keep getting retried forever since it was never cleared.
function _handleDriveSyncError(e){
  console.error(e);
  setDriveIndicator('error');
  if(e.message && e.message.includes('401')){
    clearDriveToken();
    refreshDriveSettingsUI();
    // Do NOT auto-call requestAccessToken here — on mobile Chrome it causes
    // a redirect to gsi/transfer that hangs blank. Instead, guide the user
    // to tap sign-in manually (one tap via the header indicator or settings).
    toast(t({ar:'⚠ انتهت جلسة Drive — اضغط على ☁️ في الأعلى لتسجيل الدخول من جديد', en:'⚠ Drive session expired — tap ☁️ above to sign in again'}), true);
  } else if(e.message && e.message.includes('storageQuotaExceeded')){
    // distinct from a generic 403: the user's actual Drive storage is full,
    // not an app-permission problem — re-auth would not fix this
    toast(t({ar:'⚠ مساحة Google Drive ممتلئة — حرر مساحة لإتمام المزامنة', en:'⚠ Google Drive storage is full — free up space to complete sync'}), true);
  } else if(e.message && e.message.includes('403')){
    toast(t({ar:'⚠ تم رفض الإذن من Drive — تأكد من صلاحيات appdata بالـ Client ID', en:'⚠ Drive permission denied — check the appdata scope on the Client ID'}), true);
  } else if(e.message && e.message.includes('429')){
    // rate-limited — the 1.5s debounce/timer-driven retry already provides
    // natural backoff, so just tell the user honestly instead of implying
    // a connection problem
    toast(t({ar:'⚠ تم تجاوز حد الطلبات إلى Drive مؤقتًا — سيُعاد المحاولة تلقائيًا', en:'⚠ Drive request limit temporarily exceeded — will retry automatically'}), true);
  } else if(e.message && (e.message.includes(' 500') || e.message.includes('503'))){
    toast(t({ar:'⚠ خطأ مؤقت في خوادم Drive — سيُعاد المحاولة تلقائيًا', en:'⚠ Temporary error on Drive servers — will retry automatically'}), true);
  } else if(!navigator.onLine){
    toast(t({ar:'⚠ لا يوجد اتصال بالإنترنت — سيتم الحفظ محليًا فقط', en:'⚠ No internet connection — saving locally only'}), true);
  } else {
    toast(t({ar:'⚠ تعذر الاتصال بـ Drive، سيُعاد المحاولة لاحقًا', en:'⚠ Could not connect to Drive, will retry later'}), true);
  }
}

// Find (or remember) the app data file on Drive. Matches the current filename OR
// the legacy Arabic one, so users who synced before the rename keep their data.
async function driveFindFile(){
  if(driveFileId) return driveFileId;
  const q = `name='${DRIVE_FILE_NAME}' or name='${DRIVE_FILE_NAME_LEGACY}'`;
  const res = await driveFetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=' + encodeURIComponent(q), {
    headers: { 'Authorization': 'Bearer ' + driveAccessToken }
  });
  if(!res.ok) throw new Error('drive list failed: ' + res.status);
  const data = await res.json();
  if(data.files && data.files.length > 0){
    const match = data.files.find(f => f.name === DRIVE_FILE_NAME) || data.files[0];
    driveFileId = match.id;
    if(match.name !== DRIVE_FILE_NAME){
      // migrate the legacy filename quietly; non-fatal if it fails (still works
      // next launch since driveFindFile matches both names)
      try{
        await driveFetch(`https://www.googleapis.com/drive/v3/files/${match.id}`, {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + driveAccessToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: DRIVE_FILE_NAME })
        });
      }catch(_){}
    }
  }
  return driveFileId;
}

// Merge a cloud snapshot into local state in place (union merge — see
// mergeCloudData), persist it, and re-render. Shared by the post-reconnect
// background merge and driveSyncToCloud's pre-push reconciliation below —
// both need the exact same "don't lose either side's edits" behavior, just
// triggered from different moments (sign-in vs. about-to-overwrite-Drive).
async function _mergeCloudIntoLocal(cloud, cloudNewer){
  // Defer the swap while the user has a modal/the add-drawer open, or another
  // mutation is mid-flight — same guards the cross-tab storage listener uses
  // (app.main.js's window 'storage' handler) — so an in-progress edit isn't
  // yanked out from under editingTxId/pendingIncomeTx by the array being
  // replaced mid-flow. _opInFlight also covers windows the DOM checks miss,
  // e.g. addTx's auto-distribution step which keeps _opInFlight raised after
  // the add-drawer has already closed.
  // Capped so a forgotten open modal can't stall sync forever.
  for(let waited=0; waited<10000 && (document.querySelector('.modal-overlay.open') || addDrawerOpen || _opInFlight > 0); waited+=250){
    await new Promise(r => setTimeout(r, 250));
  }
  _opInFlight++;
  try{
    const { added, removed } = mergeCloudData(cloud, cloudNewer);
    await saveBalances(); await saveTx(); await saveConfig(); await saveSubs(); await saveWalletDefs();
    render(true);
    return { added, removed };
  } finally { _opInFlight--; }
}

// Push current local state to Drive (create file if needed)
let _driveSyncBusy = false;
let _driveResyncPending = false; // a change arrived mid-sync — re-sync afterwards
async function driveSyncToCloud(isTrailingPushFromPull){
  if(!driveAccessToken) return false;
  // if a sync is already running, remember that newer changes need flushing
  // afterwards instead of dropping them silently
  if(_driveSyncBusy){ _driveResyncPending = true; return false; }
  // A pull/merge (driveSyncFromCloud) currently running already mutated `state`
  // with another device's changes — an EXTERNAL push starting now would still
  // build its payload from that already-merged state (safe), but the risk is
  // the reverse: this push might have been mid-flight BEFORE the merge started,
  // with its payload already captured from the pre-merge state. Since we can't
  // tell which case we're in from here, defer to the pull's own trailing push
  // (called with isTrailingPushFromPull=true below, which bypasses this check)
  // instead of racing it — the two directions must never write concurrently.
  if(_driveSyncFromCloudBusy && !isTrailingPushFromPull){ _driveResyncPending = true; return false; }
  _driveSyncBusy = true;
  setDriveIndicator('syncing');
  try{
    await driveFindFile();

    if(driveFileId){
      // Nothing pulls from Drive between sign-ins — only this debounced push runs
      // — so if another device is connected at the same time, its push could
      // already be sitting on Drive, newer than what we last saw. Re-pull and
      // union-merge it in first so this push can't silently overwrite it (the
      // same race driveSyncFromCloud's reconnect-time merge guards against, just
      // caught on the push side here instead of only on the pull side). Skipped
      // when remote is already known to match what we last synced, so a burst of
      // local edits doesn't pay for a merge on every debounced push.
      try{
        const checkRes = await driveFetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
          headers: { 'Authorization': 'Bearer ' + driveAccessToken }
        });
        if(checkRes.ok){
          const remote = await checkRes.json();
          const remoteEdited = (typeof remote.dataEditedAt === 'number' && remote.dataEditedAt > 0) ? remote.dataEditedAt : 0;
          if(remoteEdited > 0 && remoteEdited !== _driveLastSyncedEditedAt){
            const localTime = parseInt(localStorage.getItem(LS_PREFIX + 'dataEdit') || '0', 10) || 0;
            await _mergeCloudIntoLocal(remote, remoteEdited > localTime);
          }
        }
      }catch(_){ /* best-effort reconciliation — if the check itself fails, push local state as-is, no worse than before this fix */ }
    }

    // shared with exportData (app.data.js) — see _buildSyncPayload (app.core.js).
    // Drive intentionally does NOT carry theme/accent/lang/quickNotes — those
    // are per-device appearance/language/draft, not financial data to sync.
    const dataEditedAtVal = parseInt(localStorage.getItem(LS_PREFIX + 'dataEdit') || '0', 10) || 0;
    const payload = JSON.stringify(_buildSyncPayload());

    if(driveFileId){
      const res = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + driveAccessToken,
          'Content-Type': 'application/json'
        },
        body: payload
      });
      if(res.status === 404){
        // the cached file was deleted on Drive — forget it and recreate on the
        // follow-up sync that the finally block schedules
        driveFileId = null;
        _driveResyncPending = true;
        throw new Error('drive update failed: 404 (file gone, will recreate)');
      }
      if(!res.ok) throw await _driveErrFromRes(res, 'drive update failed');
    } else {
      const boundary = 'wallet_boundary_' + Date.now();
      const metadata = { name: DRIVE_FILE_NAME, parents: ['appDataFolder'] };
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n` +
        `--${boundary}--`;
      const res = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + driveAccessToken,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body
      });
      if(!res.ok) throw await _driveErrFromRes(res, 'drive create failed');
      const data = await res.json();
      driveFileId = data.id;
    }
    _driveLastSyncedEditedAt = dataEditedAtVal;
    setDriveIndicator('ok');
    return true;
  }catch(e){
    _handleDriveSyncError(e);
    return false;
  } finally {
    _driveSyncBusy = false;
    // flush a change that arrived while this sync was in flight, or recreate a
    // file that Drive reported missing (404) — so no edit is left unsynced
    if(_driveResyncPending){
      _driveResyncPending = false;
      if(driveAccessToken) scheduleDriveSync();
    }
  }
}

// Pull from Drive on sign-in / startup. If cloud has data and local is empty
// (or cloud is newer), merge by replacing local with cloud.
// Replace all local state with a cloud snapshot (single source of truth so the
// import/Drive/conflict paths can't drift apart). Clears balances first so wallets
// omitted from the snapshot don't keep stale values.
async function adoptCloudSnapshot(cloud){
  _opInFlight++; // wholesale state replacement across awaits — block cross-tab reload race
  try{
  // wallet defs first — wholesale snapshot replace, same as applyImport(), so the
  // wallets/transactions validation below (which checks WALLET_DEFS by id) already
  // knows about every wallet the cloud snapshot references.
  // Shared with applyImport (app.data.js) — see _ingestWalletDefs/_ingestWalletBalances
  // (app.core.js). _ingestWalletBalances also closes a gap this call site used to
  // have on its own: a strict shape check on `wallets` instead of a bare truthy one.
  _ingestWalletDefs(cloud);
  _ingestWalletBalances(cloud);
  if(Array.isArray(cloud.transactions)){ // harden against a crafted non-array value
    const _seenIds = new Set();
    // isValidTx is the shared well-formedness rule (app.core.js) — adoption adds
    // only the duplicate-id guard on top, plus the clamping in the map below.
    state.transactions = cloud.transactions.filter(tx =>
      isValidTx(tx) && !_seenIds.has(tx.id) && _seenIds.add(tx.id))
      // same input-side cap as applyImport(), plus the same cent-rounding every
      // other entry point enforces (a cloud copy isn't bound by addTx's rounding)
      .map(tx => ({
        ...tx,
        // same [MIN_TX_TS, now] clamp as applyImport — a cloud copy written by a
        // fast-clock device could otherwise carry future timestamps
        ts: Math.max(MIN_TX_TS, Math.min(tx.ts, Date.now())),
        desc: typeof tx.desc === 'string' && tx.desc.length > 120 ? truncateCodePoints(tx.desc, 120) : tx.desc,
        amount: round2(tx.amount)
      }));
    stripOrphanLinks(state.transactions);
  }
  if(typeof cloud.crisisMode === 'boolean') state.crisisMode = cloud.crisisMode;
  if(typeof cloud.autoDistribute === 'boolean') autoDistribute = cloud.autoDistribute;
  if(cloud.budgets && typeof cloud.budgets === 'object') budgets = sanitizeBudgets(cloud.budgets);
  if(cloud.distribution && Array.isArray(cloud.distribution)) DISTRIBUTION = sanitizeDistribution(cloud.distribution);
  if(Array.isArray(cloud.dismissedRecurring)) dismissedRecurring = new Set(cloud.dismissedRecurring.filter(k => typeof k === 'string' && k));
  if(cloud.deletedTxIds && typeof cloud.deletedTxIds === 'object' && !Array.isArray(cloud.deletedTxIds)){
    deletedTxIds = {};
    for(const id in cloud.deletedTxIds){
      const t = cloud.deletedTxIds[id];
      if(typeof t === 'number' && isFinite(t) && t > 0) deletedTxIds[id] = t;
    }
  }
  // wholesale adopt = take the cloud's tombstone maps too, so a deletion still
  // propagating to other devices isn't forgotten by the device that just adopted
  deletedSubIds = {};
  _unionTombstoneMap(deletedSubIds, cloud.deletedSubIds);
  deletedWalletDefIds = {};
  _unionTombstoneMap(deletedWalletDefIds, cloud.deletedWalletDefIds);
  if(Array.isArray(cloud.subscriptions)){
    subscriptions = cloud.subscriptions.filter(x => x && x.id && x.name && isFinite(x.amount) && x.amount > 0).map(_normalizeSub);
  }
  if(cloud.uiPrefs) applyUiPrefs(cloud.uiPrefs);
  _ensureReserveShare();
  _txMutationStamp++; // adopted a new cloud data set — invalidate derived caches
  prevSpendable = null; // force fresh hero animation after loading a new data set
  await saveBalances(); await saveTx(); await saveConfig(); await saveSubs(); await saveWalletDefs();
  render(true); // force: wallet object is mutated in-place so reference-equality sig check would miss balance changes
  // local now matches this cloud snapshot exactly — record it so the next push's
  // pre-push reconciliation check doesn't immediately re-fetch and re-merge it.
  _driveLastSyncedEditedAt = (typeof cloud.dataEditedAt === 'number' && cloud.dataEditedAt > 0) ? cloud.dataEditedAt : 0;
  } finally {
    _opInFlight--;
  }
}

// isInitial: this is the first pull after (re)connecting.
// interactive: the user explicitly tapped "sign in" — only then do we ever
//   interrupt with the conflict modal. Automatic reconnects on app open resolve
//   silently by timestamp so the user is never nagged on every visit.
// Two independent triggers can call this close together — initDrive()'s launch-time
// pull (still-valid stored token) and the GIS token-refresh callback (silent reconnect
// near expiry). Without a guard, both could run their merge/adoptCloudSnapshot logic
// concurrently and double-apply the same cloud transactions into state.transactions.
let _driveSyncFromCloudBusy = false;
async function driveSyncFromCloud(isInitial, interactive){
  if(!driveAccessToken) return;
  if(_driveSyncFromCloudBusy) return;
  // A push (driveSyncToCloud) already mid-flight captured its payload from
  // `state` BEFORE any merge this pull would apply — proceeding here could
  // merge in another device's changes only for that in-flight push's stale
  // payload to land afterward and silently overwrite them on Drive. Defer;
  // the push's own finally reschedules itself via _driveResyncPending if
  // anything changed meanwhile, and the next natural trigger (reconnect/
  // launch) retries this pull.
  if(_driveSyncBusy) return;
  _driveSyncFromCloudBusy = true;
  // A debounced local push may be armed from a save in the last 1.5s. Cancel it so
  // it can't fire mid-pull and clobber the cloud before we've merged it in.
  clearTimeout(driveSyncTimer); driveSyncTimer = null;
  setDriveIndicator('syncing');
  try{
    await driveFindFile();
    if(!driveFileId){
      // nothing on Drive yet — push current local state up
      await driveSyncToCloud(true);
      return;
    }
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
      headers: { 'Authorization': 'Bearer ' + driveAccessToken }
    });
    if(!res.ok) throw await _driveErrFromRes(res, 'drive download failed');
    const cloud = await res.json();

    const localHasData = state.transactions.length > 0;
    const cloudHasData = (cloud.transactions || []).length > 0;

    if(!(isInitial && cloudHasData)){
      // not an adoption scenario (no cloud data, or a later background pull) —
      // nothing to merge here; the debounced push keeps the cloud current
      setDriveIndicator('ok');
      return;
    }

    if(!localHasData){
      // local is empty — safely adopt the cloud copy
      await adoptCloudSnapshot(cloud);
      setDriveIndicator('ok');
      toast(t({ar:'☁️ تم تحميل بياناتك من Drive', en:'☁️ Your data was loaded from Drive'}));
      return;
    }

    // both sides have data — compare by DATA-edit time (transactions/balances/subs),
    // not lastEdit, so a pref-only tweak (crisis/layout) never overwrites fresher
    // cloud transactions. Fall back to exportedAt/lastEdit for older snapshots.
    const cloudTime = (typeof cloud.dataEditedAt === 'number' && cloud.dataEditedAt > 0)
      ? cloud.dataEditedAt
      : (cloud.exportedAt ? (Date.parse(cloud.exportedAt) || 0) : 0); // || 0 so a malformed ISO string (Date.parse → NaN) doesn't poison the comparison
    const localTime = (parseInt(localStorage.getItem(LS_PREFIX + 'dataEdit') || '0', 10) || 0)
      || (parseInt(localStorage.getItem(LS_PREFIX + 'lastEdit') || '0', 10) || 0);

    if(!interactive){
      // automatic reconnect — never interrupt. Instead of clobbering one side, do a
      // transaction-level UNION merge so nothing added on either device is lost, and
      // honor tombstones from both sides so deletions still propagate (no resurrected
      // rows). Config is taken from whichever side edited last.
      const cloudNewer = cloudTime > localTime;
      const { added, removed } = await _mergeCloudIntoLocal(cloud, cloudNewer);
      await driveSyncToCloud(true); // push the merged result so the cloud converges too
      if(added || removed){
        toast(t({ar:`☁️ تمت المزامنة — ${added ? `أُضيف ${added} ` : ''}${removed ? `حُذف ${removed} ` : ''}من جهاز آخر`, en:`☁️ Synced — ${added ? `${added} added ` : ''}${removed ? `${removed} deleted ` : ''}from another device`}));
      }
      setDriveIndicator('ok');
      return;
    }

    // interactive sign-in with genuine data on both sides — let the user choose,
    // showing each copy's size + timestamp so the decision is informed
    _pendingDriveCloud = cloud;
    // Manual digit formatting (not toLocaleString) — this choice drives a
    // destructive "keep cloud vs keep local" decision, so it must render
    // identically across platforms regardless of ICU bidi quirks.
    const fmtWhen = ms => {
      if(!ms || !isFinite(ms)) return t({ar:'غير معروف', en:'Unknown'});
      const d = new Date(ms);
      return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    };
    const cloudCount = (cloud.transactions || []).length;
    const localCount = state.transactions.length;
    const newer = cloudTime > localTime ? 'cloud' : (localTime > cloudTime ? 'local' : '');
    const tag = side => newer === side ? ` <b style="color:var(--green)">(${t({ar:'الأحدث', en:'newer'})})</b>` : '';
    const opCount = n => t({ar:arPlural(n, 'عملية', 'عمليتين', 'عمليات'), en:`${n} ${n===1?'operation':'operations'}`});
    const info = document.getElementById('conflictInfo');
    if(info) info.innerHTML =
      `☁️ <b>Drive</b>: ${opCount(cloudCount)} · ${escHtml(fmtWhen(cloudTime))}${tag('cloud')}<br>` +
      `📱 <b>${t({ar:'المحلية', en:'Local'})}</b>: ${opCount(localCount)} · ${escHtml(fmtWhen(localTime))}${tag('local')}`;
    openModal('driveConflictModal');
  }catch(e){
    _handleDriveSyncError(e);
  } finally {
    _driveSyncFromCloudBusy = false;
  }
}

async function resolveConflict(useCloud){
  // Adopting the cloud copy permanently overwrites whatever's on this device —
  // unlike every other destructive action in the app (delete tx, wipe data),
  // this one had no confirm step, so a stale/wrong Drive snapshot could wipe
  // out newer local data with a single tap.
  if(useCloud && !confirm(t({ar:'سيتم استبدال كل بيانات هذا الجهاز بنسخة Drive نهائياً. متابعة؟', en:"This will permanently replace all of this device's data with the Drive version. Continue?"}))) return;
  // Claim the pending cloud snapshot BEFORE closing the modal: closeModal() has a
  // dismissal guard that fires when driveConflictModal is closed via Escape/back
  // with _pendingDriveCloud still set (a genuine cancel). Nulling it here first
  // tells that guard "already resolved" so it doesn't mistake this for a cancel.
  const cloud = _pendingDriveCloud;
  _pendingDriveCloud = null;
  closeModal('driveConflictModal');
  if(!cloud) return;
  if(useCloud){
    await adoptCloudSnapshot(cloud);
    toast(t({ar:'☁️ تم استخدام نسخة Drive', en:'☁️ Used the Drive version'}));
  } else {
    // The user explicitly rejected the cloud copy — mark it as "already seen"
    // BEFORE pushing, or driveSyncToCloud()'s pre-push reconciliation
    // (remoteEdited !== _driveLastSyncedEditedAt) union-merges the rejected
    // cloud transactions back into local and uploads a hybrid instead of the
    // "local version" the modal promised.
    _driveLastSyncedEditedAt = (typeof cloud.dataEditedAt === 'number' && cloud.dataEditedAt > 0) ? cloud.dataEditedAt : 0;
    await driveSyncToCloud();
    toast(t({ar:'☁️ تم رفع نسختك المحلية إلى Drive', en:'☁️ Uploaded your local version to Drive'}));
  }
}

let _driveManualSyncBusy = false;
function driveManualSync(){
  // busy-guard + in-place button feedback: the header sync badge is hidden
  // behind the settings modal's backdrop, so without this the button looks
  // dead for the whole upload and invites double-taps that queue duplicates.
  if(_driveManualSyncBusy) return;
  _driveManualSyncBusy = true;
  const btn = document.getElementById('btnDriveSyncNow');
  _setBtnSaving(btn, true, t({ar:'⏳ يزامن...', en:'⏳ Syncing...'}));
  // only toast success when the upload actually succeeded — driveSyncToCloud
  // catches its own errors (and toasts them), returning false on failure/queue
  driveSyncToCloud().then(ok => { if(ok) toast(t({ar:'✓ تمت المزامنة مع Drive', en:'✓ Synced with Drive'})); })
    .finally(() => { _driveManualSyncBusy = false; _setBtnSaving(btn, false); });
}

// Debounced auto-sync: called after every local save
function scheduleDriveSync(){
  if(!driveAccessToken) return;
  clearTimeout(driveSyncTimer);
  driveSyncTimer = setTimeout(()=> { if(driveAccessToken) driveSyncToCloud(); }, 1500);
}

function initDrive(){
  loadDriveConfig();
  // Restore the previously stored access token. Check localStorage first, then
  // cookies as fallback — some browsers wipe localStorage when force-closed from
  // the recent-apps list while cookies may survive (or vice-versa).
  let _savedTokenExp = 0; // captured before clearDriveToken() so tryInit can use it
  try{
    // Primary: sessionStorage (token cleared when browser closes — limits theft window).
    // Fallback: path-scoped session cookie (cross-tab within same browser session).
    // Legacy cleanup: erase any token left in localStorage by pre-v47.63 builds.
    try{
      localStorage.removeItem(LS_PREFIX + 'driveToken');
      localStorage.removeItem(LS_PREFIX + 'driveTokenExp');
    }catch(_){}
    let tok = sessionStorage.getItem(LS_PREFIX + 'driveToken');
    let exp = parseInt(sessionStorage.getItem(LS_PREFIX + 'driveTokenExp') || '0', 10) || 0;
    // If sessionStorage is empty (new tab, or cleared), try the session cookie
    if(!tok || Date.now() >= exp){
      const ctok = _getDriveCookie('mhfzty_dtok');
      const cexp = parseInt(_getDriveCookie('mhfzty_dexp') || '0', 10) || 0;
      if(ctok && Date.now() < cexp){ tok = ctok; exp = cexp; }
    }
    _savedTokenExp = exp; // capture now, BEFORE clearDriveToken removes the keys
    if(tok && Date.now() < exp){ driveAccessToken = tok; driveTokenExpiry = exp; }
    else if(tok || exp){ clearDriveToken(); } // stale — drop all storage locations
    // If we restored a live token, re-arm the proactive refresh timer
    if(driveTokenValid()) _scheduleTokenRefresh();
  }catch(e){}
  refreshDriveSettingsUI();
  if(driveClientId){
    let _gisRetries = 0;
    const tryInit = () => {
      if(typeof google !== 'undefined' && google.accounts){
        initGisClient();
        if(driveTokenValid()){
          // still have a live token — pull quietly (auto-resolve, no modal)
          driveSyncFromCloud(true, false);
        } else {
          // disconnected — reconnect. maybePromptDriveConnect() decides how:
          // desktop auto-sign-in users reconnect SILENTLY (prompt:'' — no UI, no
          // re-consent); mobile/embedded users get a one-tap banner (whose tap drives
          // a gesture-backed interactive request instead, see driveReconnectInteractive()).
          // A gesture-free silent call is only used in safe desktop contexts, since on
          // mobile it can redirect to gsi/transfer and hang on a blank page.
          maybePromptDriveConnect();
        }
      } else if(_gisRetries++ < 25){ // ~7.5s max wait
        setTimeout(tryInit, 300);
      } else {
        setDriveIndicator('error');
        console.warn('GIS script failed to load — Drive sync disabled');
      }
    };
    tryInit();
  }
}
