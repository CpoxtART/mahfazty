/* ============================================================
   ADD / EDIT / DELETE TRANSACTIONS
============================================================ */
let _addTxBusy = false;
async function addTx(type){
  if(_addTxBusy) return;
  _addTxBusy = true;
  _opInFlight++;
  _txMutationStamp++;
  const _expBtn = document.getElementById('addExpenseBtn');
  const _incBtn = document.getElementById('addIncomeBtn');
  _setBtnSaving(_expBtn, true, '⏳ جارٍ الحفظ...');
  _setBtnSaving(_incBtn, true, '⏳ جارٍ الحفظ...');
  try{
    const walletId = selectedWallet;
    const desc = document.getElementById('descInput').value.trim().slice(0,120); // cap length (voice/paste bypass maxlength)
    // round to cents at entry so the stored amount matches what fmt() displays —
    // otherwise sub-cent input (10.999) shows "11.00" but sums as 10.999 and drifts
    const amountVal = round2(parseAmount(document.getElementById('amountInput').value));
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

    let ts = buildTxTs(dateVal);

    const tx = {
      id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      wallet: walletId,
      desc: desc,
      amount: amountVal,
      type: type,
      category: selectedCategory,
      ts: ts
    };

    // Optional secondary tracked-wallet link: stamp the wallet id + its resolved
    // direction onto the tx so applyTxToBalance also moves that tracked wallet, and
    // so edit/delete/undo reverse it symmetrically. Validate against a real track
    // wallet (a transfer/non-track pick is ignored). The sign is captured now from
    // the wallet's configured mode so a later mode change can't rewrite history.
    if(selectedTrackWallet){
      const tw = WALLET_DEFS.find(w => w.id === selectedTrackWallet && w.track);
      if(tw && tw.id !== walletId){
        tx.trackWallet = tw.id;
        tx.trackSign = (trackLinkMode[tw.id] === 'credit') ? 1 : -1;
      }
    }

    state.transactions.push(tx);
    applyTxToBalance(tx, +1);

    document.getElementById('descInput').value = '';
    document.getElementById('amountInput').value = '';
    document.getElementById('dateInput').value = todayISO();
    document.querySelectorAll('#quickAmounts button').forEach(b=>b.classList.remove('active'));
    // category intentionally kept so consecutive same-category entries don't need reselecting
    selectedTrackWallet = null; // reset the optional tracked link so it isn't reused unintentionally
    if(typeof renderTrackLinkPicker === 'function') renderTrackLinkPicker();

    await saveBalances();
    await saveTx();
    render();
    closeAddDrawer();
    haptic(15); // brief confirm pulse on a successful entry
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
    _opInFlight--;
    _setBtnSaving(_expBtn, false);
    _setBtnSaving(_incBtn, false);
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
      row.innerHTML = `<span class="name">${escHtml(w.name)} <span class="pct">${escHtml(String(d.pct))}%</span></span><span class="amt">${escHtml(fmt(share))}</span>`;
      wrap.appendChild(row);
    });
    if(totalPct > 100){
      const warn = document.createElement('div');
      warn.className = 'hint';
      warn.style.cssText = 'color:var(--red); margin:8px 0 0; font-size:13px;';
      warn.textContent = `⚠ مجموع النسب ${totalPct}% — يتجاوز 100%، راجع الإعدادات`;
      wrap.appendChild(warn);
    } else if(totalPct < 100){
      // surface where the un-distributed remainder goes — it stays in the wallet
      // the income landed in, which is otherwise invisible to the user
      const srcId = pendingIncomeTx && pendingIncomeTx.wallet;
      const srcW = WALLET_DEFS.find(x => x.id === srcId);
      const remainder = round2(amount * (100 - totalPct) / 100);
      if(remainder > 0){
        const note = document.createElement('div');
        note.className = 'dist-row';
        note.style.cssText = 'border-style:dashed; opacity:.85; margin-top:4px;';
        note.innerHTML = `<span class="name">يبقى في ${srcW ? escHtml(srcW.name) : 'المحفظة'} <span class="pct">${round2(100-totalPct)}%</span></span><span class="amt">${fmt(remainder)}</span>`;
        wrap.appendChild(note);
      }
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
  _txMutationStamp++;
  saveAutoDistributePref();
  if(!pendingIncomeTx) { closeModal('distributeModal'); return; }
  const hasActive = DISTRIBUTION.some(d => d && d.pct > 0 && WALLET_DEFS.find(x=>x.id===d.id && !x.track));
  if(!hasActive){
    toast('⚠ لا توجد نسب توزيع — اضبطها في الإعدادات أولاً', true);
    return;
  }
  const txToDistribute = pendingIncomeTx;
  pendingIncomeTx = null; // clear early so double-tap cannot trigger a second distribution
  // re-find by id: a cross-tab reload could have replaced state.transactions, leaving
  // txToDistribute detached (its link mutation + legs would target a stale object)
  const live = state.transactions.find(t => t.id === txToDistribute.id);
  if(!live){ closeModal('distributeModal'); toast('⚠ تعذّر التوزيع — لم تعد المعاملة موجودة', true); return; }
  _opInFlight++; // guard the multi-await distribution against a mid-flight reload
  const _btn = document.getElementById('confirmDistributionBtn');
  _setBtnSaving(_btn, true);
  try{
    await runDistribution(live, live.amount);
    closeModal('distributeModal');
    render();
    toast('✓ تم توزيع الدخل على المحافظ');
  } finally {
    _opInFlight--;
    _setBtnSaving(_btn, false);
  }
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
  _txMutationStamp++;
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
    id: 'tx_'+Date.now()+'_d0'+Math.random().toString(36).slice(2,7),
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
      // proportional to intendedTotal (not the raw amount) so a >100% misconfig
      // scales every wallet down fairly instead of letting earlier legs claim
      // their full pct and starving the later ones
      : round2(intendedTotal * d.pct / totalPct);
    // never allocate more than what's left of intendedTotal — guards a >100%
    // misconfiguration from producing a negative final share (which would push a
    // bogus negative-amount tx AND create money out of nothing as later legs
    // skip the negative apply while earlier legs already over-deposited)
    if(share > remaining) share = remaining;
    if(share <= 0) return; // nothing left for this (or any later) leg — skip it
    allocated = round2(allocated + share);
    const txIn = {
      id: 'tx_'+Date.now()+'_d'+(i+1)+Math.random().toString(36).slice(2,7),
      wallet: d.id,
      desc: `حصة ${w.name} (⁦${d.pct}%⁩) من دخل`,
      amount: share,
      type: 'income',
      category: 'transfer',
      ts: ts+2+i,
      link: linkId
    };
    state.transactions.push(txIn);
    applyTxToBalance(txIn, +1);
  });

  // Money-conservation reconcile: per-leg rounding can make the deposits sum to a
  // hair more/less than the pre-computed intendedTotal that was withdrawn. Snap the
  // withdrawal to the ACTUAL total deposited so the operation neither creates nor
  // destroys cents. If nothing was deposited, drop the withdrawal leg entirely.
  if(round2(allocated) !== txOut.amount){
    applyTxToBalance(txOut, -1);          // undo the original withdrawal effect
    txOut.amount = round2(allocated);     // match what was really distributed
    if(txOut.amount > 0){
      applyTxToBalance(txOut, +1);        // re-apply the corrected withdrawal
    } else {
      const i = state.transactions.indexOf(txOut);
      if(i !== -1) state.transactions.splice(i, 1); // nothing distributed — remove it
    }
  }

  await saveBalances();
  await saveTx();
}

function round2(n){
  // Plain Math.round(n*100)/100 misrounds values like 1.005 → 1 (should be
  // 1.01) because 1.005*100 is actually 100.49999... in binary float. The
  // Number.EPSILON nudge corrects that without affecting any normal value.
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
  // Optional secondary effect on a linked tracked wallet (e.g. an Uber expense paid
  // from Core that should also move the "Uber" tracking number). trackSign is the
  // multiplier applied to an EXPENSE: -1 = balance/debit (expense lowers it), +1 =
  // counter/credit (expense raises it). Income flips it so add/reverse stay symmetric
  // (every caller pairs a +1 with a -1). reconcileBalances() deliberately skips track
  // wallets, so this delta is never double-counted or wiped by a later rebuild.
  if(tx.trackWallet && typeof tx.trackSign === 'number'){
    const tw = WALLET_DEFS.find(w => w.id === tx.trackWallet && w.track);
    if(tw){
      const dir = (tx.type === 'expense' ? tx.trackSign : -tx.trackSign) * sign;
      state.wallets[tw.id] = round2((state.wallets[tw.id] ?? 0) + dir * tx.amount);
    }
  }
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
  // The income tx that triggered an auto-distribution keeps its own category
  // (not 'transfer') but is linked to the withdrawal + N deposit legs that
  // already moved the OLD amount into other wallets. Editing its amount here
  // has no sync path (unlike the simple 2-leg transfer case above, which only
  // syncs when there's exactly one partner) — those legs would silently stay
  // at the stale amount, desyncing the source tx from the money actually
  // distributed. Lock the amount field for this case; desc/date/category/type
  // remain editable since they don't affect balances.
  _editingDistSource = !!(tx.link && tx.category !== 'transfer' &&
    state.transactions.filter(t => t.link === tx.link && t.id !== tx.id).length > 1);
  document.getElementById('editTypeToggle').style.display = _editingTransferLeg ? 'none' : '';
  document.getElementById('editCategorySection').style.display = _editingTransferLeg ? 'none' : '';
  document.getElementById('editTransferHint').style.display = _editingTransferLeg ? 'block' : 'none';
  document.getElementById('editDistSourceHint').style.display = _editingDistSource ? 'block' : 'none';
  const _eAmt = document.getElementById('editAmount');
  _eAmt.disabled = _editingDistSource;
  _eAmt.style.opacity = _editingDistSource ? '.55' : '';
  setEditType(tx.type);
  renderEditWalletSelect();
  renderEditCategoryGrid();
  document.getElementById('editWalletMenuWrap').classList.remove('open');
  const _ewb = document.getElementById('editWalletBtn');
  _ewb.classList.remove('open');
  _ewb.setAttribute('aria-expanded','false');
  // Lock the wallet on a transfer leg: changing it would credit/debit a wallet
  // different from the partner leg and silently desync the pair's balances.
  _ewb.style.pointerEvents = _editingTransferLeg ? 'none' : '';
  _ewb.style.opacity = _editingTransferLeg ? '.55' : '';
  document.getElementById('editDesc').value = tx.desc || '';
  document.getElementById('editAmount').value = (Number(tx.amount) || 0).toFixed(2); // match the 2-decimal display used everywhere else
  const d = new Date(tx.ts);
  document.getElementById('editDate').value = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  openModal('editModal');
}

