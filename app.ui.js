/* ============================================================
   RENDER: WALLETS
============================================================ */
function getWalletPctLabel(w){
  const d = DISTRIBUTION.find(x=>x.id===w.id);
  if(d) return d.pct + '%';
  if(w.track) return t({ar:'تتبع', en:'Track'});
  return w.pct;
}

let _monthlyExpenseCache = null;
let _monthlyExpenseCacheKey = '';
// Keyed only by year-month (not a full signature), so it can't self-invalidate
// off _txMutationStamp the way the Sig-based caches do — it needs an explicit
// clear whenever something is about to be drawn. Registers into app.core.js's
// render-invalidation list instead of render() (app.main.js) hand-listing it.
invalidateOnRender(() => { _monthlyExpenseCache = null; _monthlyExpenseCacheKey = ''; });
let _heroStatsCache = null;
let _heroStatsSig = '';
function _buildMonthlyExpenseCache(){
  const now = new Date();
  const cache = {};
  state.transactions.forEach(tx=>{
    if(tx.type!=='expense' || isSystemCategory(tx)) return;
    const d = new Date(tx.ts);
    if(d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear()){
      // round2 per-step (not just at the end) so summing many transactions
      // can't drift past a budget threshold by an IEEE-754 fraction of a cent
      // (e.g. 0.10 × 300 ≠ 30 exactly in raw float math).
      cache[tx.wallet] = round2((cache[tx.wallet]||0) + tx.amount);
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
  // Track wallets' badge shows their share of ALL money across every wallet
  // (track + regular combined) — e.g. "this is 25% of everything I have" —
  // rather than a budget-distribution %, which doesn't apply to them.
  const grandTotal = WALLET_DEFS.reduce((s,d) => s + (state.wallets[d.id] ?? 0), 0);

  // First-run guidance: a brand-new app has every balance at 0, which reads as
  // "broken" rather than "empty". Show a friendly CTA that points at the natural
  // first action — recording income (which then auto-distributes into the wallets).
  if(state.transactions.length === 0 && !state.crisisMode && WALLET_DEFS.every(w => (state.wallets[w.id] ?? 0) === 0)){
    const cta = document.createElement('div');
    cta.className = 'wallet-cta';
    cta.innerHTML = `
      <div class="wallet-cta-title">👋 ${escHtml(t({ar:'ابدأ رحلتك', en:'Start your journey'}))}</div>
      <div class="wallet-cta-sub">${escHtml(t({ar:'سجّل أول دخل ليتوزّع تلقائياً على محافظك حسب النِّسب.', en:'Record your first income to auto-distribute it across your wallets by percentage.'}))}</div>
      <button class="wallet-cta-btn" type="button">＋ ${escHtml(t({ar:'سجّل أول دخل', en:'Record first income'}))}</button>
    `;
    // bound as a property (not an onclick= attribute) — inline handler attributes
    // are blocked by the CSP now that script-src has no 'unsafe-inline'.
    cta.querySelector('.wallet-cta-btn').onclick = () => { openAddDrawer(); setAddFormType('income'); };
    grid.appendChild(cta);
  }

  // Normal mode hides crisisOnly wallets (they only appear in crisis/alternative mode)
  let defs = state.crisisMode
    ? WALLET_DEFS.filter(w => !crisisWalletIds().includes(w.id))  // crisis: hide budget wallets, show crisis_fund
    : WALLET_DEFS.filter(w => !w.crisisOnly);                      // normal: hide crisis_fund

  let barMax = 1;
  defs.forEach(w => {
    const _bv = (w.crisisOnly && state.crisisMode)
      ? crisisWalletIds().reduce((s, id) => s + (state.wallets[id] ?? 0), 0) + (state.wallets[w.id] ?? 0)
      : (state.wallets[w.id] ?? 0);
    if(!w.track && _bv > barMax) barMax = _bv;
  });

  defs.forEach(w => {
    const val = (w.crisisOnly && state.crisisMode)
      ? crisisWalletIds().reduce((s, id) => s + (state.wallets[id] ?? 0), 0) + (state.wallets[w.id] ?? 0)
      : (state.wallets[w.id] ?? 0);
    if(!w.track) spendable += val;
    const div = document.createElement('div');
    div.className = 'wallet' + (w.track ? ' track' : '') + (val < 0 ? ' neg-val' : '') + (walletFilter===w.id ? ' active-filter' : '');
    div.setAttribute('role','button');
    div.setAttribute('tabindex','0');
    div.setAttribute('aria-pressed', String(walletFilter===w.id));
    const pctWidth = w.track ? 100 : Math.min(100, Math.max(2, (val/barMax)*100));

    let budgetHtml = '';
    if(!w.track && budgets[w.id] > 0){
      const spent = monthlyExpenseForWallet(w.id);
      const budget = budgets[w.id];
      const ratio = Math.min(1, spent/budget);
      const over = spent > budget;
      const color = over ? 'var(--red)' : ratio > 0.8 ? 'var(--gold)' : 'var(--green)';
      const budgetStatus = over
        ? t({ar:'تجاوز الميزانية', en:'Over budget'})
        : ratio > 0.8
          ? t({ar:'اقتراب من الحد', en:'Near budget limit'})
          : t({ar:'ضمن الميزانية', en:'On budget'});
      budgetHtml = `
        <div class="budget-row">
          <div class="bar" style="margin-top:6px;" role="img" aria-label="${escHtml(budgetStatus)}"><i style="transform:scaleX(${ratio.toFixed(4)}); background:${color};"></i></div>
          <div class="budget-label" style="color:${over?'var(--red)':'var(--muted)'}">${fmt(spent)} / ${fmt(budget)}${over?' ⚠':''}</div>
        </div>`;
    }

    // track wallets are not counted in spendable — say so persistently on the card
    // (the hover title never shows on touch), so users stop wondering why the total
    // doesn't include Cards/Cash.
    const trackTag = w.track ? `<div class="track-tag">${t({ar:'تتبع · غير محتسب', en:'Track · not counted'})}</div>` : '';
    // Track wallets' badge shows their live share of all money across every
    // wallet (⚖️) — same gold chip style every other wallet badge uses, still
    // a button that opens the balance-sync screen on tap.
    const trackSharePct = grandTotal > 0 ? Math.max(0, Math.round((val/grandTotal)*100)) : 0;
    // role/tabindex + property-bound handlers (below, after innerHTML) so this
    // nested control is reachable on its own — it opens a *different* screen
    // (wallet detail) than the card it sits inside (which only filters), so it
    // needs its own keyboard path, not just the card's. Handlers are attached as
    // properties, not onclick= attributes, which the CSP now blocks.
    const pctBtn = w.track
      ? `<div class="pct" role="button" tabindex="0" aria-label="${escHtml(t({ar:`مزامنة الرصيد الفعلي لـ ${w.name} — ${trackSharePct}% من إجمالي محافظك`, en:`Sync actual balance for ${w.name} — ${trackSharePct}% of your total wallets`}))}" title="${escHtml(t({ar:'مزامنة الرصيد الفعلي', en:'Sync actual balance'}))}">⚖️ ${trackSharePct}%</div>`
      : `<div class="pct" role="button" tabindex="0" aria-label="${escHtml(t({ar:`تفاصيل ${w.name}`, en:`Details for ${w.name}`}))}" title="${escHtml(t({ar:'التفاصيل', en:'Details'}))}">ⓘ ${escHtml(w.crisisOnly && state.crisisMode ? crisisWalletIds().reduce((s,id)=>{const wd=WALLET_DEFS.find(x=>x.id===id);return s+(wd?(parseFloat(getWalletPctLabel(wd))||0):0);},0)+'%' : getWalletPctLabel(w))}</div>`;
    div.innerHTML = `
      <div class="top">
        <div class="name">${escHtml(w.name)}</div>
        ${pctBtn}
      </div>
      <div class="val">${fmt(val)}</div>
      <div class="bar"><i style="transform:scaleX(${(pctWidth/100).toFixed(4)})"></i></div>
      ${trackTag}
      ${budgetHtml}
    `;
    div.title = w.track ? t({ar:`${w.name} — رقم تتبع فقط، غير مُحتسب بالإجمالي المتاح للصرف`, en:`${w.name} — a tracking number only, not counted in the total available to spend`}) : '';
    div.onclick = () => setWalletFilter(w.id);
    div.onkeydown = (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setWalletFilter(w.id); } };
    const pctEl = div.querySelector('.pct');
    if(pctEl){
      // pctEl sits inside div's own click/keydown handler above (setWalletFilter)
      // — stop propagation UNCONDITIONALLY (own listeners, ahead of bindKbdSelect's)
      // so a suppressed keyboard-echo click still doesn't bubble up and fire the
      // parent's action too. See bindKbdSelect (app.core.js) for the keyboard-
      // echo-suppression rationale shared with the two other wallet pickers.
      pctEl.addEventListener('click', e => e.stopPropagation());
      pctEl.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' ') e.stopPropagation(); });
      bindKbdSelect(pctEl, () => openWalletDetail(w.id));
    }
    grid.appendChild(div);
  });
  // crisis_fund can hold its OWN independent balance beyond just merging the
  // hidden budget wallets — a direct expense recorded against it (or a
  // transfer in/out) while crisis mode is on writes straight to
  // state.wallets.crisis_fund. In crisis mode that's already counted above
  // (the merged crisis_fund row's own value includes it); in normal mode
  // crisis_fund is excluded from `defs` entirely (crisisOnly), so without
  // this its balance silently vanished from the total the instant crisis
  // mode was switched off — the ledger stayed correct, but the displayed
  // total quietly understated real resources by exactly that amount.
  if(!state.crisisMode) spendable += (state.wallets.crisis_fund ?? 0);

  document.getElementById('walletCount').textContent = String(defs.length);

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
    if(w) document.getElementById('walletFilterLabel').textContent = t({ar:'فلترة حسب: ', en:'Filtered by: '}) + w.name;
    chip.classList.add('show');
  } else {
    chip.classList.remove('show');
  }
  renderWallets();
  if(currentTab === 'transactions') renderRecentTx();
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
  if(currentTab === 'transactions') renderRecentTx();
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
    document.getElementById('categoryFilterLabel').textContent = t({ar:'الفئة: ', en:'Category: '}) + cat.icon + ' ' + cat.name;
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
   WALLET DEFINITIONS EDITOR (Settings → إدارة المحافظ)
   Add/rename/reorder custom wallets. Type (track/regular) is fixed at
   creation — changing it after transactions reference the wallet would leave
   applyTxToBalance/reconcileBalances in an undefined accounting state.
