/* ============================================================
   ONBOARDING & DAILY ENGAGEMENT
   Split out of app.logic.js. Splash hide, the first-run welcome tour, the
   daily quick-review modal, and the shareable monthly report export.
   Loaded AFTER app.ui.js and BEFORE app.logic.js. Calls render (app.logic.js),
   openAddDrawer (app.ui.js) and openModal (app.overlay.js) at runtime only.
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
    if(tx.ts < start || tx.ts >= end || isSystemCategory(tx)) return;
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
    report += `  ${w.track?'🏦':'👛'} ${w.name}: ${fmt(state.wallets[w.id] ?? 0)}\n`;
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
