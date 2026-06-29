/* ============================================================
   ADD / EDIT / DELETE TRANSACTIONS
============================================================ */
let _addTxBusy = false;
async function addTx(type){
  if(_addTxBusy) return;
  // cross-op write guard (see commitQuickNotes): don't start a write while another
  // mutation is mid-flight across an await — prevents interleaved balance writes
  if(_opInFlight > 0){ toast(t({ar:'⏳ هناك عملية قيد التنفيذ — أعد المحاولة بعد لحظة', en:'⏳ Another operation is in progress — try again in a moment'}), true); return; }
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
    // Signal closeAddDrawer() to skip history.back() when it's followed immediately
    // by openModal(distributeModal) — the flag is checked inside closeAddDrawer()
    // so the drawer's history entry gets replaced atomically instead of back()+push().
    if(type === 'income' && tx.category !== 'transfer' && !autoDistribute && addDrawerOpen){
      _nextPushOverlayReplaces = true;
    }
    closeAddDrawer();
    haptic(15); // brief confirm pulse on a successful entry
    toast(type==='expense' ? t({ar:'✓ تم تسجيل المصروف', en:'✓ Expense recorded'}) : t({ar:'✓ تم تسجيل الدخل', en:'✓ Income recorded'}));

    // auto-distribution flow for income
    if(type === 'income' && tx.category !== 'transfer' && autoDistribute){
      const _distributed = await runDistribution(tx, amountVal);
      // single render after distribution completes — skips an intermediate render
      // that would paint the income-only state before the distribution legs exist
      render();
      if(_distributed) toast(t({ar:'🔄 تم توزيع الدخل تلقائيًا', en:'🔄 Income auto-distributed'}));
    } else {
      render(); // expenses and manual-distribution incomes render once right here
      if(type === 'income' && tx.category !== 'transfer'){
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
    warn.style.cssText = 'color:var(--red); margin:0; font-size:13px;';
    warn.textContent = `⚠ ${t({ar:'لا توجد نسب توزيع — اضبطها في الإعدادات أولاً', en:'No distribution ratios set — set them up in Settings first'})}`;
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

/* ============================================================
   QUICK NOTES → TRANSACTIONS
   A free-form jot box for when there's no time/space to fill the full
   add form per transaction. The user types one transaction per line
   ("description price", with "+" or an income keyword marking income),
   the app parses each line into a reviewable/editable row, and commits
   them all at once. The raw notes draft is persisted so it can be built
   up across the day and only converted when convenient.
============================================================ */
let _qnWallet = null;        // chosen target wallet id for the parsed rows
let _qnPreview = [];         // current parsed/preview rows
let _quickNotesDraft = '';   // persisted free-form notes text
let _qnCommitBusy = false;

// keyword → category guesses (matched against normalizeSearch so Arabic
// orthographic variants and casing fold together). Bilingual on purpose.
const _QN_CAT_KEYWORDS = [
  {cat:'food',          words:['قهوه','قهوة','كوفي','كافيه','شاي','فطور','غداء','عشاء','اكل','طعام','مطعم','برجر','بيتزا','وجبه','عصير','حلى','coffee','cafe','food','lunch','dinner','breakfast','restaurant','meal','snack','juice']},
  {cat:'transport',     words:['بنزين','وقود','تكسي','اوبر','كريم','مواصلات','سياره','سيارة','باص','قطار','رحله','رحلة','تذكره','تذكرة','gas','fuel','taxi','uber','careem','transport','bus','train','ride','ticket']},
  {cat:'shopping',      words:['تسوق','ملابس','سوق','متجر','حذاء','قميص','هديه','هدية','عبايه','shopping','clothes','store','mall','shoes','gift']},
  {cat:'bills',         words:['فاتوره','فاتورة','فواتير','كهرباء','ماء','مويه','نت','انترنت','جوال','اتصالات','ايجار','إيجار','bill','bills','electricity','water','internet','phone','mobile','rent']},
  {cat:'health',        words:['دواء','صيدليه','صيدلية','دكتور','طبيب','مستشفى','عياده','عيادة','صحه','صحة','تحليل','pharmacy','doctor','hospital','clinic','health','medicine']},
  {cat:'entertainment', words:['لعبه','لعبة','العاب','سينما','فيلم','ترفيه','اشتراك','نتفلكس','نتفليكس','game','games','cinema','movie','netflix','spotify','subscription','entertainment']},
  {cat:'salary',        words:['راتب','مرتب','دخل','مدخول','مكافاه','مكافأة','salary','income','wage','payroll','bonus']},
];
// independent income detection (a line is income if it ends with/contains "+"
// or names an income-type concept) — keep in sync with the salary keywords above
const _QN_INCOME_WORDS = ['راتب','مرتب','دخل','مدخول','ايداع','إيداع','استرجاع','مكافاه','مكافأة','salary','income','deposit','refund','bonus','payroll'];

function _qnNorm(s){ return (typeof normalizeSearch === 'function') ? normalizeSearch(s) : String(s||'').toLowerCase().trim(); }
function _qnGuessCategory(desc, type){
  const d = _qnNorm(desc);
  if(d){
    for(const grp of _QN_CAT_KEYWORDS){
      if(grp.cat === 'salary' && type !== 'income') continue; // salary words only apply to income rows
      if(grp.words.some(w => d.includes(_qnNorm(w)))) return grp.cat;
    }
  }
  return type === 'income' ? 'salary' : 'other';
}

// Matches a number token in either ASCII, Arabic-Indic (٠-٩) or Persian (۰-۹)
// digits, with an optional decimal part. Used on the ORIGINAL line (not the
// space-stripped normalizeDigits output) so the description keeps its spaces.
const _QN_NUM_RE = /[\d٠-٩۰-۹]+(?:[.,٫][\d٠-٩۰-۹]+)?/g;
// Cap the batch so a pasted wall of text can't build thousands of preview rows
// (each row is several DOM nodes + handlers) and freeze the main thread. 300 is
// far beyond any realistic "jot a few transactions" session.
const QN_MAX_LINES = 300;
let _qnTruncated = false; // set when the last parse hit the cap (surfaced as a toast)
// Parse free-form text into transaction candidates — one per non-empty line.
function parseQuickNotes(text){
  const rows = [];
  _qnTruncated = false;
  const lines = String(text == null ? '' : text).split('\n');
  for(const rawLine of lines){
    if(rows.length >= QN_MAX_LINES){ _qnTruncated = true; break; }
    const line = rawLine.trim();
    if(!line) continue;
    const normSearch = _qnNorm(line);
    const isIncome = /\+/.test(line) || _QN_INCOME_WORDS.some(w => normSearch.includes(_qnNorm(w)));
    const type = isIncome ? 'income' : 'expense';
    const nums = line.match(_QN_NUM_RE);
    if(!nums || !nums.length){
      // no price on the line — keep it as an invalid row so the user notices it
      // wasn't captured, instead of silently dropping it
      rows.push({raw:line, desc:line.replace(/\+/g,' ').replace(/\s+/g,' ').trim(), amount:NaN, type, category:_qnGuessCategory(line, type), valid:false});
      continue;
    }
    const amtRaw = nums[nums.length-1];           // amount = last number (description comes first)
    const amount = round2(parseAmount(amtRaw));   // parseAmount folds Arabic/Persian digits itself
    // description = the ORIGINAL line minus the LAST number token and any + markers
    let desc = line;
    const idx = desc.lastIndexOf(amtRaw);
    if(idx >= 0) desc = desc.slice(0, idx) + desc.slice(idx + amtRaw.length);
    desc = desc.replace(/\+/g,' ').replace(/\s+/g,' ').trim();
    desc = desc.replace(/(ريال|ر\.?\s?س|درهم|دينار|جنيه|sar|usd|riyal|\$)\s*$/i,'').trim(); // drop a trailing currency word
    const valid = isFinite(amount) && amount > 0;
    rows.push({raw:line, desc, amount: valid ? amount : NaN, type, category:_qnGuessCategory(desc, type), valid});
  }
  return rows;
}

function loadQuickNotesDraft(){
  try{ _quickNotesDraft = localStorage.getItem(LS_PREFIX + 'quickNotes') || ''; }catch(e){ _quickNotesDraft = ''; }
}
function saveQuickNotesDraft(){
  try{ localStorage.setItem(LS_PREFIX + 'quickNotes', _quickNotesDraft); }catch(e){}
}
function updateQuickNotesBadge(){
  const badge = document.getElementById('qnBannerBadge');
  const banner = document.getElementById('quickNotesBanner');
  const lines = _quickNotesDraft.split('\n').map(l=>l.trim()).filter(Boolean).length;
  if(badge){
    badge.textContent = lines ? (t({ar:'مسودة', en:'Draft'}) + ' · ' + lines) : t({ar:'افتح', en:'Open'});
    badge.classList.toggle('has-draft', lines > 0);
  }
  if(banner) banner.classList.toggle('has-draft', lines > 0);
}

function renderQnWalletChips(){
  const wrap = document.getElementById('qnWalletChips');
  if(!wrap) return;
  // single-choice group — expose it as a radiogroup so screen readers announce
  // "selected" semantics instead of independent toggle buttons.
  wrap.setAttribute('role','radiogroup');
  wrap.setAttribute('aria-label', t({ar:'المحفظة الافتراضية', en:'Default wallet'}));
  wrap.innerHTML = '';
  SELECTABLE_WALLETS.forEach(w => {
    const sel = (w.id === _qnWallet);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'qn-chip' + (sel ? ' active' : '');
    chip.textContent = w.name;
    chip.title = w.name; // long names truncate via CSS ellipsis; expose full name on hover
    chip.setAttribute('role','radio');
    chip.setAttribute('aria-checked', String(sel));
    chip.onclick = () => { _qnWallet = w.id; renderQnWalletChips(); };
    wrap.appendChild(chip);
  });
}

function openQuickNotes(){
  recomputeSelectableWallets(); // keep the chip list in sync with crisis mode / custom wallets
  const ta = document.getElementById('qnNotes');
  if(ta) ta.value = _quickNotesDraft;
  if(!_qnWallet || !SELECTABLE_WALLETS.find(w => w.id === _qnWallet)){
    _qnWallet = (SELECTABLE_WALLETS[0] && SELECTABLE_WALLETS[0].id) || (WALLET_DEFS[0] && WALLET_DEFS[0].id) || null;
  }
  _qnPreview = [];
  const pw = document.getElementById('qnPreviewWrap'); if(pw) pw.style.display = 'none';
  renderQnWalletChips();
  openModal('quickNotesModal');
}

function onQuickNotesInput(){
  const ta = document.getElementById('qnNotes');
  _quickNotesDraft = ta ? ta.value : '';
  saveQuickNotesDraft();
  updateQuickNotesBadge();
}

function parseQuickNotesPreview(){
  const ta = document.getElementById('qnNotes');
  const text = ta ? ta.value : '';
  _quickNotesDraft = text; saveQuickNotesDraft(); updateQuickNotesBadge();
  const rows = parseQuickNotes(text);
  if(!rows.length){ toast(t({ar:'⚠ اكتب ملاحظة واحدة على الأقل', en:'⚠ Write at least one note'}), true); return; }
  if(_qnTruncated){ toast(t({ar:`⚠ تجاوزت ${QN_MAX_LINES} سطر — عُرض أول ${QN_MAX_LINES} فقط`, en:`⚠ Over ${QN_MAX_LINES} lines — showing the first ${QN_MAX_LINES} only`}), true); }
  _qnPreview = rows;
  const pw = document.getElementById('qnPreviewWrap'); if(pw) pw.style.display = 'block';
  renderQuickNotesPreview();
  // move focus into the freshly-revealed preview (its heading) so keyboard and
  // screen-reader users are taken to the new region instead of being stranded on
  // the parse button with no announcement that N rows appeared.
  if(pw){
    try{ pw.scrollIntoView({behavior:'smooth', block:'nearest'}); }catch(_){}
    const heading = pw.querySelector('.section-title');
    if(heading){ heading.setAttribute('tabindex','-1'); try{ heading.focus({preventScroll:true}); }catch(_){} }
  }
}

function cancelQuickNotesPreview(){
  _qnPreview = [];
  const pw = document.getElementById('qnPreviewWrap'); if(pw) pw.style.display = 'none';
}

function renderQuickNotesPreview(){
  const list = document.getElementById('qnPreviewList');
  if(!list) return;
  // All rows removed → don't leave a confusing empty box: collapse the preview
  // and send focus back to the notes box so the user can edit and re-convert.
  if(!_qnPreview.length){
    cancelQuickNotesPreview();
    const ta = document.getElementById('qnNotes');
    if(ta) try{ ta.focus(); }catch(_){}
    return;
  }
  list.innerHTML = '';
  const validCount = _qnPreview.filter(r => r.valid).length;
  const cEl = document.getElementById('qnPreviewCount');
  // always show "valid / total" (not blank at 0) so the user understands why the
  // save button may be disabled
  if(cEl) cEl.textContent = validCount + ' / ' + _qnPreview.length;
  const confirmBtn = document.getElementById('qnConfirmBtn');
  if(confirmBtn){
    confirmBtn.disabled = (validCount === 0);
    confirmBtn.setAttribute('aria-disabled', String(validCount === 0));
  }
  _qnPreview.forEach((r, i) => {
    // each row carries its OWN target wallet (defaults to the top chip choice),
    // so the user can send some lines to one wallet and others to another.
    if(!r.wallet || !SELECTABLE_WALLETS.find(w => w.id === r.wallet)) r.wallet = _qnWallet;
    const cat = getCategory(r.category);
    const opts = SELECTABLE_WALLETS.map(w =>
      `<option value="${escHtml(w.id)}"${w.id === r.wallet ? ' selected' : ''}>${escHtml(w.name)}</option>`).join('');
    const typeLabel = r.type === 'income'
      ? t({ar:'النوع: دخل — اضغط للتبديل إلى مصروف', en:'Type: income — tap to switch to expense'})
      : t({ar:'النوع: مصروف — اضغط للتبديل إلى دخل', en:'Type: expense — tap to switch to income'});
    const row = document.createElement('div');
    row.className = 'qn-row' + (r.valid ? '' : ' invalid');
    row.innerHTML =
      `<div class="qn-row-top">` +
        `<button type="button" class="qn-type ${r.type}" data-i="${i}" aria-label="${escHtml(typeLabel)}" aria-pressed="${r.type === 'income'}">${r.type === 'income' ? '＋' : '－'}</button>` +
        `<input class="qn-row-desc" data-i="${i}" value="${escHtml(r.desc)}" placeholder="${escHtml(t({ar:'الوصف', en:'Description'}))}" autocomplete="off">` +
        `<button type="button" class="qn-row-del" data-i="${i}" aria-label="${escHtml(t({ar:'حذف هذا السطر', en:'Remove this line'}))}">✕</button>` +
      `</div>` +
      `<div class="qn-row-bottom">` +
        `<span class="qn-row-cat" role="img" aria-label="${escHtml(cat.name)}" title="${escHtml(cat.name)}">${cat.icon}</span>` +
        `<select class="qn-row-wallet" data-i="${i}" aria-label="${escHtml(t({ar:'محفظة هذا السطر', en:'Wallet for this line'}))}">${opts}</select>` +
        `<input class="qn-row-amt" data-i="${i}" inputmode="decimal" value="${r.valid ? r.amount : ''}" placeholder="0" autocomplete="off" aria-invalid="${!r.valid}" aria-label="${escHtml(t({ar:'المبلغ', en:'Amount'}))}">` +
      `</div>` +
      (r.valid ? '' : `<div class="qn-row-warn">⚠ ${escHtml(t({ar:'أضِف سعرًا لهذا السطر', en:'Add a price for this line'}))}</div>`);
    list.appendChild(row);
  });
  // Desc/amount/wallet inputs only mutate the model (no re-render → keeps focus
  // while typing). Type-toggle and delete re-render because they change structure.
  list.querySelectorAll('.qn-type').forEach(btn => btn.onclick = () => {
    const i = +btn.dataset.i;
    _qnPreview[i].type = _qnPreview[i].type === 'income' ? 'expense' : 'income';
    _qnPreview[i].category = _qnGuessCategory(_qnPreview[i].desc, _qnPreview[i].type);
    renderQuickNotesPreview();
  });
  list.querySelectorAll('.qn-row-desc').forEach(inp => inp.oninput = () => { _qnPreview[+inp.dataset.i].desc = inp.value; });
  list.querySelectorAll('.qn-row-wallet').forEach(sel => sel.onchange = () => { _qnPreview[+sel.dataset.i].wallet = sel.value; });
  list.querySelectorAll('.qn-row-amt').forEach(inp => inp.oninput = () => {
    const i = +inp.dataset.i;
    const v = round2(parseAmount(inp.value));
    _qnPreview[i].amount = v;
    _qnPreview[i].valid = isFinite(v) && v > 0;
    inp.closest('.qn-row').classList.toggle('invalid', !_qnPreview[i].valid);
    inp.setAttribute('aria-invalid', String(!_qnPreview[i].valid));
    // refresh the "valid / total" count + save-button state without a full
    // re-render (would steal focus mid-typing)
    const vc = _qnPreview.filter(r => r.valid).length;
    const cEl = document.getElementById('qnPreviewCount');
    if(cEl) cEl.textContent = vc + ' / ' + _qnPreview.length;
    const cb = document.getElementById('qnConfirmBtn');
    if(cb){ cb.disabled = (vc === 0); cb.setAttribute('aria-disabled', String(vc === 0)); }
  });
  list.querySelectorAll('.qn-row-del').forEach(btn => btn.onclick = () => {
    _qnPreview.splice(+btn.dataset.i, 1);
    renderQuickNotesPreview();
  });
}

// Re-read the persisted wallet ids so a commit can't target a wallet that was
// deleted in another tab while this modal was open — the cross-tab storage
// listener defers reloads while a modal is open, so in-memory WALLET_DEFS may be
// stale, and a tx on a since-deleted wallet would be silently dropped on the next
// load (_validTx). Falls back to the in-memory set if the read fails.
function _qnFreshWalletIds(){
  try{
    const raw = localStorage.getItem(LS_PREFIX + 'walletDefs');
    if(raw){
      const arr = JSON.parse(raw);
      if(Array.isArray(arr)){
        const ids = arr.map(w => w && w.id).filter(Boolean);
        if(ids.length) return new Set(ids);
      }
    }
  }catch(e){}
  return new Set(WALLET_DEFS.map(w => w.id));
}
async function commitQuickNotes(){
  if(_qnCommitBusy) return;
  // cross-op write guard: refuse to start while another mutation is mid-flight
  // (each write path has its own busy flag, but none blocked the others across an
  // await — two interleaving writers could corrupt balances)
  if(_opInFlight > 0){ toast(t({ar:'⏳ هناك عملية قيد التنفيذ — أعد المحاولة بعد لحظة', en:'⏳ Another operation is in progress — try again in a moment'}), true); return; }
  const committable = _qnPreview.filter(r => r.valid && isFinite(r.amount) && r.amount > 0);
  if(!committable.length){ toast(t({ar:'⚠ لا توجد معاملات صالحة — كل سطر يحتاج سعرًا', en:'⚠ No valid transactions — each line needs a price'}), true); return; }
  const validIds = _qnFreshWalletIds();
  const fallbackWallet = validIds.has(_qnWallet) ? _qnWallet
    : ((SELECTABLE_WALLETS.find(w => validIds.has(w.id)) || WALLET_DEFS.find(w => validIds.has(w.id)) || {}).id);
  if(!fallbackWallet){ toast(t({ar:'⚠ اختر محفظة مستهدفة', en:'⚠ Choose a target wallet'}), true); return; }
  _qnCommitBusy = true;
  _opInFlight++;
  _txMutationStamp++;
  const _btn = document.getElementById('qnConfirmBtn');
  _setBtnSaving(_btn, true, t({ar:'⏳ جارٍ الحفظ...', en:'⏳ Saving...'}));
  try{
    const baseTs = Date.now();
    const n = committable.length;
    const incomeTxs = [];
    let _reassigned = 0;
    committable.forEach((r, k) => {
      let category = r.type === 'income' ? (r.category === 'salary' ? 'salary' : 'other') : normalizeCategory(r.category);
      // ensure the resolved category actually supports this type (guards a bad guess)
      const cdef = getCategory(category);
      if(!cdef || !cdef.types || !cdef.types.includes(r.type)) category = (r.type === 'income' ? 'salary' : 'other');
      // per-row wallet, validated against the freshest persisted defs; a row whose
      // wallet vanished (deleted in another tab) falls back to the default so the
      // tx targets a real wallet instead of being dropped on the next load
      let rowWallet = r.wallet;
      if(!rowWallet || !validIds.has(rowWallet)){ rowWallet = fallbackWallet; if(r.wallet && r.wallet !== fallbackWallet) _reassigned++; }
      const tx = {
        id: 'tx_' + baseTs + '_qn' + k + '_' + Math.random().toString(36).slice(2,7),
        wallet: rowWallet,
        desc: String(r.desc || '').slice(0,120),
        amount: round2(r.amount),
        type: r.type,
        category: category,
        // distinct, ascending, never-future timestamps: [baseTs-(n-1) .. baseTs]
        // (the old Math.min(baseTs+k, now) collapsed to identical ts in fast loops)
        ts: baseTs - (n - 1 - k)
      };
      state.transactions.push(tx);
      applyTxToBalance(tx, +1);
      if(tx.type === 'income' && tx.category !== 'transfer') incomeTxs.push(tx);
    });
    if(_reassigned){ toast(t({ar:`ℹ️ ${_reassigned} سطر حُوّل للمحفظة الافتراضية (تغيّرت المحافظ في مكان آخر)`, en:`ℹ️ ${_reassigned} line(s) moved to the default wallet (wallets changed elsewhere)`}), true); }
    await saveBalances();
    await saveTx();
    // Auto-distribute income legs only when the user already enabled it — bulk
    // entry shouldn't pop a distribution modal per income line.
    if(autoDistribute && incomeTxs.length){
      for(const inc of incomeTxs){
        const live = state.transactions.find(t => t.id === inc.id);
        if(live) await runDistribution(live, live.amount);
      }
    }
    // Notes consumed — clear the draft so they're not re-imported next time.
    _quickNotesDraft = ''; saveQuickNotesDraft();
    const ta = document.getElementById('qnNotes'); if(ta) ta.value = '';
    _qnPreview = [];
    updateQuickNotesBadge();
    render();
    closeModal('quickNotesModal');
    haptic(15);
    toast(t({ar:`✓ تم تسجيل ${n} معاملة`, en:`✓ Recorded ${n} transaction${n===1?'':'s'}`}));
  } finally {
    _qnCommitBusy = false;
    _opInFlight--;
    _setBtnSaving(_btn, false);
  }
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
      if(isFinite(v) && v > 0 && v <= MAX_AMOUNT) out[w.id] = round2(v);
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
  if(_opInFlight > 0){ toast(t({ar:'⏳ هناك عملية قيد التنفيذ — أعد المحاولة بعد لحظة', en:'⏳ Another operation is in progress — try again in a moment'}), true); return; }
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
  // cross-op write guard (see commitQuickNotes) — block interleaving with another in-flight write
  if(_opInFlight > 0){ toast(t({ar:'⏳ هناك عملية قيد التنفيذ — أعد المحاولة بعد لحظة', en:'⏳ Another operation is in progress — try again in a moment'}), true); return; }
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
// When true, the next _pushOverlayHistory() call will REPLACE the current history
// entry (replaceState) instead of pushing a new one. Used by addTx() when it needs
// to atomically swap the add-drawer's history entry for the distribution modal's
// entry, avoiding the history.back()+pushState() race that would otherwise consume
// the modal entry and later navigate the user completely off the page.
let _nextPushOverlayReplaces = false;
function _pushOverlayHistory(){
  if(_nextPushOverlayReplaces){
    _nextPushOverlayReplaces = false;
    // Replace mode: swap the current overlay entry for the new modal's entry.
    // _overlayHistDepth stays the same — we're replacing, not adding.
    history.replaceState({ _mahfaztyOverlay: true, depth: _overlayHistDepth }, '');
  } else {
    _overlayHistDepth++;
    history.pushState({ _mahfaztyOverlay: true, depth: _overlayHistDepth }, '');
  }
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
    if(typeof _distDraft !== 'undefined') _distDraft = null; // fresh draft each time settings opens
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
    _editingDistSource = false; _editingTransferLeg = false; // reset so the next openEdit() starts clean
    // ensure wallet dropdown is fully closed so stale 'open' state can't persist across edits
    const ewWrap = document.getElementById('editWalletMenuWrap');
    const ewBtn  = document.getElementById('editWalletBtn');
    if(ewWrap) ewWrap.classList.remove('open');
    if(ewBtn){ ewBtn.classList.remove('open'); ewBtn.setAttribute('aria-expanded','false'); ewBtn.tabIndex = 0; ewBtn.removeAttribute('aria-disabled'); }
  }
  if(id === 'distributeModal') pendingIncomeTx = null;
  // driveConflictModal dismissed via Escape/back/backdrop WITHOUT a choice —
  // resolveConflict() nulls _pendingDriveCloud before it closes the modal, so a
  // still-set _pendingDriveCloud here means a genuine cancel. Drop the pending
  // cloud snapshot and clear the otherwise-frozen 'syncing' indicator (it would
  // never reach 'ok'/'error' on its own), keeping local data untouched. The next
  // local save re-arms a normal sync.
  if(id === 'driveConflictModal' && typeof _pendingDriveCloud !== 'undefined' && _pendingDriveCloud){
    _pendingDriveCloud = null;
    if(typeof setDriveIndicator === 'function') setDriveIndicator(driveAccessToken ? 'idle' : 'off');
  }
  if(id === 'settingsModal' && typeof _distDraft !== 'undefined') _distDraft = null; // discard unsaved dist edits
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
  // Only restore focus and pop overlay history when the modal was actually open —
  // calling closeModal() on an already-closed modal must not pop a focus entry that
  // belongs to a DIFFERENT modal currently open (corrupts multi-modal focus chain).
  if(wasOpen){
    const _retFocus = _focusStack.pop();
    if(_retFocus && typeof _retFocus.focus === 'function'){
      try{ _retFocus.focus({preventScroll:true}); }catch(_){}
    }
    _popOverlayHistory();
  }
}
// Modals that hold unsaved form input must NOT close on an accidental
// backdrop tap (common on mobile) — only their explicit buttons close them.
const _protectedModals = new Set(['editModal','transferModal','distributeModal','walletDetailModal','quickNotesModal',
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
function _wireGrabber(handle, sheet, isBlocked, doClose){
  if(!handle || !sheet) return;
  let startY = 0, dy = 0, dragging = false;
  handle.addEventListener('touchstart', e=>{
    if(isBlocked()) return;
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
    if(dy > 80){
      sheet.style.transition = '';
      doClose();
    } else {
      // Re-enable CSS transition BEFORE clearing transform so the snap-back
      // animates. Setting transition='' and transform='' in the same frame
      // lets the browser batch them and skip the animation (no transition to
      // interpolate from). The rAF ensures the paint cycle sees the transition
      // restored first, then applies the transform reset in the next frame.
      sheet.style.transition = '';
      requestAnimationFrame(() => { sheet.style.transform = ''; });
    }
  };
  handle.addEventListener('touchend', finish);
  handle.addEventListener('touchcancel', finish);
}
document.querySelectorAll('.modal-overlay .grabber').forEach(handle=>{
  const overlay = handle.closest('.modal-overlay');
  const sheet = handle.closest('.modal');
  _wireGrabber(handle, sheet, () => _protectedModals.has(overlay && overlay.id), () => closeModal(overlay.id));
});
// The add-transaction drawer isn't a .modal-overlay/.modal (it's the app's own
// add-drawer/add-drawer-overlay pair with its own close function), so the
// selector above never matched its grabber — same decorative-but-dead handle
// bug, just missed because this is the one dialog that isn't a generic modal.
_wireGrabber(document.querySelector('#addDrawer .grabber'), document.getElementById('addDrawer'), () => false, closeAddDrawer);

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
      cacheEl.textContent = keys.length ? keys.join(', ') : t({ar:'لا يوجد كاش', en:'No cache'});
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
  a.download = 'wallet-backup-' + todayISO() + '.json';
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

async function applyImport(text){
  let data;
  try{ data = JSON.parse(text); }
  catch(e){ toast(t({ar:'⚠ تنسيق JSON غير صالح', en:'⚠ Invalid JSON format'}), true); return; }

  if(!data || typeof data !== 'object' || !data.wallets || !Array.isArray(data.transactions)){
    toast(t({ar:'⚠ ملف غير صحيح — لا يحتوي على wallets أو transactions', en:'⚠ Invalid file — missing wallets or transactions'}), true); return;
  }
  if(!confirm(t({ar:'سيتم استبدال كل البيانات الحالية. متابعة؟', en:'This will replace all current data. Continue?'}))) return;
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
  if(!confirm(t({ar:'سيتم تصفير أرصدة محافظ التتبع (أوبر، البطاقات، الكاش) إلى صفر.\n\nالمعاملات لا تتأثر. هل تريد المتابعة؟', en:'This will reset tracking wallet balances (Uber, cards, cash) to zero.\n\nTransactions are not affected. Continue?'}))) return;
  _txMutationStamp++;
  _opInFlight++;
  try{
    WALLET_DEFS.forEach(w => { if(w.track) state.wallets[w.id] = 0; });
    prevSpendable = null;
    await saveBalances();
    render(true);
    toast(t({ar:'✓ تم تصفير محافظ التتبع', en:'✓ Tracking wallets reset'}));
  } finally { _opInFlight--; }
}

// Zero the regular (non-tracked) wallets while keeping the ledger. This makes
// balances diverge from the transaction history on purpose.
async function zeroRegularWallets(){
  if(!confirm(t({ar:'⚠️ سيتم تصفير أرصدة المحافظ العادية إلى صفر مع بقاء كل المعاملات.\n\nهذا يجعل الأرصدة لا تطابق سجل المعاملات (قد تظهر أرقام غير متوقعة في الإحصائيات).\n\nهل تريد المتابعة؟', en:'⚠️ This will reset regular wallet balances to zero while keeping all transactions.\n\nThis makes balances not match the transaction ledger (unexpected numbers may appear in stats).\n\nContinue?'}))) return;
  _txMutationStamp++;
  _opInFlight++;
  try{
    WALLET_DEFS.forEach(w => { if(!w.track) state.wallets[w.id] = 0; });
    prevSpendable = null;
    await saveBalances();
    render(true);
    toast(t({ar:'✓ تم تصفير المحافظ العادية', en:'✓ Regular wallets reset'}));
  } finally { _opInFlight--; }
}

// Remove every subscription. Balances and transactions are untouched.
async function clearAllSubscriptions(){
  if(!subscriptions.length){ toast(t({ar:'لا توجد اشتراكات للحذف', en:'No subscriptions to delete'})); return; }
  if(!confirm(t({ar:`سيتم حذف جميع الاشتراكات (${subscriptions.length}). لا يمكن التراجع.\n\nهل تريد المتابعة؟`, en:`This will delete all subscriptions (${subscriptions.length}). This cannot be undone.\n\nContinue?`}))) return;
  _opInFlight++;
  try{
    subscriptions = [];
    await saveSubs();
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
  const answer = prompt(t({
    ar: `⚠️ سيتم حذف جميع الأرصدة والمعاملات نهائياً ولا يمكن التراجع.\n\nاكتب كلمة "${_deleteWord}" للتأكيد:`,
    en: `⚠️ This will permanently delete all balances and transactions. This cannot be undone.\n\nType "${_deleteWord}" to confirm:`,
  }));
  if(answer === null) return; // cancelled
  if(answer.trim() !== _deleteWord){ toast(t({ar:'أُلغي الحذف — لم تُكتب كلمة التأكيد بشكل صحيح', en:'Deletion cancelled — confirmation word was not typed correctly'})); return; }
  _txMutationStamp++; // wholesale wipe — invalidate derived caches
  _opInFlight++; // block the cross-tab storage reload mid-wipe across the multi-await sequence below
  try{
  clearTimeout(_undoTimer); _lastDeleted = null;
  // Tombstone every existing transaction BEFORE clearing the array, so the
  // deletion propagates on the next merge sync. Clearing tombstones outright
  // (the old behaviour) let a cloud/other-device copy resurrect everything.
  const _wipeNow = Date.now();
  state.transactions.forEach(t => { if(t && t.id) deletedTxIds[t.id] = _wipeNow; });
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
  toast(t({ar:'🗑 تم حذف كل البيانات', en:'🗑 All data deleted'}));
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
  toastWithAction(msg, t({ar:'تراجع ↩️', en:'Undo ↩️'}), undoFn);
}
// critical=true marks a severe, rare warning (e.g. local persistence totally failed)
// that must not be silently overwritten by/lost a race with a routine toast that
// fires moments later from an in-flight optimistic save flow — see _criticalToastUntil.
function toastWithAction(msg, actionLabel, fn, critical){
  if(!critical && Date.now() < _criticalToastUntil){ _queuedToast = {fn: toastWithAction, args:[msg, actionLabel, fn, critical]}; return; }
  const el = document.getElementById('saveStatus');
  // critical warnings (e.g. data-loss) interrupt the screen reader; routine
  // action toasts (undo) stay polite. See the matching note in toast().
  el.setAttribute('aria-live', critical ? 'assertive' : 'polite');
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
const _WELCOME_STEPS = 8;
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
      if(tx.type==='expense'){ yExpense = round2(yExpense + tx.amount); yCount++; }
      else { yIncome = round2(yIncome + tx.amount); }
    }
  });

  let lines = [];
  if(yCount > 0 || yIncome > 0){
    const incomePart = yIncome>0 ? t({ar:` · دخل <b style="color:var(--green)">${fmt(yIncome)}</b>`, en:` · income <b style="color:var(--green)">${fmt(yIncome)}</b>`}) : '';
    if(yCount > 0){
      const txWord = t({ar:arPlural(yCount, 'معاملة', 'معاملتين', 'معاملات'), en:`${yCount} ${yCount===1?'transaction':'transactions'}`});
      lines.push(t({
        ar: `📅 <b style="color:var(--text)">أمس:</b> صرفت <b style="color:var(--red)">${fmt(yExpense)}</b> على ${txWord}${incomePart}`,
        en: `📅 <b style="color:var(--text)">Yesterday:</b> you spent <b style="color:var(--red)">${fmt(yExpense)}</b> on ${txWord}${incomePart}`,
      }));
    } else {
      lines.push(t({
        ar: `📅 <b style="color:var(--text)">أمس:</b> لم تُسجَّل مصروفات${incomePart}`,
        en: `📅 <b style="color:var(--text)">Yesterday:</b> no expenses recorded${incomePart}`,
      }));
    }
  } else {
    lines.push(t({ar:'📅 لم تُسجَّل معاملات أمس.', en:'📅 No transactions recorded yesterday.'}));
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
      lines.push(t({
        ar: `🔴 محفظة <b style="color:var(--text)">${escHtml(w.name)}</b> تجاوزت ميزانيتها الشهرية (${fmt(spent)} / ${fmt(budget)}).`,
        en: `🔴 Wallet <b style="color:var(--text)">${escHtml(w.name)}</b> exceeded its monthly budget (${fmt(spent)} / ${fmt(budget)}).`,
      }));
    } else if(spent >= budget*0.8){
      lines.push(t({
        ar: `🟡 محفظة <b style="color:var(--text)">${escHtml(w.name)}</b> قاربت حد ميزانيتها (${fmt(spent)} / ${fmt(budget)}).`,
        en: `🟡 Wallet <b style="color:var(--text)">${escHtml(w.name)}</b> is close to its budget limit (${fmt(spent)} / ${fmt(budget)}).`,
      }));
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
    const dueNames = dueSubs.map(s => escHtml(s.name)).join(t({ar:'، ', en:', '}));
    lines.push(t({
      ar: `📆 اشتراكات تُحسم اليوم: <b style="color:var(--text)">${dueNames}</b> · إجمالي: <b style="color:var(--red)">${fmt(dueTotal)}</b>`,
      en: `📆 Subscriptions due today: <b style="color:var(--text)">${dueNames}</b> · total: <b style="color:var(--red)">${fmt(dueTotal)}</b>`,
    }));
  }

  // pending recurring suggestions
  const recurring = detectRecurring();
  if(recurring.length > 0){
    const n = recurring.length;
    lines.push(t({
      ar: `🔁 لديك ${arPlural(n, 'معاملة متكررة محتملة', 'معاملتان متكررتان محتملتان', 'معاملات متكررة محتملة', 'معاملة واحدة متكررة محتملة')} بانتظار مراجعتك (تبويب تحليلات).`,
      en: `🔁 You have ${n} potential recurring ${n===1?'transaction':'transactions'} waiting for review (Analytics tab).`,
    }));
  }

  if(lines.length === 1 && yCount===0 && yIncome===0) return null;
  return lines.map(l=>`<div>${l}</div>`).join('');
}

/* ============================================================
   MONTHLY REPORT EXPORT (text-based, share or download)
============================================================ */
function exportMonthlyReport(){
  const now = new Date();
  const monthName = now.toLocaleDateString(_dateLocale(), {month:'long', year:'numeric', numberingSystem:'latn'});
  const [start, end] = monthRange(0);

  let totalIncome=0, totalExpense=0;
  const catTotals = {};
  state.transactions.forEach(tx=>{
    // skip transfers AND manual balance adjustments — otherwise an 'adjustment'
    // tx would be bucketed under "أخرى" and the report totals would diverge from
    // the in-app income/expense summary the user sees
    if(tx.ts < start || tx.ts >= end || tx.category==='transfer' || tx.category==='adjustment') return;
    if(tx.type==='income') totalIncome = round2(totalIncome + tx.amount);
    else {
      totalExpense = round2(totalExpense + tx.amount);
      const c = tx.category || 'other';
      catTotals[c] = round2((catTotals[c]||0) + tx.amount);
    }
  });

  const appName = t({ar:'محفظتيييي', en:'Mahfazty'});
  let report = `📊 ${t({ar:`تقرير ${appName} — ${monthName}`, en:`${appName} report — ${monthName}`})}\n`;
  report += `${'─'.repeat(28)}\n`;
  report += `${t({ar:'الدخل', en:'Income'})}: ${fmt(totalIncome)}\n`;
  report += `${t({ar:'المصروف', en:'Expense'})}: ${fmt(totalExpense)}\n`;
  report += `${t({ar:'الصافي', en:'Net'})}: ${fmt(totalIncome-totalExpense)}\n\n`;

  report += `${t({ar:'حسب الفئة', en:'By category'})}:\n`;
  Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).forEach(([catId,amt])=>{
    const cat = getCategory(catId);
    report += `  ${cat.icon} ${cat.name}: ${fmt(amt)}\n`;
  });

  report += `\n${t({ar:'أرصدة المحافظ', en:'Wallet balances'})}:\n`;
  WALLET_DEFS.forEach(w=>{
    report += `  ${w.track?'🏦':'💰'} ${w.name}: ${fmt(state.wallets[w.id] ?? 0)}\n`;
  });

  report += `\n📱 ${appName} 🙂‍↔️`;

  const shareData = { title: t({ar:`تقرير ${appName} — ${monthName}`, en:`${appName} report — ${monthName}`}), text: report };
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
      toast(t({ar:'✓ تم نسخ التقرير للحافظة', en:'✓ Report copied to clipboard'}));
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
  a.download = t({ar:'تقرير-محفظتيييي-', en:'Mahfazty-report-'}) + todayISO() + '.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(t({ar:'✓ تم تنزيل التقرير', en:'✓ Report downloaded'}));
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
  const lang = _currentLang();
  const appName = t({ar:'محفظتيييي', en:'Mahfazty'});
  const manifest = {
    name: appName,
    short_name: appName,
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
    dir: _langDir(lang),
    lang: lang,
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
let _updateBannerTimer = null;
let _updateBannerShowing = false;
function showUpdateBanner(){
  const el = document.getElementById('updateBanner');
  if(!el || _updateBannerShowing) return;
  _updateBannerShowing = true;
  const laterBtn = document.getElementById('btnUpdateLater');
  const nowBtn   = document.getElementById('btnUpdateNow');
  if(laterBtn) laterBtn.onclick = dismissUpdate;
  if(nowBtn)   nowBtn.onclick   = applyUpdate;
  requestAnimationFrame(()=> requestAnimationFrame(()=> el.classList.add('show')));
  // Auto-apply after 8 s if user doesn't interact — "يحدث من وحده"
  _updateBannerTimer = setTimeout(() => applyUpdate(), 8000);
}
function dismissUpdate(){
  clearTimeout(_updateBannerTimer); _updateBannerTimer = null;
  _updateBannerShowing = false;
  _pendingWorker = null;
  const el = document.getElementById('updateBanner');
  if(el) el.classList.remove('show');
  _updateChangelogDot();
}
function applyUpdate(){
  // Don't silently discard a half-typed transaction on reload.
  if(addDrawerOpen){
    const amt = document.getElementById('amountInput');
    const desc = document.getElementById('descInput');
    if((amt && amt.value) || (desc && desc.value)){
      if(!confirm(t({ar:'لديك معاملة غير محفوظة في نموذج الإضافة — التحديث الآن سيتجاهلها. متابعة؟', en:'You have an unsaved transaction in the add form — updating now will discard it. Continue?'}))) return;
    }
  }
  // Same guard for an in-progress transaction edit.
  if(editingTxId != null){
    if(!confirm(t({ar:'لديك تعديل معاملة لم يُحفظ — التحديث الآن سيتجاهله. متابعة؟', en:'You have an unsaved transaction edit — updating now will discard it. Continue?'}))) return;
  } else if(document.querySelector('.modal-overlay.open')){
    // Any other open dialog (تحويل/اشتراك/محفظة/توزيع الدخل، إلخ) can also hold
    // unsaved form input the two specific checks above don't know about — the
    // cross-tab storage listener already treats "any modal open" as unsafe to
    // reload over (see _anyOverlayOpen below); applyUpdate() is a user-initiated
    // reload so it asks instead of silently deferring.
    if(!confirm(t({ar:'هناك نافذة مفتوحة قد تحتوي بيانات غير محفوظة — التحديث الآن سيُغلقها. متابعة؟', en:'There is an open dialog that may contain unsaved data — updating now will close it. Continue?'}))) return;
  }
  // Flush any pending Drive sync before the reload interrupts it.
  if(typeof driveSyncTimer !== 'undefined' && driveSyncTimer){
    clearTimeout(driveSyncTimer); driveSyncTimer = null;
    if(driveAccessToken){ try{ driveSyncToCloud(); }catch(_){} }
  }
  clearTimeout(_updateBannerTimer); _updateBannerTimer = null;
  _updateBannerShowing = false;
  const btn = document.getElementById('btnUpdateNow');
  if(btn){ btn.disabled = true; btn.textContent = t({ar:'...جاري', en:'Working...'}); }
  _reloadOnControllerChange = true;
  if(_pendingWorker){
    try{ _pendingWorker.postMessage({type:'SKIP_WAITING'}); }catch(e){}
  }
  // Fallback reload — covers browsers where controllerchange is unreliable
  setTimeout(() => window.location.reload(), 3000);
}

async function forceClearAndUpdate(){
  const btn = document.querySelector('.btn-cache-refresh');
  if(btn){ btn.disabled = true; btn.textContent = `⏳ ${t({ar:'جاري...', en:'Working...'})}`; }
  _reloadOnControllerChange = true; // also reload via controllerchange if the new SW takes over before our explicit reload below
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

  // Capture whether a SW was already controlling this page at load time.
  // Distinguishes a first install (no old SW → no reload needed) from an
  // update (old SW swapped out → reload to load fresh assets).
  const hadController = !!navigator.serviceWorker.controller;

  try{
    // updateViaCache:'none' → the browser always re-fetches sw.js from the
    // network (never the HTTP cache) so a new version is detected reliably.
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(reg => {
        _swRegistration = reg;
        // Watch for a new SW installing — show the update banner as soon as
        // it reaches "installed" (caching complete, waiting for skipWaiting).
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if(!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if(newWorker.state === 'installed' && navigator.serviceWorker.controller){
              _pendingWorker = newWorker;
              showUpdateBanner();
            }
          });
        });
        // Trigger an explicit check right away, then poll every 15 min so
        // long-running sessions pick up a new version promptly.
        checkForSWUpdate(true);
        setInterval(checkForSWUpdate, 15 * 60 * 1000);
      })
      .catch(e => console.warn('SW registration failed:', e));

    // When the new SW takes control (after skipWaiting), reload to serve fresh assets.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if(hadController && _reloadOnControllerChange){
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
loadState().then(()=>{
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
