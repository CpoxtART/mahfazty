/* ============================================================
   ONBOARDING & DAILY ENGAGEMENT
   Split out of app.logic.js. Splash hide, the first-run welcome tour, the
   daily quick-review modal, and the shareable monthly report export.
   Loaded AFTER app.ui.js and BEFORE app.main.js. Calls render (app.main.js),
   openAddDrawer (app.ui.js) and openModal (app.overlay.js) at runtime only.
============================================================ */
function hideSplash(){
  clearTimeout(window._splashTimer); // cancel the 6s error watchdog — we loaded successfully
  const el = document.getElementById('splash');
  if(el) el.classList.add('hide');
  // A slow-but-successful boot (cold IndexedDB open on a first-ever visit, a
  // sluggish connection fetching the ~15 script files uncached, etc.) can let
  // index.html's inline 6s watchdog already fire and stamp its "your uploaded
  // file is likely corrupted — re-upload it" banner moments before loadState()
  // actually resolves here. That banner is now stale (boot DID complete) but
  // nothing ever removed it — a real user on a slow network would be stuck
  // staring at a scary, actionable-sounding-but-impossible-for-them instruction
  // permanently overlaying an app that's actually working fine. Clear it.
  const fatal = document.getElementById('fatalErrorBox');
  if(fatal) fatal.remove();
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
      // mark it seen and skip straight past it instead. Also check subscriptions/
      // budgets — a returning user who'd previously wiped their transaction ledger
      // (or only ever used manual balance adjustments) but still has configured
      // subscriptions/budgets recovered from IndexedDB is just as clearly not new.
      if(state.transactions.length > 0 || subscriptions.length > 0 || Object.keys(budgets).length > 0){
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
  const next = document.getElementById('onbNext');
  const nav = document.querySelector('#welcomeModal .onb-nav');
  const start = document.getElementById('onbStart');
  if(back) back.style.visibility = _welcomeStep === 0 ? 'hidden' : 'visible';
  // Previously hid the WHOLE nav row (Back included) on the last slide,
  // leaving Back reachable only via the progress dots — which are
  // aria-hidden and have no keydown handler, so a keyboard/screen-reader
  // user had no way at all to return to an earlier slide once on the last
  // one. Only the Next button (meaningless there, replaced by the Start
  // buttons below) needs to disappear; Back stays valid and reachable.
  if(nav) nav.style.display = 'flex';
  if(next) next.style.display = isLast ? 'none' : '';
  if(start) start.style.display = isLast ? 'flex' : 'none';
}
function welcomeNav(dir){
  _welcomeStep = Math.min(_WELCOME_STEPS - 1, Math.max(0, _welcomeStep + dir));
  _renderWelcomeStep();
  haptic(8);
}
function welcomeStart(recordIncome){
  // Same atomic-swap requirement as openTransferFromDrawer() above — closing
  // welcomeModal and immediately opening the add-drawer races history.back()
  // against pushState() unless the swap flag tells closeModal() to skip its pop.
  if(recordIncome) _nextPushOverlayReplaces = true;
  try{
    closeWelcome();
    if(recordIncome){ openAddDrawer(); setAddFormType('income'); }
  } finally {
    _nextPushOverlayReplaces = false;
  }
}
function closeWelcome(){
  closeModal('welcomeModal');
  try{ localStorage.setItem(LS_PREFIX + 'welcomeSeen', '1'); }catch(e){}
  // The tour's own "Works offline — install it as an app" bullet promises this
  // but gives no OS-specific how-to — right after the user reads it is the
  // most relevant moment to offer the actual install action (or, on iOS
  // Safari, the Share-sheet instructions since no install API exists there).
  // Delayed so it doesn't fight closeModal's own focus-restore/animation.
  setTimeout(maybeShowIosInstallHint, 500);
  setTimeout(maybeShowInstallBanner, 500);
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

    const content = buildDailyReviewContent(lastSeen);
    if(!content) return;
    document.getElementById('dailyReviewContent').innerHTML = content;
    openModal('dailyReviewModal');
  }catch(e){}
}

