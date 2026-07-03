/* ============================================================
   TAB SWITCHING & CUSTOMIZABLE LAYOUT
   Split out of app.ui.js. Bottom-nav tab switching, the drag-reorderable
   tab/section layout editor, persisted layout prefs (tab order, section
   order, recent-tx page size, track-link mode), and the Settings modal's
   top-level tab strip (layout/wallets/data).
   Loaded AFTER app.ui.js and BEFORE app.charts.js/app.drive.js/app.logic.js
   (all of which call into this file's renderers/setters at runtime).
============================================================ */
function capTab(s){ return s.charAt(0).toUpperCase() + s.slice(1); }

function switchTab(tab){
  // bottom-nav convention: each tab opens at its top — without this, scrolling
  // deep into Transactions then tapping 📊 lands mid-way down Analytics.
  if(tab !== currentTab) window.scrollTo({top:0});
  currentTab = tab;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('tab' + capTab(tab));
  if(panel) panel.classList.add('active');
  tabOrder.forEach(k => {
    const btn = document.getElementById('nav' + capTab(k));
    if(btn){
      const on = k === tab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-current', on ? 'page' : 'false');
    }
  });
  // Build the target tab's content fresh (render() skips hidden tabs to stay
  // fast at scale, so each tab is (re)rendered the moment it becomes visible).
  if(tab === 'transactions'){ _recentVisibleCount = recentTxLimit; renderRecentTx(); }
  // cancel any chart rAF still pending from a previous rapid tab switch so we
  // don't paint a canvas for a tab that's no longer visible
  if(_tabChartRaf) cancelAnimationFrame(_tabChartRaf);
  if(tab === 'analytics'){
    renderAnalytics(); renderRecurring(); renderSubscriptions();
    _tabChartRaf = requestAnimationFrame(()=>{ _tabChartRaf = null; renderPieChart(); });
  }
  if(tab === 'reports'){
    renderTxList();
    _tabChartRaf = requestAnimationFrame(()=>{ _tabChartRaf = null; renderChart(); });
  }
}
let _tabChartRaf = null;