============================================================ */
function renderWalletDefsEditor(){
  const host = document.getElementById('walletDefsEditor');
  if(!host) return;
  const group = track => {
    const list = WALLET_DEFS.filter(w => w.track === track);
    return list.map((w,i) => {
      // 'core' is structural and a group must keep at least one wallet — those two
      // cases can never be deleted, so disable the button rather than toast-on-tap.
      // Balance/transaction guards stay dynamic (the user can clear them), so those
      // wallets keep an enabled button that explains via toast why it's blocked.
      const blockDelete = (w.id === 'core') || (!track && list.length <= 1);
      // Every row gets a gold "view" button that jumps straight to the wallet's
      // detail screen — ⚖️ for track wallets (the actual-balance sync) and ⓘ for
      // regular wallets (details + monthly budget). Both otherwise only surface
      // via the small badge on the dashboard card, which users reported needing
      // time to even notice exists.
      const viewBtn = track
        ? `<button class="rd-view" data-act="view" data-wid="${w.id}" aria-label="${escHtml(t({ar:'مزامنة الرصيد الفعلي لـ', en:'Sync actual balance for'}))} ${escHtml(w.name)}" title="${escHtml(t({ar:'مزامنة الرصيد الفعلي', en:'Sync actual balance'}))}">⚖️</button>`
        : `<button class="rd-view" data-act="view" data-wid="${w.id}" aria-label="${escHtml(t({ar:'تفاصيل', en:'Details for'}))} ${escHtml(w.name)}" title="${escHtml(t({ar:'التفاصيل والميزانية', en:'Details and budget'}))}">ⓘ</button>`;
      return `
      <div class="reorder-row">
        <div class="reorder-label">${escHtml(w.name)}</div>
        <div class="reorder-btns">
          ${viewBtn}
          <button data-act="edit" data-wid="${w.id}" aria-label="${escHtml(t({ar:'تعديل', en:'Edit'}))} ${escHtml(w.name)}">✎</button>
          <button data-act="up" data-wid="${w.id}" ${i===0?'disabled':''} aria-label="${escHtml(t({ar:'تحريك لأعلى', en:'Move up'}))}">▲</button>
          <button data-act="down" data-wid="${w.id}" ${i===list.length-1?'disabled':''} aria-label="${escHtml(t({ar:'تحريك لأسفل', en:'Move down'}))}">▼</button>
          <button class="rd-del" data-act="del" data-wid="${w.id}" ${blockDelete?'disabled':''} aria-label="${escHtml(t({ar:'حذف', en:'Delete'}))} ${escHtml(w.name)}">🗑</button>
        </div>
      </div>`;
    }).join('');
  };
  host.innerHTML = `
    <div class="reorder-group">
      <div class="reorder-gtitle">${escHtml(t({ar:'محافظ عادية (تُحتسب بالإجمالي)', en:'Regular wallets (counted in total)'}))}</div>
      <div class="hint" style="margin:0 0 8px;">ⓘ = ${escHtml(t({ar:'تفاصيل المحفظة وضبط الميزانية الشهرية.', en:'Wallet details and monthly budget settings.'}))}</div>
      ${group(false)}
    </div>
    <div class="reorder-group">
      <div class="reorder-gtitle">${escHtml(t({ar:'محافظ تتبع (غير محتسبة)', en:'Tracking wallets (not counted)'}))}</div>
      <div class="hint" style="margin:0 0 8px;">⚖️ = ${escHtml(t({ar:'مزامنة رصيدك الفعلي لهذه المحفظة — يُسجَّل الفرق تلقائياً كمعاملة.', en:'Sync your actual balance for this wallet — the difference is logged automatically as a transaction.'}))}</div>
      ${group(true)}
    </div>
  `;
  // property-bound (CSP blocks onclick= attributes in generated markup)
  const WD_ACTS = {
    view: id => openWalletDetail(id),
    edit: id => openWalletDefModal(id),
    up:   id => moveWalletDef(id, -1),
    down: id => moveWalletDef(id, 1),
    del:  id => deleteWalletDef(id),
  };
  host.querySelectorAll('button[data-act]').forEach(b => {
    b.onclick = () => WD_ACTS[b.dataset.act](b.dataset.wid);
  });
}

// Refresh every cache/UI surface that reads wallet id/name/order, beyond the
// main render() loop. (The add-form/edit-modal/transfer wallet pickers no
// longer memoize a signature since v47.80 — their option list is only built
// on actual popup open, via the shared openWalletPop — so there's nothing to
// invalidate for them here anymore.)
function refreshAfterWalletDefsChange(){
  _distDraft = null; // wallet structure changed — rebuild draft from updated DISTRIBUTION
  // A deleted wallet can never have transactions (deleteWalletDef enforces
  // that), so an active filter pointing at it would otherwise leave the tx
  // list permanently empty with a stale filter chip the user has no obvious
  // way to connect to "I deleted that wallet".
  if(walletFilter && !WALLET_DEFS.some(w => w.id === walletFilter)){
    clearWalletFilter();
  } else if(walletFilter){
    // rename case — keep the chip label in sync with the live wallet name
    const w = WALLET_DEFS.find(x => x.id === walletFilter);
    const label = document.getElementById('walletFilterLabel');
    if(w && label) label.textContent = t({ar:'فلترة حسب: ', en:'Filtered by: '}) + w.name;
  }
  renderWalletDefsEditor();
  renderWallets();
  renderWalletSelect();
  renderEditWalletSelect();
  renderTrackLinkPicker();
  renderDistributionEditor();
  renderTxList();
  renderChart();
  renderPieChart();
}

// Reorders a wallet within its own group (track vs regular) only — the two
// groups' relative interleaving in WALLET_DEFS is otherwise irrelevant, but
// we still rebuild the full array in place (applyWalletDefs) so every
// existing direct WALLET_DEFS reference across the app stays in sync.
function moveWalletDef(id, dir){
  const w = WALLET_DEFS.find(x => x.id === id);
  if(!w) return;
  const groupIds = WALLET_DEFS.filter(x => x.track === w.track).map(x => x.id);
  const i = groupIds.indexOf(id), j = i + dir;
  if(i < 0 || j < 0 || j >= groupIds.length) return;
  [groupIds[i], groupIds[j]] = [groupIds[j], groupIds[i]];
  const byId = new Map(WALLET_DEFS.map(x => [x.id, x]));
  let gi = 0;
  const reordered = WALLET_DEFS.map(x => x.track === w.track ? byId.get(groupIds[gi++]) : x);
  applyWalletDefs(reordered);
  // Keep DISTRIBUTION row order in sync with the new wallet order so the
  // distribution editor matches the wallet card grid visually.
  if(!w.track){
    const distById = new Map(DISTRIBUTION.map(d => [d.id, d]));
    const newOrder = reordered.filter(x => !x.track && !x.crisisOnly).map(x => x.id);
    DISTRIBUTION = newOrder.filter(id => distById.has(id)).map(id => distById.get(id));
    // keep any DISTRIBUTION entries without a matching wallet (stale config safety)
    distById.forEach((d, did) => { if(!newOrder.includes(did)) DISTRIBUTION.push(d); });
  }
  saveWalletDefs();
  refreshAfterWalletDefsChange();
}

function openWalletDefModal(id){
  editingWalletDefId = id || null;
  const w = id ? WALLET_DEFS.find(x => x.id === id) : null;
  document.getElementById('walletDefModalTitle').textContent = w ? t('wdef.editTitle') : t('set.newWallet');
  document.getElementById('walletDefName').value = w ? w.name : '';
  setWalletDefType(w ? w.track : false);
  // type is only choosable when creating — locking it afterward avoids an
  // undefined accounting state once transactions reference the wallet
  const typeRow = document.getElementById('walletDefTypeRow');
  if(typeRow) typeRow.style.display = w ? 'none' : '';
  const delRow = document.getElementById('walletDefDeleteRow');
  if(delRow) delRow.style.display = w ? 'flex' : 'none';
  openModal('walletDefModal');
}

function setWalletDefType(isTrack){
  _walletDefModalTrack = !!isTrack;
  const regBtn = document.getElementById('walletDefTypeRegular');
  const trkBtn = document.getElementById('walletDefTypeTrack');
  if(regBtn) regBtn.classList.toggle('active', !_walletDefModalTrack);
  if(trkBtn) trkBtn.classList.toggle('active', _walletDefModalTrack);
}

let _saveWalletDefBusy = false;
async function saveWalletDefModal(){
  if(_saveWalletDefBusy) return;
  // cross-op write guard (see commitQuickNotes) — this writes balances/defs across awaits
  if(_opBusy()) return;
  const nameInput = document.getElementById('walletDefName');
  const name = truncateCodePoints(stripBidiControls(nameInput.value).trim(), 40);
  if(!name){ toast(t({ar:'⚠ أدخل اسم المحفظة', en:'⚠ Enter a wallet name'}), true); nameInput.focus(); return; }
  if(WALLET_DEFS.some(w => w.id !== editingWalletDefId && w.name.toLowerCase() === name.toLowerCase())){
    toast(t({ar:'⚠ يوجد محفظة بهذا الاسم بالفعل', en:'⚠ A wallet with this name already exists'}), true); nameInput.focus(); return;
  }

  _saveWalletDefBusy = true;
  _opInFlight++;
  try{
    if(editingWalletDefId){
      const w = WALLET_DEFS.find(x => x.id === editingWalletDefId);
      if(!w){ toast(t({ar:'⚠ المحفظة غير موجودة', en:'⚠ Wallet not found'}), true); return; }
      w.name = name;
      await saveWalletDefs();
    } else {
      const track = _walletDefModalTrack;
      const id = 'w_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
      // pct is a neutral internal marker for track wallets (see WALLET_DEFS,
      // app.core.js) — getWalletPctLabel always translates via t() instead of
      // reading this raw field, so it must never be a language-specific literal.
      WALLET_DEFS.push({ id, name, initial:0, track, pct: track ? 'track' : '0%' });
      recomputeSelectableWallets();
      state.wallets[id] = 0;
      // the distribution editor iterates DISTRIBUTION, not WALLET_DEFS — a new
      // regular wallet needs an explicit entry or it'd never appear there.
      // Reassign (not push) — computeRenderSig() caches this array by reference,
      // so mutating in place would leave the next render() comparing against a
      // stale signature and silently skipping the update this wallet needs.
      if(!track) DISTRIBUTION = DISTRIBUTION.concat([{ id, pct: 0 }]);
      await saveWalletDefs();
      await saveConfig();   // persists the new DISTRIBUTION entry
      await saveBalances(); // persists the new wallet's zero balance
    }
    refreshAfterWalletDefsChange();
    closeModal('walletDefModal');
    toast(t({ar:'✓ تم الحفظ', en:'✓ Saved'}));
  } finally {
    _saveWalletDefBusy = false;
    _opInFlight--;
  }
}

