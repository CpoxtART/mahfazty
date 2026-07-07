/* ============================================================
   APP MAIN — boot sequence, event binding, render dispatcher, toast
============================================================ */
// Boots the app (loadState + initial renders), wires every DOM event listener
// (_bindEvents), owns the render()/computeRenderSig() dispatcher and the
// toast() system, and runs the app-lifecycle listeners (visibility/online/
// offline/pagehide/storage-sync/midnight-refresh/unhandledrejection/pageshow).
// Loads last: everything here only runs at boot or on user/browser events,
// long after every earlier file has finished parsing and defining its
// functions, so it may freely call into any of them.

/* ============================================================
   TOAST
============================================================ */
// Saves run optimistically: state/render/the success toast all happen before
// the background IndexedDB write (idbBackup, called un-awaited from
// saveTx/saveBalances/etc) actually confirms. If that write later fails, the
// "could not persist" warning below fires asynchronously, well after a routine
// toast — possibly several routine toasts (e.g. addTx's own success toast,
// then a second toast from the auto-distribution flow) — already started/ended
// their own short timers on the SAME #saveStatus element. Without _criticalToastUntil,
// any of those routine toast() calls would silently overwrite the warning's text
// before the user ever reads it. While a critical toast's window is active, routine
// toast()/toastWithAction() calls are queued and replayed once it expires instead
// of clobbering it.
let _criticalToastUntil = 0;
let _queuedToast = null; // {fn, args} of the most recent routine toast deferred during a critical window
function _runQueuedToastIfAny(){
  if(_queuedToast && Date.now() >= _criticalToastUntil){
    const q = _queuedToast; _queuedToast = null;
    q.fn(...q.args);
  }
}
// Tracks whichever action-toast (delete/edit undo) is CURRENTLY on screen, so
// a second, different action-toast that's about to replace it can chain back
// to it afterward instead of silently discarding it — see toastWithAction's
// supersede handling below. deleteTx already merges repeated DELETES into one
// combined undo via _lastDeleted; this covers the general cross-type case
// (edit then edit, edit then delete, delete then edit, all within a few
// seconds of each other).
let _pendingAction = null; // {label, actionLabel, fn, ariaLabel, expiresAt}
let _supersededAction = null; // one level of "the action this just replaced"
function toast(msg, isError){
  if(Date.now() < _criticalToastUntil){ _queuedToast = {fn: toast, args:[msg, isError]}; return; }
  // A pending delete/edit undo is still live and displayed (or, per the
  // _lastDeleted comment history, still validly armed) — overwriting the
  // element here would silently kill the only on-screen way to invoke it,
  // even though the code just below proves it's still meant to be valid.
  // Queue this routine message instead: it plays once the action-toast's own
  // timeout naturally dismisses (toastWithAction's dismiss+_runQueuedToastIfAny)
  // or the user taps its button, rather than clobbering it immediately.
  if(_lastDeleted || (_pendingAction && _pendingAction.expiresAt > Date.now())){
    if(_lastDeleted){
      clearTimeout(_undoTimer);
      _undoTimer = setTimeout(()=>{ _lastDeleted = null; }, 5000);
    }
    _queuedToast = {fn: toast, args:[msg, isError]};
    return;
  }
  const el = document.getElementById('saveStatus');
  // Errors must interrupt a screen reader (assertive); routine confirmations
  // stay polite so they don't talk over the user. Explicit aria-live overrides
  // the element's implicit role="status" politeness.
  el.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  el.textContent = msg;
  el.style.borderColor = isError ? 'var(--red)' : 'var(--line)';
  el.style.color = isError ? 'var(--red)' : 'var(--text)';
  el.classList.add('show');
  clearTimeout(window._saveTimeout);
  // Longer messages (e.g. voice-transcript confirmations) need more than 2.2s to
  // read — scale with length instead of using one flat duration for everything.
  const duration = Math.min(5000, Math.max(2200, msg.length * 60));
  window._saveTimeout = setTimeout(()=> { el.classList.remove('show'); _runQueuedToastIfAny(); }, duration);
}