let _saveEditBusy = false;
async function saveEdit(){
  if(_saveEditBusy) return; // double-tap guard: a second tap before the first
  _saveEditBusy = true;     // completes would reverse+reapply the balance twice
  _opInFlight++;
  const _saveBtn = document.getElementById('saveEditBtn');
  _setBtnSaving(_saveBtn, true, '⏳ جارٍ الحفظ...');
  try{
  _txMutationStamp++;
  const tx = state.transactions.find(t=>t.id===editingTxId);
  if(!tx){
    toast('⚠ المعاملة لم تعد موجودة — ربما حُذفت من تبويب آخر', true);
    closeModal('editModal');
    return;
  }

  // Defense in depth: the amount field is disabled in the UI for this case
  // (see openEdit), but guard here too in case of stale state — editing the
  // amount of an already-distributed income source has no path to rebalance
  // the withdrawal + per-wallet deposit legs already created from the OLD
  // amount, which would otherwise desync the source tx from the money moved.
  if(_editingDistSource){
    toast('⚠ هذه المعاملة موزعة على محافظ أخرى — احذفها وأضفها من جديد لتغيير المبلغ', true);
    return;
  }

  const newAmount = round2(parseAmount(document.getElementById('editAmount').value)); // cent precision — match display, avoid sub-cent drift
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
  let _transferPartner = null;
  if(tx.link && tx.category === 'transfer'){
    const transferPartners = state.transactions.filter(t => t.link === tx.link && t.id !== tx.id && t.category === 'transfer');
    if(transferPartners.length === 1){
      const partner = transferPartners[0];
      _transferPartner = partner;
      applyTxToBalance(partner, -1);
      partner.amount = newAmount;
      partner.editedAt = Date.now();
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
  tx.editedAt = Date.now(); // lets mergeCloudData() resolve same-id conflicts by picking the newer edit instead of always favoring local
  // transfer legs keep their original type/category (locked in the UI) so the
  // two-leg balance stays consistent; only non-transfer txs adopt the new values
  if(!_editingTransferLeg){
    tx.type = editType;
    // Defense in depth: the category grid already excludes 'transfer' for a
    // distributed-income source (see renderEditCategoryGrid) since that value
    // would misclassify this linked tx as a transfer leg from then on — guard
    // here too in case of stale state.
    tx.category = (_editingDistSource && editCategory === 'transfer') ? tx.category : editCategory;
  }
  const dateVal = document.getElementById('editDate').value || todayISO();
  const oldDate = new Date(tx.ts);
  const newTs = new Date(dateVal + 'T' + oldDate.toTimeString().slice(0,8)).getTime();
  // cap to now — prevents future-dated transactions from corrupting time filters.
  // Preserve the original sub-second offset (% 1000) so same-second transactions
  // keep their original order even after a date edit (toTimeString gives HH:MM:SS
  // which loses milliseconds — we add them back from the original ts).
  const msPart = isFinite(tx.ts) ? (tx.ts % 1000) : 0;
  tx.ts = isFinite(newTs) ? Math.min(newTs + msPart, Date.now()) : (isFinite(tx.ts) ? tx.ts : Date.now());

  // Move the partner leg to the SAME date as the edited leg. Previously a date edit
  // updated only this leg's ts, splitting the two halves of one transfer across
  // different day-groups in the log. The ±1ms keeps the original expense-before-income
  // ordering (amount/desc were already synced above; ts isn't part of balance math).
  if(_transferPartner){ _transferPartner.ts = tx.type === 'expense' ? tx.ts + 1 : tx.ts - 1; }

  applyTxToBalance(tx, +1);

  await saveBalances();
  await saveTx();
  closeModal('editModal');
  render(true); // force: desc/date-only edits don't change the render signature
  toast('✓ تم التحديث');
  } finally {
    _saveEditBusy = false;
    _opInFlight--;
    _setBtnSaving(_saveBtn, false);
  }
}

async function deleteFromEdit(){
  if(!editingTxId) return;
  await deleteTx(editingTxId);
  closeModal('editModal');
}

function repeatLastTx(){
  // Use the chronologically newest non-system tx (sorted newest-first), not the
  // last array element — after an import the array order may not match dates.
  const sorted = getAllTxSorted();
  let last = null;
  for(let i = 0; i < sorted.length; i++){
    const t = sorted[i];
    if(t.category !== 'transfer' && t.category !== 'adjustment'){ last = t; break; }
  }
  if(!last){ toast('لا توجد معاملة سابقة لتكرارها'); return; }
  document.getElementById('descInput').value = last.desc || '';
  document.getElementById('amountInput').value = (Number(last.amount) || 0).toFixed(2);
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
  // carry the optional tracked-wallet link too, so repeating e.g. an Uber payment
  // re-links to the same tracked wallet without re-selecting it
  selectedTrackWallet = (last.trackWallet && WALLET_DEFS.find(w=>w.id===last.trackWallet && w.track)) ? last.trackWallet : null;
  renderTrackLinkPicker();
  openAddDrawer();
  switchDrawerTab(0);
  toast('✓ تم تعبية النموذج — راجع واضغط تسجيل');
}

let _lastDeleted = null;
let _undoTimer = null;

async function deleteTx(id){
  const target = state.transactions.find(t => t.id === id);
  if(!target) return;
  _txMutationStamp++;
  _opInFlight++;
  try{
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

    // record tombstones so the deletion propagates on multi-device merge sync
    const now = Date.now();
    removed.forEach(tx => { deletedTxIds[tx.id] = now; });

    await saveBalances();
    await saveTx();
    await saveConfig(); // persist the new tombstones (they live in config)
    render();

    _lastDeleted = removed;
    clearTimeout(_undoTimer);
    _undoTimer = setTimeout(()=>{ _lastDeleted = null; }, 5000);
    haptic([12, 40, 12]); // double-tap pulse signals a destructive commit
    toastWithUndo(removed.length > 1 ? `🗑 تم حذف ${removed.length} حركات مرتبطة` : '🗑 تم الحذف', undoDelete);
  } finally {
    _opInFlight--;
  }
}

async function undoDelete(){
  if(!_lastDeleted) return;
  const removed = _lastDeleted;
  _lastDeleted = null;
  clearTimeout(_undoTimer);
  _opInFlight++;        // block the cross-tab storage reload mid-restore
  _txMutationStamp++;   // invalidate stamp-keyed caches (first-tx scan, render sig)
  try{
    // position in the array is irrelevant (the list is always sorted by ts)
    removed.forEach(tx => {
      state.transactions.push(tx);
      applyTxToBalance(tx, +1);
      delete deletedTxIds[tx.id]; // un-tombstone: the delete was undone
    });
    await saveBalances();
    await saveTx();
    await saveConfig(); // persist tombstone removal
    render();
    toast(removed.length > 1 ? '↩️ تم استرجاع الحركات' : '↩️ تم استرجاع المعاملة');
  } finally {
    _opInFlight--;
  }
}

/* ============================================================
   BACK-BUTTON / HISTORY INTEGRATION FOR MODALS & THE ADD DRAWER
   ------------------------------------------------------------
   Android/iOS-PWA back (and the browser back button) must close the
   topmost open modal/drawer instead of navigating away or exiting the
   app. We push one history entry per overlay opened; popstate closes
   the topmost one via the SAME logic Escape already uses. Closing an
   overlay through its own UI (X/cancel/backdrop/save) must consume
   that entry with history.back() so the stack never accumulates
   orphaned entries — that bookkeeping (push-on-open, pop-on-any-close,
   and not double-handling the popstate-triggered close) is the part
   that makes this safe rather than "architecturally risky".
============================================================ */
let _overlayHistDepth = 0;    // how many of OUR entries are currently on the history stack
let _inPopstateClose = false; // true while popstate's own close is unwinding (skip history.back())
// Count (not a single boolean) of our own bookkeeping history.back() calls still
// awaiting their popstate event. A boolean would mis-fire if two overlays are
// closed in quick succession (e.g. back-button mashed on stacked modals): the
// second _popOverlayHistory() call would re-arm the flag before the first
// back()'s popstate had fired, so the first popstate consumes the flag and the
// second popstate — which is ALSO ours — would be wrongly treated as a real
// user navigation and close the parent overlay underneath.
let _suppressPopstateCloseCount = 0;
function _pushOverlayHistory(){
  _overlayHistDepth++;
  history.pushState({ _mahfaztyOverlay: true, depth: _overlayHistDepth }, '');
}
function _popOverlayHistory(){
  if(_overlayHistDepth <= 0) return;
  _overlayHistDepth--;
  if(_inPopstateClose) return; // popstate already moved history back for us
  // This back() only consumes the entry the just-closed overlay pushed — it must
  // NOT be treated as a user "back" that closes the NEXT overlay down. Without
  // this counter, closing a modal stacked on another (e.g. the wallet add/edit modal
  // over Settings) would collapse BOTH instead of returning to the parent.
  _suppressPopstateCloseCount++;
  history.back();
}
// Single source of truth for "what does back/Escape close right now", reused by
// both the keydown handler and popstate so the priority order (dropdown → add
// drawer → topmost modal) only lives in one place.
function _closeTopmostOverlay(){
  const dropdowns = [
    ['walletMenuWrap','walletSelectBtn'],
    ['editWalletMenuWrap','editWalletBtn'],
    ['transferFromMenuWrap','transferFromBtn'],
    ['transferToMenuWrap','transferToBtn'],
  ];
  let closedDropdown = false;
  dropdowns.forEach(([wrapId, btnId])=>{
    const wrap = document.getElementById(wrapId);
    if(wrap && wrap.classList.contains('open')){
      wrap.classList.remove('open');
      const btn = document.getElementById(btnId);
      if(btn){ btn.classList.remove('open'); btn.setAttribute('aria-expanded','false'); btn.focus({preventScroll:true}); }
      closedDropdown = true;
    }
  });
  if(closedDropdown) return true;
  if(addDrawerOpen){
    closeAddDrawer();
    return true;
  }
  const open = [...document.querySelectorAll('.modal-overlay.open')];
  if(open.length){
    closeModal(open[open.length-1].id);
    return true;
  }
  return false;
}
// Dropdowns (custom <select>s) don't push history entries — they're a transient
// in-page widget, not a "screen" — so popstate only needs to care about the add
// drawer and modals, both of which already go through _pushOverlayHistory().
window.addEventListener('popstate', () => {
  // Our own _popOverlayHistory() back() just fired this — the entry is already
  // accounted for; don't also close the parent overlay underneath.
  if(_suppressPopstateCloseCount > 0){ _suppressPopstateCloseCount--; return; }
  if(_overlayHistDepth <= 0) return; // a real navigation, not one of our entries — let it proceed
  _inPopstateClose = true;
  try{
    if(addDrawerOpen){
      closeAddDrawer();
    } else {
      const open = [...document.querySelectorAll('.modal-overlay.open')];
      if(open.length) closeModal(open[open.length-1].id);
      else _overlayHistDepth = 0; // safety net: nothing open but we thought we had depth — resync
    }
  } finally {
    _inPopstateClose = false;
  }
});

/* ============================================================
   MODALS
============================================================ */
// Stack (not a single var) so nested modals restore focus to the correct opener:
// e.g. wallet card → wallet detail → edit tx. A single variable would lose the
// outer modal's opener when the inner modal overwrote it.
const _focusStack = [];
// Background landmarks to hide from screen readers while any modal/drawer is
// open — without this, a screen-reader user swiping through the page can still
// land on (and hear) the tab content sitting behind an open overlay, since
// CSS-only overlays don't remove the background from the accessibility tree.
const _bgLandmarks = () => document.querySelectorAll('body > header, body > .tab-panel, body > nav.bottom-nav');
function _anyOverlayOpen(){
  return addDrawerOpen || !!document.querySelector('.modal-overlay.open');
}
function _setBackgroundHidden(hidden){
  _bgLandmarks().forEach(el => {
    if(hidden) el.setAttribute('aria-hidden', 'true');
    else el.removeAttribute('aria-hidden');
  });
}
// Tab/Shift+Tab focus trap scoped to the topmost open modal or the add-drawer —
// without this, tabbing past the last focusable element in a dialog leaks focus
// into the (visually hidden but still-tabbable) page behind it.
function _activeOverlayEl(){
  const modals = document.querySelectorAll('.modal-overlay.open');
  if(modals.length) return modals[modals.length - 1];
  if(addDrawerOpen) return document.getElementById('addDrawer');
  return null;
}
document.addEventListener('keydown', e => {
  if(e.key !== 'Tab') return;
  const overlay = _activeOverlayEl();
  if(!overlay) return;
  const focusables = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if(!focusables.length) return;
  const list = Array.from(focusables).filter(el => !el.disabled && el.offsetParent !== null);
  if(!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if(e.shiftKey && document.activeElement === first){
    e.preventDefault(); last.focus();
  }else if(!e.shiftKey && document.activeElement === last){
    e.preventDefault(); first.focus();
  }else if(!overlay.contains(document.activeElement)){
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
});
function openModal(id){
  const modal = document.getElementById(id);
  if(!modal) return;
  // remember what had focus so we can restore it when the modal closes (a11y) —
  // but only on the FIRST open. Re-opening an already-open modal (e.g. wallet
  // detail refreshing itself after a tracked-balance edit) must NOT push a
  // duplicate, or it would bury the real opener and break focus return.
  const wasClosed = modal && !modal.classList.contains('open');
  if(wasClosed) _focusStack.push(document.activeElement);
  // Push one history entry per modal/drawer opened so the hardware/gesture BACK
  // button closes the topmost overlay instead of navigating away or exiting the
  // PWA. _histDepth tracks how many of OUR entries are stacked so popstate can
  // tell "user pressed back with an overlay open" apart from a real navigation.
  if(wasClosed) _pushOverlayHistory();
  // give the dialog an accessible name from its heading (so SR doesn't announce an
  // unnamed dialog) — done here once instead of hand-wiring aria-labelledby on all 11
  if(!modal.hasAttribute('aria-label') && !modal.hasAttribute('aria-labelledby')){
    const h = modal.querySelector('h3');
    if(h){
      if(!h.id) h.id = id + '_title';
      modal.setAttribute('aria-labelledby', h.id);
    }
  }
  modal.classList.add('open');
  // blur the trigger BEFORE hiding its ancestor from the a11y tree — aria-hidden
  // on an element that still holds focus is an ARIA violation (and Chrome logs a
  // warning for it); the real focus-in-modal happens a frame later below.
  if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
  _setBackgroundHidden(true);
  // lock background scroll so the page behind the sheet doesn't move while a
  // modal (and the on-screen keyboard) is open on mobile
  document.body.style.overflow = 'hidden';
  if(id==='settingsModal'){
    updateSettingsStats();
    document.getElementById('driveClientId').value = driveClientId;
    refreshDriveSettingsUI();
    renderDistributionEditor();
    renderLayoutEditor();
    renderAccentSwatches();
    _updateLangUI(_currentLang());
    renderWalletDefsEditor();
    const _ja = document.getElementById('jsonArea'); if(_ja) _ja.value = ''; // fresh scratch area each open (import/export now lives in the data tab)
    switchSettingsTab(_settingsTab); // sync panels/strip to the requested tab
  }
  // move focus into the modal so keyboard/screen-reader users land in context.
  // target a button (not a text input) so the mobile keyboard doesn't pop open.
  requestAnimationFrame(()=>{
    const focusable = modal.querySelector('button, [tabindex]');
    if(focusable) try{ focusable.focus({preventScroll:true}); }catch(_){}
  });
}
function closeModal(id){
  const modal = document.getElementById(id);
  if(!modal) return;
  const wasOpen = modal.classList.contains('open');
  modal.classList.remove('open');
  // restore background scroll/aria-hidden only once no modal/drawer remains open
  if(!_anyOverlayOpen()){ document.body.style.overflow = ''; _setBackgroundHidden(false); }
  if(id === 'editModal'){
    editingTxId = null; editCategory = 'other'; editType = 'expense'; editWallet = WALLET_DEFS[0].id;
    // ensure wallet dropdown is fully closed so stale 'open' state can't persist across edits
    const ewWrap = document.getElementById('editWalletMenuWrap');
    const ewBtn  = document.getElementById('editWalletBtn');
    if(ewWrap) ewWrap.classList.remove('open');
    if(ewBtn){ ewBtn.classList.remove('open'); ewBtn.setAttribute('aria-expanded','false'); }
  }
  if(id === 'distributeModal') pendingIncomeTx = null;
  if(id === 'walletDetailModal') detailWalletId = null;
  if(id === 'subModal') editingSubId = null;
  if(id === 'transferModal'){
    // Same stale-dropdown risk as editModal above: closing via the back button
    // (no click event) bypasses the click-outside handler that normally closes
    // these, so a left-open 'from'/'to' wallet dropdown would still show
    // expanded the next time the modal opens.
    ['transferFromMenuWrap','transferToMenuWrap'].forEach(wid => {
      const w = document.getElementById(wid);
      if(w) w.classList.remove('open');
    });
    ['transferFromBtn','transferToBtn'].forEach(bid => {
      const b = document.getElementById(bid);
      if(b){ b.classList.remove('open'); b.setAttribute('aria-expanded','false'); }
    });
  }
  // restore focus to whatever triggered this modal (pop the stack)
  const _retFocus = _focusStack.pop();
  if(_retFocus && typeof _retFocus.focus === 'function'){
    try{ _retFocus.focus({preventScroll:true}); }catch(_){}
  }
  // Closed via X/cancel/backdrop/save — NOT via the back button — so the history
  // entry pushed on open is still sitting there. Consume it with history.back()
  // so the stack doesn't accumulate an orphaned entry per modal opened+closed
  // (would otherwise force the user to hit back N extra times to actually leave).
  if(wasOpen) _popOverlayHistory();
}
// Modals that hold unsaved form input must NOT close on an accidental
// backdrop tap (common on mobile) — only their explicit buttons close them.
const _protectedModals = new Set(['editModal','transferModal','distributeModal','walletDetailModal',
  // driveConflictModal has no cancel path — the user MUST pick a side via
  // resolveConflict(); a backdrop tap dismissing it silently would leave the
  // conflict unresolved with no indication the sync never completed.
  'driveConflictModal',
  // welcomeModal's real close path is closeWelcome(), which also stamps the
  // welcomeSeen flag — a backdrop tap bypassing that re-triggers full onboarding
  // on the next visit.
  'welcomeModal']);
document.querySelectorAll('.modal-overlay').forEach(ov=>{
  ov.addEventListener('click', e=>{ if(e.target===ov && !_protectedModals.has(ov.id)) closeModal(ov.id); });
});

// The bottom-sheet "grabber" handle on every modal looked draggable but had no
// backing gesture — a purely decorative affordance that suggests a swipe-down-
// to-dismiss that didn't exist. Wire it up for real (protected modals excluded,
// same as the backdrop-tap guard above).
document.querySelectorAll('.modal-overlay .grabber').forEach(handle=>{
  const overlay = handle.closest('.modal-overlay');
  const sheet = handle.closest('.modal');
  if(!overlay || !sheet) return;
  let startY = 0, dy = 0, dragging = false;
  handle.addEventListener('touchstart', e=>{
    if(_protectedModals.has(overlay.id)) return;
    startY = e.touches[0].clientY; dy = 0; dragging = true;
    sheet.style.transition = 'none';
  }, {passive:true});
  handle.addEventListener('touchmove', e=>{
    if(!dragging) return;
    dy = Math.max(0, e.touches[0].clientY - startY); // only allow dragging downward
    sheet.style.transform = `translateY(${dy}px)`;
  }, {passive:true});
  const finish = () => {
    if(!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    if(dy > 80){ closeModal(overlay.id); }
    else { sheet.style.transform = ''; }
  };
  handle.addEventListener('touchend', finish);
  handle.addEventListener('touchcancel', finish);
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
      btn.setAttribute('aria-expanded','false');
    }
  });
});

// memoize the earliest-tx scan (O(n)) so re-opening settings doesn't re-scan
// thousands of transactions; keyed by _txMutationStamp so it auto-invalidates
// on any add/edit/delete.
let _firstTxStamp = -1, _firstTxMs = null;
// .sett-stat-v is forced direction:ltr, but ICU's ar-EG numeric date/time
// formatting embeds bidi control chars (and on some platforms, e.g. Android
// Chrome, a different digit/separator order entirely) meant for RTL text —
// fighting the forced LTR direction and visibly scrambling the digits.
// Build the strings from plain digits instead of relying on locale
// formatting at all, sidestepping ICU's platform-specific bidi quirks.
const pad2 = n => String(n).padStart(2, '0');
function fmtStatDate(ms){
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth()+1}/${pad2(d.getFullYear() % 100)}`;
}
function fmtStatDateTime(ms){
  const d = new Date(ms);
  return `${d.getDate()}/${d.getMonth()+1} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function updateSettingsStats(){
  // Thousands-grouped via a plain regex instead of toLocaleString — same
  // ICU-bidi-fragility reasoning as fmtStatDate/fmtStatDateTime above.
  document.getElementById('statTxCount').textContent = String(state.transactions.length).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if(_firstTxStamp !== _txMutationStamp){
    _firstTxStamp = _txMutationStamp;
    _firstTxMs = state.transactions.length
      ? state.transactions.reduce((min,t)=> t.ts<min ? t.ts : min, state.transactions[0].ts)
      : null;
  }
  document.getElementById('statFirstTx').textContent = _firstTxMs !== null
    ? fmtStatDate(_firstTxMs)
    : '—';
  try{
    const last = localStorage.getItem(LS_PREFIX + 'lastEdit');
    document.getElementById('statLastEdit').textContent = last
      ? fmtStatDateTime(parseInt(last))
      : '—';
  }catch(e){
    document.getElementById('statLastEdit').textContent = '—';
  }
  // Show active cache version
  const cacheEl = document.getElementById('statCacheVer');
  if(cacheEl){
    caches.keys().then(keys => {
      cacheEl.textContent = keys.length ? keys.join(', ') : 'لا يوجد كاش';
    }).catch(()=>{ cacheEl.textContent = '—'; });
  }
}

/* ============================================================
   EXPORT / IMPORT / RESET
============================================================ */
function exportData(){
  const payload = {
    exportedAt: new Date().toISOString(),
    // carry the data-edit timestamp + theme so a restore on another device orders
    // Drive conflicts correctly and keeps the user's chosen appearance. This is the
    // MODE ('light'/'dark'/'auto'), not the resolved color — otherwise a user on
    // 'auto' would have today's resolved color baked in and frozen on every other
    // device that restores this backup, instead of each device following its own system.
    dataEditedAt: parseInt(localStorage.getItem(LS_PREFIX + 'dataEdit') || '0', 10) || 0,
    theme: _currentThemeMode(),
    accent: _currentAccent('day'),
    accentDark: _currentAccent('night'),
    lang: _currentLang(),
    wallets: state.wallets,
    walletDefs: WALLET_DEFS,
    transactions: state.transactions,
    crisisMode: state.crisisMode,
    budgets: budgets,
    autoDistribute: autoDistribute,
    distribution: DISTRIBUTION,
    dismissedRecurring: Array.from(dismissedRecurring),
    deletedTxIds: deletedTxIds,
    subscriptions: subscriptions,
    uiPrefs: collectUiPrefs()
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
    const result = e.target.result;
    // Only mirror small payloads into the <textarea> — dumping multi-MB JSON
    // into it freezes the main thread while the browser lays out the text.
    const jsonArea = document.getElementById('jsonArea');
    if(jsonArea) jsonArea.value = (typeof result === 'string' && result.length <= 256 * 1024)
      ? result : '/* تم تحميل ملف كبير — يُستورَد مباشرةً دون معاينة */';
    applyImport(result);
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

  if(!data || typeof data !== 'object' || !data.wallets || !Array.isArray(data.transactions)){
    toast('⚠ ملف غير صحيح — لا يحتوي على wallets أو transactions', true); return;
  }
  if(!confirm('سيتم استبدال كل البيانات الحالية. متابعة؟')) return;
  _txMutationStamp++; // wholesale data replacement — invalidate derived caches
  _opInFlight++; // block the cross-tab storage reload mid-import, same as other wholesale replacements
  try{

  // wallet defs are part of the same wholesale snapshot — replace BEFORE the
  // wallets/transactions validation below, since both reference WALLET_DEFS
  // by id (a custom wallet from the backup would otherwise look "unknown").
  if(Array.isArray(data.walletDefs)){
    const cleanWD = sanitizeWalletDefs(data.walletDefs);
    if(cleanWD) applyWalletDefs(cleanWD);
  }

  // data.wallets must be a plain id-keyed object — an array (or any other
  // truthy non-object-shaped value) would pass the old `!data.wallets` check
  // yet return undefined for every WALLET_DEFS[w.id] lookup below, silently
  // zeroing every balance with no restore and no warning.
  if(data.wallets && typeof data.wallets === 'object' && !Array.isArray(data.wallets)){
    // a backup is a complete snapshot — clear all balances first so wallets that
    // are omitted from the imported file don't keep stale values that would
    // mismatch the freshly-replaced transaction list
    WALLET_DEFS.forEach(w => state.wallets[w.id] = 0);
    WALLET_DEFS.forEach(w => {
      if(data.wallets[w.id] !== undefined){
        const v = parseFloat(data.wallets[w.id]);
        if(isFinite(v)) state.wallets[w.id] = round2(v); // reject NaN/Infinity from crafted files
      }
    });
  }
  let _droppedTx = 0;
  if(data.transactions){
    const incoming = Array.isArray(data.transactions) ? data.transactions : [];
    // dedup by id last (only after every other check passes) so a duplicate
    // doesn't get "claimed" by a malformed copy that's filtered out anyway —
    // otherwise a later, valid copy of the same id would be wrongly dropped
    const seenIds = new Set();
    state.transactions = incoming.filter(tx =>
      tx &&
      typeof tx.id === 'string' && tx.id &&
      typeof tx.ts === 'number' && isFinite(tx.ts) && tx.ts > 0 &&
      typeof tx.amount === 'number' && isFinite(tx.amount) && tx.amount > 0 && tx.amount <= MAX_AMOUNT &&
      (tx.type === 'income' || tx.type === 'expense') &&
      WALLET_DEFS.find(w => w.id === tx.wallet) &&
      !seenIds.has(tx.id) && seenIds.add(tx.id)
    ).map(tx => ({
      ...tx,
      category: normalizeCategory(tx.category),
      // addTx() caps manual entry to 120 chars (see app.logic.js) — a crafted or
      // corrupt backup file isn't bound by that input-side limit, and an unbounded
      // desc string would slip past escHtml() (it sanitizes, doesn't shorten) and
      // bloat every list render that includes this transaction.
      desc: typeof tx.desc === 'string' ? tx.desc.slice(0,120) : tx.desc,
      // every other entry point (addTx, transfers) rounds to cents before storing —
      // a hand-edited or legacy backup file isn't bound by that, so an unrounded
      // amount would otherwise persist forever and re-export on every future backup
      amount: round2(tx.amount)
    }));
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
  if(data.deletedTxIds && typeof data.deletedTxIds === 'object') deletedTxIds = data.deletedTxIds;
  if(Array.isArray(data.subscriptions)){
    subscriptions = data.subscriptions.filter(x => x && x.id && x.name && isFinite(x.amount) && x.amount > 0).map(_normalizeSub);
  }
  if(data.uiPrefs) applyUiPrefs(data.uiPrefs);
  // clear any in-flight selection/edit pointers that now reference replaced/deleted txs
  editingTxId = null;
  pendingIncomeTx = null;
  detailWalletId = null;
  // restore appearance + data-edit time if the backup carried them (lossless round-trip)
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
  if(typeof data.dataEditedAt === 'number' && data.dataEditedAt > 0){
    try{ localStorage.setItem(LS_PREFIX + 'dataEdit', String(data.dataEditedAt)); }catch(_){ }
  }
  prevSpendable = null; // reset animation baseline after full data replacement

  await saveBalances();
  await saveTx();
  await saveConfig();
  await saveSubs();
  await saveWalletDefs();
  closeModal('settingsModal'); // import/export now lives inside the settings data tab
  render(true);
  if(_droppedTx > 0){
    toast(`✓ تم الاستيراد — لكن تم تجاهل ${arPlural(_droppedTx, 'معاملة غير صالحة', 'معاملتين غير صالحتين', 'معاملات غير صالحة', 'معاملة واحدة غير صالحة')} (محفظة مجهولة أو بيانات تالفة)`, true);
  } else {
    toast('✓ تم الاستيراد بنجاح');
  }
  } finally {
    _opInFlight--;
  }
}

// ── Granular reset/clear actions (Deletion & Reset section) ──────────────
// Each does exactly what its label says. Tracked wallets carry no ledger, so
// zeroing them is clean. Regular wallets are derived from transactions, so
// zeroing them without clearing the ledger creates a mismatch the repair tool
// would undo — we warn about that explicitly.

// Zero the manually-tracked wallets (Uber, Bank Cards, Cash). The transaction
// records themselves are untouched, so this is safe AT THE MOMENT IT RUNS —
// but it is not a permanent invariant: applyTxToBalance() re-derives a track
// wallet's delta from each linked transaction's trackWallet/trackSign fields
// every time that transaction is later edited or deleted (see saveEdit/deleteTx),
// so editing an OLD track-linked transaction after this reset will re-apply its
// (now stale) delta on top of the zeroed balance. reconcileBalances() can't fix
// this either, since it deliberately skips track wallets (see applyTxToBalance).
async function zeroTrackedWallets(){
  if(!confirm('سيتم تصفير أرصدة محافظ التتبع (أوبر، البطاقات، الكاش) إلى صفر.\n\nالمعاملات لا تتأثر. هل تريد المتابعة؟')) return;
  _txMutationStamp++;
  _opInFlight++;
  try{
    WALLET_DEFS.forEach(w => { if(w.track) state.wallets[w.id] = 0; });
    prevSpendable = null;
    await saveBalances();
    render(true);
    toast('✓ تم تصفير محافظ التتبع');
  } finally { _opInFlight--; }
}

// Zero the regular (non-tracked) wallets while keeping the ledger. This makes
// balances diverge from the transaction history on purpose.
async function zeroRegularWallets(){
  if(!confirm('⚠️ سيتم تصفير أرصدة المحافظ العادية إلى صفر مع بقاء كل المعاملات.\n\nهذا يجعل الأرصدة لا تطابق سجل المعاملات (قد تظهر أرقام غير متوقعة في الإحصائيات).\n\nهل تريد المتابعة؟')) return;
  _txMutationStamp++;
  _opInFlight++;
  try{
    WALLET_DEFS.forEach(w => { if(!w.track) state.wallets[w.id] = 0; });
    prevSpendable = null;
    await saveBalances();
    render(true);
    toast('✓ تم تصفير المحافظ العادية');
  } finally { _opInFlight--; }
}

// Remove every subscription. Balances and transactions are untouched.
async function clearAllSubscriptions(){
  if(!subscriptions.length){ toast('لا توجد اشتراكات للحذف'); return; }
  if(!confirm(`سيتم حذف جميع الاشتراكات (${subscriptions.length}). لا يمكن التراجع.\n\nهل تريد المتابعة؟`)) return;
  _opInFlight++;
  try{
    subscriptions = [];
    await saveSubs();
    render(true);
    toast('✓ تم حذف كل الاشتراكات');
  } finally { _opInFlight--; }
}

// Zero all balances AND clear the whole transaction ledger — a consistent fresh
// start that keeps subscriptions, distribution and layout. Transactions are
// tombstoned so the deletion propagates on multi-device merge sync (otherwise a
// cloud copy would resurrect them on the next merge).
async function clearBalancesAndTx(){
  const answer = prompt('⚠️ سيتم تصفير كل الأرصدة وحذف كل المعاملات نهائياً.\nالاشتراكات والإعدادات تبقى كما هي.\n\nاكتب كلمة "تصفير" للتأكيد:');
  if(answer === null) return;
  if(answer.trim() !== 'تصفير'){ toast('أُلغي — لم تُكتب كلمة التأكيد بشكل صحيح'); return; }
  _txMutationStamp++;
  _opInFlight++;
  try{
    clearTimeout(_undoTimer); _lastDeleted = null;
    const now = Date.now();
    state.transactions.forEach(t => { if(t && t.id) deletedTxIds[t.id] = now; });
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
    toast('✓ تم تصفير الرصيد والمعاملات');
  } finally { _opInFlight--; }
}

// Self-healing repair: recompute balances from the transaction ledger (0 + Σ).
// Shows the detected drift first so the user knows exactly what will change.
async function repairBalancesFromLedger(){
  // dry run on a snapshot to preview the diff without committing
  const before = {};
  WALLET_DEFS.forEach(w => before[w.id] = parseFloat(state.wallets[w.id]) || 0);
  const diff = reconcileBalances();
  const keys = Object.keys(diff);
  if(!keys.length){
    // nothing changed — restore (reconcile already set identical values) and inform
    toast('✓ الأرصدة مطابقة لسجل المعاملات — لا حاجة للإصلاح');
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
  if(!confirm(`🔧 سيُعاد حساب الأرصدة من سجل معاملاتك (صفر + مجموع المعاملات).\n\nالفروقات المكتشفة:\n${lines}\n\nتطبيق الإصلاح؟`)){
    render(true);
    return;
  }
  reconcileBalances(); // apply for real
  await saveBalances();
  closeModal('settingsModal');
  render(true);
  toast('🔧 تم إصلاح الأرصدة من السجل');
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
    computed[tx.wallet] = Math.round((computed[tx.wallet] + (tx.type === 'expense' ? -amt : amt)) * 100) / 100;
  });
  let totalDrift = 0;
  Object.keys(computed).forEach(id => {
    const before = parseFloat(state.wallets[id]) || 0;
    if(Math.abs(computed[id] - before) >= 0.01) totalDrift = Math.round((totalDrift + Math.abs(computed[id] - before)) * 100) / 100;
  });
  if(totalDrift === 0) return;
  const sig = String(totalDrift);
  try{ if(localStorage.getItem(LS_PREFIX + 'driftNotified') === sig) return; }catch(e){} // already offered for this exact drift
  try{ localStorage.setItem(LS_PREFIX + 'driftNotified', sig); }catch(e){}
  toastWithAction('⚠ رصيد إحدى محافظك لا يطابق سجل معاملاتها', 'إصلاح', () => { openSettingsTab('data'); repairBalancesFromLedger(); });
}

async function wipeAll(){
  // Typed-word confirmation instead of two consecutive confirm() dialogs — on
  // mobile a fast double-tap could dismiss both confirms and wipe data by
  // accident. Requiring the user to type "حذف" makes it a deliberate action.
  const answer = prompt('⚠️ سيتم حذف جميع الأرصدة والمعاملات نهائياً ولا يمكن التراجع.\n\nاكتب كلمة "حذف" للتأكيد:');
  if(answer === null) return; // cancelled
  if(answer.trim() !== 'حذف'){ toast('أُلغي الحذف — لم تُكتب كلمة التأكيد بشكل صحيح'); return; }
  _txMutationStamp++; // wholesale wipe — invalidate derived caches
  _opInFlight++; // block the cross-tab storage reload mid-wipe across the multi-await sequence below
  try{
  clearTimeout(_undoTimer); _lastDeleted = null;
  // Tombstone every existing transaction BEFORE clearing the array, so the
  // deletion propagates on the next merge sync. Clearing tombstones outright
  // (the old behaviour) let a cloud/other-device copy resurrect everything.
  const _wipeNow = Date.now();
  state.transactions.forEach(t => { if(t && t.id) deletedTxIds[t.id] = _wipeNow; });
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
  DISTRIBUTION = DEFAULT_DISTRIBUTION.map(d=>({...d}));
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
  closeModal('settingsModal');
  render();
  if(typeof renderTrackLinkPicker === 'function') renderTrackLinkPicker();
  toast('🗑 تم حذف كل البيانات');
  } finally { _opInFlight--; }
}

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
function toast(msg, isError){
  if(Date.now() < _criticalToastUntil){ _queuedToast = {fn: toast, args:[msg, isError]}; return; }
  // A new notification means the user moved on — clear the undo timer so the
  // new toast is always visible (previously non-error toasts were silently
  // dropped for 5s after a delete, so "تم تسجيل المصروف" could vanish).
  // Note: we do NOT null _lastDeleted here so undo can still work if the user
  // taps the undo button in a toastWithUndo that appears after this toast.
  // We DO reschedule the expiry (not just clear it) — otherwise _lastDeleted
  // would stay armed forever once interrupted, letting a much later undo
  // resurrect a transaction long after the 5s window the toast implied.
  if(_lastDeleted){
    clearTimeout(_undoTimer);
    _undoTimer = setTimeout(()=>{ _lastDeleted = null; }, 5000);
  }
  const el = document.getElementById('saveStatus');
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
  toastWithAction(msg, 'تراجع ↩️', undoFn);
}
// critical=true marks a severe, rare warning (e.g. local persistence totally failed)
// that must not be silently overwritten by/lost a race with a routine toast that
// fires moments later from an in-flight optimistic save flow — see _criticalToastUntil.
function toastWithAction(msg, actionLabel, fn, critical){
  if(!critical && Date.now() < _criticalToastUntil){ _queuedToast = {fn: toastWithAction, args:[msg, actionLabel, fn, critical]}; return; }
  const el = document.getElementById('saveStatus');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  const btn = document.createElement('button');
  btn.textContent = actionLabel;
  btn.style.cssText = 'background:var(--gold-btn); color:var(--on-gold); border:none; border-radius:var(--radius-pill); padding:5px 13px; font-size:12px; font-weight:700; margin-inline-end:8px; cursor:pointer;';
  btn.onclick = () => {
    el.classList.remove('show');
    fn();
  };
  el.appendChild(span);
  el.appendChild(btn);
  el.style.borderColor = 'var(--line)';
  el.style.color = 'var(--text)';
  el.classList.add('show');
  clearTimeout(window._saveTimeout);
  const dur = critical ? 7000 : 5000;
  if(critical) _criticalToastUntil = Date.now() + dur;
  window._saveTimeout = setTimeout(()=> { el.classList.remove('show'); _runQueuedToastIfAny(); }, dur);
}

/* ============================================================
   GOOGLE DRIVE AUTO-SYNC
   Stores a single JSON file (wallet-data.json) in the user's
   Drive appDataFolder (a hidden app-specific space, not visible
   in the user's normal Drive UI, but fully owned by the user's account).
============================================================ */
const DRIVE_FILE_NAME = 'mahfazty-data.json';
// Older versions stored the file under an Arabic name with a repeated-letter typo.
// driveFindFile() looks for both and silently renames the legacy file on first
// sight so existing synced data isn't orphaned by the rename.
const DRIVE_FILE_NAME_LEGACY = 'محفظتيييي-data.json';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

let gisTokenClient = null;
let driveAccessToken = null;
let driveTokenExpiry = 0; // epoch ms when the current access token stops being valid
let _pendingDriveCloud = null;
let driveFileId = null;
let driveSyncTimer = null;
let driveClientId = '';
// Drive token-request state. _driveSilentMode marks an in-flight token request and
// how to recover / how to resolve the resulting sync:
//   'launch'    — desktop auto-open silent grant → on failure show the banner
//   'refresh'   — token nearing expiry while open → on failure quietly drop
//   'banner'    — desktop banner silent grant → on failure escalate to account picker
//   'reconnect' — mobile banner tap (gesture-backed interactive request)
//   'signin'    — explicit user-initiated sign-in from Settings
//   null        — idle (no request in flight)
// IMPORTANT: only 'signin' is treated as "interactive" for sync resolution (it alone
// may show the conflict modal). Every other mode resolves silently via the union
// merge, so an automatic/banner reconnect never nags the user to pick a copy.
let _driveSilentMode = null;
let _driveBannerEscalate = false; // next banner tap should force the account picker
let _driveTokenRefreshTimer = null; // proactive refresh 5 min before token expires

// A gesture-free silent token grab is reliable on desktop browsers, but on mobile /
// embedded / installed-PWA contexts it can redirect the top frame to
// accounts.google.com/gsi/transfer and hang on a blank page. So only attempt the
// no-tap silent path in safe contexts; elsewhere we use the one-tap banner (whose
// tap drives a gesture-backed interactive request that still tends to skip the
// account-chooser for an already-consented user, see driveReconnectInteractive()).
function _driveSilentSafe(){
  try{
    if(isEmbeddedOrStandalone()) return false;
    const ua = navigator.userAgent || '';
    if(/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
    return true;
  }catch(_){ return false; }
}

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
    // On desktop/safe contexts we can silently re-acquire the token (active session +
    // prior consent → no UI), keeping a long session seamless. On mobile a gesture-free
    // call can hang on gsi/transfer, so there we drop the token and let the next open
    // reconnect via the banner.
    if(_driveSilentSafe()){
      driveRequestSilent('refresh');
    } else {
      clearDriveToken();
      refreshDriveSettingsUI();
      toast('⏱ انتهت جلسة Drive — اضغط على أيقونة ☁️ في الأعلى أو سجّل دخولك من الإعدادات', true);
    }
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

/* ─── Launch Drive-connect banner ───
   Shown on app open when a Drive Client ID is configured but the session is
   disconnected (token expired). Brings the reconnect action to the user as a
   one-tap banner instead of making them hunt for the ☁️ button, and remembers
   their "always connect" choice. NOTE: we deliberately do NOT attempt a silent
   requestAccessToken({prompt:''}) — on mobile that can redirect the top frame to
   accounts.google.com/gsi/transfer and hang on a blank page. Re-auth needs a real
   tap, so even an "auto" user gets a frictionless one-tap banner on token expiry. */
function showDriveBanner(){
  const b = document.getElementById('driveBanner');
  if(!b || b.classList.contains('show')) return;
  const chk = document.getElementById('driveBannerAuto');
  if(chk) chk.checked = true; // default to "remember me"
  const yes = document.getElementById('btnDriveYes');
  const later = document.getElementById('btnDriveLater');
  if(yes) yes.onclick = () => {
    setDriveAutoSignIn(!!(chk && chk.checked)); // remember the choice for next launch
    hideDriveBanner();
    // desktop: try a silent grant first, only escalate to the picker if needed.
    // mobile: use the gesture-backed interactive request (this tap is the gesture
    // GIS needs) — it still tends to skip the picker for an already-consented user.
    driveReconnectFromBanner();
  };
  if(later) later.onclick = () => {
    hideDriveBanner();
    try{ sessionStorage.setItem(LS_PREFIX + 'driveBannerDismissed', '1'); }catch(_){}
  };
  requestAnimationFrame(()=> b.classList.add('show'));
}
function hideDriveBanner(){
  const b = document.getElementById('driveBanner');
  if(b) b.classList.remove('show');
}
function maybePromptDriveConnect(){
  if(!driveClientId || driveTokenValid()) return; // nothing to prompt
  let dismissed = false;
  try{ dismissed = sessionStorage.getItem(LS_PREFIX + 'driveBannerDismissed') === '1'; }catch(_){}
  if(dismissed) return;
  if(loadDriveAutoSignIn()){
    // Auto-sign-in user. On desktop/safe contexts reconnect SILENTLY on open — no
    // banner, no tap, no re-consent (the whole point of "always connect"). On mobile
    // we can't do a gesture-free silent grant safely, so show the fast one-tap banner
    // (its tap drives a gesture-backed interactive request — see driveReconnectInteractive()
    // — which still tends to skip the picker for an already-consented user).
    if(_driveSilentSafe()){ setTimeout(driveAutoSilent, 300); }
    else { setTimeout(showDriveBanner, 200); }
    return;
  }
  // first-timer: gentle banner after a short beat so it doesn't fight first paint
  setTimeout(showDriveBanner, 1400);
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
    error:   {icon:'⚠️', label:'خطأ',    color:'var(--red)'},
    offline: {icon:'📡', label:'غير متصل', color:'var(--muted)'}
  };
  const cfg = map[state_] || map.idle;
  const clickable = (state_ === 'idle' || state_ === 'error'); // tap to sign in when disconnected (signing in also needs network, so 'offline' stays non-clickable)
  // Render as a real header button (same 44px rounded-square as the others) so it
  // reads as a control, not a mystery glyph. Always show the cloud ☁️ (universally
  // "sync/cloud") plus a small state badge, and tint the disconnected state with
  // the gold "tap me" look so a new user notices it's actionable. Full status in title.
  el.className = 'icon-btn drive-ind drive-ind--' + state_;
  el.style.display = 'flex';
  el.onclick = clickable ? driveSignIn : null;
  el.setAttribute('role', clickable ? 'button' : 'img');
  // It's a plain <span> (not a native <button>), so role="button" alone doesn't
  // make it keyboard-reachable — every other custom-interactive control in the
  // app pairs role="button" with tabindex+a keydown handler; this one was missing
  // both, leaving it completely unusable from the keyboard when clickable.
  if(clickable){
    el.setAttribute('tabindex', '0');
    el.onkeydown = (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); driveSignIn(); } };
  } else {
    el.removeAttribute('tabindex');
    el.onkeydown = null;
  }
  const badge = { idle:'', syncing:'🔄', ok:'✓', error:'!', offline:'⨯' }[state_] || '';
  el.innerHTML = `<span class="drive-ind-ic">${state_ === 'offline' ? '📡' : '☁️'}</span>${badge ? `<span class="drive-ind-badge">${badge}</span>` : ''}`;
  const fullLabel = {
    idle: 'مزامنة Drive: جاهز — اضغط لتسجيل الدخول',
    syncing: 'مزامنة Drive: جاري المزامنة...',
    ok: 'مزامنة Drive: متزامن ✓',
    error: 'مزامنة Drive: خطأ — اضغط لتسجيل الدخول مجدداً',
    offline: 'مزامنة Drive: غير متصل بالإنترنت — سيتم المزامنة تلقائياً عند العودة للاتصال'
  }[state_] || cfg.label;
  el.title = fullLabel;
  el.setAttribute('aria-label', fullLabel);
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
  if(!val || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(val)){
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
        const mode = _driveSilentMode; _driveSilentMode = null;
        if(resp.error){
          // a silent (prompt:'') grant wasn't possible — handle gracefully per context
          // instead of showing a hard error the user didn't trigger.
          if(mode === 'launch'){ setDriveIndicator('idle'); showDriveBanner(); return; }
          if(mode === 'refresh'){ clearDriveToken(); refreshDriveSettingsUI(); setDriveIndicator('idle'); return; }
          if(mode === 'banner'){ _driveBannerEscalate = true; showDriveBanner(); return; }
          setDriveIndicator('error');
          toast('⚠ فشل تسجيل الدخول بجوجل', true);
          refreshDriveSettingsUI();
          return;
        }
        _driveBannerEscalate = false;
        storeDriveToken(resp.access_token, parseInt(resp.expires_in, 10));
        refreshDriveSettingsUI();
        // stay quiet on background silent reconnects/refreshes; only announce when the
        // user explicitly acted (interactive sign-in or a banner tap)
        if(mode !== 'launch' && mode !== 'refresh') toast('✓ تم تسجيل الدخول بجوجل');
        // Only an explicit sign-in the user started from Settings ('signin') may
        // interrupt with the conflict-resolution modal. EVERY automatic/banner
        // reconnect ('launch'/'refresh'/'banner'/'reconnect') resolves silently via
        // the non-destructive union merge instead. Previously this passed interactive
        // = true for every banner reconnect, so a returning user with data on both
        // sides got the "which copy do you want?" modal on EVERY app open — the
        // repeated prompt. The union merge keeps everything from both sides (honoring
        // tombstones), so resolving silently is safe and loses nothing.
        await driveSyncFromCloud(true, mode === 'signin');
      }
    });
  }catch(e){
    console.error(e);
  }
}

