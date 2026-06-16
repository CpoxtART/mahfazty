
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
let _txMutationStamp = 0;
// >0 while a multi-step async mutation is running (add/delete/distribute). The
// cross-tab storage listener checks this so another tab's save can't trigger a
// loadState() that resets `state` mid-mutation and corrupts balances.
let _opInFlight = 0;
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

/* v9.3 */
let currentTab = 'home';
let addDrawerOpen = false;
let drawerTab = 0;
let subscriptions = []; // [{id, name, amount, billingDay, active}]
let editingSubId = null;

/* v9.4 — customizable layout (tab + section order) */
let _layoutEditorTab = 'tab'; // which sub-tab is active in the layout editor
const TAB_DEFS = {
  home:         {icon:'🏠', label:'الرئيسي',   panel:'tabHome'},
  transactions: {icon:'🧾', label:'المعاملات', panel:'tabTransactions'},
  analytics:    {icon:'📊', label:'تحليلات',   panel:'tabAnalytics'},
  reports:      {icon:'📋', label:'التقارير',  panel:'tabReports'}
};
const DEFAULT_TAB_ORDER = ['home','transactions','analytics','reports'];
const SECTION_DEFS = {
  home: [
    {key:'balance', label:'💰 إجمالي المتاح'},
    {key:'crisis',  label:'🚨 وضع الطوارئ'},
    {key:'wallets', label:'👛 المحافظ'}
  ],
  analytics: [
    {key:'stats',         label:'📊 تحليلات الشهر'},
    {key:'recurring',     label:'🔔 تنبيهات متكررة'},
    {key:'export',        label:'📄 تصدير التقرير'},
    {key:'subscriptions', label:'📆 الاشتراكات'},
    {key:'chart',         label:'🥧 التوزيع حسب الفئة'}
  ],
  reports: [
    {key:'summary', label:'🧮 ملخص الدخل/المصروف'},
    {key:'chart',   label:'📈 حركة الرصيد'},
    {key:'list',    label:'🧾 قائمة المعاملات'}
  ]
};
let tabOrder = DEFAULT_TAB_ORDER.slice();
let sectionOrder = {}; // {home:[...], analytics:[...], reports:[...]}
const RECENT_TX_LIMIT_MAX = 50;
const RECENT_TX_LIMIT_DEFAULT = 25;
let recentTxLimit = RECENT_TX_LIMIT_DEFAULT; // how many tx the log shows per page (user-set, capped at 50)

/* SW update flow */
let _swRegistration = null;
let _pendingWorker = null;
let _reloadOnControllerChange = false;

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
    .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 0x0660) // Arabic-Indic digits
    .replace(/[۰-۹]/g, d => d.charCodeAt(0) - 0x06F0) // Extended (Persian) digits
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
    .replace(/[‪-‮⁦-⁩]/g,'') // explicit escapes: immune to source-editor normalization stripping literal control chars
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
  // key by id, falling back to a stable per-element key so two id-less elements
  // can't share the "" slot and cancel each other's frames
  const key = el.id || (el._animKey || (el._animKey = 'anon_' + Math.random().toString(36).slice(2)));
  const dur = (typeof duration === 'number' && duration > 0) ? duration : 450;
  if(_animFrames[key]) cancelAnimationFrame(_animFrames[key]);
  const start = performance.now();
  function frame(now){
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.textContent = fmt(from + (to - from) * eased);
    if(t < 1) _animFrames[key] = requestAnimationFrame(frame);
    else delete _animFrames[key];
  }
  _animFrames[key] = requestAnimationFrame(frame);
}
/* ============================================================
   THEME (dark / light)
============================================================ */
// Cache resolved CSS theme colors — getComputedStyle() forces a synchronous
// layout flush, and the charts read these on every redraw. Invalidated whenever
// the theme changes (applyTheme below).
let _themeColorCache = {};
function themeColor(name, fallback){
  let v = _themeColorCache[name];
  if(v === undefined){
    v = getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
    _themeColorCache[name] = v;
  }
  return v;
}

// Smooth-scroll the tx list into view AFTER the current render settles (deferring
// to the next frame stops the scroll animation from competing with layout/canvas
// work, which caused visible stutter on filter/search changes)
function scrollToTxList(){
  switchTab('reports');
  const el = document.getElementById('txList');
  if(el) requestAnimationFrame(()=> el.scrollIntoView({behavior:'smooth', block:'start'}));
}

