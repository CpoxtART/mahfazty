
/* ============================================================
   APP CORE — config, state, persistence, formatting/parsing utilities
   Loaded first (right after i18n.js/changelog.js), before every other app.*.js
   file — it owns WALLET_DEFS/CATEGORIES/state, localStorage+IndexedDB
   persistence (loadState/saveTx/saveBalances/idbBackup/...), amount/date
   parsing and formatting, theme, and crisis mode. Every other file's
   top-level statements run after this one, so they can freely reference
   anything declared here.
============================================================ */
/* ============================================================
   CONFIG
============================================================ */
const LS_PREFIX = 'walletTracker_';

/** @type {{id:string, name:string, initial:number, track:boolean, pct?:string, crisisOnly?:boolean}[]} */
const WALLET_DEFS = [
  {id:'core',        name:'Core Expenses',       initial:0, track:false, pct:'50%'},
  {id:'wishlist',    name:'Wishlist',            initial:0, track:false, pct:'10%'},
  {id:'growth',      name:'Growth',              initial:0, track:false, pct:'10%'},
  {id:'investments', name:'Investments',         initial:0, track:false, pct:'10%'},
  {id:'joy',         name:'Joy of Life',         initial:0, track:false, pct:'10%'},
  {id:'giving',      name:'Giving',              initial:0, track:false, pct:'5%'},
  // reinstated in v47.75 as a permanent default (was folded into Core in v47.31)
  {id:'reserve',     name:'Reserve',             initial:0, track:false, pct:'5%'},
  // crisisOnly: hidden in normal mode, appears only when crisis/alternative mode is active
  {id:'crisis_fund', name:'Merged Reserve',      initial:0, track:false, crisisOnly:true},
  // pct is a neutral internal marker for track wallets, never displayed as-is —
  // getWalletPctLabel (app.ui.js) always intercepts w.track BEFORE it would
  // fall back to reading this field, translating via t({ar:'تتبع', en:'Track'})
  // instead. Kept as a plain non-language-specific string (not the Arabic
  // literal it used to be) so a future display path that bypasses
  // getWalletPctLabel can't leak untranslated Arabic in English mode.
  {id:'uber',        name:'Uber',                initial:0, track:true,  pct:'track'},
  {id:'cards',       name:'Bank Cards',          initial:0, track:true,  pct:'track'},
  {id:'cash',        name:'Cash',                initial:0, track:true,  pct:'track'},
];

// Tombstones for delete propagation in multi-device merge sync: {txId: deletedAtMs}.
// Without these, a union merge would resurrect a transaction deleted on another
// device. Tx/sub tombstones are pruned to bound the sets — see TOMBSTONE_TTL_MS.
// Declared here (not with the rest of the mutable state below) because
// applyWalletDefs() consults deletedWalletDefIds and already runs at parse time
// via the _loadCustomWalletDefsSync IIFE just after it — a later `let` would TDZ-throw.
let deletedTxIds = {};
// Same role for subscriptions and wallet definitions — mergeCloudData unions
// both by id, so without tombstones a subscription/wallet deleted on device A
// reappears from device B's copy on the very next sync, forever ping-ponging.
let deletedSubIds = {};
let deletedWalletDefIds = {};
// 400 days (~13 months), not 90 — a device that stays disconnected from Drive
// sync for longer than the TTL (dead token, offline, Drive never set up on
// this device) while still being used locally could otherwise have its OWN
// still-relevant tombstone pruned away before it ever propagates; the next
// time that device DOES sync with a copy that never saw the deletion, the
// "deleted" item silently resurrects with no error and no way to detect it
// happened. Tombstone entries are tiny ({id: timestamp}), so bounding them to
// over a year instead of 90 days doesn't meaningfully change the quota-growth
// concern this TTL exists for, while substantially shrinking the real-world
// window where this can occur.
const TOMBSTONE_TTL_MS = 400 * 24 * 60 * 60 * 1000;
function pruneTombstones(){
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  for(const id in deletedTxIds){ if(!(deletedTxIds[id] > cutoff)) delete deletedTxIds[id]; }
  for(const id in deletedSubIds){ if(!(deletedSubIds[id] > cutoff)) delete deletedSubIds[id]; }
  // deletedWalletDefIds is deliberately NOT pruned: it's bounded by wallet count
  // (tiny), custom wallet ids are never reused (generated w_<ts>_<rand>), and the
  // default-wallet ids ('reserve'/'crisis_fund') rely on a PERMANENT tombstone to
  // record "the user deleted this default" — applyWalletDefs() would otherwise
  // resurrect them the moment TOMBSTONE_TTL_MS dropped the record.
}
// Union a {id: deletedAtMs} tombstone map from an external snapshot (cloud/IDB/
// import) into a local one — newest stamp wins, non-numeric entries dropped.
function _unionTombstoneMap(local, incoming){
  if(!incoming || typeof incoming !== 'object') return local;
  const _now = Date.now();
  for(const id in incoming){
    let t = incoming[id];
    if(typeof t !== 'number' || !isFinite(t)) continue;
    // A tombstone stamp reflects WHICHEVER device deleted it, using its own
    // clock, with no cross-device validation. A device whose clock was badly
    // wrong at the moment of deletion (dead CMOS battery, a manual clock
    // change — both real occurrences) stamps an implausible value; if it's
    // far enough in the past, pruneTombstones() on the FIRST device that ever
    // receives it treats it as "already expired" and deletes the tombstone
    // immediately, resurrecting the deletion on the very next merge instead of
    // honoring it. Clamping to [MIN_TX_TS, now] — the same bound transaction
    // timestamps already get — gives an implausible stamp the same fresh TTL
    // window a normal one gets, on the receiving device's own (presumably
    // correct) clock.
    if(t < MIN_TX_TS || t > _now) t = _now;
    if(!local[id] || t > local[id]) local[id] = t;
  }
  return local;
}
// Validates/cleans a candidate wallet-defs array (from localStorage, IndexedDB,
// an imported backup, or a Drive snapshot) before it's allowed to replace the
// live WALLET_DEFS. Returns a fresh array of plain {id,name,initial,track,pct}
// objects, or null if the input is unusable (caller should keep what it has).
// The rest of the `sanitize*` family (same job — validate one piece of
// possibly-corrupt/untrusted incoming data before it touches live state) lives
// wherever the data it cleans is otherwise handled: sanitizeDistribution/
// sanitizeBudgets in app.data.js (import/data-management), sanitizeOrder/
// sanitizeTrackLinkMode in app.layout.js (layout/tab-order prefs).
function sanitizeWalletDefs(arr){
  if(!Array.isArray(arr) || !arr.length) return null;
  const seen = new Set();
  const out = [];
  arr.forEach(w => {
    if(!w || typeof w !== 'object') return;
    const id = typeof w.id === 'string' ? w.id.trim() : '';
    // Strip bidi-control/zero-width chars same as escHtml — a wallet name
    // bypasses escHtml's protection wherever it's rendered via textContent
    // (which doesn't need HTML-escaping but is still vulnerable to display
    // corruption from a name like "Cash‮hsac").
    // [...str].slice() counts Unicode code points, not UTF-16 code units — avoids
    // stranding a lone surrogate when the 40th position falls inside an emoji pair.
    const name = typeof w.name === 'string' ? [...stripBidiControls(w.name).trim()].slice(0,40).join('') : '';
    // '__proto__'/'constructor'/'prototype' match the id regex but wallet ids are
    // used as bracket-notation object keys all over (state.wallets[id], budgets[id],
    // trackLinkMode[id]) — every current write is a primitive so nothing is
    // exploitable today, but a future `someMap[id] = {...}` would become real
    // prototype pollution. Cheap to foreclose at the gate.
    if(!id || !/^[a-zA-Z0-9_\-]+$/.test(id) || id === '__proto__' || id === 'constructor' || id === 'prototype' || !name || seen.has(id)) return;
    seen.add(id);
    // pct is a neutral internal marker for track wallets (see WALLET_DEFS above) —
    // never displayed as-is, so no Arabic literal here either.
    out.push({id, name, initial:0, track: !!w.track, pct: typeof w.pct === 'string' ? w.pct : (w.track ? 'track' : '0%'), ...(w.crisisOnly ? {crisisOnly:true} : {})});
  });
  // Every screen that lets the user pick a spendable wallet (add form, transfers)
  // assumes at least one non-track wallet exists — a corrupt/edited blob with only
  // track wallets would otherwise brick those screens.
  if(!out.length || !out.some(w => !w.track)) return null;
  return out;
}
// Mutates WALLET_DEFS IN PLACE (clear + refill) so every other module's direct
// references to the same array — there are dozens across app.core/logic/ui.js —
// pick up the change without needing to be updated individually.
function applyWalletDefs(clean){
  WALLET_DEFS.length = 0;
  clean.forEach(w => WALLET_DEFS.push(w));
  // crisis_fund may be absent from wallet defs saved before v47.31 — always
  // ensure it exists, inserted before track wallets to preserve display order.
  // UNLESS the user deliberately deleted it (tombstoned): re-inserting here made
  // deleteWalletDef() silently self-defeating — the very call it used to remove
  // the wallet (applyWalletDefs(filtered)) re-added it before returning, while
  // the UI showed a "deleted" success toast.
  const cfIdx = WALLET_DEFS.findIndex(w => w.id === 'crisis_fund');
  if(cfIdx === -1 && !deletedWalletDefIds['crisis_fund']){
    const firstTrack = WALLET_DEFS.findIndex(w => w.track);
    const pos = firstTrack === -1 ? WALLET_DEFS.length : firstTrack;
    WALLET_DEFS.splice(pos, 0, {id:'crisis_fund', name:'Merged Reserve', initial:0, track:false, crisisOnly:true, pct:'0%'});
  } else if(cfIdx !== -1 && !WALLET_DEFS[cfIdx].crisisOnly){
    WALLET_DEFS[cfIdx] = {...WALLET_DEFS[cfIdx], crisisOnly: true};
  }
  // "Reserve" was a default wallet, got folded into Core Expenses in v47.31, then
  // reinstated as a permanent default in v47.75 — always ensure it exists (same
  // pattern + same tombstone escape-hatch as crisis_fund above) so an account
  // created in that window gets it back too, not just fresh installs.
  // _ensureReserveShare() (below) handles giving it back its 5% distribution share.
  if(WALLET_DEFS.findIndex(w => w.id === 'reserve') === -1 && !deletedWalletDefIds['reserve']){
    const givingIdx = WALLET_DEFS.findIndex(w => w.id === 'giving');
    const pos = givingIdx === -1 ? Math.max(0, cfIdx === -1 ? WALLET_DEFS.length : cfIdx) : givingIdx + 1;
    WALLET_DEFS.splice(pos, 0, {id:'reserve', name:'Reserve', initial:0, track:false, pct:'5%'});
  }
  recomputeSelectableWallets();
}
// Companion to the reserve-wallet guarantee in applyWalletDefs() above: if the
// wallet exists but DISTRIBUTION has no matching share (a pre-v47.31 account
// whose Reserve wallet was left at an orphaned 0%, or a wallet just re-added by
// applyWalletDefs()), give it the 5% back. Takes it out of Core if Core still
// sits at the old v47.31 merged 55% so the total lands on exactly 100% instead
// of silently going over; otherwise (Core was customized) just adds the 5% —
// openDistributionModal()/settings already handle a >100% total gracefully.
function _ensureReserveShare(){
  if(!WALLET_DEFS.find(w => w.id === 'reserve' && !w.track)) return;
  const existing = DISTRIBUTION.find(d => d.id === 'reserve');
  const core = DISTRIBUTION.find(d => d.id === 'core');
  if(existing){
    // A reserve entry at 0% while Core still sits at the old v47.31 merged 55%
    // is the exact orphaned-account signature (reserve's 5% was folded into
    // Core back then; the entry itself survived at 0). A user who deliberately
    // zeroed reserve AFTER v47.75 has core at 50 (or their own number), never
    // this pair — so repairing only this combination can't clobber a choice.
    if(existing.pct === 0 && core && core.pct === 55){ existing.pct = 5; core.pct = 50; }
    return;
  }
  DISTRIBUTION = DISTRIBUTION.concat([{id:'reserve', pct:5}]);
  if(core && core.pct === 55) core.pct = 50;
}
// Set when localStorage's walletDefs key exists but is corrupted/unusable —
// loadState()'s IndexedDB-recovery check below only looked at "key absent",
// so a present-but-corrupt blob used to silently skip recovery too (worse
// than a missing key) and fall back to default wallets with zero warning.
// (The synchronous custom-wallet-defs loader IIFE that sets this lives further
// DOWN, after the state/SELECTABLE_WALLETS/selectedWallet declarations it
// transitively depends on — see the comment there for the TDZ bug that forced
// the move.)
let _walletDefsLoadFailed = false;

// In crisis/alternative mode the budget wallets (wishlist, growth, joy, giving, …)
// are hidden and replaced by the single crisis_fund wallet.
// crisisOnly wallets are intentionally excluded from this list — they are NOT hidden
// in crisis mode (they become visible precisely when crisis mode is on).
function crisisWalletIds(){
  return WALLET_DEFS.filter(w => !w.track && w.id !== 'core' && !w.crisisOnly).map(w => w.id);
}
// A crisisOnly wallet (crisis_fund) is a MERGED view while crisis mode is on — its
// displayed/usable balance is its own stored value plus every hidden budget
// wallet's balance folded in (see crisisWalletIds' own comment). Outside crisis
// mode, or for any non-crisisOnly wallet, it's just the plain stored balance.
// Shared by every place that needs "how much can actually be spent/shown from
// this wallet right now" — wallet cards, the wallet picker, transfer validation.
function effectiveWalletBalance(w){
  return (w.crisisOnly && state.crisisMode)
    ? crisisWalletIds().reduce((s, id) => s + (state.wallets[id] ?? 0), 0) + (state.wallets[w.id] ?? 0)
    : (state.wallets[w.id] ?? 0);
}