function toastWithUndo(msg, undoFn){
  toastWithAction(msg, t({ar:'تراجع ↩️', en:'Undo ↩️'}), undoFn, false, t({ar:'تراجع عن الحذف', en:'Undo deletion'}));
}
// critical=true marks a severe, rare warning (e.g. local persistence totally failed)
// that must not be silently overwritten by/lost a race with a routine toast that
// fires moments later from an in-flight optimistic save flow — see _criticalToastUntil.
// _isReplay is internal-only (set when re-showing a superseded action) — skips
// re-stashing it as its own superseded entry.
function toastWithAction(msg, actionLabel, fn, critical, btnAriaLabel, _isReplay){
  if(!critical && Date.now() < _criticalToastUntil){ _queuedToast = {fn: toastWithAction, args:[msg, actionLabel, fn, critical, btnAriaLabel]}; return; }
  // A DIFFERENT, still-unresolved action-toast is about to be replaced by this
  // one (e.g. editing transaction A, then editing/deleting transaction B
  // before A's undo was tapped or timed out) — stash it so tapping (or
  // naturally timing out) THIS new toast can chain back to offering A's undo
  // next, instead of it silently vanishing the instant this toast appears.
  // One level deep only (bounded scope: a rapid streak of 3+ only preserves
  // the immediately-previous one, not a full history).
  if(!critical && !_isReplay && _pendingAction && _pendingAction.expiresAt > Date.now()){
    _supersededAction = _pendingAction;
  }
  const el = document.getElementById('saveStatus');
  // critical warnings (e.g. data-loss) interrupt the screen reader; routine
  // action toasts (undo) stay polite. See the matching note in toast().
  el.setAttribute('aria-live', critical ? 'assertive' : 'polite');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  const btn = document.createElement('button');
  btn.textContent = actionLabel;
  // Provide an explicit emoji-free aria-label so the announcement is unambiguous
  // across screen readers (emoji verbalization varies by AT/platform).
  if(btnAriaLabel) btn.setAttribute('aria-label', btnAriaLabel);
  btn.style.cssText = 'background:var(--gold-btn); color:var(--on-gold); border:none; border-radius:var(--radius-pill); padding:5px 13px; font-size:var(--fs-sm); font-weight:700; margin-inline-end:8px; cursor:pointer;';
  // #saveStatus.show only toggles opacity/transform (no display:none), so the
  // button stays genuinely focusable-but-invisible after dismissal unless we
  // remove it from the DOM here — otherwise a keyboard/AT user tabbing past it
  // lands on an orphaned, silent focus target with no visible affordance.
  const dismiss = () => {
    if(el.contains(document.activeElement)) document.activeElement.blur();
    el.classList.remove('show');
    el.innerHTML = '';
  };
  // After resolving (tapped OR naturally timed out), offer any action this
  // one superseded — a rapid edit/delete streak can still be walked back one
  // tap at a time instead of every-but-the-last one silently disappearing.
  // Returns true if it displayed something, so the natural-timeout path below
  // can skip _runQueuedToastIfAny() rather than immediately overwriting this
  // higher-priority (time-sensitive) undo offer with a routine queued message.
  const _offerSuperseded = () => {
    if(!critical && _pendingAction === thisAction) _pendingAction = null;
    if(_supersededAction && _supersededAction.expiresAt > Date.now()){
      const prev = _supersededAction; _supersededAction = null;
      toastWithAction(prev.label, prev.actionLabel, prev.fn, false, prev.ariaLabel, true);
      return true;
    }
    return false;
  };
  btn.onclick = () => { dismiss(); fn(); _offerSuperseded(); };
  el.appendChild(span);
  el.appendChild(btn);
  el.style.borderColor = 'var(--line)';
  el.style.color = 'var(--text)';
  el.classList.add('show');
  clearTimeout(window._saveTimeout);
  const dur = critical ? 7000 : 5000;
  if(critical) _criticalToastUntil = Date.now() + dur;
  const thisAction = critical ? null : { label: msg, actionLabel, fn, ariaLabel: btnAriaLabel, expiresAt: Date.now() + dur };
  if(!critical) _pendingAction = thisAction;
  window._saveTimeout = setTimeout(()=> { dismiss(); if(!_offerSuperseded()) _runQueuedToastIfAny(); }, dur);
}

/* Cheap signature of everything that affects visual output.
   Used to skip expensive re-renders when nothing changed. */
let _renderSig = '';
// budgets and DISTRIBUTION get new object references when changed, so reference
// equality is a valid cheap check. state.wallets is ALWAYS the same reference
// (mutated in-place), so it must be JSON-serialised fresh every call — the old
// reference-equality optimisation caused balance resets to silently skip
// the render because the wallet object ref never changed.
let _sigBudgets = '', _sigDist = '';
let _sigBudgetsObj = null, _sigDistObj = null;
function computeRenderSig(){
  if(budgets !== _sigBudgetsObj){ _sigBudgetsObj = budgets; _sigBudgets = JSON.stringify(budgets); }
  if(DISTRIBUTION !== _sigDistObj){ _sigDistObj = DISTRIBUTION; _sigDist = JSON.stringify(DISTRIBUTION); }
  return [
    state.transactions.length,
    state.transactions.length ? state.transactions[state.transactions.length-1].id : '',
    JSON.stringify(state.wallets),
    currentFilter, walletFilter, categoryFilter, searchQuery,
    state.crisisMode, _sigBudgets,
    _sigDist, autoDistribute, currentTab,
    dismissedRecurring.size,
    _txMutationStamp
  ].join('|');
}

