/* ============================================================
   RENDER: WALLETS
============================================================ */
function getWalletPctLabel(w){
  const d = DISTRIBUTION.find(x=>x.id===w.id);
  if(d) return d.pct + '%';
  return w.pct;
}

let _monthlyExpenseCache = null;
let _monthlyExpenseCacheKey = '';
let _heroStatsCache = null;
let _heroStatsSig = '';
function _buildMonthlyExpenseCache(){
  const now = new Date();
  const cache = {};
  state.transactions.forEach(tx=>{
    if(tx.type!=='expense' || tx.category==='transfer' || tx.category==='adjustment') return;
    const d = new Date(tx.ts);
    if(d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear()){
      cache[tx.wallet] = (cache[tx.wallet]||0) + tx.amount;
    }
  });
  return cache;
}
function monthlyExpenseForWallet(walletId){
  const now = new Date();
  const key = now.getFullYear() + '-' + now.getMonth();
  if(!_monthlyExpenseCache || _monthlyExpenseCacheKey !== key){
    _monthlyExpenseCache = _buildMonthlyExpenseCache();
    _monthlyExpenseCacheKey = key;
  }
  return _monthlyExpenseCache[walletId] || 0;
}

function renderWallets(){
  const grid = document.getElementById('walletsGrid');
  grid.innerHTML = '';
  let spendable = 0;

  // First-run guidance: a brand-new app has every balance at 0, which reads as
  // "broken" rather than "empty". Show a friendly CTA that points at the natural
  // first action — recording income (which then auto-distributes into the wallets).
  if(state.transactions.length === 0 && !state.crisisMode){
    const cta = document.createElement('div');
    cta.className = 'wallet-cta';
    cta.innerHTML = `
      <div class="wallet-cta-title">👋 ابدأ رحلتك</div>
      <div class="wallet-cta-sub">سجّل أول دخل ليتوزّع تلقائياً على محافظك حسب النِّسب.</div>
      <button class="wallet-cta-btn" type="button" onclick="openAddDrawer(); setAddFormType('income');">＋ سجّل أول دخل</button>
    `;
    grid.appendChild(cta);
  }

  let defs = WALLET_DEFS;
  if(state.crisisMode){
    defs = WALLET_DEFS.filter(w => !CRISIS_WALLET_IDS.includes(w.id));
  }

  const barMax = maxWalletVal();

  defs.forEach(w => {
    const val = state.wallets[w.id] ?? 0;
    if(!w.track) spendable += val;
    const div = document.createElement('div');
    div.className = 'wallet' + (w.track ? ' track' : '') + (val < 0 ? ' neg-val' : '') + (walletFilter===w.id ? ' active-filter' : '');
    div.setAttribute('role','button');
    div.setAttribute('tabindex','0');
    div.setAttribute('aria-pressed', walletFilter===w.id);
    const pctWidth = w.track ? 100 : Math.min(100, Math.max(2, (val/barMax)*100));

    let budgetHtml = '';
    if(!w.track && budgets[w.id] > 0){
      const spent = monthlyExpenseForWallet(w.id);
      const budget = budgets[w.id];
      const ratio = Math.min(1, spent/budget);
      const over = spent > budget;
      const color = over ? 'var(--red)' : ratio > 0.8 ? 'var(--gold)' : 'var(--green)';
      budgetHtml = `
        <div class="budget-row">
          <div class="bar" style="margin-top:6px;"><i style="transform:scaleX(${ratio.toFixed(4)}); background:${color};"></i></div>
          <div class="budget-label" style="color:${over?'var(--red)':'var(--muted)'}">${fmt(spent)} / ${fmt(budget)}${over?' ⚠':''}</div>
        </div>`;
    }

    // track wallets are not counted in spendable — say so persistently on the card
    // (the hover title never shows on touch), so users stop wondering why the total
    // doesn't include Cards/Cash.
    const trackTag = w.track ? `<div class="track-tag">تتبع · غير محتسب</div>` : '';
    div.innerHTML = `
      <div class="top">
        <div class="name">${escHtml(w.name)}</div>
        <div class="pct" onclick="event.stopPropagation(); openWalletDetail('${w.id}')" aria-label="تفاصيل ${escHtml(w.name)}" title="التفاصيل">ⓘ ${escHtml(getWalletPctLabel(w))}</div>
      </div>
      <div class="val">${fmt(val)}</div>
      <div class="bar"><i style="transform:scaleX(${(pctWidth/100).toFixed(4)})"></i></div>
      ${trackTag}
      ${budgetHtml}
    `;
    div.title = w.track ? (w.name + ' — رقم تتبع فقط، غير مُحتسب بالإجمالي المتاح للصرف') : '';
    div.onclick = () => setWalletFilter(w.id);
    div.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setWalletFilter(w.id); } };
    grid.appendChild(div);
  });

  if(state.crisisMode){
    let crisisTotal = 0;
    CRISIS_WALLET_IDS.forEach(id => crisisTotal += (state.wallets[id] ?? 0));
    spendable += crisisTotal; // crisis reserve is part of total liquidity in emergency mode
    // derive the combined percentage from the merged wallets' own pct labels so it
    // can never drift from CRISIS_WALLET_IDS again (was hardcoded "٪50")
    const crisisPct = CRISIS_WALLET_IDS.reduce((s,id)=>{
      const w = WALLET_DEFS.find(x=>x.id===id);
      return s + (w ? (parseFloat(w.pct) || 0) : 0);
    }, 0);
    const div = document.createElement('div');
    div.className = 'wallet crisis-combined';
    div.innerHTML = `
      <div class="top">
        <div class="name">الاحتياطي البديل (مدمج)</div>
        <div class="pct">٪${crisisPct}</div>
      </div>
      <div class="val">${fmt(crisisTotal)}</div>
    `;
    grid.appendChild(div);
  }

  document.getElementById('walletCount').textContent = defs.length + (state.crisisMode?1:0);

  const totalEl = document.getElementById('totalSpendable');
  if(prevSpendable !== null && prevSpendable !== spendable){
    animateNumber(totalEl, prevSpendable, spendable, 450);
  } else {
    totalEl.textContent = fmt(spendable);
  }
  prevSpendable = spendable;

  const _crisisEl = document.getElementById('crisisToggle');
  _crisisEl.classList.toggle('active', state.crisisMode);
  _crisisEl.setAttribute('aria-checked', String(state.crisisMode)); // keep SR state in sync on load, not just on tap
}

function setWalletFilter(id){
  walletFilter = (walletFilter === id) ? null : id;
  _txVisibleCount = 50;
  const chip = document.getElementById('walletFilterChip');
  if(walletFilter){
    const w = WALLET_DEFS.find(x=>x.id===walletFilter);
    if(w) document.getElementById('walletFilterLabel').textContent = 'فلترة حسب: ' + w.name;
    chip.classList.add('show');
  } else {
    chip.classList.remove('show');
  }
  renderWallets();
  renderTxList();
  renderChart();
  renderPieChart();
  scrollToTxList();
}
function clearWalletFilter(){
  walletFilter = null;
  _txVisibleCount = 50;
  document.getElementById('walletFilterChip').classList.remove('show');
  renderWallets();
  renderTxList();
  renderChart();
  renderPieChart();
  // no scrollToTxList — user is already near the tx list (tapped the chip above it)
}

function toggleCategoryFilter(catId){
  categoryFilter = (categoryFilter === catId) ? null : catId;
  _txVisibleCount = 50;
  const chip = document.getElementById('categoryFilterChip');
  if(categoryFilter){
    const cat = getCategory(categoryFilter);
    document.getElementById('categoryFilterLabel').textContent = 'الفئة: ' + cat.icon + ' ' + cat.name;
    chip.classList.add('show');
  } else {
    chip.classList.remove('show');
  }
  renderTxList();
  renderChart();
  renderPieChart();
  scrollToTxList();
}


/* ============================================================
   WALLET SELECT (add form)
============================================================ */
let _walletSelectSig = '';
function renderWalletSelect(){
  const sig = selectedWallet + '|' + SELECTABLE_WALLETS.map(w => w.id + ':' + (state.wallets[w.id]??0)).join(',');
  if(sig === _walletSelectSig) return;
  _walletSelectSig = sig;
  const menu = document.getElementById('walletMenu');
  menu.innerHTML = '';
  SELECTABLE_WALLETS.forEach(w => {
    const opt = document.createElement('div');
    opt.className = 'opt' + (w.id === selectedWallet ? ' selected' : '');
    opt.setAttribute('role','option');
    opt.tabIndex = 0; // keyboard-reachable when the menu is open
    const val = state.wallets[w.id] ?? 0;
    opt.innerHTML = `<span>${w.name}</span><span class="bal">${fmt(val)}</span>`;
    opt.onclick = () => selectWallet(w.id);
    menu.appendChild(opt);
  });
  const wDef = WALLET_DEFS.find(w => w.id === selectedWallet);
  document.getElementById('walletSelectLabel').textContent = wDef ? wDef.name : 'اختر محفظة';
}
function toggleWalletMenu(){
  const wrap = document.getElementById('walletMenuWrap');
  const btn = document.getElementById('walletSelectBtn');
  const isOpen = wrap.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
  btn.setAttribute('aria-expanded', isOpen);
}
function selectWallet(id){
  selectedWallet = id;
  const btn = document.getElementById('walletSelectBtn');
  document.getElementById('walletMenuWrap').classList.remove('open');
  btn.classList.remove('open');
  btn.setAttribute('aria-expanded', 'false');
  renderWalletSelect();
}

/* ============================================================
   OPTIONAL TRACKED-WALLET LINK (add form)
   Lets an expense paid from a budget wallet ALSO move a tracked wallet
   (e.g. pay Uber from Core, and auto-update the "Uber" tracking number) —
   without making the tracked wallet the direct source of the transaction.
============================================================ */
function renderTrackLinkPicker(){
  const toggle = document.getElementById('trackLinkEnable');
  const picker = document.getElementById('trackLinkPicker');
  const select = document.getElementById('trackLinkSelect');
  if(!toggle || !picker || !select) return;

  // A stale id (e.g. carried over from a repeated tx whose tracked wallet was
  // since deleted/changed in a cloud merge) must not leave the form silently
  // pointing at nothing.
  if(selectedTrackWallet && !WALLET_DEFS.find(w => w.id === selectedTrackWallet && w.track)){
    selectedTrackWallet = null;
  }

  select.innerHTML = '';
  WALLET_DEFS.filter(w => w.track).forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = w.name;
    select.appendChild(opt);
  });

  toggle.checked = !!selectedTrackWallet;
  picker.style.display = selectedTrackWallet ? '' : 'none';
  if(selectedTrackWallet) select.value = selectedTrackWallet;

  const hint = document.getElementById('trackLinkHint');
  if(hint){
    if(selectedTrackWallet){
      const w = WALLET_DEFS.find(x => x.id === selectedTrackWallet);
      const credit = trackModeFor(selectedTrackWallet) === 'credit';
      hint.style.display = 'block';
      hint.textContent = credit
        ? `↪ سيزيد رقم «${w ? w.name : ''}» بقيمة المصروف تلقائياً (عدّاد إنفاق). غيّر السلوك من تفاصيل المحفظة ⓘ.`
        : `↪ سينقص رصيد «${w ? w.name : ''}» بقيمة المصروف تلقائياً (رصيد فعلي). غيّر السلوك من تفاصيل المحفظة ⓘ.`;
    } else {
      hint.style.display = 'none';
      hint.textContent = '';
    }
  }
}
// Checking the box reveals the wallet picker and defaults it to whatever is
// already selected (or the first tracked wallet); unchecking clears the link
// entirely rather than just hiding it, so a hidden stale selection can't
// silently re-apply later.
function toggleTrackLinkEnable(enabled){
  if(enabled){
    const firstTrack = WALLET_DEFS.find(w => w.track);
    selectedTrackWallet = (firstTrack && WALLET_DEFS.find(w => w.id === selectedTrackWallet && w.track))
      ? selectedTrackWallet
      : (firstTrack ? firstTrack.id : null);
  } else {
    selectedTrackWallet = null;
  }
  renderTrackLinkPicker();
  haptic(6);
}
function selectTrackLink(id){
  selectedTrackWallet = id || null;
  renderTrackLinkPicker();
}
// Per-wallet direction for the link, set from the wallet-detail modal.
function setTrackLinkMode(walletId, mode){
  const w = WALLET_DEFS.find(x => x.id === walletId && x.track);
  if(!w) return;
  trackLinkMode[walletId] = (mode === 'credit') ? 'credit' : 'debit';
  saveLayoutPrefs();
  scheduleDriveSync();
  _updateTrackModeToggleUI(walletId);
  renderTrackLinkPicker(); // refresh the add-form hint if this wallet is selected there
  toast(trackLinkMode[walletId] === 'credit' ? '✓ سيُحتسب كعدّاد إنفاق (يزيد)' : '✓ سيُحتسب كرصيد فعلي (ينقص)');
}
function _updateTrackModeToggleUI(walletId){
  const credit = trackModeFor(walletId) === 'credit';
  const d = document.getElementById('trackModeDebit');
  const c = document.getElementById('trackModeCredit');
  if(d){ d.classList.toggle('active', !credit); d.setAttribute('aria-pressed', String(!credit)); }
  if(c){ c.classList.toggle('active', credit); c.setAttribute('aria-pressed', String(credit)); }
}