// `name` stays the canonical Arabic string (also used as the stable fallback
// when 'en' isn't applicable); `nameEn` is resolved through t() at lookup
// time by getCategory()/the[_makeCatChip] grid renderer, not baked in here.
const CATEGORIES = [
  {id:'food',          types:['expense'],          name:'طعام وشراب',   nameEn:'Food & drinks',  icon:'🍽️', color:'#e3a07a'},
  {id:'transport',     types:['expense'],          name:'مواصلات',      nameEn:'Transport',      icon:'🚗', color:'#86adcf'},
  {id:'shopping',      types:['expense'],          name:'تسوق',         nameEn:'Shopping',       icon:'🛍️', color:'#dcb674'},
  {id:'bills',         types:['expense'],          name:'فواتير',       nameEn:'Bills',          icon:'🧾', color:'#a78bd6'},
  {id:'health',        types:['expense'],          name:'صحة',          nameEn:'Health',         icon:'💊', color:'#86c39a'},
  {id:'entertainment', types:['expense'],          name:'ترفيه',        nameEn:'Entertainment',  icon:'🎮', color:'#e3918f'},
  {id:'salary',        types:['income'],           name:'راتب/دخل',     nameEn:'Salary/income',  icon:'💼', color:'#7fcf9f'},
  {id:'transfer',      types:['expense','income'], name:'تحويل',        nameEn:'Transfer',       icon:'🔁', color:'#9aa0ad'},
  {id:'other',         types:['expense','income'], name:'أخرى',         nameEn:'Other',          icon:'✨', color:'#8d94a3'},
];
const QUICK_AMOUNTS = [250, 500, 1000, 2000, 5000, 10000];
// `let` + explicit recompute (not a one-time const filter) because WALLET_DEFS
// can grow/shrink at runtime once wallets become user-editable, and crisis mode
// changes which wallets are visible so the add-form dropdown must match.
// PRIMARY selectable wallets are budget wallets only — tracking wallets
// (Uber/Cards/Cash) are NOT primary targets; they're assigned via the SEPARATE
// "track wallet" control (the add-form link, and the per-line track dropdown in
// quick-notes), consistently. This keeps one clear model everywhere: a primary
// (budget) wallet + an optional tracking wallet.
let SELECTABLE_WALLETS = WALLET_DEFS.filter(w => !w.track && !w.crisisOnly);
function recomputeSelectableWallets(){
  if(state.crisisMode){
    const crisisIds = new Set(crisisWalletIds());
    // crisis mode: show core + crisisOnly wallets (crisis_fund), hide normal budget wallets
    SELECTABLE_WALLETS = WALLET_DEFS.filter(w => !w.track && !crisisIds.has(w.id));
  } else {
    // normal mode: hide crisisOnly wallets (they only make sense in crisis context)
    SELECTABLE_WALLETS = WALLET_DEFS.filter(w => !w.track && !w.crisisOnly);
  }
  // If the currently selected wallet is no longer available, fall back to the first one
  if(SELECTABLE_WALLETS.length && !SELECTABLE_WALLETS.find(w => w.id === selectedWallet)){
    selectedWallet = SELECTABLE_WALLETS[0].id;
  }
}
function toggleCrisis(){
  state.crisisMode = !state.crisisMode;
  if(walletFilter){
    const _wf = WALLET_DEFS.find(x => x.id === walletFilter);
    const _hidden = state.crisisMode
      ? crisisWalletIds().includes(walletFilter)
      : (_wf && _wf.crisisOnly);
    if(_hidden) walletFilter = null;
  }
  const _ct = document.getElementById('crisisToggle');
  if(_ct) _ct.setAttribute('aria-checked', state.crisisMode ? 'true' : 'false'); // may be hidden via layout editor
  // Rebuild the wallet dropdown so it only shows wallets visible in the current mode
  recomputeSelectableWallets();
  // crisis flips the spendable total by the reserve amount — that's not a real
  // money movement, so snap to the new value instead of count-up animating across it
  prevSpendable = null;
  saveConfig();
  render();
  haptic(15);
  toast(state.crisisMode ? t({ar:'🔄 تم تفعيل الوضع البديل', en:'🔄 Crisis mode enabled'}) : t({ar:'✓ تم إيقاف الوضع البديل', en:'✓ Crisis mode disabled'}));
}
function isTrackWallet(id){ const w = WALLET_DEFS.find(x => x.id === id); return !!(w && w.track); }
// The tracking wallets (for the secondary "track" control). Order matches WALLET_DEFS.
function trackWalletDefs(){ return WALLET_DEFS.filter(w => w.track); }

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
// Cache-invalidation registry: most memo caches (_filteredTxSig, _analyticsSig,
// _heroStatsSig, _pieChartSig, _recurringCacheSig, _firstTxStamp) are
// self-invalidating — their signature embeds _txMutationStamp above, so a
// stale read is impossible without any explicit clear anywhere (see the
// comment in render(), app.main.js). A couple of caches have no signature to
// compare against and instead need an explicit clear at the right moment;
// those moments used to be hand-listed inline at every call site — miss one
// when a NEW such cache is added and it silently goes stale. The two lists
// below give each trigger ONE place a cache registers into instead:
//   invalidateOnTxCommit — fires whenever the transactions array is
//   committed/replaced: saveTx() for routine saves, loadState()/
//   mergeCloudData() for bulk boot/sync replacement.
//   invalidateOnRender — fires whenever a real render() pass proceeds (not
//   skipped by its own signature check) — for caches keyed coarser than a
//   full signature (e.g. by calendar day/month) that only need to catch up
//   whenever something is about to be drawn anyway.
let _txCommitInvalidators = [];
let _renderInvalidators = [];
function invalidateOnTxCommit(fn){ _txCommitInvalidators.push(fn); }
function invalidateOnRender(fn){ _renderInvalidators.push(fn); }
function _runTxCommitInvalidators(){ _txCommitInvalidators.forEach(fn => fn()); }
function _runRenderInvalidators(){ _renderInvalidators.forEach(fn => fn()); }
// >0 while a multi-step async mutation is running (add/delete/distribute). The
// cross-tab storage listener checks this so another tab's save can't trigger a
// loadState() that resets `state` mid-mutation and corrupts balances.
let _opInFlight = 0;
// Shared guard for every money-writing entry point: refuse to start while
// another mutation is mid-flight across an await. Was copy-pasted verbatim at
// 11+ call sites; centralized here so a future wording/behavior change only
// needs one edit.
function _opBusy(){
  if(_opInFlight > 0){
    toast(t({ar:'⏳ هناك عملية قيد التنفيذ — أعد المحاولة بعد لحظة', en:'⏳ Another operation is in progress — try again in a moment'}), true);
    return true;
  }
  return false;
}
let currentFilter = 'all';
let walletFilter = null;
let categoryFilter = null;
let selectedWallet = WALLET_DEFS[0].id;
// Optional secondary tracked-wallet a new transaction also updates (e.g. pay Uber
// from Core, and also move the linked tracked "Uber" wallet automatically). null =
// none. See applyTxToBalance + addTx + trackLinkMode.
let selectedTrackWallet = null;