// Interactive sign-in — shows the Google account picker. Used for the first
// connection and as the fallback when a silent grant needs real interaction.
function driveSignIn(){
  if(!gisTokenClient){ initGisClient(); }
  if(!gisTokenClient){ toast('⚠ تعذر تهيئة جوجل، جرّب تحديث الصفحة', true); return; }
  _driveSilentMode = 'signin'; // explicit user-initiated sign-in from Settings — the ONLY path allowed to show the conflict-resolution modal
  try{
    gisTokenClient.requestAccessToken({
      prompt: 'select_account',
      // surface popup-level failures (blocked / closed / can't return) instead of
      // leaving the user staring at a blank google sign-in page with no feedback
      error_callback: (err) => {
        _driveSilentMode = null;
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

// Banner reconnect on mobile: an interactive (gesture-backed) request like driveSignIn,
// but WITHOUT forcing prompt:'select_account'. Leaving prompt unset is GIS's documented
// default — with an active Google session and prior consent it typically grants the
// token straight away (no account-chooser screen), while still using the same reliable
// popup/redirect path that's proven not to hang on mobile (unlike prompt:'' below).
function driveReconnectInteractive(){
  if(!gisTokenClient){ initGisClient(); }
  if(!gisTokenClient){ toast('⚠ تعذر تهيئة جوجل، جرّب تحديث الصفحة', true); return; }
  _driveSilentMode = 'reconnect'; // automatic banner reconnect — resolve via the silent union merge, never the conflict modal
  try{
    gisTokenClient.requestAccessToken({
      error_callback: (err) => {
        _driveSilentMode = null;
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

// Silent (no-UI) token request. With an active Google session AND consent already
// granted, prompt:'' returns a token WITHOUT any account picker/consent — so a
// returning auto-sign-in user reconnects with zero friction. `mode` tells the
// shared callback how to recover if a silent grant turns out to need interaction.
function driveRequestSilent(mode){
  if(!gisTokenClient){ initGisClient(); }
  if(!gisTokenClient) return false;
  _driveSilentMode = mode;
  try{
    gisTokenClient.requestAccessToken({
      prompt: '',
      error_callback: () => {
        const m = _driveSilentMode; _driveSilentMode = null;
        if(m === 'launch'){ showDriveBanner(); }
        else if(m === 'banner'){ _driveBannerEscalate = true; showDriveBanner(); }
        else if(m === 'refresh'){ clearDriveToken(); refreshDriveSettingsUI(); setDriveIndicator('idle'); }
      }
    });
    return true;
  }catch(e){ _driveSilentMode = null; return false; }
}

// Desktop auto-sign-in users: reconnect silently on app open — no banner, no tap,
// no consent. Falls back to the one-tap banner if the session can't grant silently.
function driveAutoSilent(){ driveRequestSilent('launch'); }

// Banner "نعم" tap. On desktop/safe contexts, try a silent grant first (consent-free
// for returning users) and only escalate to the account picker if the session truly
// needs interaction. On mobile, skip the silent prompt:'' request entirely — in
// practice it can hang on a blank accounts.google.com/gsi/transfer page even when
// fired from a tap, leaving the user stuck with no token and the banner reappearing
// next launch. Use the gesture-backed interactive request instead — it still tends to
// skip the account-chooser for a returning, already-consented user, but always completes.
function driveReconnectFromBanner(){
  if(_driveBannerEscalate){ _driveBannerEscalate = false; driveSignIn(); return; }
  if(_driveSilentSafe()){
    if(!driveRequestSilent('banner')) driveSignIn();
  } else {
    driveReconnectInteractive();
  }
}

function driveSignOut(){
  if(driveAccessToken && typeof google !== 'undefined' && google.accounts){
    try{ google.accounts.oauth2.revoke(driveAccessToken, ()=>{}); }catch(e){}
  }
  clearDriveToken();
  refreshDriveSettingsUI();
  toast('تم تسجيل الخروج من Drive');
}

// Plain fetch() has no built-in timeout — a stalled (not failed) connection on a
// flaky mobile network leaves the request neither resolved nor rejected forever,
// which would permanently wedge _driveSyncBusy and leave the indicator stuck on
// "syncing" with no recovery short of a page reload. Abort after timeoutMs so
// every Drive call's try/finally always gets a chance to run.
function driveFetch(url, opts, timeoutMs){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 20000);
  return fetch(url, Object.assign({}, opts, { signal: ctrl.signal })).finally(() => clearTimeout(timer));
}

// Build an Error for a non-ok Drive response, tagging it with the specific reason
// (e.g. 'storageQuotaExceeded' on a 403, or 429 rate-limiting) when Drive's JSON
// error body provides one, so callers can show a precise message instead of a
// generic "permission denied"/"connection failed" toast. Reading the body is
// best-effort — a malformed/HTML body (Google outage page) must not throw here.
async function _driveErrFromRes(res, prefix){
  let reason = '';
  try{
    const body = await res.clone().json();
    reason = (body && body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason) || '';
  }catch(_){ /* non-JSON body (e.g. HTML error page) — fall back to status only */ }
  return new Error(`${prefix}: ${res.status}${reason ? ' (' + reason + ')' : ''}`);
}

// Shared failure handling for both sync directions (push/pull) so a token expiring
// or being revoked mid-pull gets the exact same detection + user-facing toast as
// it already got mid-push — previously driveSyncFromCloud's catch was silent
// (console.error + a tiny red header icon only), so a 401/403 during a pull left
// the user with no idea their data wasn't actually syncing, and a dead token
// would just keep getting retried forever since it was never cleared.
function _handleDriveSyncError(e){
  console.error(e);
  setDriveIndicator('error');
  if(e.message && e.message.includes('401')){
    clearDriveToken();
    refreshDriveSettingsUI();
    // Do NOT auto-call requestAccessToken here — on mobile Chrome it causes
    // a redirect to gsi/transfer that hangs blank. Instead, guide the user
    // to tap sign-in manually (one tap via the header indicator or settings).
    toast('⚠ انتهت جلسة Drive — اضغط على ☁️ في الأعلى لتسجيل الدخول من جديد', true);
  } else if(e.message && e.message.includes('storageQuotaExceeded')){
    // distinct from a generic 403: the user's actual Drive storage is full,
    // not an app-permission problem — re-auth would not fix this
    toast('⚠ مساحة Google Drive ممتلئة — حرر مساحة لإتمام المزامنة', true);
  } else if(e.message && e.message.includes('403')){
    toast('⚠ تم رفض الإذن من Drive — تأكد من صلاحيات appdata بالـ Client ID', true);
  } else if(e.message && e.message.includes('429')){
    // rate-limited — the 1.5s debounce/timer-driven retry already provides
    // natural backoff, so just tell the user honestly instead of implying
    // a connection problem
    toast('⚠ تم تجاوز حد الطلبات إلى Drive مؤقتًا — سيُعاد المحاولة تلقائيًا', true);
  } else if(e.message && (e.message.includes(' 500') || e.message.includes('503'))){
    toast('⚠ خطأ مؤقت في خوادم Drive — سيُعاد المحاولة تلقائيًا', true);
  } else if(!navigator.onLine){
    toast('⚠ لا يوجد اتصال بالإنترنت — سيتم الحفظ محليًا فقط', true);
  } else {
    toast('⚠ تعذر الاتصال بـ Drive، سيُعاد المحاولة لاحقًا', true);
  }
}

// Find (or remember) the app data file on Drive. Matches the current filename OR
// the legacy Arabic one, so users who synced before the rename keep their data.
async function driveFindFile(){
  if(driveFileId) return driveFileId;
  const q = `name='${DRIVE_FILE_NAME}' or name='${DRIVE_FILE_NAME_LEGACY}'`;
  const res = await driveFetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=' + encodeURIComponent(q), {
    headers: { 'Authorization': 'Bearer ' + driveAccessToken }
  });
  if(!res.ok) throw new Error('drive list failed: ' + res.status);
  const data = await res.json();
  if(data.files && data.files.length > 0){
    const match = data.files.find(f => f.name === DRIVE_FILE_NAME) || data.files[0];
    driveFileId = match.id;
    if(match.name !== DRIVE_FILE_NAME){
      // migrate the legacy filename quietly; non-fatal if it fails (still works
      // next launch since driveFindFile matches both names)
      try{
        await driveFetch(`https://www.googleapis.com/drive/v3/files/${match.id}`, {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + driveAccessToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: DRIVE_FILE_NAME })
        });
      }catch(_){}
    }
  }
  return driveFileId;
}

// Push current local state to Drive (create file if needed)
let _driveSyncBusy = false;
let _driveResyncPending = false; // a change arrived mid-sync — re-sync afterwards
async function driveSyncToCloud(){
  if(!driveAccessToken) return false;
  // if a sync is already running, remember that newer changes need flushing
  // afterwards instead of dropping them silently
  if(_driveSyncBusy){ _driveResyncPending = true; return false; }
  _driveSyncBusy = true;
  setDriveIndicator('syncing');
  try{
    const payload = JSON.stringify({
      exportedAt: new Date().toISOString(),
      dataEditedAt: parseInt(localStorage.getItem(LS_PREFIX + 'dataEdit') || '0', 10) || 0,
      wallets: state.wallets,
      transactions: state.transactions,
      crisisMode: state.crisisMode,
      autoDistribute: autoDistribute,
      budgets: budgets,
      distribution: DISTRIBUTION,
      dismissedRecurring: Array.from(dismissedRecurring),
      deletedTxIds: deletedTxIds,
      subscriptions: subscriptions,
      uiPrefs: collectUiPrefs()
    });

    await driveFindFile();

    if(driveFileId){
      const res = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
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
      if(!res.ok) throw await _driveErrFromRes(res, 'drive update failed');
    } else {
      const boundary = 'wallet_boundary_' + Date.now();
      const metadata = { name: DRIVE_FILE_NAME, parents: ['appDataFolder'] };
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n` +
        `--${boundary}--`;
      const res = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + driveAccessToken,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body
      });
      if(!res.ok) throw await _driveErrFromRes(res, 'drive create failed');
      const data = await res.json();
      driveFileId = data.id;
    }
    setDriveIndicator('ok');
    return true;
  }catch(e){
    _handleDriveSyncError(e);
    return false;
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
  _opInFlight++; // wholesale state replacement across awaits — block cross-tab reload race
  try{
  // wallet defs first — wholesale snapshot replace, same as applyImport(), so the
  // wallets/transactions validation below (which checks WALLET_DEFS by id) already
  // knows about every wallet the cloud snapshot references.
  if(Array.isArray(cloud.walletDefs)){
    const cleanWD = sanitizeWalletDefs(cloud.walletDefs);
    if(cleanWD) applyWalletDefs(cleanWD);
  }
  if(cloud.wallets){
    WALLET_DEFS.forEach(w => state.wallets[w.id] = 0);
    WALLET_DEFS.forEach(w => {
      if(cloud.wallets[w.id] !== undefined){
        const v = parseFloat(cloud.wallets[w.id]);
        if(isFinite(v)) state.wallets[w.id] = round2(v); // reject NaN/Infinity from a corrupt cloud snapshot
      }
    });
  }
  if(Array.isArray(cloud.transactions)){ // harden against a crafted non-array value
    state.transactions = cloud.transactions.filter(tx =>
      tx && (tx.type === 'income' || tx.type === 'expense') &&
      typeof tx.ts === 'number' && isFinite(tx.ts) && tx.ts > 0 &&
      typeof tx.amount === 'number' && isFinite(tx.amount) && tx.amount > 0 &&
      WALLET_DEFS.find(w => w.id === tx.wallet))
      // same input-side cap as applyImport(), plus the same cent-rounding every
      // other entry point enforces (a cloud copy isn't bound by addTx's rounding)
      .map(tx => ({
        ...tx,
        desc: typeof tx.desc === 'string' && tx.desc.length > 120 ? tx.desc.slice(0,120) : tx.desc,
        amount: round2(tx.amount)
      }));
    stripOrphanLinks(state.transactions);
  }
  if(typeof cloud.crisisMode === 'boolean') state.crisisMode = cloud.crisisMode;
  if(typeof cloud.autoDistribute === 'boolean') autoDistribute = cloud.autoDistribute;
  if(cloud.budgets && typeof cloud.budgets === 'object') budgets = sanitizeBudgets(cloud.budgets);
  if(cloud.distribution && Array.isArray(cloud.distribution)) DISTRIBUTION = sanitizeDistribution(cloud.distribution);
  if(Array.isArray(cloud.dismissedRecurring)) dismissedRecurring = new Set(cloud.dismissedRecurring);
  if(cloud.deletedTxIds && typeof cloud.deletedTxIds === 'object') deletedTxIds = cloud.deletedTxIds;
  if(Array.isArray(cloud.subscriptions)){
    subscriptions = cloud.subscriptions.filter(x => x && x.id && x.name && isFinite(x.amount) && x.amount > 0).map(_normalizeSub);
  }
  if(cloud.uiPrefs) applyUiPrefs(cloud.uiPrefs);
  _txMutationStamp++; // adopted a new cloud data set — invalidate derived caches
  prevSpendable = null; // force fresh hero animation after loading a new data set
  await saveBalances(); await saveTx(); await saveConfig(); await saveSubs(); await saveWalletDefs();
  render(true); // force: wallet object is mutated in-place so reference-equality sig check would miss balance changes
  } finally {
    _opInFlight--;
  }
}

// isInitial: this is the first pull after (re)connecting.
// interactive: the user explicitly tapped "sign in" — only then do we ever
//   interrupt with the conflict modal. Automatic reconnects on app open resolve
//   silently by timestamp so the user is never nagged on every visit.
// Two independent triggers can call this close together — initDrive()'s launch-time
// pull (still-valid stored token) and the GIS token-refresh callback (silent reconnect
// near expiry). Without a guard, both could run their merge/adoptCloudSnapshot logic
// concurrently and double-apply the same cloud transactions into state.transactions.
let _driveSyncFromCloudBusy = false;
async function driveSyncFromCloud(isInitial, interactive){
  if(!driveAccessToken) return;
  if(_driveSyncFromCloudBusy) return;
  _driveSyncFromCloudBusy = true;
  // A debounced local push may be armed from a save in the last 1.5s. Cancel it so
  // it can't fire mid-pull and clobber the cloud before we've merged it in.
  clearTimeout(driveSyncTimer); driveSyncTimer = null;
  setDriveIndicator('syncing');
  try{
    await driveFindFile();
    if(!driveFileId){
      // nothing on Drive yet — push current local state up
      await driveSyncToCloud();
      return;
    }
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
      headers: { 'Authorization': 'Bearer ' + driveAccessToken }
    });
    if(!res.ok) throw await _driveErrFromRes(res, 'drive download failed');
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

    // both sides have data — compare by DATA-edit time (transactions/balances/subs),
    // not lastEdit, so a pref-only tweak (crisis/layout) never overwrites fresher
    // cloud transactions. Fall back to exportedAt/lastEdit for older snapshots.
    const cloudTime = (typeof cloud.dataEditedAt === 'number' && cloud.dataEditedAt > 0)
      ? cloud.dataEditedAt
      : (cloud.exportedAt ? Date.parse(cloud.exportedAt) : 0);
    const localTime = (parseInt(localStorage.getItem(LS_PREFIX + 'dataEdit') || '0', 10) || 0)
      || (parseInt(localStorage.getItem(LS_PREFIX + 'lastEdit') || '0', 10) || 0);

    if(!interactive){
      // automatic reconnect — never interrupt. Instead of clobbering one side, do a
      // transaction-level UNION merge so nothing added on either device is lost, and
      // honor tombstones from both sides so deletions still propagate (no resurrected
      // rows). Config is taken from whichever side edited last.
      // Defer the swap while the user has a modal/the add-drawer open, or another
      // mutation is mid-flight — same guards the cross-tab storage listener uses
      // (app.logic.js's window 'storage' handler) — so an in-progress edit isn't
      // yanked out from under editingTxId/pendingIncomeTx by the array being
      // replaced mid-flow. _opInFlight also covers windows the DOM checks miss,
      // e.g. addTx's auto-distribution step which keeps _opInFlight raised after
      // the add-drawer has already closed.
      // Capped so a forgotten open modal can't stall sync forever.
      for(let waited=0; waited<10000 && (document.querySelector('.modal-overlay.open') || addDrawerOpen || _opInFlight > 0); waited+=250){
        await new Promise(r => setTimeout(r, 250));
      }
      _opInFlight++;
      try{
        const cloudNewer = cloudTime > localTime;
        const { added, removed } = mergeCloudData(cloud, cloudNewer);
        await saveBalances(); await saveTx(); await saveConfig(); await saveSubs(); await saveWalletDefs();
        render(true);
        await driveSyncToCloud(); // push the merged result so the cloud converges too
        if(added || removed){
          toast(`☁️ تمت المزامنة — ${added ? `أُضيف ${added} ` : ''}${removed ? `حُذف ${removed} ` : ''}من جهاز آخر`);
        }
      } finally { _opInFlight--; }
      setDriveIndicator('ok');
      return;
    }

    // interactive sign-in with genuine data on both sides — let the user choose,
    // showing each copy's size + timestamp so the decision is informed
    _pendingDriveCloud = cloud;
    // Manual digit formatting (not toLocaleString) — this choice drives a
    // destructive "keep cloud vs keep local" decision, so it must render
    // identically across platforms regardless of ICU bidi quirks.
    const fmtWhen = ms => {
      if(!ms || !isFinite(ms)) return 'غير معروف';
      const d = new Date(ms);
      return `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    };
    const cloudCount = (cloud.transactions || []).length;
    const localCount = state.transactions.length;
    const newer = cloudTime > localTime ? 'cloud' : (localTime > cloudTime ? 'local' : '');
    const tag = side => newer === side ? ' <b style="color:var(--green)">(الأحدث)</b>' : '';
    const info = document.getElementById('conflictInfo');
    if(info) info.innerHTML =
      `☁️ <b>Drive</b>: ${arPlural(cloudCount, 'عملية', 'عمليتين', 'عمليات')} · ${escHtml(fmtWhen(cloudTime))}${tag('cloud')}<br>` +
      `📱 <b>المحلية</b>: ${arPlural(localCount, 'عملية', 'عمليتين', 'عمليات')} · ${escHtml(fmtWhen(localTime))}${tag('local')}`;
    openModal('driveConflictModal');
  }catch(e){
    _handleDriveSyncError(e);
  } finally {
    _driveSyncFromCloudBusy = false;
  }
}

async function resolveConflict(useCloud){
  // Adopting the cloud copy permanently overwrites whatever's on this device —
  // unlike every other destructive action in the app (delete tx, wipe data),
  // this one had no confirm step, so a stale/wrong Drive snapshot could wipe
  // out newer local data with a single tap.
  if(useCloud && !confirm('سيتم استبدال كل بيانات هذا الجهاز بنسخة Drive نهائياً. متابعة؟')) return;
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
  // only toast success when the upload actually succeeded — driveSyncToCloud
  // catches its own errors (and toasts them), returning false on failure/queue
  driveSyncToCloud().then(ok => { if(ok) toast('✓ تمت المزامنة مع Drive'); });
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
        } else {
          // disconnected — reconnect. maybePromptDriveConnect() decides how:
          // desktop auto-sign-in users reconnect SILENTLY (prompt:'' — no UI, no
          // re-consent); mobile/embedded users get a one-tap banner (whose tap drives
          // a gesture-backed interactive request instead, see driveReconnectInteractive()).
          // A gesture-free silent call is only used in safe desktop contexts, since on
          // mobile it can redirect to gsi/transfer and hang on a blank page.
          maybePromptDriveConnect();
        }
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
  clearTimeout(window._splashTimer); // cancel the 6s error watchdog — we loaded successfully
  const el = document.getElementById('splash');
  if(el) el.classList.add('hide');
}

/* ============================================================
   FIRST-RUN WELCOME MODAL
============================================================ */
let _welcomeStep = 0;
const _WELCOME_STEPS = 6;
// Returns true iff onboarding was actually shown — callers use this (not their own
// pre-load localStorage peek) since the answer can only be known accurately AFTER
// loadState() has had a chance to recover data from IndexedDB (see below).
function checkFirstRun(){
  try{
    const seen = localStorage.getItem(LS_PREFIX + 'welcomeSeen');
    if(!seen){
      // A wiped localStorage looks identical to a genuinely new install (neither has
      // a 'welcomeSeen' key) — but if loadState() already recovered real transaction
      // history from IndexedDB, this is a RETURNING user, not a new one. Showing the
      // "welcome to the app" onboarding to someone with months of data is confusing;
      // mark it seen and skip straight past it instead.
      if(state.transactions.length > 0){
        try{ localStorage.setItem(LS_PREFIX + 'welcomeSeen', '1'); }catch(e){}
        return false;
      }
      _welcomeStep = 0;
      _renderWelcomeStep();
      openModal('welcomeModal');
      return true;
    }
  }catch(e){}
  return false;
}
// Build the progress dots once, then sync slide/dots/buttons to the current step.
function _renderWelcomeStep(){
  const dots = document.getElementById('onbDots');
  if(dots && dots.childElementCount !== _WELCOME_STEPS){
    dots.innerHTML = '';
    for(let i=0;i<_WELCOME_STEPS;i++){
      const d = document.createElement('span');
      d.className = 'onb-dot';
      d.onclick = () => { _welcomeStep = i; _renderWelcomeStep(); };
      dots.appendChild(d);
    }
  }
  document.querySelectorAll('#welcomeModal .onb-slide').forEach(s => {
    s.classList.toggle('active', Number(s.dataset.step) === _welcomeStep);
  });
  if(dots) Array.from(dots.children).forEach((d,i)=> d.classList.toggle('active', i === _welcomeStep));
  const isLast = _welcomeStep === _WELCOME_STEPS - 1;
  const back = document.getElementById('onbBack');
  const nav = document.querySelector('#welcomeModal .onb-nav');
  const start = document.getElementById('onbStart');
  if(back) back.style.visibility = _welcomeStep === 0 ? 'hidden' : 'visible';
  if(nav) nav.style.display = isLast ? 'none' : 'flex';
  if(start) start.style.display = isLast ? 'flex' : 'none';
}
function welcomeNav(dir){
  _welcomeStep = Math.min(_WELCOME_STEPS - 1, Math.max(0, _welcomeStep + dir));
  _renderWelcomeStep();
  haptic(8);
}
function welcomeStart(recordIncome){
  closeWelcome();
  if(recordIncome){ openAddDrawer(); setAddFormType('income'); }
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
    // exclude transfers AND manual balance adjustments so "أمس" matches the
    // income/expense totals shown everywhere else in the app
    if(tx.ts >= yStart && tx.ts < yEnd && tx.category!=='transfer' && tx.category!=='adjustment'){
      if(tx.type==='expense'){ yExpense += tx.amount; yCount++; }
      else { yIncome += tx.amount; }
    }
  });

  let lines = [];
  if(yCount > 0 || yIncome > 0){
    lines.push(`📅 <b style="color:var(--text)">أمس:</b> صرفت <b style="color:var(--red)">${fmt(yExpense)}</b> على ${arPlural(yCount, 'معاملة', 'معاملتين', 'معاملات')}${yIncome>0?` · دخل <b style="color:var(--green)">${fmt(yIncome)}</b>`:''}`);
  } else {
    lines.push(`📅 لم تُسجَّل معاملات أمس.`);
  }

  // budget warnings — skip wallets currently merged into the crisis combined
  // card: their individual budget bar isn't rendered while crisis mode is on,
  // so naming them here would reference a wallet the user can't see or act on.
  const _crisisIds = state.crisisMode ? crisisWalletIds() : null;
  WALLET_DEFS.forEach(w=>{
    if(w.track || !budgets[w.id]) return;
    if(_crisisIds && _crisisIds.includes(w.id)) return;
    const spent = monthlyExpenseForWallet(w.id);
    const budget = budgets[w.id];
    if(spent >= budget){
      lines.push(`🔴 محفظة <b style="color:var(--text)">${escHtml(w.name)}</b> تجاوزت ميزانيتها الشهرية (${fmt(spent)} / ${fmt(budget)}).`);
    } else if(spent >= budget*0.8){
      lines.push(`🟡 محفظة <b style="color:var(--text)">${escHtml(w.name)}</b> قاربت حد ميزانيتها (${fmt(spent)} / ${fmt(budget)}).`);
    }
  });

  // subscriptions due today (billing day matches today's date). For a billing day
  // beyond the current month's length (e.g. 31 in Feb/Apr), treat the last day of
  // the month as the due day so a "31st" sub still fires on the 28th/30th.
  const todayDay = now.getDate();
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dueSubs = subscriptions.filter(s => {
    if(s.active === false) return false;
    const effectiveDay = Math.min(s.billingDay, lastDayOfMonth);
    return effectiveDay === todayDay;
  });
  if(dueSubs.length > 0){
    const dueTotal = round2(dueSubs.reduce((s,x) => s + (Number(x.amount) || 0), 0));
    const dueNames = dueSubs.map(s => escHtml(s.name)).join('، ');
    lines.push(`📆 اشتراكات تُحسم اليوم: <b style="color:var(--text)">${dueNames}</b> · إجمالي: <b style="color:var(--red)">${fmt(dueTotal)}</b>`);
  }

  // pending recurring suggestions
  const recurring = detectRecurring();
  if(recurring.length > 0){
    lines.push(`🔁 لديك ${arPlural(recurring.length, 'معاملة متكررة محتملة', 'معاملتان متكررتان محتملتان', 'معاملات متكررة محتملة', 'معاملة واحدة متكررة محتملة')} بانتظار مراجعتك (تبويب تحليلات).`);
  }

  if(lines.length === 1 && yCount===0 && yIncome===0) return null;
  return lines.map(l=>`<div>${l}</div>`).join('');
}

/* ============================================================
   MONTHLY REPORT EXPORT (text-based, share or download)
============================================================ */
function exportMonthlyReport(){
  const now = new Date();
  const monthName = now.toLocaleDateString('ar-EG', {month:'long', year:'numeric', numberingSystem:'latn'});
  const [start, end] = monthRange(0);

  let totalIncome=0, totalExpense=0;
  const catTotals = {};
  state.transactions.forEach(tx=>{
    // skip transfers AND manual balance adjustments — otherwise an 'adjustment'
    // tx would be bucketed under "أخرى" and the report totals would diverge from
    // the in-app income/expense summary the user sees
    if(tx.ts < start || tx.ts >= end || tx.category==='transfer' || tx.category==='adjustment') return;
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
    report += `  ${w.track?'🏦':'💰'} ${w.name}: ${fmt(state.wallets[w.id] ?? 0)}\n`;
  });

  report += `\n📱 محفظتيييي 🙂‍↔️`;

  const shareData = { title: `تقرير محفظتيييي — ${monthName}`, text: report };
  if(navigator.share && (!navigator.canShare || navigator.canShare(shareData))){
    navigator.share(shareData).catch(e=>{
      // AbortError = user dismissed the native share sheet without picking a
      // target app — that's normal, frequent, expected behavior, not a failure,
      // so don't fall back to clipboard copy (which would show a confusing
      // "copied!" toast right after the user chose to cancel, not copy).
      if(e && e.name === 'AbortError') return;
      copyReportToClipboard(report);
    });
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
  // UTF-8 BOM so Arabic text renders correctly when opened directly in Windows
  // Notepad/Excel instead of mojibake (neither auto-detects UTF-8 without it).
  const blob = new Blob(['﻿', report], {type:'text/plain;charset=utf-8'});
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
  // must match the dark-mode value used by applyTheme()'s <meta name="theme-color">
  // (app.core.js) and the inline pre-paint script in index.html — otherwise the
  // installed PWA's OS chrome/splash color drifts from what the in-app UI shows.
  const themeColor = isLight ? '#f4f2ed' : '#15171c';
  const scopeUrl = new URL('.', location.href).pathname;
  const manifest = {
    name: 'محفظتيييي',
    short_name: 'محفظتيييي',
    start_url: scopeUrl,
    // the manifest is served as a blob: URL, so its own "directory" is meaningless —
    // without an explicit scope the browser can't derive one from the blob URL,
    // which can break standalone-window navigation scoping. Pin it to the app's
    // real deployed path (works at root or in a subdirectory).
    scope: scopeUrl,
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
        // 'maskable' would tell Android it can crop to the inner 80% safe-zone circle —
        // this icon's emoji isn't padded for that and would clip at the edges. 'any'
        // only, so the OS applies its own shape mask without assuming safe-zone padding.
        purpose: 'any'
      }
    ]
  };
  return new Blob([JSON.stringify(manifest)], {type:'application/json'});
}
let _manifestBlobUrl = null; // tracked separately from the link's href so a revoke
// can't be skipped by a failed/never-applied previous toggle (getAttribute() would
// silently miss that case and leak the blob for the rest of the session).
function applyManifest(isLight){
  try{
    const link = document.getElementById('manifestLink');
    if(!link) return;
    const next = URL.createObjectURL(buildManifestBlob(isLight));
    link.setAttribute('href', next);
    if(_manifestBlobUrl) URL.revokeObjectURL(_manifestBlobUrl);
    _manifestBlobUrl = next;
  }catch(e){}
}
/* ─── PWA Update Banner ─── */
function showUpdateBanner(){
  const el = document.getElementById('updateBanner');
  if(!el || el.classList.contains('show')) return;
  // Wire buttons via JS — more reliable than inline onclick across all browsers
  const laterBtn = document.getElementById('btnUpdateLater');
  const nowBtn   = document.getElementById('btnUpdateNow');
  if(laterBtn) laterBtn.onclick = dismissUpdate;
  if(nowBtn)   nowBtn.onclick   = applyUpdate;
  requestAnimationFrame(()=> requestAnimationFrame(()=> el.classList.add('show')));
}
function dismissUpdate(){
  const el = document.getElementById('updateBanner');
  if(el) el.classList.remove('show');
}
function applyUpdate(){
  // Don't silently discard a half-typed transaction on reload.
  if(addDrawerOpen){
    const amt = document.getElementById('amountInput');
    const desc = document.getElementById('descInput');
    if((amt && amt.value) || (desc && desc.value)){
      if(!confirm('لديك معاملة غير محفوظة في نموذج الإضافة — التحديث الآن سيتجاهلها. متابعة؟')) return;
    }
  }
  // Same guard for an in-progress transaction edit.
  if(editingTxId != null){
    if(!confirm('لديك تعديل معاملة لم يُحفظ — التحديث الآن سيتجاهله. متابعة؟')) return;
  } else if(document.querySelector('.modal-overlay.open')){
    // Any other open dialog (تحويل/اشتراك/محفظة/توزيع الدخل، إلخ) can also hold
    // unsaved form input the two specific checks above don't know about — the
    // cross-tab storage listener already treats "any modal open" as unsafe to
    // reload over (see _anyOverlayOpen below); applyUpdate() is a user-initiated
    // reload so it asks instead of silently deferring.
    if(!confirm('هناك نافذة مفتوحة قد تحتوي بيانات غير محفوظة — التحديث الآن سيُغلقها. متابعة؟')) return;
  }
  // Flush any pending Drive sync before the reload interrupts it.
  if(typeof driveSyncTimer !== 'undefined' && driveSyncTimer){
    clearTimeout(driveSyncTimer); driveSyncTimer = null;
    if(driveAccessToken){ try{ driveSyncToCloud(); }catch(_){} }
  }
  const btn = document.getElementById('btnUpdateNow');
  if(btn){ btn.disabled = true; btn.textContent = '...جاري'; }
  _reloadOnControllerChange = true;
  if(_pendingWorker){
    try{ _pendingWorker.postMessage({type:'SKIP_WAITING'}); }catch(e){}
  }
  // Reload after 2s — covers browsers where controllerchange is unreliable
  setTimeout(() => window.location.reload(), 2000);
}

async function forceClearAndUpdate(){
  const btn = document.querySelector('.btn-cache-refresh');
  if(btn){ btn.disabled = true; btn.textContent = '⏳ جاري...'; }
  try{
    // Wipe every cache bucket the browser holds for this origin
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    // If a new SW is already waiting, activate it immediately
    const reg = await navigator.serviceWorker.getRegistration();
    if(reg){
      if(reg.waiting){
        reg.waiting.postMessage({type:'SKIP_WAITING'});
        await new Promise(r => setTimeout(r, 600));
      } else {
        // Force the browser to re-fetch sw.js and install a fresh SW
        await reg.update();
        await new Promise(r => setTimeout(r, 800));
      }
    }
  }catch(e){}
  // Hard reload — cache is empty so browser fetches everything fresh
  window.location.reload();
}

/* ============================================================
   CHANGELOG ("ما الجديد؟")
============================================================ */
// Shows/hides the "جديد" dot on the settings entry point by comparing the
// newest CHANGELOG version against the last one the user actually opened —
// runs at startup (so the dot is right before Settings is ever opened) and
// again right after openChangelog() marks the latest version as seen.
function _updateChangelogDot(){
  const dot = document.getElementById('changelogDot');
  if(!dot || !CHANGELOG.length) return;
  let seen = null;
  try{ seen = localStorage.getItem(LS_PREFIX + 'changelogSeen'); }catch(e){}
  dot.hidden = (seen === CHANGELOG[0].version);
}
function renderChangelog(){
  const host = document.getElementById('changelogList');
  if(!host) return;
  host.innerHTML = CHANGELOG.map(e => `
    <div class="changelog-entry">
      <div class="changelog-entry-head">
        <span class="changelog-entry-title">${escHtml(e.title)}</span>
        <span class="changelog-entry-date">${escHtml(e.date)}</span>
      </div>
      <ul>${e.items.map(it => `<li>${escHtml(it)}</li>`).join('')}</ul>
    </div>
  `).join('');
}
function openChangelog(){
  renderChangelog();
  try{ localStorage.setItem(LS_PREFIX + 'changelogSeen', CHANGELOG[0].version); }catch(e){}
  _updateChangelogDot();
  openModal('changelogModal');
}

// Ask the browser to re-check sw.js for a new version. `force` skips the 30s
// throttle (used for the initial check). The throttle stops rapid tab-switching
// from hammering the network while still letting a return-after-hours check run.
let _lastSWUpdateCheck = 0;
function checkForSWUpdate(force){
  const reg = _swRegistration;
  if(!reg) return;
  const now = Date.now();
  if(!force && now - _lastSWUpdateCheck < 30000) return;
  _lastSWUpdateCheck = now;
  // a SW may already be installed and waiting (detected on a previous check) —
  // surface its banner immediately instead of waiting for another updatefound
  if(reg.waiting && !_pendingWorker){
    _pendingWorker = reg.waiting;
    showUpdateBanner();
  }
  try{ reg.update(); }catch(_){}
}

function setupPWA(){
  applyManifest(document.body.classList.contains('light'));

  if(!('serviceWorker' in navigator)) return;

  // Suppress the banner on the load immediately after a user-triggered update
  // to avoid showing it again for the same SW version.
  const justUpdated = !!sessionStorage.getItem('_swJustUpdated');
  sessionStorage.removeItem('_swJustUpdated');

  try{
    // updateViaCache:'none' → the browser always re-fetches sw.js from the network
    // (never the HTTP cache) when checking for updates, so a new version is detected
    // reliably instead of being masked by a stale cached sw.js. This is the main fix
    // for the "update banner shows up late" problem.
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(reg => {
        _swRegistration = reg;

        if(reg.waiting && !justUpdated){
          _pendingWorker = reg.waiting;
          showUpdateBanner();
        }

        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if(!worker) return;
          worker.addEventListener('statechange', () => {
            if(worker.state === 'installed' && navigator.serviceWorker.controller && !justUpdated){
              _pendingWorker = worker;
              showUpdateBanner();
            }
          });
        });

        // Trigger an explicit check right away, then poll every 15 min while the app
        // stays open, so long-running sessions pick up a new version promptly.
        checkForSWUpdate(true);
        setInterval(checkForSWUpdate, 15 * 60 * 1000);
      })
      .catch(e => console.warn('SW registration failed:', e));

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if(_reloadOnControllerChange){
        sessionStorage.setItem('_swJustUpdated', '1');
        window.location.reload();
      }
    });
  }catch(e){}
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
    _sigDist, autoDistribute,
    dismissedRecurring.size,
    _txMutationStamp
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
  _pieChartSig = ''; // same reasoning as above — pie totals also depend on in-place edits / day-rollover, not just _txMutationStamp
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
window.addEventListener('resize', ()=> { clearTimeout(_resizeTimer); _resizeTimer = setTimeout(()=>{ renderChart(); renderPieChart(); }, 150); });

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
  if(e.key === 'Tab'){
    const container = addDrawerOpen
      ? document.getElementById('addDrawer')
      : (()=>{ const m = [...document.querySelectorAll('.modal-overlay.open')]; return m.length ? m[m.length-1] : null; })();
    if(container){
      const focusable = [...container.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter(el => el.offsetParent !== null);
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
initAccent();
initLang();
loadLayoutPrefs();
renderBottomNav();
applySectionOrder();
setupPWA();
_updateChangelogDot();
loadState().then(()=>{
  hideSplash();
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
    _monthlyExpenseCache = null;
    _monthlyExpenseCacheKey = '';
    capDateInputsToToday(); // "today" may have rolled over while tab was hidden
    checkForSWUpdate(); // returning to the app is the prime moment to catch a new version
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
  }
});

// Without this, going offline left the header showing whatever it last said
// (often "متزامن ✓") indefinitely — nothing re-evaluates the indicator until
// the next save's debounced sync attempt fails. A user could believe a second
// device already has their offline edits when nothing has actually synced.
window.addEventListener('offline', () => {
  if(driveAccessToken) setDriveIndicator('offline');
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
  // Layout prefs (tab/section order, recent-tx page size) are cosmetic-only and
  // never touch dataEdit/lastEdit — reloading the full ledger for them would
  // flash/scroll-jump every other open tab over a change that doesn't affect
  // their money data at all.
  const _isLayoutPrefKey = e.key === LS_PREFIX+'tabOrder' || e.key === LS_PREFIX+'recentTxLimit' ||
    (e.key && e.key.indexOf(LS_PREFIX+'secOrder_') === 0);
  if(e.key && e.key.startsWith(LS_PREFIX) && e.key !== LS_PREFIX+'lastEdit' && !_isLayoutPrefKey){
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
      _storageSyncTimer = setTimeout(_trySync, 200);
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
  toast('⚠ حدث خطأ غير متوقع', true);
});

// Prevent accidental scroll-wheel from changing number input values on desktop
// Delegated to document so it covers any dynamically added number inputs too
document.addEventListener('wheel', e => {
  if(e.target && e.target.tagName === 'INPUT' && e.target.type === 'number' && document.activeElement === e.target){
    e.preventDefault();
  }
}, {passive:false});