// Core deletion + all safety guards. Shared by the inline 🗑 button in the
// reorder list and the edit modal's delete button. Returns true if the wallet
// was actually removed (so the modal caller knows whether to close).
async function deleteWalletDef(id){
  if(_saveWalletDefBusy) return false;
  const w = WALLET_DEFS.find(x => x.id === id);
  if(!w) return false;
  if(id === 'core'){ toast(t({ar:'⚠ لا يمكن حذف المحفظة الرئيسية', en:'⚠ Cannot delete the main wallet'}), true); return false; }
  if(!w.track && WALLET_DEFS.filter(x => !x.track).length <= 1){
    toast(t({ar:'⚠ لا يمكن حذف آخر محفظة عادية', en:'⚠ Cannot delete the last regular wallet'}), true); return false;
  }
  if(Math.abs(state.wallets[id] ?? 0) > 0.004){
    toast(t({ar:'⚠ صفّر رصيد المحفظة أولاً قبل حذفها', en:'⚠ Zero out the wallet balance before deleting it'}), true); return false;
  }
  const hasTx = state.transactions.some(tx => tx.wallet === id || tx.trackWallet === id);
  if(hasTx){
    toast(t({ar:'⚠ لا يمكن حذف محفظة مرتبطة بمعاملات موجودة', en:'⚠ Cannot delete a wallet linked to existing transactions'}), true); return false;
  }
  if(!confirm(t({ar:`حذف محفظة "${w.name}" نهائياً؟`, en:`Permanently delete wallet "${w.name}"?`}))) return false;

  _saveWalletDefBusy = true;
  _opInFlight++;
  try{
    // tombstone so merge sync propagates the deletion instead of the other
    // device's copy re-adding this wallet on the next union merge
    deletedWalletDefIds[id] = Date.now();
    applyWalletDefs(WALLET_DEFS.filter(x => x.id !== id));
    delete state.wallets[id];
    if(!w.track){ DISTRIBUTION = DISTRIBUTION.filter(d => d.id !== id); }
    if(budgets[id] !== undefined) delete budgets[id];
    if(w.track && trackLinkMode[id] !== undefined){ delete trackLinkMode[id]; saveLayoutPrefs(); scheduleDriveSync(); }
    await saveWalletDefs();
    await saveConfig();
    await saveBalances();
    if(editingWalletDefId === id) editingWalletDefId = null;
    refreshAfterWalletDefsChange();
    toast(t({ar:'🗑 تم حذف المحفظة', en:'🗑 Wallet deleted'}));
    return true;
  } finally {
    _saveWalletDefBusy = false;
    _opInFlight--;
  }
}
async function deleteWalletDefModal(){
  // Same rare cross-tab-race gap as deleteFromEdit (app.logic.js) — a stale id
  // here silently left the user unsure whether their Delete tap registered.
  if(!editingWalletDefId){ closeModal('walletDefModal'); toast(t({ar:'⚠ المحفظة لم تعد موجودة', en:'⚠ The wallet no longer exists'}), true); return; }
  if(await deleteWalletDef(editingWalletDefId)) closeModal('walletDefModal');
}

/* ============================================================
   WALLET SELECT (add form)
============================================================ */
// v47.80: migrated onto the shared in-page wallet popup (openWalletPop,
// app.quicknotes.js) — was a bespoke in-flow dropdown (#walletMenuWrap/
// #walletMenu in index.html) with its own signature-gated rebuild. Now this
// only needs to keep the closed-state label in sync; the option list is built
// on demand when the popup actually opens (toggleWalletMenu below), so the
// sig-cache that existed purely to avoid rebuilding a hidden DOM tree on every
// render() call is gone — there's no longer a tree to rebuild until opened.
function renderWalletSelect(){
  const wDef = WALLET_DEFS.find(w => w.id === selectedWallet);
  document.getElementById('walletSelectLabel').textContent = wDef ? wDef.name : t({ar:'اختر محفظة', en:'Choose a wallet'});
}
function toggleWalletMenu(){
  const btn = document.getElementById('walletSelectBtn');
  const items = SELECTABLE_WALLETS.map(w => {
    const val = (w.crisisOnly && state.crisisMode)
      ? crisisWalletIds().reduce((s, id) => s + (state.wallets[id] ?? 0), 0) + (state.wallets[w.id] ?? 0)
      : (state.wallets[w.id] ?? 0);
    return { id: w.id, name: w.name, bal: fmt(val) };
  });
  openWalletPop(btn, items, selectedWallet, (id) => selectWallet(id));
}
function selectWallet(id){
  selectedWallet = id;
  renderWalletSelect();
}

/* ============================================================
   OPTIONAL TRACKED-WALLET LINK (add form)
   Lets an expense paid from a budget wallet ALSO move a tracked wallet
   (e.g. pay Uber from Core, and auto-update the "Uber" tracking number) —
   without making the tracked wallet the direct source of the transaction.
============================================================ */
function renderTrackLinkPicker(){
  const btn = document.getElementById('trackSelectBtn');
  const label = document.getElementById('trackSelectLabel');
  if(!btn || !label) return;

  // A stale id (e.g. carried over from a repeated tx whose tracked wallet was
  // since deleted/changed in a cloud merge) must not leave the form silently
  // pointing at nothing.
  if(selectedTrackWallet && !WALLET_DEFS.find(w => w.id === selectedTrackWallet && w.track)){
    selectedTrackWallet = null;
  }

  // In-page custom dropdown (same widget as the primary wallet, blue variant) —
  // shows the chosen tracking wallet or "no tracking"; the list opens via
  // openTrackPicker → the shared wallet popup (not the OS native list).
  const tw = selectedTrackWallet ? WALLET_DEFS.find(x => x.id === selectedTrackWallet) : null;
  label.textContent = tw ? tw.name : t({ar:'بدون تتبّع', en:'No tracking'});
  btn.classList.toggle('has-track', !!selectedTrackWallet); // blue once a wallet is chosen

  const hint = document.getElementById('trackLinkHint');
  if(hint){
    if(selectedTrackWallet){
      const w = WALLET_DEFS.find(x => x.id === selectedTrackWallet);
      const credit = trackModeFor(selectedTrackWallet) === 'credit';
      hint.style.display = 'block';
      hint.textContent = credit
        ? t({ar:`↪ سيزيد رقم «${w ? w.name : ''}» بقيمة المعاملة تلقائياً (عدّاد إنفاق). غيّر السلوك من تفاصيل المحفظة ⓘ.`, en:`↪ "${w ? w.name : ''}" will automatically increase by the amount (spending counter). Change this behavior from wallet details ⓘ.`})
        : t({ar:`↪ سينقص رصيد «${w ? w.name : ''}» بقيمة المعاملة تلقائياً (رصيد فعلي). غيّر السلوك من تفاصيل المحفظة ⓘ.`, en:`↪ "${w ? w.name : ''}" balance will automatically decrease by the amount (actual balance). Change this behavior from wallet details ⓘ.`});
    } else {
      hint.style.display = 'none';
      hint.textContent = '';
    }
  }
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
  const saved = saveLayoutPrefs();
  scheduleDriveSync();
  _updateTrackModeToggleUI(walletId);
  renderTrackLinkPicker(); // refresh the add-form hint if this wallet is selected there
  if(saved) toast(trackLinkMode[walletId] === 'credit' ? t({ar:'✓ سيُحتسب كعدّاد إنفاق (يزيد)', en:'✓ Will be counted as a spending counter (increases)'}) : t({ar:'✓ سيُحتسب كرصيد فعلي (ينقص)', en:'✓ Will be counted as an actual balance (decreases)'}));
}
function _updateTrackModeToggleUI(walletId){
  const credit = trackModeFor(walletId) === 'credit';
  const d = document.getElementById('trackModeDebit');
  const c = document.getElementById('trackModeCredit');
  if(d){ d.classList.toggle('active', !credit); d.setAttribute('aria-pressed', String(!credit)); }
  if(c){ c.classList.toggle('active', credit); c.setAttribute('aria-pressed', String(credit)); }
}