// Custom wallets (added via Settings → إدارة المحافظ) are loaded synchronously
// here — at parse time, before any other module runs — so the very first render
// already reflects them. MUST stay BELOW the state/SELECTABLE_WALLETS/
// selectedWallet declarations: applyWalletDefs() ends in
// recomputeSelectableWallets(), which reads all three, and calling it above
// them (where this loader originally lived) hit their temporal dead zone —
// every saved-defs boot threw, was caught as "corrupt", and got silently
// re-served from IndexedDB by loadState()'s recovery, which could apply a
// STALE snapshot (e.g. resurrecting a just-deleted wallet).
// IndexedDB-side recovery (in case localStorage was wiped) still happens later
// in loadState(), same pattern as the Drive client id / subscriptions recovery.
(function _loadCustomWalletDefsSync(){
  // Seed the wallet-def tombstones from the config blob FIRST — applyWalletDefs()
  // consults deletedWalletDefIds to decide whether to re-insert the default
  // 'reserve'/'crisis_fund' wallets, and loadState() (which normally loads the
  // tombstones) only runs later, asynchronously. Without this seed, a default
  // wallet the user deleted would resurrect at every boot before loadState ran.
  try{
    const cfg = JSON.parse(localStorage.getItem(LS_PREFIX + 'config') || 'null');
    if(cfg && cfg.deletedWalletDefIds && typeof cfg.deletedWalletDefIds === 'object'){
      _unionTombstoneMap(deletedWalletDefIds, cfg.deletedWalletDefIds);
    }
  }catch(e){}
  // Some locked-down browsers (e.g. old Safari private mode) throw on EVERY
  // localStorage call, not just setItem — loadState() already wraps its own
  // reads for exactly that reason (see its comment), but this bare read was
  // missed. Uncaught here, it aborts this IIFE and every function declared
  // after it in this file (nearly the whole file) — every later script then
  // throws ReferenceErrors calling them, a total app crash on script load
  // with no data actually at risk (never even reached).
  let raw;
  try{ raw = localStorage.getItem(LS_PREFIX + 'walletDefs'); }catch(e){ return; }
  if(!raw) return;
  try{
    const clean = sanitizeWalletDefs(JSON.parse(raw));
    if(clean) applyWalletDefs(clean);
    else _walletDefsLoadFailed = true;
  }catch(e){ _walletDefsLoadFailed = true; }
})();
let editingTxId = null;
let editType = 'expense';
let editWallet = WALLET_DEFS[0].id;
// null | 'transfer' | 'distSource' | 'distLeg' | 'trackAdjustment' — see
// openEdit's comment for what each means. 'transfer' and 'distLeg' lock
// type/category; 'distSource' and 'distLeg' lock amount; 'trackAdjustment'
// locks type/category (recategorizing away from 'adjustment' while the
// wallet stays a track wallet is dangerous — isSystemCategory-gated
// analytics/budget totals would silently start counting a track-only entry,
// with no self-heal path since reconcileBalances/repairBalancesFromLedger
// both skip track wallets).
let _editLockReason = null;
function _editCategoryLocked(){ return _editLockReason === 'transfer' || _editLockReason === 'distLeg' || _editLockReason === 'trackAdjustment'; }
function _editAmountLocked(){ return _editLockReason === 'distSource' || _editLockReason === 'distLeg'; }
let searchQuery = '';
let prevSpendable = null;
let selectedCategory = 'other';
let editCategory = 'other';
let addFormType = 'expense';
let detailWalletId = null; // when set, shows wallet detail view
let pendingIncomeTx = null;
let autoDistribute = false;
let budgets = {}; // walletId -> monthly budget limit (expenses)
// Per-tracked-wallet direction for the optional transaction link (above): 'debit'
// (a real balance — an expense DECREASES it, income increases it) or 'credit' (a
// spending counter — an expense INCREASES it). Persisted via uiPrefs. The resolved
// direction is also stamped onto each linked tx (trackSign) so later config changes
// never retroactively flip the effect of past entries.
let trackLinkMode = {}; // walletId -> 'debit' | 'credit'
let dismissedRecurring = new Set();
// (Tombstone maps — deletedTxIds/deletedSubIds/deletedWalletDefIds — are declared
// further UP, before sanitizeWalletDefs/applyWalletDefs, because applyWalletDefs
// consults deletedWalletDefIds and is already called at parse time by the
// _loadCustomWalletDefsSync IIFE.)
// The single "is this transaction well-formed" rule — used at every boundary
// that ingests transactions from outside the app's own write paths (initial
// load, cloud merge, import, cloud snapshot adoption). Was once re-implemented
// per boundary with subtle drift (import required a string id, load/merge only
// a truthy one); centralized so a future rule change (e.g. adjusting the
// MAX_AMOUNT ceiling) can't be applied to only one entry point. Every id the
// app has ever generated is a 'tx_...' string, so the string requirement is safe.
function isValidTx(t){
  return !!(t && typeof t.id === 'string' && t.id && (t.type === 'income' || t.type === 'expense') &&
    typeof t.ts === 'number' && isFinite(t.ts) && t.ts > 0 &&
    typeof t.amount === 'number' && isFinite(t.amount) && t.amount > 0 && t.amount <= MAX_AMOUNT &&
    WALLET_DEFS.find(w => w.id === t.wallet));
}
// Wires a custom-select-style control (role="button", not a native <button>)
// for both click and Enter/Space keydown activation, while suppressing the
// click ECHO that follows our own keydown: activating a non-native control via
// keydown still lets the browser's default action fire a synthesized detail-0
// click right after, which would otherwise double-invoke fn. A bare detail-0
// click with NO recent keydown on this exact element is genuine assistive-tech
// activation (TalkBack/VoiceOver also report detail 0 on their synthesized
// clicks) and must still go through — only suppress within a 1s window of an
// actual keydown here. Copy-pasted 3x (app.main.js's `_bindEvents`, the
// wallet-grid pct button, the quick-notes wallet picker) before being
// centralized; fn receives the triggering event so a caller needing
// e.stopPropagation() (a nested control inside another clickable element)
// still can.
function bindKbdSelect(el, fn){
  if(!el) return;
  el.addEventListener('click', e => { if(!e.detail && el._kbdEchoAt && Date.now() - el._kbdEchoAt < 1000) return; fn(e); });
  el.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){ el._kbdEchoAt = Date.now(); e.preventDefault(); fn(e); } });
}
// Shared roving-tabindex arrow-key navigation for a listbox of .opt elements —
// ArrowUp/ArrowDown moves focus within the list (wrapping), Home/End jumps to
// the first/last option, matching the standard aria listbox keyboard pattern.
// Delegated on the container (bound once via a marker flag) so re-rendering
// the option list on every selection change doesn't need to re-wire anything.
// Previously only the shared wallet popup (openWalletPop, app.quicknotes.js)
// had this; the three legacy in-form dropdowns (add-form primary wallet, edit
// modal, transfer from/to — all in app.ui.js) supported only Tab/Enter/Space,
// each option individually focusable (tabIndex=0) rather than roving.
// Callers must set exactly one option's tabIndex to 0 (the rest -1) after
// rendering — this only handles the arrow/Home/End key response, not the
// initial roving-tabindex setup.
function wireOptionArrowNav(container){
  if(!container || container._arrowNavWired) return;
  container._arrowNavWired = true;
  container.addEventListener('keydown', (e) => {
    if(e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const opts = [...container.querySelectorAll('.opt')];
    const idx = opts.indexOf(document.activeElement);
    if(idx === -1) return; // focus isn't on an option — let the key do whatever it normally does
    e.preventDefault();
    let next;
    if(e.key === 'ArrowDown') next = opts[(idx + 1) % opts.length];
    else if(e.key === 'ArrowUp') next = opts[(idx - 1 + opts.length) % opts.length];
    else if(e.key === 'Home') next = opts[0];
    else next = opts[opts.length - 1];
    if(next){ opts.forEach(o => { o.tabIndex = -1; }); next.tabIndex = 0; try{ next.focus({preventScroll:true}); }catch(_){} }
  });
}
// Every settings-area tab strip (#settTabs, #themeModeTabs, #langTabs, and the
// layout editor's own .le-tabs) already carries role="tablist"/"tab" — but
// none had the ARIA "tabs" pattern's expected Left/Right-arrow-key navigation,
// only generic Tab-through. Left/Right MOVES focus AND activates the newly-
// focused tab (automatic activation, the standard tabs-pattern behavior —
// unlike wireOptionArrowNav above, which is manual-activation for a listbox).
// RTL-aware, since every one of these strips renders under the app's default
// RTL (Arabic) direction. Idempotent per container instance (same guard
// pattern as wireOptionArrowNav) — harmless to call again on a container
// that's rebuilt fresh via innerHTML on every render (a new node each time
// simply gets wired again, since the old node's listener went with it).
function wireTabArrowNav(container){
  if(!container || container._tabArrowNavWired) return;
  container._tabArrowNavWired = true;
  container.addEventListener('keydown', (e) => {
    if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    const idx = tabs.indexOf(document.activeElement);
    if(idx === -1) return;
    e.preventDefault();
    const rtl = getComputedStyle(container).direction === 'rtl';
    let next;
    if(e.key === 'Home') next = tabs[0];
    else if(e.key === 'End') next = tabs[tabs.length - 1];
    else {
      const forward = (e.key === 'ArrowRight') !== rtl; // ArrowRight moves forward in LTR, backward in RTL
      next = forward ? tabs[(idx + 1) % tabs.length] : tabs[(idx - 1 + tabs.length) % tabs.length];
    }
    if(next){ try{ next.focus({preventScroll:true}); }catch(_){} next.click(); }
  });
}
// A "system" category is one that isn't real spending/income — inter-wallet
// transfers and manual balance adjustments both move money without it having
// actually been earned or spent, so every income/expense summary (analytics,
// pie chart, daily/monthly review, repeatLastTx's "last real transaction"
// lookup) excludes them. Was inlined ~10x across 5 files as a copy-pasted
// two-clause check; centralized so a future 3rd system category isn't a
// shotgun edit where a missed site quietly produces a wrong total in one screen.
function isSystemCategory(tx){
  return !!tx && (tx.category === 'transfer' || tx.category === 'adjustment');
}
// Restore wallet balances from a persisted snapshot ({walletId: number}) —
// used identically for the localStorage copy, the wallet-defs IDB-recovery
// path, and the primary IDB snapshot; coerces to a finite number so a
// tampered/corrupt source can't poison balances with NaN/Infinity.
function _restoreWalletBalances(source){
  if(!source) return;
  WALLET_DEFS.forEach(w => {
    if(source[w.id] !== undefined){
      const v = parseFloat(source[w.id]);
      // same MAX_AMOUNT ceiling _ingestWalletBalances enforces — without it a
      // corrupt/tampered localStorage or IndexedDB value survives the isFinite
      // check here, then can overflow to Infinity in later sums (which
      // JSON.stringify serializes as null and silently drops the balance on
      // the next load with no toast and no tombstone).
      if(isFinite(v) && Math.abs(v) <= MAX_AMOUNT) state.wallets[w.id] = round2(v);
    }
  });
}

/* Navigation + subscriptions state */
let currentTab = 'home';
let addDrawerOpen = false;
let drawerTab = 0;
let subscriptions = []; // [{id, name, amount, billingDay, active}]
let editingSubId = null;

/* User-editable wallet definitions (add/rename/reorder) */
let editingWalletDefId = null; // null = "add new" mode in #walletDefModal
let _walletDefModalTrack = false; // pending track/regular choice while the modal is open

/* Customizable layout (tab + section order) */
let _layoutEditorTab = 'tab'; // which sub-tab is active in the layout editor
const TAB_DEFS = {
  home:         {icon:'🏠', label:'الرئيسي',   panel:'tabHome'},
  transactions: {icon:'🧾', label:'المعاملات', panel:'tabTransactions'},
  analytics:    {icon:'📊', label:'تحليلات',   panel:'tabAnalytics'},
  reports:      {icon:'📋', label:'التقارير',  panel:'tabReports'}
};
const DEFAULT_TAB_ORDER = ['home','transactions','analytics','reports'];
// `label` is either an I18N_STRINGS key or an inline {ar,en} t() literal —
// resolved lazily via t() at render time (renderLayoutEditor) so it always
// reflects the current language instead of freezing at script-load time.
const SECTION_DEFS = {
  home: [
    {key:'balance',    label:{ar:'💰 إجمالي المتاح', en:'💰 Total available'}},
    {key:'crisis',     label:{ar:'🔄 الوضع البديل', en:'🔄 Alternate mode'}},
    {key:'quicknotes', label:{ar:'📝 ملاحظات سريعة', en:'📝 Quick notes'}},
    {key:'wallets',    label:{ar:'👛 المحافظ', en:'👛 Wallets'}}
  ],
  analytics: [
    {key:'stats',         label:'sec.monthStats'},
    {key:'recurring',     label:{ar:'🔔 تنبيهات متكررة', en:'🔔 Recurring alerts'}},
    {key:'export',        label:{ar:'📄 تصدير التقرير', en:'📄 Export report'}},
    {key:'subscriptions', label:{ar:'📆 الاشتراكات', en:'📆 Subscriptions'}},
    {key:'chart',         label:{ar:'🥧 التوزيع حسب الفئة', en:'🥧 Breakdown by category'}}
  ],
  reports: [
    {key:'summary', label:{ar:'🧮 ملخص الدخل/المصروف', en:'🧮 Income/expense summary'}},
    {key:'chart',   label:{ar:'📈 حركة الرصيد', en:'📈 Balance flow'}},
    {key:'list',    label:{ar:'🧾 قائمة المعاملات', en:'🧾 Transactions list'}}
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
/**
 * Round a money value to 2 decimals, correcting binary-float misrounding.
 * @param {number} n
 * @returns {number}
 */
function round2(n){
  // Plain Math.round(n*100)/100 misrounds values like 1.005 → 1 (should be
  // 1.01) because 1.005*100 is actually 100.49999... in binary float. A FLAT
  // Number.EPSILON nudge (the previous fix here) only corrects that at small
  // magnitudes — added before scaling by 100, it's proportionally too tiny to
  // survive once n has 6+ significant digits (round2(1234567.005) still came
  // out 1234567, same wrong answer as no fix at all). Multiplying the nudge
  // INTO the scaled value instead (relative, not additive) keeps it
  // proportionally significant at any realistic money magnitude. Rounding the
  // absolute value first (then reapplying the sign) also makes this symmetric
  // — the old additive nudge only ever pushed the scaled value in the
  // positive direction, so -1.005 rounded to -1 while +1.005 correctly rounded
  // to 1.01; money rounding should not depend on sign.
  const sign = n < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(n) * 100 * (1 + Number.EPSILON)) / 100;
}
/**
 * Format a number as a 2-decimal display string with thousands separators.
 * @param {number} n
 * @returns {string}
 */
function fmt(n){
  if(isNaN(n) || !isFinite(n)) return '0.00';
  // collapse -0 and sub-cent negatives so they never render as "-0.00"
  if(Object.is(n, -0) || (n < 0 && n > -0.005)) n = 0;
  return Number(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
}

// Build a grammatically-correct "<count> <noun>" Arabic phrase. Arabic number
// agreement: 1 → singular ("معاملة واحدة"), 2 → dual ("معاملتان"), 3-10 → plural
// ("3 معاملات"), 11+ → singular form again ("11 معاملة"). Naively concatenating
// `${count} ${singular}` is only ever correct for the 11+ case, so every count+noun
// spot in the UI needs this instead of raw template-literal interpolation.
// `singular` must stay a bare noun/short phrase — it's reused as-is in the 11+
// branch below ("15 معاملة"). Appending واحدة to it for the n===1 case only
// works when `singular` is noun-first ("معاملة" -> "معاملة واحدة"); phrases that
// lead with an adjective ("متبقية") or a verb ("ستبقى مخفية") need واحدة placed
// differently, or have no noun to attach to at all — pass the fully-formed
// phrase via `singularOne` for those instead of relying on the default.
/**
 * Build a grammatically-correct Arabic "<count> <noun>" phrase.
 * @param {number} count
 * @param {string} singular  bare noun, reused as-is for the 11+ form
 * @param {string} dual
 * @param {string} plural
 * @param {string} [singularOne]  fully-formed phrase for the count===1 case
 * @returns {string}
 */
function arPlural(count, singular, dual, plural, singularOne){
  const n = Math.abs(Number(count) || 0);
  if(n === 1) return singularOne || `${singular} واحدة`;
  if(n === 2) return dual;
  if(n >= 3 && n <= 10) return `${n} ${plural}`;
  return `${n} ${singular}`;
}

// Normalize Arabic-Indic (٠-٩) and Persian (۰-۹) digits + Arabic decimal/thousands
// separators to ASCII so amount fields accept numbers typed on Arabic keyboards.
function normalizeDigits(str){
  return String(str == null ? '' : str)
    .replace(/−/g, '-')  // Unicode minus → ASCII hyphen-minus
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)) // Arabic-Indic digits
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0)) // Extended (Persian) digits
    .replace(/[٫]/g, '.')   // Arabic decimal separator
    // A comma followed by exactly 1–2 digits at the end of the string is almost
    // certainly a decimal separator (European convention: "1,5" = 1.5, "9,99" = 9.99).
    // A comma before 3+ digits is a thousands separator ("1,500") — left for the
    // next replace to strip. This prevents "1,5" from silently becoming 15.
    .replace(/,(\d{1,2})$/, '.$1')
    .replace(/[٬,\s]/g, '');  // Arabic + Latin thousands separators + spaces ("1 000")
}
// Parse a user-entered money string robustly (Arabic numerals, separators).
// Rejects parseFloat quirks that silently create absurd balances: scientific/
// hex notation ("1e9", "0x10") and values beyond a sane money ceiling. Returns
// NaN on any rejection so every caller's existing isFinite/isNaN guard catches it.
const MAX_AMOUNT = 1e12; // one trillion — well above any realistic single entry
// Shared cap for truncateCodePoints(desc, ...) at every entry point that writes a
// transaction description (addTx, saveEdit, applyImport, adoptCloudSnapshot,
// mergeCloudData, Quick Notes) — these must all agree or a description could grow
// past the intended limit through one path while staying capped on another.
const MAX_DESC_LEN = 120;
// Base "how long does the user have to tap Undo/see the toast" durations (app.main.js's
// toastWithAction, deleteTx's undo timer in app.logic.js). Each site layers its own
// extra logic on top of this base (e.g. deleteTx extends past a live critical toast) —
// only the base number is shared here, not that surrounding logic.
const UNDO_WINDOW_MS = 5000;
const CRITICAL_TOAST_MS = 7000;
// Shared poll cadence for the two independent "wait for a blocker to clear, give up
// after N tries" banner-reveal loops (app.pwa.js's _revealUpdateBanner, app.drive.js's
// showDriveBanner). Their attempt counts are deliberately different (15 vs 40, giving
// each banner its own distinct give-up cap so they don't collide) — only this interval
// itself is the same value on purpose. See each call site's own comment for why the
// caps must stay different.
const BANNER_POLL_INTERVAL_MS = 400;
/**
 * Parse a user-entered money string, rejecting junk (scientific/hex notation,
 * out-of-range values) by returning NaN.
 * @param {string} str
 * @returns {number} the parsed value, or NaN on any rejection
 */
function parseAmount(str){
  const norm = normalizeDigits(str);
  if(/[a-zA-Z]/.test(norm)) return NaN; // block 1e9 / 0x10 / Infinity / NaN-style strings
  // Arabic letters (currency words like "ريال"/"ر.س", unit text, etc.) — by this
  // point normalizeDigits() has already converted every Arabic-Indic/Persian
  // digit and Arabic decimal/thousands separator to ASCII, so anything left
  // in this Unicode range is genuine leftover text, not a legitimate number.
  // Without this, a copy-pasted "٥٠٠ ر.س" (500 SAR) "succeeded" only by
  // accident of parseFloat stopping at the first non-digit character — but
  // the SAME text with the currency word placed BEFORE the number ("ر.س 500")
  // failed outright, an inconsistent outcome for the same intent depending on
  // token order. Worse, a string with currency text placed mid-value (e.g.
  // "500 ريال و50 هللة") silently parsed to just 500, dropping the trailing
  // ".50" with no warning at all. Rejecting consistently — same as the ASCII
  // guard above — is safer than accepting one direction by accident.
  if(/[؀-ۿݐ-ݿ]/.test(norm)) return NaN;
  if((norm.match(/\./g) || []).length > 1) return NaN; // reject "1.2.3"
  const v = parseFloat(norm);
  if(!isFinite(v) || Math.abs(v) > MAX_AMOUNT) return NaN;
  return v;
}

