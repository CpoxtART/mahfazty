/* ============================================================
   APP LOGIC — transaction CRUD (addTx, openEdit/saveEdit, deleteTx/undoDelete)
   Split out of the original app.logic.js (which also used to own boot/
   lifecycle/event-binding/toast — that half is now app.main.js). Loaded near
   the end, after every renderer it calls (app.ui.js) and every overlay helper
   (app.overlay.js) already exist. app.main.js loads last and wires this
   file's functions to DOM events.
============================================================ */
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
    // stripBidiControls: a pasted description could carry raw bidi-override
    // chars — wallet/subscription names already sanitize these at save (see
    // saveWalletDefModal), but this field only ever got them stripped at
    // RENDER time (escHtml calls stripBidiControls internally) — the raw
    // control chars stayed in the stored/exported data indefinitely.
    const desc = truncateCodePoints(stripBidiControls(document.getElementById('descInput').value.trim()), MAX_DESC_LEN); // cap length (voice/paste bypass maxlength)
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

    // saveTx first — it is the authoritative record for reconcileBalances(); if the
    // process dies before saveBalances, the IDB snapshot (which reads state.wallets
    // directly) already carries the post-applyTxToBalance balance, so reconcileBalances
    // self-heals on next load. saveBalances-first risks a phantom balance revert for
    // regular wallets, and a permanent phantom for track wallets (reconcileBalances
    // intentionally skips them so the stale localStorage value would persist forever).
    await saveTx();
    await saveBalances();
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
    // When auto-distribution is about to follow immediately below, its own
    // toast fires only a tick later — close enough to clobber this toast's
    // #saveStatus aria-live text before a screen reader finishes reading it.
    // Skip this one here (not dropped) and fold it into that single combined
    // toast instead, so exactly one announcement covers both outcomes.
    const _willAutoDistribute = _distributable && autoDistribute;
    if(!_willAutoDistribute){
      toast(type==='expense' ? t({ar:'✓ تم تسجيل المصروف', en:'✓ Expense recorded'}) : t({ar:'✓ تم تسجيل الدخل', en:'✓ Income recorded'}));
    }

    // auto-distribution flow for income (budget-wallet income only)
    if(_distributable && autoDistribute){
      const _distributed = await runDistribution(tx, amountVal);
      // single render after distribution completes — skips an intermediate render
      // that would paint the income-only state before the distribution legs exist
      render();
      toast(_distributed
        ? t({ar:'✓ تم تسجيل الدخل وتوزيعه تلقائيًا', en:'✓ Income recorded and auto-distributed'})
        : t({ar:'✓ تم تسجيل الدخل', en:'✓ Income recorded'}));
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
    // Auto-distribution never checks crisis mode — it routes into whatever
    // DISTRIBUTION says regardless. The grand total stays correct (the
    // Merged Reserve card sums crisis-hidden balances back in), but a
    // crisis-hidden wallet's OWN card/total is invisible while crisis mode is
    // on, so silently landing money there with no indication reads as the
    // income having vanished. Surface it here rather than changing the
    // actual routing (which risks its own new edge cases around
    // renormalizing percentages).
    if(state.crisisMode){
      const hiddenIds = new Set(crisisWalletIds());
      if(activeEntries.some(d => hiddenIds.has(d.id))){
        const note = document.createElement('div');
        note.className = 'hint';
        note.style.cssText = 'margin-top:8px; font-size:var(--fs-sm);';
        note.textContent = `ℹ ${t({ar:'وضع الأزمة مفعّل — بعض هذه المحافظ مخفية حاليًا من القائمة والإجماليات الفردية، لكن المبلغ سيُودَع بها فعليًا', en:"Crisis Mode is on — some of these wallets are currently hidden from the list and individual totals, but the amount will still be deposited into them"})}`;
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
  // Every other multi-await money mutator refuses to start while another is
  // mid-flight (see _opBusy) — this one was missing that guard entirely. Not
  // a demonstrated data-loss path today (the distribution modal stays open
  // for this function's whole duration, and the one other wholesale-replace
  // path already waits for it to close), but a defense-in-depth gap that a
  // future change to either of those conditions could silently reopen.
  if(_opBusy()) return;
  saveAutoDistributePref();
  if(!pendingIncomeTx) { closeModal('distributeModal'); return; }
  // Must exclude the source wallet itself, matching openDistributionModal's
  // activeEntries (line ~129) and runDistribution's own active filter (line
  // ~238) — without the exclusion, a config where the ONLY active percentage
  // is on the source wallet itself (e.g. 100% to Core, income landed in Core)
  // passed this check while the modal's own preview correctly warned "no
  // ratios set", and runDistribution then legitimately no-op'd (nothing valid
  // to route the income to) — yet the code below still showed "✓ distributed"
  // regardless, a false success message with no functional harm but wrong feedback.
  const hasActive = DISTRIBUTION.some(d => d && d.pct > 0 && d.id !== pendingIncomeTx.wallet && WALLET_DEFS.find(x=>x.id===d.id && !x.track));
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
    // Second, independent guard (defense in depth alongside hasActive above):
    // trust runDistribution's own report of whether it actually moved money,
    // rather than assuming success — so this toast can never claim a
    // distribution happened when runDistribution itself no-op'd for any
    // reason (now or in a future change to its active-wallet filtering).
    const distributed = await runDistribution(live, live.amount);
    closeModal('distributeModal');
    render();
    if(distributed){
      // addTx's auto-distribute branch and commitQuickNotes both already
      // haptic(15) at their own top level for this same logical outcome
      // ("income distributed") — this manual-confirm entry point was the
      // one path reaching it with no haptic at all.
      haptic(15);
      toast(t({ar:'✓ تم توزيع الدخل على المحافظ', en:'✓ Income distributed across wallets'}));
    } else {
      toast(t({ar:'⚠ لم يتم توزيع أي مبلغ — تحقق من نسب التوزيع بالإعدادات', en:'⚠ Nothing was distributed — check your distribution ratios in Settings'}), true);
    }
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
// Settings-panel twin of the checkbox above — distributeModal only opens
// before autoDistribute is ever true (see addTx), so once a user checks it
// there, that checkbox becomes permanently unreachable and this Settings
// toggle is the only remaining way to turn the preference back off.
function setAutoDistributeFromSettings(checked){
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
  if(intendedTotal <= 0){ await saveTx(); await saveBalances(); return false; } // saveTx first — see addTx comment

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

  await saveTx(); // saveTx first — see addTx comment
  await saveBalances();
  return true;
}

// round2 moved to app.core.js's FORMAT HELPERS section (v47.77) — it's the
// money-math primitive everything depends on, so it belongs with
// fmt/parseAmount/normalizeDigits, not in the transaction-CRUD file.

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
  // normalizeCategory (not the raw id): an unknown/removed category id from an
  // old backup or corrupted import would otherwise seed the edit form with an
  // id no chip matches — nothing renders selected, and saving writes the
  // invalid id straight back (setEditType's !cat reset now also guards this,
  // but normalizing at the seed keeps the form truthful from the first paint).
  // 'transfer' is a system category deliberately absent from CATEGORIES —
  // transfer legs keep it as-is (their category controls are hidden below).
  editCategory = (tx.category === 'transfer') ? 'transfer' : normalizeCategory(tx.category);
  // A transfer leg's type/category must stay fixed — flipping its type or
  // category would unbalance the two-leg transfer (money created/destroyed),
  // and only amount/wallet/desc are synced to the partner. Hide those controls.
  const _isTransferCat = !!(tx.link && tx.category === 'transfer');
  // The income tx that triggered an auto-distribution keeps its own category
  // (not 'transfer') but is linked to the withdrawal + N deposit legs that
  // already moved the OLD amount into other wallets. Editing its amount here
  // has no sync path (unlike the simple 2-leg transfer case above, which only
  // syncs when there's exactly one partner) — those legs would silently stay
  // at the stale amount, desyncing the source tx from the money actually
  // distributed. Lock the amount field for this case; desc/date/category/type
  // remain editable since they don't affect balances.
  // A distribution's own withdrawal/deposit LEGS (tx._distributionLeg) are
  // ALSO amount-locked here, for a different reason than the source tx above:
  // they're marked category==='transfer' just like a simple 2-leg transfer,
  // so saveEdit()'s "sync the one partner" logic below only fires correctly
  // when the distribution has EXACTLY one deposit target (and even then it
  // desyncs from the untouched source income amount); with 2+ targets the
  // sync is skipped entirely and editing one leg's amount silently created or
  // destroyed money with zero error. Locking here (matching deleteTx's own
  // "can't delete a lone distribution leg" protection) closes both cases.
  const _isDistSrc = !!tx._distributionLeg || !!(tx.link && tx.category !== 'transfer' &&
    state.transactions.filter(t => t.link === tx.link && t.id !== tx.id).length >= 1);
  // updateTrackedBalance() is the only legitimate way to move a track wallet's
  // balance directly, via a category:'adjustment' entry deliberately excluded
  // from every isSystemCategory-gated analytics/budget total. Recategorizing
  // it away from 'adjustment' here while the wallet stays a track wallet
  // (SELECTABLE_WALLETS/addTx's own design never lets a NEW transaction target
  // a track wallet as its primary — see recomputeSelectableWallets' comment)
  // silently turned it into a "real" transaction on a track wallet, which then
  // (a) polluted analytics directly and (b) could be suggested by
  // detectRecurring and re-logged via "Record it now"/repeatLastTx, creating
  // FURTHER track-wallet-primary transactions with no self-heal path, since
  // reconcileBalances/repairBalancesFromLedger both skip track wallets.
  // The 3 original independent flags collapse to exactly 5 real states — a
  // distribution leg (tx._distributionLeg, category:'transfer', has a link)
  // is the one case where the transfer and dist-source conditions are BOTH
  // true simultaneously, so it needs its own 'distLeg' state to avoid losing
  // information when merging into a single reason.
  _editLockReason = (_isTransferCat && _isDistSrc) ? 'distLeg'
    : _isTransferCat ? 'transfer'
    : _isDistSrc ? 'distSource'
    : (tx.category === 'adjustment' && isTrackWallet(tx.wallet)) ? 'trackAdjustment'
    : null;
  document.getElementById('editTypeToggle').style.display = _editCategoryLocked() ? 'none' : '';
  document.getElementById('editCategorySection').style.display = _editCategoryLocked() ? 'none' : '';
  // The generic "both sides update together" transfer hint is actively WRONG
  // for a distribution leg (2+ legs don't pairwise-sync) or a track-wallet
  // adjustment (no "other side" at all) — show the distribution-specific
  // amount-locked hint instead whenever it applies, and hide the transfer hint
  // entirely for a track adjustment (it isn't a transfer).
  document.getElementById('editTransferHint').style.display = (_editLockReason === 'transfer') ? 'block' : 'none';
  document.getElementById('editDistSourceHint').style.display = _editAmountLocked() ? 'block' : 'none';
  const _eAmt = document.getElementById('editAmount');
  _eAmt.disabled = _editAmountLocked();
  _eAmt.style.opacity = _editAmountLocked() ? '.55' : '';
  setEditType(tx.type);
  renderEditWalletSelect();
  renderEditCategoryGrid();
  if(typeof closeWalletPop === 'function') closeWalletPop(); // reset any stale wallet-picker state before showing this edit
  const _ewb = document.getElementById('editWalletBtn');
  _ewb.classList.remove('open');
  _ewb.setAttribute('aria-expanded','false');
  // Lock the wallet on a transfer leg (changing it would desync the partner
  // leg's balance) or a track-wallet adjustment (moving it off the track
  // wallet while the category stays locked to 'adjustment' would leave a
  // confusing "adjustment" entry sitting on a normal wallet for no reason).
  _ewb.style.pointerEvents = _editCategoryLocked() ? 'none' : '';
  _ewb.style.opacity = _editCategoryLocked() ? '.55' : '';
  // Also lock via tabIndex/aria so keyboard navigation can't bypass the CSS-only lock
  _ewb.tabIndex = _editCategoryLocked() ? -1 : 0;
  _ewb.setAttribute('aria-disabled', String(_editCategoryLocked()));
  document.getElementById('editDesc').value = tx.desc || '';
  document.getElementById('editAmount').value = groupThousandsDisplay((Number(tx.amount) || 0).toFixed(2)); // match the 2-decimal display used everywhere else
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
  if(_editAmountLocked() && newAmount !== round2(tx.amount)){
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
  // Transfer leg / track-wallet adjustment wallet cannot change — keyboard
  // navigation can bypass the CSS pointerEvents:none lock set in openEdit(),
  // so enforce it here too.
  if(_editCategoryLocked()) editWallet = tx.wallet;

  // Snapshot BEFORE any mutation, for the undo toast below — unlike delete,
  // saving an edit had no recovery path at all: a fat-fingered amount or a
  // wrong wallet pick overwrote the original permanently the instant "Save"
  // was tapped. Shallow-clone is enough: applyTxToBalance always re-reads
  // tx.wallet/amount/type/trackWallet/trackSign fresh, so reversing the
  // CURRENT (post-edit) effect, restoring these fields via Object.assign, then
  // re-applying with the restored values correctly undoes the edit's balance
  // impact even when the wallet itself changed.
  const _prevTxSnapshot = {...tx};
  let _partnerForUndo = null;
  if(tx.link && tx.category === 'transfer'){
    const _partners = state.transactions.filter(t => t.link === tx.link && t.id !== tx.id && t.category === 'transfer');
    if(_partners.length === 1) _partnerForUndo = _partners[0];
  }
  const _prevPartnerSnapshot = _partnerForUndo ? {..._partnerForUndo} : null;

  // reverse old effect
  applyTxToBalance(tx, -1);

  // for a simple 2-leg transfer (link shared by exactly one other transfer leg),
  // keep both amounts in sync so balances stay consistent after editing one side.
  // Reuses _partnerForUndo (identical filter, nothing mutated state.transactions
  // in between) instead of re-scanning the full ledger a second time.
  let _transferPartner = null;
  if(_partnerForUndo){
    const partner = _partnerForUndo;
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

  tx.desc = truncateCodePoints(stripBidiControls(document.getElementById('editDesc').value.trim()), MAX_DESC_LEN); // cap length (voice/paste bypass maxlength)
  tx.amount = newAmount;
  tx.wallet = editWallet;
  tx.editedAt = Date.now(); // lets mergeCloudData() resolve same-id conflicts by picking the newer edit instead of always favoring local
  // transfer legs keep their original type/category (locked in the UI) so the
  // two-leg balance stays consistent; a track-wallet adjustment keeps its
  // 'adjustment' category so it stays excluded from analytics/budgets forever
  // (see openEdit's comment) — only a normal tx adopts the new values.
  if(!_editCategoryLocked()){
    tx.type = editType;
    // Defense in depth: the category grid already excludes 'transfer' for a
    // distributed-income source (see renderEditCategoryGrid) since that value
    // would misclassify this linked tx as a transfer leg from then on — guard
    // here too in case of stale state.
    tx.category = (_editAmountLocked() && editCategory === 'transfer') ? tx.category : editCategory;
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

  await saveTx(); // saveTx first — see addTx comment
  await saveBalances();
  closeModal('editModal');
  render(true); // force: desc/date-only edits don't change the render signature
  haptic(15);
  toastWithAction(t({ar:'✓ تم التحديث', en:'✓ Updated'}), t({ar:'تراجع ↩️', en:'Undo ↩️'}), () => undoEdit(tx.id, _prevTxSnapshot, _prevPartnerSnapshot), false, t({ar:'تراجع عن التعديل', en:'Undo edit'}));
  } finally {
    _saveEditBusy = false;
    _opInFlight--;
    _setBtnSaving(_saveBtn, false);
  }
}

// Reverts a saveEdit() by restoring the pre-edit snapshot(s) taken there —
// same reverse-current/restore-fields/reapply-restored ordering saveEdit
// itself relies on, so it correctly reverses the balance impact even when
// the edit moved the transaction to a different wallet.
async function undoEdit(txId, prevTx, prevPartner){
  // cross-op write guard (see commitQuickNotes) — every other mutator that
  // writes balances/tx across awaits has this at entry; the undo toast's
  // button can be tapped seconds after the edit, well into the window where
  // another op (addTx's auto-distribution, a Drive sync) could be mid-flight.
  if(_opBusy()) return;
  const tx = state.transactions.find(t => t.id === txId);
  if(!tx){ toast(t({ar:'⚠ تعذّر التراجع — المعاملة لم تعد موجودة', en:'⚠ Could not undo — the transaction no longer exists'}), true); return; }
  _opInFlight++;
  _txMutationStamp++;
  try{
    applyTxToBalance(tx, -1);
    let partner = null;
    if(prevPartner){
      partner = state.transactions.find(t => t.id === prevPartner.id);
      if(partner) applyTxToBalance(partner, -1);
    }
    Object.assign(tx, prevTx);
    if(partner) Object.assign(partner, prevPartner);
    applyTxToBalance(tx, +1);
    if(partner) applyTxToBalance(partner, +1);
    await saveTx(); // saveTx first — see addTx comment
    await saveBalances();
    render(true);
    toast(t({ar:'↩️ تم التراجع عن التعديل', en:'↩️ Edit undone'}));
  } finally {
    _opInFlight--;
  }
}

async function deleteFromEdit(){
  // editingTxId can only be stale here if the transaction being edited was
  // removed from underneath the open modal (e.g. a cross-tab sync/merge while
  // the user had it open) — rare, but silently no-op'ing left the user unsure
  // whether their tap on Delete even registered, with the modal still open.
  // Must check the tx's actual EXISTENCE, not just editingTxId's nullity —
  // editingTxId stays non-null for the entire time the modal is open, so a
  // bare-nullity check could never catch the very race it claims to guard.
  if(!editingTxId || !state.transactions.find(tx => tx.id === editingTxId)){
    closeModal('editModal');
    toast(t({ar:'⚠ المعاملة لم تعد موجودة', en:'⚠ The transaction no longer exists'}), true);
    return;
  }
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
    if(!isSystemCategory(t)){ last = t; break; }
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
  // Always assign explicitly (ternary, not a guarded if): when last.category is
  // an unknown/removed id, the old skip-assignment left selectedCategory at
  // whatever the form held from its PREVIOUS use — a silently wrong pre-fill
  // the user had no reason to double-check. lastCat.id (not last.category) so
  // the (last.category||'other') lookup fallback resolves to a real id too.
  const lastCat = CATEGORIES.find(c=>c.id===(last.category||'other'));
  selectedCategory = (lastCat && lastCat.types.includes(last.type)) ? lastCat.id : 'other';
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

    await saveTx(); // saveTx first — see addTx comment
    await saveConfig(); // persist the new tombstones (they live in config)
    await saveBalances();
    render();

    // Accumulate rather than overwrite: deleting a SECOND (unrelated) transaction
    // while the first one's 5s undo window is still open used to silently drop
    // the first deletion's undo capability entirely (the new toast/timer just
    // replaced it) — the deletions themselves stayed correct, but there was no
    // way back for the first one, with no indication that recovery window had
    // quietly closed early. Undo now restores every deletion still pending from
    // this streak, in one tap, and the countdown restarts with each new delete.
    _lastDeleted = _lastDeleted ? _lastDeleted.concat(removed) : removed;
    const totalPending = _lastDeleted.length;
    clearTimeout(_undoTimer);
    // If a critical toast (e.g. "couldn't save locally") is currently
    // blocking, toastWithUndo() below QUEUES instead of showing the undo
    // button immediately (see toastWithAction's critical-window check,
    // app.main.js) — it only actually appears once the critical toast's own
    // window ends. Without this, _undoTimer (ticking from THIS moment
    // regardless of when/whether the button is visible yet) could expire
    // before or shortly after the button ever appears, so a user could see a
    // fully-rendered, apparently-fresh "Undo" button that silently no-ops
    // the instant it's tapped. Extend the window to start counting from
    // whenever the critical toast actually clears, not from now.
    const _undoMs = Math.max(UNDO_WINDOW_MS, (typeof _criticalToastUntil !== 'undefined' ? _criticalToastUntil - Date.now() + UNDO_WINDOW_MS : UNDO_WINDOW_MS));
    _undoTimer = setTimeout(()=>{ _lastDeleted = null; }, _undoMs);
    haptic([12, 40, 12]); // double-tap pulse signals a destructive commit
    toastWithUndo(totalPending > 1 ? t({ar:`🗑 تم حذف ${totalPending} حركات مرتبطة`, en:`🗑 Deleted ${totalPending} linked entries`}) : t({ar:'🗑 تم الحذف', en:'🗑 Deleted'}), undoDelete);
  } finally {
    _opInFlight--;
  }
}

async function undoDelete(){
  // cross-op write guard (see commitQuickNotes) — every other mutator that
  // writes balances/tx across awaits has this at entry; the undo toast's
  // button can be tapped seconds after the delete, well into the window where
  // another op (addTx's auto-distribution, a Drive sync) could be mid-flight.
  // Checked BEFORE consuming _lastDeleted so a busy-blocked tap leaves it
  // intact — the user can just tap Undo again once the other op finishes.
  if(_opBusy()) return;
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
    // saveConfig before saveTx: if we crash after saveConfig but before saveTx, the
    // tx is absent from IDB but the tombstone is gone → empty undo on reload (recoverable).
    // If saveTx fired first and we crashed before saveConfig, the tx would be in IDB
    // but still tombstoned → silently filtered out on reload (data loss).
    // saveTx before saveBalances: see addTx comment for the torn-write reasoning.
    await saveConfig();
    await saveTx();
    await saveBalances();
    render();
    toast(removed.length > 1 ? t({ar:'↩️ تم استرجاع الحركات', en:'↩️ Entries restored'}) : t({ar:'↩️ تم استرجاع المعاملة', en:'↩️ Transaction restored'}));
  } finally {
    _opInFlight--;
  }
}
