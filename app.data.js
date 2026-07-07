/* ============================================================
   SETTINGS / DATA MANAGEMENT
   Split out of app.logic.js. Export/import, the granular reset & repair
   tools (zero/clear/wipe/repair-balances), and the distribution/budget
   sanitizers used when ingesting an import or a Drive snapshot.
   Loaded AFTER app.ui.js and BEFORE app.main.js. Calls saveBalances/saveTx
   (app.core.js), render (app.main.js) and openModal (app.overlay.js) at
   runtime only.
============================================================ */
// Drop any distribution entries whose wallet id no longer exists (e.g. from an
// imported/cloud backup). Falls back to defaults if nothing valid remains.
// The fallback is filtered against live WALLET_DEFS too — a factory wallet the
// user deleted (e.g. 'reserve') must not sneak back in as an orphaned share.
function _defaultDistributionForCurrentWallets(){
  return DEFAULT_DISTRIBUTION.filter(d => WALLET_DEFS.find(w => w.id === d.id && !w.track)).map(d=>({...d}));
}
function sanitizeDistribution(arr){
  if(!Array.isArray(arr)) return _defaultDistributionForCurrentWallets();
  const cleaned = arr
    .filter(d => d && WALLET_DEFS.find(w=>w.id===d.id && !w.track))
    .map(d => ({...d, pct: Math.min(100, Math.max(0, isFinite(d.pct) ? d.pct : 0))}));
  return cleaned.length ? cleaned : _defaultDistributionForCurrentWallets();
}
function sanitizeBudgets(obj){
  const out = {};
  if(obj && typeof obj === 'object'){
    WALLET_DEFS.forEach(w => {
      const v = parseFloat(obj[w.id]);
      if(isFinite(v) && v > 0 && v <= MAX_AMOUNT) out[w.id] = round2(v);
    });
  }
  return out;
}
function exportData(){
  const payload = {
    // Schema marker — no import-time migration logic reads this YET, but a
    // future schema change needs SOME way to tell an old-format backup from a
    // new one besides ad hoc key-presence guessing. Bump only on an actual
    // breaking shape change, not every release.
    backupSchema: 1,
    // shared with driveSyncToCloud (app.drive.js) — see _buildSyncPayload (app.core.js)
    ..._buildSyncPayload(),
    // export-only extras: carry theme/accent/lang so a restore on another device
    // keeps the user's chosen appearance. theme is the MODE ('light'/'dark'/
    // 'auto'), not the resolved color — otherwise a user on 'auto' would have
    // today's resolved color baked in and frozen on every other device that
    // restores this backup, instead of each device following its own system.
    // Drive sync never carries these — each device keeps its own appearance/
    // language/draft, so they're added here rather than in the shared builder.
    theme: _currentThemeMode(),
    // Which of dark/black the THEME MODE resolves to while in 'auto' or 'dark'
    // mode — a SEPARATE localStorage key from theme itself. Without exporting
    // it, a user who picked matte-black explicitly then switched to 'auto'
    // (theme='auto', darkVariant='black' still set locally) would have it
    // silently reset to plain dark on a restore, since setThemeMode('auto')
    // never touches darkVariant.
    darkVariant: _darkVariant(),
    accent: _currentAccent('day'),
    accentDark: _currentAccent('night'),
    lang: _currentLang(),
    // the quick-notes draft is UNENTERED transactions (its lines become txs
    // later) — losing it on a device migration is real data loss, so it must
    // survive the backup roundtrip like everything else.
    quickNotes: _quickNotesDraft
  };
  const json = JSON.stringify(payload, null, 2);
  // Only mirror small payloads into the <textarea> — dumping multi-MB JSON into it
  // freezes the main thread on layout (mirrors the same guard in importFromFile).
  // The download below still contains the full data regardless.
  const _jsonArea = document.getElementById('jsonArea');
  if(_jsonArea) _jsonArea.value = json.length <= 256 * 1024
    ? json
    : t({ar:'/* البيانات كبيرة جدًا للمعاينة — نُزّلت كملف مباشرةً */', en:'/* Data too large to preview — downloaded directly as a file */'});

  const blob = new Blob([json], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // date AND time in the name: two exports on the same day used to produce
  // byte-identical filenames — desktop browsers auto-suffix "(1)", but mobile
  // save flows (e.g. iOS "Save to Files") may silently overwrite, and even
  // suffixed copies give no way to tell which backup is newer without opening
  // each one.
  const _now = new Date();
  const _hm = String(_now.getHours()).padStart(2,'0') + '-' + String(_now.getMinutes()).padStart(2,'0');
  a.download = 'wallet-backup-' + todayISO() + '_' + _hm + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(t({ar:'✓ تم تجهيز ملف التصدير', en:'✓ Export file ready'}));
}

function importFromFile(event){
  const file = event.target.files[0];
  if(!file) return;
  // a real export is tiny JSON — reject oversized/binary files before reading
  if(file.size > 10 * 1024 * 1024){
    toast(t({ar:'⚠ الملف كبير جدًا — اختر ملف نسخة احتياطية صالح', en:'⚠ File too large — choose a valid backup file'}), true);
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const result = e.target.result;
    // Only mirror small payloads into the <textarea> — dumping multi-MB JSON
    // into it freezes the main thread while the browser lays out the text.
    const jsonArea = document.getElementById('jsonArea');
    if(jsonArea) jsonArea.value = (typeof result === 'string' && result.length <= 256 * 1024)
      ? result : t({ar:'/* تم تحميل ملف كبير — يُستورَد مباشرةً دون معاينة */', en:'/* Large file loaded — imported directly without preview */'});
    applyImport(result);
  };
  reader.onerror = () => toast(t({ar:'⚠ تعذّر قراءة الملف', en:'⚠ Could not read the file'}), true);
  reader.readAsText(file);
  event.target.value = ''; // allow re-selecting the same file later
}

function importFromTextarea(){
  const txt = document.getElementById('jsonArea').value.trim();
  if(!txt){ toast(t({ar:'⚠ الصق بيانات JSON أولاً', en:'⚠ Paste JSON data first'}), true); return; }
  // same 10MB ceiling importFromFile enforces before reading — without it this
  // was the one import path where an absurdly large payload went straight into
  // a synchronous JSON.parse (impractical to paste by hand, but the two entry
  // points should hold the same line)
  if(txt.length > 10 * 1024 * 1024){
    toast(t({ar:'⚠ البيانات كبيرة جدًا (الحد 10MB)', en:'⚠ Data too large (10MB limit)'}), true);
    return;
  }
  applyImport(txt);
}

function stripOrphanLinks(txList){
  const counts = {};
  txList.forEach(tx => { if(tx.link) counts[tx.link] = (counts[tx.link]||0) + 1; });
  txList.forEach(tx => { if(tx.link && counts[tx.link] < 2) delete tx.link; });
}

// Remove distribution legs (withdrawal + deposits) whose income source is missing.
// This happens when a sync/merge strips the source tx's `link` property — deleteTx
// then removes only the source, leaving the withdrawal+deposits to inflate/deflate
// balances permanently.  Returns the array of removed transactions (caller must
// reverse-apply them via applyTxToBalance).
function stripOrphanedDistributionLegs(txList){
  // For each link group: track whether a non-leg income source exists,
  // and whether any leg is explicitly marked _distributionLeg.
  const sourceLinks = new Set();
  const linkInfo = {};
  txList.forEach(t => {
    if(!t.link) return;
    if(!linkInfo[t.link]) linkInfo[t.link] = {exp:0, inc:0, marked:false, hasSource:false};
    if(t._distributionLeg || t.category === 'transfer'){
      if(t.type === 'expense') linkInfo[t.link].exp++;
      else linkInfo[t.link].inc++;
      if(t._distributionLeg) linkInfo[t.link].marked = true;
    } else {
      // non-transfer/non-leg tx with a link = the income source itself
      linkInfo[t.link].hasSource = true;
      sourceLinks.add(t.link);
    }
  });
  const orphanLinks = new Set();
  Object.keys(linkInfo).forEach(link => {
    if(sourceLinks.has(link)) return; // source present — group is intact
    const info = linkInfo[link];
    if(info.marked){
      // explicitly tagged distribution leg with no source → definitely orphaned
      orphanLinks.add(link);
    } else if(info.exp > 0 && (info.inc === 0 || info.inc >= 2)){
      // heuristic for old data: withdrawal-only OR withdrawal + ≥2 deposits
      // (1 exp + 1 inc could be a regular two-leg transfer — leave it alone)
      orphanLinks.add(link);
    }
  });
  if(!orphanLinks.size) return [];
  const removed = [];
  for(let i = txList.length - 1; i >= 0; i--){
    const t = txList[i];
    if(t.link && orphanLinks.has(t.link)){
      txList.splice(i, 1);
      removed.push(t);
    }
  }
  return removed;
}

let _importBusy = false;
async function applyImport(text){
  // Same cross-operation guard every money writer has — an import beginning
  // while addTx/commitQuickNotes is parked on an await would wholesale-replace
  // the state that operation is about to write back. The busy flag also stops
  // a double-tap of the import button from running two overlapping imports
  // (each confirm() blocks, but the second resumes during the first's awaits).
  if(_importBusy) return;
  if(_opBusy()) return;
  let data;
  try{ data = JSON.parse(text); }
  catch(e){ toast(t({ar:'⚠ تنسيق JSON غير صالح', en:'⚠ Invalid JSON format'}), true); return; }

  if(!data || typeof data !== 'object' || !data.wallets || !Array.isArray(data.transactions)){
    toast(t({ar:'⚠ ملف غير صحيح — لا يحتوي على wallets أو transactions', en:'⚠ Invalid file — missing wallets or transactions'}), true); return;
  }
  if(!confirm(t({ar:'سيتم استبدال كل البيانات الحالية. متابعة؟', en:'This will replace all current data. Continue?'}))) return;
  // Same "wholesale replace with a single tap and no recovery path" gap the
  // Drive-conflict flow had — a wrong/old backup file picked by mistake used
  // to permanently discard whatever was on the device with nothing to undo.
  // Download a backup of the CURRENT data (plus what's about to replace it)
  // before proceeding, mirroring _downloadDataBackup's other call site.
  _downloadDataBackup(_buildSyncPayload(), data, 'wallet-pre-import-backup');
  _importBusy = true;
  _txMutationStamp++; // wholesale data replacement — invalidate derived caches
  _opInFlight++; // block the cross-tab storage reload mid-import, same as other wholesale replacements
  // Full rollback snapshot of every module-level variable this function is
  // about to mutate. Without this, a throw partway through (e.g. a backup
  // from a much older/newer app version whose shape trips something this
  // code doesn't defend against) left `state` and friends half-overwritten
  // with import data IN MEMORY — never persisted by this function (the
  // save*() calls only run at the very end, after everything else
  // succeeds), but a subsequent action before the next reload (e.g. adding
  // a transaction) would save on top of that corruption and make it
  // durable. The catch block below restores every one of these to undo
  // exactly that.
  const _rollback = {
    wallets: {...state.wallets},
    transactions: state.transactions,
    crisisMode: state.crisisMode,
    walletDefs: WALLET_DEFS.map(w => ({...w})),
    budgets: {...budgets},
    autoDistribute,
    distribution: DISTRIBUTION.map(d => ({...d})),
    dismissedRecurring: new Set(dismissedRecurring),
    deletedTxIds: {...deletedTxIds},
    deletedSubIds: {...deletedSubIds},
    deletedWalletDefIds: {...deletedWalletDefIds},
    subscriptions: subscriptions.map(s => ({...s})),
  };
  try{

  // Snapshot what exists BEFORE the import so anything absent from the backup
  // can be tombstoned afterwards — without that, "replace all current data" is
  // a lie whenever Drive is connected: the next push re-pulls the old cloud
  // copy and union-merges every rolled-away transaction right back in.
  const _preImportTxIds = state.transactions.map(t => t && t.id).filter(Boolean);
  const _preImportSubIds = subscriptions.map(s => s && s.id).filter(Boolean);

  // wallet defs are part of the same wholesale snapshot — replace BEFORE the
  // wallets/transactions validation below, since both reference WALLET_DEFS
  // by id (a custom wallet from the backup would otherwise look "unknown").
  // Shared with adoptCloudSnapshot (app.drive.js) — see _ingestWalletDefs.
  _ingestWalletDefs(data);
  // a backup is a complete snapshot — clear all balances first so wallets that
  // are omitted from the imported file don't keep stale values that would
  // mismatch the freshly-replaced transaction list. Shared with
  // adoptCloudSnapshot — see _ingestWalletBalances.
  _ingestWalletBalances(data);
  let _droppedTx = 0;
  if(data.transactions){
    const incoming = Array.isArray(data.transactions) ? data.transactions : [];
    // Bound the import so a corrupt/huge file can't freeze the main thread on the
    // filter+map below (and the subsequent JSON.stringify in saveTx). 100k covers
    // any realistic personal-finance history with large headroom.
    const MAX_IMPORT_TX = 100000;
    if(incoming.length > MAX_IMPORT_TX){
      toast(t({ar:`⚠ الملف يحتوي على أكثر من ${MAX_IMPORT_TX} معاملة — سيُستورَد أول ${MAX_IMPORT_TX} فقط`, en:`⚠ File has over ${MAX_IMPORT_TX} transactions — only the first ${MAX_IMPORT_TX} will be imported`}), true);
      incoming.length = MAX_IMPORT_TX;
    }
    // dedup by id last (only after every other check passes) so a duplicate
    // doesn't get "claimed" by a malformed copy that's filtered out anyway —
    // otherwise a later, valid copy of the same id would be wrongly dropped
    const seenIds = new Set();
    // isValidTx is the shared well-formedness rule (app.core.js) — import adds
    // only the duplicate-id guard on top, plus the clamping in the map below.
    state.transactions = incoming.filter(tx =>
      isValidTx(tx) &&
      !seenIds.has(tx.id) && seenIds.add(tx.id)
    ).map(tx => ({
      ...tx,
      // clamp to [MIN_TX_TS, now] — every direct-entry path enforces this
      // (buildTxTs/saveEdit), but a backup from a fast-clock device or a
      // hand-edited file isn't bound by it. A future ts pins above everything
      // and corrupts the "this month" filters and totals.
      ts: Math.max(MIN_TX_TS, Math.min(tx.ts, Date.now())),
      category: normalizeCategory(tx.category),
      // addTx() caps manual entry to 120 chars (see app.logic.js) — a crafted or
      // corrupt backup file isn't bound by that input-side limit, and an unbounded
      // desc string would slip past escHtml() (it sanitizes, doesn't shorten) and
      // bloat every list render that includes this transaction.
      desc: typeof tx.desc === 'string' ? truncateCodePoints(tx.desc, 120) : tx.desc,
      // every other entry point (addTx, transfers) rounds to cents before storing —
      // a hand-edited or legacy backup file isn't bound by that, so an unrounded
      // amount would otherwise persist forever and re-export on every future backup
      amount: round2(tx.amount)
    }));
    _droppedTx = incoming.length - state.transactions.length;
    // Clean up orphaned trackWallet refs — a wallet deleted on another device may
    // still be referenced if the backup predates that deletion. Leaving them causes
    // applyTxToBalance to silently skip the secondary effect on an unknown wallet.
    const _validTrackIds = new Set(WALLET_DEFS.filter(w => w.track).map(w => w.id));
    state.transactions.forEach(tx => {
      if(tx.trackWallet && !_validTrackIds.has(tx.trackWallet)){
        delete tx.trackWallet; delete tx.trackSign;
      }
    });
  }

  // Strip orphaned link IDs — if only one leg of a linked transfer/distribution
  // group survived the import filter, its link field is dangling; unset it so
  // a future delete of that transaction doesn't cascade to nothing and leave
  // the balance adjustment unapplied.
  stripOrphanLinks(state.transactions);
  {
    const _now = Date.now();
    stripOrphanedDistributionLegs(state.transactions).forEach(t => { deletedTxIds[t.id] = _now; });
  }
  // Orphan-stripping may have removed transactions that the backup's stored balances
  // still included — recompute from the surviving transaction list to stay consistent.
  reconcileBalances();
  if(typeof data.crisisMode === 'boolean') state.crisisMode = data.crisisMode;
  if(data.budgets && typeof data.budgets === 'object') budgets = sanitizeBudgets(data.budgets);
  if(typeof data.autoDistribute === 'boolean') autoDistribute = data.autoDistribute;
  if(data.distribution && Array.isArray(data.distribution)) DISTRIBUTION = sanitizeDistribution(data.distribution);
  _ensureReserveShare();
  if(Array.isArray(data.dismissedRecurring)) dismissedRecurring = new Set(data.dismissedRecurring.filter(k => typeof k === 'string' && k));
  if(data.deletedTxIds && typeof data.deletedTxIds === 'object' && !Array.isArray(data.deletedTxIds)){
    deletedTxIds = {};
    for(const id in data.deletedTxIds){
      const t = data.deletedTxIds[id];
      if(typeof t === 'number' && isFinite(t) && t > 0) deletedTxIds[id] = t;
    }
    // Apply tombstones to the just-imported set immediately (loadState does this on
    // reload, but applyImport renders before any reload) so a hand-edited file that
    // carries both a transaction AND its tombstone can't show the "deleted" tx until
    // the next launch.
    if(Object.keys(deletedTxIds).length){
      state.transactions = state.transactions.filter(t => !deletedTxIds[t.id]);
    }
  }
  if(Array.isArray(data.subscriptions)){
    subscriptions = data.subscriptions.filter(x => x && x.id && x.name && isFinite(x.amount) && x.amount > 0).map(_normalizeSub);
  }
  // roundtrip the sub/wallet-def tombstone maps carried by newer backups
  _unionTombstoneMap(deletedSubIds, data.deletedSubIds);
  _unionTombstoneMap(deletedWalletDefIds, data.deletedWalletDefIds);
  // Tombstone everything that existed before the import and is absent from the
  // backup — this is what makes "استبدال كل البيانات الحالية" hold up against
  // the Drive union-merge (see the pre-import snapshot at the top).
  {
    const _now = Date.now();
    const _importedTxIds = new Set(state.transactions.map(t => t.id));
    _preImportTxIds.forEach(id => { if(!_importedTxIds.has(id)) deletedTxIds[id] = _now; });
    const _importedSubIds = new Set(subscriptions.map(s => s.id));
    _preImportSubIds.forEach(id => { if(!_importedSubIds.has(id)) deletedSubIds[id] = _now; });
    pruneTombstones();
  }
  if(data.uiPrefs) applyUiPrefs(data.uiPrefs);
  // clear any in-flight selection/edit pointers that now reference replaced/deleted txs
  editingTxId = null;
  pendingIncomeTx = null;
  detailWalletId = null;
  // restore appearance + data-edit time if the backup carried them (lossless round-trip)
  // Restore BEFORE setThemeMode below, so if theme is 'auto'/'dark' it
  // immediately resolves using the just-restored variant instead of whatever
  // this device's own prior (or default) darkVariant happened to be.
  if(data.darkVariant === 'dark' || data.darkVariant === 'black'){
    try{ localStorage.setItem(LS_PREFIX + 'darkVariant', data.darkVariant); }catch(_){ }
  }
  if(data.theme === 'light' || data.theme === 'dark' || data.theme === 'black' || data.theme === 'auto'){
    try{ setThemeMode(data.theme); }catch(_){ }
  }
  // per-mode accents (day = 'accent', night = 'accentDark'). Older backups carry
  // only 'accent' (single) — that restores into the day bucket, which is fine.
  try{
    const _setAcc = (val, key) => {
      if(typeof val !== 'string') return;
      if(val === 'gold') localStorage.removeItem(key);
      else if(_ACCENT_IDS.indexOf(val) > -1) localStorage.setItem(key, val);
    };
    _setAcc(data.accent, LS_PREFIX + 'accent');
    _setAcc(data.accentDark, LS_PREFIX + 'accentDark');
    applyAccent();
    _updateAccentUI(_currentAccent());
  }catch(_){ }
  if(data.lang === 'ar' || data.lang === 'en'){
    try{ setLang(data.lang); }catch(_){ }
  }
  // restore the quick-notes draft (only when the backup carries a non-empty one —
  // don't blank a local draft because an older backup predates the field)
  if(typeof data.quickNotes === 'string' && data.quickNotes.trim()){
    _quickNotesDraft = data.quickNotes;
    saveQuickNotesDraft();
    updateQuickNotesBadge();
  }
  try{ localStorage.setItem(LS_PREFIX + 'dataEdit', String(Date.now())); }catch(_){ }
  prevSpendable = null; // reset animation baseline after full data replacement

  await saveBalances();
  await saveTx();
  await saveConfig();
  await saveSubs();
  await saveWalletDefs();
  closeModal('settingsModal'); // import/export now lives inside the settings data tab
  render(true);
  if(_droppedTx > 0){
    toast(t({ar:`✓ تم الاستيراد — لكن تم تجاهل ${arPlural(_droppedTx, 'معاملة غير صالحة', 'معاملتين غير صالحتين', 'معاملات غير صالحة', 'معاملة واحدة غير صالحة')} (محفظة مجهولة أو بيانات تالفة)`, en:`✓ Import complete — but ${_droppedTx} invalid ${_droppedTx===1?'transaction was':'transactions were'} skipped (unknown wallet or corrupt data)`}), true);
  } else {
    toast(t({ar:'✓ تم الاستيراد بنجاح', en:'✓ Import successful'}));
  }
  } catch(err){
    // Restore every mutated variable to its pre-import snapshot — nothing was
    // persisted yet (the save*() calls above only run once every step
    // succeeds), so this fully undoes the in-memory corruption instead of
    // leaving it for a later save to make permanent.
    state.wallets = _rollback.wallets;
    state.transactions = _rollback.transactions;
    state.crisisMode = _rollback.crisisMode;
    applyWalletDefs(_rollback.walletDefs);
    budgets = _rollback.budgets;
    autoDistribute = _rollback.autoDistribute;
    DISTRIBUTION = _rollback.distribution;
    dismissedRecurring = _rollback.dismissedRecurring;
    deletedTxIds = _rollback.deletedTxIds;
    deletedSubIds = _rollback.deletedSubIds;
    deletedWalletDefIds = _rollback.deletedWalletDefIds;
    subscriptions = _rollback.subscriptions;
    _txMutationStamp++;
    _runTxCommitInvalidators();
    render(true);
    console.error('applyImport failed, rolled back:', err);
    toast(t({ar:'⚠ فشل الاستيراد ولم يتغيّر شيء — الملف قد يكون تالفًا أو من إصدار غير متوافق', en:'⚠ Import failed and nothing changed — the file may be corrupted or from an incompatible version'}), true);
  } finally {
    _opInFlight--;
    _importBusy = false;
  }
}

// ── Granular reset/clear actions (Deletion & Reset section) ──────────────
// Each does exactly what its label says.
//
// BUG FIX (both functions below): they used to set state.wallets[id] = 0
// directly, bypassing the ledger entirely. That "zero" was purely a snapshot
// value with nothing backing it — and the very next Drive sync would silently
// undo it:
//   - Regular wallets are DERIVED (balance = 0 + Σledger). reconcileBalances()
//     runs unconditionally at the end of every mergeCloudData() call — even
//     when the pre-push reconciliation decides local should win (cloudNewer
//     = false) — and recomputes the balance from the UNCHANGED ledger,
//     resurrecting the exact pre-zero total within ~1.5s of tapping the
//     button (confirmed via direct reproduction: a bare balance zero with no
//     ledger change is undone by the very next mergeCloudData call).
//   - Tracked wallets aren't ledger-derived, but a raw state.wallets write is
//     still just an in-memory snapshot with no representation in the synced
//     transaction stream — it doesn't participate in the tombstone/
//     editedAt-wins merge machinery every other durable change goes through,
//     so it's vulnerable to being clobbered by any path that touches
//     state.wallets wholesale (e.g. a stale snapshot adopted after a
//     reconnect) with nothing to make the zero "win".
// Fix: write a real offsetting ADJUSTMENT TRANSACTION per wallet (the exact
// mechanism updateTrackedBalance() already uses for a single tracked-wallet
// sync) instead of a bare balance write. That makes the zero part of the
// ledger itself: reconcileBalances() computes 0 naturally for regular
// wallets because the ledger sum really is 0, and for both wallet kinds the
// zero now syncs through the same robust per-transaction tombstone/merge
// path as every other change instead of riding along as an unbacked number.
async function zeroTrackedWallets(){
  if(!confirm(t({ar:'سيتم تصفير أرصدة محافظ التتبع (أوبر، البطاقات، الكاش) إلى صفر.\n\nالمعاملات لا تتأثر. هل تريد المتابعة؟', en:'This will reset tracking wallet balances (Uber, cards, cash) to zero.\n\nTransactions are not affected. Continue?'}))) return;
  if(_opBusy()) return;
  _txMutationStamp++;
  _opInFlight++;
  try{
    _zeroWalletsByLedgerAdjustment(w => w.track);
    prevSpendable = null;
    await saveBalances();
    await saveTx();
    render(true);
    toast(t({ar:'✓ تم تصفير محافظ التتبع', en:'✓ Tracking wallets reset'}));
  } finally { _opInFlight--; }
}

// Zero the regular (non-tracked) wallets. Unlike the old behavior, this no
// longer diverges from the ledger — see the fix note above — so the "won't
// match your transaction history" warning that used to apply here doesn't
// anymore; each affected wallet's zero is now itself a ledger entry.
async function zeroRegularWallets(){
  if(!confirm(t({ar:'سيتم تصفير أرصدة المحافظ العادية إلى صفر (بتسجيل معاملة تسوية لكل محفظة). سجل معاملاتك السابق يبقى كما هو.\n\nهل تريد المتابعة؟', en:"This will reset regular wallet balances to zero (by recording one adjustment transaction per wallet). Your past transaction history stays intact.\n\nContinue?"}))) return;
  if(_opBusy()) return;
  _txMutationStamp++;
  _opInFlight++;
  try{
    _zeroWalletsByLedgerAdjustment(w => !w.track);
    prevSpendable = null;
    await saveBalances();
    await saveTx();
    render(true);
    toast(t({ar:'✓ تم تصفير المحافظ العادية', en:'✓ Regular wallets reset'}));
  } finally { _opInFlight--; }
}

// Shared helper: for every wallet matching `pred` with a non-zero balance,
// insert one offsetting adjustment transaction (same shape/category as
// updateTrackedBalance's single-wallet sync) and apply it via
// applyTxToBalance — the durable, sync-safe way to bring a balance to zero.
function _zeroWalletsByLedgerAdjustment(pred){
  const now = Date.now();
  WALLET_DEFS.forEach((w, i) => {
    if(!pred(w)) return;
    const current = round2(state.wallets[w.id] ?? 0);
    if(current === 0) return; // nothing to offset — don't clutter the ledger
    const tx = {
      // stagger timestamps by 1ms per wallet so a batch of resets sorts and
      // syncs deterministically instead of colliding on one instant
      id: 'tx_' + now + '_z' + i + Math.random().toString(36).slice(2,4),
      wallet: w.id,
      desc: t({ar:'تصفير الرصيد', en:'Balance reset'}),
      amount: Math.abs(current),
      type: current > 0 ? 'expense' : 'income',
      category: 'adjustment', // excluded from pie chart, recurring detection, analytics
      ts: now + i,
    };
    state.transactions.push(tx);
    applyTxToBalance(tx, +1);
  });
}

// Remove every subscription. Balances and transactions are untouched.
async function clearAllSubscriptions(){
  if(!subscriptions.length){ toast(t({ar:'لا توجد اشتراكات للحذف', en:'No subscriptions to delete'})); return; }
  if(!confirm(t({ar:`سيتم حذف جميع الاشتراكات (${subscriptions.length}). لا يمكن التراجع.\n\nهل تريد المتابعة؟`, en:`This will delete all subscriptions (${subscriptions.length}). This cannot be undone.\n\nContinue?`}))) return;
  if(_opBusy()) return;
  _opInFlight++;
  try{
    // tombstone each so the wipe propagates through merge sync (see deleteSubModal)
    const _now = Date.now();
    subscriptions.forEach(s => { if(s && s.id) deletedSubIds[s.id] = _now; });
    subscriptions = [];
    await saveSubs();
    await saveConfig(); // tombstones live in config
    render(true);
    toast(t({ar:'✓ تم حذف كل الاشتراكات', en:'✓ All subscriptions deleted'}));
  } finally { _opInFlight--; }
}

// Zero all balances AND clear the whole transaction ledger — a consistent fresh
// start that keeps subscriptions, distribution and layout. Transactions are
// tombstoned so the deletion propagates on multi-device merge sync (otherwise a
// cloud copy would resurrect them on the next merge).
async function clearBalancesAndTx(){
  const _resetWord = t({ar:'تصفير', en:'RESET'});
  const answer = prompt(t({
    ar: `⚠️ سيتم تصفير كل الأرصدة وحذف كل المعاملات نهائياً.\nالاشتراكات والإعدادات تبقى كما هي.\n\nاكتب كلمة "${_resetWord}" للتأكيد:`,
    en: `⚠️ This will reset all balances and permanently delete all transactions.\nSubscriptions and settings stay as they are.\n\nType "${_resetWord}" to confirm:`,
  }));
  if(answer === null) return;
  if(answer.trim() !== _resetWord){ toast(t({ar:'أُلغي — لم تُكتب كلمة التأكيد بشكل صحيح', en:'Cancelled — confirmation word was not typed correctly'})); return; }
  if(_opBusy()) return;
  _txMutationStamp++;
  _opInFlight++;
  try{
    clearTimeout(_undoTimer); _lastDeleted = null;
    const now = Date.now();
    state.transactions.forEach(t => { if(t && t.id) deletedTxIds[t.id] = now; });
    pruneTombstones(); // trim expired entries after bulk addition to stay under quota
    state.transactions = [];
    WALLET_DEFS.forEach(w => state.wallets[w.id] = 0);
    state.crisisMode = false;
    walletFilter = null;
    categoryFilter = null;
    _txVisibleCount = 50;
    prevSpendable = null;
    // clear any in-flight selection/edit pointers that now reference deleted txs
    editingTxId = null;
    pendingIncomeTx = null;
    detailWalletId = null;
    await saveBalances();
    await saveTx();
    await saveConfig(); // persist tombstones (they live in config)
    closeModal('settingsModal');
    render(true);
    toast(t({ar:'✓ تم تصفير الرصيد والمعاملات', en:'✓ Balance and transactions reset'}));
  } finally { _opInFlight--; }
}

// Self-healing repair: recompute balances from the transaction ledger (0 + Σ).
// Shows the detected drift first so the user knows exactly what will change.
async function repairBalancesFromLedger(){
  // was missing _opInFlight protection entirely, despite mutating both
  // state.transactions (orphan-leg strip) and state.wallets across two awaits
  if(_opBusy()) return;
  _opInFlight++;
  try{
  // Remove any orphaned distribution legs before computing the expected balances,
  // otherwise the dry-run will conclude "already correct" despite the bad state.
  {
    const _now = Date.now();
    const _orphans = stripOrphanedDistributionLegs(state.transactions);
    if(_orphans.length){
      _orphans.forEach(t => { applyTxToBalance(t, -1); deletedTxIds[t.id] = _now; });
      await saveBalances();
      await saveTx();
    }
  }
  // dry run on a snapshot to preview the diff without committing
  const before = {};
  WALLET_DEFS.forEach(w => before[w.id] = parseFloat(state.wallets[w.id]) || 0);
  const diff = reconcileBalances();
  const keys = Object.keys(diff);
  if(!keys.length){
    // nothing changed — restore (reconcile already set identical values) and inform
    toast(t({ar:'✓ الأرصدة مطابقة لسجل المعاملات — لا حاجة للإصلاح', en:'✓ Balances match the transaction ledger — no fix needed'}));
    render(true);
    return;
  }
  // build a human-readable summary, then confirm before persisting
  const lines = keys.map(id => {
    const w = WALLET_DEFS.find(x => x.id === id);
    const d = diff[id];
    return `• ${w ? w.name : id}: ${d > 0 ? '+' : ''}${fmt(d)}`;
  }).join('\n');
  // revert to pre-reconcile values so cancelling leaves nothing changed
  WALLET_DEFS.forEach(w => state.wallets[w.id] = before[w.id]);
  if(!confirm(t({ar:`🔧 سيُعاد حساب الأرصدة من سجل معاملاتك (صفر + مجموع المعاملات).\n\nالفروقات المكتشفة:\n${lines}\n\nتطبيق الإصلاح؟`, en:`🔧 Balances will be recalculated from your transaction ledger (zero + sum of transactions).\n\nDifferences found:\n${lines}\n\nApply the fix?`}))){
    render(true);
    return;
  }
  reconcileBalances(); // apply for real
  await saveBalances();
  closeModal('settingsModal');
  render(true);
  toast(t({ar:'🔧 تم إصلاح الأرصدة من السجل', en:'🔧 Balances fixed from the ledger'}));
  } finally { _opInFlight--; }
}

// Lightweight, non-mutating drift check restricted to ledger-derived wallets (excludes
// "track" wallets, whose balance is intentionally maintained manually and can
// legitimately diverge from logged transactions — e.g. real-world fees/interest never
// entered as a transaction). Run once at launch to catch the rare case where a
// crash/force-close committed a balance write but not the matching transaction write
// (or vice versa), offering a one-tap link to the existing manual repair tool instead
// of nagging on every launch for a drift the user already saw.
function checkBalanceDrift(){
  const computed = {};
  WALLET_DEFS.forEach(w => { if(!w.track) computed[w.id] = 0; });
  state.transactions.forEach(tx => {
    if(computed[tx.wallet] === undefined) return;
    const amt = parseFloat(tx.amount);
    if(!isFinite(amt)) return;
    // round2 (not Math.round*100/100) so this matches reconcileBalances/repair
    // exactly — otherwise a .5-edge value could flag a phantom drift the repair
    // tool then "fixes" to no visible effect, re-nagging the user.
    computed[tx.wallet] = round2(computed[tx.wallet] + (tx.type === 'expense' ? -amt : amt));
  });
  let totalDrift = 0;
  Object.keys(computed).forEach(id => {
    const before = parseFloat(state.wallets[id]) || 0;
    if(Math.abs(computed[id] - before) >= 0.01) totalDrift = round2(totalDrift + Math.abs(computed[id] - before));
  });
  if(totalDrift === 0) return;
  const sig = String(totalDrift);
  try{ if(localStorage.getItem(LS_PREFIX + 'driftNotified') === sig) return; }catch(e){} // already offered for this exact drift
  try{ localStorage.setItem(LS_PREFIX + 'driftNotified', sig); }catch(e){}
  toastWithAction(t({ar:'⚠ رصيد إحدى محافظك لا يطابق سجل معاملاتها', en:"⚠ One of your wallets' balance doesn't match its transaction ledger"}), t({ar:'إصلاح', en:'Fix'}), () => { openSettingsTab('data'); repairBalancesFromLedger(); });
}

async function wipeAll(){
  // Typed-word confirmation instead of two consecutive confirm() dialogs — on
  // mobile a fast double-tap could dismiss both confirms and wipe data by
  // accident. Requiring the user to type the confirmation word makes it a deliberate action.
  const _deleteWord = t({ar:'حذف', en:'DELETE'});
  // When Drive sync is set up the wipe propagates: tombstones push to Drive and
  // every other synced device deletes too. Users read this as "reset THIS phone"
  // unless told otherwise — say it explicitly in the confirmation.
  const _driveWarn = (typeof driveAccessToken !== 'undefined' && (driveAccessToken || driveClientId))
    ? t({ar:'\nسيشمل الحذف نسخة Google Drive وكل الأجهزة المتزامنة أيضاً.', en:'\nThis also deletes the Google Drive copy and applies to every synced device.'})
    : '';
  const answer = prompt(t({
    ar: `⚠️ سيتم حذف جميع الأرصدة والمعاملات نهائياً ولا يمكن التراجع.${_driveWarn}\n\nاكتب كلمة "${_deleteWord}" للتأكيد:`,
    en: `⚠️ This will permanently delete all balances and transactions. This cannot be undone.${_driveWarn}\n\nType "${_deleteWord}" to confirm:`,
  }));
  if(answer === null) return; // cancelled
  if(answer.trim() !== _deleteWord){ toast(t({ar:'أُلغي الحذف — لم تُكتب كلمة التأكيد بشكل صحيح', en:'Deletion cancelled — confirmation word was not typed correctly'})); return; }
  if(_opBusy()) return;
  // The typed-word confirmation above already defeats reflex double-taps, but
  // this is still the single most destructive action in the app — download a
  // backup of everything before it's gone, same safety net as the Drive-conflict
  // and import-overwrite flows.
  _downloadDataBackup(_buildSyncPayload(), null, 'wallet-pre-wipe-backup');
  _txMutationStamp++; // wholesale wipe — invalidate derived caches
  _opInFlight++; // block the cross-tab storage reload mid-wipe across the multi-await sequence below
  try{
  clearTimeout(_undoTimer); _lastDeleted = null;
  // Tombstone every existing transaction BEFORE clearing the array, so the
  // deletion propagates on the next merge sync. Clearing tombstones outright
  // (the old behaviour) let a cloud/other-device copy resurrect everything.
  const _wipeNow = Date.now();
  state.transactions.forEach(t => { if(t && t.id) deletedTxIds[t.id] = _wipeNow; });
  subscriptions.forEach(s => { if(s && s.id) deletedSubIds[s.id] = _wipeNow; }); // subs are wiped below — propagate that too
  pruneTombstones(); // trim expired entries so the bulk addition doesn't push config over quota
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
  selectedTrackWallet = null; // a leftover pick would otherwise survive a "fresh start" wipe
  trackLinkMode = {};
  prevSpendable = null;
  walletFilter = null;
  categoryFilter = null;
  searchQuery = '';
  _txVisibleCount = 50;
  currentFilter = 'all';
  // filter against live WALLET_DEFS — a factory wallet the user deleted (e.g.
  // 'reserve') must not come back as an orphaned share pointing at nothing
  DISTRIBUTION = DEFAULT_DISTRIBUTION.filter(d => WALLET_DEFS.find(w => w.id === d.id && !w.track)).map(d=>({...d}));
  // DEFAULT_DISTRIBUTION only lists the factory wallets — keep any custom regular
  // wallets (which survive a wipe) represented, else they'd silently drop out of
  // the distribution editor and never receive an auto-distribute share.
  const _wipeExtraDist = WALLET_DEFS.filter(w => !w.track && !DISTRIBUTION.find(d => d.id === w.id)).map(w => ({id: w.id, pct: 0}));
  if(_wipeExtraDist.length) DISTRIBUTION = DISTRIBUTION.concat(_wipeExtraDist);
  document.getElementById('walletFilterChip').classList.remove('show');
  document.getElementById('categoryFilterChip').classList.remove('show');
  document.querySelectorAll('.filters button').forEach(b => b.classList.toggle('active', b.dataset.f === 'all'));
  const si = document.getElementById('searchInput');
  if(si){ si.value = ''; document.getElementById('searchBox').classList.remove('has-text'); }
  subscriptions = [];
  await saveBalances();
  await saveTx();
  await saveConfig();
  await saveSubs();
  // trackLinkMode was reset in memory above but lives in layout prefs — without
  // this, a reload restores the pre-wipe link modes while Drive already got {}.
  if(typeof saveLayoutPrefs === 'function') saveLayoutPrefs();
  closeModal('settingsModal');
  render();
  if(typeof renderTrackLinkPicker === 'function') renderTrackLinkPicker();
  toast(t({ar:'🗑 تم حذف كل البيانات', en:'🗑 All data deleted'}));
  } finally { _opInFlight--; }
}
