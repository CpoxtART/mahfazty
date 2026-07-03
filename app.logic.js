/* ============================================================
   ADD / EDIT / DELETE TRANSACTIONS
============================================================ */
// Money writes are refused until loadState() has resolved — the app is
// technically reachable before then (Tab past the splash, or the 6s fatal
// watchdog force-hiding it over a slow IndexedDB restore), and a transaction
// pushed into the transient empty state gets wiped when the real data lands.
let _stateLoaded = false;
function _stateNotReady(){
  if(_stateLoaded) return false;
  toast(t({ar:'⏳ التطبيق ما زال يُحمّل بياناتك — لحظة واحدة', en:'⏳ Still loading your data — one moment'}), true);
  return true;
}
let _addTxBusy = false;
async function addTx(type){
  if(_addTxBusy) return;
  if(_stateNotReady()) return;
  // cross-op write guard (see commitQuickNotes): don't start a write while another
  // mutation is mid-flight across an await — prevents interleaved balance writes
  if(_opBusy()) return;
  _addTxBusy = true;
  _opInFlight++;
  _txMutationStamp++;
  const _expBtn = document.getElementById('addExpenseBtn');
  const _incBtn = document.getElementById('addIncomeBtn');
  _setBtnSaving(_expBtn, true, t({ar:'⏳ جارٍ الحفظ...', en:'⏳ Saving...'}));
  _setBtnSaving(_incBtn, true, t({ar:'⏳ جارٍ الحفظ...', en:'⏳ Saving...'}));
  try{
    const walletId = selectedWallet;
    const desc = document.getElementById('descInput').value.trim().slice(0,120); // cap length (voice/paste bypass maxlength)
    // round to cents at entry so the stored amount matches what fmt() displays —
    // otherwise sub-cent input (10.999) shows "11.00" but sums as 10.999 and drifts
    const amountVal = round2(parseAmount(document.getElementById('amountInput').value));
    const dateVal = document.getElementById('dateInput').value || todayISO();

    if(!isFinite(amountVal) || amountVal <= 0){
      toast(t({ar:'⚠ أدخل مبلغ صحيح', en:'⚠ Enter a valid amount'}), true);
      document.getElementById('amountInput').focus();
      return;
    }
    if(!WALLET_DEFS.find(w => w.id === walletId)){
      toast(t({ar:'⚠ اختر محفظة صحيحة', en:'⚠ Choose a valid wallet'}), true);
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
    // Income recorded INTO a track wallet (Uber/Cards/Cash) is a standalone amount
    // for that counter — it must NOT be split across the budget wallets, so the
    // whole distribution flow (auto + the prompt) is skipped for it.
    const _distributable = type === 'income' && tx.category !== 'transfer' && !isTrackWallet(walletId);
    // Signal closeAddDrawer() to skip history.back() when it's followed immediately
    // by openModal(distributeModal) — the flag is checked inside closeAddDrawer()
    // so the drawer's history entry gets replaced atomically instead of back()+push().
    if(_distributable && !autoDistribute && addDrawerOpen){
      _nextPushOverlayReplaces = true;
    }
    closeAddDrawer();
    haptic(15); // brief confirm pulse on a successful entry
    toast(type==='expense' ? t({ar:'✓ تم تسجيل المصروف', en:'✓ Expense recorded'}) : t({ar:'✓ تم تسجيل الدخل', en:'✓ Income recorded'}));

    // auto-distribution flow for income (budget-wallet income only)
    if(_distributable && autoDistribute){
      const _distributed = await runDistribution(tx, amountVal);
      // single render after distribution completes — skips an intermediate render
      // that would paint the income-only state before the distribution legs exist
      render();
      if(_distributed) toast(t({ar:'🔄 تم توزيع الدخل تلقائيًا', en:'🔄 Income auto-distributed'}));
    } else {
      render(); // expenses, track-wallet income, and manual-distribution incomes render once right here
      if(_distributable){
        pendingIncomeTx = tx;
        try{ openDistributionModal(amountVal); } // _pushOverlayHistory() will replaceState (flag already set)
        finally{ _nextPushOverlayReplaces = false; } // reset even if openDistributionModal throws
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
  const _srcId = pendingIncomeTx && pendingIncomeTx.wallet;
  const activeEntries = DISTRIBUTION.filter(d => d && d.pct > 0 && d.id !== _srcId && WALLET_DEFS.find(x=>x.id===d.id && !x.track));
  if(activeEntries.length === 0){
    const warn = document.createElement('div');
    warn.className = 'hint';
    warn.style.cssText = 'color:var(--red); margin:0; font-size:var(--fs-base);';
    warn.textContent = `⚠ ${t({ar:'لا توجد نسب توزيع — اضبطها في الإعدادات أولاً', en:'No distribution ratios set — set them up in Settings first'})}`;
    wrap.appendChild(warn);
  } else {
    const totalPct = activeEntries.reduce((s,d)=>s+d.pct, 0);
    // Use the same formula as runDistribution() so preview amounts match what actually
    // gets committed: compute intendedTotal first, then proportional allocation, then
    // let the last entry absorb any sub-cent rounding residual.
    const intendedTotal = round2(Math.min(amount, amount * totalPct / 100));
    let previewAllocated = 0;
    activeEntries.forEach((d, idx)=>{
      const w = WALLET_DEFS.find(x=>x.id===d.id);
      const isLast = idx === activeEntries.length - 1;
      const share = isLast
        ? round2(intendedTotal - previewAllocated)
        : round2(intendedTotal * d.pct / totalPct);
      previewAllocated += share;
      const row = document.createElement('div');
      row.className = 'dist-row';
      row.innerHTML = `<span class="name">${escHtml(w.name)} <span class="pct">${escHtml(String(d.pct))}%</span></span><span class="amt">${escHtml(fmt(share))}</span>`;
      wrap.appendChild(row);
    });
    if(totalPct > 100){
      const warn = document.createElement('div');
      warn.className = 'hint';
      warn.style.cssText = 'color:var(--red); margin:8px 0 0; font-size:var(--fs-base);';
      warn.textContent = `⚠ ${t({ar:`مجموع النسب ${totalPct}% — يتجاوز 100%، راجع الإعدادات`, en:`Ratios total ${totalPct}% — over 100%, check Settings`})}`;
      wrap.appendChild(warn);
    } else if(totalPct < 100){
      // surface where the un-distributed remainder goes — it stays in the wallet
      // the income landed in, which is otherwise invisible to the user
      const srcId = pendingIncomeTx && pendingIncomeTx.wallet;
      const srcW = WALLET_DEFS.find(x => x.id === srcId);
      const remainderPct = round2(100 - totalPct);
      const remainder = round2(amount * remainderPct / 100);
      if(remainder > 0){
        const note = document.createElement('div');
        note.className = 'dist-row';
        note.style.cssText = 'border-style:dashed; opacity:.85; margin-top:4px;';
        const remainderWalletName = srcW ? escHtml(srcW.name) : t({ar:'المحفظة', en:'the wallet'});
        note.innerHTML = `<span class="name">${escHtml(t({ar:'يبقى في', en:'Remains in'}))} ${remainderWalletName} <span class="pct">${remainderPct}%</span></span><span class="amt">${fmt(remainder)}</span>`;
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
  saveAutoDistributePref();
  if(!pendingIncomeTx) { closeModal('distributeModal'); return; }
  const hasActive = DISTRIBUTION.some(d => d && d.pct > 0 && WALLET_DEFS.find(x=>x.id===d.id && !x.track));
  if(!hasActive){
    toast(t({ar:'⚠ لا توجد نسب توزيع — اضبطها في الإعدادات أولاً', en:'⚠ No distribution ratios set — set them up in Settings first'}), true);
    return;
  }
  // _txMutationStamp is incremented only after ALL early-return guards pass — no
  // unnecessary cache invalidation when confirmDistribution() is a no-op
  _txMutationStamp++;
  const txToDistribute = pendingIncomeTx;
  pendingIncomeTx = null; // clear early so double-tap cannot trigger a second distribution
  // re-find by id: a cross-tab reload could have replaced state.transactions, leaving
  // txToDistribute detached (its link mutation + legs would target a stale object)
  const live = state.transactions.find(t => t.id === txToDistribute.id);
  if(!live){ closeModal('distributeModal'); toast(t({ar:'⚠ تعذّر التوزيع — لم تعد المعاملة موجودة', en:'⚠ Could not distribute — the transaction no longer exists'}), true); return; }
  _opInFlight++; // guard the multi-await distribution against a mid-flight reload
  const _btn = document.getElementById('confirmDistributionBtn');
  _setBtnSaving(_btn, true);
  try{
    await runDistribution(live, live.amount);
    closeModal('distributeModal');
    render();
    toast(t({ar:'✓ تم توزيع الدخل على المحافظ', en:'✓ Income distributed across wallets'}));
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
  // distributed income into a track-only wallet (uber/cards/cash), and never
  // route it back into the source wallet (that would double-credit the income).
  const active = DISTRIBUTION.filter(d => d && d.pct > 0 && WALLET_DEFS.find(x=>x.id===d.id && !x.track && x.id !== sourceWalletId));
  const totalPct = active.reduce((s,d)=> s + d.pct, 0);
  // never distribute more than the income itself (caps any >100% misconfiguration)
  const intendedTotal = round2(Math.min(amount, amount * totalPct / 100));

  // nothing to distribute — leave the income where it landed, don't withdraw
  if(intendedTotal <= 0){ await saveBalances(); await saveTx(); return false; }

  // Link the originating income AFTER the early-return guard — no point stamping
  // a link that would immediately be stripped by stripOrphanLinks() on zero distribution.
  sourceTx.link = linkId;

  // Withdraw only the portion that will actually be distributed. Any
  // undistributed remainder (when percentages sum to < 100%) then stays in
  // the source wallet instead of silently vanishing from the balance.
  const txOut = {
    id: 'tx_'+Date.now()+'_d0'+Math.random().toString(36).slice(2,7),
    wallet: sourceWalletId,
    desc: t({ar:'توزيع الدخل على المحافظ', en:'Income distributed across wallets'}),
    amount: intendedTotal,
    type: 'expense',
    category: 'transfer',
    ts: ts+1,
    link: linkId,
    _distributionLeg: true // marks this as a distribution withdrawal so orphan-detection can find it if the source income is later deleted
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
      desc: t({ar:`حصة ⁦${w.name}⁩ (⁦${d.pct}%⁩) من دخل`, en:`${w.name}'s share (${d.pct}%) of income`}),
      amount: share,
      type: 'income',
      category: 'transfer',
      ts: ts+2+i,
      link: linkId,
      _distributionLeg: true
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
  return true;
}

/**
 * Round a money value to 2 decimals, correcting binary-float misrounding.
 * @param {number} n
 * @returns {number}
 */
function round2(n){
  // Plain Math.round(n*100)/100 misrounds values like 1.005 → 1 (should be
  // 1.01) because 1.005*100 is actually 100.49999... in binary float. The
  // Number.EPSILON nudge corrects that without affecting any normal value.
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
    state.transactions.filter(t => t.link === tx.link && t.id !== tx.id).length >= 1);
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
  // Also lock via tabIndex/aria so keyboard navigation can't bypass the CSS-only lock
  _ewb.tabIndex = _editingTransferLeg ? -1 : 0;
  _ewb.setAttribute('aria-disabled', String(!!_editingTransferLeg));
  document.getElementById('editDesc').value = tx.desc || '';
  document.getElementById('editAmount').value = (Number(tx.amount) || 0).toFixed(2); // match the 2-decimal display used everywhere else
  const d = new Date(tx.ts);
  document.getElementById('editDate').value = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  openModal('editModal');
}

let _saveEditBusy = false;
async function saveEdit(){
  if(_saveEditBusy) return; // double-tap guard: a second tap before the first
  // cross-op write guard (see commitQuickNotes) — block interleaving with another in-flight write
  if(_opBusy()) return;
  _saveEditBusy = true;     // completes would reverse+reapply the balance twice
  _opInFlight++;
  const _saveBtn = document.getElementById('saveEditBtn');
  _setBtnSaving(_saveBtn, true, t({ar:'⏳ جارٍ الحفظ...', en:'⏳ Saving...'}));
  try{
  const tx = state.transactions.find(t=>t.id===editingTxId);
  if(!tx){
    toast(t({ar:'⚠ المعاملة لم تعد موجودة — ربما حُذفت من تبويب آخر', en:'⚠ This transaction no longer exists — it may have been deleted from another tab'}), true);
    closeModal('editModal');
    return;
  }
  _txMutationStamp++; // after early-return guards so rejected saves don't invalidate caches

  const newAmount = round2(parseAmount(document.getElementById('editAmount').value)); // cent precision — match display, avoid sub-cent drift
  // Defense in depth: only block when the amount actually changed — desc/date/type/
  // category edits are safe and must not be locked out alongside the amount field.
  if(_editingDistSource && newAmount !== round2(tx.amount)){
    toast(t({ar:'⚠ هذه المعاملة موزعة على محافظ أخرى — احذفها وأضفها من جديد لتغيير المبلغ', en:'⚠ This transaction is distributed across other wallets — delete and re-add it to change the amount'}), true);
    return;
  }
  if(!isFinite(newAmount) || newAmount <= 0){
    toast(t({ar:'⚠ أدخل مبلغ صحيح', en:'⚠ Enter a valid amount'}), true);
    return;
  }
  if(!WALLET_DEFS.find(w => w.id === editWallet)){
    toast(t({ar:'⚠ محفظة غير صالحة', en:'⚠ Invalid wallet'}), true);
    return;
  }
  // Transfer leg wallet cannot change — keyboard navigation can bypass the CSS
  // pointerEvents:none lock set in openEdit(), so enforce it here too.
  if(_editingTransferLeg) editWallet = tx.wallet;

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
          tx.desc = tx.desc || (t({ar:'تحويل إلى ', en:'Transfer to '}) + partnerWalletDef.name);
          partner.desc = t({ar:'تحويل من ', en:'Transfer from '}) + newWalletDef.name;
        } else {
          tx.desc = tx.desc || (t({ar:'تحويل من ', en:'Transfer from '}) + partnerWalletDef.name);
          partner.desc = t({ar:'تحويل إلى ', en:'Transfer to '}) + newWalletDef.name;
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
  // floor at 2010 too (same reasoning as buildTxTs) so an out-of-range edited date
  // can't pin the entry to the top of every list / skew monthly filters.
  tx.ts = isFinite(newTs) ? Math.max(MIN_TX_TS, Math.min(newTs + msPart, Date.now())) : (isFinite(tx.ts) ? tx.ts : Date.now());

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
  toast(t({ar:'✓ تم التحديث', en:'✓ Updated'}));
  } finally {
    _saveEditBusy = false;
    _opInFlight--;
    _setBtnSaving(_saveBtn, false);
  }
}

async function deleteFromEdit(){
  if(!editingTxId) return;
  try{
    await deleteTx(editingTxId);
  } finally {
    closeModal('editModal');
  }
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
  if(!last){ toast(t({ar:'لا توجد معاملة سابقة لتكرارها', en:'No previous transaction to repeat'})); return; }
  document.getElementById('descInput').value = last.desc || '';
  document.getElementById('amountInput').value = (Number(last.amount) || 0).toFixed(2);
  document.getElementById('amountInput').dispatchEvent(new Event('input'));
  document.getElementById('dateInput').value = todayISO();
  // Skip selecting the previous wallet if it is a track wallet OR a crisisOnly
  // wallet that's currently hidden (crisis mode off) — prevents silently writing
  // a new transaction into an invisible wallet.
  const _lastWDef = WALLET_DEFS.find(w=>w.id===last.wallet);
  if(!_lastWDef?.track && !(_lastWDef?.crisisOnly && !state.crisisMode)){
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
  toast(t({ar:'✓ تم تعبية النموذج — راجع واضغط تسجيل', en:'✓ Form filled — review and tap Save'}));
}

let _lastDeleted = null;
let _undoTimer = null;

async function deleteTx(id){
  const target = state.transactions.find(t => t.id === id);
  if(!target) return;
  // Block deletion of a distribution LEG — it would cascade-delete the entire
  // linked group including the original income, which is almost never what the
  // user intends. Direct them to delete the source income to remove the whole group.
  if(target._distributionLeg && target.link){
    const hasSource = state.transactions.some(t => t.link === target.link && !t._distributionLeg && t.category !== 'transfer');
    if(hasSource){
      toast(t({ar:'⚠ هذه المعاملة جزء من توزيع دخل — احذف معاملة الدخل الأصلية لإزالة كل التوزيع', en:'⚠ This is part of an income distribution — delete the original income entry to remove the entire distribution'}), true);
      return;
    }
  }
  if(_stateNotReady()) return;
  // cross-op write guard (see commitQuickNotes) — block interleaving with another in-flight write
  if(_opBusy()) return;
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

    // Sweep for distribution legs whose income source was just removed (or whose
    // link was previously lost via merge, leaving withdrawal+deposits stranded).
    const orphanedLegs = stripOrphanedDistributionLegs(state.transactions);
    orphanedLegs.forEach(t => { applyTxToBalance(t, -1); removed.push(t); });

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
    toastWithUndo(removed.length > 1 ? t({ar:`🗑 تم حذف ${removed.length} حركات مرتبطة`, en:`🗑 Deleted ${removed.length} linked entries`}) : t({ar:'🗑 تم الحذف', en:'🗑 Deleted'}), undoDelete);
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
    // saveConfig FIRST to persist tombstone removal — if we crash after saveConfig
    // but before saveTx, the tx is absent from IDB but the tombstone is gone, so
    // on reload the user sees an empty undo (recoverable). If we persisted saveTx
    // first and crashed before saveConfig, the tx would be in IDB but still
    // tombstoned, causing it to be silently filtered out on reload (data loss).
    await saveConfig();
    await saveTx();
    render();
    toast(removed.length > 1 ? t({ar:'↩️ تم استرجاع الحركات', en:'↩️ Entries restored'}) : t({ar:'↩️ تم استرجاع المعاملة', en:'↩️ Transaction restored'}));
  } finally {
    _opInFlight--;
  }
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
  // Errors must interrupt a screen reader (assertive); routine confirmations
  // stay polite so they don't talk over the user. Explicit aria-live overrides
  // the element's implicit role="status" politeness.
  el.setAttribute('aria-live', isError ? 'assertive' : 'polite');
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
  toastWithAction(msg, t({ar:'تراجع ↩️', en:'Undo ↩️'}), undoFn, false, t({ar:'تراجع عن الحذف', en:'Undo deletion'}));
}
// critical=true marks a severe, rare warning (e.g. local persistence totally failed)
// that must not be silently overwritten by/lost a race with a routine toast that
// fires moments later from an in-flight optimistic save flow — see _criticalToastUntil.
function toastWithAction(msg, actionLabel, fn, critical, btnAriaLabel){
  if(!critical && Date.now() < _criticalToastUntil){ _queuedToast = {fn: toastWithAction, args:[msg, actionLabel, fn, critical, btnAriaLabel]}; return; }
  const el = document.getElementById('saveStatus');
  // critical warnings (e.g. data-loss) interrupt the screen reader; routine
  // action toasts (undo) stay polite. See the matching note in toast().
  el.setAttribute('aria-live', critical ? 'assertive' : 'polite');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  const btn = document.createElement('button');
  btn.textContent = actionLabel;
  // Provide an explicit emoji-free aria-label so the announcement is unambiguous
  // across screen readers (emoji verbalization varies by AT/platform).
  if(btnAriaLabel) btn.setAttribute('aria-label', btnAriaLabel);
  btn.style.cssText = 'background:var(--gold-btn); color:var(--on-gold); border:none; border-radius:var(--radius-pill); padding:5px 13px; font-size:var(--fs-sm); font-weight:700; margin-inline-end:8px; cursor:pointer;';
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
    _sigDist, autoDistribute, currentTab,
    dismissedRecurring.size,
    _txMutationStamp
  ].join('|');
}

function render(force){
  const sig = computeRenderSig();
  if(!force && sig === _renderSig) return; // nothing visual changed
  _renderSig = sig;
  _monthlyExpenseCache = null; // invalidate budget bars per-render
  // _recurringCache is intentionally NOT nulled here — detectRecurring()'s sig now
  // includes _txMutationStamp, which already captures all mutations. Nulling here
  // caused a full O(n) re-scan on every filter change / crisis toggle / etc.
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
// After a SW-triggered reload, show a brief "تم التحديث" toast so the user
// knows the new version is now active, then surface the changelog dot in Settings.
if(sessionStorage.getItem('_swJustUpdated')){
  sessionStorage.removeItem('_swJustUpdated');
  setTimeout(() => {
    const v = CHANGELOG[0]?.version || '';
    toast(t({ar:`✓ تم التحديث${v ? ' إلى ' + v : ''} — افتح الإعدادات لعرض الجديد 🎉`, en:`✓ Updated${v ? ' to ' + v : ''} — open Settings to see what's new 🎉`}));
    _updateChangelogDot();
  }, 900);
}
/* ============================================================
   EVENT BINDING — all UI event listeners wired here so index.html
   contains zero inline handlers and script-src CSP can use hashes.
============================================================ */
function _bindEvents(){
  const $ = id => document.getElementById(id);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
  // role="button" elements: activate on click + Enter/Space keydown
  const act = (el, fn) => { on(el,'click',fn); on(el,'keydown',e=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();fn(e);} }); };
  // custom-select elements: suppress ONLY the click echo that follows our own
  // keydown (the global Enter/Space handler synthesizes el.click() with
  // detail 0). A bare detail-0 click with no recent keydown is assistive-tech
  // activation (TalkBack/VoiceOver also report detail 0) and must go through —
  // the old blanket `if(!e.detail)return` made these controls dead for AT users.
  const sel = (el, fn) => {
    on(el,'click',e=>{ if(!e.detail && el._kbdEchoAt && Date.now() - el._kbdEchoAt < 1000) return; fn(e); });
    on(el,'keydown',e=>{ if(e.key==='Enter'||e.key===' '){ el._kbdEchoAt = Date.now(); e.preventDefault(); fn(e); } });
  };

  // Header
  on($('themeToggle'),'click',toggleTheme);
  on($('btnHeaderData'),'click',()=>openSettingsTab('data'));
  on($('btnHeaderSettings'),'click',()=>openSettingsTab('layout'));

  // Home tab
  act($('crisisToggle'),()=>toggleCrisis());
  act($('quickNotesBanner'),()=>openQuickNotes());

  // Bottom nav + FAB — event delegation on stable <nav> so listeners survive
  // every renderBottomNav() call (which recreates all buttons inside the inner div).
  // The generated buttons have no inline onclick= so CSP script-src stays clean.
  const _nav = document.querySelector('.bottom-nav');
  on(_nav,'click', e => {
    if(e.target.closest('.fab-btn')){ toggleAddDrawer(); return; }
    const btn = e.target.closest('.nav-item[id^="nav"]');
    if(btn) switchTab(btn.id.replace('nav','').toLowerCase());
  });

  // Analytics tab
  on($('btnExportMonthly'),'click',exportMonthlyReport);
  on($('btnSubAdd'),'click',()=>openSubModal(null));

  // Reports tab
  act($('walletFilterChip'),()=>clearWalletFilter());
  act($('categoryFilterChip'),()=>toggleCategoryFilter(null));
  document.querySelectorAll('[data-f]').forEach(el=>on(el,'click',()=>setFilter(el.dataset.f)));
  on($('searchInput'),'input',onSearchInput);
  on($('btnClearSearch'),'click',clearSearch);

  // Add drawer
  on($('addDrawerOverlay'),'click',closeAddDrawer);
  on($('btnDrawerClose'),'click',closeAddDrawer);
  on($('drawerTab0'),'click',()=>switchDrawerTab(0));
  on($('drawerTab1'),'click',()=>switchDrawerTab(1));
  sel($('walletSelectBtn'),()=>toggleWalletMenu());
  const _tSel=$('trackSelectBtn'); sel(_tSel,()=>openTrackPicker(_tSel));
  on($('voiceBtn'),'click',startVoiceInput);
  on($('addTypeExp'),'click',()=>setAddFormType('expense'));
  on($('addTypeInc'),'click',()=>setAddFormType('income'));
  on($('btnOpenTransfer'),'click',openTransferFromDrawer);
  on($('btnRepeatLast'),'click',repeatLastTx);
  on($('addExpenseBtn'),'click',()=>addTx('expense'));
  on($('addIncomeBtn'),'click',()=>addTx('income'));

  // Edit modal
  on($('editTypeExp'),'click',()=>setEditType('expense'));
  on($('editTypeInc'),'click',()=>setEditType('income'));
  sel($('editWalletBtn'),()=>toggleEditWalletMenu());
  on($('btnEditCancel'),'click',()=>closeModal('editModal'));
  on($('saveEditBtn'),'click',saveEdit);
  on($('btnEditDelete'),'click',deleteFromEdit);

  // Settings modal
  on($('btnForceUpdate'),'click',forceClearAndUpdate);
  on($('changelogBtn'),'click',openChangelog);
  document.querySelectorAll('[data-sett-tab]').forEach(el=>on(el,'click',()=>switchSettingsTab(el.dataset.settTab)));
  document.querySelectorAll('[data-theme-mode]').forEach(el=>on(el,'click',()=>setThemeMode(el.dataset.themeMode)));
  document.querySelectorAll('[data-lang]').forEach(el=>on(el,'click',()=>setLang(el.dataset.lang)));
  on($('btnResetLayout'),'click',resetLayout);
  on($('btnNewWallet'),'click',()=>openWalletDefModal(null));
  on($('btnSaveDistribution'),'click',saveDistribution);
  on($('btnResetDistribution'),'click',resetDistribution);
  on($('btnExportJson'),'click',exportData);
  on($('btnImportFileTrigger'),'click',()=>$('importFile').click());
  on($('importFile'),'change',importFromFile);
  on($('btnImportText'),'click',importFromTextarea);
  on($('btnSaveDriveClientId'),'click',saveDriveClientId);
  on($('driveSignInBtn'),'click',driveSignIn);
  on($('btnDriveSyncNow'),'click',driveManualSync);
  on($('btnDriveSignOut'),'click',driveSignOut);
  on($('btnDriveAutoAlways'),'click',enableDriveAutoSignIn);
  on($('btnDriveAutoNotNow'),'click',dismissDriveAutoSignInPrompt);
  on($('driveAutoSignInChk'),'change',e=>setDriveAutoSignIn(e.target.checked));
  on($('btnChangeDriveClientId'),'click',changeDriveClientId);
  on($('btnRepairBalances'),'click',repairBalancesFromLedger);
  on($('btnZeroTracked'),'click',zeroTrackedWallets);
  on($('btnZeroRegular'),'click',zeroRegularWallets);
  on($('btnClearSubs'),'click',clearAllSubscriptions);
  on($('btnClearBalTx'),'click',clearBalancesAndTx);
  on($('btnWipeAll'),'click',wipeAll);
  on($('btnCloseSettings'),'click',()=>closeModal('settingsModal'));

  // Transfer modal
  sel($('transferFromBtn'),()=>toggleTransferMenu('from'));
  sel($('transferToBtn'),()=>toggleTransferMenu('to'));
  on($('btnTransferCancel'),'click',()=>closeModal('transferModal'));
  on($('doTransferBtn'),'click',doTransfer);

  // Quick notes modal
  on($('qnNotes'),'input',onQuickNotesInput);
  on($('btnQnClose'),'click',()=>closeModal('quickNotesModal'));
  on($('qnParseBtn'),'click',parseQuickNotesPreview);
  on($('btnQnCancelPreview'),'click',cancelQuickNotesPreview);
  on($('qnConfirmBtn'),'click',commitQuickNotes);

  // Wallet detail modal
  on($('btnSaveWalletBudget'),'click',saveWalletBudget);
  on($('updateTrackedBalanceBtn'),'click',updateTrackedBalance);
  on($('trackModeDebit'),'click',()=>setTrackLinkMode(detailWalletId,'debit'));
  on($('trackModeCredit'),'click',()=>setTrackLinkMode(detailWalletId,'credit'));
  on($('btnCloseWalletDetail'),'click',()=>closeModal('walletDetailModal'));

  // Distribution modal
  on($('btnSkipDistribution'),'click',skipDistribution);
  on($('confirmDistributionBtn'),'click',confirmDistribution);

  // Welcome / onboarding modal
  on($('btnOnbSkip'),'click',closeWelcome);
  on($('onbBack'),'click',()=>welcomeNav(-1));
  on($('onbNext'),'click',()=>welcomeNav(1));
  on($('btnOnbStartIncome'),'click',()=>welcomeStart(true));
  on($('btnOnbStartBrowse'),'click',()=>welcomeStart(false));

  // Daily review modal
  on($('btnCloseDailyReview'),'click',()=>closeModal('dailyReviewModal'));

  // Drive conflict modal
  on($('btnConflictDrive'),'click',()=>resolveConflict(true));
  on($('btnConflictLocal'),'click',()=>resolveConflict(false));

  // Subscriptions modal
  on($('btnCloseSubModal'),'click',()=>closeModal('subModal'));
  on($('btnSaveSubModal'),'click',saveSubModal);
  on($('subDeleteBtn'),'click',deleteSubModal);

  // Wallet definition modal
  on($('walletDefTypeRegular'),'click',()=>setWalletDefType(false));
  on($('walletDefTypeTrack'),'click',()=>setWalletDefType(true));
  on($('btnCancelWalletDef'),'click',()=>closeModal('walletDefModal'));
  on($('btnSaveWalletDef'),'click',saveWalletDefModal);
  on($('walletDefDeleteBtn'),'click',deleteWalletDefModal);

  // Changelog modal
  on($('btnCloseChangelog'),'click',()=>closeModal('changelogModal'));
}
_bindEvents();

loadState().then(()=>{
  _stateLoaded = true; // money writers are gated on this (see _stateNotReady)
  hideSplash();
  loadQuickNotesDraft();    // restore any unconverted quick-notes draft
  updateQuickNotesBadge();  // reflect its line count on the home banner
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

// visibilitychange alone is not enough: same-tab navigations and reloads
// (update banner, forceClearAndUpdate, user F5) fire pagehide WITHOUT a
// hidden-state transition in some browsers, and a few mobile browsers kill
// the tab firing only pagehide. This is the flush the scheduleIdbBackup
// comment promises — without it a transaction saved <400ms before a reload
// dies with the debounce timer.
window.addEventListener('pagehide', () => {
  if(driveSyncTimer){ clearTimeout(driveSyncTimer); driveSyncTimer = null; if(driveAccessToken){ try{ driveSyncToCloud(); }catch(_){} } }
  flushIdbBackup();
});

// Without this, going offline left the header showing whatever it last said
// (often "متزامن ✓") indefinitely — nothing re-evaluates the indicator until
// the next save's debounced sync attempt fails. A user could believe a second
// device already has their offline edits when nothing has actually synced.
window.addEventListener('offline', () => {
  if(driveAccessToken) setDriveIndicator('offline');
  toast(t({ar:'⚠ انقطع الاتصال — سيُستأنف المزامنة تلقائياً عند عودة الاتصال', en:'⚠ You\'re offline — sync will resume automatically when reconnected'}), true);
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
    // a tab kept visible across midnight otherwise misses that day's review
    // (incl. the "subscriptions due today" line) and the drift check — both
    // self-guard via lastReviewDate/driftNotified, so re-running is safe here
    checkDailyReview();
    checkBalanceDrift();
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
  // Quick-notes draft is free-form scratch text (not ledger data) and is written
  // on every keystroke — reloading the whole ledger for it would thrash other
  // tabs. Just refresh the in-memory draft + the home banner badge.
  if(e.key === LS_PREFIX + 'quickNotes'){
    loadQuickNotesDraft();
    updateQuickNotesBadge();
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
        // NOTE: the in-flight flags above are per-tab — this tab can't see that the
        // OTHER tab still has a 400ms scheduleIdbBackup() debounce pending (its
        // localStorage 'lastEdit' write already fired this event synchronously).
        // The 600ms initial delay below covers that 400ms window + margin so we
        // don't read a stale IDB snapshot that predates the other tab's flush.
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
      _storageSyncTimer = setTimeout(_trySync, 600);
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
  toast(t({ar:'⚠ حدث خطأ غير متوقع', en:'⚠ An unexpected error occurred'}), true);
});

// Prevent accidental scroll-wheel from changing number input values on desktop
// Delegated to document so it covers any dynamically added number inputs too
document.addEventListener('wheel', e => {
  if(e.target && e.target.tagName === 'INPUT' && e.target.type === 'number' && document.activeElement === e.target){
    e.preventDefault();
  }
}, {passive:false});

// bfcache restore: when the browser revives a frozen page from the Back/Forward cache,
// JS variables are from the frozen snapshot but the history stack may reflect
// navigation that happened since — _overlayHistDepth can be out of sync and cause
// Back to expel the user from the app instead of closing an overlay. Re-derive it
// from the restored history state so the two stay consistent.
window.addEventListener('pageshow', e => {
  if(e.persisted){
    _overlayHistDepth = (history.state && history.state._mahfaztyOverlay) ? (history.state.depth || 1) : 0;
  }
});
