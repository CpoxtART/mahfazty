
/* ============================================================
   CONFIG
============================================================ */
const WALLET_DEFS = [
  {id:'core',        name:'Core Expenses',  initial:0, track:false, pct:'50%'},
  {id:'wishlist',    name:'Wishlist',       initial:0, track:false, pct:'10%'},
  {id:'growth',      name:'Growth',         initial:0, track:false, pct:'10%'},
  {id:'investments', name:'Investments',    initial:0, track:false, pct:'10%'},
  {id:'joy',         name:'Joy of Life',    initial:0, track:false, pct:'10%'},
  {id:'giving',      name:'Giving',         initial:0, track:false, pct:'5%'},
  {id:'reserve',     name:'Reserve',        initial:0, track:false, pct:'5%'},
  {id:'uber',        name:'Uber',           initial:0, track:true,  pct:'تتبع'},
  {id:'cards',       name:'Bank Cards',     initial:0, track:true,  pct:'تتبع'},
  {id:'cash',        name:'Cash',           initial:0, track:true,  pct:'تتبع'},
];
// Bar width baseline. Initials are all 0 (fresh app), so a static max is useless;
// derive the scale from the largest current non-track balance at render time so
// the bars stay proportional as real balances grow. Floor of 1 avoids /0.
function maxWalletVal(){
  let m = 1;
  WALLET_DEFS.forEach(w => {
    if(w.track) return;
    const v = parseFloat(state.wallets[w.id]) || 0;
    if(v > m) m = v;
  });
  return m;
}
// In emergency mode the whole "second half" (everything except Core Expenses,
// i.e. the non-track 50%: wishlist+growth+investments+joy+giving+reserve) merges
// into one unified emergency reserve. Wishlist was previously missing here, so it
// wrongly stayed visible at 10% beside Core while the combined card claimed 50%.
const CRISIS_WALLET_IDS = ['wishlist','growth','investments','joy','giving','reserve'];

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
let _editingDistSource = false; // when true, amount is locked (already-distributed income source)
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
// Tombstones for delete propagation in multi-device merge sync: {txId: deletedAtMs}.
// Without these, a union merge would resurrect a transaction deleted on another
// device. Pruned to the last 90 days so the set stays bounded.
let deletedTxIds = {};
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
function pruneTombstones(){
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  for(const id in deletedTxIds){ if(!(deletedTxIds[id] > cutoff)) delete deletedTxIds[id]; }
}

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
    {key:'crisis',  label:'🔄 الوضع البديل'},
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