// lastSeen: the PREVIOUS lastReviewDate value (before today's write above), or
// null on the very first review ever — lets the subscriptions section below
// catch up on a billing day that fell in a gap the user was away, instead of
// only ever matching an exact "today" (see the subscriptions block further down).
function buildDailyReviewContent(lastSeen){
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
  const yStart = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).getTime();
  // exclusive end = start of today (calendar arithmetic, DST-safe — not yStart+24h)
  const yEnd = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()+1).getTime();

  let yExpense = 0, yIncome = 0, yCount = 0;
  state.transactions.forEach(tx=>{
    // exclude transfers AND manual balance adjustments so "أمس" matches the
    // income/expense totals shown everywhere else in the app
    if(tx.ts >= yStart && tx.ts < yEnd && !isSystemCategory(tx)){
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
  const lastDayOfMonth = _daysInMonth(now.getFullYear(), now.getMonth());
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

  // Catch-up: a billing day that fell on a day strictly between the last time
  // this review ran and today (e.g. opened on the 10th, sub due the 15th, not
  // reopened until the 20th) was previously never surfaced — the check above
  // only ever matches an exact "today". Bounded to the last 31 days so a
  // long-absent user doesn't get a backlog of stale notices; empty for the
  // normal daily-use case (lastSeen === yesterday leaves no day in the gap).
  if(lastSeen){
    const lastSeenDate = new Date(lastSeen + 'T00:00:00');
    if(!isNaN(lastSeenDate.getTime())){
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const gapStart = new Date(lastSeenDate); gapStart.setDate(gapStart.getDate() + 1);
      const cappedStart = new Date(todayStart); cappedStart.setDate(cappedStart.getDate() - 31);
      if(gapStart < cappedStart) gapStart.setTime(cappedStart.getTime());
      const missedIds = new Set();
      for(let d = new Date(gapStart); d < todayStart; d.setDate(d.getDate() + 1)){
        const dLastDay = _daysInMonth(d.getFullYear(), d.getMonth());
        subscriptions.forEach(s => {
          if(s.active === false || missedIds.has(s.id)) return;
          if(Math.min(s.billingDay, dLastDay) === d.getDate()) missedIds.add(s.id);
        });
      }
      const missedSubs = subscriptions.filter(s => missedIds.has(s.id));
      if(missedSubs.length > 0){
        const missedTotal = round2(missedSubs.reduce((s,x) => s + (Number(x.amount) || 0), 0));
        const missedNames = missedSubs.map(s => escHtml(s.name)).join(t({ar:'، ', en:', '}));
        lines.push(t({
          ar: `📆 اشتراكات استُحقت خلال غيابك: <b style="color:var(--text)">${missedNames}</b> · إجمالي: <b style="color:var(--red)">${fmt(missedTotal)}</b>`,
          en: `📆 Subscriptions that came due while you were away: <b style="color:var(--text)">${missedNames}</b> · total: <b style="color:var(--red)">${fmt(missedTotal)}</b>`,
        }));
      }
    }
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
let _exportReportBusy = false;
function exportMonthlyReport(){
  // Without this guard, a second tap while navigator.share()'s sheet is still
  // open rejects with InvalidStateError (not AbortError, so it isn't caught by
  // the AbortError check below) and falls through to _copyReportToClipboard —
  // silently showing a "copied" toast while the first tap's share sheet is
  // still on screen, contradicting what the user just saw.
  if(_exportReportBusy) return;
  _exportReportBusy = true;
  const now = new Date();
  // calendar:'gregory' pinned explicitly — a device set to a Hijri/Umm-al-Qura
  // OS calendar could otherwise make this report title show a different month
  // than the Gregorian one monthRange() below actually totals.
  const monthName = now.toLocaleDateString(_dateLocale(), {month:'long', year:'numeric', numberingSystem:'latn', calendar:'gregory'});
  const [start, end] = monthRange(0);

  let totalIncome=0, totalExpense=0;
  const catTotals = {};
  state.transactions.forEach(tx=>{
    // skip transfers AND manual balance adjustments — otherwise an 'adjustment'
    // tx would be bucketed under "أخرى" and the report totals would diverge from
    // the in-app income/expense summary the user sees
    if(tx.ts < start || tx.ts >= end || isSystemCategory(tx)) return;
    if(tx.type==='income') totalIncome = round2(totalIncome + tx.amount);
    else {
      totalExpense = round2(totalExpense + tx.amount);
      // normalizeCategory (not the raw id) — otherwise two DIFFERENT unknown/
      // legacy category ids (e.g. from an old app version) each get their own
      // bucket here, then both resolve to the identical "✨ Other" name at
      // render time below, showing as two separate "Other: ..." lines in the
      // report instead of one merged line. Same fix _computePieData() already
      // has (app.charts.js); this was a second site with the same gap.
      const c = normalizeCategory(tx.category);
      catTotals[c] = round2((catTotals[c]||0) + tx.amount);
    }
  });

  // This is plain text (no CSS reaches it), unlike every on-screen amount
  // element — which all explicitly force direction:ltr. Once shared into an
  // RTL-locale context (WhatsApp/Notes on an Arabic phone), a bare number
  // sitting among Arabic label/colon text has nothing pinning its direction;
  // wrapping each amount in Unicode bidi isolate marks (U+2066 LRI…U+2069 PDI)
  // keeps it an isolated LTR run so the label/colon/number order can't shift
  // regardless of where the text ends up rendered.
  const _iso = s => '⁦' + s + '⁩';
  const appName = t({ar:'محفظتيييي', en:'Mahfazty'});
  let report = `📊 ${t({ar:`تقرير ${appName} — ${monthName}`, en:`${appName} report — ${monthName}`})}\n`;
  report += `${'─'.repeat(28)}\n`;
  report += `${t({ar:'الدخل', en:'Income'})}: ${_iso(fmt(totalIncome))}\n`;
  report += `${t({ar:'المصروف', en:'Expense'})}: ${_iso(fmt(totalExpense))}\n`;
  report += `${t({ar:'الصافي', en:'Net'})}: ${_iso(fmt(totalIncome-totalExpense))}\n\n`;

  report += `${t({ar:'حسب الفئة', en:'By category'})}:\n`;
  Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).forEach(([catId,amt])=>{
    const cat = getCategory(catId);
    report += `  ${cat.icon} ${cat.name}: ${_iso(fmt(amt))}\n`;
  });

  report += `\n📱 ${appName} 🙂‍↔️`;

  const shareData = { title: t({ar:`تقرير ${appName} — ${monthName}`, en:`${appName} report — ${monthName}`}), text: report };
  if(navigator.share && (!navigator.canShare || navigator.canShare(shareData))){
    // _exportReportBusy stays true for as long as the native share sheet is
    // open (only cleared once its promise settles) so a second tap while it's
    // still on screen is ignored instead of racing it — see guard comment above.
    navigator.share(shareData).then(()=>{ _exportReportBusy = false; }).catch(e=>{
      _exportReportBusy = false;
      // AbortError = user dismissed the native share sheet without picking a
      // target app — that's normal, frequent, expected behavior, not a failure,
      // so don't fall back to clipboard copy (which would show a confusing
      // "copied!" toast right after the user chose to cancel, not copy).
      if(e && e.name === 'AbortError') return;
      _copyReportToClipboard(report);
    });
  } else {
    _copyReportToClipboard(report);
    _exportReportBusy = false;
  }
}

function _copyReportToClipboard(report){
  if(navigator.clipboard){
    navigator.clipboard.writeText(report).then(()=>{
      toast(t({ar:'✓ تم نسخ التقرير للحافظة', en:'✓ Report copied to clipboard'}));
    }).catch(()=> _legacyCopyOrDownload(report));
  } else {
    _legacyCopyOrDownload(report);
  }
}

// navigator.clipboard.writeText() can reject here on iOS Safari specifically
// because this runs inside an async .catch() handler (a share-sheet dismissal
// or the async clipboard call itself) — by then Safari may have already
// invalidated the "user gesture" transient activation clipboard writes
// require, independent of whether a copy could otherwise have worked.
// document.execCommand('copy') is synchronous and doesn't share that
// gesture-tracking quirk, so retry through it before giving up to a
// downloaded-file fallback — without this, a user could see a confusing
// "downloaded" toast for a report that actually never even needed downloading.
function _legacyCopyOrDownload(report){
  let copied = false;
  try{
    const ta = document.createElement('textarea');
    ta.value = report;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    copied = document.execCommand('copy');
    ta.remove();
  }catch(_){}
  if(copied){
    toast(t({ar:'✓ تم نسخ التقرير للحافظة', en:'✓ Report copied to clipboard'}));
  } else {
    _downloadReport(report);
  }
}

function _downloadReport(report){
  // UTF-8 BOM so Arabic text renders correctly when opened directly in Windows
  // Notepad/Excel instead of mojibake (neither auto-detects UTF-8 without it).
  const blob = new Blob(['﻿', report], {type:'text/plain;charset=utf-8'});
  _downloadBlob(blob, t({ar:'تقرير-محفظتيييي-', en:'Mahfazty-report-'}) + todayISO() + '.txt');
  toast(t({ar:'✓ تم تنزيل التقرير', en:'✓ Report downloaded'}));
}