/* ============================================================
   V9.3: ADD DRAWER
============================================================ */
// The drawer's sticky submit footer already stays reachable above the OS
// keyboard via `max-height:92dvh` (style.css), but that only resizes the
// drawer itself — it doesn't bring a freshly-focused field into the now-
// shorter visible area. A field near the bottom (amount, desc) can still end
// up hidden under the keyboard until the user scrolls manually. Nudge it into
// view automatically instead, after a short delay so it runs once the
// keyboard's resize/animation has actually settled (focusin fires before that).
// Delegated on document.body (not just #addDrawer) so every other modal —
// editModal, subModal, walletDefModal, etc. — gets the same nudge-into-view
// behavior. Without this, only the add-drawer had it; on a short viewport
// with the keyboard open, fields/buttons near the bottom of any other modal
// (e.g. editModal's save/delete row below the amount input) could end up
// hidden with no auto-scroll to reveal them.
document.body.addEventListener('focusin', (e) => {
  if(e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') return;
  if(!e.target.closest('#addDrawer') && !e.target.closest('.modal-overlay.open')) return;
  setTimeout(() => {
    try{ e.target.scrollIntoView({behavior:'smooth', block:'center'}); }catch(_){}
  }, 300);
});
function openAddDrawer(){
  const wasClosed = !addDrawerOpen;
  // remember what had focus so we can restore it on close (a11y) — same
  // stack openModal/closeModal use in app.overlay.js
  if(wasClosed) _focusStack.push(document.activeElement);
  addDrawerOpen = true;
  switchDrawerTab(0); // always open on Details tab so amount/date are immediately visible
  document.getElementById('addDrawer').classList.add('open');
  document.getElementById('addDrawerOverlay').classList.add('open');
  // blur the trigger BEFORE hiding its ancestor from the a11y tree (see openModal
  // in app.overlay.js for why) — the real focus-in-drawer happens a frame later below.
  if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
  _setBackgroundHidden(true);
  lockBodyScroll();
  capDateInputsToToday();
  // Same back-button bookkeeping as openModal/closeModal (see app.overlay.js) so
  // hardware/gesture back closes the drawer instead of navigating away. Guarded
  // by wasClosed so re-entrant calls (none currently, but matches the modal
  // pattern defensively) don't push a duplicate history entry.
  if(wasClosed) _pushOverlayHistory();
  // move focus into the drawer so keyboard/screen-reader users land in context —
  // this is the app's most-used dialog (the FAB add-transaction flow), so leaving
  // focus behind on the trigger button left keyboard/TalkBack users stranded.
  // Target a button (not a text input) so the mobile keyboard doesn't pop open.
  requestAnimationFrame(()=>{
    const drawer = document.getElementById('addDrawer');
    const focusable = drawer && drawer.querySelector('button, [tabindex]');
    if(focusable) try{ focusable.focus({preventScroll:true}); }catch(_){}
  });
}
function closeAddDrawer(){
  const wasOpen = addDrawerOpen;
  addDrawerOpen = false;
  document.getElementById('addDrawer').classList.remove('open');
  document.getElementById('addDrawerOverlay').classList.remove('open');
  if(!_anyOverlayOpen()){ unlockBodyScroll(); _setBackgroundHidden(false); }
  // Closing via the back button skips the click-outside handler that would
  // normally collapse an open wallet picker — since v47.80 that's the shared
  // popup (openWalletPop, app.quicknotes.js), so just close it directly
  // instead of resetting a specific dropdown's classes.
  if(typeof closeWalletPop === 'function') closeWalletPop();
  // A pending voice recognition would otherwise keep listening in the background
  // and silently fill the (now hidden) desc/amount fields whenever it resolves.
  // Also explicitly clear the watchdog timer — on some browsers abort() never fires
  // onerror, leaving _voiceTimer alive to fire 12s later against the hidden form.
  if(voiceRecognition){ try{ voiceRecognition.abort(); }catch(_){} voiceRecognition = null; }
  clearTimeout(_voiceTimer); _voiceTimer = null;
  const _vBtn = document.getElementById('voiceBtn');
  if(_vBtn) _vBtn.classList.remove('listening');
  // Skip _popOverlayHistory() when addTx() is atomically swapping this drawer entry
  // for a modal entry via replaceState — calling history.back() here would race with
  // the modal's pushState/replaceState and navigate the user off the page.
  if(wasOpen && !_nextPushOverlayReplaces) _popOverlayHistory();
  // Only restore focus when the drawer was actually open — mirrors the closeModal
  // fix: popping the stack on an already-closed drawer corrupts the focus chain for
  // any other overlay that's currently open.
  if(wasOpen){
    const _retFocus = _focusStack.pop();
    if(_retFocus && typeof _retFocus.focus === 'function'){
      try{ _retFocus.focus({preventScroll:true}); }catch(_){}
    }
  }
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
  const _hSig = state.transactions.length + '|' + (last ? last.id : '') + '|' + now.getMonth() + '|' + now.getFullYear() + '|' + state.crisisMode + '|' + _txMutationStamp;
  if(_hSig !== _heroStatsSig || !_heroStatsCache){
    let mIncome=0, mExpense=0;
    state.transactions.forEach(tx=>{
      if(isSystemCategory(tx)) return;
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
  // Full chronological log of transactions (newest first), grouped by day.
  // getFilteredTx() applies walletFilter, categoryFilter and searchQuery so
  // tapping a wallet card or searching updates the transactions tab list too.
  // Note: getFilteredTx() also applies currentFilter (time range) — when it's
  // 'all' (the default) every transaction passes, which is correct here.
  const all = getFilteredTx();

  const countEl = document.getElementById('txLogCount');
  if(countEl) countEl.textContent = all.length ? all.length : '';

  if(all.length === 0){
    list.innerHTML = `<div class="empty"><span class="ic">🗂</span>${t({ar:'لا توجد معاملات بعد — اضغط ＋ لإضافة أول معاملة', en:'No transactions yet — tap ＋ to add your first one'})}</div>`;
    return;
  }

  const _yest = new Date(); _yest.setDate(_yest.getDate()-1);
  const todayStr = new Date().toDateString();
  const yesterdayStr = _yest.toDateString();

  const visible = all.slice(0, _recentVisibleCount);
  let lastDay = null;
  let card = null;
  // Build the whole list off-DOM in a fragment, then attach once — appending each
  // of up to 500 rows directly to the live list triggers a reflow per insertion.
  const frag = document.createDocumentFragment();
  // Hoisted per-render — Intl formatter CONSTRUCTION (not formatting) is the
  // costly part, and this used to build a fresh one per row.
  const _timeFmt = new Intl.DateTimeFormat(_dateLocale(), {hour:'2-digit', minute:'2-digit', numberingSystem:'latn'});
  const _dayLabelFmt = new Intl.DateTimeFormat(_dateLocale(), {weekday:'long', day:'numeric', month:'long', numberingSystem:'latn'});

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
      lbl.textContent = dayStr===todayStr ? t({ar:'اليوم', en:'Today'})
        : dayStr===yesterdayStr ? t({ar:'أمس', en:'Yesterday'})
        : _dayLabelFmt.format(date);
      frag.appendChild(lbl);
      card = document.createElement('div');
      card.className = 'recent-card';
      card.setAttribute('role','list');
      frag.appendChild(card);
    }
    const timeStr = _timeFmt.format(date);
    const sign = tx.type==='expense'?'-':'+';
    const cls = tx.type==='expense'?'neg':'pos';
    const row = document.createElement('div');
    row.className = 'rtx';
    // role stays 'listitem' (its parent `card` is role="list") — tabindex/keydown
    // alone makes it keyboard-operable without breaking the list/listitem ARIA pairing.
    row.setAttribute('role','listitem');
    row.setAttribute('tabindex','0');
    // setAttribute doesn't interpret markup, so HTML-escaping isn't needed here —
    // but a pasted description could still smuggle bidi override characters that
    // scramble how a screen reader announces the rest of this label, so strip
    // those (stripBidiControls) without the unneeded HTML-entity escaping.
    row.setAttribute('aria-label',
      `${t(tx.type==='expense'?{ar:'مصروف',en:'Expense'}:{ar:'دخل',en:'Income'})} ${fmt(tx.amount)}${t({ar:'،',en:','})} ${stripBidiControls(tx.desc) || (wallet?wallet.name:'')}${t({ar:'،',en:','})} ${cat.name}${t({ar:'،',en:','})} ${timeStr}`);
    row.innerHTML = `
      <div class="rtx-badge" style="background:${cat.color}22; color:${cat.color};">${cat.icon}</div>
      <div class="rtx-body">
        <div class="rtx-desc">${escHtml(tx.desc||(wallet?wallet.name:''))}</div>
        <div class="rtx-sub"><span class="rtx-wallet">${escHtml(wallet?wallet.name:'')}</span><span class="rtx-dot">·</span>${timeStr}${_trackLinkTag(tx)}</div>
      </div>
      <div class="rtx-amt ${cls}">${sign}${fmt(tx.amount)}</div>`;
    row.onclick = () => openEdit(tx.id);
    row.onkeydown = (e) => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openEdit(tx.id); } };
    card.appendChild(row);
  });
  list.appendChild(frag); // single DOM attach for the whole grouped list

  // Paginate so a long history stays fast — reveal one more page (recentTxLimit) per tap
  if(all.length > _recentVisibleCount){
    const remaining = all.length - _recentVisibleCount;
    const toShow = Math.min(remaining, recentTxLimit);
    const more = document.createElement('button');
    more.className = 'btn-secondary';
    more.style.cssText = 'margin:14px auto 0; display:block; width:auto; padding:10px 24px; font-size:var(--fs-base);';
    const moreCountTxt = t({
      ar: arPlural(toShow, 'معاملة أقدم', 'معاملتين أقدم', 'معاملات أقدم', 'معاملة واحدة أقدم'),
      en: `${toShow} older ${toShow===1?'transaction':'transactions'}`,
    });
    const remainingTxt = remaining - toShow > 0 ? ` (${t({
      ar: arPlural(remaining - toShow, 'متبقية', 'متبقيتان', 'متبقية', 'واحدة متبقية'),
      en: `${remaining - toShow} remaining`,
    })})` : '';
    more.textContent = `⬇ ${t({ar:'عرض', en:'Show'})} ${moreCountTxt}` + remainingTxt;
    more.onclick = () => { _recentVisibleCount += recentTxLimit; renderRecentTx(); };
    list.appendChild(more);
  } else if(_recentVisibleCount > recentTxLimit && all.length > recentTxLimit){
    // Already expanded beyond the first page — offer a way to collapse back
    const collapse = document.createElement('button');
    collapse.className = 'btn-secondary';
    collapse.style.cssText = 'margin:14px auto 0; display:block; width:auto; padding:10px 24px; font-size:var(--fs-base);';
    collapse.textContent = `⬆ ${t({ar:'طيّ القائمة', en:'Collapse list'})}`;
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
    list.innerHTML = `<div class="empty" style="padding:18px 14px;"><span class="ic">📆</span>${t({ar:'لا توجد اشتراكات — أضف اشتراكاتك الشهرية لتتبع تكاليفها', en:'No subscriptions — add your monthly subscriptions to track their cost'})}</div>`;
    return;
  }

  const active = subscriptions.filter(s=>s.active!==false);
  const monthlyTotal = round2(active.reduce((s,x)=>s+x.amount, 0));
  totalEl.innerHTML = `${t({ar:'إجمالي الاشتراكات الفعّالة:', en:'Total active subscriptions:'})} <b>${fmt(monthlyTotal)}</b> / ${t({ar:'شهر', en:'mo'})}`;
  list.innerHTML = '';
  // last day of the CURRENT month — a billingDay beyond it (e.g. 31 in a 30-day
  // month) actually fires on this value instead (see the matching cap in
  // buildDailyReviewContent's due-today check), so the card hints at that instead
  // of showing a day that won't exist this month and looking like it never fires.
  const _subsLastDayThisMonth = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
  subscriptions.forEach(s => {
    const card = document.createElement('div');
    card.className = 'sub-card'+(s.active===false?' inactive':'');
    const dayNote = (s.billingDay && s.billingDay > _subsLastDayThisMonth)
      ? t({ar:` (هذا الشهر: ${_subsLastDayThisMonth})`, en:` (this month: ${_subsLastDayThisMonth})`})
      : '';
    card.innerHTML = `
      <div class="sub-info">
        <div class="sub-name">${escHtml(s.name)}</div>
        <div class="sub-meta">${escHtml(t({ar:`يوم ${s.billingDay||'—'} من كل شهر`, en:`Day ${s.billingDay||'—'} of every month`}) + dayNote)}${s.active===false?escHtml(t({ar:' · (متوقف)', en:' · (paused)'})):''}</div>
      </div>
      <div class="sub-amt">-${fmt(s.amount)}</div>
      <button class="sub-edit" aria-label="${escHtml(t({ar:'تعديل الاشتراك', en:'Edit subscription'}))}">✎</button>`;
    card.querySelector('.sub-edit').onclick = () => openSubModal(s.id);
    list.appendChild(card);
  });
}
function openSubModal(id){
  editingSubId = id;
  const sub = id ? subscriptions.find(s=>s.id===id) : null;
  document.getElementById('subModalTitle').textContent = sub ? t('sub.editTitle') : t('sub.title');
  document.getElementById('subName').value = sub ? sub.name : '';
  document.getElementById('subAmount').value = sub ? groupThousandsDisplay(sub.amount) : '';
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
  // cross-op write guard (see commitQuickNotes)
  if(_opBusy()) return;
  const nameInput = document.getElementById('subName');
  const amountInput = document.getElementById('subAmount');
  const dayInput = document.getElementById('subBillingDay');
  const name = truncateCodePoints(nameInput.value.trim(), 60);
  const amount = round2(parseAmount(amountInput.value));
  const billingDay = parseInt(normalizeDigits(dayInput.value), 10); // normalize Arabic-Indic digits (numeric keyboards often default to them)
  const active = document.getElementById('subActive')?.checked !== false;
  if(!name){ toast(t({ar:'⚠ أدخل اسم الاشتراك', en:'⚠ Enter a subscription name'}), true); nameInput.focus(); return; }
  if(subscriptions.some(s => s.id !== editingSubId && s.name.toLowerCase() === name.toLowerCase())){
    toast(t({ar:'⚠ يوجد اشتراك بهذا الاسم بالفعل', en:'⚠ A subscription with this name already exists'}), true); nameInput.focus(); return;
  }
  if(!isFinite(amount)||amount<=0){ toast(t({ar:'⚠ أدخل مبلغ صحيح', en:'⚠ Enter a valid amount'}), true); amountInput.focus(); return; }
  if(!isFinite(billingDay)||billingDay<1||billingDay>31){ toast(t({ar:'⚠ أدخل يوم صحيح (1-31)', en:'⚠ Enter a valid day (1-31)'}), true); dayInput.focus(); return; }

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
    toast(t({ar:'✓ تم حفظ الاشتراك', en:'✓ Subscription saved'}));
  } finally {
    _saveSubBusy = false;
    _opInFlight--;
  }
}
async function deleteSubModal(){
  if(_saveSubBusy) return; // double-tap guard — no feedback needed, matches every other busy-flag guard in the app
  // Same rare cross-tab-race gap as deleteFromEdit (app.logic.js) — a stale id
  // here silently left the user unsure whether their Delete tap registered.
  if(!editingSubId){ closeModal('subModal'); toast(t({ar:'⚠ الاشتراك لم يعد موجودًا', en:'⚠ The subscription no longer exists'}), true); return; }
  // cross-op write guard (see commitQuickNotes)
  if(_opBusy()) return;
  if(!confirm(t({ar:'حذف هذا الاشتراك نهائياً؟', en:'Permanently delete this subscription?'}))) return;
  _saveSubBusy = true;
  _opInFlight++;
  try{
    // tombstone so the deletion propagates through merge sync instead of the
    // other device's copy resurrecting it on the next union merge
    deletedSubIds[editingSubId] = Date.now();
    subscriptions = subscriptions.filter(s=>s.id!==editingSubId);
    await saveSubs();
    await saveConfig(); // tombstones live in config
    renderSubscriptions();
    closeModal('subModal');
    toast(t({ar:'🗑 تم حذف الاشتراك', en:'🗑 Subscription deleted'}));
  } finally {
    _saveSubBusy = false;
    _opInFlight--;
  }
}