// Build a grammatically-correct "<count> <noun>" Arabic phrase. Arabic number
// agreement: 1 → singular ("معاملة واحدة"), 2 → dual ("معاملتان"), 3-10 → plural
// ("3 معاملات"), 11+ → singular form again ("11 معاملة"). Naively concatenating
// `${count} ${singular}` is only ever correct for the 11+ case, so every count+noun
// spot in the UI needs this instead of raw template-literal interpolation.
function arPlural(count, singular, dual, plural){
  const n = Math.abs(Number(count) || 0);
  if(n === 1) return `${singular} واحدة`;
  if(n === 2) return dual;
  if(n >= 3 && n <= 10) return `${count} ${plural}`;
  return `${count} ${singular}`;
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
// Rejects parseFloat quirks that silently create absurd balances: scientific/
// hex notation ("1e9", "0x10") and values beyond a sane money ceiling. Returns
// NaN on any rejection so every caller's existing isFinite/isNaN guard catches it.
const MAX_AMOUNT = 1e12; // one trillion — well above any realistic single entry
function parseAmount(str){
  const norm = normalizeDigits(str);
  if(/[a-zA-Z]/.test(norm)) return NaN; // block 1e9 / 0x10 / Infinity / NaN-style strings
  const v = parseFloat(norm);
  if(!isFinite(v) || Math.abs(v) > MAX_AMOUNT) return NaN;
  return v;
}

function escHtml(str){
  return String(str||'')
    // strip Unicode bidi controls + zero-width chars — a pasted or voiced
    // description containing e.g. U+202E or U+200F can otherwise visually scramble
    // the whole RTL layout of surrounding UI text ("Trojan Source"-style display
    // corruption). Covers: zero-width (200B-200D, FEFF), LRM/RLM (200E-200F),
    // Arabic letter mark (061C), embeddings/overrides (202A-202E), isolates (2066-2069).
    // Explicit \u escapes are immune to source-editor stripping of literal controls.
    .replace(/[\u200B-\u200F\u061C\u202A-\u202E\u2066-\u2069\uFEFF]/g,'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#x27;');
}

// Short tactile pulse on meaningful actions (add/delete/toggle) — makes the app
// feel native. Silently no-ops where unsupported, and respects reduced-motion.
function haptic(pattern){
  try{
    if(typeof navigator !== 'undefined' && navigator.vibrate &&
       !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)){
      navigator.vibrate(pattern);
    }
  }catch(_){}
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
    // stop animating a node that was removed mid-flight (avoids writing to a
    // detached element and leaking the rAF chain)
    if(el.isConnected === false){ delete _animFrames[key]; return; }
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
  // never allow a future ts (clock skew / DST edge) — it would sort above
  // everything and corrupt "this month" filters. Edit path already caps; do it here too.
  return Math.min(ts + now.getMilliseconds(), now.getTime());
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
      if(c.deletedTxIds && typeof c.deletedTxIds === 'object') deletedTxIds = c.deletedTxIds;
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
  // Wrapped (unlike a plain read) because some locked-down browsers (e.g. old Safari
  // private mode) throw on EVERY localStorage call, not just setItem — an uncaught
  // throw here would reject loadState() and leave the splash screen stuck for 6s
  // until the fatal-error watchdog kicks in, instead of degrading to IDB-only state.
  let _lsLastEdit = 0, _lsDataEdit = 0;
  try{ _lsLastEdit = parseInt(localStorage.getItem(LS_PREFIX + 'lastEdit') || '0', 10) || 0; }catch(e){}
  // Prefer dataEdit (bumped only by real DATA changes) so a pref-only save that
  // bumped lastEdit can't make a stale localStorage tx blob win over fresher IDB.
  // Fall back to lastEdit only when dataEdit is absent (legacy migration path).
  try{ _lsDataEdit = parseInt(localStorage.getItem(LS_PREFIX + 'dataEdit') || '0', 10) || 0; }catch(e){}
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
    if(_idb.deletedTxIds && typeof _idb.deletedTxIds === 'object' && !Object.keys(deletedTxIds).length) deletedTxIds = _idb.deletedTxIds;
    if(Array.isArray(_idb.subscriptions)){
      try{ localStorage.setItem(LS_PREFIX + 'subs', JSON.stringify(_idb.subscriptions)); }catch(e){}
    }
    if(!_lsHadBalances && state.transactions.length) toast('✓ تمت استعادة البيانات من النسخ الاحتياطي');
  } else if(Array.isArray(_lsTx)){
    // Legacy localStorage copy (older version) or IDB unavailable — adopt it; the
    // idbBackup below migrates it into IndexedDB.
    state.transactions = _validTx(_lsTx);
  }

  // Drop any tx that's tombstoned (deleted on another device that synced its
  // delete) and prune expired tombstones so the set stays bounded.
  pruneTombstones();
  if(Object.keys(deletedTxIds).length){
    state.transactions = state.transactions.filter(t => !deletedTxIds[t.id]);
  }

  // A restored snapshot may contain a half-surviving linked group (one leg of a
  // transfer/distribution dropped by the validity filter). Clear the dangling
  // link so a later delete doesn't try to cascade to a partner that isn't there.
  stripOrphanLinks(state.transactions);
  _allTxSortedCache = null; // freshly replaced array — drop the sorted cache

  // If the DB couldn't be opened (blocked by another tab / corrupt) and we ended up
  // with NO transactions despite having used the app before, the data is intact in
  // IDB but unreachable. Warn the user and DO NOT run idbBackup — writing our empty
  // in-memory state could clobber the real snapshot if the DB becomes writable.
  const _hadPriorData = _lsLastEdit > 0 || _lsDataEdit > 0 || _lsHadBalances;
  const _idbLockedOut = _idbOpenFailed && state.transactions.length === 0 && _hadPriorData;
  if(_idbLockedOut){
    try{ toast('⚠ تعذّر فتح قاعدة البيانات — أغلق نسخ التطبيق الأخرى المفتوحة ثم أعد التحميل', true); }catch(e){}
  }

  // Persist the consistent state into IndexedDB, then (only once confirmed) drop the
  // big legacy localStorage transactions key to free the ~5MB quota for small data.
  const _backupStamp = Math.max(_lsLastEdit, _idbTime) || Date.now();
  const _idbOk = _idbLockedOut ? false : await idbBackup(_backupStamp);
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

