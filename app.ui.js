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
let _heroStatsCache = null;
let _heroStatsSig = '';
function _buildMonthlyExpenseCache(){
  const now = new Date();
  const cache = {};
  state.transactions.forEach(tx=>{
    if(tx.type!=='expense' || tx.category==='transfer' || tx.category==='adjustment') return;
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
      <button class="wallet-cta-btn" type="button" onclick="openAddDrawer(); setAddFormType('income');">＋ ${escHtml(t({ar:'سجّل أول دخل', en:'Record first income'}))}</button>
    `;
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
      budgetHtml = `
        <div class="budget-row">
          <div class="bar" style="margin-top:6px;"><i style="transform:scaleX(${ratio.toFixed(4)}); background:${color};"></i></div>
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
    const pctBtn = w.track
      ? `<div class="pct" onclick="event.stopPropagation(); openWalletDetail('${w.id}')" aria-label="${escHtml(t({ar:`مزامنة الرصيد الفعلي لـ ${w.name} — ${trackSharePct}% من إجمالي محافظك`, en:`Sync actual balance for ${w.name} — ${trackSharePct}% of your total wallets`}))}" title="${escHtml(t({ar:'مزامنة الرصيد الفعلي', en:'Sync actual balance'}))}">⚖️ ${trackSharePct}%</div>`
      : `<div class="pct" onclick="event.stopPropagation(); openWalletDetail('${w.id}')" aria-label="${escHtml(t({ar:`تفاصيل ${w.name}`, en:`Details for ${w.name}`}))}" title="${escHtml(t({ar:'التفاصيل', en:'Details'}))}">ⓘ ${escHtml(w.crisisOnly && state.crisisMode ? crisisWalletIds().reduce((s,id)=>{const wd=WALLET_DEFS.find(x=>x.id===id);return s+(wd?(parseFloat(getWalletPctLabel(wd))||0):0);},0)+'%' : getWalletPctLabel(w))}</div>`;
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
    grid.appendChild(div);
  });

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
        ? `<button class="rd-view" onclick="openWalletDetail('${w.id}')" aria-label="${escHtml(t({ar:'مزامنة الرصيد الفعلي لـ', en:'Sync actual balance for'}))} ${escHtml(w.name)}" title="${escHtml(t({ar:'مزامنة الرصيد الفعلي', en:'Sync actual balance'}))}">⚖️</button>`
        : `<button class="rd-view" onclick="openWalletDetail('${w.id}')" aria-label="${escHtml(t({ar:'تفاصيل', en:'Details for'}))} ${escHtml(w.name)}" title="${escHtml(t({ar:'التفاصيل والميزانية', en:'Details and budget'}))}">ⓘ</button>`;
      return `
      <div class="reorder-row">
        <div class="reorder-label">${escHtml(w.name)}</div>
        <div class="reorder-btns">
          ${viewBtn}
          <button onclick="openWalletDefModal('${w.id}')" aria-label="${escHtml(t({ar:'تعديل', en:'Edit'}))} ${escHtml(w.name)}">✎</button>
          <button onclick="moveWalletDef('${w.id}',-1)" ${i===0?'disabled':''} aria-label="${escHtml(t({ar:'تحريك لأعلى', en:'Move up'}))}">▲</button>
          <button onclick="moveWalletDef('${w.id}',1)" ${i===list.length-1?'disabled':''} aria-label="${escHtml(t({ar:'تحريك لأسفل', en:'Move down'}))}">▼</button>
          <button class="rd-del" onclick="deleteWalletDef('${w.id}')" ${blockDelete?'disabled':''} aria-label="${escHtml(t({ar:'حذف', en:'Delete'}))} ${escHtml(w.name)}">🗑</button>
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
}

// Refresh every cache/UI surface that reads wallet id/name/order, beyond the
// main render() loop — the add-form / edit-modal wallet pickers memoize a
// signature that doesn't include the name, so a pure rename wouldn't
// otherwise show up until something else changed their selection.
function refreshAfterWalletDefsChange(){
  _walletSelectSig = '';
  _editWalletSelectSig = '';
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
  const nameInput = document.getElementById('walletDefName');
  const name = stripBidiControls(nameInput.value).trim().slice(0,40);
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
      WALLET_DEFS.push({ id, name, initial:0, track, pct: track ? 'تتبع' : '0%' });
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
  if(!editingWalletDefId) return;
  if(await deleteWalletDef(editingWalletDefId)) closeModal('walletDefModal');
}

/* ============================================================
   WALLET SELECT (add form)
============================================================ */
let _walletSelectSig = '';
function renderWalletSelect(){
  const sig = selectedWallet + '|' + SELECTABLE_WALLETS.map(w => {
    const v = (w.crisisOnly && state.crisisMode)
      ? crisisWalletIds().reduce((s, id) => s + (state.wallets[id] ?? 0), 0) + (state.wallets[w.id] ?? 0)
      : (state.wallets[w.id] ?? 0);
    return w.id + ':' + v;
  }).join(',');
  if(sig === _walletSelectSig) return;
  _walletSelectSig = sig;
  const menu = document.getElementById('walletMenu');
  menu.innerHTML = '';
  SELECTABLE_WALLETS.forEach(w => {
    const opt = document.createElement('div');
    opt.className = 'opt' + (w.id === selectedWallet ? ' selected' : '');
    opt.setAttribute('role','option');
    opt.tabIndex = 0; // keyboard-reachable when the menu is open
    const val = (w.crisisOnly && state.crisisMode)
      ? crisisWalletIds().reduce((s, id) => s + (state.wallets[id] ?? 0), 0) + (state.wallets[w.id] ?? 0)
      : (state.wallets[w.id] ?? 0);
    opt.innerHTML = `<span>${escHtml(w.name)}</span><span class="bal">${fmt(val)}</span>`;
    opt.onclick = () => selectWallet(w.id);
    opt.onkeydown = (e) => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); selectWallet(w.id); } };
    menu.appendChild(opt);
  });
  const wDef = WALLET_DEFS.find(w => w.id === selectedWallet);
  document.getElementById('walletSelectLabel').textContent = wDef ? wDef.name : t({ar:'اختر محفظة', en:'Choose a wallet'});
}
function toggleWalletMenu(){
  const wrap = document.getElementById('walletMenuWrap');
  const btn = document.getElementById('walletSelectBtn');
  const isOpen = wrap.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
  btn.setAttribute('aria-expanded', String(isOpen));
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
        ? t({ar:`↪ سيزيد رقم «${w ? w.name : ''}» بقيمة المصروف تلقائياً (عدّاد إنفاق). غيّر السلوك من تفاصيل المحفظة ⓘ.`, en:`↪ "${w ? w.name : ''}" will automatically increase by the expense amount (spending counter). Change this behavior from wallet details ⓘ.`})
        : t({ar:`↪ سينقص رصيد «${w ? w.name : ''}» بقيمة المصروف تلقائياً (رصيد فعلي). غيّر السلوك من تفاصيل المحفظة ⓘ.`, en:`↪ "${w ? w.name : ''}" balance will automatically decrease by the expense amount (actual balance). Change this behavior from wallet details ⓘ.`});
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
    // prefer inserting just after the nearest earlier default key that's present
    for(let j = di - 1; j >= 0; j--){
      const idx = valid.indexOf(def[j]);
      if(idx !== -1){ insertAt = idx + 1; break; }
    }
    // if none precede it, insert before the nearest later default key that's present
    if(insertAt === valid.length){
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
    return `<button class="nav-item${on ? ' active' : ''}" id="nav${capTab(key)}" onclick="switchTab('${key}')" aria-label="${escHtml(label)}" aria-current="${on ? 'page' : 'false'}"><span class="nav-ic">${d.icon}</span><span>${escHtml(label)}</span></button>`;
  };
  const fabLabel = escHtml(t('drawer.addTx'));
  inner.innerHTML =
    tabOrder.slice(0, half).map(item).join('') +
    `<div class="nav-fab"><button class="fab-btn" onclick="toggleAddDrawer()" aria-label="${fabLabel}" title="${fabLabel}">＋</button></div>` +
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
        <button onclick="moveLayout('${scope}','${key}',-1)" ${idx===0?'disabled':''} aria-label="${moveUpLabel}">▲</button>
        <button onclick="moveLayout('${scope}','${key}',1)" ${idx===len-1?'disabled':''} aria-label="${moveDownLabel}">▼</button>
      </div>
    </div>`;

  // Build the segmented tab strip
  const tabs = LAYOUT_EDITOR_TABS.map(td => {
    const lbl = t(td.label);
    return `<button class="le-tab${_layoutEditorTab===td.id?' active':''}" onclick="switchLayoutEditorTab('${td.id}')" aria-label="${lbl}">${td.icon} <span>${lbl}</span></button>`;
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
        <select class="recent-limit-select" aria-label="${t({ar:'عدد المعاملات المعروضة', en:'Number of transactions shown'})}" onchange="setRecentTxLimit(parseInt(this.value,10))">${optHtml}</select>
      </div>
    </div>`;
  }

  host.innerHTML = html;
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
  // stack openModal/closeModal use in app.logic.js
  if(wasClosed) _focusStack.push(document.activeElement);
  addDrawerOpen = true;
  switchDrawerTab(0); // always open on Details tab so amount/date are immediately visible
  document.getElementById('addDrawer').classList.add('open');
  document.getElementById('addDrawerOverlay').classList.add('open');
  // blur the trigger BEFORE hiding its ancestor from the a11y tree (see openModal
  // in app.logic.js for why) — the real focus-in-drawer happens a frame later below.
  if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
  _setBackgroundHidden(true);
  document.body.style.overflow = 'hidden';
  capDateInputsToToday();
  // Same back-button bookkeeping as openModal/closeModal (see app.logic.js) so
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
  if(!_anyOverlayOpen()){ document.body.style.overflow = ''; _setBackgroundHidden(false); }
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
        : date.toLocaleDateString(_dateLocale(),{weekday:'long', day:'numeric', month:'long', numberingSystem:'latn'});
      frag.appendChild(lbl);
      card = document.createElement('div');
      card.className = 'recent-card';
      card.setAttribute('role','list');
      frag.appendChild(card);
    }
    const timeStr = date.toLocaleTimeString(_dateLocale(),{hour:'2-digit',minute:'2-digit',numberingSystem:'latn'});
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
    more.style.cssText = 'margin:14px auto 0; display:block; width:auto; padding:10px 24px; font-size:13px;';
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
    collapse.style.cssText = 'margin:14px auto 0; display:block; width:auto; padding:10px 24px; font-size:13px;';
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
  const nameInput = document.getElementById('subName');
  const amountInput = document.getElementById('subAmount');
  const dayInput = document.getElementById('subBillingDay');
  const name = nameInput.value.trim().slice(0,60);
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
  if(_saveSubBusy || !editingSubId) return;
  if(!confirm(t({ar:'حذف هذا الاشتراك نهائياً؟', en:'Permanently delete this subscription?'}))) return;
  _saveSubBusy = true;
  _opInFlight++;
  try{
    subscriptions = subscriptions.filter(s=>s.id!==editingSubId);
    await saveSubs();
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
    opt.innerHTML = `<span>${escHtml(w.name)}</span><span class="bal">${fmt(val)}</span>`;
    const _pick = () => { editWallet = w.id; document.getElementById('editWalletMenuWrap').classList.remove('open'); const eb = document.getElementById('editWalletBtn'); eb.classList.remove('open'); eb.setAttribute('aria-expanded','false'); renderEditWalletSelect(); };
    opt.onclick = _pick;
    opt.onkeydown = (e) => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _pick(); } };
    menu.appendChild(opt);
  });
  const wDef = WALLET_DEFS.find(w => w.id === editWallet);
  document.getElementById('editWalletLabel').textContent = wDef ? wDef.name : t({ar:'اختر محفظة', en:'Choose a wallet'});
}
function toggleEditWalletMenu(){
  const wrap = document.getElementById('editWalletMenuWrap');
  const btn = document.getElementById('editWalletBtn');
  const isOpen = wrap.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
  btn.setAttribute('aria-expanded', String(isOpen));
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
    toast(t({ar:'⚠ متصفحك لا يدعم الإدخال الصوتي', en:'⚠ Your browser does not support voice input'}), true);
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
      toast(t({ar:'⚠ يجب السماح بالوصول للميكروفون', en:'⚠ Microphone access must be allowed'}), true);
    } else if(e.error !== 'aborted'){
      toast(t({ar:'⚠ تعذر التعرف على الصوت، حاول مرة أخرى', en:'⚠ Could not recognize speech, try again'}), true);
    }
  };

  voiceRecognition.onresult = (event) => {
    // same stale-instance guard cleanup() uses above — without it, a result that
    // arrives just after abort() (cancel-tap) but before onend fires would still
    // apply the discarded transcript, defeating the whole point of abort().
    if(voiceRecognition !== thisRecognition) return;
    if(!event.results || !event.results[0] || !event.results[0][0]) return;
    const transcript = event.results[0][0].transcript.trim();
    if(!transcript){
      toast(t({ar:'🎤 لم يُفهم الكلام — حاول مجددًا', en:'🎤 Speech not understood — try again'}), true);
      return;
    }
    applyVoiceTranscript(transcript);
  };

  try{ voiceRecognition.start(); }
  catch(e){ cleanup(); toast(t({ar:'⚠ تعذر بدء التعرف الصوتي', en:'⚠ Could not start voice recognition'}), true); }
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
    amtEl.value = String(amount);
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
    toast(t({ar:'🎤 لم يتم العثور على رقم — اكتب المبلغ يدويًا', en:'🎤 No number found — enter the amount manually'}), true);
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
  // if current category is incompatible with new type, reset to 'other'
  const cat = CATEGORIES.find(c=>c.id===selectedCategory);
  if(cat && !cat.types.includes(type)) selectedCategory = 'other';
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
      opt.innerHTML = `<span>${escHtml(w.name)}</span><span class="bal">${fmt(val)}</span>`;
      const _pick = () => {
        if(dir==='from') transferFrom = w.id; else transferTo = w.id;
        const k = dir==='from'?'From':'To';
        document.getElementById('transfer'+k+'MenuWrap').classList.remove('open');
        const tb = document.getElementById('transfer'+k+'Btn');
        tb.classList.remove('open');
        tb.setAttribute('aria-expanded','false');
        renderTransferMenus();
      };
      opt.onclick = _pick;
      opt.onkeydown = (e) => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); _pick(); } };
      menu.appendChild(opt);
    });
    const wDef = WALLET_DEFS.find(w=>w.id===selected);
    document.getElementById('transfer'+(dir==='from'?'From':'To')+'Label').textContent = wDef ? wDef.name : t({ar:'اختر محفظة', en:'Choose a wallet'});
  });
}
function toggleTransferMenu(dir){
  const key = dir==='from' ? 'From' : 'To';
  const wrap = document.getElementById('transfer'+key+'MenuWrap');
  const btn = document.getElementById('transfer'+key+'Btn');
  const isOpen = wrap.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
  btn.setAttribute('aria-expanded', String(isOpen));
}

let _doTransferBusy = false;
async function doTransfer(){
  if(_doTransferBusy) return;
  const amountInput = document.getElementById('transferAmount');
  const amt = round2(parseAmount(amountInput.value)); // cent precision — match display, avoid sub-cent drift
  if(!isFinite(amt) || amt <= 0){ toast(t({ar:'⚠ أدخل مبلغ صحيح', en:'⚠ Enter a valid amount'}), true); amountInput.focus(); return; }
  if(!transferFrom || !transferTo){ toast(t({ar:'⚠ اختر المحفظتين أولاً', en:'⚠ Choose both wallets first'}), true); return; }
  if(transferFrom === transferTo){ toast(t({ar:'⚠ اختر محفظتين مختلفتين', en:'⚠ Choose two different wallets'}), true); return; }
  // cross-op write guard (see commitQuickNotes) — block interleaving with another in-flight write
  if(_opInFlight > 0){ toast(t({ar:'⏳ هناك عملية قيد التنفيذ — أعد المحاولة بعد لحظة', en:'⏳ Another operation is in progress — try again in a moment'}), true); return; }
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

    await saveBalances();
    await saveTx();
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
  if(_opInFlight > 0){ toast(t({ar:'⏳ هناك عملية قيد التنفيذ — أعد المحاولة بعد لحظة', en:'⏳ Another operation is in progress — try again in a moment'}), true); return; }

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
  // Guard against a wallet deleted from another tab while this detail modal was
  // open (cross-tab storage listener skips loadState while any modal is open).
  if(!WALLET_DEFS.find(x => x.id === detailWalletId)){
    toast(t({ar:'⚠ المحفظة لم تعد موجودة', en:'⚠ Wallet no longer exists'}), true);
    closeModal('walletDetailModal');
    return;
  }
  _saveWalletBudgetBusy = true;
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
      <input type="number" min="0" max="100" step="any" inputmode="decimal" value="${d.pct}" data-idx="${i}">
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

async function saveDistribution(){
  if(!_distDraft) return;
  const total = _distDraft.reduce((s,d)=>s+(d.pct||0), 0);
  if(parseFloat(total.toFixed(1)) !== 100){
    if(!(total > 0)){ toast(t({ar:'⚠ أدخل نِسبًا صحيحة أولاً', en:'⚠ Enter valid ratios first'}), true); return; }
    if(!confirm(t({ar:`الإجمالي ${total.toFixed(1)}% وليس 100%.\n\nسيتم تعديل النسب تلقائيًا لتصبح 100% مع الحفاظ على تناسبها. متابعة؟`, en:`Total is ${total.toFixed(1)}%, not 100%.\n\nRatios will be auto-adjusted to 100% while keeping their proportions. Continue?`}))) return;
  }
  // always normalize before saving (even when total rounds to 100%, raw float can differ)
  normalizeDistribution();
  // commit the validated+normalized draft to the live DISTRIBUTION array
  _distDraft.forEach((d, i) => { if(i < DISTRIBUTION.length) DISTRIBUTION[i].pct = d.pct; });
  _distDraft = null; // draft committed — a new open will build a fresh snapshot
  renderDistributionEditor(); // reflect the normalized values back into the inputs
  await saveConfig();
  renderWallets();
  toast(t({ar:'✓ تم حفظ النسب (المجموع 100٪)', en:'✓ Ratios saved (total 100%)'}));
}

function resetDistribution(){
  if(!confirm(t({ar:'استعادة النسب الافتراضية (50/10/10/10/10/5/5)؟', en:'Restore default ratios (50/10/10/10/10/5/5)?'}))) return;
  DISTRIBUTION = DEFAULT_DISTRIBUTION.map(d=>({...d}));
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
  document.getElementById('detailTitle').textContent = (w.track?'🏦 ':'💳 ') + w.name;
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
    document.getElementById('detailBudgetInput').value = budgets[walletId] || '';
  }

  const txs = state.transactions.filter(t=>t.wallet===walletId).sort((a,b)=>b.ts-a.ts);
  let inc=0, exp=0;
  txs.forEach(t => {
    if(t.category==='transfer' || t.category==='adjustment') return;
    t.type==='income' ? inc+=t.amount : exp+=t.amount;
  });
  document.getElementById('detailCount').textContent = String(txs.length);
  document.getElementById('detailIncome').textContent = fmt(round2(inc));
  document.getElementById('detailExpense').textContent = fmt(round2(exp));

  const list = document.getElementById('detailTxList');
  list.innerHTML = '';
  if(txs.length === 0){
    list.innerHTML = `<div class="empty" style="padding:20px;">${t({ar:'لا توجد معاملات لهذه المحفظة', en:'No transactions for this wallet'})}</div>`;
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
          <div class="desc" dir="auto">${cat.icon} ${escHtml(tx.desc || cat.name)}</div>
          <div class="meta">${date.toLocaleDateString(_dateLocale(),{day:'numeric',month:'short',numberingSystem:'latn'})}</div>
        </div>
        <div class="amount ${cls}">${sign}${fmt(tx.amount)}</div>
      `;
      div.onclick = () => openEdit(tx.id);
      list.appendChild(div);
    });
    if(txs.length > 50){
      const hint = document.createElement('div');
      hint.style.cssText = 'padding:10px 16px; font-size:12px; color:var(--muted); text-align:center;';
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
    if(tx.type!=='expense' || tx.category==='transfer' || tx.category==='adjustment') return;
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

  // cache analytics totals — expensive full-scan, only recompute when txs or filter change
  const aSig = state.transactions.length + '|' + (state.transactions[state.transactions.length-1]?.id||'') + '|' + curStart + '|' + (walletFilter||'');
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
    const diff = curTotal - prevTotal;
    const pct = Math.abs(diff/prevTotal*100).toFixed(0);
    const up = diff > 0;
    cmpHtml = `<div class="sub ${up?'up':'down'}">${up?'▲':'▼'} ${pct}${t({ar:'% عن الشهر الماضي', en:'% vs last month'})}</div>`;
  } else {
    cmpHtml = `<div class="sub">${t({ar:'لا توجد بيانات للشهر الماضي', en:'No data for last month'})}</div>`;
  }
  grid.innerHTML += `
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
  grid.innerHTML += projHtml;
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
  if(list._cancelSwipe) list._cancelSwipe(); // abort any in-progress swipe before its row is wiped
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
      list.innerHTML = `<div class="empty"><span class="ic">🗂</span>${t({ar:'لا توجد معاملات بعد.', en:'No transactions yet.'})}<br><br>
        <button class="btn-primary" onclick="document.querySelector('.fab-btn').click()" style="width:auto; padding:10px 20px; display:inline-block; margin-bottom:8px;">＋ ${t({ar:'أضف أول معاملة', en:'Add your first transaction'})}</button><br>
        <button class="btn-secondary" onclick="openSettingsTab('data')" style="width:auto; padding:8px 16px; display:inline-block; font-size:12px;">⬆ ${t({ar:'استيراد من JSON', en:'Import from JSON'})}</button>
      </div>`;
    } else {
      list.innerHTML = `<div class="empty"><span class="ic">🗂</span>${t({ar:'لا توجد معاملات', en:'No transactions'})}${searchQuery ? t({ar:' مطابقة لبحثك', en:' matching your search'}) : t({ar:' في هذه الفترة', en:' in this period'})}</div>`;
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
      lbl.textContent = isToday ? t({ar:'اليوم', en:'Today'}) : isYesterday ? t({ar:'أمس', en:'Yesterday'}) : date.toLocaleDateString(_dateLocale(), {weekday:'long', day:'numeric', month:'long', numberingSystem:'latn'});
      list.appendChild(lbl);
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
    const timeStr = date.toLocaleTimeString(_dateLocale(), {hour:'2-digit', minute:'2-digit', numberingSystem:'latn'});
    const cat = getCategory(tx.category);
    div.innerHTML = `
      <div class="info">
        <div class="desc" dir="auto">${escHtml(tx.desc || (wallet ? wallet.name : ''))}</div>
        <div class="meta"><span class="ctag">${cat.icon}</span><span class="wtag">${escHtml(wallet ? wallet.name : '')}</span> ${timeStr}${_trackLinkTag(tx)}</div>
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
      `${t(tx.type==='expense'?{ar:'مصروف',en:'Expense'}:{ar:'دخل',en:'Income'})} ${fmt(tx.amount)}${t({ar:'،',en:','})} ${stripBidiControls(tx.desc) || (wallet?wallet.name:'')}${t({ar:'،',en:','})} ${cat.name}${t({ar:'،',en:','})} ${date.toLocaleDateString(_dateLocale(),{day:'numeric',month:'long',numberingSystem:'latn'})} ${timeStr}`);
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

