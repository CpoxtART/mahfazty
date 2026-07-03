/* ============================================================
   MODALS, BACK-BUTTON HISTORY, FOCUS TRAP
   Split out of app.logic.js. Owns openModal/closeModal, the overlay history
   bookkeeping that makes hardware/gesture back close a modal instead of
   exiting the app, the Tab focus trap, and the drag-to-close grabber wiring.
   Loaded AFTER app.ui.js: one top-level statement here (_wireGrabber(...,
   closeAddDrawer)) references app.ui.js's closeAddDrawer directly, not
   through a lazy closure, so app.ui.js's <script> must already have run.
============================================================ */
let _overlayHistDepth = 0;    // how many of OUR entries are currently on the history stack
let _inPopstateClose = false; // true while popstate's own close is unwinding (skip history.back())
// Count (not a single boolean) of our own bookkeeping history.back() calls still
// awaiting their popstate event. A boolean would mis-fire if two overlays are
// closed in quick succession (e.g. back-button mashed on stacked modals): the
// second _popOverlayHistory() call would re-arm the flag before the first
// back()'s popstate had fired, so the first popstate consumes the flag and the
// second popstate — which is ALSO ours — would be wrongly treated as a real
// user navigation and close the parent overlay underneath.
let _suppressPopstateCloseCount = 0;
// When true, the next _pushOverlayHistory() call will REPLACE the current history
// entry (replaceState) instead of pushing a new one. Used by addTx() when it needs
// to atomically swap the add-drawer's history entry for the distribution modal's
// entry, avoiding the history.back()+pushState() race that would otherwise consume
// the modal entry and later navigate the user completely off the page.
let _nextPushOverlayReplaces = false;
function _pushOverlayHistory(){
  if(_nextPushOverlayReplaces){
    _nextPushOverlayReplaces = false;
    // Replace mode: swap the current overlay entry for the new modal's entry.
    // _overlayHistDepth stays the same — we're replacing, not adding.
    history.replaceState({ _mahfaztyOverlay: true, depth: _overlayHistDepth }, '');
  } else {
    _overlayHistDepth++;
    history.pushState({ _mahfaztyOverlay: true, depth: _overlayHistDepth }, '');
  }
}
function _popOverlayHistory(){
  if(_overlayHistDepth <= 0) return;
  _overlayHistDepth--;
  if(_inPopstateClose) return; // popstate already moved history back for us
  // This back() only consumes the entry the just-closed overlay pushed — it must
  // NOT be treated as a user "back" that closes the NEXT overlay down. Without
  // this counter, closing a modal stacked on another (e.g. the wallet add/edit modal
  // over Settings) would collapse BOTH instead of returning to the parent.
  _suppressPopstateCloseCount++;
  history.back();
}
// Single source of truth for "what does back/Escape close right now", reused by
// both the keydown handler and popstate so the priority order (dropdown → add
// drawer → topmost modal) only lives in one place.
function _closeTopmostOverlay(){
  const dropdowns = [
    ['walletMenuWrap','walletSelectBtn'],
    ['editWalletMenuWrap','editWalletBtn'],
    ['transferFromMenuWrap','transferFromBtn'],
    ['transferToMenuWrap','transferToBtn'],
  ];
  let closedDropdown = false;
  dropdowns.forEach(([wrapId, btnId])=>{
    const wrap = document.getElementById(wrapId);
    if(wrap && wrap.classList.contains('open')){
      wrap.classList.remove('open');
      const btn = document.getElementById(btnId);
      if(btn){ btn.classList.remove('open'); btn.setAttribute('aria-expanded','false'); btn.focus({preventScroll:true}); }
      closedDropdown = true;
    }
  });
  if(closedDropdown) return true;
  // Drive reconnect banner carries role="dialog" but uses a CSS class (.show) rather
  // than .modal-overlay.open — it needs its own Escape check.
  const dBanner = document.getElementById('driveBanner');
  if(dBanner && dBanner.classList.contains('show')){
    if(typeof hideDriveBanner === 'function') hideDriveBanner();
    return true;
  }
  // Modals (z-index 1000) always paint ABOVE the add drawer (900) — e.g. the
  // daily-review or Drive-conflict modal can open over an open drawer — so the
  // visible-topmost overlay to close is a modal first, then the drawer.
  const open = [...document.querySelectorAll('.modal-overlay.open')];
  if(open.length){
    closeModal(open[open.length-1].id);
    return true;
  }
  if(addDrawerOpen){
    closeAddDrawer();
    return true;
  }
  return false;
}
// Dropdowns (custom <select>s) don't push history entries — they're a transient
// in-page widget, not a "screen" — so popstate only needs to care about the add
// drawer and modals, both of which already go through _pushOverlayHistory().
window.addEventListener('popstate', () => {
  // Our own _popOverlayHistory() back() just fired this — the entry is already
  // accounted for; don't also close the parent overlay underneath.
  if(_suppressPopstateCloseCount > 0){ _suppressPopstateCloseCount--; return; }
  if(_overlayHistDepth <= 0) return; // a real navigation, not one of our entries — let it proceed
  _inPopstateClose = true;
  try{
    // modals paint above the drawer — close the visible one first (same
    // ordering as _closeTopmostOverlay; see the comment there)
    const open = [...document.querySelectorAll('.modal-overlay.open')];
    if(open.length){
      closeModal(open[open.length-1].id);
    } else if(addDrawerOpen){
      closeAddDrawer();
    } else {
      _overlayHistDepth = 0; // safety net: nothing open but we thought we had depth — resync
    }
  } finally {
    _inPopstateClose = false;
  }
});