// Multi-device union merge: combine local + cloud transactions/subscriptions by id
// (so a transaction added on either device is never lost), honor tombstones from
// BOTH sides (so a deletion on either device propagates instead of resurrecting),
// then recompute balances from the merged ledger (0 + Σ — the app's model). Config
// (crisis/budgets/distribution/prefs) is taken from whichever side edited last.
// Returns {added, removed} counts for an informative toast.
function mergeCloudData(cloud, cloudNewer){
  const validTx = t => t && (t.type === 'income' || t.type === 'expense') &&
    typeof t.ts === 'number' && isFinite(t.ts) && t.ts > 0 &&
    typeof t.amount === 'number' && isFinite(t.amount) && t.amount > 0 &&
    WALLET_DEFS.find(w => w.id === t.wallet);

  // 1) union tombstones from both sides
  if(cloud.deletedTxIds && typeof cloud.deletedTxIds === 'object'){
    for(const id in cloud.deletedTxIds){
      const t = cloud.deletedTxIds[id];
      if(typeof t === 'number' && (!deletedTxIds[id] || t > deletedTxIds[id])) deletedTxIds[id] = t;
    }
  }
  pruneTombstones();

  // 2) union transactions by id (local first, then cloud fills in the rest),
  //    skipping anything tombstoned on either side so deletes win over a stale copy
  const localCount = state.transactions.length;
  const byId = new Map();
  state.transactions.forEach(t => { if(validTx(t) && !deletedTxIds[t.id]) byId.set(t.id, t); });
  let removed = state.transactions.filter(t => deletedTxIds[t.id]).length; // local rows a remote delete removes
  let added = 0;
  (Array.isArray(cloud.transactions) ? cloud.transactions : []).forEach(t => {
    if(validTx(t) && !deletedTxIds[t.id] && !byId.has(t.id)){ byId.set(t.id, t); added++; }
  });
  state.transactions = [...byId.values()];
  stripOrphanLinks(state.transactions);
  _allTxSortedCache = null;

  // 4) merge subscriptions by id (union; cloud wins on a true id clash)
  const subById = new Map();
  subscriptions.forEach(s => subById.set(s.id, s));
  (Array.isArray(cloud.subscriptions) ? cloud.subscriptions : []).forEach(s => {
    if(s && s.id && s.name && isFinite(s.amount) && s.amount > 0) subById.set(s.id, _normalizeSub(s));
  });
  subscriptions = [...subById.values()];

  // 5) config from the side that edited most recently
  if(cloudNewer){
    if(typeof cloud.crisisMode === 'boolean') state.crisisMode = cloud.crisisMode;
    if(typeof cloud.autoDistribute === 'boolean') autoDistribute = cloud.autoDistribute;
    if(cloud.budgets && typeof cloud.budgets === 'object') budgets = sanitizeBudgets(cloud.budgets);
    if(cloud.distribution && Array.isArray(cloud.distribution)) DISTRIBUTION = sanitizeDistribution(cloud.distribution);
    if(cloud.uiPrefs && typeof applyUiPrefs === 'function') applyUiPrefs(cloud.uiPrefs);
  }
  // dismissedRecurring: union both sides (a dismissal on either device sticks)
  if(Array.isArray(cloud.dismissedRecurring)) cloud.dismissedRecurring.forEach(k => dismissedRecurring.add(k));

  // 6) rebuild balances from the merged ledger so they're provably consistent
  reconcileBalances();
  _txMutationStamp++;
  prevSpendable = null;
  return { added, removed, hadLocal: localCount };
}