/* ============================================================
   WALLET SELECT (edit modal)
============================================================ */
// only prepend the currently-edited wallet if it isn't already selectable
// (e.g. a crisisOnly/hidden wallet) — track wallets now live in
// SELECTABLE_WALLETS, so prepending unconditionally would list them twice.
function _editWalletList(){
  const currentDef = WALLET_DEFS.find(w => w.id === editWallet);
  if(currentDef && !SELECTABLE_WALLETS.find(w => w.id === currentDef.id)) return [currentDef, ...SELECTABLE_WALLETS];
  return SELECTABLE_WALLETS;
}
// v47.80: migrated onto the shared in-page wallet popup — see renderWalletSelect
// above for the same reasoning (no sig-cache needed once the option list is
// only built on actual popup open).
function renderEditWalletSelect(){
  const wDef = WALLET_DEFS.find(w => w.id === editWallet);
  document.getElementById('editWalletLabel').textContent = wDef ? wDef.name : t({ar:'اختر محفظة', en:'Choose a wallet'});
}
function toggleEditWalletMenu(){
  const btn = document.getElementById('editWalletBtn');
  const items = _editWalletList().map(w => ({ id: w.id, name: w.name, bal: fmt(state.wallets[w.id] ?? 0) }));
  openWalletPop(btn, items, editWallet, (id) => { editWallet = id; renderEditWalletSelect(); });
}
function setEditType(type){
  editType = type;
  document.getElementById('editTypeExp').classList.toggle('active', type==='expense');
  document.getElementById('editTypeInc').classList.toggle('active', type==='income');
  // keep category compatible with the chosen type (mirrors the add form).
  // !cat too, not just wrong-type: an UNKNOWN id (removed category, corrupted
  // import) used to short-circuit this reset — the grid then rendered with no
  // chip selected and no hint why, and saving wrote the invalid id straight
  // back, round-tripping forever with the edit form silently broken for it.
  // System categories ('transfer'/'adjustment') are exempt: they're valid ids
  // deliberately absent from CATEGORIES (no chip), and resetting them to
  // 'other' here would UN-exclude the tx from analytics/pie/budget math
  // (isSystemCategory) the moment its edit modal opened — openEdit calls this
  // unconditionally — even if the user then saved without touching anything.
  const cat = CATEGORIES.find(c=>c.id===editCategory);
  if(!isSystemCategory({category: editCategory}) && (!cat || !cat.types.includes(type))) editCategory = 'other';
  renderEditCategoryGrid();
}

