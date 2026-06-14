
/* ============================================================
   CONFIG
============================================================ */
const WALLET_DEFS = [
  {id:'core',        name:'Core Expenses',  initial:3830,    track:false, pct:'50%'},
  {id:'wishlist',    name:'Wishlist',       initial:783,     track:false, pct:'10%'},
  {id:'growth',      name:'Growth',         initial:783,     track:false, pct:'10%'},
  {id:'investments', name:'Investments',    initial:783,     track:false, pct:'10%'},
  {id:'joy',         name:'Joy of Life',    initial:783,     track:false, pct:'10%'},
  {id:'giving',      name:'Giving',         initial:391.5,   track:false, pct:'5%'},
  {id:'reserve',     name:'Reserve',        initial:391.5,   track:false, pct:'5%'},
  {id:'uber',        name:'Uber',           initial:1984.23, track:true,  pct:'تتبع'},
  {id:'cards',       name:'Bank Cards',     initial:296477,  track:true,  pct:'تتبع'},
  {id:'cash',        name:'Cash',           initial:8000,    track:true,  pct:'تتبع'},
];
const MAX_WALLET_VAL = WALLET_DEFS.filter(w=>!w.track).reduce((m,w)=>Math.max(m,w.initial),1);
const CRISIS_WALLET_IDS = ['growth','investments','joy','giving','reserve'];

const CATEGORIES = [
  {id:'food',          types:['expense'],          name:'طعام وشراب',   icon:'🍽️', color:'#e3a07a'},
  {id:'transport',     types:['expense'],          name:'مواصلات',      icon:'🚗', color:'#86adcf'},
  {id:'shopping',      types:['expense'],          name:'تسوق',         icon:'🛍️', color:'#dcb674'},
  {id:'bills',         types:['expense'],          name:'فواتير',       icon:'🧾', color:'#a78bd6'},
  {id:'health',        types:['expense'],          name:'صحة',          icon:'💊', color:'#86c39a'},
  {id:'entertainment', types:['expense'],          name:'ترفيه',        icon:'🎮', color:'#e3918f'},
  {id:'salary',        types:['income'],           name:'راتب/دخل',     icon:'💼', color:'#7fcf9f'},
  {id:'transfer',      types:['expense','income'], name:'تحويل',        icon:'🔁', color:'#9aa0ad'},
  {id:'other',         types:['expense','income'], name:'أخرى',         icon:'✨', color:'#8d94a3'},
];
const QUICK_AMOUNTS = [250, 500, 1000, 2000, 5000, 10000];
const SELECTABLE_WALLETS = WALLET_DEFS.filter(w => !w.track);

// Wallets that participate in automatic income distribution, with their share %
const DEFAULT_DISTRIBUTION = [
  {id:'core',        pct:50},
  {id:'wishlist',    pct:10},
  {id:'growth',      pct:10},
  {id:'investments', pct:10},
  {id:'joy',         pct:10},
  {id:'giving',      pct:5},
  {id:'reserve',     pct:5},
];
let DISTRIBUTION = DEFAULT_DISTRIBUTION.map(d=>({...d}));

let state = { wallets:{}, transactions:[], crisisMode:false };
let currentFilter = 'all';
let walletFilter = null;
let categoryFilter = null;
let selectedWallet = WALLET_DEFS[0].id;
let editingTxId = null;
let editType = 'expense';
let editWallet = WALLET_DEFS[0].id;
let _editingTransferLeg = false; // when true, type/category are locked (transfer)
let searchQuery = '';
let prevSpendable = null;
let selectedCategory = 'other';
let editCategory = 'other';
let addFormType = 'expense';
let detailWalletId = null; // when set, shows wallet detail view
let pendingIncomeTx = null;
let autoDistribute = false;
let budgets = {}; // walletId -> monthly budget limit (expenses)
let dismissedRecurring = new Set();

/* ============================================================
   FORMAT HELPERS
============================================================ */
function fmt(n){
  if(isNaN(n) || !isFinite(n)) return '0.00';
  // collapse -0 and sub-cent negatives so they never render as "-0.00"
  if(Object.is(n, -0) || (n < 0 && n > -0.005)) n = 0;
  const s = Number(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  return s === '-0.00' ? '0.00' : s;
}

// Normalize Arabic-Indic (٠-٩) and Persian (۰-۹) digits + Arabic decimal/thousands
// separators to ASCII so amount fields accept numbers typed on Arabic keyboards.
function normalizeDigits(str){
  return String(str == null ? '' : str)
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٫]/g, '.')   // Arabic decimal separator
    .replace(/[٬,]/g, '');  // Arabic + Latin thousands separators
}
// Parse a user-entered money string robustly (Arabic numerals, separators).
function parseAmount(str){
  return parseFloat(normalizeDigits(str));
}

function escHtml(str){
  return String(str||'')
    // strip Unicode bidi embedding/override/isolate controls — a pasted or voiced
    // description containing e.g. U+202E can otherwise visually scramble the whole
    // RTL layout of surrounding UI text ("Trojan Source"-style display corruption)
    .replace(/[‪-‮⁦-⁩]/g,'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#x27;');
}