function render(force){
  const sig = computeRenderSig();
  if(!force && sig === _renderSig) return; // nothing visual changed
  _renderSig = sig;
  _runRenderInvalidators(); // invalidate budget bars (and any future render-tied cache) per-render
  // _recurringCache, _filteredTxSig, _analyticsSig, _heroStatsSig, _pieChartSig
  // are intentionally NOT nulled here (as of v47.79) — every one of their sigs
  // now includes _txMutationStamp, which already captures in-place edits
  // (amount/desc/date/wallet/category on an existing tx) that don't change
  // state.transactions.length or the last tx's id. Blanket-clearing them here
  // forced a full O(n) re-scan + re-sort on every single render() call
  // (wallet-filter tap, crisis toggle, balance edit, anything) regardless of
  // whether anything relevant actually changed — heroStats/pieChart already
  // included the stamp and got zero benefit from the reset; getFilteredTx/
  // analytics now do too.
  // Always-visible / cheap essentials (home hero + wallets + form dropdowns)
  renderWallets();
  renderWalletSelect();
  updateHeroStats();
  // Heavy, tab-specific content — only build what's on screen. Switching tabs
  // rebuilds the target tab via switchTab(), so hidden tabs don't pay the cost
  // on every interaction (critical with 10k+ transactions).
  if(currentTab === 'transactions') renderRecentTx();
  if(currentTab === 'reports'){ renderTxList(); renderChart(); }
  if(currentTab === 'analytics'){ renderAnalytics(); renderRecurring(); renderSubscriptions(); renderPieChart(); }
}

let _resizeTimer;
// Only redraw the chart belonging to whichever tab is actually on screen —
// unconditionally redrawing both on every resize wasted a full canvas
// re-scan+draw for a hidden tab's chart the user isn't even looking at.
window.addEventListener('resize', ()=> { clearTimeout(_resizeTimer); _resizeTimer = setTimeout(()=>{
  if(currentTab === 'reports') renderChart();
  if(currentTab === 'analytics') renderPieChart();
}, 150); });

renderWalletSelect();
renderEditWalletSelect();
renderQuickAmounts();
_initQuickAmountSync();
renderCategoryGrid();
renderEditCategoryGrid();
renderTrackLinkPicker();

// Enter key: submit add-form or save edit; Escape: close focused modal
document.addEventListener('keydown', e => {
  if(e.key === 'Enter'){
    // Ignore Enter while an IME composition is being confirmed (e.g. mobile
    // predictive-text/emoji pickers) — that keystroke finalizes the composed
    // text, it isn't a submit action.
    if(e.isComposing || e.keyCode === 229) return;
    const tag = document.activeElement && document.activeElement.tagName;
    const id  = document.activeElement && document.activeElement.id;
    // Add-form inputs → submit with current addFormType
    if(id === 'descInput' || id === 'amountInput'){
      e.preventDefault();
      addTx(addFormType);
    }
    // Edit-modal inputs → save (date field included)
    if(id === 'editDesc' || id === 'editAmount' || id === 'editDate'){
      e.preventDefault();
      saveEdit();
    }
    // Transfer-modal fields → execute transfer
    if(id === 'transferAmount' || id === 'transferDate'){
      e.preventDefault();
      doTransfer();
    }
    // Subscription modal → save
    if(id === 'subName' || id === 'subAmount' || id === 'subBillingDay'){
      e.preventDefault();
      saveSubModal();
    }
    // Wallet-def (add/rename) modal → save
    if(id === 'walletDefName'){
      e.preventDefault();
      saveWalletDefModal();
    }
    // Wallet-detail modal → budget field saves the budget, balance field syncs
    if(id === 'detailBudgetInput'){
      e.preventDefault();
      saveWalletBudget();
    }
    if(id === 'detailNewBalance'){
      e.preventDefault();
      updateTrackedBalance();
    }
    // Settings → Drive client ID field
    if(id === 'driveClientId'){
      e.preventDefault();
      saveDriveClientId();
    }
  }
  // Enter/Space activates custom dropdown triggers and their options (these are
  // <div>s with onclick, so they need explicit keyboard activation unlike <button>)
  if(e.key === 'Enter' || e.key === ' '){
    const el = document.activeElement;
    if(el && (el.classList.contains('custom-select') || el.classList.contains('opt'))){
      e.preventDefault();
      el.click();
    }
  }
  if(e.key === 'Escape'){
    _closeTopmostOverlay();
  }
  // Tab/Shift+Tab focus trap: handled by app.overlay.js's own document-level
  // keydown listener (_activeOverlayEl-scoped) — a second, near-identical trap
  // used to live here too, but its focusable-element selector omitted [href]
  // (unlike overlay.js's, which includes it), so the two disagreed on which
  // element was "last" whenever a modal contained a link (e.g. Settings'
  // Privacy/Terms links) — one handler's Tab-wrap fired while the other's
  // didn't, making those links unreachable by forward Tab. Removed the
  // duplicate here rather than reconcile two copies of the same logic.
});