function renderQuickAmounts(){
  const wrap = document.getElementById('quickAmounts');
  wrap.innerHTML = '';
  QUICK_AMOUNTS.forEach(amt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = fmt(amt);
    btn.setAttribute('aria-label', t({ar:'مبلغ سريع: ', en:'Quick amount: '}) + fmt(amt));
    btn.onclick = () => {
      const input = document.getElementById('amountInput');
      input.value = String(amt);
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
      b.classList.toggle('active', parseAmount(b.textContent) === v);
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
  // if current category is incompatible with new type — or is an UNKNOWN id
  // entirely (see setEditType above for why !cat matters) — reset to 'other'
  const cat = CATEGORIES.find(c=>c.id===selectedCategory);
  if(!cat || !cat.types.includes(type)) selectedCategory = 'other';
  renderCategoryGrid();
}

// shared helper: make a category chip keyboard-operable (Enter/Space)
function _makeCatChip(c, isActive, onSelect){
  const name = t({ar: c.name, en: c.nameEn});
  const chip = document.createElement('div');
  chip.className = 'cat-chip' + (isActive ? ' active' : '');
  chip.innerHTML = `<span class="ic">${c.icon}</span><span>${escHtml(name)}</span>`;
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  chip.setAttribute('aria-pressed', String(isActive));
  chip.setAttribute('aria-label', name);
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
  const cat = CATEGORIES.find(c=>c.id===id) || CATEGORIES.find(c=>c.id==='other') || CATEGORIES[0];
  // Spread so callers' `.name` reads stay translated without touching every
  // call site — `nameEn` never gets baked into CATEGORIES itself (see its
  // declaration) so this re-resolves on every call, always current language.
  return { ...cat, name: t({ar: cat.name, en: cat.nameEn}) };
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
   TRANSFERS BETWEEN WALLETS
============================================================ */
let transferFrom = null, transferTo = null;

function openTransferModal(){
  // A transfer needs two distinct spendable wallets. With fewer, the modal
  // used to open with from===to pre-selected and every submit blocked by
  // doTransfer's same-wallet guard — a dead-end screen with no explanation.
  if(SELECTABLE_WALLETS.length < 2){
    toast(t({ar:'⚠ التحويل يحتاج محفظتين قابلتين للصرف على الأقل — أضف محفظة من ⚙ الإعدادات ← المحافظ', en:'⚠ Transfers need at least two spendable wallets — add one from ⚙ Settings → Wallets'}), true);
    return;
  }
  // default to spendable wallets (the menus only list SELECTABLE_WALLETS), and
  // stay valid even if the wallet list is reordered or shrinks
  transferFrom = SELECTABLE_WALLETS[0].id;
  transferTo = SELECTABLE_WALLETS[1].id;
  renderTransferMenus();
  document.getElementById('transferAmount').value = '';
  document.getElementById('transferDate').value = todayISO();
  openModal('transferModal');
}
// The add-drawer's "transfer between wallets" button closes the drawer and opens
// this modal in one click — see the _nextPushOverlayReplaces comment in
// closeModal() for why that pair must go through the atomic-swap flag instead of
// a plain closeAddDrawer(); openTransferModal() (the latter raced history.back()
// against pushState() and could navigate the whole tab to about:blank).
function openTransferFromDrawer(){
  if(addDrawerOpen) _nextPushOverlayReplaces = true;
  try{
    closeAddDrawer();
    openTransferModal();
  } finally {
    _nextPushOverlayReplaces = false; // reset even if either call above throws
  }
}

// v47.80: migrated onto the shared in-page wallet popup — see renderWalletSelect
// above for the same reasoning.
function renderTransferMenus(){
  ['from','to'].forEach(dir=>{
    const selected = dir==='from' ? transferFrom : transferTo;
    const wDef = WALLET_DEFS.find(w=>w.id===selected);
    document.getElementById('transfer'+(dir==='from'?'From':'To')+'Label').textContent = wDef ? wDef.name : t({ar:'اختر محفظة', en:'Choose a wallet'});
  });
}
function toggleTransferMenu(dir){
  const key = dir==='from' ? 'From' : 'To';
  const btn = document.getElementById('transfer'+key+'Btn');
  const selected = dir==='from' ? transferFrom : transferTo;
  const items = SELECTABLE_WALLETS.map(w => ({ id: w.id, name: w.name, bal: fmt(state.wallets[w.id] ?? 0) }));
  openWalletPop(btn, items, selected, (id) => {
    if(dir==='from') transferFrom = id; else transferTo = id;
    renderTransferMenus();
  });
}

let _doTransferBusy = false;
async function doTransfer(){
  if(_doTransferBusy) return;
  if(typeof _stateNotReady === 'function' && _stateNotReady()) return;
  const amountInput = document.getElementById('transferAmount');
  const amt = round2(parseAmount(amountInput.value)); // cent precision — match display, avoid sub-cent drift
  if(!isFinite(amt) || amt <= 0){ toast(t({ar:'⚠ أدخل مبلغ صحيح', en:'⚠ Enter a valid amount'}), true); amountInput.focus(); return; }
  if(!transferFrom || !transferTo){ toast(t({ar:'⚠ اختر المحفظتين أولاً', en:'⚠ Choose both wallets first'}), true); return; }
  if(transferFrom === transferTo){ toast(t({ar:'⚠ اختر محفظتين مختلفتين', en:'⚠ Choose two different wallets'}), true); return; }
  // cross-op write guard (see commitQuickNotes) — block interleaving with another in-flight write
  if(_opBusy()) return;
  _doTransferBusy = true;
  _txMutationStamp++; // only once committed past validation — invalid taps shouldn't bump it
  _opInFlight++;
  const _transferBtn = document.getElementById('doTransferBtn');
  _setBtnSaving(_transferBtn, true, t({ar:'⏳ جارٍ التنفيذ...', en:'⏳ Processing...'}));
  try{
    const dateVal = document.getElementById('transferDate').value || todayISO();
    let ts = buildTxTs(dateVal);
    const fromWallet = WALLET_DEFS.find(w=>w.id===transferFrom);
    const toWallet = WALLET_DEFS.find(w=>w.id===transferTo);
    if(!fromWallet || !toWallet){ toast(t({ar:'⚠ محفظة غير صحيحة', en:'⚠ Invalid wallet'}), true); return; }
    // For crisis_fund in crisis mode, available = combined balance of all merged wallets
    const fromBalance = (fromWallet.crisisOnly && state.crisisMode)
      ? crisisWalletIds().reduce((s, cid) => s + (state.wallets[cid] ?? 0), 0) + (state.wallets[transferFrom] ?? 0)
      : (state.wallets[transferFrom] ?? 0);
    if(!fromWallet.track && round2(fromBalance - amt) < 0){
      toast(t({ar:`⚠ الرصيد غير كافٍ — المتاح: ⁦${fmt(Math.max(0, fromBalance))}⁩`, en:`⚠ Insufficient balance — available: ${fmt(Math.max(0, fromBalance))}`}), true);
      return;
    }
    // Track wallets are intentionally exempt from the overdraft block above (they're
    // a manual running counter, not real spendable money) — but going negative with
    // zero feedback can look like a silent bug. Warn without blocking the transfer.
    const _trackGoingNegative = fromWallet.track && round2(fromBalance - amt) < 0;
    const fromName = fromWallet.name;
    const toName = toWallet.name;

    // shared link so the two legs are deleted/undone together as one operation
    const linkId = 'lnk_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
    const txOut = {
      id: 'tx_'+Date.now()+'_a'+Math.random().toString(36).slice(2,5),
      wallet: transferFrom, desc: t({ar:'تحويل إلى ', en:'Transfer to '}) + toName, amount: amt, type:'expense', category:'transfer', ts, link: linkId
    };
    const txIn = {
      id: 'tx_'+Date.now()+'_b'+Math.random().toString(36).slice(2,5),
      wallet: transferTo, desc: t({ar:'تحويل من ', en:'Transfer from '}) + fromName, amount: amt, type:'income', category:'transfer', ts: ts+1, link: linkId
    };

    state.transactions.push(txOut, txIn);
    applyTxToBalance(txOut, +1);
    applyTxToBalance(txIn, +1);

    // saveTx first — it is the authoritative record for reconcileBalances(); if the
    // process dies between the two awaits, balances (localStorage) reflect the
    // transfer but the IDB snapshot still has the old transactions, so on next load
    // the IDB is used and balances are rebuilt from the correct post-transfer ledger.
    await saveTx();
    await saveBalances();
    closeModal('transferModal');
    render();
    if(_trackGoingNegative){
      toast(t({ar:`⚠ تم التحويل، لكن رصيد "${fromName}" أصبح سالباً`, en:`⚠ Transfer completed, but "${fromName}" balance is now negative`}), true);
    } else {
      toast(t({ar:'✓ تم التحويل بنجاح', en:'✓ Transfer successful'}));
    }
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
  // Snapshot now — detailWalletId is a shared global the user can change (by
  // opening a different wallet's detail view) while this function's awaits
  // are in flight, which would otherwise misattribute the refresh/toast below.
  const walletId = detailWalletId;
  const w = WALLET_DEFS.find(x=>x.id===walletId);
  if(!w){ toast(t({ar:'⚠ المحفظة غير موجودة', en:'⚠ Wallet not found'}), true); return; } // detailWalletId could be stale
  const newVal = parseAmount(document.getElementById('detailNewBalance').value);
  if(isNaN(newVal)){ toast(t({ar:'⚠ أدخل رصيد صحيح', en:'⚠ Enter a valid balance'}), true); return; }
  if(newVal < 0){ toast(t({ar:'⚠ الرصيد لا يمكن أن يكون سالبًا', en:'⚠ Balance cannot be negative'}), true); return; }

  const current = state.wallets[walletId] ?? 0;
  const diff = round2(newVal - current);
  if(diff === 0){ toast(t({ar:'لا يوجد تغيير بالرصيد', en:'No change to the balance'})); return; }
  // cross-op write guard (see commitQuickNotes) — block interleaving with another in-flight write
  if(_opBusy()) return;

  _updateBalanceBusy = true;
  _opInFlight++;
  _txMutationStamp++; // adds an adjustment tx — invalidate stamp-keyed caches
  const _updateBalBtn = document.getElementById('updateTrackedBalanceBtn');
  _setBtnSaving(_updateBalBtn, true, '⏳...');
  try{
    const tx = {
      id: 'tx_'+Date.now()+'_adj'+Math.random().toString(36).slice(2,4),
      wallet: walletId,
      desc: t({ar:'مزامنة رصيد ', en:'Balance sync '}) + w.name,
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
    // Only snap the modal back to this wallet if the user is still on it —
    // they may have navigated to a different wallet's detail view meanwhile.
    if(detailWalletId === walletId) openWalletDetail(walletId);
    toast(t({ar:'✓ تمت مزامنة الرصيد', en:'✓ Balance synced'}));
  } finally {
    _updateBalanceBusy = false;
    _opInFlight--;
    _setBtnSaving(_updateBalBtn, false);
  }
}

let _saveWalletBudgetBusy = false;
async function saveWalletBudget(){
  if(!detailWalletId || _saveWalletBudgetBusy) return;
  if(_opBusy()) return;
  // Guard against a wallet deleted from another tab while this detail modal was
  // open (cross-tab storage listener skips loadState while any modal is open).
  if(!WALLET_DEFS.find(x => x.id === detailWalletId)){
    toast(t({ar:'⚠ المحفظة لم تعد موجودة', en:'⚠ Wallet no longer exists'}), true);
    closeModal('walletDetailModal');
    return;
  }
  _saveWalletBudgetBusy = true;
  // was missing from _opInFlight entirely — its own await could interleave with
  // another guarded writer since no one else could see it was mid-flight
  _opInFlight++;
  try{
    const raw = document.getElementById('detailBudgetInput').value.trim();
    if(raw === ''){
      // Explicit clear: user blanked the field to remove the budget
      delete budgets[detailWalletId];
      await saveConfig();
      renderWallets();
      toast(t({ar:'✓ تم حذف الميزانية', en:'✓ Budget removed'}));
      return;
    }
    const val = round2(parseAmount(raw));
    if(!isFinite(val) || val <= 0){
      toast(t({ar:'⚠ أدخل ميزانية صحيحة أو اتركها فارغة لحذفها', en:'⚠ Enter a valid budget or leave it empty to remove it'}), true);
      return;
    }
    budgets[detailWalletId] = val;
    await saveConfig();
    renderWallets();
    toast(t({ar:'✓ تم حفظ الميزانية', en:'✓ Budget saved'}));
  } finally {
    _saveWalletBudgetBusy = false;
    _opInFlight--;
  }
}

// Staging draft for the distribution editor — changes are isolated here until
// the user taps Save. Cleared on settings close/cancel so edits don't leak.
let _distDraft = null;

function renderDistributionEditor(){
  // Create a fresh draft snapshot if none exists (first open or after cancel/save)
  if(!_distDraft) _distDraft = DISTRIBUTION.map(d=>({...d}));
  const wrap = document.getElementById('distributionEditor');
  wrap.innerHTML = '';
  _distDraft.forEach((d,i)=>{
    const w = WALLET_DEFS.find(x=>x.id===d.id);
    const row = document.createElement('div');
    row.className = 'dist-edit-row';
    row.innerHTML = `
      <span class="name">${escHtml(w ? w.name : d.id)}</span>
      <input type="text" inputmode="decimal" value="${escHtml(String(d.pct))}" data-idx="${i}" autocomplete="off">
      <span class="pct-sign">%</span>
    `;
    row.querySelector('input').oninput = (e)=>{
      const clamped = Math.min(100, Math.max(0, parseAmount(e.target.value) || 0));
      _distDraft[i].pct = clamped;
      // Sync the display to the clamped value so what the user sees = what will be saved
      if((parseAmount(e.target.value) || 0) !== clamped) e.target.value = String(clamped);
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
  const total = (_distDraft || DISTRIBUTION).reduce((s,d)=>s+(d.pct||0), 0);
  const el = document.getElementById('distTotalRow');
  if(!el) return;
  const display = total.toFixed(1);
  el.textContent = t({ar:'الإجمالي: ', en:'Total: '}) + display + '%';
  // compare using the rounded display value so color always matches what user reads
  el.className = 'dist-total ' + (parseFloat(display) === 100 ? 'ok' : 'warn');
}

// Scale every share proportionally so the set sums to EXACTLY 100, then push any
// rounding residue onto the largest share. Keeps the income split honest so the
// distribution breakdown can never show shares that exceed (or fall short of) the
// income — the old "save anyway at 95%/120%" path misled that preview.
function normalizeDistribution(){
  const arr = _distDraft || DISTRIBUTION;
  const total = arr.reduce((s,d)=>s+(d.pct||0), 0);
  if(!(total > 0)) return false;
  arr.forEach(d=>{ d.pct = Math.round(((d.pct||0)/total)*1000)/10; }); // one decimal
  const acc = arr.reduce((s,d)=>s+(d.pct||0), 0);
  const residual = Math.round((100 - acc) * 10) / 10;
  if(residual !== 0){
    let maxIdx = 0;
    arr.forEach((d,i)=>{ if((d.pct||0) > (arr[maxIdx].pct||0)) maxIdx = i; });
    arr[maxIdx].pct = Math.round((arr[maxIdx].pct + residual) * 10) / 10;
  }
  return true;
}

let _saveDistBusy = false;
async function saveDistribution(){
  if(!_distDraft || _saveDistBusy) return;
  const total = _distDraft.reduce((s,d)=>s+(d.pct||0), 0);
  if(parseFloat(total.toFixed(1)) !== 100){
    if(!(total > 0)){ toast(t({ar:'⚠ أدخل نِسبًا صحيحة أولاً', en:'⚠ Enter valid ratios first'}), true); return; }
    if(!confirm(t({ar:`الإجمالي ${total.toFixed(1)}% وليس 100%.\n\nسيتم تعديل النسب تلقائيًا لتصبح 100% مع الحفاظ على تناسبها. متابعة؟`, en:`Total is ${total.toFixed(1)}%, not 100%.\n\nRatios will be auto-adjusted to 100% while keeping their proportions. Continue?`}))) return;
  }
  // was missing this file's standard busy-flag + _opInFlight guard entirely —
  // DISTRIBUTION drives every future income auto-split, so a save racing a
  // concurrent wallet-def edit or Drive sync could interleave writes to it.
  if(_opBusy()) return;
  _saveDistBusy = true;
  _opInFlight++;
  try{
    // always normalize before saving (even when total rounds to 100%, raw float can differ)
    normalizeDistribution();
    // commit the validated+normalized draft to the live DISTRIBUTION array
    _distDraft.forEach((d, i) => { if(i < DISTRIBUTION.length) DISTRIBUTION[i].pct = d.pct; });
    _distDraft = null; // draft committed — a new open will build a fresh snapshot
    renderDistributionEditor(); // reflect the normalized values back into the inputs
    await saveConfig();
    renderWallets();
    toast(t({ar:'✓ تم حفظ النسب (المجموع 100٪)', en:'✓ Ratios saved (total 100%)'}));
  } finally {
    _saveDistBusy = false;
    _opInFlight--;
  }
}

function resetDistribution(){
  if(!confirm(t({ar:'استعادة النسب الافتراضية (50/10/10/10/10/5/5)؟', en:'Restore default ratios (50/10/10/10/10/5/5)?'}))) return;
  // filter against live WALLET_DEFS — a factory wallet the user deleted (e.g.
  // 'reserve') must not come back as an orphaned share pointing at nothing
  DISTRIBUTION = DEFAULT_DISTRIBUTION.filter(d => WALLET_DEFS.find(w => w.id === d.id && !w.track)).map(d=>({...d}));
  // keep custom regular wallets in the editor (DEFAULT only covers factory ones)
  const extra = WALLET_DEFS.filter(w => !w.track && !DISTRIBUTION.find(d => d.id === w.id)).map(w => ({id: w.id, pct: 0}));
  if(extra.length) DISTRIBUTION = DISTRIBUTION.concat(extra);
  _distDraft = null; // discard any in-progress draft so the editor picks up the reset values
  renderDistributionEditor();
  saveConfig();
  renderWallets();
  toast(t({ar:'✓ تمت الاستعادة', en:'✓ Restored'}));
}

function openWalletDetail(walletId){
  const w = WALLET_DEFS.find(x=>x.id===walletId);
  if(!w){ toast(t({ar:'⚠ المحفظة غير موجودة', en:'⚠ Wallet not found'}), true); return; }
  detailWalletId = walletId;
  const currentVal = state.wallets[walletId] ?? 0;
  document.getElementById('detailTitle').textContent = (w.track?'🏦 ':'👛 ') + w.name;
  document.getElementById('detailBalance').textContent = fmt(currentVal);

  const updateWrap = document.getElementById('detailUpdateBalance');
  const budgetWrap = document.getElementById('detailBudgetSetting');
  if(w.track){
    updateWrap.style.display = 'block';
    budgetWrap.style.display = 'none';
    document.getElementById('detailNewBalance').value = (currentVal || 0).toFixed(2);
    _updateTrackModeToggleUI(walletId); // sync the "linked expense → ينقص/يزيد" toggle
  } else {
    updateWrap.style.display = 'none';
    budgetWrap.style.display = 'block';
    document.getElementById('detailBudgetInput').value = budgets[walletId] ? groupThousandsDisplay(budgets[walletId]) : '';
  }

  const txs = state.transactions.filter(t=>t.wallet===walletId).sort((a,b)=>b.ts-a.ts);
  let inc=0, exp=0;
  txs.forEach(t => {
    if(isSystemCategory(t)) return;
    t.type==='income' ? inc+=t.amount : exp+=t.amount;
  });
  document.getElementById('detailCount').textContent = String(txs.length);
  document.getElementById('detailIncome').textContent = fmt(round2(inc));
  document.getElementById('detailExpense').textContent = fmt(round2(exp));

  const list = document.getElementById('detailTxList');
  list.innerHTML = '';
  if(txs.length === 0){
    list.innerHTML = `<div class="empty"><span class="ic">🗂</span>${t({ar:'لا توجد معاملات لهذه المحفظة', en:'No transactions for this wallet'})}</div>`;
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
          <div class="desc" dir="auto"><span class="ctag" style="background:${cat.color}22;">${cat.icon}</span> ${escHtml(tx.desc || cat.name)}</div>
          <div class="meta">${date.toLocaleDateString(_dateLocale(),{day:'numeric',month:'short',numberingSystem:'latn'})}</div>
        </div>
        <div class="amount ${cls}">${sign}${fmt(tx.amount)}</div>
      `;
      div.onclick = () => openEdit(tx.id);
      list.appendChild(div);
    });
    if(txs.length > 50){
      const hint = document.createElement('div');
      hint.style.cssText = 'padding:10px 16px; font-size:var(--fs-sm); color:var(--muted); text-align:center;';
      const extra = txs.length - 50;
      hint.textContent = t({
        ar: `… ${extra} معاملة أقدم — افتح تبويب المعاملات لرؤية الكل`,
        en: `… ${extra} older ${extra === 1 ? 'transaction' : 'transactions'} — open the Transactions tab to see all`,
      });
      list.appendChild(hint);
    }
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

function sumExpenses(start, end, categoryId, wFilter){
  let total = 0;
  state.transactions.forEach(tx=>{
    if(tx.type!=='expense' || isSystemCategory(tx)) return;
    if(tx.ts < start || tx.ts >= end) return;
    if(categoryId && tx.category !== categoryId) return;
    if(wFilter && tx.wallet !== wFilter) return;
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
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><span class="ic">📊</span>${t({ar:'سجّل أول معاملة من ＋ لترى تحليلاتك هنا', en:'Log your first transaction via ＋ to see your insights here'})}</div>`;
    return;
  }

  const [curStart, curEnd] = monthRange(0);
  const [prevStart, prevEnd] = monthRange(1);

  // cache analytics totals — expensive full-scan, only recompute when txs or filter
  // change. _txMutationStamp catches in-place edits that don't change length/last-id
  // (see the identical reasoning on getFilteredTx's sig, app.ui.js).
  const aSig = state.transactions.length + '|' + (state.transactions[state.transactions.length-1]?.id||'') + '|' + curStart + '|' + (walletFilter||'') + '|' + _txMutationStamp;
  if(aSig !== _analyticsSig || !_analyticsCache){
    _analyticsCache = { cur: sumExpenses(curStart, curEnd, null, walletFilter), prev: sumExpenses(prevStart, prevEnd, null, walletFilter) };
    _analyticsSig = aSig;
  }
  const curTotal = _analyticsCache.cur;
  const prevTotal = _analyticsCache.prev;

  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  let cmpHtml = '';
  if(prevTotal > 0 && (dayOfMonth > 1 || curTotal > 0)){
    // Compare against the previous month PRORATED to the same day — a raw
    // full-month comparison shows "▼ ~95%" on the 2nd of every month and only
    // becomes meaningful at month end. day 0 of this month = last day of prev.
    const daysInPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const prevSameDay = prevTotal * Math.min(1, dayOfMonth / daysInPrevMonth);
    const diff = curTotal - prevSameDay;
    const pct = Math.abs(diff/prevSameDay*100).toFixed(0);
    const up = diff > 0;
    cmpHtml = `<div class="sub ${up?'up':'down'}">${up?'▲':'▼'} ${pct}${t({ar:'% عن نفس الفترة من الشهر الماضي', en:'% vs same period last month'})}</div>`;
  } else {
    cmpHtml = `<div class="sub">${t({ar:'لا توجد بيانات للشهر الماضي', en:'No data for last month'})}</div>`;
  }
  const cardHtml = `
    <div class="analytics-card">
      <div class="l">${t({ar:'مصروف هذا الشهر', en:"This month's spending"})}</div>
      <div class="v">${fmt(curTotal)}</div>
      ${cmpHtml}
    </div>`;
  let projHtml;
  if(dayOfMonth >= 3 && curTotal > 0){
    const dailyRate = curTotal / dayOfMonth;
    const projected = dailyRate * daysInMonth;
    projHtml = `
      <div class="analytics-card">
        <div class="l">${t({ar:'المتوقع نهاية الشهر', en:'Expected by month end'})}</div>
        <div class="v">${fmt(projected)}</div>
        <div class="sub">${t({ar:'بمعدل', en:'At a rate of'})} ${fmt(dailyRate)} / ${t({ar:'يوم', en:'day'})}</div>
      </div>`;
  } else {
    projHtml = `
      <div class="analytics-card">
        <div class="l">${t({ar:'المتوقع نهاية الشهر', en:'Expected by month end'})}</div>
        <div class="v">—</div>
        <div class="sub">${t({ar:'يحتاج بيانات أكثر', en:'Needs more data'})}</div>
      </div>`;
  }
  // Single assignment instead of two `+=` passes — each += re-parses the
  // grid's already-accumulated HTML from scratch before appending the next bit.
  grid.innerHTML = cardHtml + projHtml;
}

let _recurringCache = null;
let _recurringCacheSig = '';
function detectRecurring(){
  // _txMutationStamp is included so in-place edits (amount/desc change on the
  // same last-tx-id) are detected without relying on render() to null the cache.
  // include subscription names+amounts (not just count) so renaming/repricing a
  // subscription re-evaluates matchesTrackedSub even when the count is unchanged.
  const _subsSig = subscriptions.map(s => s.name + ':' + s.amount).join(',');
  const sig = state.transactions.length + '|' + (state.transactions[state.transactions.length-1]?.id||'') + '|' + dismissedRecurring.size + '|' + _subsSig + '|' + _txMutationStamp;
  if(sig === _recurringCacheSig && _recurringCache) return _recurringCache;
  _recurringCacheSig = sig;

  const groups = {};
  state.transactions.forEach(tx=>{
    if(tx.type!=='expense' || isSystemCategory(tx)) return;
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
  const trackedSubs = subscriptions.map(s => ({ name: normalizeSearch(s.name), amount: s.amount })).filter(s => s.name.length > 0 && s.amount > 0);
  function matchesTrackedSub(desc, avg){
    const normDesc = normalizeSearch(desc);
    if(!normDesc) return false;
    return trackedSubs.some(s =>
      // One-directional only: the transaction description must contain the
      // subscription name (not the reverse). The old bidirectional check
      // (s.name.includes(normDesc)) let a short subscription name like "نت"
      // suppress unrelated expenses whose whole description was a substring of
      // the sub name. Require >= 3 chars so a 1-2 letter name can't match broadly.
      s.name.length >= 3 &&
      normDesc.includes(s.name) &&
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
    const latest = txs.reduce((a,b) => b.ts > a.ts ? b : a);
    if(matchesTrackedSub(latest.desc, avg)) return;

    suggestions.push({ key, desc: latest.desc, avg, count: txs.length, wallet: latest.wallet, category: latest.category });
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
      <div class="title">🔁 ${escHtml(t({ar:'معاملة متكررة محتملة', en:'Potential recurring transaction'}))}</div>
      <div class="desc">${cat.icon} "${escHtml(s.desc)}" — ${escHtml(t({ar:`تكررت ${s.count} مرات بمتوسط ${fmt(s.avg)}`, en:`Repeated ${s.count} times, averaging ${fmt(s.avg)}`}))} (${escHtml(wallet?wallet.name:'')})</div>
      <div class="actions">
        <button class="btn-secondary" data-dismiss="${escHtml(s.key)}">${escHtml(t({ar:'تجاهل', en:'Dismiss'}))}</button>
        <button class="btn-primary" data-remind="${escHtml(s.key)}">⏰ ${escHtml(t({ar:'سجّلها الآن', en:'Record it now'}))}</button>
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
      amtEl.value = String(round2(s.avg));
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
      toast(t({ar:'✓ تم تعبية النموذج — راجع وسجّل المعاملة', en:'✓ Form filled — review and save the transaction'}));
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
// Registers with app.core.js's cache-invalidation registry instead of being
// hand-listed at every place the transactions array gets replaced/committed
// (saveTx/loadState/mergeCloudData) — a backward reference into app.core.js,
// which has already fully loaded and executed by the time this file parses,
// so it's safe at parse time (unlike a forward reference into a not-yet-run
// file, the one case this codebase actually has to guard against).
invalidateOnTxCommit(() => { _allTxSortedCache = null; });
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
    // Arabic-Indic/Persian digits → ASCII, so a description typed with a
    // numeric keyboard defaulting to ٠-٩ (already known to happen — see
    // normalizeDigits, app.core.js) still matches a search typed in Western
    // digits and vice versa. Digit-only (not the full normalizeDigits, which
    // also reinterprets commas as decimal/thousands separators — the right
    // call for an amount field, not free-text search where a comma is just
    // punctuation).
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
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
  _searchDebounce = setTimeout(()=>{
    if(currentTab === 'transactions') renderRecentTx();
    renderTxList();
    if(currentTab === 'reports') scrollToTxList();
  }, 150);
}
function clearSearch(){
  searchQuery = '';
  document.getElementById('searchInput').value = '';
  document.getElementById('searchBox').classList.remove('has-text');
  _txVisibleCount = 50;
  if(currentTab === 'transactions') renderRecentTx();
  renderTxList();
}

let _filteredTxCache = null;
let _filteredTxSig = '';
function getFilteredTx(){
  // include today's date for every time-bounded filter (day/week/month/year all
  // shift at a day boundary) so the cache invalidates across a midnight/month/
  // year rollover instead of showing the previous period's transactions
  const dateKey = currentFilter === 'all' ? '' : todayISO();
  // _txMutationStamp catches in-place edits (amount/desc/date/wallet/category on
  // an EXISTING tx) that don't change state.transactions.length — without it,
  // render() had to blanket-reset this cache on every single call regardless
  // of whether anything relevant actually changed (see render(), app.main.js).
  const sig = state.transactions.length + '|' + currentFilter + '|' + walletFilter + '|' + categoryFilter + '|' + searchQuery + '|' + dateKey + '|' + _txMutationStamp;
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
  if(list._cancelSwipe) list._cancelSwipe(); // abort any in-progress swipe before its row is wiped
  list.innerHTML = '';
  // getFilteredTx() is already cached AND sorted newest-first — use it directly
  // (read-only here; the visible slice below makes its own copy)
  const filtered = getFilteredTx();

  let income = 0, expense = 0;
  filtered.forEach(tx => {
    // exclude inter-wallet transfers AND manual balance adjustments so the
    // income/expense summary matches the category pie chart (which excludes both)
    if(isSystemCategory(tx)) return;
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
      list.innerHTML = `<div class="empty"><span class="ic">🗂</span>${t({ar:'لا توجد معاملات بعد.', en:'No transactions yet.'})}<br><br>
        <button class="btn-primary empty-add-first" style="width:auto; padding:10px 20px; display:inline-block; margin-bottom:8px;">＋ ${t({ar:'أضف أول معاملة', en:'Add your first transaction'})}</button><br>
        <button class="btn-secondary empty-import-json" style="width:auto; padding:8px 16px; display:inline-block; font-size:var(--fs-sm);">⬆ ${t({ar:'استيراد من JSON', en:'Import from JSON'})}</button>
      </div>`;
      // property-bound (CSP blocks onclick= attributes in generated markup)
      const addBtn = list.querySelector('.empty-add-first');
      if(addBtn) addBtn.onclick = toggleAddDrawer;
      const impBtn = list.querySelector('.empty-import-json');
      if(impBtn) impBtn.onclick = () => openSettingsTab('data');
    } else {
      list.innerHTML = `<div class="empty"><span class="ic">🗂</span>${t({ar:'لا توجد معاملات', en:'No transactions'})}${searchQuery ? t({ar:' مطابقة لبحثك', en:' matching your search'}) : t({ar:' في هذه الفترة', en:' in this period'})}</div>`;
    }
    return;
  }

  let lastDay = null;
  const visible = filtered.slice(0, _txVisibleCount);
  // Hoisted per-render: Intl formatter CONSTRUCTION is the expensive part of
  // toLocale*String (~0.1ms+ each) and it used to run 3× per row; and rows are
  // batched into a fragment so the live #txList takes ONE append (a per-row
  // live append forced a reflow per row — the same fix renderRecentTx already
  // got in v47.38, which this list never received).
  const _frag = document.createDocumentFragment();
  const _timeFmt = new Intl.DateTimeFormat(_dateLocale(), {hour:'2-digit', minute:'2-digit', numberingSystem:'latn'});
  const _ariaDateFmt = new Intl.DateTimeFormat(_dateLocale(), {day:'numeric', month:'long', numberingSystem:'latn'});
  const _dayLabelFmt = new Intl.DateTimeFormat(_dateLocale(), {weekday:'long', day:'numeric', month:'long', numberingSystem:'latn'});
  const _todayKey = new Date().toDateString();
  const _yest = new Date(); _yest.setDate(_yest.getDate()-1); // calendar day (not 24h) — DST-safe
  const _yestKey = _yest.toDateString();
  visible.forEach(tx => {
    const wallet = WALLET_DEFS.find(w => w.id === tx.wallet);
    const date = new Date(tx.ts);
    const dayKey = date.toDateString();
    if(dayKey !== lastDay){
      lastDay = dayKey;
      const lbl = document.createElement('div');
      lbl.className = 'tx-day-label';
      lbl.textContent = dayKey === _todayKey ? t({ar:'اليوم', en:'Today'}) : dayKey === _yestKey ? t({ar:'أمس', en:'Yesterday'}) : _dayLabelFmt.format(date);
      _frag.appendChild(lbl);
    }

    const wrap = document.createElement('div');
    wrap.className = 'tx-wrap';
    wrap.setAttribute('role','listitem');

    const bg = document.createElement('div');
    bg.className = 'tx-swipe-bg';
    bg.innerHTML = `🗑 ${t({ar:'حذف', en:'Delete'})}`;

    const div = document.createElement('div');
    div.className = 'tx';
    const sign = tx.type === 'expense' ? '-' : '+';
    const cls = tx.type === 'expense' ? 'neg' : 'pos';
    const timeStr = _timeFmt.format(date);
    const cat = getCategory(tx.category);
    div.innerHTML = `
      <div class="info">
        <div class="desc" dir="auto">${escHtml(tx.desc || (wallet ? wallet.name : ''))}</div>
        <div class="meta"><span class="ctag" style="background:${cat.color}22;">${cat.icon}</span><span class="wtag">${escHtml(wallet ? wallet.name : '')}</span> ${timeStr}${_trackLinkTag(tx)}</div>
      </div>
      <div class="right">
        <div class="amount ${cls}">${sign}${fmt(tx.amount)}</div>
        <button class="edit-btn" aria-label="${t({ar:'تعديل', en:'Edit'})}">✎</button>
      </div>
    `;
    // Accessible name for the whole row so a screen reader announces what this
    // transaction is, not just the bare amount + an isolated "تعديل" button.
    // see the matching aria-label in renderRecentTx: setAttribute needs bidi
    // stripping, not HTML-escaping, since it never interprets markup.
    div.setAttribute('aria-label',
      `${t(tx.type==='expense'?{ar:'مصروف',en:'Expense'}:{ar:'دخل',en:'Income'})} ${fmt(tx.amount)}${t({ar:'،',en:','})} ${stripBidiControls(tx.desc) || (wallet?wallet.name:'')}${t({ar:'،',en:','})} ${cat.name}${t({ar:'،',en:','})} ${_ariaDateFmt.format(date)} ${timeStr}`);
    // `wrap` (parent) already carries role="listitem" for the list structure, so
    // this nested element can be the actual interactive control — previously it
    // was click-only, leaving keyboard/screen-reader users no way to open it.
    div.setAttribute('role','button');
    div.setAttribute('tabindex','0');
    div.dataset.txid = tx.id; // delegated swipe handler reads the id from here
    div.querySelector('.edit-btn').onclick = (e) => { e.stopPropagation(); if(!div._swipeDeleting) openEdit(tx.id); };
    div.onclick = () => { if(!div._swipeDeleting) openEdit(tx.id); };
    div.onkeydown = (e) => { if((e.key==='Enter'||e.key===' ') && !div._swipeDeleting){ e.preventDefault(); openEdit(tx.id); } };

    wrap.appendChild(bg);
    wrap.appendChild(div);
    _frag.appendChild(wrap);
  });
  list.appendChild(_frag); // single live-DOM append for the whole batch

  // One set of delegated touch listeners on the list container (bound once),
  // instead of 4 listeners per row that accumulated on every re-render.
  bindSwipeDelegation(list);

  if(filtered.length > _txVisibleCount){
    const remaining = filtered.length - _txVisibleCount;
    const more = document.createElement('button');
    more.className = 'btn-secondary';
    more.style.cssText = 'margin:10px auto; display:block; width:auto; padding:10px 24px; font-size:var(--fs-base);';
    const toShow = Math.min(remaining, 50);
    const afterLoad = remaining - toShow;
    more.textContent = afterLoad > 0
      ? t({
          ar: `⬇ عرض ${arPlural(toShow, 'معاملة', 'معاملتين', 'معاملات')} (${arPlural(afterLoad, 'ستبقى مخفية', 'ستبقيان مخفيتين', 'ستبقى مخفية', 'واحدة ستبقى مخفية')})`,
          en: `⬇ Show ${toShow} more ${toShow===1?'transaction':'transactions'} (${afterLoad} will remain hidden)`,
        })
      : t({
          ar: `⬇ عرض ${arPlural(toShow, 'المعاملة المتبقية', 'المعاملتين المتبقيتين', 'المعاملات المتبقية', 'المعاملة المتبقية')}`,
          en: `⬇ Show the remaining ${toShow} ${toShow===1?'transaction':'transactions'}`,
        });
    more.onclick = () => { _txVisibleCount += 50; renderTxList(); };
    list.appendChild(more);
  } else if(_txVisibleCount > 50 && filtered.length > 50){
    // Already expanded beyond the first page — offer a way to collapse back,
    // same pattern as the Transactions tab's collapse control (renderRecentTx)
    // which this list never got.
    const collapse = document.createElement('button');
    collapse.className = 'btn-secondary';
    collapse.style.cssText = 'margin:10px auto; display:block; width:auto; padding:10px 24px; font-size:var(--fs-base);';
    collapse.textContent = `⬆ ${t({ar:'طيّ القائمة', en:'Collapse list'})}`;
    collapse.onclick = () => { _txVisibleCount = 50; renderTxList(); document.getElementById('tabReports')?.scrollIntoView({behavior:'smooth', block:'start'}); };
    list.appendChild(collapse);
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
  // Exposed so renderTxList() can cancel an in-progress drag before wiping the
  // list — otherwise a re-render mid-swipe (e.g. Drive sync merging in the
  // background) leaves `el` pointing at a detached node while finish() still
  // fires deleteTx(txId) on touchend, deleting whatever that stale id was.
  list._cancelSwipe = () => {
    if(el){ el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; el.style.willChange = ''; }
    reset();
  };

  list.addEventListener('touchstart', e=>{
    // A second finger landing mid-swipe must not hijack the gesture state —
    // otherwise touchmove/touchend (which only ever read touches[0]) can end up
    // tracking the wrong row, swiping one row visually while deleting another.
    if(e.touches.length > 1){ reset(); return; }
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
    if(e.touches.length > 1){ finish(true); return; } // second finger joined mid-swipe — abort, don't guess
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