/* ============================================================
   V9.3: TAB SWITCHING
============================================================ */
function capTab(s){ return s.charAt(0).toUpperCase() + s.slice(1); }

function switchTab(tab){
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
  if(tab === 'transactions') renderRecentTx();
  if(tab === 'analytics'){
    renderAnalytics(); renderRecurring(); renderSubscriptions();
    requestAnimationFrame(()=> renderPieChart());
  }
  if(tab === 'reports'){
    renderTxList();
    requestAnimationFrame(()=> renderChart());
  }
}

/* ============================================================
   v9.4: CUSTOMIZABLE LAYOUT — tab order + section order
============================================================ */
// Keep only valid keys (in saved order), then append any defaults the save
// didn't include — so adding/removing sections in a future version never breaks.
function sanitizeOrder(arr, def){
  const valid = (Array.isArray(arr) ? arr : []).filter(k => def.includes(k));
  def.forEach(k => { if(!valid.includes(k)) valid.push(k); });
  return [...new Set(valid)];
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
function saveLayoutPrefs(){
  try{
    localStorage.setItem(LS_PREFIX + 'tabOrder', JSON.stringify(tabOrder));
    Object.keys(sectionOrder).forEach(tab => {
      localStorage.setItem(LS_PREFIX + 'secOrder_' + tab, JSON.stringify(sectionOrder[tab]));
    });
    localStorage.setItem(LS_PREFIX + 'recentTxLimit', String(recentTxLimit));
    localStorage.setItem(LS_PREFIX + 'trackLinkMode', JSON.stringify(trackLinkMode));
  }catch(e){}
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
    return `<button class="nav-item${on ? ' active' : ''}" id="nav${capTab(key)}" onclick="switchTab('${key}')" aria-label="${d.label}" aria-current="${on ? 'page' : 'false'}"><span class="nav-ic">${d.icon}</span><span>${d.label}</span></button>`;
  };
  inner.innerHTML =
    tabOrder.slice(0, half).map(item).join('') +
    '<div class="nav-fab"><button class="fab-btn" onclick="toggleAddDrawer()" aria-label="إضافة معاملة" title="إضافة معاملة">＋</button></div>' +
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
// Tabs inside the layout editor (one for each reorderable group)
const LAYOUT_EDITOR_TABS = [
  { id:'tab',       icon:'🗂',  label:'التبويبات' },
  { id:'sec:home',  icon:'🏠',  label:'الرئيسي'   },
  { id:'sec:analytics', icon:'📊', label:'تحليلات' },
  { id:'sec:reports',   icon:'📋', label:'تقارير'  },
  { id:'txlimit',   icon:'🧾',  label:'المعاملات'  },
];

function renderLayoutEditor(){
  const host = document.getElementById('layoutEditor');
  if(!host) return;

  const row = (scope, key, label, idx, len) =>
    `<div class="reorder-row">
      <span class="reorder-label">${label}</span>
      <div class="reorder-btns">
        <button onclick="moveLayout('${scope}','${key}',-1)" ${idx===0?'disabled':''} aria-label="تحريك لأعلى">▲</button>
        <button onclick="moveLayout('${scope}','${key}',1)" ${idx===len-1?'disabled':''} aria-label="تحريك لأسفل">▼</button>
      </div>
    </div>`;

  // Build the segmented tab strip
  const tabs = LAYOUT_EDITOR_TABS.map(t =>
    `<button class="le-tab${_layoutEditorTab===t.id?' active':''}" onclick="switchLayoutEditorTab('${t.id}')" aria-label="${t.label}">${t.icon} <span>${t.label}</span></button>`
  ).join('');
  let html = `<div class="le-tabs">${tabs}</div>`;

  // Build the active panel
  if(_layoutEditorTab === 'tab'){
    html += '<div class="reorder-group">';
    tabOrder.forEach((k,i) => { html += row('tab', k, TAB_DEFS[k].icon+' '+TAB_DEFS[k].label, i, tabOrder.length); });
    html += '</div>';

  } else if(_layoutEditorTab.startsWith('sec:')){
    const tabKey = _layoutEditorTab.split(':')[1];
    const arr = sectionOrder[tabKey] || [];
    html += '<div class="reorder-group">';
    arr.forEach((k,i) => {
      const def = SECTION_DEFS[tabKey] && SECTION_DEFS[tabKey].find(s=>s.key===k);
      html += row(_layoutEditorTab, k, def ? def.label : k, i, arr.length);
    });
    html += '</div>';

  } else if(_layoutEditorTab === 'txlimit'){
    const opts = [...new Set([10,15,20,25,30,40,50, recentTxLimit])].sort((a,b)=>a-b);
    const optHtml = opts.map(n => `<option value="${n}"${n===recentTxLimit?' selected':''}>${n} معاملة</option>`).join('');
    html += `<div class="reorder-group">
      <div class="reorder-row">
        <span class="reorder-label">🧾 معاملات لكل دفعة (حد أقصى ${RECENT_TX_LIMIT_MAX})</span>
        <select class="recent-limit-select" aria-label="عدد المعاملات المعروضة" onchange="setRecentTxLimit(parseInt(this.value,10))">${optHtml}</select>
      </div>
    </div>`;
  }

  host.innerHTML = html;
}

function switchLayoutEditorTab(id){
  _layoutEditorTab = id;
  renderLayoutEditor();
}
function moveLayout(scope, key, dir){
  const arr = scope === 'tab' ? tabOrder : sectionOrder[scope.split(':')[1]];
  if(!arr) return;
  const i = arr.indexOf(key), j = i + dir;
  if(i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  saveLayoutPrefs();
  scheduleDriveSync();
  if(scope === 'tab') renderBottomNav(); else applySectionOrder();
  renderLayoutEditor();
}
function resetLayout(){
  tabOrder = DEFAULT_TAB_ORDER.slice();
  Object.keys(SECTION_DEFS).forEach(tab => { sectionOrder[tab] = SECTION_DEFS[tab].map(s => s.key); });
  recentTxLimit = RECENT_TX_LIMIT_DEFAULT;
  _recentVisibleCount = recentTxLimit;
  saveLayoutPrefs();
  scheduleDriveSync();
  renderBottomNav();
  applySectionOrder();
  renderRecentTx();
  renderLayoutEditor();
  toast('↺ تمت استعادة الترتيب الافتراضي');
}

/* ============================================================
   V9.3: ADD DRAWER
============================================================ */
function openAddDrawer(){
  const wasClosed = !addDrawerOpen;
  addDrawerOpen = true;
  switchDrawerTab(0); // always open on Details tab so amount/date are immediately visible
  document.getElementById('addDrawer').classList.add('open');
  document.getElementById('addDrawerOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  capDateInputsToToday();
  // Same back-button bookkeeping as openModal/closeModal (see app.logic.js) so
  // hardware/gesture back closes the drawer instead of navigating away. Guarded
  // by wasClosed so re-entrant calls (none currently, but matches the modal
  // pattern defensively) don't push a duplicate history entry.
  if(wasClosed) _pushOverlayHistory();
}
function closeAddDrawer(){
  const wasOpen = addDrawerOpen;
  addDrawerOpen = false;
  document.getElementById('addDrawer').classList.remove('open');
  document.getElementById('addDrawerOverlay').classList.remove('open');
  if(!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
  // Closing via the back button skips the click-outside handler that normally
  // collapses this dropdown, so it could otherwise show pre-expanded the next
  // time the drawer opens (same fix as closeModal's editWalletMenuWrap cleanup).
  const wWrap = document.getElementById('walletMenuWrap');
  const wBtn = document.getElementById('walletSelectBtn');
  if(wWrap) wWrap.classList.remove('open');
  if(wBtn){ wBtn.classList.remove('open'); wBtn.setAttribute('aria-expanded','false'); }
  // A pending voice recognition would otherwise keep listening in the background
  // and silently fill the (now hidden) desc/amount fields whenever it resolves.
  if(voiceRecognition){ try{ voiceRecognition.abort(); }catch(_){} }
  if(wasOpen) _popOverlayHistory();
}
function toggleAddDrawer(){
  if(addDrawerOpen) closeAddDrawer(); else openAddDrawer();
}
function switchDrawerTab(idx){
  drawerTab = idx;
  [0,1].forEach(i => {
    const tb = document.getElementById('drawerTab'+i);
    const sb = document.getElementById('drawerSub'+i);
    if(tb) tb.classList.toggle('active', i===idx);
    if(sb) sb.classList.toggle('active', i===idx);
  });
}

/* ============================================================
   V9.3: RECENT TRANSACTIONS (home tab — last 10, no filters)
============================================================ */
// Newest-first copy of ALL transactions, cached so paginating a 10k+ history
// (and repeated renders) doesn't re-sort the whole array every time. Invalidated
// by saveTx() whenever the transaction set changes.
function getAllTxSorted(){
  if(_allTxSortedCache) return _allTxSortedCache;
  // newest-first; id tiebreaker keeps same-second entries (and transfer legs)
  // in a stable, deterministic order so the list/chart never flicker-reorder
  _allTxSortedCache = state.transactions.slice().sort((a,b)=> (b.ts - a.ts) || String(b.id).localeCompare(String(a.id)));
  return _allTxSortedCache;
}

// Hero "income/expense this month" — lives on the home tab, so it must refresh
// on every render regardless of which tab is active. Cached (scans all tx once).
function updateHeroStats(){
  const now = new Date();
  const last = state.transactions[state.transactions.length-1];
  const _hSig = state.transactions.length + '|' + (last ? last.id : '') + '|' + now.getMonth() + '|' + now.getFullYear() + '|' + state.crisisMode;
  if(_hSig !== _heroStatsSig || !_heroStatsCache){
    let mIncome=0, mExpense=0;
    state.transactions.forEach(tx=>{
      if(tx.category === 'transfer' || tx.category === 'adjustment') return;
      const d = new Date(tx.ts);
      if(d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear()){
        if(tx.type==='income') mIncome+=tx.amount; else mExpense+=tx.amount;
      }
    });
    _heroStatsCache = {mIncome: round2(mIncome), mExpense: round2(mExpense)};
    _heroStatsSig = _hSig;
  }
  const hi = document.getElementById('heroIncome');
  const he = document.getElementById('heroExpense');
  if(hi) hi.textContent = fmt(_heroStatsCache.mIncome);
  if(he) he.textContent = fmt(_heroStatsCache.mExpense);
}

function renderRecentTx(){
  const list = document.getElementById('recentTxList');
  if(!list) return;
  list.innerHTML = '';
  // Full chronological log of every transaction (newest first), grouped by day.
  const all = getAllTxSorted();

  const countEl = document.getElementById('txLogCount');
  if(countEl) countEl.textContent = all.length ? all.length : '';

  if(all.length === 0){
    list.innerHTML = '<div class="empty"><span class="ic">🗂</span>لا توجد معاملات بعد — اضغط ＋ لإضافة أول معاملة</div>';
    return;
  }

  const _yest = new Date(); _yest.setDate(_yest.getDate()-1);
  const todayStr = new Date().toDateString();
  const yesterdayStr = _yest.toDateString();

  const visible = all.slice(0, _recentVisibleCount);
  let lastDay = null;
  let card = null;

  visible.forEach(tx => {
    const wallet = WALLET_DEFS.find(w=>w.id===tx.wallet);
    const cat = getCategory(tx.category);
    const date = new Date(tx.ts);
    const dayStr = date.toDateString();
    // Start a new day-group (label + its own grouped card) whenever the day changes
    if(dayStr !== lastDay){
      lastDay = dayStr;
      const lbl = document.createElement('div');
      lbl.className = 'tx-day-label';
      lbl.textContent = dayStr===todayStr ? 'اليوم'
        : dayStr===yesterdayStr ? 'أمس'
        : date.toLocaleDateString('ar-EG',{weekday:'long', day:'numeric', month:'long', numberingSystem:'latn'});
      list.appendChild(lbl);
      card = document.createElement('div');
      card.className = 'recent-card';
      card.setAttribute('role','list');
      list.appendChild(card);
    }
    const timeStr = date.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit',numberingSystem:'latn'});
    const sign = tx.type==='expense'?'-':'+';
    const cls = tx.type==='expense'?'neg':'pos';
    const row = document.createElement('div');
    row.className = 'rtx';
    row.setAttribute('role','listitem');
    row.innerHTML = `
      <div class="rtx-badge" style="background:${cat.color}22; color:${cat.color};">${cat.icon}</div>
      <div class="rtx-body">
        <div class="rtx-desc">${escHtml(tx.desc||(wallet?wallet.name:''))}</div>
        <div class="rtx-sub"><span class="rtx-wallet">${escHtml(wallet?wallet.name:'')}</span><span class="rtx-dot">·</span>${timeStr}${_trackLinkTag(tx)}</div>
      </div>
      <div class="rtx-amt ${cls}">${sign}${fmt(tx.amount)}</div>`;
    row.onclick = () => openEdit(tx.id);
    card.appendChild(row);
  });

  // Paginate so a long history stays fast — reveal one more page (recentTxLimit) per tap
  if(all.length > _recentVisibleCount){
    const remaining = all.length - _recentVisibleCount;
    const toShow = Math.min(remaining, recentTxLimit);
    const more = document.createElement('button');
    more.className = 'btn-secondary';
    more.style.cssText = 'margin:14px auto 0; display:block; width:auto; padding:10px 24px; font-size:13px;';
    more.textContent = `⬇ عرض ${arPlural(toShow, 'معاملة أقدم', 'معاملتين أقدم', 'معاملات أقدم', 'معاملة واحدة أقدم')}` + (remaining - toShow > 0 ? ` (${arPlural(remaining - toShow, 'متبقية', 'متبقيتان', 'متبقية', 'واحدة متبقية')})` : '');
    more.onclick = () => { _recentVisibleCount += recentTxLimit; renderRecentTx(); };
    list.appendChild(more);
  } else if(_recentVisibleCount > recentTxLimit && all.length > recentTxLimit){
    // Already expanded beyond the first page — offer a way to collapse back
    const collapse = document.createElement('button');
    collapse.className = 'btn-secondary';
    collapse.style.cssText = 'margin:14px auto 0; display:block; width:auto; padding:10px 24px; font-size:13px;';
    collapse.textContent = '⬆ طيّ القائمة';
    collapse.onclick = () => { _recentVisibleCount = recentTxLimit; renderRecentTx(); document.getElementById('tabTransactions')?.scrollIntoView({behavior:'smooth', block:'start'}); };
    list.appendChild(collapse);
  }
}

/* ============================================================
   V9.3: SUBSCRIPTIONS
============================================================ */
function renderSubscriptions(){
  const list = document.getElementById('subsList');
  const totalEl = document.getElementById('subsTotal');
  if(!list||!totalEl) return;

  if(subscriptions.length===0){
    totalEl.innerHTML = '';
    list.innerHTML = '<div class="empty" style="padding:18px 14px;"><span class="ic">📆</span>لا توجد اشتراكات — أضف اشتراكاتك الشهرية لتتبع تكاليفها</div>';
    return;
  }

  const active = subscriptions.filter(s=>s.active!==false);
  const monthlyTotal = round2(active.reduce((s,x)=>s+x.amount, 0));
  totalEl.innerHTML = `إجمالي الاشتراكات الفعّالة: <b>${fmt(monthlyTotal)}</b> / شهر`;
  list.innerHTML = '';
  subscriptions.forEach(s => {
    const card = document.createElement('div');
    card.className = 'sub-card'+(s.active===false?' inactive':'');
    card.innerHTML = `
      <div class="sub-info">
        <div class="sub-name">${escHtml(s.name)}</div>
        <div class="sub-meta">يوم ${s.billingDay||'—'} من كل شهر${s.active===false?' · (متوقف)':''}</div>
      </div>
      <div class="sub-amt">-${fmt(s.amount)}</div>
      <button class="sub-edit" aria-label="تعديل الاشتراك">✎</button>`;
    card.querySelector('.sub-edit').onclick = () => openSubModal(s.id);
    list.appendChild(card);
  });
}
function openSubModal(id){
  editingSubId = id;
  const sub = id ? subscriptions.find(s=>s.id===id) : null;
  document.getElementById('subModalTitle').textContent = sub ? '✎ تعديل الاشتراك' : '📆 اشتراك جديد';
  document.getElementById('subName').value = sub ? sub.name : '';
  document.getElementById('subAmount').value = sub ? sub.amount : '';
  document.getElementById('subBillingDay').value = sub ? (sub.billingDay||'') : '';
  const activeEl = document.getElementById('subActive');
  if(activeEl) activeEl.checked = sub ? (sub.active !== false) : true;
  const delRow = document.getElementById('subDeleteRow');
  if(delRow) delRow.style.display = sub ? 'flex' : 'none';
  openModal('subModal');
}
let _saveSubBusy = false;
async function saveSubModal(){
  if(_saveSubBusy) return;
  const name = document.getElementById('subName').value.trim().slice(0,60);
  const amount = round2(parseAmount(document.getElementById('subAmount').value));
  const billingDay = parseInt(normalizeDigits(document.getElementById('subBillingDay').value), 10); // normalize Arabic-Indic digits (numeric keyboards often default to them)
  const active = document.getElementById('subActive')?.checked !== false;
  if(!name){ toast('⚠ أدخل اسم الاشتراك', true); return; }
  if(!isFinite(amount)||amount<=0){ toast('⚠ أدخل مبلغ صحيح', true); return; }
  if(!isFinite(billingDay)||billingDay<1||billingDay>31){ toast('⚠ أدخل يوم صحيح (1-31)', true); return; }

  _saveSubBusy = true;
  _opInFlight++;
  try{
    if(editingSubId){
      const sub = subscriptions.find(s=>s.id===editingSubId);
      if(sub){ sub.name=name; sub.amount=amount; sub.billingDay=billingDay; sub.active=active; }
    } else {
      subscriptions.push({ id:'sub_'+Date.now()+'_'+Math.random().toString(36).slice(2,5), name, amount, billingDay, active });
    }
    await saveSubs();
    renderSubscriptions();
    closeModal('subModal');
    toast('✓ تم حفظ الاشتراك');
  } finally {
    _saveSubBusy = false;
    _opInFlight--;
  }
}
async function deleteSubModal(){
  if(_saveSubBusy || !editingSubId) return;
  if(!confirm('حذف هذا الاشتراك نهائياً؟')) return;
  _saveSubBusy = true;
  _opInFlight++;
  try{
    subscriptions = subscriptions.filter(s=>s.id!==editingSubId);
    await saveSubs();
    renderSubscriptions();
    closeModal('subModal');
    toast('🗑 تم حذف الاشتراك');
  } finally {
    _saveSubBusy = false;
    _opInFlight--;
  }
}

/* ============================================================
   WALLET SELECT (edit modal)
============================================================ */
let _editWalletSelectSig = '';
function renderEditWalletSelect(){
  let list = SELECTABLE_WALLETS;
  const currentDef = WALLET_DEFS.find(w=>w.id===editWallet);
  if(currentDef && currentDef.track) list = [currentDef, ...SELECTABLE_WALLETS];
  const sig = editWallet + '|' + list.map(w => w.id + ':' + (state.wallets[w.id]??0)).join(',');
  if(sig === _editWalletSelectSig) return;
  _editWalletSelectSig = sig;
  const menu = document.getElementById('editWalletMenu');
  menu.innerHTML = '';
  list.forEach(w => {
    const opt = document.createElement('div');
    opt.className = 'opt' + (w.id === editWallet ? ' selected' : '');
    opt.setAttribute('role','option');
    opt.tabIndex = 0;
    const val = state.wallets[w.id] ?? 0;
    opt.innerHTML = `<span>${w.name}</span><span class="bal">${fmt(val)}</span>`;
    opt.onclick = () => { editWallet = w.id; document.getElementById('editWalletMenuWrap').classList.remove('open'); const eb = document.getElementById('editWalletBtn'); eb.classList.remove('open'); eb.setAttribute('aria-expanded','false'); renderEditWalletSelect(); };
    menu.appendChild(opt);
  });
  const wDef = WALLET_DEFS.find(w => w.id === editWallet);
  document.getElementById('editWalletLabel').textContent = wDef ? wDef.name : 'اختر محفظة';
}
function toggleEditWalletMenu(){
  const wrap = document.getElementById('editWalletMenuWrap');
  const btn = document.getElementById('editWalletBtn');
  const isOpen = wrap.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
  btn.setAttribute('aria-expanded', isOpen);
}
function setEditType(type){
  editType = type;
  document.getElementById('editTypeExp').classList.toggle('active', type==='expense');
  document.getElementById('editTypeInc').classList.toggle('active', type==='income');
  // keep category compatible with the chosen type (mirrors the add form)
  const cat = CATEGORIES.find(c=>c.id===editCategory);
  if(cat && !cat.types.includes(type)) editCategory = 'other';
  renderEditCategoryGrid();
}

/* ============================================================
   VOICE INPUT (Web Speech API — free, on-device/browser, no API key)
   Parses spoken Arabic like "صرفت خمسين على عشاء" into amount + description,
   and tries to match a category by keyword.
============================================================ */
const VOICE_NUMBER_WORDS = {
  'صفر':0,'واحد':1,'وحده':1,'وحدة':1,'اثنين':2,'إثنين':2,'تنين':2,'اثنان':2,'ثلاثة':3,'ثلاثه':3,'ثلاث':3,
  'اربعة':4,'أربعة':4,'اربعه':4,'اربع':4,'خمسة':5,'خمسه':5,'خمس':5,'ستة':6,'سته':6,'ست':6,'سبعة':7,'سبعه':7,'سبع':7,
  'ثمانية':8,'ثمانيه':8,'ثمان':8,'ثماني':8,'تسعة':9,'تسعه':9,'تسع':9,'عشرة':10,'عشره':10,'عشر':10,
  'احد عشر':11,'اثنا عشر':12,'اثني عشر':12,
  'عشرين':20,'ثلاثين':30,'اربعين':40,'أربعين':40,'خمسين':50,'ستين':60,'سبعين':70,
  'ثمانين':80,'تسعين':90,
  // hundreds (standalone + common compound single-words heard from speech)
  'مية':100,'مئة':100,'مائة':100,'ميتين':200,'مئتين':200,'مئتان':200,'مايتين':200,
  'ثلاثمية':300,'ثلاثمئة':300,'اربعمية':400,'اربعمئة':400,'خمسمية':500,'خمسمئة':500,
  'ستمية':600,'ستمئة':600,'سبعمية':700,'سبعمئة':700,'ثمنمية':800,'ثمانمئة':800,'تسعمية':900,'تسعمئة':900,
  // thousands / millions (incl. plurals + duals heard from speech)
  'الف':1000,'ألف':1000,'آلاف':1000,'الاف':1000,'ألفين':2000,'الفين':2000,
  'مليون':1000000,'ملايين':1000000,'مليونين':2000000
};

// Combine an ordered list of numeric values using Arabic scale semantics
// (hundred/thousand/million multiply, smaller values add): [5,1000]→5000,
// [100,1000]→100000, [1000,500]→1500, [5,20]→25.
function _combineNumberValues(values){
  let total = 0, current = 0;
  for(const v of values){
    if(v === 100){ current = (current === 0 ? 1 : current) * 100; }
    else if(v >= 1000){ total += (current === 0 ? 1 : current) * v; current = 0; }
    else { current += v; }
  }
  return total + current;
}

const CATEGORY_KEYWORDS = {
  food: ['عشاء','غداء','فطور','اكل','أكل','مطعم','قهوة','كافيه','مأكولات'],
  transport: ['تكسي','تاكسي','بنزين','وقود','مواصلات','سيارة','أوبر','اوبر','باص'],
  shopping: ['تسوق','سوق','ملابس','شراء','محل'],
  bills: ['فاتورة','فواتير','كهرباء','ماء','انترنت','إنترنت','اتصالات','موبايل'],
  health: ['دواء','صيدلية','طبيب','مستشفى','علاج'],
  entertainment: ['سينما','ترفيه','لعبة','العاب','ألعاب','رحلة'],
  salary: ['راتب','دخل','مكافأة','أجرة','اجرة'],
};

function parseArabicNumber(text){
  // Normalize Arabic-Indic/Persian digits and strip thousands separators so a
  // mix of digits and words ("٥ آلاف", "5,000", "خمسة آلاف") is handled uniformly.
  const norm = normalizeDigits(text);
  const tokens = norm.split(/\s+/);
  const values = [];            // ordered numeric values pulled from digits AND words
  let sawAny = false;
  for(let raw of tokens){
    if(!raw) continue;
    // a token may be a digit group, possibly stuck to a scale word ("5آلاف")
    if(/^\d/.test(raw)){
      const dm = raw.match(/\d+(\.\d+)?/);
      if(dm){ values.push(parseFloat(dm[0])); sawAny = true; raw = raw.slice(dm[0].length); }
      if(!raw) continue;
    }
    const clean = raw.replace(/[^ء-ي]/g,'');
    if(!clean) continue;
    if(VOICE_NUMBER_WORDS[clean] !== undefined){ values.push(VOICE_NUMBER_WORDS[clean]); sawAny = true; continue; }
    // strip a leading connective و ("وعشرين" → "عشرين") and retry — but only when
    // the remainder is itself a number word, so real words like "واحد" stay intact
    if(clean.length > 2 && clean[0] === 'و' && VOICE_NUMBER_WORDS[clean.slice(1)] !== undefined){
      values.push(VOICE_NUMBER_WORDS[clean.slice(1)]); sawAny = true;
    }
  }
  if(!sawAny) return null;
  const result = _combineNumberValues(values);
  return isFinite(result) ? result : null;
}

function guessCategory(text){
  for(const [catId, keywords] of Object.entries(CATEGORY_KEYWORDS)){
    if(keywords.some(k => text.includes(k))) return catId;
  }
  return null;
}

function guessType(text){
  const incomeWords = ['استلمت','استقبلت','دخل','راتب','ربحت','كسبت','حولوا لي','حول لي','حولني','حولولي','وصلني','وصل لي','وصلتني','جاني','جاتني','جانا','هدية','مكافأة','بونص','عائد','فائدة','أرسلوا لي','ارسلولي'];
  return incomeWords.some(w => text.includes(w)) ? 'income' : 'expense';
}

let voiceRecognition = null;
let _voiceTimer = null;
// Browsers without Web Speech support (notably Firefox, which implements
// neither SpeechRecognition nor webkitSpeechRecognition) would otherwise show
// a mic button that does nothing useful until tapped. Hide it up front instead
// of failing only on click, so the UI never advertises a feature that can't work.
(function hideVoiceBtnIfUnsupported(){
  if(window.SpeechRecognition || window.webkitSpeechRecognition) return;
  const hide = () => {
    const btn = document.getElementById('voiceBtn');
    if(btn) btn.style.display = 'none';
  };
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', hide);
  } else {
    hide();
  }
})();
function startVoiceInput(){
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRecognition){
    toast('⚠ متصفحك لا يدعم الإدخال الصوتي', true);
    return;
  }
  const btn = document.getElementById('voiceBtn');

  if(voiceRecognition){
    // abort (not stop) so a cancel-tap discards partial audio instead of
    // submitting an unintended transcript; onerror('aborted') is ignored below
    voiceRecognition.abort();
    return;
  }

  voiceRecognition = new SpeechRecognition();

  // Capture the instance so a late onend/onerror fired by an aborted recognition
  // can't null out a NEWER recognition that was started in the meantime (race:
  // abort() fires, user taps mic again before onend arrives, old onend fires).
  const thisRecognition = voiceRecognition; // now captures the real instance
  const cleanup = () => {
    if(voiceRecognition !== thisRecognition) return; // a newer instance took over — leave it alone
    clearTimeout(_voiceTimer); _voiceTimer = null;
    btn.classList.remove('listening');
    voiceRecognition = null;
  };
  voiceRecognition.lang = 'ar-SA';
  voiceRecognition.interimResults = false;
  voiceRecognition.maxAlternatives = 1;

  voiceRecognition.onstart = () => {
    btn.classList.add('listening');
    // watchdog: if the engine hangs and never fires onend/onerror (a known
    // flaky-browser case), force-release after 12s so the button recovers
    clearTimeout(_voiceTimer);
    _voiceTimer = setTimeout(() => {
      if(voiceRecognition){ try{ voiceRecognition.abort(); }catch(_){} cleanup(); }
    }, 12000);
  };
  voiceRecognition.onend = cleanup;
  voiceRecognition.onerror = (e) => {
    cleanup();
    if(e.error === 'not-allowed'){
      toast('⚠ يجب السماح بالوصول للميكروفون', true);
    } else if(e.error !== 'aborted'){
      toast('⚠ تعذر التعرف على الصوت، حاول مرة أخرى', true);
    }
  };

  voiceRecognition.onresult = (event) => {
    if(!event.results || !event.results[0] || !event.results[0][0]) return;
    const transcript = event.results[0][0].transcript.trim();
    if(!transcript){
      toast('🎤 لم يُفهم الكلام — حاول مجددًا', true);
      return;
    }
    applyVoiceTranscript(transcript);
  };

  try{ voiceRecognition.start(); }
  catch(e){ cleanup(); toast('⚠ تعذر بدء التعرف الصوتي', true); }
}

function applyVoiceTranscript(text){
  const amount = parseArabicNumber(text);
  const category = guessCategory(text);
  const type = guessType(text);

  // strip number-ish tokens from text to build a cleaner description
  let desc = text
    .replace(/\d+(\.\d+)?/g, '')
    .replace(/[٠-٩]+/g, '')
    .trim();
  Object.keys(VOICE_NUMBER_WORDS).forEach(w => { desc = desc.replace(new RegExp(w,'g'), ''); });
  desc = desc.replace(/\s{2,}/g,' ').trim();
  // remove common verbs/particles. JS \b is ASCII-only so it never matches around
  // Arabic letters — use whitespace anchors instead so these are actually stripped.
  // (bare single-letter particles like "ل" are intentionally omitted — too risky to
  // strip without butchering real words.)
  ['صرفت','دفعت','اشتريت','استلمت','استقبلت','على','ريال','دينار','من'].forEach(w=>{
    desc = desc.replace(new RegExp('(^|\\s)'+w+'(?=\\s|$)','g'), ' ');
  });
  desc = desc.replace(/\s{2,}/g,' ').trim();

  if(amount !== null){
    const amtEl = document.getElementById('amountInput');
    amtEl.value = amount;
    amtEl.dispatchEvent(new Event('input')); // sync quick-amount button highlight
  }
  if(desc){
    document.getElementById('descInput').value = desc;
  } else if(!amount){
    document.getElementById('descInput').value = text; // fallback: raw transcript
  }
  // apply the guessed income/expense type even when no category matched, so a
  // clear income phrase isn't left sitting on the expense form. setAddFormType
  // also drops the category if it's incompatible with the type, then re-renders.
  if(category) selectedCategory = category;
  setAddFormType(type);

  if(amount !== null){
    toast(`🎤 "${text}" → ${fmt(amount)} ${desc?'· '+desc:''}`);
  } else {
    toast('🎤 لم يتم العثور على رقم — اكتب المبلغ يدويًا', true);
    const amtEl = document.getElementById('amountInput');
    amtEl.focus(); // guide the user straight to the missing field
    amtEl.scrollIntoView({behavior:'smooth', block:'nearest'});
  }
}


function renderQuickAmounts(){
  const wrap = document.getElementById('quickAmounts');
  wrap.innerHTML = '';
  QUICK_AMOUNTS.forEach(amt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = fmt(amt);
    btn.onclick = () => {
      const input = document.getElementById('amountInput');
      input.value = amt;
      document.querySelectorAll('#quickAmounts button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
    };
    wrap.appendChild(btn);
  });
}
function _initQuickAmountSync(){
  document.getElementById('amountInput').addEventListener('input', ()=>{
    const v = parseAmount(document.getElementById('amountInput').value);
    document.querySelectorAll('#quickAmounts button').forEach(b=>{
      b.classList.toggle('active', parseFloat(b.textContent.replace(/,/g,'')) === v);
    });
  });
}

/* ============================================================
   CATEGORY PICKERS
============================================================ */
function setAddFormType(type){
  addFormType = type;
  const expBtn = document.getElementById('addTypeExp');
  const incBtn = document.getElementById('addTypeInc');
  if(expBtn){ expBtn.classList.toggle('active', type==='expense'); }
  if(incBtn){ incBtn.classList.toggle('active', type==='income'); }
  // if current category is incompatible with new type, reset to 'other'
  const cat = CATEGORIES.find(c=>c.id===selectedCategory);
  if(cat && !cat.types.includes(type)) selectedCategory = 'other';
  renderCategoryGrid();
}

// shared helper: make a category chip keyboard-operable (Enter/Space)
function _makeCatChip(c, isActive, onSelect){
  const chip = document.createElement('div');
  chip.className = 'cat-chip' + (isActive ? ' active' : '');
  chip.innerHTML = `<span class="ic">${c.icon}</span><span>${c.name}</span>`;
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  chip.setAttribute('aria-pressed', String(isActive));
  chip.setAttribute('aria-label', c.name);
  chip.onclick = onSelect;
  chip.onkeydown = (e) => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onSelect(); } };
  return chip;
}
function renderCategoryGrid(){
  const grid = document.getElementById('categoryGrid');
  grid.innerHTML = '';
  CATEGORIES.filter(c => c.types.includes(addFormType)).forEach(c => {
    grid.appendChild(_makeCatChip(c, selectedCategory===c.id, () => { selectedCategory = c.id; renderCategoryGrid(); }));
  });
}
function renderEditCategoryGrid(){
  const grid = document.getElementById('editCategoryGrid');
  grid.innerHTML = '';
  // 'transfer' is a sentinel: combined with tx.link it's how the app detects a
  // 2-leg transfer elsewhere (openEdit's _editingTransferLeg, analytics filters).
  // A distributed-income source also carries a link (to its withdrawal/deposit
  // legs) — picking 'transfer' here would misclassify it as a transfer leg from
  // then on, hiding its type/category controls and dropping it from income totals.
  CATEGORIES.filter(c => c.types.includes(editType) && !(c.id === 'transfer' && _editingDistSource)).forEach(c => {
    grid.appendChild(_makeCatChip(c, editCategory===c.id, () => { editCategory = c.id; renderEditCategoryGrid(); }));
  });
}
function getCategory(id){
  return CATEGORIES.find(c=>c.id===id) || CATEGORIES.find(c=>c.id==='other') || CATEGORIES[0];
}
// Small "↪ <tracked wallet>" badge for a transaction that also moves a tracked
// wallet, so a linked entry is recognizable in the lists. Empty string otherwise.
function _trackLinkTag(tx){
  if(!tx || !tx.trackWallet) return '';
  const w = WALLET_DEFS.find(x => x.id === tx.trackWallet && x.track);
  if(!w) return '';
  return `<span class="tx-tracklink">↪ ${escHtml(w.name)}</span>`;
}
// Collapse any unknown/untrusted category (e.g. from a crafted backup) to a
// known id; 'adjustment' is internal-but-valid, everything else falls to 'other'
const _KNOWN_CATEGORIES = new Set([...CATEGORIES.map(c=>c.id), 'adjustment']);
function normalizeCategory(cat){
  return _KNOWN_CATEGORIES.has(cat) ? cat : 'other';
}