initTheme();
initAccent();
initLang();
loadLayoutPrefs();
renderBottomNav();
applySectionOrder();
setupPWA();
_updateChangelogDot();
// After a SW-triggered reload, show a brief "تم التحديث" toast so the user
// knows the new version is now active, then surface the changelog dot in Settings.
if(sessionStorage.getItem('_swJustUpdated')){
  sessionStorage.removeItem('_swJustUpdated');
  setTimeout(() => {
    const v = CHANGELOG[0]?.version || '';
    toast(t({ar:`✓ تم التحديث${v ? ' إلى ' + v : ''} — افتح الإعدادات لعرض الجديد 🎉`, en:`✓ Updated${v ? ' to ' + v : ''} — open Settings to see what's new 🎉`}));
    _updateChangelogDot();
  }, 900);
}
/* ============================================================
   EVENT BINDING — all UI event listeners wired here so index.html
   contains zero inline handlers and script-src CSP can use hashes.
============================================================ */
function _bindEvents(){
  const $ = id => document.getElementById(id);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
  // role="button" elements: activate on click + Enter/Space keydown
  const act = (el, fn) => { on(el,'click',fn); on(el,'keydown',e=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();fn(e);} }); };
  // custom-select elements: see bindKbdSelect (app.core.js) for the echo-
  // suppression rationale — centralized there, was a local closure here.
  const sel = bindKbdSelect;
  // Live thousands-separator formatting ("1000" -> "1,000" as you type) on
  // every static money field. Added as an extra 'input' listener alongside
  // whatever else already listens on these fields — safe regardless of
  // firing order, since every reader goes through parseAmount(), which
  // already tolerates grouped input.
  ['amountInput','editAmount','transferAmount','subAmount','detailBudgetInput','detailNewBalance']
    .forEach(id => on($(id), 'input', () => liveFormatThousands($(id))));

  // Header
  on($('themeToggle'),'click',toggleTheme);
  on($('btnHeaderData'),'click',()=>openSettingsTab('data'));
  on($('btnHeaderSettings'),'click',()=>openSettingsTab('layout'));

  // Home tab
  act($('crisisToggle'),()=>toggleCrisis());
  act($('quickNotesBanner'),()=>openQuickNotes());

  // Bottom nav + FAB — event delegation on stable <nav> so listeners survive
  // every renderBottomNav() call (which recreates all buttons inside the inner div).
  // The generated buttons have no inline onclick= so CSP script-src stays clean.
  const _nav = document.querySelector('.bottom-nav');
  on(_nav,'click', e => {
    if(e.target.closest('.fab-btn')){ toggleAddDrawer(); return; }
    const btn = e.target.closest('.nav-item[id^="nav"]');
    if(btn) switchTab(btn.id.replace('nav','').toLowerCase());
  });

  // Analytics tab
  on($('btnExportMonthly'),'click',exportMonthlyReport);
  on($('btnSubAdd'),'click',()=>openSubModal(null));

  // Reports tab
  act($('walletFilterChip'),()=>clearWalletFilter());
  act($('categoryFilterChip'),()=>toggleCategoryFilter(null));
  document.querySelectorAll('[data-f]').forEach(el=>on(el,'click',()=>setFilter(el.dataset.f)));
  on($('searchInput'),'input',onSearchInput);
  on($('btnClearSearch'),'click',clearSearch);
  // enterkeyhint="search" promised a "search" action key on mobile keyboards
  // but nothing ever handled Enter here — live filtering already applies on
  // every keystroke via the debounce above, so all Enter needs to do is
  // dismiss the keyboard (matching what a real search-submit would feel like).
  on($('searchInput'),'keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); e.target.blur(); } });

  // Transactions tab
  act($('txFilterChip'),()=>clearAllTxFilters());

  // Add drawer
  on($('addDrawerOverlay'),'click',closeAddDrawer);
  on($('btnDrawerClose'),'click',closeAddDrawer);
  on($('drawerTab0'),'click',()=>switchDrawerTab(0));
  on($('drawerTab1'),'click',()=>switchDrawerTab(1));
  sel($('walletSelectBtn'),()=>toggleWalletMenu());
  const _tSel=$('trackSelectBtn'); sel(_tSel,()=>openTrackPicker(_tSel));
  on($('voiceBtn'),'click',startVoiceInput);
  on($('addTypeExp'),'click',()=>setAddFormType('expense'));
  on($('addTypeInc'),'click',()=>setAddFormType('income'));
  on($('btnOpenTransfer'),'click',openTransferFromDrawer);
  on($('btnRepeatLast'),'click',repeatLastTx);
  on($('addExpenseBtn'),'click',()=>addTx('expense'));
  on($('addIncomeBtn'),'click',()=>addTx('income'));

  // Edit modal
  on($('editTypeExp'),'click',()=>setEditType('expense'));
  on($('editTypeInc'),'click',()=>setEditType('income'));
  sel($('editWalletBtn'),()=>toggleEditWalletMenu());
  on($('btnEditCancel'),'click',()=>closeModal('editModal'));
  on($('saveEditBtn'),'click',saveEdit);
  on($('btnEditDelete'),'click',deleteFromEdit);

  // Settings modal
  on($('btnForceUpdate'),'click',forceClearAndUpdate);
  on($('changelogBtn'),'click',openChangelog);
  document.querySelectorAll('[data-sett-tab]').forEach(el=>on(el,'click',()=>switchSettingsTab(el.dataset.settTab)));
  document.querySelectorAll('[data-theme-mode]').forEach(el=>on(el,'click',()=>setThemeMode(el.dataset.themeMode)));
  document.querySelectorAll('[data-lang]').forEach(el=>on(el,'click',()=>setLang(el.dataset.lang)));
  // these three tab strips are static (never rebuilt via innerHTML), so a
  // single boot-time wiring covers their whole lifetime — the layout editor's
  // own .le-tabs strip is rebuilt every render and gets wired at that point
  // instead (see renderLayoutEditor, app.layout.js).
  [$('settTabs'), $('themeModeTabs'), $('langTabs')].forEach(wireTabArrowNav);
  on($('btnResetLayout'),'click',resetLayout);
  on($('btnNewWallet'),'click',()=>openWalletDefModal(null));
  on($('btnSaveDistribution'),'click',saveDistribution);
  on($('btnResetDistribution'),'click',resetDistribution);
  on($('btnExportJson'),'click',exportData);
  on($('btnImportFileTrigger'),'click',()=>$('importFile').click());
  on($('importFile'),'change',importFromFile);
  on($('btnImportText'),'click',importFromTextarea);
  on($('btnSaveDriveClientId'),'click',saveDriveClientId);
  on($('driveSignInBtn'),'click',driveSignIn);
  on($('btnDriveSyncNow'),'click',driveManualSync);
  on($('btnDriveSignOut'),'click',driveSignOut);
  on($('btnDriveAutoAlways'),'click',enableDriveAutoSignIn);
  on($('btnDriveAutoNotNow'),'click',dismissDriveAutoSignInPrompt);
  on($('driveAutoSignInChk'),'change',e=>setDriveAutoSignIn(e.target.checked));
  on($('btnChangeDriveClientId'),'click',changeDriveClientId);
  on($('btnRepairBalances'),'click',repairBalancesFromLedger);
  on($('btnZeroTracked'),'click',zeroTrackedWallets);
  on($('btnZeroRegular'),'click',zeroRegularWallets);
  on($('btnClearSubs'),'click',clearAllSubscriptions);
  on($('btnClearBalTx'),'click',clearBalancesAndTx);
  on($('btnWipeAll'),'click',wipeAll);
  on($('btnCloseSettings'),'click',()=>closeModal('settingsModal'));

  // Transfer modal
  sel($('transferFromBtn'),()=>toggleTransferMenu('from'));
  sel($('transferToBtn'),()=>toggleTransferMenu('to'));
  on($('btnTransferCancel'),'click',()=>closeModal('transferModal'));
  on($('doTransferBtn'),'click',doTransfer);

  // Quick notes modal
  on($('qnNotes'),'input',onQuickNotesInput);
  on($('btnQnClose'),'click',()=>closeModal('quickNotesModal'));
  on($('qnParseBtn'),'click',parseQuickNotesPreview);
  on($('btnQnCancelPreview'),'click',cancelQuickNotesPreview);
  on($('qnConfirmBtn'),'click',commitQuickNotes);

  // Wallet detail modal
  on($('btnSaveWalletBudget'),'click',saveWalletBudget);
  on($('updateTrackedBalanceBtn'),'click',updateTrackedBalance);
  on($('trackModeDebit'),'click',()=>setTrackLinkMode(detailWalletId,'debit'));
  on($('trackModeCredit'),'click',()=>setTrackLinkMode(detailWalletId,'credit'));
  on($('btnCloseWalletDetail'),'click',()=>closeModal('walletDetailModal'));

  // Distribution modal
  on($('btnSkipDistribution'),'click',skipDistribution);
  on($('confirmDistributionBtn'),'click',confirmDistribution);

  // Welcome / onboarding modal
  on($('btnOnbSkip'),'click',closeWelcome);
  on($('onbBack'),'click',()=>welcomeNav(-1));
  on($('onbNext'),'click',()=>welcomeNav(1));
  on($('btnOnbStartIncome'),'click',()=>welcomeStart(true));
  on($('btnOnbStartBrowse'),'click',()=>welcomeStart(false));

  // Daily review modal
  on($('btnCloseDailyReview'),'click',()=>closeModal('dailyReviewModal'));

  // Drive conflict modal
  on($('btnConflictDrive'),'click',()=>resolveConflict(true));
  on($('btnConflictLocal'),'click',()=>resolveConflict(false));

  // Subscriptions modal
  on($('btnCloseSubModal'),'click',()=>closeModal('subModal'));
  on($('btnSaveSubModal'),'click',saveSubModal);
  on($('subDeleteBtn'),'click',deleteSubModal);

  // Wallet definition modal
  on($('walletDefTypeRegular'),'click',()=>setWalletDefType(false));
  on($('walletDefTypeTrack'),'click',()=>setWalletDefType(true));
  on($('btnCancelWalletDef'),'click',()=>closeModal('walletDefModal'));
  on($('btnSaveWalletDef'),'click',saveWalletDefModal);
  on($('walletDefDeleteBtn'),'click',deleteWalletDefModal);

  // Changelog modal
  on($('btnCloseChangelog'),'click',()=>closeModal('changelogModal'));
}
_bindEvents();