function applyTheme(theme){
  _themeColorCache = {}; // theme switch — drop cached colors so charts re-read them
  document.body.classList.toggle('light', theme === 'light');
  const btn = document.getElementById('themeToggle');
  if(btn){
    btn.textContent = theme === 'light' ? '🌙' : '☀️';
    btn.title = theme === 'light' ? 'التبديل للوضع الداكن' : 'التبديل للوضع الفاتح';
  }
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

// Timestamp for a transaction on the chosen date at the current time, INCLUDING
// milliseconds — so two entries within the same second still get distinct,
// correctly-ordered ts values (the sort's id tiebreaker covers any exact-ms tie).
function buildTxTs(dateVal){
  const now = new Date();
  const ts = new Date(dateVal + 'T' + now.toTimeString().slice(0,8)).getTime();
  if(!isFinite(ts)) return Date.now(); // guard against an invalid date string
  return ts + now.getMilliseconds();
}

// Cap all date pickers at today so a transaction can't be accidentally future-dated
function capDateInputsToToday(){
  const t = todayISO();
  ['dateInput','editDate','transferDate'].forEach(id=>{
    const el = document.getElementById(id);
    if(el){ el.setAttribute('max', t); el.setAttribute('min', '2010-01-01'); }
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

  let _lsHadBalances = false;
  try{
    const bal = localStorage.getItem(LS_PREFIX + 'balances');
    if(bal){
      const saved = JSON.parse(bal);
      // only restore known wallet ids — prevents orphaned keys from corrupted imports.
      // coerce to a finite number so a tampered/corrupt backup ("abc", null, 1e999→Infinity)
      // can't poison balances with NaN/Infinity that then propagates through all math.
      WALLET_DEFS.forEach(w => {
        if(saved[w.id] !== undefined){
          const v = parseFloat(saved[w.id]);
          if(isFinite(v)) state.wallets[w.id] = Math.round(v*100)/100;
        }
      });
      _lsHadBalances = true;
    }
  }catch(e){}

  let _lsHadConfig = false;
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
        // sanitizeDistribution also clamps/validates each pct (a raw filter would
        // let a NaN/negative/string pct from a tampered config into the money math)
        DISTRIBUTION = sanitizeDistribution(c.distribution);
      }
      dismissedRecurring = new Set(Array.isArray(c.dismissedRecurring) ? c.dismissedRecurring : []);
      _lsHadConfig = true;
    }
  }catch(e){}

  const _validTx = arr => (Array.isArray(arr) ? arr : []).filter(t =>
    t && (t.type === 'income' || t.type === 'expense') &&
    typeof t.ts === 'number' && isFinite(t.ts) && t.ts > 0 &&
    typeof t.amount === 'number' && isFinite(t.amount) && t.amount > 0 &&
    WALLET_DEFS.find(w => w.id === t.wallet));

  // ── Transactions: IndexedDB is the PRIMARY store (scales far past localStorage's
  //    ~5MB cap). localStorage may still hold a legacy copy from older versions or
  //    an IDB-unavailable fallback — used only when newer than the IDB snapshot. ──
  const _lsLastEdit = parseInt(localStorage.getItem(LS_PREFIX + 'lastEdit') || '0', 10) || 0;
  // Prefer dataEdit (bumped only by real DATA changes) so a pref-only save that
  // bumped lastEdit can't make a stale localStorage tx blob win over fresher IDB.
  // Fall back to lastEdit only when dataEdit is absent (legacy migration path).
  const _lsDataEdit = parseInt(localStorage.getItem(LS_PREFIX + 'dataEdit') || '0', 10) || 0;
  const _idb = await idbRestore(); // also opens the DB, setting _idbAvailable
  const _idbTime = (_idb && typeof _idb.savedAt === 'number' && isFinite(_idb.savedAt)) ? _idb.savedAt : 0;
  let _lsTx = null;
  try{ const raw = localStorage.getItem(LS_PREFIX + 'transactions'); if(raw) _lsTx = JSON.parse(raw); }catch(e){}
  const _idbHasTx = _idb && Array.isArray(_idb.transactions);
  const _lsTxNewer = Array.isArray(_lsTx) && (_lsDataEdit || _lsLastEdit) > _idbTime;

  if(_idbHasTx && !_lsTxNewer){
    // IndexedDB snapshot is the source of truth
    state.transactions = _validTx(_idb.transactions);
    // If localStorage was wiped (cleared storage), recover the small data too
    if(!_lsHadBalances && _idb.wallets){
      WALLET_DEFS.forEach(w => {
        if(_idb.wallets[w.id] !== undefined){
          const v = parseFloat(_idb.wallets[w.id]);
          if(isFinite(v)) state.wallets[w.id] = Math.round(v*100)/100;
        }
      });
    }
    if(!_lsHadConfig){
      if(typeof _idb.crisisMode === 'boolean') state.crisisMode = _idb.crisisMode;
      if(typeof _idb.autoDistribute === 'boolean') autoDistribute = _idb.autoDistribute;
      if(_idb.budgets && typeof _idb.budgets === 'object') budgets = sanitizeBudgets(_idb.budgets);
      if(Array.isArray(_idb.dismissedRecurring)) dismissedRecurring = new Set(_idb.dismissedRecurring);
      if(_idb.distribution && Array.isArray(_idb.distribution)) DISTRIBUTION = sanitizeDistribution(_idb.distribution);
    }
    if(Array.isArray(_idb.subscriptions)){
      try{ localStorage.setItem(LS_PREFIX + 'subs', JSON.stringify(_idb.subscriptions)); }catch(e){}
    }
    if(!_lsHadBalances && state.transactions.length) toast('✓ تمت استعادة البيانات من النسخ الاحتياطي');
  } else if(Array.isArray(_lsTx)){
    // Legacy localStorage copy (older version) or IDB unavailable — adopt it; the
    // idbBackup below migrates it into IndexedDB.
    state.transactions = _validTx(_lsTx);
  }

  // A restored snapshot may contain a half-surviving linked group (one leg of a
  // transfer/distribution dropped by the validity filter). Clear the dangling
  // link so a later delete doesn't try to cascade to a partner that isn't there.
  stripOrphanLinks(state.transactions);
  _allTxSortedCache = null; // freshly replaced array — drop the sorted cache

  // Persist the consistent state into IndexedDB, then (only once confirmed) drop the
  // big legacy localStorage transactions key to free the ~5MB quota for small data.
  const _backupStamp = Math.max(_lsLastEdit, _idbTime) || Date.now();
  const _idbOk = await idbBackup(_backupStamp);
  if(_idbOk && _lsTx !== null){
    try{ localStorage.removeItem(LS_PREFIX + 'transactions'); }catch(e){}
  }

  _txMutationStamp++; // fresh data set loaded — invalidate any derived caches
  const _di = document.getElementById('dateInput');
  if(_di) _di.value = todayISO();
  capDateInputsToToday();
  loadSubs();
  render(true);
}