// Pure string transform behind liveFormatThousands()/groupThousandsDisplay()
// below: normalizes all digits to ASCII (matching fmt()'s display convention
// everywhere else in the app) and inserts "," every 3 digits in the integer
// part. "." or Arabic "٫" both mean "decimal point here" and normalize to
// "." — the digits after it are normalized but never regrouped, so an
// in-progress "1,000." isn't fought while more digits are still being typed.
const _toAsciiDigits = s => s.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
                              .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
function _groupThousands(str){
  // No legitimate amount needs more than MAX_AMOUNT's ~13 digits — this also
  // caps a pathological paste (e.g. an accidentally-copied huge number/ID)
  // before it reaches the regex work below, independent of the grouping-loop
  // fix just below (belt and suspenders: even a linear-time pass over an
  // absurdly long string is wasted work no real input would ever need).
  let raw0 = String(str == null ? '' : str);
  if(raw0.length > 32) raw0 = raw0.slice(0, 32);
  let s = _toAsciiDigits(raw0);
  // Same decimal-vs-thousands-separator disambiguation normalizeDigits() uses
  // (see its comment) for parseAmount() — applied here too so a value shown
  // live can never disagree with what parseAmount() computes from it at save
  // time. Without this, a PASTED foreign-formatted number like "1.234,56" or
  // "1 234,56" (comma = the actual decimal point in both) had its comma
  // treated as a bare thousands separator and stripped outright below,
  // silently producing a value off by ~100-1000x with no error at all — a
  // paste delivers the whole string in one 'input' event, unlike typing,
  // where this heuristic can't be reached the same way.
  s = s.replace(/,(\d{1,2})$/, '.$1');
  // If that conversion leaves MORE than one decimal-point-like character
  // (e.g. "1.234,56" → "1.234.56", where the "." was actually a thousands
  // separator), the input is genuinely ambiguous — don't guess which one is
  // "the" decimal point. Only strip grouping separators and leave every "."
  // as-is; parseAmount()'s own two-dots-is-invalid check then correctly
  // rejects it at save time instead of this function silently collapsing
  // them into one clean-looking but wrong number.
  if((s.match(/[.٫]/g) || []).length > 1){
    const _neg = s.trim().startsWith('-');
    return (_neg ? '-' : '') + s.replace(/^-/, '').replace(/[,٬\s]/g, '');
  }
  let raw = s.replace(/[,٬]/g, ''); // drop existing grouping
  const decIdx = raw.search(/[.٫]/);
  let intPart = decIdx === -1 ? raw : raw.slice(0, decIdx);
  const decPart = decIdx === -1 ? '' : '.' + raw.slice(decIdx + 1).replace(/[^\d]/g, '');
  const isNeg = intPart.startsWith('-');
  if(isNeg) intPart = intPart.slice(1);
  intPart = intPart.replace(/[^\d]/g, ''); // drop anything else that slipped through
  const grouped = _insertThousandsCommas(intPart);
  return (isNeg ? '-' : '') + grouped + decPart;
}
// A lookahead-based regex (`/\B(?=(\d{3})+(?!\d))/g`) re-scans the remaining
// string from every match position with backtracking for the `+` — quadratic
// in the digit count. Pasting a very long digit string (e.g. an accidentally
// copied huge number) into any money field froze the tab for several seconds
// on this single 'input' event before the length cap above existed. A plain
// right-to-left insertion loop is linear and produces the identical result.
function _insertThousandsCommas(intPart){
  let out = '';
  for(let i = 0; i < intPart.length; i++){
    if(i > 0 && (intPart.length - i) % 3 === 0) out += ',';
    out += intPart[i];
  }
  return out;
}
// One-shot grouping for a value being written into an input's HTML (not live
// typing) — e.g. pre-filling the Quick Notes preview row from a parsed
// amount. No cursor to preserve, so this is just _groupThousands() with a
// friendlier name at call sites.
function groupThousandsDisplay(n){
  return _groupThousands(String(n == null ? '' : n));
}
// Live thousands-separator formatting for money <input>s: as the user types,
// "1000" becomes "1,000", "1000000" becomes "1,000,000", etc. — the grouping
// regex handles any magnitude (millions/billions/trillions) with no
// special-casing. Meant to be wired via `el.addEventListener('input', () =>
// liveFormatThousands(el))`; every other 'input' listener on the same field
// keeps working unmodified because it reads the value through parseAmount(),
// which already tolerates thousands separators (normalizeDigits strips them).
//
// Arabic-Indic/Persian digits the user types are normalized to ASCII as part
// of formatting — matching fmt()'s display convention everywhere else in the
// app (money is always *shown* in ASCII digits) — so typing "١٠٠٠" also
// becomes "1,000" live.
//
// Cursor handling: naively reformatting on every keystroke jumps the caret to
// the end, which is unusable once a comma is inserted before the point the
// user is typing. Fixed by counting digits before the caret in the OLD value,
// then placing the caret after that many digits in the NEW (regrouped) value
// — comma insertions shift position but never change digit count or order.
function liveFormatThousands(el){
  const oldValue = el.value;
  const oldPos = el.selectionStart == null ? oldValue.length : el.selectionStart;
  const isDigit = ch => /[\d٠-٩۰-۹]/.test(ch);
  let digitsBeforeCaret = 0;
  for(let i = 0; i < oldPos && i < oldValue.length; i++){ if(isDigit(oldValue[i])) digitsBeforeCaret++; }

  const newValue = _groupThousands(oldValue);
  if(newValue === oldValue) return; // no change — leave the caret alone
  el.value = newValue;
  let count = 0, newPos = newValue.length;
  if(digitsBeforeCaret === 0){
    newPos = 0;
  } else {
    for(let i = 0; i < newValue.length; i++){
      if(isDigit(newValue[i])) count++;
      if(count === digitsBeforeCaret){ newPos = i + 1; break; }
    }
  }
  try{ el.setSelectionRange(newPos, newPos); }catch(_){} // some input states disallow it (e.g. type=number, unused here)
}