loadState().then(()=>{
  _stateLoaded = true; // money writers are gated on this (see _stateNotReady)
  hideSplash();
  loadQuickNotesDraft();    // restore any unconverted quick-notes draft
  updateQuickNotesBadge();  // reflect its line count on the home banner
  // initDrive() must run AFTER loadState() resolves, not alongside it: loadState()
  // may restore driveClientId from the IndexedDB snapshot when localStorage was
  // wiped (see the recovery block above), but that restore happens past loadState's
  // first await — if initDrive() were fired synchronously right after the call
  // (as it used to be), it would always read the pre-restore (empty) value and the
  // reconnect-from-IDB recovery above would be dead code for the very first load.
  initDrive();
  // Wrapped like the loadState() reads: a locked-down browser that throws on every
  // localStorage call (not just setItem) must not break post-load init (first-run
  // modal / daily review / drift check) right after the splash screen clears.
  // checkFirstRun()'s return value (not a pre-load localStorage peek) decides the
  // branch below, since only checkFirstRun() knows whether loadState() recovered a
  // returning user's data from IndexedDB and skipped onboarding for them.
  const isFirstRun = checkFirstRun();
  if(isFirstRun){
    // mark today as reviewed so the daily modal doesn't stack on first run
    try{ localStorage.setItem(LS_PREFIX + 'lastReviewDate', todayISO()); }catch(e){}
  } else {
    setTimeout(checkDailyReview, 400);
    setTimeout(checkBalanceDrift, 900);
  }
});