// Recompute every wallet balance purely from the transaction ledger
// (model: balance = 0 + Σ ledger; an expense subtracts, income/adjustment adds).
// Source of truth is the ledger, so this self-heals any drift between the stored
// balances and the transactions (from a crash mid-write, a tampered backup, or a
// rounding bug). Returns a {id: delta} diff of what changed, applies nothing
// destructive on its own beyond setting state.wallets — caller decides to persist.
function reconcileBalances(){
  const computed = {}, diff = {};
  WALLET_DEFS.forEach(w => computed[w.id] = 0); // baseline 0 per the app's model
  state.transactions.forEach(tx => {
    if(computed[tx.wallet] === undefined) return; // skip unknown wallet ids
    const amt = parseFloat(tx.amount);
    if(!isFinite(amt)) return;
    computed[tx.wallet] = Math.round((computed[tx.wallet] + (tx.type === 'expense' ? -amt : amt)) * 100) / 100;
  });
  WALLET_DEFS.forEach(w => {
    const before = parseFloat(state.wallets[w.id]) || 0;
    const after = computed[w.id];
    if(Math.abs(after - before) >= 0.005) diff[w.id] = Math.round((after - before) * 100) / 100;
    state.wallets[w.id] = after;
  });
  return diff;
}

// dataEdit marks the last change to actual user DATA (balances/transactions/subs),
// distinct from lastEdit which any save (incl. config/prefs) bumps. Drive conflict
// resolution compares dataEdit so a pref-only change (crisis toggle, layout) can't
// make a stale local copy "win" over fresher cloud transaction data.
function stampDataEdit(ts){ try{ localStorage.setItem(LS_PREFIX + 'dataEdit', String(ts)); }catch(e){} }
async function saveBalances(){ const ts = Date.now(); try{ localStorage.setItem(LS_PREFIX + 'balances', JSON.stringify(state.wallets)); localStorage.setItem(LS_PREFIX + 'lastEdit', String(ts)); }catch(e){ toast('⚠ فشل الحفظ المحلي — يتم الحفظ في النسخة الاحتياطية', true); } stampDataEdit(ts); scheduleDriveSync(); idbBackup(ts); }
async function saveTx(){
  _allTxSortedCache = null;
  const ts = Date.now();
  // Transactions are stored in IndexedDB (idbBackup below) so they scale far past
  // the ~5MB localStorage cap. Here we only stamp the small timestamps. If IDB is
  // unavailable, idbBackup() mirrors the array to localStorage as a fallback.
  try{ localStorage.setItem(LS_PREFIX + 'lastEdit', String(ts)); }catch(e){}
  stampDataEdit(ts);
  scheduleDriveSync();
  idbBackup(ts);
}
function _pruneRecurringDismissals(){
  if(dismissedRecurring.size < 40) return;
  // dismissal keys are "desc\x00walletId" (see detectRecurring) — build the live
  // set with the SAME shape, otherwise NONE of the keys ever match and we wipe
  // every dismissal at once, making dismissed suggestions reappear.
  const live = new Set(
    state.transactions
      .map(tx => (tx.desc||'').trim().toLowerCase() + '\x00' + tx.wallet)
      .filter(k => k.charAt(0) !== '\x00') // drop empty-description keys
  );
  for(const k of dismissedRecurring){ if(!live.has(k)) dismissedRecurring.delete(k); }
}
async function saveConfig(){ const ts = Date.now(); _pruneRecurringDismissals(); try{ localStorage.setItem(LS_PREFIX + 'config', JSON.stringify({crisisMode: state.crisisMode, autoDistribute: autoDistribute, budgets: budgets, dismissedRecurring: Array.from(dismissedRecurring), distribution: DISTRIBUTION})); localStorage.setItem(LS_PREFIX + 'lastEdit', String(ts)); }catch(e){ toast('⚠ فشل حفظ الإعدادات محليًا', true); } scheduleDriveSync(); idbBackup(ts); }
// clamp a subscription's billing day into 1–31 so corrupt data can't produce
// "يوم 99" that never matches the daily-review check
function _normalizeSub(x){
  let d = parseInt(x.billingDay, 10);
  if(!isFinite(d)) d = 1;
  x.billingDay = Math.min(31, Math.max(1, d));
  return x;
}
function loadSubs(){
  try{
    const s = localStorage.getItem(LS_PREFIX + 'subs');
    if(s) subscriptions = JSON.parse(s)
      .filter(x => x && x.id && x.name && isFinite(x.amount) && x.amount > 0)
      .map(_normalizeSub);
  }catch(e){ subscriptions = []; }
}
async function saveSubs(){
  const ts = Date.now();
  try{ localStorage.setItem(LS_PREFIX + 'subs', JSON.stringify(subscriptions)); }catch(e){}
  stampDataEdit(ts);
  scheduleDriveSync();
  idbBackup(ts);
}