// Recompute every (non-track) wallet balance purely from the transaction ledger
// (model: balance = 0 + Σ ledger; an expense subtracts, income/adjustment adds).
// Source of truth is the ledger, so this self-heals any drift between the stored
// balances and the transactions (from a crash mid-write, a tampered backup, or a
// rounding bug). Returns a {id: delta} diff of what changed, applies nothing
// destructive on its own beyond setting state.wallets — caller decides to persist.
// Track wallets (Uber/Cards/Cash) are skipped — their balance is intentionally
// maintained manually (see checkBalanceDrift) and can legitimately diverge from
// the ledger (real-world fees/interest never entered as a transaction). Without
// this exclusion, an automatic background Drive merge would silently blow away a
// manually-set tracked balance back to the ledger sum.
function reconcileBalances(){
  const computed = {}, diff = {};
  WALLET_DEFS.forEach(w => { if(!w.track) computed[w.id] = 0; }); // baseline 0 per the app's model
  state.transactions.forEach(tx => {
    if(computed[tx.wallet] === undefined) return; // skip unknown/track wallet ids
    const amt = parseFloat(tx.amount);
    if(!isFinite(amt)) return;
    computed[tx.wallet] = Math.round((computed[tx.wallet] + (tx.type === 'expense' ? -amt : amt)) * 100) / 100;
  });
  WALLET_DEFS.forEach(w => {
    if(w.track) return; // leave manually-tracked balances untouched
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
  // dismissal keys are "desc\x00walletId" (see detectRecurring, which keys on
  // normalizeSearch(desc)) — build the live set with the SAME shape, otherwise
  // NONE of the keys ever match and we wipe every dismissal at once, making
  // dismissed suggestions reappear.
  const live = new Set(
    state.transactions
      .map(tx => normalizeSearch(tx.desc) + '\x00' + tx.wallet)
      .filter(k => k.charAt(0) !== '\x00') // drop empty-description keys
  );
  for(const k of dismissedRecurring){ if(!live.has(k)) dismissedRecurring.delete(k); }
}
async function saveConfig(){ const ts = Date.now(); _pruneRecurringDismissals(); pruneTombstones(); try{ localStorage.setItem(LS_PREFIX + 'config', JSON.stringify({crisisMode: state.crisisMode, autoDistribute: autoDistribute, budgets: budgets, dismissedRecurring: Array.from(dismissedRecurring), distribution: DISTRIBUTION, deletedTxIds: deletedTxIds})); localStorage.setItem(LS_PREFIX + 'lastEdit', String(ts)); }catch(e){ toast('⚠ فشل حفظ الإعدادات محليًا', true); } scheduleDriveSync(); idbBackup(ts); }
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
        deletedTxIds: deletedTxIds,
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
    try{
      localStorage.setItem(LS_PREFIX + 'transactions', JSON.stringify(state.transactions));
    }catch(_){
      // BOTH IndexedDB and the localStorage fallback failed — the latest change is
      // memory-only and will be lost on reload. This fires AFTER the optimistic
      // success toast (idbBackup runs unawaited in the background from
      // saveTx/saveBalances/etc, so render()+toast('✓ ...') already happened).
      // A plain toast() here would just overwrite/be overwritten by whatever
      // routine toast fires next (e.g. the distribution-flow toast in addTx) and
      // vanish in 2.2s — easy to miss for a once-per-session, data-loss-grade
      // warning. Use toastWithAction: longer-lived (5s), gives a real recovery
      // step, and is visually distinct from a routine success/error toast.
      if(!_persistFailWarned){
        _persistFailWarned = true;
        try{
          toastWithAction('⚠ تعذّر حفظ البيانات على هذا الجهاز — صدّرها الآن قبل إغلاق التطبيق', 'تصدير الآن', () => { try{ exportData(); }catch(e){} }, true);
        }catch(__){}
      }
    }
    return false;
  }finally{
    _idbWriteInFlight--;
  }
}
let _persistFailWarned = false; // gate the "could not persist" warning to once/session
let _idbOpenFailed = false; // true when the DB exists but couldn't be opened (blocked/corrupt)
async function idbRestore(){
  try{
    const db = await idbOpen();
    return new Promise((resolve)=>{
      const tx = db.transaction('backup','readonly');
      const req = tx.objectStore('backup').get('snapshot');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }catch(e){
    // Distinguish "IndexedDB unsupported" (expected → LS fallback) from a real open
    // failure such as onblocked (another tab holds an older version) or corruption.
    // The latter means the user's data is SAFE in IDB but unreachable right now —
    // loadState must warn rather than present an empty app and must NOT overwrite it.
    if(e !== 'no idb') _idbOpenFailed = true;
    return null;
  }
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
  haptic(15);
  toast(state.crisisMode ? '🔄 تم تفعيل الوضع البديل' : '✓ تم إيقاف الوضع البديل');
}