// Shared by escHtml() and any other text that ends up displayed/rendered
// (e.g. wallet names) — strips Unicode bidi controls + zero-width chars. A
// pasted/imported string containing e.g. U+202E or U+200F can otherwise
// visually scramble the whole RTL layout of surrounding UI text
// ("Trojan Source"-style display corruption). Covers: zero-width
// (200B-200D, FEFF), LRM/RLM (200E-200F), Arabic letter mark (061C),
// embeddings/overrides (202A-202E), isolates (2066-2069). Explicit \u
// escapes are immune to source-editor stripping of literal controls.
function stripBidiControls(str){
  return String(str||'').replace(/[\u200B-\u200F\u061C\u202A-\u202E\u2066-\u2069\uFEFF]/g,'');
}
// Plain str.slice(0,n) counts UTF-16 code UNITS, not characters \u2014 cutting a
// description exactly mid-surrogate-pair (an emoji outside the BMP) or
// mid-ZWJ-sequence leaves a lone surrogate. That's a valid JS string but not
// valid Unicode, and silently becomes U+FFFD the next time it's UTF-8-encoded
// (export, Drive sync) \u2014 permanently corrupting the description. The spread
// operator iterates by code point instead, so a cut can only ever land between
// complete characters (a multi-codepoint ZWJ emoji sequence can still be split
// apart into its component emoji, but never mangled into an invalid one).
function truncateCodePoints(str, maxLen){
  return [...String(str||'')].slice(0, maxLen).join('');
}
function escHtml(str){
  return stripBidiControls(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#x27;');
}

// Body scroll lock for modals/drawers. overflow:hidden alone is not enough on
// iOS Safari — it keeps scrolling the page under a finger dragging the backdrop,
// and the page jumps when the on-screen keyboard opens. Pin the body with
// position:fixed at the current offset instead, and restore the offset on
// unlock. Idempotent (a flag, not a counter) because both openModal and the add
// drawer call lock, and both close paths already gate the unlock on
// _anyOverlayOpen() — the LAST closer is the one that actually unlocks.
let _bodyScrollLocked = false;
let _bodyLockScrollY = 0;
function lockBodyScroll(){
  if(_bodyScrollLocked) return;
  _bodyScrollLocked = true;
  _bodyLockScrollY = window.scrollY || window.pageYOffset || 0;
  const s = document.body.style;
  s.overflow = 'hidden';
  s.position = 'fixed';
  s.top = (-_bodyLockScrollY) + 'px';
  // left/right 0 (not width) so the body's own max-width + margin:auto keep
  // centering it exactly as in normal flow
  s.left = '0';
  s.right = '0';
}
function unlockBodyScroll(){
  if(!_bodyScrollLocked) return;
  _bodyScrollLocked = false;
  const s = document.body.style;
  s.overflow = ''; s.position = ''; s.top = ''; s.left = ''; s.right = '';
  window.scrollTo(0, _bodyLockScrollY);
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

// Visual counterpart to the various _xBusy guard flags: those flags correctly
// block a double-tap from corrupting state, but gave no on-screen sign anything
// was happening, so a slow save looked like a no-op and invited a second tap.
function _setBtnSaving(btn, saving, savingText){
  if(!btn) return;
  if(saving){
    if(btn.dataset.origLabel === undefined) btn.dataset.origLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = savingText || '...';
  } else {
    btn.disabled = false;
    if(btn.dataset.origLabel !== undefined){ btn.textContent = btn.dataset.origLabel; delete btn.dataset.origLabel; }
  }
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

// Smooth-scroll the tx list into view AFTER the current render settles (deferring
// to the next frame stops the scroll animation from competing with layout/canvas
// work, which caused visible stutter on filter/search changes)
function scrollToTxList(){
  switchTab('reports');
  const el = document.getElementById('txList');
  if(el) requestAnimationFrame(()=> el.scrollIntoView({behavior:'smooth', block:'start'}));
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

function applyTheme(theme){
  _themeColorCache = {}; // theme switch — drop cached colors so charts re-read them
  const isLight = theme === 'light';
  const isBlack = theme === 'black';
  document.body.classList.toggle('light', isLight);
  document.body.classList.toggle('theme-black', isBlack); // matte-black variant of dark
  const btn = document.getElementById('themeToggle');
  if(btn){
    btn.textContent = isLight ? '🌙' : '☀️';
    btn.title = isLight ? t({ar:'التبديل للوضع الداكن', en:'Switch to dark mode'}) : t({ar:'التبديل للوضع الفاتح', en:'Switch to light mode'});
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', isLight ? '#f4f2ed' : (isBlack ? '#0b0b0d' : '#15171c'));
  // keep the installed PWA splash/chrome color in sync with the chosen theme
  if(typeof applyManifest === 'function') applyManifest(isLight, isBlack);
  // day/night each keep their own accent — re-resolve for the bucket we just
  // switched into, and refresh the swatch selection if Settings is open.
  if(typeof applyAccent === 'function') applyAccent();
  if(typeof _updateAccentUI === 'function') _updateAccentUI(_currentAccent());
}
// Theme MODE is one of 'light' | 'dark' | 'black' | 'auto'. 'auto' isn't stored
// explicitly — its absence from localStorage IS the auto state, so a value written
// before this feature existed ('light'/'dark') keeps behaving as an explicit choice.
// 'black' is a manual-only matte-dark variant ('auto' never resolves to it — auto
// only follows the OS light/dark switch).
function _systemPrefersLight(){
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
}
function _currentThemeMode(){
  let m = null;
  try{ m = localStorage.getItem(LS_PREFIX + 'theme'); }catch(e){}
  return (m === 'light' || m === 'dark' || m === 'black') ? m : 'auto';
}
// Which dark style to use whenever the theme resolves to "dark" — either the
// standard dark or the matte ('black'). Remembered from the user's last explicit
// dark/matte pick so 'auto' AND the header quick-toggle both honour it.
function _darkVariant(){
  let v = null;
  try{ v = localStorage.getItem(LS_PREFIX + 'darkVariant'); }catch(e){}
  return v === 'black' ? 'black' : 'dark';
}
function _resolveThemeMode(mode){
  if(mode === 'auto') return _systemPrefersLight() ? 'light' : _darkVariant();
  return mode;
}
function _updateThemeModeUI(mode){
  document.querySelectorAll('#themeModeTabs [data-theme-mode]').forEach(btn => {
    const active = btn.dataset.themeMode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}
function setThemeMode(mode){
  try{
    if(mode === 'auto') localStorage.removeItem(LS_PREFIX + 'theme');
    else localStorage.setItem(LS_PREFIX + 'theme', mode);
    // Remember the preferred dark style so 'auto' and the header toggle resolve
    // dark to the same variant the user last chose (standard dark vs matte).
    if(mode === 'dark' || mode === 'black') localStorage.setItem(LS_PREFIX + 'darkVariant', mode);
  }catch(e){}
  applyTheme(_resolveThemeMode(mode));
  _updateThemeModeUI(mode);
  // canvas charts bake theme colors at draw time — redraw so they match the new theme
  if(typeof renderChart === 'function') renderChart();
  if(typeof renderPieChart === 'function') renderPieChart();
}
function toggleTheme(){
  // quick header tap = explicit manual choice (the opposite of what's showing now),
  // matching the long-standing one-tap behavior; pick 'auto' from Settings instead.
  // Going to dark uses the user's preferred dark variant (standard or matte).
  const isLight = document.body.classList.contains('light');
  setThemeMode(isLight ? _darkVariant() : 'light');
}
function initTheme(){
  const mode = _currentThemeMode();
  applyTheme(_resolveThemeMode(mode));
  _updateThemeModeUI(mode);
  // live-follow the device's light/dark switch (e.g. sunset auto-dark-mode) while
  // in auto mode, instead of only resolving it once at page load
  if(window.matchMedia){
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onSystemThemeChange = () => {
      if(_currentThemeMode() !== 'auto') return;
      applyTheme(_resolveThemeMode('auto'));
      if(typeof renderChart === 'function') renderChart();
      if(typeof renderPieChart === 'function') renderPieChart();
    };
    if(mq.addEventListener) mq.addEventListener('change', onSystemThemeChange);
    else if(mq.addListener) mq.addListener(onSystemThemeChange); // older Safari
  }
}

/* ============================================================
   ACCENT PALETTE (works in both light & dark)
============================================================ */
// Each palette re-skins the accent (--gold* + --accent-rgb) via a body.accent-<id>
// class defined in style.css (with a light variant). 'gold' is the default and
// has NO class — it falls back to the :root/body.light gold tokens. The c1/c2/on
// triple here is ONLY the swatch preview gradient shown in Settings; the authored,
// contrast-tuned applied colors live in CSS so they can differ per light/dark.
const ACCENTS = [
  {id:'gold',     name:'ذهبي',   nameEn:'Gold',     c1:'#dcb674', c2:'#b88c46', on:'#241d0d'},
  {id:'sapphire', name:'ياقوتي', nameEn:'Sapphire', c1:'#6fa0f0', c2:'#4178d0', on:'#08152b'},
  {id:'emerald',  name:'زمردي',  nameEn:'Emerald',  c1:'#54bd8a', c2:'#2f8a63', on:'#052016'},
  {id:'amethyst', name:'بنفسجي', nameEn:'Amethyst', c1:'#a987e6', c2:'#7d56c8', on:'#160a2a'},
  {id:'rose',     name:'وردي',   nameEn:'Rose',     c1:'#e985a4', c2:'#c25c7f', on:'#2a0f18'},
  {id:'teal',     name:'فيروزي', nameEn:'Teal',     c1:'#46c2c2', c2:'#2a9393', on:'#042020'},
  {id:'brown',    name:'بنّي',   nameEn:'Brown',    c1:'#b88a5e', c2:'#8a6038', on:'#1f1408'},
];
const _ACCENT_IDS = ACCENTS.map(a => a.id);
// The accent colour is remembered SEPARATELY for day vs night, so a user can run
// (say) blue in the daytime light theme and purple at night — switching the theme
// also restores that theme's own accent. 'day' = light theme; 'night' = the dark
// and matte themes (they share one night accent). Stored keys: 'accent' (day,
// kept for backward-compat with older single-accent backups) and 'accentDark'
// (night). 'gold' is the default and is represented by the key being absent.
function _accentBucket(){
  return document.body.classList.contains('light') ? 'day' : 'night';
}
function _accentKey(bucket){
  return (bucket === 'night') ? (LS_PREFIX + 'accentDark') : (LS_PREFIX + 'accent');
}
function _currentAccent(bucket){
  bucket = bucket || _accentBucket();
  let a = null;
  try{ a = localStorage.getItem(_accentKey(bucket)); }catch(e){}
  return _ACCENT_IDS.indexOf(a) > -1 ? a : 'gold';
}
// Resolve + apply the accent for the CURRENT theme bucket (no argument — it reads
// whichever bucket the active theme falls into). Called on load, on accent change,
// and at the end of every theme switch so day/night accents follow the theme.
function applyAccent(){
  const id = _currentAccent();
  _ACCENT_IDS.forEach(a => { if(a !== 'gold') document.body.classList.remove('accent-' + a); });
  if(id !== 'gold') document.body.classList.add('accent-' + id);
  _themeColorCache = {}; // accent changed --gold etc — drop cached colors
}
function _updateAccentUI(id){
  document.querySelectorAll('#accentSwatches [data-accent]').forEach(el => {
    const active = el.dataset.accent === id;
    el.classList.toggle('active', active);
    el.setAttribute('aria-checked', active ? 'true' : 'false');
  });
}
function renderAccentSwatches(){
  const wrap = document.getElementById('accentSwatches');
  if(!wrap) return;
  wrap.innerHTML = '';
  const cur = _currentAccent();
  ACCENTS.forEach(a => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'accent-swatch' + (a.id === cur ? ' active' : '');
    b.dataset.accent = a.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', a.id === cur ? 'true' : 'false');
    const swatchName = t({ar: a.name, en: a.nameEn});
    b.setAttribute('aria-label', swatchName);
    b.title = swatchName;
    b.style.background = 'linear-gradient(150deg,' + a.c1 + ',' + a.c2 + ')';
    b.style.setProperty('--sw-on', a.on);
    b.onclick = () => setAccent(a.id);
    b.onkeydown = (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); setAccent(a.id); } };
    wrap.appendChild(b);
  });
}
function setAccent(id){
  if(_ACCENT_IDS.indexOf(id) === -1) id = 'gold';
  const key = _accentKey(_accentBucket()); // write into the active theme's bucket
  try{
    if(id === 'gold') localStorage.removeItem(key);
    else localStorage.setItem(key, id);
  }catch(e){}
  applyAccent();
  _updateAccentUI(id);
  // canvas charts bake some theme colors at draw time — redraw so any accent-tinted
  // pixels stay in sync (cheap, and future-proofs charts that adopt --gold)
  if(typeof renderChart === 'function') renderChart();
  if(typeof renderPieChart === 'function') renderPieChart();
}
function initAccent(){
  applyAccent();
}

function todayISO(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// monthIndex is 0-based (Date's own convention) — day 0 of the FOLLOWING month
// rolls back to the last day of the requested month, which is the standard JS
// idiom this replaces at every call site (billing-day clamping, subscription/
// recurring "days left" math).
function _daysInMonth(year, monthIndex){
  return new Date(year, monthIndex + 1, 0).getDate();
}

// Timestamp for a transaction on the chosen date at the current time, INCLUDING
// milliseconds — so two entries within the same second still get distinct,
// correctly-ordered ts values (the sort's id tiebreaker covers any exact-ms tie).
const MIN_TX_TS = new Date('2010-01-01T00:00:00').getTime(); // matches the date pickers' min=
function buildTxTs(dateVal){
  const now = new Date();
  const ts = new Date(dateVal + 'T' + now.toTimeString().slice(0,8)).getTime();
  if(!isFinite(ts)) return Date.now(); // guard against an invalid date string
  // never allow a future ts (clock skew / DST edge) — it would sort above
  // everything and corrupt "this month" filters. Edit path already caps; do it here too.
  // Also floor at 2010 so a programmatically-set out-of-range date (the HTML min=
  // attribute is only an input-side hint) can't store a tiny/negative ts that would
  // pin the entry to the top of every list and skew monthly filters.
  return Math.max(MIN_TX_TS, Math.min(ts + now.getMilliseconds(), now.getTime()));
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
async function loadState(){
  // Guards this function's own multi-await body the same way every other
  // wholesale-state-replacing mutator does (_opInFlight++/finally--): without
  // it, the cross-tab storage listener's pre-call check (_trySync, app.main.js)
  // only confirms nothing was ALREADY in flight before calling loadState() —
  // it does nothing to stop a NEW operation (e.g. tapping "Add Expense")
  // started in THIS tab while loadState() itself is still mid-flight across
  // its own idbRestore()/idbBackup() awaits. That operation would see
  // _opInFlight === 0 the whole time, write into `state` mid-reset, and then
  // have its work silently erased the instant loadState() resumes and
  // unconditionally overwrites state.transactions again from the (now-stale)
  // snapshot it read before the write happened — with no error, no undo.
  _opInFlight++;
  try{
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
      _restoreWalletBalances(saved);
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
      // sanitizeBudgets also caps at MAX_AMOUNT and rounds to cents — a raw
      // isFinite/>0 check (as this branch used to do inline) let a corrupt/
      // tampered localStorage value bypass the same ceiling every other
      // budgets-restore path (the IDB-fresher branch below, applyImport,
      // mergeCloudData) already enforces.
      budgets = sanitizeBudgets(c.budgets);
      if(c.distribution && Array.isArray(c.distribution) && c.distribution.length){
        // sanitizeDistribution also clamps/validates each pct (a raw filter would
        // let a NaN/negative/string pct from a tampered config into the money math)
        DISTRIBUTION = sanitizeDistribution(c.distribution);
      }
      dismissedRecurring = new Set(Array.isArray(c.dismissedRecurring) ? c.dismissedRecurring : []);
      if(c.deletedTxIds && typeof c.deletedTxIds === 'object') deletedTxIds = c.deletedTxIds;
      if(c.deletedSubIds && typeof c.deletedSubIds === 'object') deletedSubIds = c.deletedSubIds;
      if(c.deletedWalletDefIds && typeof c.deletedWalletDefIds === 'object') deletedWalletDefIds = c.deletedWalletDefIds;
      _lsHadConfig = true;
    }
  }catch(e){}

  const _validTx = arr => (Array.isArray(arr) ? arr : []).filter(isValidTx);

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
  // Independent of the timestamp comparison below: set by saveConfig() when its
  // OWN write fails but a DIFFERENT save called right after it (in the same
  // composite operation, e.g. saveWalletDefModal) succeeds and re-stamps
  // lastEdit/dataEdit to a fresh value — which would otherwise make the failed
  // config save's staleness invisible to the timestamp check (see saveConfig).
  let _lsConfigStale = false;
  try{ _lsConfigStale = localStorage.getItem(LS_PREFIX + 'configStale') === '1'; }catch(e){}
  const _idb = await idbRestore(); // also opens the DB, setting _idbAvailable
  const _idbTime = (_idb && typeof _idb.savedAt === 'number' && isFinite(_idb.savedAt)) ? _idb.savedAt : 0;
  // "IDB snapshot is strictly newer than every localStorage stamp" can only mean
  // a localStorage save FAILED (quota full / locked down) while its paired
  // idbBackup succeeded — every successful save writes the same ts to both.
  // In that state a localStorage key can be present yet silently STALE, so
  // "present" alone must not win: prefer the IDB copy for the small data too
  // (balances/config/wallet defs/subscriptions below), otherwise the user's
  // last edits quietly revert on reload despite the "saved to the backup
  // copy" toast having promised otherwise.
  const _idbFresher = _idbTime > Math.max(_lsDataEdit, _lsLastEdit);
  // Recover custom wallet definitions from IndexedDB if localStorage's copy was
  // wiped OR corrupted (_walletDefsLoadFailed) — same wipe-recovery pattern as
  // driveClientId/subscriptions below. Must happen before _validTx/balance-restore
  // loops run (just below) so a custom wallet's transactions and balance aren't
  // silently dropped as "unknown wallet".
  if(_idb && Array.isArray(_idb.walletDefs) && (_walletDefsLoadFailed || _idbFresher || !localStorage.getItem(LS_PREFIX + 'walletDefs'))){
    const _cleanWD = sanitizeWalletDefs(_idb.walletDefs);
    if(_cleanWD){
      // union the IDB tombstones BEFORE applyWalletDefs — with localStorage wiped,
      // the config-blob seed at parse time found nothing, and applyWalletDefs
      // would otherwise re-insert a default wallet the user deleted.
      _unionTombstoneMap(deletedWalletDefIds, _idb.deletedWalletDefIds);
      applyWalletDefs(_cleanWD);
      WALLET_DEFS.forEach(w => { if(state.wallets[w.id] === undefined) state.wallets[w.id] = 0; });
      _restoreWalletBalances(_idb.wallets);
      try{ localStorage.setItem(LS_PREFIX + 'walletDefs', JSON.stringify(WALLET_DEFS)); }catch(e){}
    }
  } else if(_walletDefsLoadFailed){
    // Corrupted locally and no usable IDB copy to recover from — the app is
    // about to fall back to default wallets, so say so instead of silently
    // dropping the user's custom wallet setup with zero indication why.
    toast(t({ar:'⚠ تعذّرت قراءة بيانات المحافظ محليًا — تم الرجوع للمحافظ الافتراضية', en:'⚠ Could not read wallet data locally — fell back to default wallets'}), true);
  }
  let _lsTx = null;
  try{ const raw = localStorage.getItem(LS_PREFIX + 'transactions'); if(raw) _lsTx = JSON.parse(raw); }catch(e){}
  const _idbHasTx = _idb && Array.isArray(_idb.transactions);
  const _lsTxNewer = Array.isArray(_lsTx) && (_lsDataEdit || _lsLastEdit) > _idbTime;

  if(_idbHasTx && !_lsTxNewer){
    // IndexedDB snapshot is the source of truth
    state.transactions = _validTx(_idb.transactions);
    // Recover the small data too when localStorage was wiped — or when its keys
    // are present but STALE (_idbFresher: the last ls save failed on quota while
    // the IDB mirror succeeded; see the _idbFresher comment above; _lsConfigStale:
    // the same failure but with its staleness masked by a later save's fresh
    // stamp — see saveConfig).
    if(!_lsHadBalances || _idbFresher) _restoreWalletBalances(_idb.wallets);
    if(!_lsHadConfig || _idbFresher || _lsConfigStale){
      if(typeof _idb.crisisMode === 'boolean') state.crisisMode = _idb.crisisMode;
      if(typeof _idb.autoDistribute === 'boolean') autoDistribute = _idb.autoDistribute;
      if(_idb.budgets && typeof _idb.budgets === 'object') budgets = sanitizeBudgets(_idb.budgets);
      if(Array.isArray(_idb.dismissedRecurring)) dismissedRecurring = new Set(_idb.dismissedRecurring);
      if(_idb.distribution && Array.isArray(_idb.distribution)) DISTRIBUTION = sanitizeDistribution(_idb.distribution);
    }
    if(_idb.deletedTxIds && typeof _idb.deletedTxIds === 'object' && !Array.isArray(_idb.deletedTxIds)){
      _unionTombstoneMap(deletedTxIds, _idb.deletedTxIds);
    }
    _unionTombstoneMap(deletedSubIds, _idb.deletedSubIds);
    _unionTombstoneMap(deletedWalletDefIds, _idb.deletedWalletDefIds);
    if(Array.isArray(_idb.subscriptions)){
      try{ localStorage.setItem(LS_PREFIX + 'subs', JSON.stringify(_idb.subscriptions)); }catch(e){}
    }
    // Same recovery for the Drive client id: without this, a wiped localStorage
    // makes driveClientId read back empty, initDrive() silently no-ops (its whole
    // body is gated on `if(driveClientId)`), and Drive sync turns itself off with
    // zero indication — the user just stops syncing and has no idea why. Restoring
    // it (but never the OAuth token, which has its own cookie fallback) lets
    // initDrive() detect "Drive was connected" and surface a normal reconnect prompt.
    if(_idb.driveClientId && !localStorage.getItem(LS_PREFIX + 'driveClientId')){
      try{ localStorage.setItem(LS_PREFIX + 'driveClientId', _idb.driveClientId); }catch(e){}
    }
    if(!_lsHadBalances && state.transactions.length) toast(t({ar:'✓ تمت استعادة البيانات من النسخ الاحتياطي', en:'✓ Data restored from backup'}));
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
  const _now = Date.now();
  stripOrphanedDistributionLegs(state.transactions).forEach(t => { deletedTxIds[t.id] = _now; });
  _runTxCommitInvalidators(); // freshly replaced array — drop caches keyed off it

  // If the DB couldn't be opened (blocked by another tab / corrupt) and we ended up
  // with NO transactions despite having used the app before, the data is intact in
  // IDB but unreachable. Warn the user and DO NOT run idbBackup — writing our empty
  // in-memory state could clobber the real snapshot if the DB becomes writable.
  const _hadPriorData = _lsLastEdit > 0 || _lsDataEdit > 0 || _lsHadBalances;
  const _idbLockedOut = _idbOpenFailed && state.transactions.length === 0 && _hadPriorData;
  if(_idbLockedOut){
    try{ toast(t({ar:'⚠ تعذّر فتح قاعدة البيانات — أغلق نسخ التطبيق الأخرى المفتوحة ثم أعد التحميل', en:'⚠ Could not open the database — close other open copies of the app, then reload'}), true); }catch(e){}
  }

  // Persist the consistent state into IndexedDB, then (only once confirmed) drop the
  // big legacy localStorage transactions key to free the ~5MB quota for small data.
  const _backupStamp = Math.max(_lsLastEdit, _idbTime) || Date.now();
  const _idbOk = _idbLockedOut ? false : await idbBackup(_backupStamp);
  if(_idbOk && _lsTx !== null){
    try{ localStorage.removeItem(LS_PREFIX + 'transactions'); }catch(e){}
  }

  // trackLinkMode (debit/credit direction for tracked wallets) is normally only
  // read once at startup via loadLayoutPrefs(), but it directly feeds balance
  // math (trackModeFor/applyTxToBalance). The cross-tab storage listener calls
  // loadState() for any data-relevant key — including this one — so without
  // re-reading it here a second tab keeps computing totals with a stale mode
  // after the first tab changes it, until a hard page reload.
  try{ trackLinkMode = sanitizeTrackLinkMode(JSON.parse(localStorage.getItem(LS_PREFIX + 'trackLinkMode') || 'null')); }
  catch(e){}

  _ensureReserveShare();

  _txMutationStamp++; // fresh data set loaded — invalidate any derived caches
  const _di = document.getElementById('dateInput');
  if(_di) _di.value = todayISO();
  capDateInputsToToday();
  loadSubs(_idb, _idbFresher);
  // Rebuild the wallet dropdown to match the restored crisis-mode state — if the
  // app last closed in crisis mode, SELECTABLE_WALLETS must exclude the hidden wallets.
  recomputeSelectableWallets();
  render(true);
  } finally { _opInFlight--; }
}

// Multi-device union merge: combine local + cloud transactions/subscriptions by id
// (so a transaction added on either device is never lost), honor tombstones from
// BOTH sides (so a deletion on either device propagates instead of resurrecting),
// then recompute balances from the merged ledger (0 + Σ — the app's model). Config
// (crisis/budgets/distribution/prefs) is taken from whichever side edited last.
// Returns {added, removed} counts for an informative toast.
function mergeCloudData(cloud, cloudNewer){
  // 0) wallet defs — additive id union FIRST (unconditionally, regardless of
  //    cloudNewer) so a wallet added on the OTHER device is already known
  //    locally before validTx below runs; otherwise its transactions would be
  //    silently rejected as "unknown wallet" and lost on this device.
  // union wallet-def tombstones from the cloud FIRST so both the "add cloud-only
  // defs" step below and the local-removal step after the tx merge see them
  _unionTombstoneMap(deletedWalletDefIds, cloud.deletedWalletDefIds);
  const cloudWD = Array.isArray(cloud.walletDefs) ? sanitizeWalletDefs(cloud.walletDefs) : null;
  if(cloudWD){
    const localIds = new Set(WALLET_DEFS.map(w => w.id));
    // a def that exists only on the cloud AND is tombstoned is a deletion still
    // propagating — re-adding it here is exactly the resurrection bug
    const onlyOnCloud = cloudWD.filter(w => !localIds.has(w.id) && !deletedWalletDefIds[w.id]);
    if(onlyOnCloud.length){
      const merged = WALLET_DEFS.concat(onlyOnCloud);
      applyWalletDefs(merged);
      onlyOnCloud.forEach(w => { if(state.wallets[w.id] === undefined) state.wallets[w.id] = 0; });
      // Reassign (not push) — computeRenderSig() caches the distribution signature by
      // object-reference equality and only re-stringifies when the reference changes;
      // an in-place push() here would silently keep the stale cached signature, so a
      // wallet synced in from another device could fail to show its new 0% share
      // until something else happens to force a full render.
      if(!cloudNewer){
        const newEntries = onlyOnCloud.filter(w => !DISTRIBUTION.find(d => d.id === w.id)).map(w => ({id: w.id, pct: 0}));
        if(newEntries.length) DISTRIBUTION = DISTRIBUTION.concat(newEntries);
      }
    }
    // Renames/reordering: only adopted from the side that edited most recently —
    // names/order are config-like, not additive data, same rule as step 5 below.
    if(cloudNewer){
      const cloudById = new Map(cloudWD.map(w => [w.id, w]));
      const renamed = WALLET_DEFS.map(w => {
        const cw = cloudById.get(w.id);
        return cw ? {...w, name: cw.name} : w;
      });
      // order: cloud ids first (in cloud order), then any local-only ids appended
      // at the end so a wallet added locally isn't dropped just because the cloud
      // snapshot predates it.
      const byId = new Map(renamed.map(w => [w.id, w]));
      const ordered = [];
      cloudWD.forEach(cw => { const w = byId.get(cw.id); if(w){ ordered.push(w); byId.delete(cw.id); } });
      byId.forEach(w => ordered.push(w));
      applyWalletDefs(ordered);
    }
  }

  const validTx = isValidTx;

  // 1) union tombstones from both sides
  if(cloud.deletedTxIds && typeof cloud.deletedTxIds === 'object'){
    _unionTombstoneMap(deletedTxIds, cloud.deletedTxIds);
  }
  pruneTombstones();

  // 2) union transactions by id (local first, then cloud fills in the rest),
  //    skipping anything tombstoned on either side so deletes win over a stale copy.
  //    When an id exists on both sides, the copy with the newer editedAt wins (an
  //    edit made on one device after the last sync should overwrite the stale
  //    other-device copy); if either side lacks editedAt (data synced before this
  //    field existed) local keeps winning, same as before.
  const localCount = state.transactions.length;
  const byId = new Map();
  state.transactions.forEach(t => { if(validTx(t) && !deletedTxIds[t.id]) byId.set(t.id, t); });
  // Local rows a remote delete removes — keep the actual tx objects (not just a
  // count) so their tracked-wallet effects can be REVERSED below; regular-wallet
  // effects self-heal via reconcileBalances(), track wallets don't.
  const removedTxs = state.transactions.filter(t => deletedTxIds[t.id]);
  let removed = removedTxs.length;
  let added = 0;
  const addedTxs = [];
  const replacedTxs = []; // {before, after} pairs from editedAt-newer conflict wins
  (Array.isArray(cloud.transactions) ? cloud.transactions : []).forEach(t => {
    if(!validTx(t) || deletedTxIds[t.id]) return;
    // Same overlong-desc clamp applyImport/adoptCloudSnapshot already apply to
    // every other wholesale-adoption entry point — isValidTx checks well-formedness,
    // not length, so without this an incremental sync (unlike those two) let a
    // tampered/oversized desc field ride into state.transactions unclamped.
    if(typeof t.desc === 'string' && t.desc.length > MAX_DESC_LEN) t = {...t, desc: truncateCodePoints(t.desc, MAX_DESC_LEN)};
    const local = byId.get(t.id);
    if(!local){ byId.set(t.id, t); added++; addedTxs.push(t); return; }
    if(typeof t.editedAt === 'number' && typeof local.editedAt === 'number' && t.editedAt > local.editedAt){
      // Preserve the local link if the incoming version lost it (e.g. older snapshot
      // from before distribution ran).  Without this guard a Drive sync arriving
      // seconds after runDistribution would strip the link, turning the income source
      // into a standalone tx whose delete later orphans the withdrawal+deposits.
      let winner = local.link && !t.link ? {...t, link: local.link} : t;
      // Same guard for the tracked-wallet link: these fields are set at creation
      // and never removed by an edit (saveEdit mutates in place), so an incoming
      // copy lacking them is a stale snapshot, not a deliberate unlink — losing
      // them would silently stop this expense from moving its tracked counter.
      if(local.trackWallet && typeof local.trackSign === 'number' && winner.trackWallet === undefined){
        winner = {...winner, trackWallet: local.trackWallet, trackSign: local.trackSign};
      }
      byId.set(t.id, winner);
      replacedTxs.push({ before: local, after: winner });
    }
  });
  state.transactions = [...byId.values()];
  // Converge tracked-wallet balances with the merged ledger deltas. Without this,
  // an adjustment/track-linked tx from another device appeared in the list but
  // this device's displayed Uber/Cards/Cash balance never moved (and a remote
  // deletion of one never un-moved it) — permanent cross-device divergence.
  removedTxs.forEach(t => _applyTrackEffects(t, -1));
  addedTxs.forEach(t => _applyTrackEffects(t, +1));
  replacedTxs.forEach(r => { _applyTrackEffects(r.before, -1); _applyTrackEffects(r.after, +1); });
  stripOrphanLinks(state.transactions);
  const _now = Date.now();
  stripOrphanedDistributionLegs(state.transactions).forEach(t => { deletedTxIds[t.id] = _now; });
  _runTxCommitInvalidators();

  // 3b) apply wallet-def tombstones to LOCAL defs, now that the merged ledger is
  //     known: drop a tombstoned local def only when nothing references it —
  //     no transactions and a zero balance ('core' is structural, never dropped).
  //     A tombstoned wallet that still holds data keeps living on this device;
  //     data beats a stale deletion.
  {
    const doomed = [];
    WALLET_DEFS.forEach(w => {
      if(!deletedWalletDefIds[w.id]) return;
      // Mirrors deleteWalletDef()'s interactive guard (app.ui.js), which also
      // checks trackWallet — this merge-time check used to miss that, so a
      // wallet still referenced only as another transaction's SECONDARY
      // tracked-wallet link (trackLinkMode) could get silently stripped from
      // WALLET_DEFS here even though a real transaction still points at it,
      // permanently and silently dropping that track-link.
      const hasData = w.id === 'core' || Math.abs(state.wallets[w.id] || 0) > 0 ||
        state.transactions.some(t => t.wallet === w.id || t.trackWallet === w.id);
      // tombstoned but still holding data → legitimately alive on this device;
      // clear the local tombstone so it stops being treated as pending-delete.
      if(hasData) delete deletedWalletDefIds[w.id];
      else doomed.push(w);
    });
    if(doomed.length){
      const doomedIds = new Set(doomed.map(w => w.id));
      applyWalletDefs(WALLET_DEFS.filter(w => !doomedIds.has(w.id)));
      doomed.forEach(w => { delete state.wallets[w.id]; delete budgets[w.id]; delete trackLinkMode[w.id]; });
      DISTRIBUTION = DISTRIBUTION.filter(d => !doomedIds.has(d.id));
    }
  }

  // 4) merge subscriptions by id (union; cloud wins on a true id clash),
  //    skipping anything tombstoned on either side so deletes propagate
  //    instead of ping-ponging back from the other device's copy.
  _unionTombstoneMap(deletedSubIds, cloud.deletedSubIds);
  const subById = new Map();
  subscriptions.forEach(s => { if(!deletedSubIds[s.id]) subById.set(s.id, s); });
  (Array.isArray(cloud.subscriptions) ? cloud.subscriptions : []).forEach(s => {
    if(s && s.id && s.name && isFinite(s.amount) && s.amount > 0 && !deletedSubIds[s.id]) subById.set(s.id, _normalizeSub(s));
  });
  subscriptions = [...subById.values()];

  // 5) config from the side that edited most recently
  if(cloudNewer){
    if(typeof cloud.crisisMode === 'boolean') state.crisisMode = cloud.crisisMode;
    if(typeof cloud.autoDistribute === 'boolean') autoDistribute = cloud.autoDistribute;
    if(cloud.uiPrefs && typeof applyUiPrefs === 'function') applyUiPrefs(cloud.uiPrefs);
  }
  // budgets: unlike the scalar settings above, this is a SPARSE per-wallet map
  // (a wallet with no cap set has no key at all, see sanitizeBudgets) — a
  // wholesale "cloudNewer wins" swap silently discarded a real edit on this
  // device whenever the OTHER device happened to sync more recently overall,
  // even if that device never touched the wallet this one just set a cap on.
  // Union by key instead; only a genuine same-wallet collision (both sides
  // set a cap on the SAME wallet) falls back to the same cloudNewer tie-break
  // used for the single-valued settings above — no worse than before for a
  // true conflict, but no longer destructive for the common non-overlapping
  // case (this repro: device A caps Wallet X, device B independently caps
  // Wallet Y — both survive now instead of one silently vanishing).
  if(cloud.budgets && typeof cloud.budgets === 'object'){
    const cloudBudgets = sanitizeBudgets(cloud.budgets);
    const mergedBudgets = {...budgets};
    for(const id in cloudBudgets){
      if(!(id in mergedBudgets) || cloudNewer) mergedBudgets[id] = cloudBudgets[id];
    }
    budgets = mergedBudgets;
  }
  // distribution: NOT sparse (every non-track wallet always has an entry, see
  // sanitizeDistribution) — a per-key union can't distinguish "this device's
  // edit" from "this device's untouched copy of the other device's old value"
  // the way it can for budgets above, since both sides list every id either
  // way. A real per-entry merge would need per-key edit timestamps this
  // schema doesn't carry; left as the existing cloudNewer-wins-wholesale
  // behavior rather than risk a fragile heuristic in distribution math.
  if(cloudNewer && cloud.distribution && Array.isArray(cloud.distribution)){
    DISTRIBUTION = sanitizeDistribution(cloud.distribution);
  }
  // dismissedRecurring: union both sides (a dismissal on either device sticks)
  if(Array.isArray(cloud.dismissedRecurring)) cloud.dismissedRecurring.forEach(k => dismissedRecurring.add(k));

  _ensureReserveShare();
  // crisisMode may have just changed above (step 5) — SELECTABLE_WALLETS was
  // built from whatever crisisMode was true BEFORE this merge, so the
  // add-transaction/transfer/Quick-Notes wallet pickers would otherwise still
  // offer individual wallets after a sync merges in crisis mode ON (or the
  // reverse: still hide them after a sync merges it OFF) until a manual
  // crisis toggle or full reload happened to rebuild it.
  recomputeSelectableWallets();

  // 6) rebuild balances from the merged ledger so they're provably consistent
  reconcileBalances();
  _txMutationStamp++;
  prevSpendable = null;
  return { added, removed, hadLocal: localCount };
}

// Apply ONLY the tracked-wallet effects of a transaction to state.wallets —
// the track-wallet subset of applyTxToBalance (app.logic.js). Used by
// mergeCloudData: reconcileBalances() below rebuilds regular wallets from the
// merged ledger but deliberately skips track wallets, so a tx merged in FROM
// ANOTHER DEVICE (an adjustment on Uber/Cards/Cash, or a track-linked expense)
// used to land in the transaction list without ever moving this device's
// displayed track balance — the two devices never converged until a wholesale
// snapshot adoption. sign: +1 to apply (tx merged in), -1 to reverse (tx
// removed by a propagated deletion).
function _applyTrackEffects(tx, sign){
  if(!tx || !isFinite(tx.amount) || tx.amount <= 0) return;
  const w = WALLET_DEFS.find(x => x.id === tx.wallet);
  if(w && w.track){
    const delta = (tx.type === 'expense' ? -tx.amount : tx.amount) * sign;
    state.wallets[w.id] = round2((state.wallets[w.id] ?? 0) + delta);
  }
  // secondary link effect — same semantics as applyTxToBalance's trackSign math
  if(tx.trackWallet && typeof tx.trackSign === 'number'){
    const tw = WALLET_DEFS.find(x => x.id === tx.trackWallet && x.track);
    if(tw){
      const dir = (tx.type === 'expense' ? tx.trackSign : -tx.trackSign) * sign;
      state.wallets[tw.id] = round2((state.wallets[tw.id] ?? 0) + dir * tx.amount);
    }
  }
}

// ── Shared external-snapshot ingestion helpers ──────────────────────────────
// applyImport() (app.data.js) and adoptCloudSnapshot() (app.drive.js) both
// wholesale-replace WALLET_DEFS/state.wallets from an external snapshot
// object, and until v47.79 each carried its own copy of this exact logic
// (verified byte-identical modulo the local variable name). Extracted here so
// a future fix only needs to land once. Their TRANSACTION/tombstone/config
// restoration is deliberately NOT merged the same way — comparing both call
// sites line by line surfaced real, meaningful divergences (import unions
// existing tombstones and reconciles against a pre-import local snapshot so
// "replace all data" holds up against Drive's union merge, adopt resets
// tombstones to the cloud's copy wholesale; import enforces a transaction-
// count cap and calls normalizeCategory, adopt currently does neither) that
// look like they reflect the two paths' different trust models (a user's own
// hand-editable backup file vs. an already-vetted other-device snapshot)
// rather than accidental drift — forcing them identical risked silently
// changing sync-correctness behavior for what's meant to be a pure DRY pass.
function _ingestWalletDefs(snapshot){
  if(!Array.isArray(snapshot.walletDefs)) return;
  const cleanWD = sanitizeWalletDefs(snapshot.walletDefs);
  if(!cleanWD) return;
  // union the tombstones FIRST — applyWalletDefs consults deletedWalletDefIds
  // before re-inserting the default 'reserve'/'crisis_fund' wallets, and a
  // snapshot written after the user deleted one carries that deletion here.
  _unionTombstoneMap(deletedWalletDefIds, snapshot.deletedWalletDefIds);
  applyWalletDefs(cleanWD);
}
function _ingestWalletBalances(snapshot){
  // strict shape check (not just truthy) — a crafted/corrupt snapshot whose
  // `wallets` is an array (or any other non-plain-object truthy value) would
  // otherwise pass a loose check yet return undefined for every WALLET_DEFS[w.id]
  // lookup below, silently zeroing every balance with no restore and no warning.
  // (adoptCloudSnapshot used a looser `if(cloud.wallets)` check before this
  // consolidation — closing that gap here fixes it there too.)
  if(!snapshot.wallets || typeof snapshot.wallets !== 'object' || Array.isArray(snapshot.wallets)) return;
  WALLET_DEFS.forEach(w => { state.wallets[w.id] = 0; });
  WALLET_DEFS.forEach(w => {
    if(snapshot.wallets[w.id] !== undefined){
      const v = parseFloat(snapshot.wallets[w.id]);
      // same MAX_AMOUNT ceiling isValidTx/sanitizeBudgets/parseAmount all enforce —
      // without it a corrupt/tampered snapshot's unbounded value survives the
      // isFinite check, then can overflow to Infinity in later sums, which
      // JSON.stringify serializes as null and silently drops the balance on
      // the next load with no toast and no tombstone.
      if(isFinite(v) && Math.abs(v) <= MAX_AMOUNT) state.wallets[w.id] = round2(v);
    }
  });
}
// Shared snapshot ASSEMBLY — exportData() (app.data.js) and driveSyncToCloud()
// (app.drive.js) each built this same plain-object snapshot independently
// (verified line-for-line identical for the financial-data fields). Unified so
// adding a new persisted field only needs one edit instead of two — the class
// of bug this guards against already happened once (trackLinkMode was missed
// by wipeAll on one path; quickNotes was initially export-only). Export-only
// extras (theme/accent/lang/quickNotes — Drive never syncs per-device
// appearance/language/draft prefs, only financial data) are added by
// exportData() itself on top of this, not included here.
function _buildSyncPayload(){
  return {
    exportedAt: new Date().toISOString(),
    dataEditedAt: parseInt(localStorage.getItem(LS_PREFIX + 'dataEdit') || '0', 10) || 0,
    wallets: state.wallets,
    walletDefs: WALLET_DEFS,
    transactions: state.transactions,
    crisisMode: state.crisisMode,
    budgets: budgets,
    autoDistribute: autoDistribute,
    distribution: DISTRIBUTION,
    dismissedRecurring: Array.from(dismissedRecurring),
    deletedTxIds: deletedTxIds,
    deletedSubIds: deletedSubIds,
    deletedWalletDefIds: deletedWalletDefIds,
    subscriptions: subscriptions,
    uiPrefs: collectUiPrefs(),
  };
}

// "HH-MM" suffix for backup/export filenames — two downloads on the same day
// would otherwise get identical names (desktop browsers auto-suffix "(1)", but
// mobile save flows, e.g. iOS "Save to Files", may silently overwrite instead).
function _hmSuffix(){
  const _now = new Date();
  return String(_now.getHours()).padStart(2,'0') + '-' + String(_now.getMinutes()).padStart(2,'0');
}
// Trigger a browser download for an already-assembled Blob — the shared
// create-a-hidden-link/click/cleanup mechanics used by every "download a file"
// flow (data export, pre-destructive-action safety backups, text reports).
// Callers own their own mime type, filename, and error handling/toast — this
// only does the DOM/URL-lifecycle part, which is identical everywhere.
function _downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
// Shared safety-net for any flow that's about to WHOLESALE REPLACE the user's
// current data (Drive conflict resolution, backup import) with no other undo
// path — downloads a JSON file containing both the about-to-be-replaced
// current data and the incoming replacement, mirroring exportData()'s own
// blob-download mechanism, so a wrong choice/bad file is still recoverable
// from the downloaded file without needing a whole in-app "restore" UI.
function _downloadDataBackup(current, incoming, filenamePrefix){
  try{
    const json = JSON.stringify({ savedAt: new Date().toISOString(), current, incoming }, null, 2);
    const blob = new Blob([json], {type:'application/json'});
    _downloadBlob(blob, filenamePrefix + '-' + todayISO() + '_' + _hmSuffix() + '.json');
    return true;
  }catch(_){ return false; }
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
    computed[tx.wallet] = round2(computed[tx.wallet] + (tx.type === 'expense' ? -amt : amt));
  });
  WALLET_DEFS.forEach(w => {
    if(w.track) return; // leave manually-tracked balances untouched
    const before = parseFloat(state.wallets[w.id]) || 0;
    const after = computed[w.id];
    if(Math.abs(after - before) >= 0.005) diff[w.id] = round2(after - before);
    state.wallets[w.id] = after;
  });
  return diff;
}

// dataEdit marks the last change to actual user DATA (balances/transactions/subs),
// distinct from lastEdit which any save (incl. config/prefs) bumps. Drive conflict
// resolution compares dataEdit so a pref-only change (crisis toggle, layout) can't
// make a stale local copy "win" over fresher cloud transaction data.
function stampDataEdit(ts){ try{ localStorage.setItem(LS_PREFIX + 'dataEdit', String(ts)); }catch(e){} }
async function saveBalances(){
  const ts = Date.now();
  let lsOk = false;
  try{
    localStorage.setItem(LS_PREFIX + 'balances', JSON.stringify(state.wallets));
    localStorage.setItem(LS_PREFIX + 'lastEdit', String(ts));
    lsOk = true;
  }catch(e){
    toast(t({ar:'⚠ فشل الحفظ المحلي — يتم الحفظ في النسخة الاحتياطية', en:'⚠ Local save failed — saving to the backup copy'}), true);
  }
  if(lsOk) stampDataEdit(ts);
  scheduleDriveSync();
  scheduleIdbBackup(ts);
}
async function saveTx(){
  _runTxCommitInvalidators();
  const ts = Date.now();
  // Transactions are stored in IndexedDB (idbBackup below) so they scale far past
  // the ~5MB localStorage cap. Here we only stamp the small timestamps. If IDB is
  // unavailable, idbBackup() mirrors the array to localStorage as a fallback.
  try{ localStorage.setItem(LS_PREFIX + 'lastEdit', String(ts)); }catch(e){}
  stampDataEdit(ts);
  scheduleDriveSync();
  scheduleIdbBackup(ts);
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
  // Hard cap so a user with 200+ unique recurring patterns never exhausts localStorage
  // quota (all keys match live transactions so the live-set pruning above removes nothing)
  while(dismissedRecurring.size > 200) dismissedRecurring.delete(dismissedRecurring.values().next().value);
}
async function saveConfig(){
  const ts = Date.now();
  _pruneRecurringDismissals();
  pruneTombstones();
  let ok = false;
  try{
    localStorage.setItem(LS_PREFIX + 'config', JSON.stringify({crisisMode: state.crisisMode, autoDistribute: autoDistribute, budgets: budgets, dismissedRecurring: Array.from(dismissedRecurring), distribution: DISTRIBUTION, deletedTxIds: deletedTxIds, deletedSubIds: deletedSubIds, deletedWalletDefIds: deletedWalletDefIds}));
    localStorage.setItem(LS_PREFIX + 'lastEdit', String(ts));
    ok = true;
    // Clears a staleness flag a PRIOR failed call may have set below — see there
    // for why this can't just rely on the dataEdit/lastEdit timestamps alone.
    try{ localStorage.removeItem(LS_PREFIX + 'configStale'); }catch(_){}
  }catch(e){
    toast(t({ar:'⚠ فشل حفظ الإعدادات محليًا', en:'⚠ Failed to save settings locally'}), true);
    // A caller that chains saveConfig() into ANOTHER save right after it (e.g.
    // saveWalletDefModal: saveWalletDefs -> saveConfig -> saveBalances) can mask
    // this exact failure: saveBalances' OWN successful write stamps a FRESH
    // lastEdit/dataEdit a few ms later, and idbBackup's debounce coalesces both
    // calls into one write timestamped with that same fresh value — so on
    // reload, localStorage's stale 'config' key and the IDB snapshot's savedAt
    // end up EQUAL, and loadState's "IDB strictly newer" check (_idbFresher)
    // can no longer tell config is stale, silently keeping the failed edit
    // reverted forever. This flag is a second, independent signal loadState
    // checks alongside that timestamp comparison, immune to being masked by an
    // unrelated LATER save's stamp.
    try{ localStorage.setItem(LS_PREFIX + 'configStale', '1'); }catch(_){}
  }
  scheduleDriveSync();
  scheduleIdbBackup(ts);
  return ok;
}
// Minimal shape check for an incoming subscription entry (localStorage, IndexedDB
// recovery, imported backup, Drive cloud snapshot) — the SAME predicate was
// re-typed identically at 5 separate ingestion sites; always paired with
// _normalizeSub right after (that one clamps/cleans fields this one doesn't check).
function isValidSubShape(x){
  return !!(x && x.id && x.name && isFinite(x.amount) && x.amount > 0);
}
// clamp a subscription's billing day into 1–31 so corrupt data can't produce
// "يوم 99" that never matches the daily-review check
function _normalizeSub(x){
  let d = parseInt(x.billingDay, 10);
  if(!isFinite(d)) d = 1;
  x.billingDay = Math.min(31, Math.max(1, d));
  // Same MAX_AMOUNT ceiling every other numeric-ingestion path enforces
  // (isValidTx, sanitizeBudgets, parseAmount, _ingestWalletBalances) — every
  // caller of this function already filters to isFinite(x.amount) && x.amount
  // > 0 before mapping through it, but none of them cap the UPPER bound. A
  // corrupted/tampered backup or cloud snapshot's subscription amount could
  // otherwise feed unguarded sums (renderSubscriptions' monthlyTotal,
  // buildDailyReviewContent's due-today/missed-while-away totals) with no cap
  // at all — clamped here, once, for every ingestion path at once.
  if(isFinite(x.amount)) x.amount = Math.min(x.amount, MAX_AMOUNT);
  // Same treatment sanitizeWalletDefs already gives wallet names — this field
  // reached every render site only escHtml()'d (safe from injection), but
  // unlike wallet names it had no length cap or hidden-bidi-control stripping
  // at the data layer, so an oversized or invisible-character-laden name from
  // an import/cloud-merge could persist indefinitely (subName's own input has
  // maxlength=60, so this only bites data arriving from outside the form).
  if(typeof x.name === 'string') x.name = [...stripBidiControls(x.name).trim()].slice(0,60).join('');
  return x;
}
function loadSubs(idbSnapshot, preferIdb){
  // preferIdb: the IDB snapshot is strictly newer than every localStorage stamp
  // (a quota-failed ls save — see loadState's _idbFresher), so a present-but-
  // stale ls 'subs' key must not win over the successfully-mirrored IDB copy.
  if(preferIdb && idbSnapshot && Array.isArray(idbSnapshot.subscriptions)){
    subscriptions = idbSnapshot.subscriptions
      .filter(isValidSubShape)
      .map(_normalizeSub);
    return;
  }
  try{
    const s = localStorage.getItem(LS_PREFIX + 'subs');
    if(s) subscriptions = JSON.parse(s)
      .filter(isValidSubShape)
      .map(_normalizeSub);
  }catch(e){
    // localStorage's 'subs' key is corrupted (e.g. a crash mid-write) — fall back
    // to the IndexedDB snapshot's copy (idbBackup mirrors subscriptions into it on
    // every save) instead of silently wiping the user's recurring subscriptions.
    if(idbSnapshot && Array.isArray(idbSnapshot.subscriptions) && idbSnapshot.subscriptions.length){
      subscriptions = idbSnapshot.subscriptions
        .filter(isValidSubShape)
        .map(_normalizeSub);
      toast(t({ar:'⚠ تعذّرت قراءة الاشتراكات محليًا — تم استرجاعها من النسخة الاحتياطية', en:'⚠ Could not read subscriptions locally — recovered from the backup copy'}), true);
    } else {
      subscriptions = [];
      toast(t({ar:'⚠ تعذّرت قراءة الاشتراكات المحفوظة، تم البدء بقائمة فارغة', en:'⚠ Could not read saved subscriptions — starting with an empty list'}), true);
    }
  }
}
async function saveSubs(){
  const ts = Date.now();
  // stamp dataEdit ONLY if the data write itself succeeded (same rule as
  // saveBalances): loadState detects a quota-failed save by "IDB savedAt is
  // newer than every localStorage stamp" — stamping here on failure would
  // advance the ls stamp and mask exactly the condition it needs to see.
  let lsOk = false;
  try{ localStorage.setItem(LS_PREFIX + 'subs', JSON.stringify(subscriptions)); lsOk = true; }catch(e){ toast(t({ar:'⚠ فشل حفظ الاشتراكات محليًا', en:'⚠ Failed to save subscriptions locally'}), true); }
  if(lsOk) stampDataEdit(ts);
  scheduleDriveSync();
  scheduleIdbBackup(ts);
}
async function saveWalletDefs(){
  const ts = Date.now();
  // stamp-on-success-only: see saveSubs above
  let lsOk = false;
  try{ localStorage.setItem(LS_PREFIX + 'walletDefs', JSON.stringify(WALLET_DEFS)); lsOk = true; }catch(e){ toast(t({ar:'⚠ فشل حفظ بيانات المحافظ محليًا', en:'⚠ Failed to save wallet data locally'}), true); }
  if(lsOk) stampDataEdit(ts);
  scheduleDriveSync();
  scheduleIdbBackup(ts);
}

/* ============================================================
   INDEXEDDB BACKUP (extra resilience alongside localStorage)
============================================================ */
let _idbInstance = null;
let _idbAvailable = false; // becomes true once the DB opens — gates IDB-primary storage
let _idbOpenPromise = null; // in-flight open() shared by concurrent early callers
function idbOpen(){
  if(_idbInstance) return Promise.resolve(_idbInstance);
  // Without this cache, two saves fired back-to-back before the FIRST-EVER open()
  // resolves (e.g. loadState's idbRestore racing an early saveBalances) would each
  // issue their own indexedDB.open() and end up with two separate connection
  // objects to the same DB — their later writes are then only ordered by whichever
  // connection's request callback the browser happens to fire first, not by call
  // order, which can let an older write silently land after a newer one.
  if(_idbOpenPromise) return _idbOpenPromise;
  _idbOpenPromise = new Promise((resolve, reject)=>{
    if(!('indexedDB' in window)){ reject('no idb'); return; }
    const req = indexedDB.open('walletTrackerDB', 1);
    // Guarded so a FUTURE version bump (e.g. to add a second store) doesn't
    // re-run this against a DB that already has 'backup' — an unconditional
    // createObjectStore() throws DOMException on a store that already exists,
    // which aborts the versionchange transaction and permanently breaks IDB
    // for that user on every subsequent open (idbOpen rejects forever, silently
    // downgrading them to the bounded localStorage-only fallback).
    req.onupgradeneeded = () => {
      if(!req.result.objectStoreNames.contains('backup')) req.result.createObjectStore('backup');
    };
    req.onsuccess = () => { _idbInstance = req.result; _idbAvailable = true; resolve(_idbInstance); };
    req.onerror   = () => reject(req.error);
    // Fires when another tab holds the DB at an older version and hasn't closed
    // it — without this the open request hangs indefinitely.
    req.onblocked = () => reject(new Error('idb blocked'));
  }).finally(() => { _idbOpenPromise = null; });
  return _idbOpenPromise;
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
      const store = tx.objectStore('backup');
      const getReq = store.get('snapshot');
      getReq.onsuccess = () => {
        const existing = getReq.result;
        // Two tabs of the same app can each debounce-write within the same ~400ms
        // window; without this, whichever write commits last would blindly overwrite
        // the other tab's already-persisted transactions (each tab only knows its
        // OWN in-memory copy). Union by id against whatever's currently in IDB —
        // same tombstone + newer-editedAt-wins rule as mergeCloudData — so a
        // transaction added in the other tab survives instead of being silently
        // erased. This get+put runs inside one IDB transaction, which browsers
        // serialize against the other tab's own transaction on this store, so the
        // merge sees a consistent snapshot rather than racing the read itself.
        let mergedTx = state.transactions;
        let mergedTombstones = deletedTxIds;
        if(existing && existing.deletedTxIds && typeof existing.deletedTxIds === 'object'){
          mergedTombstones = _unionTombstoneMap(Object.assign({}, deletedTxIds), existing.deletedTxIds);
          deletedTxIds = mergedTombstones;
        }
        // same cross-tab union for the sub / wallet-def tombstone maps
        if(existing){
          _unionTombstoneMap(deletedSubIds, existing.deletedSubIds);
          _unionTombstoneMap(deletedWalletDefIds, existing.deletedWalletDefIds);
        }
        if(existing && Array.isArray(existing.transactions)){
          const byId = new Map();
          state.transactions.forEach(t => { if(t && t.id && !mergedTombstones[t.id]) byId.set(t.id, t); });
          existing.transactions.forEach(t => {
            if(!t || !t.id || mergedTombstones[t.id]) return;
            const local = byId.get(t.id);
            if(!local){ byId.set(t.id, t); return; }
            if(typeof t.editedAt === 'number' && typeof local.editedAt === 'number' && t.editedAt > local.editedAt){
              // Preserve link + tracked-wallet link from local if the IDB snapshot
              // lost them (same stale-snapshot guard as mergeCloudData)
              let winner = local.link && !t.link ? {...t, link: local.link} : t;
              if(local.trackWallet && typeof local.trackSign === 'number' && winner.trackWallet === undefined){
                winner = {...winner, trackWallet: local.trackWallet, trackSign: local.trackSign};
              }
              byId.set(t.id, winner);
            }
          });
          mergedTx = [...byId.values()];
        }
        store.put({
          wallets: state.wallets,
          walletDefs: WALLET_DEFS,
          transactions: mergedTx,
          crisisMode: state.crisisMode,
          autoDistribute, budgets,
          distribution: DISTRIBUTION,
          dismissedRecurring: Array.from(dismissedRecurring),
          deletedTxIds: mergedTombstones,
          deletedSubIds: deletedSubIds,
          deletedWalletDefIds: deletedWalletDefIds,
          subscriptions: subscriptions,
          // mirrored so a wiped localStorage can still recover "Drive was connected"
          // (see loadState) instead of Drive sync silently going dark with no UI cue
          driveClientId: driveClientId,
          savedAt: (typeof savedAt === 'number' && isFinite(savedAt)) ? savedAt : Date.now()
        }, 'snapshot');
      };
      getReq.onerror = () => reject(getReq.error);
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
      // vanish in 2.2s — easy to miss for a data-loss-grade warning. Use
      // toastWithAction: longer-lived (5s), gives a real recovery step, and is
      // visually distinct from a routine success/error toast.
      // Re-arms every few minutes instead of firing once per session — a user
      // stuck in this state keeps losing every subsequent edit, so a one-shot
      // warning would go silent on them after the first toast while the drift
      // (unsaved changes piling up) continues unannounced.
      if(Date.now() - _persistFailWarnedAt > PERSIST_FAIL_REWARN_MS){
        _persistFailWarnedAt = Date.now();
        try{
          toastWithAction(t({ar:'⚠ تعذّر حفظ البيانات على هذا الجهاز — صدّرها الآن قبل إغلاق التطبيق', en:'⚠ Couldn\'t save data on this device — export it now before closing the app'}), t({ar:'تصدير الآن', en:'Export now'}), () => { try{ exportData(); }catch(e){} }, true);
        }catch(__){}
      }
    }
    return false;
  }finally{
    _idbWriteInFlight--;
  }
}
// saveBalances/saveTx/saveConfig/saveSubs/saveWalletDefs each fire idbBackup()
// independently, so a single user action that touches more than one (e.g.
// deleteTx → saveBalances + saveTx + saveConfig) used to write the entire
// transactions array to IndexedDB 2-3x in a row. Debounce into one coalesced
// write — flushed immediately on tab-hide/page-unload (see visibilitychange
// and beforeunload below) so a backgrounded/closed tab never loses the pending
// write entirely.
// app.main.js's cross-tab storage-sync wait derives its own delay from this value
// (plus an explicit margin) — see the comment at that call site for why they must
// stay linked.
const IDB_BACKUP_DEBOUNCE_MS = 400;
let _idbBackupTimer = null;
let _idbBackupPendingTs = 0;
function scheduleIdbBackup(ts){
  _idbBackupPendingTs = (typeof ts === 'number' && isFinite(ts)) ? ts : Date.now();
  clearTimeout(_idbBackupTimer);
  _idbBackupTimer = setTimeout(()=>{ _idbBackupTimer = null; idbBackup(_idbBackupPendingTs); }, IDB_BACKUP_DEBOUNCE_MS);
}
function flushIdbBackup(){
  if(_idbBackupTimer){ clearTimeout(_idbBackupTimer); _idbBackupTimer = null; idbBackup(_idbBackupPendingTs); }
}
// Re-arming cooldown (not a one-shot flag) for the "could not persist" warning
// — see the toastWithAction call above for why a single lifetime-of-session
// warning isn't enough here.
const PERSIST_FAIL_REWARN_MS = 3 * 60 * 1000;
let _persistFailWarnedAt = 0;
let _idbOpenFailed = false; // true when the DB exists but couldn't be opened (blocked/corrupt)
async function idbRestore(){
  try{
    const db = await idbOpen();
    // A successful open clears any earlier failure latch — otherwise a
    // transient open failure (e.g. another tab briefly holding an older DB
    // version during startup) would permanently arm the "data locked out"
    // warning for the rest of the session even after IDB recovers.
    _idbOpenFailed = false;
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