// Refresh time-sensitive UI (budget bars, day/week filter, analytics) when user returns to tab
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible'){
    _runRenderInvalidators(); // "today" may have rolled over while tab was hidden
    capDateInputsToToday();
    checkForSWUpdate(); // returning to the app is the prime moment to catch a new version
    // The update banner's own 8s auto-apply timer (app.pwa.js) can't tell time
    // passed while frozen — a mobile OS suspending the tab mid-countdown makes
    // that setTimeout fire almost immediately on resume (its deadline already
    // elapsed), reloading the page moments after the user looks back at the
    // screen instead of the intended 8-second warning. Re-arm it fresh here.
    if(_updateBannerShowing) _restartUpdateBannerTimer();
    // The background refresh timer (_scheduleTokenRefresh) is a setTimeout that mobile
    // OSes routinely freeze while the PWA is backgrounded, so a token can sit expired
    // for hours with the header indicator still showing "متصل ✓". Revalidate on resume
    // instead of waiting for a sync attempt to fail and silently flip the UI later.
    if(driveAccessToken && !driveTokenValid()){
      clearDriveToken();
      refreshDriveSettingsUI();
      maybePromptDriveConnect();
    }
    // Same staleness problem applies to the once-per-day review/drift checks — both
    // already self-guard against re-triggering (lastReviewDate / driftNotified), so
    // it's safe to re-run them here for a PWA that's resumed instead of reloaded.
    checkDailyReview();
    checkBalanceDrift();
    render(true);
  } else {
    // flush pending Drive sync immediately — the 1500ms debounce may never fire if tab is discarded
    if(driveSyncTimer){ clearTimeout(driveSyncTimer); driveSyncTimer = null; if(driveAccessToken) driveSyncToCloud(); }
    // same reasoning for the coalesced IndexedDB write — a backgrounded/discarded
    // tab must not lose the most recent save waiting on the 400ms debounce
    flushIdbBackup();
    // Same reasoning closeAddDrawer() already applies when the drawer is
    // explicitly closed: a pending voice recognition left running would keep
    // listening in the background and can land a stale transcript into the
    // (possibly now-irrelevant) form fields on return. Its own 12s watchdog
    // (_voiceTimer, app.voice.js) is an ordinary setTimeout that mobile OSes
    // routinely freeze while backgrounded, so it can't be relied on to catch
    // this — abort explicitly here instead of waiting for it.
    if(voiceRecognition){ try{ voiceRecognition.abort(); }catch(_){} voiceRecognition = null; }
  }
});