/* ============================================================
   INDEXEDDB BACKUP (extra resilience alongside localStorage)
============================================================ */
let _idbInstance = null;
let _idbAvailable = false; // becomes true once the DB opens — gates IDB-primary storage
function idbOpen(){
  return new Promise((resolve, reject)=>{
    if(_idbInstance){ resolve(_idbInstance); return; }
    if(!('indexedDB' in window)){ reject('no idb'); return; }
    const req = indexedDB.open('walletTrackerDB', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('backup');
    };
    req.onsuccess = () => { _idbInstance = req.result; _idbAvailable = true; resolve(_idbInstance); };
    req.onerror   = () => reject(req.error);
    // Fires when another tab holds the DB at an older version and hasn't closed
    // it — without this the open request hangs indefinitely.
    req.onblocked = () => reject(new Error('idb blocked'));
  });
}
// Writes the full snapshot to IndexedDB — the PRIMARY store for transactions
// (localStorage only holds the small balances/config/prefs). Returns true on a
// confirmed write so callers can safely migrate/free the legacy localStorage copy.
let _idbWriteInFlight = 0; // >0 while an IDB snapshot write is committing
async function idbBackup(savedAt){
  _idbWriteInFlight++;
  try{
    const db = await idbOpen();
    await new Promise((resolve, reject)=>{
      const tx = db.transaction('backup','readwrite');
      tx.objectStore('backup').put({
        wallets: state.wallets,
        transactions: state.transactions,
        crisisMode: state.crisisMode,
        autoDistribute, budgets,
        distribution: DISTRIBUTION,
        dismissedRecurring: Array.from(dismissedRecurring),
        subscriptions: subscriptions,
        savedAt: (typeof savedAt === 'number' && isFinite(savedAt)) ? savedAt : Date.now()
      }, 'snapshot');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('idb abort'));
    });
    _idbAvailable = true;
    return true;
  }catch(e){
    // IndexedDB unavailable/failed (e.g. private mode) — fall back to a localStorage
    // mirror so transactions still persist (bounded by the ~5MB quota in that case).
    _idbAvailable = false;
    try{ localStorage.setItem(LS_PREFIX + 'transactions', JSON.stringify(state.transactions)); }
    catch(_){ /* quota — Drive sync / export remain the safety net */ }
    return false;
  }finally{
    _idbWriteInFlight--;
  }
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
  const _ct = document.getElementById('crisisToggle');
  if(_ct) _ct.setAttribute('aria-checked', state.crisisMode ? 'true' : 'false'); // may be hidden via layout editor
  // crisis flips the spendable total by the reserve amount — that's not a real
  // money movement, so snap to the new value instead of count-up animating across it
  prevSpendable = null;
  saveConfig();
  render();
  toast(state.crisisMode ? '🚨 تم تفعيل وضع الطوارئ' : '✓ تم إيقاف وضع الطوارئ');
}