const _animFrames = {}; // track active animation frames per element id to allow cancellation
function animateNumber(el, from, to, duration){
  if(!el) return; // guard against missing/detached DOM element
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    el.textContent = fmt(to);
    return;
  }
  if(_animFrames[el.id]) cancelAnimationFrame(_animFrames[el.id]);
  const start = performance.now();
  function frame(now){
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.textContent = fmt(from + (to - from) * eased);
    if(t < 1) _animFrames[el.id] = requestAnimationFrame(frame);
    else delete _animFrames[el.id];
  }
  _animFrames[el.id] = requestAnimationFrame(frame);
}
/* ============================================================
   THEME (dark / light)
============================================================ */
function applyTheme(theme){
  document.body.classList.toggle('light', theme === 'light');
  const btn = document.getElementById('themeToggle');
  if(btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', theme === 'light' ? '#f4f2ed' : '#15171c');
  // keep the installed PWA splash/chrome color in sync with the chosen theme
  if(typeof applyManifest === 'function') applyManifest(theme === 'light');
}
function toggleTheme(){
  const isLight = document.body.classList.contains('light');
  const next = isLight ? 'dark' : 'light';
  applyTheme(next);
  try{ localStorage.setItem(LS_PREFIX + 'theme', next); }catch(e){}
  // canvas charts bake theme colors at draw time — redraw so they match the new theme
  if(typeof renderChart === 'function') renderChart();
  if(typeof renderPieChart === 'function') renderPieChart();
}
function initTheme(){
  let theme = null;
  try{ theme = localStorage.getItem(LS_PREFIX + 'theme'); }catch(e){}
  if(!theme){
    theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  applyTheme(theme);
}

function todayISO(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// Cap all date pickers at today so a transaction can't be accidentally future-dated
function capDateInputsToToday(){
  const t = todayISO();
  ['dateInput','editDate','transferDate'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.setAttribute('max', t);
  });
}

/* ============================================================
   STORAGE
============================================================ */
const LS_PREFIX = 'walletTracker_';

async function loadState(){
  state.wallets = {};
  WALLET_DEFS.forEach(w => state.wallets[w.id] = 0);
  state.transactions = [];
  state.crisisMode = false;

  try{
    const bal = localStorage.getItem(LS_PREFIX + 'balances');
    if(bal){
      const saved = JSON.parse(bal);
      // only restore known wallet ids — prevents orphaned keys from corrupted imports
      WALLET_DEFS.forEach(w => { if(saved[w.id] !== undefined) state.wallets[w.id] = saved[w.id]; });
    }
  }catch(e){}

  try{
    const tx = localStorage.getItem(LS_PREFIX + 'transactions');
    if(tx){
      const parsed = JSON.parse(tx);
      state.transactions = Array.isArray(parsed) ? parsed.filter(t =>
        t && (t.type === 'income' || t.type === 'expense') &&
        typeof t.ts === 'number' && isFinite(t.ts) && t.ts > 0 &&
        typeof t.amount === 'number' && isFinite(t.amount) && t.amount > 0 &&
        WALLET_DEFS.find(w => w.id === t.wallet)
      ) : [];
    }
  }catch(e){}

  try{
    const cfg = localStorage.getItem(LS_PREFIX + 'config');
    if(cfg){
      const c = JSON.parse(cfg);
      state.crisisMode = !!c.crisisMode;
      autoDistribute = !!c.autoDistribute;
      if(c.budgets && typeof c.budgets === 'object'){
        budgets = {};
        WALLET_DEFS.forEach(w => {
          const v = parseFloat(c.budgets[w.id]);
          if(isFinite(v) && v > 0) budgets[w.id] = v;
        });
      }
      if(c.distribution && Array.isArray(c.distribution) && c.distribution.length){
        DISTRIBUTION = c.distribution.filter(d => WALLET_DEFS.find(w=>w.id===d.id));
        if(!DISTRIBUTION.length) DISTRIBUTION = DEFAULT_DISTRIBUTION.map(d=>({...d}));
      }
      dismissedRecurring = new Set(c.dismissedRecurring || []);
    }
  }catch(e){}

  // IDB fallback: restore when localStorage was never written (browser cleared
  // storage) OR when the IndexedDB snapshot is strictly newer than the last
  // successful localStorage write. The latter covers the case where a quota
  // error blocked the localStorage save but idbBackup still captured the change
  // (idbBackup runs outside the save try/catch), which would otherwise lose the
  // most recent transactions on reload.
  const _lsLastEdit = parseInt(localStorage.getItem(LS_PREFIX + 'lastEdit') || '0', 10) || 0;
  const _idb = await idbRestore();
  const _idbNewer = _idb && typeof _idb.savedAt === 'number' && isFinite(_idb.savedAt) && _idb.savedAt > _lsLastEdit;
  if((!_lsLastEdit || _idbNewer)){
    if(_idb && Array.isArray(_idb.transactions) && _idb.transactions.length){
      // apply same guards as the main load path — known wallets only, valid transactions
      if(_idb.wallets) WALLET_DEFS.forEach(w => { if(_idb.wallets[w.id] !== undefined) state.wallets[w.id] = _idb.wallets[w.id]; });
      state.transactions = _idb.transactions.filter(tx =>
        tx && typeof tx.ts === 'number' && isFinite(tx.ts) && tx.ts > 0 &&
        typeof tx.amount === 'number' && isFinite(tx.amount) && tx.amount > 0 &&
        (tx.type === 'income' || tx.type === 'expense') &&
        WALLET_DEFS.find(w => w.id === tx.wallet)
      );
      if(typeof _idb.crisisMode === 'boolean') state.crisisMode = _idb.crisisMode;
      if(typeof _idb.autoDistribute === 'boolean') autoDistribute = _idb.autoDistribute;
      if(_idb.budgets && typeof _idb.budgets === 'object') budgets = sanitizeBudgets(_idb.budgets);
      if(Array.isArray(_idb.dismissedRecurring)) dismissedRecurring = new Set(_idb.dismissedRecurring);
      if(_idb.distribution && Array.isArray(_idb.distribution)) DISTRIBUTION = sanitizeDistribution(_idb.distribution);
      toast('✓ تمت استعادة البيانات من النسخ الاحتياطي');
    }
  }

  // IndexedDB backup (best-effort, non-blocking). Stamp with the freshest known
  // time so we never downgrade a snapshot that is still newer than localStorage
  // (otherwise a quota-recovery marker would be lost before the next save).
  const _backupStamp = Math.max(_lsLastEdit, (_idb && typeof _idb.savedAt === 'number' && isFinite(_idb.savedAt)) ? _idb.savedAt : 0);
  idbBackup(_backupStamp || Date.now());

  document.getElementById('dateInput').value = todayISO();
  capDateInputsToToday();
  render(true);
}

async function saveBalances(){ const ts = Date.now(); try{ localStorage.setItem(LS_PREFIX + 'balances', JSON.stringify(state.wallets)); localStorage.setItem(LS_PREFIX + 'lastEdit', String(ts)); }catch(e){ toast('⚠ فشل الحفظ المحلي — يتم الحفظ في النسخة الاحتياطية', true); } scheduleDriveSync(); idbBackup(ts); }
async function saveTx(){ const ts = Date.now(); try{ localStorage.setItem(LS_PREFIX + 'transactions', JSON.stringify(state.transactions)); localStorage.setItem(LS_PREFIX + 'lastEdit', String(ts)); }catch(e){ toast('⚠ فشل الحفظ المحلي — يتم الحفظ في النسخة الاحتياطية', true); } scheduleDriveSync(); idbBackup(ts); }
function _pruneRecurringDismissals(){
  if(dismissedRecurring.size < 40) return;
  const live = new Set(state.transactions.map(tx=>(tx.desc||'').trim().toLowerCase()).filter(Boolean));
  for(const k of dismissedRecurring){ if(!live.has(k)) dismissedRecurring.delete(k); }
}
async function saveConfig(){ const ts = Date.now(); _pruneRecurringDismissals(); try{ localStorage.setItem(LS_PREFIX + 'config', JSON.stringify({crisisMode: state.crisisMode, autoDistribute: autoDistribute, budgets: budgets, dismissedRecurring: Array.from(dismissedRecurring), distribution: DISTRIBUTION})); localStorage.setItem(LS_PREFIX + 'lastEdit', String(ts)); }catch(e){ toast('⚠ فشل حفظ الإعدادات محليًا', true); } scheduleDriveSync(); idbBackup(ts); }

/* ============================================================
   INDEXEDDB BACKUP (extra resilience alongside localStorage)
============================================================ */
let _idbInstance = null;
function idbOpen(){
  return new Promise((resolve, reject)=>{
    if(_idbInstance){ resolve(_idbInstance); return; }
    if(!('indexedDB' in window)){ reject('no idb'); return; }
    const req = indexedDB.open('walletTrackerDB', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('backup');
    };
    req.onsuccess = () => { _idbInstance = req.result; resolve(_idbInstance); };
    req.onerror = () => reject(req.error);
  });
}
async function idbBackup(savedAt){
  try{
    const db = await idbOpen();
    const tx = db.transaction('backup','readwrite');
    tx.objectStore('backup').put({
      wallets: state.wallets,
      transactions: state.transactions,
      crisisMode: state.crisisMode,
      autoDistribute, budgets,
      distribution: DISTRIBUTION,
      dismissedRecurring: Array.from(dismissedRecurring),
      // stamp with the matching lastEdit time so freshness can be compared on
      // load; falls back to now only when no explicit timestamp is supplied
      savedAt: (typeof savedAt === 'number' && isFinite(savedAt)) ? savedAt : Date.now()
    }, 'snapshot');
  }catch(e){ /* non-fatal */ }
}
async function idbRestore(){
  try{
    const db = await idbOpen();
    return new Promise((resolve)=>{
      const tx = db.transaction('backup','readonly');
      const req = tx.objectStore('backup').get('snapshot');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }catch(e){ return null; }
}


function toggleCrisis(){
  state.crisisMode = !state.crisisMode;
  if(state.crisisMode && walletFilter && CRISIS_WALLET_IDS.includes(walletFilter)){
    walletFilter = null;
  }
  document.getElementById('crisisToggle').setAttribute('aria-checked', state.crisisMode);
  saveConfig();
  render();
  toast(state.crisisMode ? '🚨 تم تفعيل وضع الطوارئ' : '✓ تم إيقاف وضع الطوارئ');
}

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

  let defs = WALLET_DEFS;
  if(state.crisisMode){
    defs = WALLET_DEFS.filter(w => !CRISIS_WALLET_IDS.includes(w.id));
  }

  defs.forEach(w => {
    const val = state.wallets[w.id] ?? 0;
    if(!w.track) spendable += val;
    const div = document.createElement('div');
    div.className = 'wallet' + (w.track ? ' track' : '') + (val < 0 ? ' neg-val' : '') + (walletFilter===w.id ? ' active-filter' : '');
    div.setAttribute('role','button');
    div.setAttribute('tabindex','0');
    div.setAttribute('aria-pressed', walletFilter===w.id);
    const pctWidth = w.track ? 100 : Math.min(100, Math.max(2, (val/MAX_WALLET_VAL)*100));

    let budgetHtml = '';
    if(!w.track && budgets[w.id] > 0){
      const spent = monthlyExpenseForWallet(w.id);
      const budget = budgets[w.id];
      const ratio = Math.min(1, spent/budget);
      const over = spent > budget;
      const color = over ? 'var(--red)' : ratio > 0.8 ? '#e0c074' : 'var(--green)';
      budgetHtml = `
        <div class="budget-row">
          <div class="bar" style="margin-top:6px;"><i style="width:${(ratio*100).toFixed(0)}%; background:${color};"></i></div>
          <div class="budget-label" style="color:${over?'var(--red)':'var(--muted)'}">${fmt(spent)} / ${fmt(budget)}${over?' ⚠':''}</div>
        </div>`;
    }

    div.innerHTML = `
      <div class="top">
        <div class="name">${w.name}</div>
        <div class="pct" onclick="event.stopPropagation(); openWalletDetail('${w.id}')" title="التفاصيل">ⓘ ${getWalletPctLabel(w)}</div>
      </div>
      <div class="val">${fmt(val)}</div>
      <div class="bar"><i style="width:${pctWidth}%"></i></div>
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
    const div = document.createElement('div');
    div.className = 'wallet crisis-combined';
    div.innerHTML = `
      <div class="top">
        <div class="name">احتياطي الطوارئ (مدمج)</div>
        <div class="pct">٪50</div>
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

  document.getElementById('crisisToggle').classList.toggle('active', state.crisisMode);
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
  document.getElementById('txList').scrollIntoView({behavior:'smooth', block:'start'});
}
function clearWalletFilter(){
  walletFilter = null;
  _txVisibleCount = 50;
  document.getElementById('walletFilterChip').classList.remove('show');
  renderWallets();
  renderTxList();
  renderChart();
  renderPieChart();
  document.getElementById('txList').scrollIntoView({behavior:'smooth', block:'start'});
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
  document.getElementById('txList').scrollIntoView({behavior:'smooth', block:'start'});
}


/* ============================================================
   WALLET SELECT (add form)
============================================================ */
function renderWalletSelect(){
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
  document.getElementById('walletMenuWrap').classList.toggle('open');
  document.getElementById('walletSelectBtn').classList.toggle('open');
}
function selectWallet(id){
  selectedWallet = id;
  document.getElementById('walletMenuWrap').classList.remove('open');
  document.getElementById('walletSelectBtn').classList.remove('open');
  renderWalletSelect();
}

/* ============================================================
   WALLET SELECT (edit modal)
============================================================ */
function renderEditWalletSelect(){
  const menu = document.getElementById('editWalletMenu');
  menu.innerHTML = '';
  let list = SELECTABLE_WALLETS;
  const currentDef = WALLET_DEFS.find(w=>w.id===editWallet);
  if(currentDef && currentDef.track){
    list = [currentDef, ...SELECTABLE_WALLETS];
  }
  list.forEach(w => {
    const opt = document.createElement('div');
    opt.className = 'opt' + (w.id === editWallet ? ' selected' : '');
    opt.setAttribute('role','option');
    opt.tabIndex = 0;
    const val = state.wallets[w.id] ?? 0;
    opt.innerHTML = `<span>${w.name}</span><span class="bal">${fmt(val)}</span>`;
    opt.onclick = () => { editWallet = w.id; document.getElementById('editWalletMenuWrap').classList.remove('open'); document.getElementById('editWalletBtn').classList.remove('open'); renderEditWalletSelect(); };
    menu.appendChild(opt);
  });
  const wDef = WALLET_DEFS.find(w => w.id === editWallet);
  document.getElementById('editWalletLabel').textContent = wDef ? wDef.name : 'اختر محفظة';
}
function toggleEditWalletMenu(){
  document.getElementById('editWalletMenuWrap').classList.toggle('open');
  document.getElementById('editWalletBtn').classList.toggle('open');
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
  'صفر':0,'واحد':1,'وحدة':1,'اثنين':2,'إثنين':2,'تنين':2,'ثلاثة':3,'ثلاثه':3,
  'اربعة':4,'أربعة':4,'اربعه':4,'خمسة':5,'خمسه':5,'ستة':6,'سته':6,'سبعة':7,'سبعه':7,
  'ثمانية':8,'ثمانيه':8,'تسعة':9,'تسعه':9,'عشرة':10,'عشره':10,
  'عشرين':20,'ثلاثين':30,'اربعين':40,'أربعين':40,'خمسين':50,'ستين':60,'سبعين':70,
  'ثمانين':80,'تسعين':90,'مية':100,'مائة':100,'الف':1000,'ألف':1000,'مليون':1000000
};

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
  // try digits first (handles "50", "٥٠")
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  let normalized = text.replace(/[٠-٩]/g, d => arabicDigits.indexOf(d));
  const digitMatch = normalized.match(/\d+(\.\d+)?/);
  if(digitMatch) return parseFloat(digitMatch[0]);

  // fallback: word-based numbers (simple sum of recognized tokens)
  const words = text.split(/\s+/);
  let total = 0, found = false;
  words.forEach(w=>{
    const clean = w.replace(/[^ء-ي]/g,'');
    if(VOICE_NUMBER_WORDS[clean] !== undefined){
      total += VOICE_NUMBER_WORDS[clean];
      found = true;
    }
  });
  return found ? total : null;
}

function guessCategory(text){
  for(const [catId, keywords] of Object.entries(CATEGORY_KEYWORDS)){
    if(keywords.some(k => text.includes(k))) return catId;
  }
  return null;
}

function guessType(text){
  const incomeWords = ['استلمت','استقبلت','دخل','راتب','ربحت','كسبت','حولوا لي','حول لي','حولني','وصلني','وصل لي','جاني','هدية','مكافأة','بونص','عائد','فائدة','أرسلوا لي'];
  return incomeWords.some(w => text.includes(w)) ? 'income' : 'expense';
}

let voiceRecognition = null;
let _voiceTimer = null;
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

  // single idempotent teardown — guarantees the mic button never gets stuck in
  // the "listening" state and the recognition object is always released
  const cleanup = () => {
    clearTimeout(_voiceTimer); _voiceTimer = null;
    btn.classList.remove('listening');
    voiceRecognition = null;
  };

  voiceRecognition = new SpeechRecognition();
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
  // remove common verbs
  ['صرفت','دفعت','اشتريت','استلمت','استقبلت','على','ريال','دينار','ل','من'].forEach(w=>{
    desc = desc.replace(new RegExp('\\b'+w+'\\b','g'), '');
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
    window.scrollTo({top:0, behavior:'smooth'});
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

function renderCategoryGrid(){
  const grid = document.getElementById('categoryGrid');
  grid.innerHTML = '';
  CATEGORIES.filter(c => c.types.includes(addFormType)).forEach(c => {
    const chip = document.createElement('div');
    chip.className = 'cat-chip' + (selectedCategory===c.id ? ' active' : '');
    chip.innerHTML = `<span class="ic">${c.icon}</span><span>${c.name}</span>`;
    chip.onclick = () => { selectedCategory = c.id; renderCategoryGrid(); };
    grid.appendChild(chip);
  });
}
function renderEditCategoryGrid(){
  const grid = document.getElementById('editCategoryGrid');
  grid.innerHTML = '';
  CATEGORIES.filter(c => c.types.includes(editType)).forEach(c => {
    const chip = document.createElement('div');
    chip.className = 'cat-chip' + (editCategory===c.id ? ' active' : '');
    chip.innerHTML = `<span class="ic">${c.icon}</span><span>${c.name}</span>`;
    chip.onclick = () => { editCategory = c.id; renderEditCategoryGrid(); };
    grid.appendChild(chip);
  });
}
function getCategory(id){
  return CATEGORIES.find(c=>c.id===id) || CATEGORIES.find(c=>c.id==='other') || CATEGORIES[0];
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
    wrap.innerHTML = '<div class="chart-empty" style="flex:1;">لا توجد مصروفات في هذه الفترة</div>';
    return;
  }

  const totals = {};
  filtered.forEach(tx => {
    const cat = tx.category || 'other';
    totals[cat] = (totals[cat]||0) + tx.amount;
  });
  const total = Object.values(totals).reduce((a,b)=>a+b,0);
  const entries = Object.entries(totals).sort((a,b)=>b[1]-a[1]);

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

  const size = 110, r = 50, cx = size/2, cy = size/2;
  let html = `<canvas id="pieCanvas" width="${size}" height="${size}" style="width:${size}px;height:${size}px;"></canvas>`;
  html += '<div class="pie-legend">';
  entries.forEach(([catId, amt]) => {
    const cat = getCategory(catId);
    const pct = (amt/total*100);
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
    html += `<div class="row cat-row" data-cat="${escHtml(catId)}"><span class="sw" style="background:${cat.color}"></span><span class="name">${cat.icon} ${cat.name}</span>${cmpHtml}<span class="pct">${fmt(amt)} (${pct.toFixed(0)}%)</span></div>`;
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
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--card') || '#1e222a';
  ctx.fill();
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
        document.getElementById('transfer'+(dir==='from'?'From':'To')+'MenuWrap').classList.remove('open');
        document.getElementById('transfer'+(dir==='from'?'From':'To')+'Btn').classList.remove('open');
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
  document.getElementById('transfer'+key+'MenuWrap').classList.toggle('open');
  document.getElementById('transfer'+key+'Btn').classList.toggle('open');
}

let _doTransferBusy = false;
async function doTransfer(){
  if(_doTransferBusy) return;
  const amt = parseAmount(document.getElementById('transferAmount').value);
  if(!isFinite(amt) || amt <= 0){ toast('⚠ أدخل مبلغ صحيح', true); return; }
  if(!transferFrom || !transferTo){ toast('⚠ اختر المحفظتين أولاً', true); return; }
  if(transferFrom === transferTo){ toast('⚠ اختر محفظتين مختلفتين', true); return; }
  _doTransferBusy = true;
  try{
    const dateVal = document.getElementById('transferDate').value || todayISO();
    let ts = new Date(dateVal + 'T' + new Date().toTimeString().slice(0,8)).getTime();
    if(!isFinite(ts)) ts = Date.now(); // guard against an invalid date string
    const fromWallet = WALLET_DEFS.find(w=>w.id===transferFrom);
    const toWallet = WALLET_DEFS.find(w=>w.id===transferTo);
    if(!fromWallet || !toWallet){ toast('⚠ محفظة غير صحيحة', true); return; }
    const fromBalance = state.wallets[transferFrom] ?? 0;
    if(!fromWallet.track && fromBalance - amt < -0.01){
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
  }
}

/* ============================================================
   WALLET DETAIL VIEW
============================================================ */
let _updateBalanceBusy = false;
async function updateTrackedBalance(){
  if(_updateBalanceBusy || !detailWalletId) return;
  const w = WALLET_DEFS.find(x=>x.id===detailWalletId);
  const newVal = parseAmount(document.getElementById('detailNewBalance').value);
  if(isNaN(newVal)){ toast('⚠ أدخل رصيد صحيح', true); return; }

  const current = state.wallets[detailWalletId] ?? 0;
  const diff = round2(newVal - current);
  if(diff === 0){ toast('لا يوجد تغيير بالرصيد'); return; }

  _updateBalanceBusy = true;
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

async function saveDistribution(){
  const total = DISTRIBUTION.reduce((s,d)=>s+(d.pct||0), 0);
  if(parseFloat(total.toFixed(1)) !== 100){
    if(!confirm(`الإجمالي الحالي ${total.toFixed(1)}% وليس 100%. حفظ مع ذلك؟`)) return;
  }
  await saveConfig();
  renderWallets();
  toast('✓ تم حفظ النسب');
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
          <div class="meta">${date.toLocaleDateString('ar-EG',{day:'numeric',month:'short'})}</div>
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
  return total;
}

let _analyticsCache = null;
let _analyticsSig = '';

function renderAnalytics(){
  const grid = document.getElementById('analyticsGrid');
  grid.innerHTML = '';

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
  const sig = state.transactions.length + '|' + (state.transactions[state.transactions.length-1]?.id||'') + '|' + dismissedRecurring.size;
  if(sig === _recurringCacheSig && _recurringCache) return _recurringCache;
  _recurringCacheSig = sig;

  const groups = {};
  state.transactions.forEach(tx=>{
    if(tx.type!=='expense' || tx.category==='transfer' || tx.category==='adjustment') return;
    const key = (tx.desc||'').trim().toLowerCase();
    if(!key) return;
    if(!groups[key]) groups[key] = [];
    groups[key].push(tx);
  });

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

    suggestions.push({ key, desc: txs[0].desc, avg, count: txs.length, wallet: txs[0].wallet, category: txs[0].category });
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
        <button class="btn-secondary" data-dismiss="${s.key}">تجاهل</button>
        <button class="btn-primary" data-remind="${s.key}">⏰ سجّلها الآن</button>
      </div>
    `;
    card.querySelector('[data-dismiss]').onclick = () => {
      dismissedRecurring.add(s.key);
      saveConfig();
      renderRecurring();
    };
    card.querySelector('[data-remind]').onclick = () => {
      document.getElementById('descInput').value = s.desc;
      document.getElementById('amountInput').value = round2(s.avg);
      selectedWallet = s.wallet;
      selectedCategory = s.category;
      renderWalletSelect();
      renderCategoryGrid();
      dismissedRecurring.add(s.key);
      saveConfig();
      renderRecurring();
      toast('✓ تم تعبية النموذج — راجع وسجّل المعاملة');
      window.scrollTo({top:0, behavior:'smooth'});
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
  document.getElementById('txList').scrollIntoView({behavior:'smooth', block:'start'});
}

function inRange(ts){
  const now = new Date();
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
// Fold Arabic orthographic variants so search is forgiving: a user typing
// "قهوه" should match "قهوة", "احمد" should match "أحمد", "مصطفى" ↔ "مصطفي".
// Also strips tashkeel (diacritics) and tatweel, and lowercases Latin text.
function normalizeSearch(str){
  return String(str || '')
    .replace(/[ً-ْٰ]/g, '') // tashkeel/diacritics
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
  _searchDebounce = setTimeout(()=>{ renderTxList(); document.getElementById('txList').scrollIntoView({behavior:'smooth', block:'start'}); }, 150);
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
  _filteredTxCache = state.transactions
    .filter(tx => inRange(tx.ts))
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
  return _filteredTxCache;
}

/* ============================================================
   RENDER: TX LIST + SUMMARY
============================================================ */
function renderTxList(){
  const list = document.getElementById('txList');
  list.innerHTML = '';
  const filtered = getFilteredTx().slice().sort((a,b)=>b.ts-a.ts);

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

  // hero monthly stats — cached to avoid rescanning all txs on every render
  const now = new Date();
  const _hSig = state.transactions.length + '|' + (state.transactions[state.transactions.length-1]?.id||'') + '|' + now.getMonth() + '|' + now.getFullYear() + '|' + state.crisisMode;
  if(_hSig !== _heroStatsSig || !_heroStatsCache){
    let mIncome=0, mExpense=0;
    state.transactions.forEach(tx=>{
      // exclude inter-wallet moves and manual adjustments from hero totals
      if(tx.category === 'transfer' || tx.category === 'adjustment') return;
      const d = new Date(tx.ts);
      if(d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear()){
        if(tx.type==='income') mIncome+=tx.amount; else mExpense+=tx.amount;
      }
    });
    _heroStatsCache = {mIncome: round2(mIncome), mExpense: round2(mExpense)};
    _heroStatsSig = _hSig;
  }
  document.getElementById('heroIncome').textContent = fmt(_heroStatsCache.mIncome);
  document.getElementById('heroExpense').textContent = fmt(_heroStatsCache.mExpense);

  if(filtered.length === 0){
    if(state.transactions.length === 0 && !searchQuery && currentFilter==='all'){
      list.innerHTML = `<div class="empty"><span class="ic">🗂</span>لا توجد معاملات بعد.<br><br>
        <button class="btn-secondary" onclick="openModal('dataModal')" style="width:auto; padding:10px 20px; display:inline-block;">⬆ استيراد بيانات من ملف JSON</button>
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
      lbl.textContent = isToday ? 'اليوم' : isYesterday ? 'أمس' : date.toLocaleDateString('ar-EG', {weekday:'long', day:'numeric', month:'long'});
      list.appendChild(lbl);
    }

    const wrap = document.createElement('div');
    wrap.className = 'tx-wrap';

    const bg = document.createElement('div');
    bg.className = 'tx-swipe-bg';
    bg.innerHTML = '🗑 حذف';

    const div = document.createElement('div');
    div.className = 'tx';
    const sign = tx.type === 'expense' ? '-' : '+';
    const cls = tx.type === 'expense' ? 'neg' : 'pos';
    const timeStr = date.toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'});
    const cat = getCategory(tx.category);
    div.innerHTML = `
      <div class="info">
        <div class="desc">${escHtml(tx.desc || (wallet ? wallet.name : ''))}</div>
        <div class="meta"><span class="ctag">${cat.icon}</span><span class="wtag">${escHtml(wallet ? wallet.name : '')}</span> ${timeStr}</div>
      </div>
      <div class="right">
        <div class="amount ${cls}">${sign}${fmt(tx.amount)}</div>
        <button class="edit-btn" aria-label="تعديل">✎</button>
      </div>
    `;
    div.querySelector('.edit-btn').onclick = (e) => { e.stopPropagation(); if(!div._swipeDeleting) openEdit(tx.id); };
    div.onclick = () => { if(!div._swipeDeleting) openEdit(tx.id); };

    attachSwipe(div, wrap, tx.id);

    wrap.appendChild(bg);
    wrap.appendChild(div);
    list.appendChild(wrap);
  });

  if(filtered.length > _txVisibleCount){
    const remaining = filtered.length - _txVisibleCount;
    const more = document.createElement('button');
    more.className = 'btn-secondary';
    more.style.cssText = 'margin:10px auto; display:block; width:auto; padding:10px 24px; font-size:13px;';
    more.textContent = `⬇ عرض ${Math.min(remaining, 50)} معاملة أخرى (${remaining} متبقية)`;
    more.onclick = () => { _txVisibleCount += 50; renderTxList(); };
    list.appendChild(more);
  }
}

/* ============================================================
   SWIPE TO DELETE (touch)
============================================================ */
function attachSwipe(el, wrap, txId){
  let startX = 0, startY = 0, currentX = 0, dragging = false, swipeMode = false;
  const threshold = 90;

  el.addEventListener('touchstart', e=>{
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragging = true;
    swipeMode = false;
    el.style.transition = 'none';
  }, {passive:true});

  el.addEventListener('touchmove', e=>{
    if(!dragging) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if(!swipeMode){
      if(Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 5){ swipeMode = true; }
      else if(Math.abs(dy) > 5){ dragging = false; return; }
      else return;
    }
    e.preventDefault(); // stop pull-to-refresh and scroll during confirmed horizontal swipe
    currentX = dx;
    if(currentX > 0) currentX = 0;
    el.style.transform = `translateX(${currentX}px)`;
  }, {passive:false});

  el.addEventListener('touchend', ()=>{
    if(!dragging) return;
    dragging = false;
    swipeMode = false;
    el.style.transition = 'transform .25s var(--ease)';
    if(Math.abs(currentX) > threshold){
      el.style.transform = 'translateX(-100%)';
      el.style.opacity = '0';
      el._swipeDeleting = true;
      setTimeout(()=> deleteTx(txId), 220);
    } else {
      el.style.transform = 'translateX(0)';
    }
    currentX = 0;
  });
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

  const filtered = getFilteredTx().slice().sort((a,b)=>a.ts-b.ts);
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
  const padX = 6, padY = 12;
  const w = cssW - padX*2;
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
  // Read from CSS variables so the chart adapts to light/dark theme
  const cs = getComputedStyle(document.body);
  const colorPos = cs.getPropertyValue('--green').trim() || '#86c39a';
  const colorNeg = cs.getPropertyValue('--red').trim()   || '#e3918f';
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

  const netBadge = document.getElementById('chartNet');
  netBadge.textContent = (finalNet>=0?'+':'') + fmt(finalNet);
  netBadge.style.color = lineColor;
}

/* ============================================================
   ADD / EDIT / DELETE TRANSACTIONS
============================================================ */
let _addTxBusy = false;
async function addTx(type){
  if(_addTxBusy) return;
  _addTxBusy = true;
  try{
    const walletId = selectedWallet;
    const desc = document.getElementById('descInput').value.trim().slice(0,120); // cap length (voice/paste bypass maxlength)
    const amountVal = parseAmount(document.getElementById('amountInput').value);
    const dateVal = document.getElementById('dateInput').value || todayISO();

    if(!isFinite(amountVal) || amountVal <= 0){
      toast('⚠ أدخل مبلغ صحيح', true);
      document.getElementById('amountInput').focus();
      return;
    }
    if(!WALLET_DEFS.find(w => w.id === walletId)){
      toast('⚠ اختر محفظة صحيحة', true);
      return;
    }

    let ts = new Date(dateVal + 'T' + new Date().toTimeString().slice(0,8)).getTime();
    if(!isFinite(ts)) ts = Date.now(); // guard against an invalid date string

    const tx = {
      id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      wallet: walletId,
      desc: desc,
      amount: amountVal,
      type: type,
      category: selectedCategory,
      ts: ts
    };

    state.transactions.push(tx);
    applyTxToBalance(tx, +1);

    document.getElementById('descInput').value = '';
    document.getElementById('amountInput').value = '';
    document.getElementById('dateInput').value = todayISO();
    document.querySelectorAll('#quickAmounts button').forEach(b=>b.classList.remove('active'));
    selectedCategory = 'other';
    renderCategoryGrid();

    await saveBalances();
    await saveTx();
    render();
    toast(type==='expense' ? '✓ تم تسجيل المصروف' : '✓ تم تسجيل الدخل');

    // auto-distribution flow for income
    if(type === 'income' && tx.category !== 'transfer'){
      if(autoDistribute){
        await runDistribution(tx, amountVal);
        render(); // reflect the distributed shares (render above ran before distribution)
        toast('🔄 تم توزيع الدخل تلقائيًا');
      } else {
        pendingIncomeTx = tx;
        openDistributionModal(amountVal);
      }
    }
  } finally {
    _addTxBusy = false;
  }
}

/* ============================================================
   AUTOMATIC INCOME DISTRIBUTION
============================================================ */
function openDistributionModal(amount){
  document.getElementById('distAmountLabel').textContent = fmt(amount);
  const wrap = document.getElementById('distBreakdown');
  wrap.innerHTML = '';
  const activeEntries = DISTRIBUTION.filter(d => d && d.pct > 0 && WALLET_DEFS.find(x=>x.id===d.id && !x.track));
  if(activeEntries.length === 0){
    const warn = document.createElement('div');
    warn.className = 'hint';
    warn.style.cssText = 'color:var(--red); margin:0; font-size:13px;';
    warn.textContent = '⚠ لا توجد نسب توزيع — اضبطها في الإعدادات أولاً';
    wrap.appendChild(warn);
  } else {
    const totalPct = activeEntries.reduce((s,d)=>s+d.pct, 0);
    activeEntries.forEach(d=>{
      const w = WALLET_DEFS.find(x=>x.id===d.id);
      const share = round2(amount * d.pct / 100);
      const row = document.createElement('div');
      row.className = 'dist-row';
      row.innerHTML = `<span class="name">${w.name} <span class="pct">${d.pct}%</span></span><span class="amt">${fmt(share)}</span>`;
      wrap.appendChild(row);
    });
    if(totalPct > 100){
      const warn = document.createElement('div');
      warn.className = 'hint';
      warn.style.cssText = 'color:var(--red); margin:8px 0 0; font-size:13px;';
      warn.textContent = `⚠ مجموع النسب ${totalPct}% — يتجاوز 100%، راجع الإعدادات`;
      wrap.appendChild(warn);
    }
  }
  document.getElementById('autoDistributeCheck').checked = autoDistribute;
  openModal('distributeModal');
}

function skipDistribution(){
  saveAutoDistributePref();
  pendingIncomeTx = null;
  closeModal('distributeModal');
}

async function confirmDistribution(){
  saveAutoDistributePref();
  if(!pendingIncomeTx) { closeModal('distributeModal'); return; }
  const hasActive = DISTRIBUTION.some(d => d && d.pct > 0 && WALLET_DEFS.find(x=>x.id===d.id && !x.track));
  if(!hasActive){
    toast('⚠ لا توجد نسب توزيع — اضبطها في الإعدادات أولاً', true);
    return;
  }
  const txToDistribute = pendingIncomeTx;
  pendingIncomeTx = null; // clear early so double-tap cannot trigger a second distribution
  await runDistribution(txToDistribute, txToDistribute.amount);
  closeModal('distributeModal');
  render();
  toast('✓ تم توزيع الدخل على المحافظ');
}

function saveAutoDistributePref(){
  const checked = document.getElementById('autoDistributeCheck').checked;
  if(checked !== autoDistribute){
    autoDistribute = checked;
    saveConfig();
  }
}

// Moves the income amount out of the wallet it was deposited into,
// and distributes it across DISTRIBUTION wallets according to their %.
async function runDistribution(sourceTx, amount){
  const sourceWalletId = sourceTx.wallet;
  const ts = sourceTx.ts;
  const linkId = 'lnk_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);

  // Only spendable wallets with a positive share participate — never route
  // distributed income into a track-only wallet (uber/cards/cash)
  const active = DISTRIBUTION.filter(d => d && d.pct > 0 && WALLET_DEFS.find(x=>x.id===d.id && !x.track));
  const totalPct = active.reduce((s,d)=> s + d.pct, 0);
  // never distribute more than the income itself (caps any >100% misconfiguration)
  const intendedTotal = round2(Math.min(amount, amount * totalPct / 100));

  // nothing to distribute — leave the income where it landed, don't withdraw
  if(intendedTotal <= 0){ await saveBalances(); await saveTx(); return; }

  // Link the originating income too, so deleting any leg removes the whole
  // income+distribution group and balances stay consistent.
  sourceTx.link = linkId;

  // Withdraw only the portion that will actually be distributed. Any
  // undistributed remainder (when percentages sum to < 100%) then stays in
  // the source wallet instead of silently vanishing from the balance.
  const txOut = {
    id: 'tx_'+Date.now()+'_d0'+Math.random().toString(36).slice(2,4),
    wallet: sourceWalletId,
    desc: 'توزيع الدخل على المحافظ',
    amount: intendedTotal,
    type: 'expense',
    category: 'transfer',
    ts: ts+1,
    link: linkId
  };
  state.transactions.push(txOut);
  applyTxToBalance(txOut, +1);

  let allocated = 0;

  // Deposit each share into its target wallet
  active.forEach((d, i) => {
    const w = WALLET_DEFS.find(x=>x.id===d.id);
    if(!w) return; // guard against stale wallet ID in saved DISTRIBUTION
    const remaining = round2(intendedTotal - allocated);
    let share = (i === active.length - 1)
      ? remaining                          // last leg absorbs the rounding residual
      : round2(amount * d.pct / 100);
    // never allocate more than what's left of intendedTotal — guards a >100%
    // misconfiguration from producing a negative final share (which would push a
    // bogus negative-amount tx AND create money out of nothing as later legs
    // skip the negative apply while earlier legs already over-deposited)
    if(share > remaining) share = remaining;
    if(share <= 0) return; // nothing left for this (or any later) leg — skip it
    allocated = round2(allocated + share);
    const txIn = {
      id: 'tx_'+Date.now()+'_d'+(i+1)+Math.random().toString(36).slice(2,4),
      wallet: d.id,
      desc: `حصة ${w.name} (${d.pct}%) من دخل`,
      amount: share,
      type: 'income',
      category: 'transfer',
      ts: ts+2+i,
      link: linkId
    };
    state.transactions.push(txIn);
    applyTxToBalance(txIn, +1);
  });

  await saveBalances();
  await saveTx();
}

function round2(n){
  return Math.round(n * 100) / 100;
}

// Drop any distribution entries whose wallet id no longer exists (e.g. from an
// imported/cloud backup). Falls back to defaults if nothing valid remains.
function sanitizeDistribution(arr){
  if(!Array.isArray(arr)) return DEFAULT_DISTRIBUTION.map(d=>({...d}));
  const cleaned = arr
    .filter(d => d && WALLET_DEFS.find(w=>w.id===d.id && !w.track))
    .map(d => ({...d, pct: Math.min(100, Math.max(0, isFinite(d.pct) ? d.pct : 0))}));
  return cleaned.length ? cleaned : DEFAULT_DISTRIBUTION.map(d=>({...d}));
}
function sanitizeBudgets(obj){
  const out = {};
  if(obj && typeof obj === 'object'){
    WALLET_DEFS.forEach(w => {
      const v = parseFloat(obj[w.id]);
      if(isFinite(v) && v > 0) out[w.id] = v;
    });
  }
  return out;
}

function applyTxToBalance(tx, sign){
  if(!tx || !isFinite(tx.amount) || tx.amount <= 0) return;
  if(!WALLET_DEFS.find(w => w.id === tx.wallet)) return; // reject orphaned wallet refs
  const delta = (tx.type === 'expense' ? -tx.amount : tx.amount) * sign;
  state.wallets[tx.wallet] = round2((state.wallets[tx.wallet] ?? 0) + delta);
}

function openEdit(id){
  const tx = state.transactions.find(t=>t.id===id);
  if(!tx) return;
  editingTxId = id;
  editType = tx.type;
  editWallet = tx.wallet;
  editCategory = tx.category || 'other';
  // A transfer leg's type/category must stay fixed — flipping its type or
  // category would unbalance the two-leg transfer (money created/destroyed),
  // and only amount/wallet/desc are synced to the partner. Hide those controls.
  _editingTransferLeg = !!(tx.link && tx.category === 'transfer');
  document.getElementById('editTypeToggle').style.display = _editingTransferLeg ? 'none' : '';
  document.getElementById('editCategorySection').style.display = _editingTransferLeg ? 'none' : '';
  document.getElementById('editTransferHint').style.display = _editingTransferLeg ? 'block' : 'none';
  setEditType(tx.type);
  renderEditWalletSelect();
  renderEditCategoryGrid();
  document.getElementById('editWalletMenuWrap').classList.remove('open');
  document.getElementById('editDesc').value = tx.desc || '';
  document.getElementById('editAmount').value = tx.amount;
  const d = new Date(tx.ts);
  document.getElementById('editDate').value = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  openModal('editModal');
}

async function saveEdit(){
  const tx = state.transactions.find(t=>t.id===editingTxId);
  if(!tx){
    toast('⚠ المعاملة لم تعد موجودة — ربما حُذفت من تبويب آخر', true);
    closeModal('editModal');
    return;
  }

  const newAmount = parseAmount(document.getElementById('editAmount').value);
  if(!isFinite(newAmount) || newAmount <= 0){
    toast('⚠ أدخل مبلغ صحيح', true);
    return;
  }
  if(!WALLET_DEFS.find(w => w.id === editWallet)){
    toast('⚠ محفظة غير صالحة', true);
    return;
  }

  // reverse old effect
  applyTxToBalance(tx, -1);

  // for a simple 2-leg transfer (link shared by exactly one other transfer leg),
  // keep both amounts in sync so balances stay consistent after editing one side
  if(tx.link && tx.category === 'transfer'){
    const transferPartners = state.transactions.filter(t => t.link === tx.link && t.id !== tx.id && t.category === 'transfer');
    if(transferPartners.length === 1){
      const partner = transferPartners[0];
      applyTxToBalance(partner, -1);
      partner.amount = newAmount;
      // keep partner description in sync with the edited leg's wallet
      const newWalletDef = WALLET_DEFS.find(w => w.id === editWallet);
      const partnerWalletDef = WALLET_DEFS.find(w => w.id === partner.wallet);
      if(newWalletDef && partnerWalletDef){
        if(tx.type === 'expense'){
          tx.desc = tx.desc || ('تحويل إلى ' + partnerWalletDef.name);
          partner.desc = 'تحويل من ' + newWalletDef.name;
        } else {
          tx.desc = tx.desc || ('تحويل من ' + partnerWalletDef.name);
          partner.desc = 'تحويل إلى ' + newWalletDef.name;
        }
      }
      applyTxToBalance(partner, +1);
    }
  }

  tx.desc = document.getElementById('editDesc').value.trim().slice(0,120); // cap length (voice/paste bypass maxlength)
  tx.amount = newAmount;
  tx.wallet = editWallet;
  // transfer legs keep their original type/category (locked in the UI) so the
  // two-leg balance stays consistent; only non-transfer txs adopt the new values
  if(!_editingTransferLeg){
    tx.type = editType;
    tx.category = editCategory;
  }
  const dateVal = document.getElementById('editDate').value || todayISO();
  const oldDate = new Date(tx.ts);
  const newTs = new Date(dateVal + 'T' + oldDate.toTimeString().slice(0,8)).getTime();
  // cap to now — prevents future-dated transactions from corrupting time filters
  tx.ts = isFinite(newTs) ? Math.min(newTs, Date.now()) : (isFinite(tx.ts) ? tx.ts : Date.now());

  applyTxToBalance(tx, +1);

  await saveBalances();
  await saveTx();
  closeModal('editModal');
  render(true); // force: desc/date-only edits don't change the render signature
  toast('✓ تم التحديث');
}

async function deleteFromEdit(){
  if(!editingTxId) return;
  await deleteTx(editingTxId);
  closeModal('editModal');
}

function repeatLastTx(){
  // last non-transfer transaction
  const last = [...state.transactions].sort((a,b)=>b.ts-a.ts).find(t=>t.category!=='transfer');
  if(!last){ toast('لا توجد معاملة سابقة لتكرارها'); return; }
  document.getElementById('descInput').value = last.desc || '';
  document.getElementById('amountInput').value = last.amount;
  document.getElementById('amountInput').dispatchEvent(new Event('input'));
  document.getElementById('dateInput').value = todayISO();
  if(!WALLET_DEFS.find(w=>w.id===last.wallet)?.track){
    selectedWallet = last.wallet;
    renderWalletSelect();
  }
  setAddFormType(last.type);
  const lastCat = CATEGORIES.find(c=>c.id===(last.category||'other'));
  if(lastCat && lastCat.types.includes(last.type)) selectedCategory = last.category || 'other';
  renderCategoryGrid();
  toast('✓ تم تعبية النموذج — راجع واضغط ' + (last.type==='expense'?'"مصروف"':'"دخل"'));
  window.scrollTo({top:0, behavior:'smooth'});
}

let _lastDeleted = null;
let _undoTimer = null;

async function deleteTx(id){
  const target = state.transactions.find(t => t.id === id);
  if(!target) return;
  // a transfer / income-distribution is one logical operation spread across
  // several linked legs — remove them all together to keep balances consistent
  const group = target.link
    ? state.transactions.filter(t => t.link === target.link)
    : [target];

  const removed = [];
  group.forEach(tx => {
    const idx = state.transactions.indexOf(tx);
    if(idx === -1) return;
    applyTxToBalance(tx, -1);
    state.transactions.splice(idx, 1);
    removed.push(tx);
  });
  if(!removed.length) return;

  await saveBalances();
  await saveTx();
  render();

  _lastDeleted = removed;
  clearTimeout(_undoTimer);
  _undoTimer = setTimeout(()=>{ _lastDeleted = null; }, 5000);
  toastWithUndo(removed.length > 1 ? `🗑 تم حذف ${removed.length} حركات مرتبطة` : '🗑 تم الحذف', undoDelete);
}

async function undoDelete(){
  if(!_lastDeleted) return;
  const removed = _lastDeleted;
  _lastDeleted = null;
  clearTimeout(_undoTimer);
  // position in the array is irrelevant (the list is always sorted by ts)
  removed.forEach(tx => {
    state.transactions.push(tx);
    applyTxToBalance(tx, +1);
  });
  await saveBalances();
  await saveTx();
  render();
  toast(removed.length > 1 ? '↩️ تم استرجاع الحركات' : '↩️ تم استرجاع المعاملة');
}

/* ============================================================
   MODALS
============================================================ */
let _modalReturnFocus = null;
function openModal(id){
  // remember what had focus so we can restore it when the modal closes (a11y)
  _modalReturnFocus = document.activeElement;
  const modal = document.getElementById(id);
  modal.classList.add('open');
  // lock background scroll so the page behind the sheet doesn't move while a
  // modal (and the on-screen keyboard) is open on mobile
  document.body.style.overflow = 'hidden';
  if(id==='dataModal') document.getElementById('jsonArea').value = '';
  if(id==='settingsModal'){
    updateSettingsStats();
    document.getElementById('driveClientId').value = driveClientId;
    refreshDriveSettingsUI();
    renderDistributionEditor();
  }
  // move focus into the modal so keyboard/screen-reader users land in context.
  // target a button (not a text input) so the mobile keyboard doesn't pop open.
  requestAnimationFrame(()=>{
    const focusable = modal.querySelector('button, [tabindex]');
    if(focusable) try{ focusable.focus({preventScroll:true}); }catch(_){}
  });
}
function closeModal(id){
  document.getElementById(id).classList.remove('open');
  // restore background scroll only once no modal remains open
  if(!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
  if(id === 'editModal'){ editingTxId = null; editCategory = 'other'; editType = 'expense'; editWallet = WALLET_DEFS[0].id; }
  if(id === 'distributeModal') pendingIncomeTx = null;
  if(id === 'walletDetailModal') detailWalletId = null;
  // restore focus to whatever triggered the modal
  if(_modalReturnFocus && typeof _modalReturnFocus.focus === 'function'){
    try{ _modalReturnFocus.focus({preventScroll:true}); }catch(_){}
  }
  _modalReturnFocus = null;
}
// Modals that hold unsaved form input must NOT close on an accidental
// backdrop tap (common on mobile) — only their explicit buttons close them.
const _protectedModals = new Set(['editModal','transferModal','distributeModal','walletDetailModal']);
document.querySelectorAll('.modal-overlay').forEach(ov=>{
  ov.addEventListener('click', e=>{ if(e.target===ov && !_protectedModals.has(ov.id)) closeModal(ov.id); });
});

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
    }
  });
});

function updateSettingsStats(){
  document.getElementById('statTxCount').textContent = state.transactions.length + ' معاملة';
  if(state.transactions.length){
    const first = state.transactions.reduce((min,t)=> t.ts<min.ts ? t : min, state.transactions[0]);
    document.getElementById('statFirstTx').textContent = new Date(first.ts).toLocaleDateString('ar-EG', {day:'numeric', month:'long', year:'numeric'});
  } else {
    document.getElementById('statFirstTx').textContent = '—';
  }
  try{
    const last = localStorage.getItem(LS_PREFIX + 'lastEdit');
    document.getElementById('statLastEdit').textContent = last
      ? new Date(parseInt(last)).toLocaleString('ar-EG', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'})
      : '—';
  }catch(e){
    document.getElementById('statLastEdit').textContent = '—';
  }
}

/* ============================================================
   EXPORT / IMPORT / RESET
============================================================ */
function exportData(){
  const payload = {
    exportedAt: new Date().toISOString(),
    wallets: state.wallets,
    transactions: state.transactions,
    crisisMode: state.crisisMode,
    budgets: budgets,
    autoDistribute: autoDistribute,
    distribution: DISTRIBUTION,
    dismissedRecurring: Array.from(dismissedRecurring)
  };
  const json = JSON.stringify(payload, null, 2);
  document.getElementById('jsonArea').value = json;

  const blob = new Blob([json], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'wallet-backup-' + todayISO() + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('✓ تم تجهيز ملف التصدير');
}

function importFromFile(event){
  const file = event.target.files[0];
  if(!file) return;
  // a real export is tiny JSON — reject oversized/binary files before reading
  if(file.size > 10 * 1024 * 1024){
    toast('⚠ الملف كبير جدًا — اختر ملف نسخة احتياطية صالح', true);
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('jsonArea').value = e.target.result;
    applyImport(e.target.result);
  };
  reader.onerror = () => toast('⚠ تعذّر قراءة الملف', true);
  reader.readAsText(file);
  event.target.value = ''; // allow re-selecting the same file later
}

function importFromTextarea(){
  const txt = document.getElementById('jsonArea').value.trim();
  if(!txt){ toast('⚠ الصق بيانات JSON أولاً', true); return; }
  applyImport(txt);
}

function stripOrphanLinks(txList){
  const counts = {};
  txList.forEach(tx => { if(tx.link) counts[tx.link] = (counts[tx.link]||0) + 1; });
  txList.forEach(tx => { if(tx.link && counts[tx.link] < 2) delete tx.link; });
}

async function applyImport(text){
  let data;
  try{ data = JSON.parse(text); }
  catch(e){ toast('⚠ تنسيق JSON غير صالح', true); return; }

  if(!data.wallets || !Array.isArray(data.transactions)){
    toast('⚠ ملف غير صحيح — لا يحتوي على wallets أو transactions', true); return;
  }
  if(!confirm('سيتم استبدال كل البيانات الحالية. متابعة؟')) return;

  if(data.wallets){
    // a backup is a complete snapshot — clear all balances first so wallets that
    // are omitted from the imported file don't keep stale values that would
    // mismatch the freshly-replaced transaction list
    WALLET_DEFS.forEach(w => state.wallets[w.id] = 0);
    WALLET_DEFS.forEach(w => { if(data.wallets[w.id] !== undefined) state.wallets[w.id] = data.wallets[w.id]; });
  }
  let _droppedTx = 0;
  if(data.transactions){
    const incoming = Array.isArray(data.transactions) ? data.transactions : [];
    state.transactions = incoming.filter(tx =>
      tx &&
      typeof tx.ts === 'number' && isFinite(tx.ts) && tx.ts > 0 &&
      typeof tx.amount === 'number' && isFinite(tx.amount) && tx.amount > 0 &&
      (tx.type === 'income' || tx.type === 'expense') &&
      WALLET_DEFS.find(w => w.id === tx.wallet)
    ).map(tx => ({ ...tx, category: normalizeCategory(tx.category) }));
    _droppedTx = incoming.length - state.transactions.length;
  }

  // Strip orphaned link IDs — if only one leg of a linked transfer/distribution
  // group survived the import filter, its link field is dangling; unset it so
  // a future delete of that transaction doesn't cascade to nothing and leave
  // the balance adjustment unapplied.
  stripOrphanLinks(state.transactions);
  if(typeof data.crisisMode === 'boolean') state.crisisMode = data.crisisMode;
  if(data.budgets && typeof data.budgets === 'object') budgets = sanitizeBudgets(data.budgets);
  if(typeof data.autoDistribute === 'boolean') autoDistribute = data.autoDistribute;
  if(data.distribution && Array.isArray(data.distribution)) DISTRIBUTION = sanitizeDistribution(data.distribution);
  if(Array.isArray(data.dismissedRecurring)) dismissedRecurring = new Set(data.dismissedRecurring);
  prevSpendable = null; // reset animation baseline after full data replacement

  await saveBalances();
  await saveTx();
  await saveConfig();
  closeModal('dataModal');
  render(true);
  if(_droppedTx > 0){
    toast(`✓ تم الاستيراد — لكن تم تجاهل ${_droppedTx} معاملة غير صالحة (محفظة مجهولة أو بيانات تالفة)`, true);
  } else {
    toast('✓ تم الاستيراد بنجاح');
  }
}

async function resetBalancesOnly(){
  if(!confirm('سيتم إعادة جميع الأرصدة إلى قيمها الابتدائية الافتراضية (لن تُحذف المعاملات). متابعة؟')) return;
  WALLET_DEFS.forEach(w => state.wallets[w.id] = w.initial);
  await saveBalances();
  closeModal('settingsModal');
  render();
  toast('✓ تمت استعادة الأرصدة الابتدائية');
}

async function wipeAll(){
  if(!confirm('سيتم حذف جميع الأرصدة والمعاملات نهائياً. هذا الإجراء لا يمكن التراجع عنه. متابعة؟')) return;
  if(!confirm('تأكيد أخير: هل أنت متأكد تماماً؟')) return;
  clearTimeout(_undoTimer); _lastDeleted = null;
  WALLET_DEFS.forEach(w => state.wallets[w.id] = 0);
  state.transactions = [];
  state.crisisMode = false;
  budgets = {};
  autoDistribute = false;
  dismissedRecurring.clear();
  selectedWallet = WALLET_DEFS[0].id;
  selectedCategory = 'other';
  editingTxId = null;
  transferFrom = null;
  transferTo = null;
  detailWalletId = null;
  pendingIncomeTx = null;
  prevSpendable = null;
  walletFilter = null;
  categoryFilter = null;
  searchQuery = '';
  _txVisibleCount = 50;
  DISTRIBUTION = DEFAULT_DISTRIBUTION.map(d=>({...d}));
  document.getElementById('walletFilterChip').classList.remove('show');
  document.getElementById('categoryFilterChip').classList.remove('show');
  const si = document.getElementById('searchInput');
  if(si){ si.value = ''; document.getElementById('searchBox').classList.remove('has-text'); }
  await saveBalances();
  await saveTx();
  await saveConfig();
  closeModal('settingsModal');
  render();
  toast('🗑 تم حذف كل البيانات');
}

/* ============================================================
   TOAST
============================================================ */
function toast(msg, isError){
  // If an undo-delete is pending, cancel it before overwriting the undo button in the DOM
  if(_lastDeleted){ clearTimeout(_undoTimer); _lastDeleted = null; }
  const el = document.getElementById('saveStatus');
  el.textContent = msg;
  el.style.borderColor = isError ? 'var(--red)' : 'var(--line)';
  el.style.color = isError ? 'var(--red)' : 'var(--text)';
  el.classList.add('show');
  clearTimeout(window._saveTimeout);
  window._saveTimeout = setTimeout(()=> el.classList.remove('show'), 2200);
}

function toastWithUndo(msg, undoFn){
  const el = document.getElementById('saveStatus');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  const btn = document.createElement('button');
  btn.textContent = 'تراجع ↩️';
  btn.style.cssText = 'background:var(--gold); color:#241d0d; border:none; border-radius:99px; padding:4px 12px; font-size:11.5px; font-weight:700; margin-right:8px; cursor:pointer;';
  btn.onclick = () => {
    el.classList.remove('show');
    undoFn();
  };
  el.appendChild(span);
  el.appendChild(btn);
  el.style.borderColor = 'var(--line)';
  el.style.color = 'var(--text)';
  el.classList.add('show');
  clearTimeout(window._saveTimeout);
  window._saveTimeout = setTimeout(()=> el.classList.remove('show'), 5000);
}

/* ============================================================
   GOOGLE DRIVE AUTO-SYNC
   Stores a single JSON file (wallet-data.json) in the user's
   Drive appDataFolder (a hidden app-specific space, not visible
   in the user's normal Drive UI, but fully owned by the user's account).
============================================================ */
const DRIVE_FILE_NAME = 'محفظتيييي-data.json';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

let gisTokenClient = null;
let driveAccessToken = null;
let driveTokenExpiry = 0; // epoch ms when the current access token stops being valid
let _pendingDriveCloud = null;
let driveFileId = null;
let driveSyncTimer = null;
let driveClientId = '';
let _driveSilentRefresh = false; // true while re-acquiring a token after expiry
let _driveAutoReconnect = false; // true while silently reconnecting on app open
let _driveAutoReconnectGuard = null; // timeout to reset _driveAutoReconnect if GIS never calls back
let _driveSilentRefreshGuard = null; // timeout to reset _driveSilentRefresh if GIS never calls back
let _driveTokenRefreshTimer = null; // proactive refresh 5 min before token expires

// Cookie helpers — used as a second-layer storage alongside localStorage so the
// Drive token survives when the browser wipes localStorage on force-close.
// Cookies are scoped to the app's own path (e.g. /mahfazty/) to avoid leaking
// the token to other GitHub-Pages sites that share the github.io domain.
function _driveCookiePath(){
  try{ return new URL('.', location.href).pathname; }catch(_){ return '/'; }
}
function _setDriveCookie(name, val, expMs){
  try{
    const d = new Date(expMs).toUTCString();
    const path = _driveCookiePath();
    document.cookie = `${name}=${encodeURIComponent(val)}; expires=${d}; path=${path}; SameSite=Strict; Secure`;
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

// Persist the access token in BOTH localStorage and a path-scoped cookie so
// it survives whether the browser wipes one storage type on force-close.
function storeDriveToken(token, expiresInSec){
  driveAccessToken = token;
  driveTokenExpiry = Date.now() + (Math.max(0, (expiresInSec || 3600) - 60) * 1000); // 60s safety margin
  try{
    localStorage.setItem(LS_PREFIX + 'driveToken', token);
    localStorage.setItem(LS_PREFIX + 'driveTokenExp', String(driveTokenExpiry));
  }catch(e){}
  _setDriveCookie('mhfzty_dtok', token, driveTokenExpiry);
  _setDriveCookie('mhfzty_dexp', String(driveTokenExpiry), driveTokenExpiry);
  // schedule a silent refresh 5 min before the token expires so an active
  // session never suddenly loses Drive access mid-use
  _scheduleTokenRefresh();
}
function clearDriveToken(){
  clearTimeout(_driveTokenRefreshTimer); _driveTokenRefreshTimer = null;
  driveAccessToken = null;
  driveTokenExpiry = 0;
  try{
    localStorage.removeItem(LS_PREFIX + 'driveToken');
    localStorage.removeItem(LS_PREFIX + 'driveTokenExp');
    sessionStorage.removeItem(LS_PREFIX + 'driveToken'); // clean up legacy key
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
    // We do NOT auto-call requestAccessToken here because on mobile Chrome
    // a programmatic call (without user gesture) causes a redirect to
    // accounts.google.com/gsi/transfer which hangs blank.
    // Instead: clear the token and prompt the user to tap sign-in.
    clearDriveToken();
    refreshDriveSettingsUI();
    toast('⏱ انتهت جلسة Drive — اضغط على أيقونة ☁️ في الأعلى أو سجّل دخولك من الإعدادات', true);
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
  toast('✓ سيتصل التطبيق بـ Drive تلقائياً في كل مرة تفتحه');
}
function dismissDriveAutoSignInPrompt(){
  const p = document.getElementById('driveAutoSignInPrompt');
  if(p) p.style.display = 'none';
  // mark as seen so we don't ask again this session; next sign-in it may show again
  try{ sessionStorage.setItem(LS_PREFIX + 'autoSignInAsked', '1'); }catch(_){}
}

function setDriveIndicator(state_){
  // state_: 'idle' | 'syncing' | 'ok' | 'error' | 'off'
  const el = document.getElementById('driveIndicator');
  if(state_ === 'off' || !driveClientId){
    el.style.display = 'none';
    return;
  }
  const map = {
    idle:    {icon:'☁️', label:'جاهز',   color:'var(--muted)'},
    syncing: {icon:'🔄', label:'يزامن',  color:'var(--blue)'},
    ok:      {icon:'✅', label:'متزامن', color:'var(--green)'},
    error:   {icon:'⚠️', label:'خطأ',    color:'var(--red)'}
  };
  const cfg = map[state_] || map.idle;
  const clickable = (state_ === 'idle' || state_ === 'error'); // tap to sign in when disconnected
  el.style.display = 'flex';
  el.style.cssText += ';gap:4px; align-items:center; font-size:11px; font-weight:600; background:var(--card); border:1px solid var(--line); border-radius:99px; padding:4px 10px;';
  el.style.color = cfg.color;
  el.style.cursor = clickable ? 'pointer' : 'default';
  el.onclick = clickable ? driveSignIn : null;
  const label = clickable ? cfg.label + ' — اضغط للدخول' : cfg.label;
  el.innerHTML = `<span style="font-size:12px;">${cfg.icon}</span><span>${label}</span>`;
  el.title = {
    idle: 'اضغط لتسجيل الدخول بـ Google Drive',
    syncing: 'جاري المزامنة مع Drive...',
    ok: 'تمت المزامنة مع Drive',
    error: 'اضغط لتسجيل الدخول مجدداً'
  }[state_] || '';
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
  const setupEl = document.getElementById('driveSetup');
  const actionsEl = document.getElementById('driveActions');
  const statusEl = document.getElementById('driveStatusText');
  const signInBtn = document.getElementById('driveSignInBtn');
  const signedInActions = document.getElementById('driveSignedInActions');
  const embeddedWarn = document.getElementById('driveEmbeddedWarn');
  const autoSignInRow = document.getElementById('driveAutoSignInRow');
  const autoSignInChk = document.getElementById('driveAutoSignInChk');

  if(embeddedWarn) embeddedWarn.style.display = (!driveAccessToken && isEmbeddedOrStandalone()) ? 'block' : 'none';

  if(!driveClientId){
    setupEl.style.display = 'block';
    actionsEl.style.display = 'none';
    statusEl.textContent = 'غير مفعّل. أدخل Client ID الخاص بك للبدء.';
    setDriveIndicator('off');
    return;
  }
  setupEl.style.display = 'none';
  actionsEl.style.display = 'block';

  if(driveAccessToken){
    statusEl.textContent = 'متصل ✓ — البيانات تُحفظ تلقائيًا على Google Drive (مجلد بيانات التطبيق الخاص).';
    signInBtn.style.display = 'none';
    signedInActions.style.display = 'flex';
    if(autoSignInRow){ autoSignInRow.style.display = 'none'; } // preference no longer applies; hide
    setDriveIndicator('ok');
  } else {
    statusEl.textContent = 'اضغط على زر أدناه أو على أيقونة ☁️ في الأعلى لتسجيل الدخول.';
    signInBtn.style.display = 'block';
    signedInActions.style.display = 'none';
    if(autoSignInRow) autoSignInRow.style.display = 'none';
    setDriveIndicator('idle');
  }
}

function saveDriveClientId(){
  const val = document.getElementById('driveClientId').value.trim();
  if(!val || !val.endsWith('.apps.googleusercontent.com')){
    toast('⚠ تأكد من نسخ Client ID كاملاً (ينتهي بـ .apps.googleusercontent.com)', true);
    return;
  }
  driveClientId = val;
  try{ localStorage.setItem(LS_PREFIX + 'driveClientId', val); }catch(e){}
  refreshDriveSettingsUI();
  initGisClient();
  toast('✓ تم الحفظ. الآن سجّل الدخول بجوجل');
}

function changeDriveClientId(){
  if(!confirm('سيتم تسجيل الخروج وحذف إعداد Drive الحالي. متابعة؟')) return;
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
        // All sign-ins now go through driveSignIn() (user gesture, select_account).
        // No more silent prompt:'' paths — they caused gsi/transfer redirect on mobile.
        if(resp.error){
          setDriveIndicator('error');
          toast('⚠ فشل تسجيل الدخول بجوجل', true);
          refreshDriveSettingsUI();
          return;
        }
        storeDriveToken(resp.access_token, parseInt(resp.expires_in, 10));
        refreshDriveSettingsUI();
        toast('✓ تم تسجيل الدخول بجوجل');
        await driveSyncFromCloud(true, true);
      }
    });
  }catch(e){
    console.error(e);
  }
}

function driveSignIn(){
  if(!gisTokenClient){ initGisClient(); }
  if(!gisTokenClient){ toast('⚠ تعذر تهيئة جوجل، جرّب تحديث الصفحة', true); return; }
  try{
    gisTokenClient.requestAccessToken({
      // Always use 'select_account' — shows a proper Google account picker popup.
      // Never use prompt:'' here because on mobile Chrome a programmatic
      // (user-gesture-free) call redirects the current tab to gsi/transfer
      // which shows a blank page and hangs.
      prompt: 'select_account',
      // surface popup-level failures (blocked / closed / can't return) instead of
      // leaving the user staring at a blank google sign-in page with no feedback
      error_callback: (err) => {
        setDriveIndicator('error');
        const t = (err && err.type) || '';
        if(t === 'popup_failed_to_open'){
          toast('⚠ تعذّر فتح نافذة جوجل — افتح التطبيق في متصفح Chrome/Safari', true);
        } else if(t === 'popup_closed'){
          toast('أُغلقت نافذة تسجيل الدخول قبل اكتمالها', true);
        } else {
          toast('⚠ تعذّر تسجيل الدخول بجوجل، حاول مجددًا', true);
        }
      }
    });
  }catch(e){ toast('⚠ تعذّر بدء تسجيل الدخول بجوجل', true); }
}

function driveSignOut(){
  if(driveAccessToken && typeof google !== 'undefined' && google.accounts){
    try{ google.accounts.oauth2.revoke(driveAccessToken, ()=>{}); }catch(e){}
  }
  clearDriveToken();
  refreshDriveSettingsUI();
  toast('تم تسجيل الخروج من Drive');
}

// Find (or remember) the app data file on Drive
async function driveFindFile(){
  if(driveFileId) return driveFileId;
  const res = await fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=' + encodeURIComponent(`name='${DRIVE_FILE_NAME}'`), {
    headers: { 'Authorization': 'Bearer ' + driveAccessToken }
  });
  if(!res.ok) throw new Error('drive list failed: ' + res.status);
  const data = await res.json();
  if(data.files && data.files.length > 0){
    driveFileId = data.files[0].id;
  }
  return driveFileId;
}

// Push current local state to Drive (create file if needed)
let _driveSyncBusy = false;
let _driveResyncPending = false; // a change arrived mid-sync — re-sync afterwards
async function driveSyncToCloud(){
  if(!driveAccessToken) return;
  // if a sync is already running, remember that newer changes need flushing
  // afterwards instead of dropping them silently
  if(_driveSyncBusy){ _driveResyncPending = true; return; }
  _driveSyncBusy = true;
  setDriveIndicator('syncing');
  try{
    const payload = JSON.stringify({
      exportedAt: new Date().toISOString(),
      wallets: state.wallets,
      transactions: state.transactions,
      crisisMode: state.crisisMode,
      autoDistribute: autoDistribute,
      budgets: budgets,
      distribution: DISTRIBUTION,
      dismissedRecurring: Array.from(dismissedRecurring)
    });

    await driveFindFile();

    if(driveFileId){
      const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
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
      if(!res.ok) throw new Error('drive update failed: ' + res.status);
    } else {
      const boundary = 'wallet_boundary_' + Date.now();
      const metadata = { name: DRIVE_FILE_NAME, parents: ['appDataFolder'] };
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n` +
        `--${boundary}--`;
      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + driveAccessToken,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body
      });
      if(!res.ok) throw new Error('drive create failed: ' + res.status);
      const data = await res.json();
      driveFileId = data.id;
    }
    setDriveIndicator('ok');
  }catch(e){
    console.error(e);
    setDriveIndicator('error');
    if(e.message && e.message.includes('401')){
      clearDriveToken();
      refreshDriveSettingsUI();
      // Do NOT auto-call requestAccessToken here — on mobile Chrome it causes
      // a redirect to gsi/transfer that hangs blank. Instead, guide the user
      // to tap sign-in manually (one tap via the header indicator or settings).
      toast('⚠ انتهت جلسة Drive — اضغط على ☁️ في الأعلى لتسجيل الدخول من جديد', true);
    } else if(e.message && e.message.includes('403')){
      toast('⚠ تم رفض الإذن من Drive — تأكد من صلاحيات appdata بالـ Client ID', true);
    } else if(!navigator.onLine){
      toast('⚠ لا يوجد اتصال بالإنترنت — سيتم الحفظ محليًا فقط', true);
    } else {
      toast('⚠ تعذر الاتصال بـ Drive، سيُعاد المحاولة لاحقًا', true);
    }
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
  if(cloud.wallets){
    WALLET_DEFS.forEach(w => state.wallets[w.id] = 0);
    WALLET_DEFS.forEach(w => { if(cloud.wallets[w.id] !== undefined) state.wallets[w.id] = cloud.wallets[w.id]; });
  }
  if(cloud.transactions){
    state.transactions = cloud.transactions.filter(tx =>
      tx && (tx.type === 'income' || tx.type === 'expense') &&
      typeof tx.ts === 'number' && isFinite(tx.ts) && tx.ts > 0 &&
      typeof tx.amount === 'number' && isFinite(tx.amount) && tx.amount > 0 &&
      WALLET_DEFS.find(w => w.id === tx.wallet));
    stripOrphanLinks(state.transactions);
  }
  if(typeof cloud.crisisMode === 'boolean') state.crisisMode = cloud.crisisMode;
  if(typeof cloud.autoDistribute === 'boolean') autoDistribute = cloud.autoDistribute;
  if(cloud.budgets && typeof cloud.budgets === 'object') budgets = sanitizeBudgets(cloud.budgets);
  if(cloud.distribution && Array.isArray(cloud.distribution)) DISTRIBUTION = sanitizeDistribution(cloud.distribution);
  if(Array.isArray(cloud.dismissedRecurring)) dismissedRecurring = new Set(cloud.dismissedRecurring);
  prevSpendable = null; // force fresh hero animation after loading a new data set
  await saveBalances(); await saveTx(); await saveConfig();
  render();
}

// isInitial: this is the first pull after (re)connecting.
// interactive: the user explicitly tapped "sign in" — only then do we ever
//   interrupt with the conflict modal. Automatic reconnects on app open resolve
//   silently by timestamp so the user is never nagged on every visit.
async function driveSyncFromCloud(isInitial, interactive){
  if(!driveAccessToken) return;
  setDriveIndicator('syncing');
  try{
    await driveFindFile();
    if(!driveFileId){
      // nothing on Drive yet — push current local state up
      await driveSyncToCloud();
      return;
    }
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
      headers: { 'Authorization': 'Bearer ' + driveAccessToken }
    });
    if(!res.ok) throw new Error('drive download failed: ' + res.status);
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
      toast('☁️ تم تحميل بياناتك من Drive');
      return;
    }

    // both sides have data
    const cloudTime = cloud.exportedAt ? Date.parse(cloud.exportedAt) : 0;
    const localTime = parseInt(localStorage.getItem(LS_PREFIX + 'lastEdit') || '0', 10) || 0;

    if(!interactive){
      // automatic reconnect — never interrupt; keep whichever copy is newer
      if(cloudTime > localTime){
        await adoptCloudSnapshot(cloud);
        toast('☁️ حُدّثت بياناتك من Drive');
      } else {
        await driveSyncToCloud(); // local is newer/equal — push it up
      }
      setDriveIndicator('ok');
      return;
    }

    // interactive sign-in with genuine data on both sides — let the user choose,
    // showing each copy's size + timestamp so the decision is informed
    _pendingDriveCloud = cloud;
    const fmtWhen = ms => {
      if(!ms || !isFinite(ms)) return 'غير معروف';
      try{ return new Date(ms).toLocaleString('ar', {dateStyle:'medium', timeStyle:'short'}); }
      catch(_){ return new Date(ms).toLocaleString(); }
    };
    const cloudCount = (cloud.transactions || []).length;
    const localCount = state.transactions.length;
    const newer = cloudTime > localTime ? 'cloud' : (localTime > cloudTime ? 'local' : '');
    const tag = side => newer === side ? ' <b style="color:var(--green)">(الأحدث)</b>' : '';
    const info = document.getElementById('conflictInfo');
    if(info) info.innerHTML =
      `☁️ <b>Drive</b>: ${cloudCount} عملية · ${escHtml(fmtWhen(cloudTime))}${tag('cloud')}<br>` +
      `📱 <b>المحلية</b>: ${localCount} عملية · ${escHtml(fmtWhen(localTime))}${tag('local')}`;
    openModal('driveConflictModal');
  }catch(e){
    console.error(e);
    setDriveIndicator('error');
  }
}

async function resolveConflict(useCloud){
  closeModal('driveConflictModal');
  if(!_pendingDriveCloud) return;
  const cloud = _pendingDriveCloud;
  _pendingDriveCloud = null;
  if(useCloud){
    await adoptCloudSnapshot(cloud);
    toast('☁️ تم استخدام نسخة Drive');
  } else {
    await driveSyncToCloud();
    toast('☁️ تم رفع نسختك المحلية إلى Drive');
  }
}

function driveManualSync(){
  driveSyncToCloud().then(()=> toast('✓ تمت المزامنة مع Drive'));
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
    let tok = localStorage.getItem(LS_PREFIX + 'driveToken');
    let exp = parseInt(localStorage.getItem(LS_PREFIX + 'driveTokenExp') || '0', 10) || 0;
    // If localStorage was cleared, try cookies
    if(!tok || Date.now() >= exp){
      const ctok = _getDriveCookie('mhfzty_dtok');
      const cexp = parseInt(_getDriveCookie('mhfzty_dexp') || '0', 10) || 0;
      if(ctok && Date.now() < cexp){ tok = ctok; exp = cexp; }
    }
    _savedTokenExp = exp; // capture now, BEFORE clearDriveToken removes the keys
    if(tok && Date.now() < exp){ driveAccessToken = tok; driveTokenExpiry = exp; }
    else if(tok || exp){ clearDriveToken(); } // stale — drop both storage locations
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
        }
        // No live token: show the sign-in button.
        // We intentionally do NOT call requestAccessToken({prompt:''}) here
        // because on mobile Chrome a programmatic call without a user gesture
        // causes the browser to redirect the current tab to
        // accounts.google.com/gsi/transfer which hangs as a blank page.
        // The user can sign in by tapping the ☁️ indicator in the header
        // or the sign-in button in Settings — both are proper user gestures.
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


/* ============================================================
   SPLASH SCREEN
============================================================ */
function hideSplash(){
  const el = document.getElementById('splash');
  if(el) el.classList.add('hide');
}

/* ============================================================
   FIRST-RUN WELCOME MODAL
============================================================ */
function checkFirstRun(){
  try{
    const seen = localStorage.getItem(LS_PREFIX + 'welcomeSeen');
    if(!seen){
      openModal('welcomeModal');
    }
  }catch(e){}
}
function closeWelcome(){
  closeModal('welcomeModal');
  try{ localStorage.setItem(LS_PREFIX + 'welcomeSeen', '1'); }catch(e){}
}

/* ============================================================
   DAILY QUICK REVIEW
============================================================ */
function checkDailyReview(){
  try{
    const today = todayISO();
    const lastSeen = localStorage.getItem(LS_PREFIX + 'lastReviewDate');
    if(lastSeen === today) return;
    localStorage.setItem(LS_PREFIX + 'lastReviewDate', today);

    // only show if there's at least some history (avoid showing on very first run, welcome covers that)
    if(state.transactions.length === 0) return;

    const content = buildDailyReviewContent();
    if(!content) return;
    document.getElementById('dailyReviewContent').innerHTML = content;
    openModal('dailyReviewModal');
  }catch(e){}
}

function buildDailyReviewContent(){
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
  const yStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).getTime();
  // exclusive end = start of today (calendar arithmetic, DST-safe — not yStart+24h)
  const yEnd = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()+1).getTime();

  let yExpense = 0, yIncome = 0, yCount = 0;
  state.transactions.forEach(tx=>{
    if(tx.ts >= yStart && tx.ts < yEnd && tx.category!=='transfer'){
      if(tx.type==='expense'){ yExpense += tx.amount; yCount++; }
      else { yIncome += tx.amount; }
    }
  });

  let lines = [];
  if(yCount > 0 || yIncome > 0){
    lines.push(`📅 <b style="color:var(--text)">أمس:</b> صرفت <b style="color:var(--red)">${fmt(yExpense)}</b> على ${yCount} معاملة${yIncome>0?` · دخل <b style="color:var(--green)">${fmt(yIncome)}</b>`:''}`);
  } else {
    lines.push(`📅 لم تُسجَّل معاملات أمس.`);
  }

  // budget warnings
  WALLET_DEFS.forEach(w=>{
    if(w.track || !budgets[w.id]) return;
    const spent = monthlyExpenseForWallet(w.id);
    const budget = budgets[w.id];
    if(spent >= budget){
      lines.push(`🔴 محفظة <b style="color:var(--text)">${escHtml(w.name)}</b> تجاوزت ميزانيتها الشهرية (${fmt(spent)} / ${fmt(budget)}).`);
    } else if(spent >= budget*0.8){
      lines.push(`🟡 محفظة <b style="color:var(--text)">${escHtml(w.name)}</b> قاربت حد ميزانيتها (${fmt(spent)} / ${fmt(budget)}).`);
    }
  });

  // pending recurring suggestions
  const recurring = detectRecurring();
  if(recurring.length > 0){
    lines.push(`🔁 لديك ${recurring.length} معاملة متكررة محتملة بانتظار مراجعتك (بأسفل صفحة التقارير).`);
  }

  if(lines.length === 1 && yCount===0 && yIncome===0) return null;
  return lines.map(l=>`<div>${l}</div>`).join('');
}

/* ============================================================
   MONTHLY REPORT EXPORT (text-based, share or download)
============================================================ */
function exportMonthlyReport(){
  const now = new Date();
  const monthName = now.toLocaleDateString('ar-EG', {month:'long', year:'numeric'});
  const [start, end] = monthRange(0);

  let totalIncome=0, totalExpense=0;
  const catTotals = {};
  state.transactions.forEach(tx=>{
    if(tx.ts < start || tx.ts >= end || tx.category==='transfer') return;
    if(tx.type==='income') totalIncome += tx.amount;
    else {
      totalExpense += tx.amount;
      const c = tx.category || 'other';
      catTotals[c] = (catTotals[c]||0) + tx.amount;
    }
  });

  let report = `📊 تقرير محفظتيييي — ${monthName}\n`;
  report += `${'─'.repeat(28)}\n`;
  report += `الدخل: ${fmt(totalIncome)}\n`;
  report += `المصروف: ${fmt(totalExpense)}\n`;
  report += `الصافي: ${fmt(totalIncome-totalExpense)}\n\n`;

  report += `حسب الفئة:\n`;
  Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).forEach(([catId,amt])=>{
    const cat = getCategory(catId);
    report += `  ${cat.icon} ${cat.name}: ${fmt(amt)}\n`;
  });

  report += `\nأرصدة المحافظ:\n`;
  WALLET_DEFS.forEach(w=>{
    report += `  ${w.track?'🏦':'💳'} ${w.name}: ${fmt(state.wallets[w.id] ?? 0)}\n`;
  });

  report += `\n📱 محفظتيييي 🙂‍↔️`;

  const shareData = { title: `تقرير محفظتيييي — ${monthName}`, text: report };
  if(navigator.share && (!navigator.canShare || navigator.canShare(shareData))){
    navigator.share(shareData).catch(()=>{ copyReportToClipboard(report); });
  } else {
    copyReportToClipboard(report);
  }
}

function copyReportToClipboard(report){
  if(navigator.clipboard){
    navigator.clipboard.writeText(report).then(()=>{
      toast('✓ تم نسخ التقرير للحافظة');
    }).catch(()=> downloadReport(report));
  } else {
    downloadReport(report);
  }
}

function downloadReport(report){
  const blob = new Blob([report], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'تقرير-محفظتيييي-' + todayISO() + '.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('✓ تم تنزيل التقرير');
}

/* ============================================================
   PWA: MANIFEST + SERVICE WORKER (inline, no extra files needed)
============================================================ */
function buildManifestBlob(isLight){
  const themeColor = isLight ? '#f4f2ed' : '#121419';
  const manifest = {
    name: 'محفظتيييي',
    short_name: 'محفظتيييي',
    start_url: new URL('.', location.href).pathname,
    display: 'standalone',
    background_color: themeColor,
    theme_color: themeColor,
    orientation: 'portrait',
    dir: 'rtl',
    lang: 'ar',
    icons: [
      {
        src: 'data:image/svg+xml,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="%23dcb674"/><text x="50" y="65" font-size="50" text-anchor="middle">💰</text></svg>'
        ),
        sizes: '192x192 512x512',
        type: 'image/svg+xml',
        purpose: 'any maskable'
      }
    ]
  };
  return new Blob([JSON.stringify(manifest)], {type:'application/json'});
}
function applyManifest(isLight){
  try{
    const link = document.getElementById('manifestLink');
    if(!link) return;
    // revoke the previous blob so it doesn't leak across theme toggles
    const old = link.getAttribute('href');
    if(old && old.startsWith('blob:')) URL.revokeObjectURL(old);
    link.setAttribute('href', URL.createObjectURL(buildManifestBlob(isLight)));
  }catch(e){}
}
function setupPWA(){
  applyManifest(document.body.classList.contains('light'));

  if('serviceWorker' in navigator){
    try{
      navigator.serviceWorker.register('./sw.js')
        .catch(e => console.warn('SW registration failed:', e));
    }catch(e){}
  }
}

/* Cheap signature of everything that affects visual output.
   Used to skip expensive re-renders when nothing changed. */
let _renderSig = '';
// Cached JSON strings for objects that change infrequently — avoids serializing
// the entire object graph on every render() call (which fires on each interaction).
let _sigWallets = '', _sigBudgets = '', _sigDist = '';
let _sigWalletsObj = null, _sigBudgetsObj = null, _sigDistObj = null;
function computeRenderSig(){
  if(state.wallets !== _sigWalletsObj){ _sigWalletsObj = state.wallets; _sigWallets = JSON.stringify(state.wallets); }
  if(budgets !== _sigBudgetsObj){ _sigBudgetsObj = budgets; _sigBudgets = JSON.stringify(budgets); }
  if(DISTRIBUTION !== _sigDistObj){ _sigDistObj = DISTRIBUTION; _sigDist = JSON.stringify(DISTRIBUTION); }
  return [
    state.transactions.length,
    state.transactions.length ? state.transactions[state.transactions.length-1].id : '',
    _sigWallets,
    currentFilter, walletFilter, categoryFilter, searchQuery,
    state.crisisMode, _sigBudgets,
    _sigDist, autoDistribute,
    dismissedRecurring.size
  ].join('|');
}

function render(force){
  const sig = computeRenderSig();
  if(!force && sig === _renderSig) return; // nothing visual changed
  _renderSig = sig;
  _monthlyExpenseCache = null; // invalidate budget bars per-render
  _recurringCache = null; // invalidate so edited tx amounts are re-evaluated
  // invalidate content caches keyed only on length/last-id — edits (amount,
  // desc, date, wallet, category) don't change those, so they must be reset
  // here to reflect in-place edits in the list, chart, analytics and hero.
  _filteredTxSig = '';
  _analyticsSig = '';
  _heroStatsSig = '';
  renderWallets();
  renderWalletSelect();
  renderTxList();
  renderChart();
  renderPieChart();
  renderAnalytics();
  renderRecurring();
}

let _resizeTimer;
window.addEventListener('resize', ()=> { clearTimeout(_resizeTimer); _resizeTimer = setTimeout(()=>{ renderChart(); renderPieChart(); }, 150); });

renderWalletSelect();
renderEditWalletSelect();
renderQuickAmounts();
_initQuickAmountSync();
renderCategoryGrid();
renderEditCategoryGrid();

// Enter key: submit add-form or save edit; Escape: close focused modal
document.addEventListener('keydown', e => {
  if(e.key === 'Enter'){
    const tag = document.activeElement && document.activeElement.tagName;
    const id  = document.activeElement && document.activeElement.id;
    // Add-form inputs → submit with current addFormType
    if(id === 'descInput' || id === 'amountInput'){
      e.preventDefault();
      addTx(addFormType);
    }
    // Edit-modal inputs → save
    if(id === 'editDesc' || id === 'editAmount'){
      e.preventDefault();
      saveEdit();
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
    // Close the topmost open modal
    const open = [...document.querySelectorAll('.modal-overlay.open')];
    if(open.length) closeModal(open[open.length-1].id);
  }
  if(e.key === 'Tab'){
    // Focus trap: keep Tab navigation inside the topmost open modal
    const openModals = [...document.querySelectorAll('.modal-overlay.open')];
    if(openModals.length){
      const modal = openModals[openModals.length-1];
      const focusable = [...modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter(el => el.offsetParent !== null); // only visible elements
      if(focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length-1];
      if(e.shiftKey){
        if(document.activeElement === first){ e.preventDefault(); last.focus(); }
      } else {
        if(document.activeElement === last){ e.preventDefault(); first.focus(); }
      }
    }
  }
});

initTheme();
setupPWA();
loadState().then(()=>{
  hideSplash();
  const wasFirstRun = !localStorage.getItem(LS_PREFIX + 'welcomeSeen');
  checkFirstRun();
  if(wasFirstRun){
    // mark today as reviewed so the daily modal doesn't stack on first run
    try{ localStorage.setItem(LS_PREFIX + 'lastReviewDate', todayISO()); }catch(e){}
  } else {
    setTimeout(checkDailyReview, 400);
  }
});
initDrive();

// Refresh time-sensitive UI (budget bars, day/week filter, analytics) when user returns to tab
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible'){
    _monthlyExpenseCache = null;
    _monthlyExpenseCacheKey = '';
    capDateInputsToToday(); // "today" may have rolled over while tab was hidden
    render(true);
  } else {
    // flush pending Drive sync immediately — the 1500ms debounce may never fire if tab is discarded
    if(driveSyncTimer){ clearTimeout(driveSyncTimer); driveSyncTimer = null; if(driveAccessToken) driveSyncToCloud(); }
  }
});

// Proactive refresh when date rolls over while tab stays open in foreground
// (visibilitychange only fires when the user switches away/back — this covers the
// midnight-in-foreground case: month stats, day/week/year filter, budget bars all
// depend on "today" and must update the moment the day changes)
function scheduleNextMidnightRefresh(){
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  setTimeout(function midnightRefresh(){
    _monthlyExpenseCache = null;
    _monthlyExpenseCacheKey = '';
    capDateInputsToToday();
    render(true);
    // re-arm for the following midnight
    const n = new Date();
    const nm = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    setTimeout(midnightRefresh, nm.getTime() - n.getTime());
  }, nextMidnight.getTime() - now.getTime());
}
scheduleNextMidnightRefresh();

// Multi-tab sync: reload state if another tab saves data
window.addEventListener('storage', (e) => {
  if(e.key && e.key.startsWith(LS_PREFIX) && e.key !== LS_PREFIX+'lastEdit'){
    loadState();
  }
});

// Global handler for unhandled promise rejections — prevents silent failures
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
  toast('⚠ حدث خطأ غير متوقع', true);
});

// Prevent accidental scroll-wheel from changing number input values on desktop
// Delegated to document so it covers any dynamically added number inputs too
document.addEventListener('wheel', e => {
  if(e.target && e.target.tagName === 'INPUT' && e.target.type === 'number' && document.activeElement === e.target){
    e.preventDefault();
  }
}, {passive:false});