// visibilitychange alone is not enough: same-tab navigations and reloads
// (update banner, forceClearAndUpdate, user F5) fire pagehide WITHOUT a
// hidden-state transition in some browsers, and a few mobile browsers kill
// the tab firing only pagehide. This is the flush the scheduleIdbBackup
// comment promises — without it a transaction saved <400ms before a reload
// dies with the debounce timer.
window.addEventListener('pagehide', () => {
  if(driveSyncTimer){ clearTimeout(driveSyncTimer); driveSyncTimer = null; if(driveAccessToken){ try{ driveSyncToCloud(); }catch(_){} } }
  flushIdbBackup();
  if(voiceRecognition){ try{ voiceRecognition.abort(); }catch(_){} voiceRecognition = null; }
});

// Without this, going offline left the header showing whatever it last said
// (often "متزامن ✓") indefinitely — nothing re-evaluates the indicator until
// the next save's debounced sync attempt fails. A user could believe a second
// device already has their offline edits when nothing has actually synced.
window.addEventListener('offline', () => {
  if(driveAccessToken) setDriveIndicator('offline');
  toast(t({ar:'⚠ انقطع الاتصال — سيُستأنف المزامنة تلقائياً عند عودة الاتصال', en:'⚠ You\'re offline — sync will resume automatically when reconnected'}), true);
});
window.addEventListener('online', () => {
  // reconnecting is the best moment to push anything that piled up while offline,
  // rather than waiting for the next local save to (re)start the 1500ms debounce
  if(driveAccessToken){ clearTimeout(driveSyncTimer); driveSyncTimer = null; driveSyncToCloud(); }
});

// Proactive refresh when date rolls over while tab stays open in foreground
// (visibilitychange only fires when the user switches away/back — this covers the
// midnight-in-foreground case: month stats, day/week/year filter, budget bars all
// depend on "today" and must update the moment the day changes)
function scheduleNextMidnightRefresh(){
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  setTimeout(function midnightRefresh(){
    _runRenderInvalidators();
    capDateInputsToToday();
    render(true);
    // a tab kept visible across midnight otherwise misses that day's review
    // (incl. the "subscriptions due today" line) and the drift check — both
    // self-guard via lastReviewDate/driftNotified, so re-running is safe here
    checkDailyReview();
    checkBalanceDrift();
    // re-arm for the following midnight
    const n = new Date();
    const nm = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    setTimeout(midnightRefresh, nm.getTime() - n.getTime());
  }, nextMidnight.getTime() - now.getTime());
}
scheduleNextMidnightRefresh();