/* ============================================================
   CATEGORY PIE CHART
============================================================ */
function renderPieChart(){
  const wrap = document.getElementById('pieContent');
  const filtered = state.transactions
    .filter(tx => inRange(tx.ts))
    .filter(tx => !walletFilter || tx.wallet === walletFilter)
    .filter(tx => tx.type==='expense' && tx.category !== 'transfer' && tx.category !== 'adjustment');

  if(filtered.length === 0){
    wrap.innerHTML = '<div class="empty" style="flex:1;"><span class="ic">🍰</span>أول مصروف يظهر هنا موزّعاً حسب الفئة</div>';
    return;
  }

  const totals = {};
  filtered.forEach(tx => {
    const cat = tx.category || 'other';
    totals[cat] = (totals[cat]||0) + tx.amount;
  });
  const total = Object.values(totals).reduce((a,b)=>a+b,0);
  // guard against an all-zero-amount set (e.g. crafted import) — every downstream
  // amt/total below would be NaN/Infinity and the donut + legend would render broken
  if(!(total > 0)){
    wrap.innerHTML = '<div class="empty" style="flex:1;"><span class="ic">🍰</span>أول مصروف يظهر هنا موزّعاً حسب الفئة</div>';
    return;
  }
  const entries = Object.entries(totals).sort((a,b)=>b[1]-a[1]);

  // largest-remainder rounding so the displayed integer percentages always sum
  // to exactly 100 (plain toFixed(0) per slice could yield 99% or 101%)
  const pctMap = {};
  if(total > 0){
    let floorSum = 0;
    const fracs = entries.map(([catId, amt]) => {
      const exact = amt / total * 100;
      const fl = Math.floor(exact);
      pctMap[catId] = fl; floorSum += fl;
      return { catId, frac: exact - fl };
    });
    let leftover = Math.round(100 - floorSum);
    fracs.sort((a,b)=> b.frac - a.frac);
    for(let i=0; i<leftover && i<fracs.length; i++) pctMap[fracs[i].catId] += 1;
  }

  // per-category comparison vs last month (only meaningful when viewing "month")
  let prevTotals = null;
  if(currentFilter === 'month'){
    prevTotals = {};
    const [prevStart, prevEnd] = monthRange(1);
    state.transactions.forEach(tx=>{
      if(tx.type!=='expense' || tx.category==='transfer' || tx.category==='adjustment') return;
      if(tx.ts < prevStart || tx.ts >= prevEnd) return;
      if(walletFilter && tx.wallet !== walletFilter) return;
      const cat = tx.category || 'other';
      prevTotals[cat] = (prevTotals[cat]||0) + tx.amount;
    });
  }

  const containerW = document.getElementById('pieContent')?.parentElement?.clientWidth || 320;
  const size = Math.min(120, Math.max(80, Math.round(containerW * 0.3)));
  const r = Math.round(size * 0.46), cx = size/2, cy = size/2;
  let html = `<canvas id="pieCanvas" width="${size}" height="${size}" style="width:${size}px;height:${size}px;" role="img" aria-label="مخطط دائري لتوزيع المصروفات حسب الفئة"></canvas>`;
  html += '<div class="pie-legend">';
  entries.forEach(([catId, amt]) => {
    const cat = getCategory(catId);
    const pct = pctMap[catId] ?? Math.round(amt/total*100);
    let cmpHtml = '';
    if(prevTotals){
      const prevAmt = prevTotals[catId] || 0;
      if(prevAmt > 0){
        const diff = ((amt-prevAmt)/prevAmt*100);
        const up = diff > 0;
        if(Math.abs(diff) >= 1){
          cmpHtml = `<span class="cat-cmp ${up?'up':'down'}">${up?'▲':'▼'}${Math.abs(diff).toFixed(0)}%</span>`;
        }
      } else if(amt > 0){
        cmpHtml = `<span class="cat-cmp up">جديد</span>`;
      }
    }
    html += `<div class="row cat-row" data-cat="${escHtml(catId)}"><span class="sw" style="background:${cat.color}"></span><span class="name">${cat.icon} ${cat.name}</span>${cmpHtml}<span class="pct">${fmt(amt)} (${pct}%)</span></div>`;
  });
  html += '</div>';
  wrap.innerHTML = html;
  wrap.querySelectorAll('.cat-row').forEach(row=>{
    row.style.cursor = 'pointer';
    row.onclick = () => toggleCategoryFilter(row.dataset.cat);
  });

  // draw pie
  const canvas = document.getElementById('pieCanvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size*dpr; canvas.height = size*dpr;
  const ctx = canvas.getContext('2d');
  if(!ctx) return;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  let start = -Math.PI/2;
  entries.forEach(([catId, amt]) => {
    const cat = getCategory(catId);
    const slice = (amt/total) * Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,start,start+slice);
    ctx.closePath();
    ctx.fillStyle = cat.color;
    ctx.fill();
    start += slice;
  });
  // donut hole
  ctx.beginPath();
  ctx.arc(cx,cy,r*0.55,0,Math.PI*2);
  ctx.fillStyle = themeColor('--card', '#1e222a');
  ctx.fill();
  // total label in center
  const isLightPie = document.body.classList.contains('light');
  const fmtPieShort = n => {
    if(n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
    if(n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
    return Math.round(n).toLocaleString('en-US');
  };
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isLightPie ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.45)';
  const totalLabel = fmtPieShort(total);
  // auto-shrink to fit the donut hole — very large totals (e.g. corrupted/huge
  // imports) can otherwise overflow fillText past the inner circle into the ring
  let pieFontPx = Math.round(size*0.09);
  const innerW = r*0.55*2*0.86; // small margin so text doesn't touch the ring edge
  ctx.font = `600 ${pieFontPx}px system-ui,sans-serif`;
  while(pieFontPx > 7 && ctx.measureText(totalLabel).width > innerW){
    pieFontPx--;
    ctx.font = `600 ${pieFontPx}px system-ui,sans-serif`;
  }
  ctx.fillText(totalLabel, cx, cy + 1);
}

/* ============================================================
   TRANSFERS BETWEEN WALLETS
============================================================ */
let transferFrom = null, transferTo = null;

function openTransferModal(){
  // default to spendable wallets (the menus only list SELECTABLE_WALLETS), and
  // stay valid even if the wallet list is reordered or shrinks
  transferFrom = SELECTABLE_WALLETS[0].id;
  transferTo = (SELECTABLE_WALLETS[1] || SELECTABLE_WALLETS[0]).id;
  renderTransferMenus();
  document.getElementById('transferAmount').value = '';
  document.getElementById('transferDate').value = todayISO();
  openModal('transferModal');
}

function renderTransferMenus(){
  ['from','to'].forEach(dir=>{
    const menu = document.getElementById('transfer'+(dir==='from'?'From':'To')+'Menu');
    const selected = dir==='from' ? transferFrom : transferTo;
    menu.innerHTML = '';
    SELECTABLE_WALLETS.forEach(w=>{
      const opt = document.createElement('div');
      opt.className = 'opt' + (w.id===selected ? ' selected' : '');
      opt.setAttribute('role','option');
      opt.tabIndex = 0;
      const val = state.wallets[w.id] ?? 0;
      opt.innerHTML = `<span>${w.name}</span><span class="bal">${fmt(val)}</span>`;
      opt.onclick = () => {
        if(dir==='from') transferFrom = w.id; else transferTo = w.id;
        const k = dir==='from'?'From':'To';
        document.getElementById('transfer'+k+'MenuWrap').classList.remove('open');
        const tb = document.getElementById('transfer'+k+'Btn');
        tb.classList.remove('open');
        tb.setAttribute('aria-expanded','false');
        renderTransferMenus();
      };
      menu.appendChild(opt);
    });
    const wDef = WALLET_DEFS.find(w=>w.id===selected);
    document.getElementById('transfer'+(dir==='from'?'From':'To')+'Label').textContent = wDef ? wDef.name : 'اختر محفظة';
  });
}
function toggleTransferMenu(dir){
  const key = dir==='from' ? 'From' : 'To';
  const wrap = document.getElementById('transfer'+key+'MenuWrap');
  const btn = document.getElementById('transfer'+key+'Btn');
  const isOpen = wrap.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
  btn.setAttribute('aria-expanded', isOpen);
}

let _doTransferBusy = false;
async function doTransfer(){
  if(_doTransferBusy) return;
  const amt = round2(parseAmount(document.getElementById('transferAmount').value)); // cent precision — match display, avoid sub-cent drift
  if(!isFinite(amt) || amt <= 0){ toast('⚠ أدخل مبلغ صحيح', true); return; }
  if(!transferFrom || !transferTo){ toast('⚠ اختر المحفظتين أولاً', true); return; }
  if(transferFrom === transferTo){ toast('⚠ اختر محفظتين مختلفتين', true); return; }
  _doTransferBusy = true;
  _txMutationStamp++; // only once committed past validation — invalid taps shouldn't bump it
  _opInFlight++;
  const _transferBtn = document.getElementById('doTransferBtn');
  _setBtnSaving(_transferBtn, true, '⏳ جارٍ التنفيذ...');
  try{
    const dateVal = document.getElementById('transferDate').value || todayISO();
    let ts = buildTxTs(dateVal);
    const fromWallet = WALLET_DEFS.find(w=>w.id===transferFrom);
    const toWallet = WALLET_DEFS.find(w=>w.id===transferTo);
    if(!fromWallet || !toWallet){ toast('⚠ محفظة غير صحيحة', true); return; }
    const fromBalance = state.wallets[transferFrom] ?? 0;
    if(!fromWallet.track && round2(fromBalance - amt) < 0){
      toast(`⚠ الرصيد غير كافٍ — المتاح: ${fmt(Math.max(0, fromBalance))}`, true);
      return;
    }
    const fromName = fromWallet.name;
    const toName = toWallet.name;

    // shared link so the two legs are deleted/undone together as one operation
    const linkId = 'lnk_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
    const txOut = {
      id: 'tx_'+Date.now()+'_a'+Math.random().toString(36).slice(2,5),
      wallet: transferFrom, desc: 'تحويل إلى ' + toName, amount: amt, type:'expense', category:'transfer', ts, link: linkId
    };
    const txIn = {
      id: 'tx_'+Date.now()+'_b'+Math.random().toString(36).slice(2,5),
      wallet: transferTo, desc: 'تحويل من ' + fromName, amount: amt, type:'income', category:'transfer', ts: ts+1, link: linkId
    };

    state.transactions.push(txOut, txIn);
    applyTxToBalance(txOut, +1);
    applyTxToBalance(txIn, +1);

    await saveBalances();
    await saveTx();
    closeModal('transferModal');
    render();
    toast('✓ تم التحويل بنجاح');
  } finally {
    _doTransferBusy = false;
    _opInFlight--;
    _setBtnSaving(_transferBtn, false);
  }
}

/* ============================================================
   WALLET DETAIL VIEW
============================================================ */
let _updateBalanceBusy = false;
async function updateTrackedBalance(){
  if(_updateBalanceBusy || !detailWalletId) return;
  const w = WALLET_DEFS.find(x=>x.id===detailWalletId);
  if(!w){ toast('⚠ المحفظة غير موجودة', true); return; } // detailWalletId could be stale
  const newVal = parseAmount(document.getElementById('detailNewBalance').value);
  if(isNaN(newVal)){ toast('⚠ أدخل رصيد صحيح', true); return; }

  const current = state.wallets[detailWalletId] ?? 0;
  const diff = round2(newVal - current);
  if(diff === 0){ toast('لا يوجد تغيير بالرصيد'); return; }

  _updateBalanceBusy = true;
  _opInFlight++;
  _txMutationStamp++; // adds an adjustment tx — invalidate stamp-keyed caches
  const _updateBalBtn = document.getElementById('updateTrackedBalanceBtn');
  _setBtnSaving(_updateBalBtn, true, '⏳...');
  try{
    const tx = {
      id: 'tx_'+Date.now()+'_adj'+Math.random().toString(36).slice(2,4),
      wallet: detailWalletId,
      desc: 'تحديث رصيد ' + w.name,
      amount: Math.abs(diff),
      type: diff > 0 ? 'income' : 'expense',
      category: 'adjustment', // excluded from pie chart and recurring detection
      ts: Date.now()
    };
    state.transactions.push(tx);
    applyTxToBalance(tx, +1);

    await saveBalances();
    await saveTx();
    render();
    openWalletDetail(detailWalletId); // refresh modal in place
    toast('✓ تم تحديث الرصيد');
  } finally {
    _updateBalanceBusy = false;
    _opInFlight--;
    _setBtnSaving(_updateBalBtn, false);
  }
}

async function saveWalletBudget(){
  if(!detailWalletId) return;
  const val = parseAmount(document.getElementById('detailBudgetInput').value);
  if(!val || val <= 0){
    delete budgets[detailWalletId];
  } else {
    budgets[detailWalletId] = val;
  }
  await saveConfig();
  renderWallets();
  toast('✓ تم حفظ الميزانية');
}

function renderDistributionEditor(){
  const wrap = document.getElementById('distributionEditor');
  wrap.innerHTML = '';
  DISTRIBUTION.forEach((d,i)=>{
    const w = WALLET_DEFS.find(x=>x.id===d.id);
    const row = document.createElement('div');
    row.className = 'dist-edit-row';
    row.innerHTML = `
      <span class="name">${w ? w.name : d.id}</span>
      <input type="number" min="0" max="100" step="any" inputmode="decimal" value="${d.pct}" data-idx="${i}">
      <span class="pct-sign">%</span>
    `;
    row.querySelector('input').oninput = (e)=>{
      DISTRIBUTION[i].pct = Math.min(100, Math.max(0, parseAmount(e.target.value) || 0));
      updateDistTotal();
    };
    wrap.appendChild(row);
  });
  const totalRow = document.createElement('div');
  totalRow.className = 'dist-total';
  totalRow.id = 'distTotalRow';
  wrap.appendChild(totalRow);
  updateDistTotal();
}

function updateDistTotal(){
  const total = DISTRIBUTION.reduce((s,d)=>s+(d.pct||0), 0);
  const el = document.getElementById('distTotalRow');
  if(!el) return;
  const display = total.toFixed(1);
  el.textContent = 'الإجمالي: ' + display + '%';
  // compare using the rounded display value so color always matches what user reads
  el.className = 'dist-total ' + (parseFloat(display) === 100 ? 'ok' : 'warn');
}

// Scale every share proportionally so the set sums to EXACTLY 100, then push any
// rounding residue onto the largest share. Keeps the income split honest so the
// distribution breakdown can never show shares that exceed (or fall short of) the
// income — the old "save anyway at 95%/120%" path misled that preview.
function normalizeDistribution(){
  const total = DISTRIBUTION.reduce((s,d)=>s+(d.pct||0), 0);
  if(!(total > 0)) return false;
  DISTRIBUTION.forEach(d=>{ d.pct = Math.round(((d.pct||0)/total)*1000)/10; }); // one decimal
  const acc = DISTRIBUTION.reduce((s,d)=>s+(d.pct||0), 0);
  const residual = Math.round((100 - acc) * 10) / 10;
  if(residual !== 0){
    let maxIdx = 0;
    DISTRIBUTION.forEach((d,i)=>{ if((d.pct||0) > (DISTRIBUTION[maxIdx].pct||0)) maxIdx = i; });
    DISTRIBUTION[maxIdx].pct = Math.round((DISTRIBUTION[maxIdx].pct + residual) * 10) / 10;
  }
  return true;
}

async function saveDistribution(){
  const total = DISTRIBUTION.reduce((s,d)=>s+(d.pct||0), 0);
  if(parseFloat(total.toFixed(1)) !== 100){
    if(!(total > 0)){ toast('⚠ أدخل نِسبًا صحيحة أولاً', true); return; }
    if(!confirm(`الإجمالي ${total.toFixed(1)}% وليس 100%.\n\nسيتم تعديل النسب تلقائيًا لتصبح 100% مع الحفاظ على تناسبها. متابعة؟`)) return;
    normalizeDistribution();
    renderDistributionEditor(); // reflect the normalized values back into the inputs
  }
  await saveConfig();
  renderWallets();
  toast('✓ تم حفظ النسب (المجموع 100٪)');
}

function resetDistribution(){
  if(!confirm('استعادة النسب الافتراضية (50/10/10/10/10/5/5)؟')) return;
  DISTRIBUTION = DEFAULT_DISTRIBUTION.map(d=>({...d}));
  renderDistributionEditor();
  saveConfig();
  renderWallets();
  toast('✓ تمت الاستعادة');
}

function openWalletDetail(walletId){
  const w = WALLET_DEFS.find(x=>x.id===walletId);
  if(!w){ toast('⚠ المحفظة غير موجودة', true); return; }
  detailWalletId = walletId;
  const currentVal = state.wallets[walletId] ?? 0;
  document.getElementById('detailTitle').textContent = (w.track?'🏦 ':'💳 ') + w.name;
  document.getElementById('detailBalance').textContent = fmt(currentVal);

  const updateWrap = document.getElementById('detailUpdateBalance');
  const budgetWrap = document.getElementById('detailBudgetSetting');
  if(w.track){
    updateWrap.style.display = 'block';
    budgetWrap.style.display = 'none';
    document.getElementById('detailNewBalance').value = currentVal;
    _updateTrackModeToggleUI(walletId); // sync the "linked expense → ينقص/يزيد" toggle
  } else {
    updateWrap.style.display = 'none';
    budgetWrap.style.display = 'block';
    document.getElementById('detailBudgetInput').value = budgets[walletId] || '';
  }

  const txs = state.transactions.filter(t=>t.wallet===walletId).sort((a,b)=>b.ts-a.ts);
  let inc=0, exp=0;
  txs.forEach(t => {
    if(t.category==='transfer' || t.category==='adjustment') return;
    t.type==='income' ? inc+=t.amount : exp+=t.amount;
  });
  document.getElementById('detailCount').textContent = txs.length;
  document.getElementById('detailIncome').textContent = fmt(inc);
  document.getElementById('detailExpense').textContent = fmt(exp);

  const list = document.getElementById('detailTxList');
  list.innerHTML = '';
  if(txs.length === 0){
    list.innerHTML = '<div class="empty" style="padding:20px;">لا توجد معاملات لهذه المحفظة</div>';
  } else {
    txs.slice(0,50).forEach(tx=>{
      const cat = getCategory(tx.category);
      const date = new Date(tx.ts);
      const sign = tx.type==='expense' ? '-' : '+';
      const cls = tx.type==='expense' ? 'neg' : 'pos';
      const div = document.createElement('div');
      div.className = 'tx';
      div.style.cursor = 'pointer';
      div.innerHTML = `
        <div class="info">
          <div class="desc">${cat.icon} ${escHtml(tx.desc || cat.name)}</div>
          <div class="meta">${date.toLocaleDateString('ar-EG',{day:'numeric',month:'short',numberingSystem:'latn'})}</div>
        </div>
        <div class="amount ${cls}">${sign}${fmt(tx.amount)}</div>
      `;
      div.onclick = () => openEdit(tx.id);
      list.appendChild(div);
    });
  }
  openModal('walletDetailModal');
}

/* ============================================================
   ANALYTICS: monthly comparison, projection, recurring detection
============================================================ */
function monthRange(monthsAgo){
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() - monthsAgo;
  const start = new Date(y, m, 1).getTime();
  const end = new Date(y, m+1, 1).getTime();
  return [start, end];
}

function sumExpenses(start, end, categoryId){
  let total = 0;
  state.transactions.forEach(tx=>{
    if(tx.type!=='expense' || tx.category==='transfer' || tx.category==='adjustment') return;
    if(tx.ts < start || tx.ts >= end) return;
    if(categoryId && tx.category !== categoryId) return;
    total += tx.amount;
  });
  return round2(total); // collapse float-accumulation residue before it feeds projections
}

let _analyticsCache = null;
let _analyticsSig = '';

function renderAnalytics(){
  const grid = document.getElementById('analyticsGrid');
  grid.innerHTML = '';

  if(!state.transactions.length){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><span class="ic">📊</span>سجّل أول معاملة من ＋ لترى تحليلاتك هنا</div>`;
    return;
  }

  const [curStart, curEnd] = monthRange(0);
  const [prevStart, prevEnd] = monthRange(1);

  // cache analytics totals — expensive full-scan, only recompute when txs change
  const aSig = state.transactions.length + '|' + (state.transactions[state.transactions.length-1]?.id||'') + '|' + curStart;
  if(aSig !== _analyticsSig || !_analyticsCache){
    _analyticsCache = { cur: sumExpenses(curStart, curEnd), prev: sumExpenses(prevStart, prevEnd) };
    _analyticsSig = aSig;
  }
  const curTotal = _analyticsCache.cur;
  const prevTotal = _analyticsCache.prev;

  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  let cmpHtml = '';
  if(prevTotal > 0 && (dayOfMonth > 1 || curTotal > 0)){
    const diff = curTotal - prevTotal;
    const pct = Math.abs(diff/prevTotal*100).toFixed(0);
    const up = diff > 0;
    cmpHtml = `<div class="sub ${up?'up':'down'}">${up?'▲':'▼'} ${pct}% عن الشهر الماضي</div>`;
  } else {
    cmpHtml = `<div class="sub">لا توجد بيانات للشهر الماضي</div>`;
  }
  grid.innerHTML += `
    <div class="analytics-card">
      <div class="l">مصروف هذا الشهر</div>
      <div class="v">${fmt(curTotal)}</div>
      ${cmpHtml}
    </div>`;
  let projHtml;
  if(dayOfMonth >= 3 && curTotal > 0){
    const dailyRate = curTotal / dayOfMonth;
    const projected = dailyRate * daysInMonth;
    projHtml = `
      <div class="analytics-card">
        <div class="l">المتوقع نهاية الشهر</div>
        <div class="v">${fmt(projected)}</div>
        <div class="sub">بمعدل ${fmt(dailyRate)} / يوم</div>
      </div>`;
  } else {
    projHtml = `
      <div class="analytics-card">
        <div class="l">المتوقع نهاية الشهر</div>
        <div class="v">—</div>
        <div class="sub">يحتاج بيانات أكثر</div>
      </div>`;
  }
  grid.innerHTML += projHtml;
}

let _recurringCache = null;
let _recurringCacheSig = '';
function detectRecurring(){
  // _recurringCache is nulled on every render(); this inner sig only guards
  // against duplicate calls within the same render cycle (e.g. from renderWallets
  // and renderRecurring both running). descLen was O(n) and redundant here.
  const sig = state.transactions.length + '|' + (state.transactions[state.transactions.length-1]?.id||'') + '|' + dismissedRecurring.size + '|' + subscriptions.length;
  if(sig === _recurringCacheSig && _recurringCache) return _recurringCache;
  _recurringCacheSig = sig;

  const groups = {};
  state.transactions.forEach(tx=>{
    if(tx.type!=='expense' || tx.category==='transfer' || tx.category==='adjustment') return;
    // normalizeSearch folds Arabic orthographic variants (alef/ya/teh-marbuta,
    // tashkeel) so "نتفلكس" and "نتفلیکس" group as the same recurring pattern
    // instead of being treated as unrelated one-off transactions (see normalizeSearch).
    const key = normalizeSearch(tx.desc) + '\x00' + tx.wallet;
    if(!key.split('\x00')[0]) return;
    if(!groups[key]) groups[key] = [];
    groups[key].push(tx);
  });

  // Tracked subscriptions the user already accepted shouldn't be re-suggested —
  // compare normalized name + amount within 15% (same tolerance as the variance
  // check below) so the matching transaction group is skipped entirely.
  const trackedSubs = subscriptions.map(s => ({ name: normalizeSearch(s.name), amount: s.amount }));
  function matchesTrackedSub(desc, avg){
    const normDesc = normalizeSearch(desc);
    return trackedSubs.some(s =>
      (normDesc.includes(s.name) || s.name.includes(normDesc)) &&
      Math.abs(avg - s.amount) / s.amount < 0.15
    );
  }

  const suggestions = [];
  Object.entries(groups).forEach(([key, txs])=>{
    if(txs.length < 2) return;
    const months = new Set(txs.map(t=>{
      const d = new Date(t.ts);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    }));
    if(months.size < 2) return;
    if(dismissedRecurring.has(key)) return;

    const amounts = txs.map(t=>t.amount);
    const avg = amounts.reduce((a,b)=>a+b,0)/amounts.length;
    const variance = avg > 0 && amounts.every(a => Math.abs(a-avg)/avg < 0.15);
    if(!variance) return;
    if(matchesTrackedSub(txs[0].desc, avg)) return;

    suggestions.push({ key, desc: txs[0].desc, avg, count: txs.length, wallet: txs[0].wallet, category: txs[0].category });
    // key = "desc\x00walletId" — dismiss per wallet so same desc in two wallets shows two suggestions
  });
  _recurringCache = suggestions.slice(0,3);
  return _recurringCache;
}

function renderRecurring(){
  const box = document.getElementById('recurringBox');
  const suggestions = detectRecurring();
  box.innerHTML = '';
  suggestions.forEach(s=>{
    const wallet = WALLET_DEFS.find(w=>w.id===s.wallet);
    const cat = getCategory(s.category);
    const card = document.createElement('div');
    card.className = 'recurring-card';
    card.innerHTML = `
      <div class="title">🔁 معاملة متكررة محتملة</div>
      <div class="desc">${cat.icon} "${escHtml(s.desc)}" — تكررت ${s.count} مرات بمتوسط ${fmt(s.avg)} (${escHtml(wallet?wallet.name:'')})</div>
      <div class="actions">
        <button class="btn-secondary" data-dismiss="${escHtml(s.key)}">تجاهل</button>
        <button class="btn-primary" data-remind="${escHtml(s.key)}">⏰ سجّلها الآن</button>
      </div>
    `;
    card.querySelector('[data-dismiss]').onclick = () => {
      dismissedRecurring.add(s.key);
      saveConfig();
      renderRecurring();
    };
    card.querySelector('[data-remind]').onclick = () => {
      document.getElementById('descInput').value = s.desc;
      const amtEl = document.getElementById('amountInput');
      amtEl.value = round2(s.avg);
      amtEl.dispatchEvent(new Event('input')); // sync quick-amount highlight
      selectedWallet = s.wallet;
      // recurring suggestions are always expenses — ensure form is in expense mode
      // before setting category so the grid renders the correct type and the category
      // chip is visible and highlighted
      setAddFormType('expense');
      selectedCategory = s.category;
      selectedTrackWallet = null; // suggestion carries no tracked link — don't leak a stale selection
      renderWalletSelect();
      renderCategoryGrid();
      renderTrackLinkPicker();
      dismissedRecurring.add(s.key);
      saveConfig();
      renderRecurring();
      openAddDrawer();
      switchDrawerTab(0);
      toast('✓ تم تعبية النموذج — راجع وسجّل المعاملة');
    };
    box.appendChild(card);
  });
}

function setFilter(f){
  currentFilter = f;
  _txVisibleCount = 50;
  document.querySelectorAll('.filters button').forEach(b=>{
    b.classList.toggle('active', b.dataset.f === f);
  });
  renderTxList();
  renderChart();
  renderPieChart(); // pie depends on the active time range (inRange)
  scrollToTxList();
}

function inRange(ts, now){
  // `now` may be passed in by a batch caller (getFilteredTx) so we don't
  // allocate a fresh Date per transaction across thousands of rows.
  if(!now) now = new Date();
  const d = new Date(ts);
  if(currentFilter === 'all') return true;
  if(currentFilter === 'day') return d.toDateString() === now.toDateString();
  if(currentFilter === 'week'){
    // calendar week starting Saturday (Gulf locale) — consistent with the
    // calendar-based month/year filters instead of a ragged rolling 7-day window
    const start = new Date(now);
    start.setHours(0,0,0,0);
    start.setDate(start.getDate() - ((now.getDay() + 1) % 7)); // back to Saturday
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return d >= start && d < end;
  }
  if(currentFilter === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if(currentFilter === 'year') return d.getFullYear() === now.getFullYear();
  return true;
}

let _searchDebounce = null;
let _txVisibleCount = 50;
let _recentVisibleCount = RECENT_TX_LIMIT_DEFAULT; // transactions tab — full chronological log, paginated (page size = recentTxLimit)
let _allTxSortedCache = null; // cached newest-first copy of all tx (see getAllTxSorted)
// Fold Arabic orthographic variants so search is forgiving: a user typing
// "قهوه" should match "قهوة", "احمد" should match "أحمد", "مصطفى" ↔ "مصطفي".
// Also strips tashkeel (diacritics) and tatweel, and lowercases Latin text.
function normalizeSearch(str){
  return String(str || '')
    .replace(/[ً-ٰٟ]/g, '') // tashkeel/diacritics (full Arabic diacritic range)
    .replace(/ـ/g, '')                 // tatweel (ـ)
    .replace(/[أإآ]/g, 'ا')                  // alef variants → ا
    .replace(/ى/g, 'ي')                      // alef maqsura → ي
    .replace(/ة/g, 'ه')                      // teh marbuta → ه
    .replace(/[ؤئ]/g, 'ء')                   // hamza seats → ء
    .toLowerCase()
    .trim();
}

function onSearchInput(){
  const raw = document.getElementById('searchInput').value;
  searchQuery = normalizeSearch(raw);
  // show clear-button based on raw input (not trimmed) so typing spaces still shows the X
  document.getElementById('searchBox').classList.toggle('has-text', raw.length > 0);
  _txVisibleCount = 50;
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(()=>{ renderTxList(); scrollToTxList(); }, 150);
}
function clearSearch(){
  searchQuery = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('searchBox').classList.remove('has-text');
  _txVisibleCount = 50;
  renderTxList();
}

let _filteredTxCache = null;
let _filteredTxSig = '';
function getFilteredTx(){
  // include today's date for every time-bounded filter (day/week/month/year all
  // shift at a day boundary) so the cache invalidates across a midnight/month/
  // year rollover instead of showing the previous period's transactions
  const dateKey = currentFilter === 'all' ? '' : todayISO();
  const sig = state.transactions.length + '|' + currentFilter + '|' + walletFilter + '|' + categoryFilter + '|' + searchQuery + '|' + dateKey;
  if(sig === _filteredTxSig && _filteredTxCache) return _filteredTxCache;
  _filteredTxSig = sig;
  const _now = new Date(); // compute once for the whole filter pass (not per-tx)
  _filteredTxCache = state.transactions
    .filter(tx => inRange(tx.ts, _now))
    .filter(tx => !walletFilter || tx.wallet === walletFilter)
    .filter(tx => !categoryFilter || (tx.category||'other') === categoryFilter)
    .filter(tx => {
      if(!searchQuery) return true;
      const wallet = WALLET_DEFS.find(w=>w.id===tx.wallet);
      const cat = getCategory(tx.category);
      // search description, wallet name AND category name (so "طعام" finds food
      // transactions even when the description is empty)
      const hay = normalizeSearch((tx.desc||'') + ' ' + (wallet?wallet.name:'') + ' ' + (cat?cat.name:''));
      return hay.includes(searchQuery);
    });
  // sort once here (newest-first) and cache — the tx list and the chart both
  // consumed this and each re-sorted the whole array on EVERY render(). Doing it
  // inside the cached builder means an unchanged filter costs zero sorts on
  // subsequent renders (theme toggle, balance edits, etc.), and a data change
  // costs one sort instead of two. The chart just reverses this for ascending.
  _filteredTxCache.sort((a,b)=> (b.ts - a.ts) || String(b.id).localeCompare(String(a.id)));
  return _filteredTxCache;
}

/* ============================================================
   RENDER: TX LIST + SUMMARY
============================================================ */
function renderTxList(){
  const list = document.getElementById('txList');
  list.setAttribute('role','list');
  list.innerHTML = '';
  // getFilteredTx() is already cached AND sorted newest-first — use it directly
  // (read-only here; the visible slice below makes its own copy)
  const filtered = getFilteredTx();

  let income = 0, expense = 0;
  filtered.forEach(tx => {
    // exclude inter-wallet transfers AND manual balance adjustments so the
    // income/expense summary matches the category pie chart (which excludes both)
    if(tx.category === 'transfer' || tx.category === 'adjustment') return;
    if(tx.type === 'income') income += tx.amount;
    else expense += tx.amount;
  });
  income = round2(income); expense = round2(expense);
  document.getElementById('sumIncome').textContent = fmt(income);
  document.getElementById('sumExpense').textContent = fmt(expense);
  document.getElementById('sumNet').textContent = fmt(income - expense);
  document.getElementById('sumNet').style.color = (income-expense) >= 0 ? 'var(--green)' : 'var(--red)';

  if(filtered.length === 0){
    if(state.transactions.length === 0 && !searchQuery && currentFilter==='all'){
      list.innerHTML = `<div class="empty"><span class="ic">🗂</span>لا توجد معاملات بعد.<br><br>
        <button class="btn-primary" onclick="document.querySelector('.fab-btn').click()" style="width:auto; padding:10px 20px; display:inline-block; margin-bottom:8px;">＋ أضف أول معاملة</button><br>
        <button class="btn-secondary" onclick="openModal('dataModal')" style="width:auto; padding:8px 16px; display:inline-block; font-size:12px;">⬆ استيراد من JSON</button>
      </div>`;
    } else {
      list.innerHTML = `<div class="empty"><span class="ic">🗂</span>لا توجد معاملات${searchQuery ? ' مطابقة لبحثك' : ' في هذه الفترة'}</div>`;
    }
    return;
  }

  let lastDay = null;
  const visible = filtered.slice(0, _txVisibleCount);
  visible.forEach(tx => {
    const wallet = WALLET_DEFS.find(w => w.id === tx.wallet);
    const date = new Date(tx.ts);
    const dayKey = date.toDateString();
    if(dayKey !== lastDay){
      lastDay = dayKey;
      const lbl = document.createElement('div');
      lbl.className = 'tx-day-label';
      const isToday = dayKey === new Date().toDateString();
      // step back one calendar day (not 24h) so DST transition days still label correctly
      const _yest = new Date(); _yest.setDate(_yest.getDate()-1);
      const isYesterday = dayKey === _yest.toDateString();
      lbl.textContent = isToday ? 'اليوم' : isYesterday ? 'أمس' : date.toLocaleDateString('ar-EG', {weekday:'long', day:'numeric', month:'long', numberingSystem:'latn'});
      list.appendChild(lbl);
    }

    const wrap = document.createElement('div');
    wrap.className = 'tx-wrap';
    wrap.setAttribute('role','listitem');

    const bg = document.createElement('div');
    bg.className = 'tx-swipe-bg';
    bg.innerHTML = '🗑 حذف';

    const div = document.createElement('div');
    div.className = 'tx';
    const sign = tx.type === 'expense' ? '-' : '+';
    const cls = tx.type === 'expense' ? 'neg' : 'pos';
    const timeStr = date.toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit', numberingSystem:'latn'});
    const cat = getCategory(tx.category);
    div.innerHTML = `
      <div class="info">
        <div class="desc">${escHtml(tx.desc || (wallet ? wallet.name : ''))}</div>
        <div class="meta"><span class="ctag">${cat.icon}</span><span class="wtag">${escHtml(wallet ? wallet.name : '')}</span> ${timeStr}${_trackLinkTag(tx)}</div>
      </div>
      <div class="right">
        <div class="amount ${cls}">${sign}${fmt(tx.amount)}</div>
        <button class="edit-btn" aria-label="تعديل">✎</button>
      </div>
    `;
    // Accessible name for the whole row so a screen reader announces what this
    // transaction is, not just the bare amount + an isolated "تعديل" button.
    div.setAttribute('aria-label',
      `${tx.type==='expense'?'مصروف':'دخل'} ${fmt(tx.amount)}، ${tx.desc || (wallet?wallet.name:'')}، ${cat.name}، ${date.toLocaleDateString('ar-EG',{day:'numeric',month:'long',numberingSystem:'latn'})} ${timeStr}`);
    div.dataset.txid = tx.id; // delegated swipe handler reads the id from here
    div.querySelector('.edit-btn').onclick = (e) => { e.stopPropagation(); if(!div._swipeDeleting) openEdit(tx.id); };
    div.onclick = () => { if(!div._swipeDeleting) openEdit(tx.id); };

    wrap.appendChild(bg);
    wrap.appendChild(div);
    list.appendChild(wrap);
  });

  // One set of delegated touch listeners on the list container (bound once),
  // instead of 4 listeners per row that accumulated on every re-render.
  bindSwipeDelegation(list);

  if(filtered.length > _txVisibleCount){
    const remaining = filtered.length - _txVisibleCount;
    const more = document.createElement('button');
    more.className = 'btn-secondary';
    more.style.cssText = 'margin:10px auto; display:block; width:auto; padding:10px 24px; font-size:13px;';
    const toShow = Math.min(remaining, 50);
    const afterLoad = remaining - toShow;
    more.textContent = afterLoad > 0
      ? `⬇ عرض ${arPlural(toShow, 'معاملة', 'معاملتين', 'معاملات')} (${arPlural(afterLoad, 'ستبقى مخفية', 'ستبقيان مخفيتين', 'ستبقى مخفية', 'واحدة ستبقى مخفية')})`
      : `⬇ عرض ${arPlural(toShow, 'المعاملة المتبقية', 'المعاملتين المتبقيتين', 'المعاملات المتبقية', 'المعاملة المتبقية')}`;
    more.onclick = () => { _txVisibleCount += 50; renderTxList(); };
    list.appendChild(more);
  }
}

/* ============================================================
   SWIPE TO DELETE (touch) — event delegation
============================================================ */
// Bind ONCE on the list container (#txList). Rows are recreated on every render
// via innerHTML='', so per-row listeners used to accumulate (4 × rows × every
// re-render) until GC. Delegation keeps exactly 4 listeners for the whole list
// regardless of how many transactions or re-renders occur.
function bindSwipeDelegation(list){
  if(!list || list._swipeBound) return;
  list._swipeBound = true;
  const threshold = 90;
  const edgeZone = 24; // px from either screen edge reserved for the OS back-swipe gesture
  let el = null, txId = null, startX = 0, startY = 0, currentX = 0, dragging = false, swipeMode = false;

  const reset = () => { el = null; dragging = false; swipeMode = false; currentX = 0; };

  list.addEventListener('touchstart', e=>{
    const row = e.target.closest && e.target.closest('.tx');
    if(!row || row._swipeDeleting){ reset(); return; } // not on a row / mid-delete
    startX = e.touches[0].clientX;
    // A touch starting inside the OS back-swipe edge zone (iOS Safari / Android
    // Chrome gesture nav both watch the outer ~20px) must be left alone — claiming
    // it here would fight the OS gesture and produce a half-swiped, half-navigated
    // row instead of either a clean delete or a clean back-navigation.
    if(startX < edgeZone || startX > window.innerWidth - edgeZone){ reset(); return; }
    el = row;
    txId = row.dataset.txid;
    startY = e.touches[0].clientY;
    dragging = true;
    swipeMode = false;
    el.style.transition = 'none';
    // Promote to a compositor layer only for the gesture — avoids permanently
    // allocating a GPU layer for every row (memory anti-pattern).
    el.style.willChange = 'transform';
  }, {passive:true});

  list.addEventListener('touchmove', e=>{
    if(!dragging || !el) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if(!swipeMode){
      if(Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10){ swipeMode = true; }
      else if(Math.abs(dy) > 10){ dragging = false; return; }
      else return;
    }
    e.preventDefault(); // stop pull-to-refresh and scroll during confirmed horizontal swipe
    currentX = dx;
    if(currentX > 0) currentX = 0;
    el.style.transform = `translateX(${currentX}px)`;
  }, {passive:false});

  const finish = (cancelled)=>{
    if(!dragging || !el){ reset(); return; }
    const node = el, id = txId, dist = currentX;
    dragging = false; swipeMode = false;
    node.style.transition = 'transform .25s var(--ease)';
    if(!cancelled && Math.abs(dist) > threshold){
      node.style.transform = 'translateX(-100%)';
      node.style.opacity = '0';
      node._swipeDeleting = true;
      setTimeout(()=> deleteTx(id), 220);
    } else {
      node.style.transform = 'translateX(0)';
      node.style.opacity = ''; // restore if a previous swipe started fading it
    }
    node.style.willChange = ''; // release compositor layer — gesture is over
    el = null; currentX = 0;
  };
  list.addEventListener('touchend', ()=> finish(false));
  list.addEventListener('touchcancel', ()=> finish(true)); // call/interrupt — snap back, no delete
}

/* ============================================================
   CHART — running balance line over filtered period
============================================================ */
function renderChart(){
  const canvas = document.getElementById('chartCanvas');
  const emptyEl = document.getElementById('chartEmpty');
  if(!canvas || !emptyEl) return; // guard against missing DOM (e.g. while loading)
  const ctx = canvas.getContext('2d');
  if(!ctx){ emptyEl.style.display='block'; canvas.style.display='none'; return; }
  const dpr = window.devicePixelRatio || 1;
  const cssW = (canvas.parentElement?.clientWidth || 400) - 28;
  if(cssW < 50){ emptyEl.style.display='block'; canvas.style.display='none'; return; }
  const cssH = 130;
  canvas.width = cssW*dpr; canvas.height = cssH*dpr;
  canvas.style.width = cssW+'px'; canvas.style.height = cssH+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);

  // cached list is newest-first; chart needs oldest-first — reverse a copy (O(n),
  // cheaper than the full re-sort this used to do on every render)
  const filtered = getFilteredTx().slice().reverse();
  if(filtered.length < 2){
    emptyEl.style.display = 'block';
    canvas.style.display = 'none';
    document.getElementById('chartNet').textContent = '';
    return;
  }
  emptyEl.style.display = 'none';
  canvas.style.display = 'block';

  const netChange = filtered.reduce((s,tx)=> s + (tx.type==='income' ? tx.amount : -tx.amount), 0);
  let running = walletFilter ? ((state.wallets[walletFilter] ?? 0) - netChange) : 0;
  const points = filtered.map(tx => {
    running += (tx.type==='income' ? tx.amount : -tx.amount);
    return running;
  });
  points.unshift(walletFilter ? ((state.wallets[walletFilter] ?? 0) - netChange) : 0);

  const min = Math.min(...points);
  const max = Math.max(...points);
  // when every point is identical the spread is 0; draw the line through the
  // vertical centre instead of pinning it to the bottom (range fallback of 1)
  const flat = max === min;
  const range = flat ? 1 : (max - min);
  const padX = 6, padY = 14, padYAxisLabel = 44;
  const w = cssW - padX*2 - padYAxisLabel;
  const h = cssH - padY*2;
  const yOf = p => flat ? (padY + h/2) : (padY + h - ((p - min) / range) * h);

  // theme-aware grid color (light vs dark) — hardcoded white was invisible in light mode
  const isLightTheme = document.body.classList.contains('light');
  ctx.strokeStyle = isLightTheme ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  for(let i=0;i<=2;i++){
    const y = padY + (h/2)*i;
    ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(padX+w,y); ctx.stroke();
  }

  const zeroY = yOf(0);
  ctx.strokeStyle = isLightTheme ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.12)';
  ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(padX,zeroY); ctx.lineTo(padX+w,zeroY); ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  points.forEach((p,i)=>{
    const x = padX + (w * i/(points.length-1));
    const y = yOf(p);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  const finalNet = points[points.length-1];
  // Read from CSS variables so the chart adapts to light/dark theme (cached)
  const colorPos = themeColor('--green', '#86c39a');
  const colorNeg = themeColor('--red', '#e3918f');
  const lineColor = finalNet >= 0 ? colorPos : colorNeg;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2.25;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  const grad = ctx.createLinearGradient(0,0,0,cssH);
  const isLightForChart = document.body.classList.contains('light');
  const gradTop = finalNet>=0
    ? (isLightForChart ? 'rgba(62,141,89,.18)'   : 'rgba(134,195,154,.20)')
    : (isLightForChart ? 'rgba(192,90,87,.18)'   : 'rgba(227,145,143,.20)');
  grad.addColorStop(0, gradTop);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.lineTo(padX+w, padY+h);
  ctx.lineTo(padX, padY+h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  const lastX = padX + w;
  const lastY = yOf(finalNet);
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI*2);
  ctx.fillStyle = lineColor;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lastX, lastY, 7, 0, Math.PI*2);
  ctx.strokeStyle = lineColor + '55';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Y-axis labels on the inline-end side (right in LTR, but canvas ignores dir)
  const labelX = padX + w + 6;
  const labelColor = isLightTheme ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.38)';
  ctx.fillStyle = labelColor;
  ctx.font = `600 9px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const fmtShort = n => {
    const abs = Math.abs(n);
    const s = n < 0 ? '-' : '';
    if(abs >= 1e6) return s + (abs/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
    if(abs >= 1e3) return s + (abs/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
    return s + Math.round(abs);
  };
  if(!flat){
    ctx.fillText(fmtShort(max), labelX, padY);
    ctx.fillText(fmtShort(min), labelX, padY + h);
  }
  if(min < 0 && max > 0){
    ctx.fillStyle = isLightTheme ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.25)';
    ctx.fillText('0', labelX, yOf(0));
  }

  const netBadge = document.getElementById('chartNet');
  netBadge.textContent = (finalNet>=0?'+':'') + fmt(finalNet);
  netBadge.style.color = lineColor;
}