/* ============================================================
   v9.4: CUSTOMIZABLE LAYOUT — tab order + section order
============================================================ */
// Keep only valid keys (in saved order), then merge in any defaults the save
// didn't include — so adding/removing sections in a future version never breaks.
// A newly-added default key is inserted at its DEFAULT position (right after its
// nearest preceding default neighbour that's present), NOT blindly appended to the
// end — otherwise a brand-new section (e.g. the quick-notes banner) would land at
// the bottom of the tab for every existing user instead of where it's designed to sit.
function sanitizeOrder(arr, def){
  const valid = [...new Set((Array.isArray(arr) ? arr : []).filter(k => def.includes(k)))];
  const present = new Set(valid);
  def.forEach((k, di) => {
    if(present.has(k)) return;
    let insertAt = valid.length; // fallback: end
    // prefer inserting just after the nearest earlier default key that's present.
    // Tracked with a `found` flag rather than comparing insertAt to valid.length —
    // that comparison was a bug: a legitimate backward-loop result can coincide
    // numerically with valid.length (e.g. inserting at the very end is also what
    // "nothing found" looks like), wrongly triggering the forward loop below and
    // overwriting a correct position with the wrong one.
    let found = false;
    for(let j = di - 1; j >= 0; j--){
      const idx = valid.indexOf(def[j]);
      if(idx !== -1){ insertAt = idx + 1; found = true; break; }
    }
    // if none precede it, insert before the nearest later default key that's present
    if(!found){
      for(let j = di + 1; j < def.length; j++){
        const idx = valid.indexOf(def[j]);
        if(idx !== -1){ insertAt = idx; break; }
      }
    }
    valid.splice(insertAt, 0, k);
    present.add(k);
  });
  return valid;
}
function loadLayoutPrefs(){
  try{
    const t = JSON.parse(localStorage.getItem(LS_PREFIX + 'tabOrder') || 'null');
    tabOrder = sanitizeOrder(t, DEFAULT_TAB_ORDER);
  }catch(e){ tabOrder = DEFAULT_TAB_ORDER.slice(); }
  Object.keys(SECTION_DEFS).forEach(tab => {
    const def = SECTION_DEFS[tab].map(s => s.key);
    let saved = null;
    try{ saved = JSON.parse(localStorage.getItem(LS_PREFIX + 'secOrder_' + tab) || 'null'); }catch(e){}
    sectionOrder[tab] = sanitizeOrder(saved, def);
  });
  try{
    const n = parseInt(localStorage.getItem(LS_PREFIX + 'recentTxLimit'), 10);
    recentTxLimit = clampRecentLimit(n);
  }catch(e){ recentTxLimit = RECENT_TX_LIMIT_DEFAULT; }
  _recentVisibleCount = recentTxLimit;
  try{ trackLinkMode = sanitizeTrackLinkMode(JSON.parse(localStorage.getItem(LS_PREFIX + 'trackLinkMode') || 'null')); }
  catch(e){ trackLinkMode = {}; }
  fixQuickNotesSectionOrder();
}
// v47.39 introduced the 'quicknotes' home section; sanitizeOrder appended it to
// the END of the saved order for existing users — and that order may already be
// persisted locally and/or synced via Drive, so the "insert missing key" path
// (v47.41) never repositions it. Re-seat it right after 'crisis' (its designed
// home) IN MEMORY on every load — which also survives a Drive copy that still has
// it at the end — UNTIL the user deliberately reorders the home sections from the
// layout editor (which pins the flag below so their own order wins thereafter).
function fixQuickNotesSectionOrder(){
  try{ if(localStorage.getItem(LS_PREFIX + 'qnSecPinned') === '1') return; }catch(e){}
  const home = sectionOrder.home;
  if(!Array.isArray(home) || home.indexOf('quicknotes') === -1) return;
  const rest = home.filter(k => k !== 'quicknotes');
  let at = rest.indexOf('crisis');
  at = (at === -1) ? Math.min(1, rest.length) : at + 1;
  rest.splice(at, 0, 'quicknotes');
  if(rest.join('|') !== home.join('|')) sectionOrder.home = rest;
}
// Keep only valid track-wallet ids mapped to a known mode ('debit'/'credit'),
// so a corrupt/old saved value can't feed a bad direction into the money math.
function sanitizeTrackLinkMode(obj){
  const out = {};
  if(obj && typeof obj === 'object'){
    WALLET_DEFS.forEach(w => {
      if(w.track && (obj[w.id] === 'debit' || obj[w.id] === 'credit')) out[w.id] = obj[w.id];
    });
  }
  return out;
}
// Resolve a tracked wallet's link mode, defaulting to 'debit' (real-balance) — the
// behavior consistent with how Cards/Cash already work (spending lowers the balance).
function trackModeFor(walletId){ return trackLinkMode[walletId] === 'credit' ? 'credit' : 'debit'; }
// Keep the page size sane: 5..50, default when missing/invalid
function clampRecentLimit(n){
  if(!isFinite(n) || n < 5) return RECENT_TX_LIMIT_DEFAULT;
  return Math.min(Math.round(n), RECENT_TX_LIMIT_MAX);
}
// Returns true on success so callers can withhold an optimistic "saved" toast
// on failure instead of clobbering the error toast shown here.
function saveLayoutPrefs(){
  try{
    localStorage.setItem(LS_PREFIX + 'tabOrder', JSON.stringify(tabOrder));
    Object.keys(sectionOrder).forEach(tab => {
      localStorage.setItem(LS_PREFIX + 'secOrder_' + tab, JSON.stringify(sectionOrder[tab]));
    });
    localStorage.setItem(LS_PREFIX + 'recentTxLimit', String(recentTxLimit));
    localStorage.setItem(LS_PREFIX + 'trackLinkMode', JSON.stringify(trackLinkMode));
    return true;
  }catch(e){ toast(t({ar:'⚠ فشل حفظ تفضيلات الترتيب محليًا', en:'⚠ Failed to save layout preferences locally'}), true); return false; }
}
function setRecentTxLimit(n){
  recentTxLimit = clampRecentLimit(n);
  _recentVisibleCount = recentTxLimit;
  saveLayoutPrefs();
  scheduleDriveSync();
  renderRecentTx();
}