// Multi-tab sync: reload state if another tab saves data.
// Skip if a modal OR the add drawer is open, to avoid wiping unsaved form input
// (the add drawer isn't a .modal-overlay, so it needs its own guard).
// Small delay lets the other tab's async IndexedDB write (the primary tx store)
// settle before we re-read it — localStorage fires this event synchronously.
let _storageSyncTimer = null;
window.addEventListener('storage', (e) => {
  // Theme is cosmetic-only and is its own source of truth (not part of the money
  // ledger) — sync the OTHER tab's appearance live instead of reloading the whole
  // ledger over an unrelated preference change (which used to flash/scroll-jump
  // every open tab just from tapping the header theme toggle in one of them).
  if(e.key === LS_PREFIX + 'theme'){
    const mode = (e.newValue === 'light' || e.newValue === 'dark' || e.newValue === 'black') ? e.newValue : 'auto';
    applyTheme(_resolveThemeMode(mode));
    _updateThemeModeUI(mode);
    if(typeof renderChart === 'function') renderChart();
    if(typeof renderPieChart === 'function') renderPieChart();
    return;
  }
  // Accent palette is cosmetic-only too — mirror the other tab's choice live
  // instead of reloading the ledger (same rationale as theme above).
  if(e.key === LS_PREFIX + 'accent' || e.key === LS_PREFIX + 'accentDark'){
    applyAccent();
    _updateAccentUI(_currentAccent());
    if(typeof renderChart === 'function') renderChart();
    if(typeof renderPieChart === 'function') renderPieChart();
    return;
  }
  // Language is a UI preference (not ledger data) — mirror it live across tabs:
  // re-translate static markup, flip direction, and re-render dynamic UI.
  if(e.key === _LANG_LS){
    setLang(_currentLang());
    return;
  }
  // Quick-notes draft is free-form scratch text (not ledger data) and is written
  // on every keystroke — reloading the whole ledger for it would thrash other
  // tabs. Just refresh the in-memory draft + the home banner badge.
  if(e.key === LS_PREFIX + 'quickNotes'){
    loadQuickNotesDraft();
    updateQuickNotesBadge();
    return;
  }
  // Layout prefs (tab/section order, recent-tx page size) are cosmetic-only and
  // never touch dataEdit/lastEdit — reloading the full ledger for them would
  // flash/scroll-jump every other open tab over a change that doesn't affect
  // their money data at all.
  const _isLayoutPrefKey = e.key === LS_PREFIX+'tabOrder' || e.key === LS_PREFIX+'recentTxLimit' ||
    (e.key && e.key.indexOf(LS_PREFIX+'secOrder_') === 0);
  // Same reasoning as _isLayoutPrefKey — these are pure once-per-day/once-
  // per-drift-signature bookkeeping keys, never touched alongside an actual
  // ledger change. Without this exclusion, checkDailyReview()/
  // checkBalanceDrift() writing them in ONE tab triggered a full
  // loadState()+reconcileBalances()+render() (a visible flash) in every OTHER
  // open tab, purely from routine review/drift bookkeeping unrelated to any
  // real transaction/balance change.
  const _isReviewBookkeepingKey = e.key === LS_PREFIX+'lastReviewDate' || e.key === LS_PREFIX+'driftNotified';
  if(e.key && e.key.startsWith(LS_PREFIX) && e.key !== LS_PREFIX+'lastEdit' && !_isLayoutPrefKey && !_isReviewBookkeepingKey){
    if(!document.querySelector('.modal-overlay.open') && !addDrawerOpen){
      clearTimeout(_storageSyncTimer);
      // If a mutation is in flight, wait and re-check rather than reloading on
      // top of it (would reset `state` mid-write and corrupt balances).
      const _trySync = () => {
        // Wait out an in-flight mutation, an uncommitted IDB write, AND a pending
        // (not-yet-started) debounced IDB backup — without that last check, this
        // tab's own just-added transaction could still be sitting unflushed in
        // scheduleIdbBackup()'s 400ms debounce window with both flags at 0; reloading
        // here would silently wipe it from memory, and the debounce callback would
        // then persist that now-amputated state right over the other tab's data.
        if(_opInFlight > 0 || _idbWriteInFlight > 0 || _idbBackupTimer){ _storageSyncTimer = setTimeout(_trySync, 250); return; }
        // NOTE: the in-flight flags above are per-tab — this tab can't see that the
        // OTHER tab still has a 400ms scheduleIdbBackup() debounce pending (its
        // localStorage 'lastEdit' write already fired this event synchronously).
        // The 600ms initial delay below covers that 400ms window + margin so we
        // don't read a stale IDB snapshot that predates the other tab's flush.
        loadState().then(() => {
          // loadState() replaces state.transactions wholesale from the freshly-
          // merged IDB snapshot (see idbBackup's cross-tab union), but balances
          // are read from localStorage's own separately-written 'balances' key,
          // which the OTHER tab's concurrent save never touched. Recompute from
          // the now-correct ledger so this tab's wallet totals can't drift from
          // a transaction that only just arrived via the merge.
          const diff = reconcileBalances();
          if(Object.keys(diff).length){ saveBalances(); render(); }
        });
      };
      _storageSyncTimer = setTimeout(_trySync, 600);
    }
  }
});

// Global handler for unhandled promise rejections — prevents silent failures.
// Throttled: a retry storm (e.g. several queued fetches failing offline at once)
// would otherwise stack an unreadable wall of identical toasts instead of one.
let _lastRejectionToast = 0;
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
  const now = Date.now();
  if(now - _lastRejectionToast < 3000) return;
  _lastRejectionToast = now;
  toast(t({ar:'⚠ حدث خطأ غير متوقع', en:'⚠ An unexpected error occurred'}), true);
});

// Prevent accidental scroll-wheel from changing number input values on desktop
// Delegated to document so it covers any dynamically added number inputs too
document.addEventListener('wheel', e => {
  if(e.target && e.target.tagName === 'INPUT' && e.target.type === 'number' && document.activeElement === e.target){
    e.preventDefault();
  }
}, {passive:false});

// bfcache restore: when the browser revives a frozen page from the Back/Forward cache,
// JS variables are from the frozen snapshot but the history stack may reflect
// navigation that happened since — _overlayHistDepth can be out of sync and cause
// Back to expel the user from the app instead of closing an overlay. Re-derive it
// from the restored history state so the two stay consistent.
window.addEventListener('pageshow', e => {
  if(e.persisted){
    _overlayHistDepth = (history.state && history.state._mahfaztyOverlay) ? (history.state.depth || 1) : 0;
  }
});