/* ============================================================
   MODALS
============================================================ */
// Stack (not a single var) so nested modals restore focus to the correct opener:
// e.g. wallet card → wallet detail → edit tx. A single variable would lose the
// outer modal's opener when the inner modal overwrote it.
const _focusStack = [];
// Background landmarks to hide from screen readers while any modal/drawer is
// open — without this, a screen-reader user swiping through the page can still
// land on (and hear) the tab content sitting behind an open overlay, since
// CSS-only overlays don't remove the background from the accessibility tree.
const _bgLandmarks = () => document.querySelectorAll('body > header, body > .tab-panel, body > nav.bottom-nav');
function _anyOverlayOpen(){
  return addDrawerOpen || !!document.querySelector('.modal-overlay.open');
}
function _setBackgroundHidden(hidden){
  _bgLandmarks().forEach(el => {
    if(hidden) el.setAttribute('aria-hidden', 'true');
    else el.removeAttribute('aria-hidden');
  });
}
// Tab/Shift+Tab focus trap scoped to the topmost open modal or the add-drawer —
// without this, tabbing past the last focusable element in a dialog leaks focus
// into the (visually hidden but still-tabbable) page behind it.
function _activeOverlayEl(){
  const modals = document.querySelectorAll('.modal-overlay.open');
  if(modals.length) return modals[modals.length - 1];
  if(addDrawerOpen) return document.getElementById('addDrawer');
  return null;
}
document.addEventListener('keydown', e => {
  if(e.key !== 'Tab') return;
  const overlay = _activeOverlayEl();
  if(!overlay) return;
  const focusables = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if(!focusables.length) return;
  const list = Array.from(focusables).filter(el => !el.disabled && el.offsetParent !== null);
  if(!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if(e.shiftKey && document.activeElement === first){
    e.preventDefault(); last.focus();
  }else if(!e.shiftKey && document.activeElement === last){
    e.preventDefault(); first.focus();
  }else if(!overlay.contains(document.activeElement)){
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
});
function openModal(id){
  const modal = document.getElementById(id);
  if(!modal) return;
  // remember what had focus so we can restore it when the modal closes (a11y) —
  // but only on the FIRST open. Re-opening an already-open modal (e.g. wallet
  // detail refreshing itself after a tracked-balance edit) must NOT push a
  // duplicate, or it would bury the real opener and break focus return.
  const wasClosed = modal && !modal.classList.contains('open');
  if(wasClosed) _focusStack.push(document.activeElement);
  // Push one history entry per modal/drawer opened so the hardware/gesture BACK
  // button closes the topmost overlay instead of navigating away or exiting the
  // PWA. _histDepth tracks how many of OUR entries are stacked so popstate can
  // tell "user pressed back with an overlay open" apart from a real navigation.
  if(wasClosed) _pushOverlayHistory();
  // give the dialog an accessible name from its heading (so SR doesn't announce an
  // unnamed dialog) — done here once instead of hand-wiring aria-labelledby on all 11
  if(!modal.hasAttribute('aria-label') && !modal.hasAttribute('aria-labelledby')){
    const h = modal.querySelector('h3');
    if(h){
      if(!h.id) h.id = id + '_title';
      modal.setAttribute('aria-labelledby', h.id);
    }
  }
  modal.classList.add('open');
  // Re-append so DOM order matches OPEN order. All overlays share z-index:1000,
  // so among open ones the later-in-DOM paints on top — without this, opening
  // the edit modal from inside the wallet-detail modal (whose markup sits later
  // in index.html) put the edit sheet INVISIBLY BEHIND it, and the focus traps
  // + Escape/back handlers (all of which take the LAST open overlay in DOM
  // order as "topmost") targeted the wrong dialog.
  if(wasClosed) document.body.appendChild(modal);
  // blur the trigger BEFORE hiding its ancestor from the a11y tree — aria-hidden
  // on an element that still holds focus is an ARIA violation (and Chrome logs a
  // warning for it); the real focus-in-modal happens a frame later below.
  if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
  _setBackgroundHidden(true);
  // lock background scroll so the page behind the sheet doesn't move while a
  // modal (and the on-screen keyboard) is open on mobile
  lockBodyScroll();
  if(id==='settingsModal'){
    if(typeof _distDraft !== 'undefined') _distDraft = null; // fresh draft each time settings opens
    updateSettingsStats();
    document.getElementById('driveClientId').value = driveClientId;
    refreshDriveSettingsUI();
    renderDistributionEditor();
    renderLayoutEditor();
    renderAccentSwatches();
    _updateLangUI(_currentLang());
    renderWalletDefsEditor();
    const _ja = document.getElementById('jsonArea'); if(_ja) _ja.value = ''; // fresh scratch area each open (import/export now lives in the data tab)
    switchSettingsTab(_settingsTab); // sync panels/strip to the requested tab
  }
  // move focus into the modal so keyboard/screen-reader users land in context.
  // target a button (not a text input) so the mobile keyboard doesn't pop open.
  requestAnimationFrame(()=>{
    const focusable = modal.querySelector('button, [tabindex]');
    if(focusable) try{ focusable.focus({preventScroll:true}); }catch(_){}
  });
}
function closeModal(id){
  const modal = document.getElementById(id);
  if(!modal) return;
  const wasOpen = modal.classList.contains('open');
  modal.classList.remove('open');
  // restore background scroll/aria-hidden only once no modal/drawer remains open
  if(!_anyOverlayOpen()){ unlockBodyScroll(); _setBackgroundHidden(false); }
  if(id === 'editModal'){
    editingTxId = null; editCategory = 'other'; editType = 'expense'; editWallet = WALLET_DEFS[0].id;
    _editingDistSource = false; _editingTransferLeg = false; // reset so the next openEdit() starts clean
    // ensure wallet dropdown is fully closed so stale 'open' state can't persist across edits
    const ewWrap = document.getElementById('editWalletMenuWrap');
    const ewBtn  = document.getElementById('editWalletBtn');
    if(ewWrap) ewWrap.classList.remove('open');
    if(ewBtn){ ewBtn.classList.remove('open'); ewBtn.setAttribute('aria-expanded','false'); ewBtn.tabIndex = 0; ewBtn.removeAttribute('aria-disabled'); }
  }
  if(id === 'distributeModal') pendingIncomeTx = null;
  // driveConflictModal dismissed via Escape/back/backdrop WITHOUT a choice —
  // resolveConflict() nulls _pendingDriveCloud before it closes the modal, so a
  // still-set _pendingDriveCloud here means a genuine cancel. Drop the pending
  // cloud snapshot and clear the otherwise-frozen 'syncing' indicator (it would
  // never reach 'ok'/'error' on its own), keeping local data untouched. The next
  // local save re-arms a normal sync.
  if(id === 'driveConflictModal' && typeof _pendingDriveCloud !== 'undefined' && _pendingDriveCloud){
    _pendingDriveCloud = null;
    if(typeof setDriveIndicator === 'function') setDriveIndicator(driveAccessToken ? 'idle' : 'off');
  }
  if(id === 'settingsModal' && typeof _distDraft !== 'undefined') _distDraft = null; // discard unsaved dist edits
  if(id === 'walletDetailModal') detailWalletId = null;
  if(id === 'subModal') editingSubId = null;
  if(id === 'transferModal'){
    // Same stale-dropdown risk as editModal above: closing via the back button
    // (no click event) bypasses the click-outside handler that normally closes
    // these, so a left-open 'from'/'to' wallet dropdown would still show
    // expanded the next time the modal opens.
    ['transferFromMenuWrap','transferToMenuWrap'].forEach(wid => {
      const w = document.getElementById(wid);
      if(w) w.classList.remove('open');
    });
    ['transferFromBtn','transferToBtn'].forEach(bid => {
      const b = document.getElementById(bid);
      if(b){ b.classList.remove('open'); b.setAttribute('aria-expanded','false'); }
    });
  }
  // Only restore focus and pop overlay history when the modal was actually open —
  // calling closeModal() on an already-closed modal must not pop a focus entry that
  // belongs to a DIFFERENT modal currently open (corrupts multi-modal focus chain).
  if(wasOpen){
    const _retFocus = _focusStack.pop();
    if(_retFocus && typeof _retFocus.focus === 'function'){
      try{ _retFocus.focus({preventScroll:true}); }catch(_){}
    }
    // Same atomic-swap escape hatch as closeAddDrawer(): when this close is
    // immediately followed by another openModal()/openAddDrawer() call (e.g. the
    // add-drawer's "transfer between wallets" button closing the drawer and opening
    // transferModal in the same click), calling history.back() here races with the
    // next open's pushState — back() is queued async, pushState() runs synchronously
    // before it resolves, so the queued back() ends up consuming the WRONG entry
    // (one past the one it was meant to undo). That silently eats a history slot,
    // and the next ordinary close() (e.g. tapping "إلغاء" in transferModal) then
    // calls history.back() one entry too far — straight past the app's root entry
    // and out of the page entirely. Skipping the pop here and letting the next
    // open's _pushOverlayHistory() replaceState() instead keeps depth/entries in
    // sync. (Reproduced via Playwright: without this guard, cancelling the transfer
    // modal navigated the tab to about:blank.)
    if(!_nextPushOverlayReplaces) _popOverlayHistory();
  }
}
// Modals that hold unsaved form input must NOT close on an accidental
// backdrop tap (common on mobile) — only their explicit buttons close them.
const _protectedModals = new Set(['editModal','transferModal','distributeModal','walletDetailModal','quickNotesModal',
  // driveConflictModal has no cancel path — the user MUST pick a side via
  // resolveConflict(); a backdrop tap dismissing it silently would leave the
  // conflict unresolved with no indication the sync never completed.
  'driveConflictModal',
  // welcomeModal's real close path is closeWelcome(), which also stamps the
  // welcomeSeen flag — a backdrop tap bypassing that re-triggers full onboarding
  // on the next visit.
  'welcomeModal']);
document.querySelectorAll('.modal-overlay').forEach(ov=>{
  ov.addEventListener('click', e=>{ if(e.target===ov && !_protectedModals.has(ov.id)) closeModal(ov.id); });
});

// The bottom-sheet "grabber" handle on every modal looked draggable but had no
// backing gesture — a purely decorative affordance that suggests a swipe-down-
// to-dismiss that didn't exist. Wire it up for real (protected modals excluded,
// same as the backdrop-tap guard above).
function _wireGrabber(handle, sheet, isBlocked, doClose){
  if(!handle || !sheet) return;
  let startY = 0, dy = 0, dragging = false;
  handle.addEventListener('touchstart', e=>{
    if(isBlocked()) return;
    startY = e.touches[0].clientY; dy = 0; dragging = true;
    sheet.style.transition = 'none';
  }, {passive:true});
  handle.addEventListener('touchmove', e=>{
    if(!dragging) return;
    dy = Math.max(0, e.touches[0].clientY - startY); // only allow dragging downward
    sheet.style.transform = `translateY(${dy}px)`;
  }, {passive:true});
  const finish = () => {
    if(!dragging) return;
    dragging = false;
    if(dy > 80){
      sheet.style.transition = '';
      doClose();
    } else {
      // Re-enable CSS transition BEFORE clearing transform so the snap-back
      // animates. Setting transition='' and transform='' in the same frame
      // lets the browser batch them and skip the animation (no transition to
      // interpolate from). The rAF ensures the paint cycle sees the transition
      // restored first, then applies the transform reset in the next frame.
      sheet.style.transition = '';
      requestAnimationFrame(() => { sheet.style.transform = ''; });
    }
  };
  handle.addEventListener('touchend', finish);
  handle.addEventListener('touchcancel', finish);
}
document.querySelectorAll('.modal-overlay .grabber').forEach(handle=>{
  const overlay = handle.closest('.modal-overlay');
  const sheet = handle.closest('.modal');
  _wireGrabber(handle, sheet, () => _protectedModals.has(overlay && overlay.id), () => closeModal(overlay.id));
});
// The add-transaction drawer isn't a .modal-overlay/.modal (it's the app's own
// add-drawer/add-drawer-overlay pair with its own close function), so the
// selector above never matched its grabber — same decorative-but-dead handle
// bug, just missed because this is the one dialog that isn't a generic modal.
_wireGrabber(document.querySelector('#addDrawer .grabber'), document.getElementById('addDrawer'), () => false, closeAddDrawer);

// Close custom dropdowns when clicking outside
document.addEventListener('click', function(e){
  [
    ['walletSelectBtn',  'walletMenuWrap'],
    ['editWalletBtn',    'editWalletMenuWrap'],
    ['transferFromBtn',  'transferFromMenuWrap'],
    ['transferToBtn',    'transferToMenuWrap'],
  ].forEach(([btnId, wrapId])=>{
    const btn  = document.getElementById(btnId);
    const wrap = document.getElementById(wrapId);
    if(btn && wrap && !btn.contains(e.target) && !wrap.contains(e.target)){
      wrap.classList.remove('open');
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded','false');
    }
  });
});

// memoize the earliest-tx scan (O(n)) so re-opening settings doesn't re-scan
// thousands of transactions; keyed by _txMutationStamp so it auto-invalidates
// on any add/edit/delete.
let _firstTxStamp = -1, _firstTxMs = null;
// .sett-stat-v is forced direction:ltr, but ICU's ar-EG numeric date/time
// formatting embeds bidi control chars (and on some platforms, e.g. Android
// Chrome, a different digit/separator order entirely) meant for RTL text —
// fighting the forced LTR direction and visibly scrambling the digits.
// Build the strings from plain digits instead of relying on locale
// formatting at all, sidestepping ICU's platform-specific bidi quirks.
const pad2 = n => String(n).padStart(2, '0');
function fmtStatDate(ms){
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth()+1}/${pad2(d.getFullYear() % 100)}`;
}
function fmtStatDateTime(ms){
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth()+1} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function updateSettingsStats(){
  // Thousands-grouped via a plain regex instead of toLocaleString — same
  // ICU-bidi-fragility reasoning as fmtStatDate/fmtStatDateTime above.
  document.getElementById('statTxCount').textContent = String(state.transactions.length).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if(_firstTxStamp !== _txMutationStamp){
    _firstTxStamp = _txMutationStamp;
    _firstTxMs = state.transactions.length
      ? state.transactions.reduce((min,t)=> t.ts<min ? t.ts : min, state.transactions[0].ts)
      : null;
  }
  document.getElementById('statFirstTx').textContent = _firstTxMs !== null
    ? fmtStatDate(_firstTxMs)
    : '—';
  try{
    const last = localStorage.getItem(LS_PREFIX + 'lastEdit');
    document.getElementById('statLastEdit').textContent = last
      ? fmtStatDateTime(parseInt(last))
      : '—';
  }catch(e){
    document.getElementById('statLastEdit').textContent = '—';
  }
  // Show active cache version
  const cacheEl = document.getElementById('statCacheVer');
  if(cacheEl){
    caches.keys().then(keys => {
      cacheEl.textContent = keys.length ? keys.join(', ') : t({ar:'لا يوجد كاش', en:'No cache'});
    }).catch(()=>{ cacheEl.textContent = '—'; });
  }
}