// UI/layout preferences travel with backups and Drive sync so a user's chosen
// tab order, section order and page size follow them across devices.
function collectUiPrefs(){
  return { tabOrder: tabOrder, sectionOrder: sectionOrder, recentTxLimit: recentTxLimit, trackLinkMode: trackLinkMode };
}
function applyUiPrefs(p){
  if(!p || typeof p !== 'object') return;
  if(Array.isArray(p.tabOrder)) tabOrder = sanitizeOrder(p.tabOrder, DEFAULT_TAB_ORDER);
  if(p.sectionOrder && typeof p.sectionOrder === 'object'){
    Object.keys(SECTION_DEFS).forEach(tab => {
      const def = SECTION_DEFS[tab].map(s => s.key);
      sectionOrder[tab] = sanitizeOrder(p.sectionOrder[tab], def);
    });
  }
  if(p.recentTxLimit !== undefined){
    recentTxLimit = clampRecentLimit(parseInt(p.recentTxLimit, 10));
    _recentVisibleCount = recentTxLimit;
  }
  if(p.trackLinkMode !== undefined) trackLinkMode = sanitizeTrackLinkMode(p.trackLinkMode);
  fixQuickNotesSectionOrder(); // re-seat the quick-notes banner even if the cloud order still has it at the end
  saveLayoutPrefs();
  renderBottomNav();
  applySectionOrder();
}
function renderBottomNav(){
  const inner = document.querySelector('.bottom-nav-inner');
  if(!inner) return;
  const half = Math.ceil(tabOrder.length / 2); // 4 tabs -> 2 each side of the FAB
  const item = key => {
    const d = TAB_DEFS[key];
    if(!d) return '';
    const on = key === currentTab;
    const label = t('nav.' + key); // falls back to the Arabic TAB_DEFS label via the table
    return `<button class="nav-item${on ? ' active' : ''}" id="nav${capTab(key)}" aria-label="${escHtml(label)}" aria-current="${on ? 'page' : 'false'}"><span class="nav-ic">${d.icon}</span><span>${escHtml(label)}</span></button>`;
  };
  const fabLabel = escHtml(t('drawer.addTx'));
  inner.innerHTML =
    tabOrder.slice(0, half).map(item).join('') +
    `<div class="nav-fab"><button class="fab-btn" aria-label="${fabLabel}" title="${fabLabel}">＋</button></div>` +
    tabOrder.slice(half).map(item).join('');
}
function applySectionOrder(){
  Object.keys(sectionOrder).forEach(tab => {
    const panel = document.getElementById('tab' + capTab(tab));
    if(!panel) return;
    sectionOrder[tab].forEach(key => {
      const el = panel.querySelector(':scope > .ui-sec[data-sec="' + key + '"]');
      if(el) panel.appendChild(el); // re-appending in order reorders the section
    });
  });
}
// Tabs inside the layout editor (one for each reorderable group). `label` is
// an I18N_STRINGS key or inline {ar,en} t() literal, resolved at render time
// (see SECTION_DEFS above for why — same reasoning applies here).
const LAYOUT_EDITOR_TABS = [
  { id:'tab',       icon:'🗂',  label:{ar:'التبويبات', en:'Tabs'} },
  { id:'sec:home',  icon:'🏠',  label:'nav.home' },
  { id:'sec:analytics', icon:'📊', label:'nav.analytics' },
  { id:'sec:reports',   icon:'📋', label:'nav.reports' },
  { id:'txlimit',   icon:'🧾',  label:'nav.transactions' },
];

function renderLayoutEditor(){
  const host = document.getElementById('layoutEditor');
  if(!host) return;

  const moveUpLabel = t({ar:'تحريك لأعلى', en:'Move up'});
  const moveDownLabel = t({ar:'تحريك لأسفل', en:'Move down'});
  const row = (scope, key, label, idx, len) =>
    `<div class="reorder-row">
      <span class="reorder-label">${label}</span>
      <div class="reorder-btns">
        <button data-mv-scope="${scope}" data-mv-key="${key}" data-mv="-1" ${idx===0?'disabled':''} aria-label="${moveUpLabel}">▲</button>
        <button data-mv-scope="${scope}" data-mv-key="${key}" data-mv="1" ${idx===len-1?'disabled':''} aria-label="${moveDownLabel}">▼</button>
      </div>
    </div>`;

  // Build the segmented tab strip
  const tabs = LAYOUT_EDITOR_TABS.map(td => {
    const lbl = t(td.label);
    return `<button class="le-tab${_layoutEditorTab===td.id?' active':''}" data-let="${td.id}" aria-label="${lbl}">${td.icon} <span>${lbl}</span></button>`;
  }).join('');
  let html = `<div class="le-tabs">${tabs}</div>`;

  // Build the active panel
  if(_layoutEditorTab === 'tab'){
    html += '<div class="reorder-group">';
    tabOrder.forEach((k,i) => { html += row('tab', k, TAB_DEFS[k].icon+' '+t('nav.'+k), i, tabOrder.length); });
    html += '</div>';

  } else if(_layoutEditorTab.startsWith('sec:')){
    const tabKey = _layoutEditorTab.split(':')[1];
    const arr = sectionOrder[tabKey] || [];
    html += '<div class="reorder-group">';
    arr.forEach((k,i) => {
      const def = SECTION_DEFS[tabKey] && SECTION_DEFS[tabKey].find(s=>s.key===k);
      html += row(_layoutEditorTab, k, def ? t(def.label) : k, i, arr.length);
    });
    html += '</div>';

  } else if(_layoutEditorTab === 'txlimit'){
    const opts = [...new Set([10,15,20,25,30,40,50, recentTxLimit])].sort((a,b)=>a-b);
    const optHtml = opts.map(n => `<option value="${n}"${n===recentTxLimit?' selected':''}>${t({ar:`${n} معاملة`, en:`${n} ${n===1?'transaction':'transactions'}`})}</option>`).join('');
    html += `<div class="reorder-group">
      <div class="reorder-row">
        <span class="reorder-label">${t({ar:`🧾 معاملات لكل دفعة (حد أقصى ${RECENT_TX_LIMIT_MAX})`, en:`🧾 Transactions per batch (max ${RECENT_TX_LIMIT_MAX})`})}</span>
        <select class="recent-limit-select" aria-label="${t({ar:'عدد المعاملات المعروضة', en:'Number of transactions shown'})}">${optHtml}</select>
      </div>
    </div>`;
  }

  host.innerHTML = html;
  // property-bound (CSP blocks onclick=/onchange= attributes in generated markup)
  host.querySelectorAll('button[data-mv]').forEach(b => {
    b.onclick = () => moveLayout(b.dataset.mvScope, b.dataset.mvKey, parseInt(b.dataset.mv, 10));
  });
  host.querySelectorAll('.le-tab[data-let]').forEach(b => {
    b.onclick = () => switchLayoutEditorTab(b.dataset.let);
  });
  const limitSel = host.querySelector('.recent-limit-select');
  if(limitSel) limitSel.onchange = () => setRecentTxLimit(parseInt(limitSel.value, 10));
}

function switchLayoutEditorTab(id){
  _layoutEditorTab = id;
  renderLayoutEditor();
}

/* ============================================================
   SETTINGS TOP-LEVEL TABS
   Splits the (otherwise very long) settings sheet into three panels:
   layout/ordering, wallets, and data — so it scrolls less and reads cleaner.
============================================================ */
let _settingsTab = 'layout';
const SETTINGS_TABS = ['layout', 'wallets', 'data'];
function switchSettingsTab(id){
  if(!SETTINGS_TABS.includes(id)) id = 'layout';
  _settingsTab = id;
  // show only the selected panel
  document.querySelectorAll('#settingsModal [data-sett-panel]').forEach(p => {
    p.hidden = (p.getAttribute('data-sett-panel') !== id);
  });
  // reflect selection on the tab strip (visual + a11y)
  document.querySelectorAll('#settTabs .le-tab').forEach(b => {
    const on = b.getAttribute('data-sett-tab') === id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  // each tab should start at its own top, not wherever the previous one was scrolled
  const modal = document.querySelector('#settingsModal .modal');
  if(modal) modal.scrollTop = 0;
}
// Open settings already focused on a given tab (used by the ⚙/⇅ buttons and the
// drift-repair toast, which wants the data tab where the repair tool lives).
function openSettingsTab(id){
  _settingsTab = SETTINGS_TABS.includes(id) ? id : 'layout';
  openModal('settingsModal');
}
function moveLayout(scope, key, dir){
  const arr = scope === 'tab' ? tabOrder : sectionOrder[scope.split(':')[1]];
  if(!arr) return;
  const i = arr.indexOf(key), j = i + dir;
  if(i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  // The user is deliberately arranging the home sections — stop auto-seating the
  // quick-notes banner so their chosen order wins from here on.
  if(scope === 'sec:home'){ try{ localStorage.setItem(LS_PREFIX + 'qnSecPinned', '1'); }catch(e){} }
  saveLayoutPrefs();
  scheduleDriveSync();
  if(scope === 'tab') renderBottomNav(); else applySectionOrder();
  renderLayoutEditor();
}
function resetLayout(){
  tabOrder = DEFAULT_TAB_ORDER.slice();
  Object.keys(SECTION_DEFS).forEach(tab => { sectionOrder[tab] = SECTION_DEFS[tab].map(s => s.key); });
  try{ localStorage.removeItem(LS_PREFIX + 'qnSecPinned'); }catch(e){} // defaults already seat quick-notes correctly; re-enable auto-seating
  recentTxLimit = RECENT_TX_LIMIT_DEFAULT;
  _recentVisibleCount = recentTxLimit;
  const saved = saveLayoutPrefs();
  scheduleDriveSync();
  renderBottomNav();
  applySectionOrder();
  renderRecentTx();
  renderLayoutEditor();
  if(saved) toast(t({ar:'↺ تمت استعادة الترتيب الافتراضي', en:'↺ Default layout restored'}));
}
