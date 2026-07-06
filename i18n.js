/* ============================================================
   i18n — translation engine + string tables
   Loaded BEFORE app.core.js so t() and the helpers are global.

   Design:
   - Arabic ('ar') is the source/default language. Every string in the markup
     and code keeps working in Arabic with ZERO translation entries — t() and
     the [data-i18n] walker fall back to Arabic (or the literal key) for any
     key that has no 'en' value yet. That means the app is never broken while
     the English table is being filled in; untranslated bits just stay Arabic.
   - 'ar' is the implicit state (no localStorage key). 'en' is stored, mirroring
     the theme/accent convention.
============================================================ */
var _LANG_LS = 'walletTracker_lang';
var _lang = 'ar';

function _currentLang(){
  try{ return localStorage.getItem(_LANG_LS) === 'en' ? 'en' : 'ar'; }catch(e){ return 'ar'; }
}
function _langDir(lang){ return lang === 'en' ? 'ltr' : 'rtl'; }
// BCP-47 locale for date/time formatting (numbers stay en-US everywhere)
function _dateLocale(){ return _lang === 'en' ? 'en-US' : 'ar-EG'; }

// Two call styles, both with optional {placeholder} substitution:
//   t('key')                       → look the key up in I18N_STRINGS (static markup)
//   t({ar:'…', en:'…'})            → inline bilingual literal (used at JS call sites
//                                     so dynamic strings are self-contained and can
//                                     never render a raw key; falls back to ar)
//   t(key, {n:5, name:'x'})        → replaces {n}/{name} in the result
function t(key, vars){
  var s;
  if(key && typeof key === 'object'){
    s = (key[_lang] != null) ? key[_lang] : key.ar;
  }else{
    var e = (typeof I18N_STRINGS !== 'undefined') ? I18N_STRINGS[key] : null;
    s = e ? (e[_lang] != null ? e[_lang] : e.ar) : key;
  }
  if(s == null) s = '';
  if(vars){ for(var k in vars){ s = s.split('{' + k + '}').join(vars[k]); } }
  return s;
}

// Translate static markup: [data-i18n] sets textContent, [data-i18n-html="key"]
// sets innerHTML (the key lives in the attribute value — used by the onboarding
// lists and the Drive conflict hint), [data-i18n-ph] placeholder, [data-i18n-aria]
// aria-label, [data-i18n-title] title.
function applyStaticI18n(root){
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(function(el){
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  // Separate selector: these carry the key in data-i18n-html itself, not in a
  // bare data-i18n, so the walker above never matched them (every English
  // onboarding bullet silently stayed Arabic before this).
  root.querySelectorAll('[data-i18n-html]').forEach(function(el){
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  root.querySelectorAll('[data-i18n-ph]').forEach(function(el){ el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
  root.querySelectorAll('[data-i18n-aria]').forEach(function(el){ el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
  root.querySelectorAll('[data-i18n-title]').forEach(function(el){ el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
}

function applyLang(lang){
  _lang = (lang === 'en') ? 'en' : 'ar';
  var html = document.documentElement;
  html.setAttribute('lang', _lang);
  html.setAttribute('dir', _langDir(_lang));
  document.title = t('app.title');
  applyStaticI18n(document);
}

function _updateLangUI(lang){
  document.querySelectorAll('#langTabs [data-lang]').forEach(function(b){
    var active = b.dataset.lang === lang;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function setLang(lang){
  lang = (lang === 'en') ? 'en' : 'ar';
  try{
    if(lang === 'ar') localStorage.removeItem(_LANG_LS);
    else localStorage.setItem(_LANG_LS, lang);
  }catch(e){}
  applyLang(lang);
  _updateLangUI(lang);
  // Rebuild dynamic, t()-driven UI so it picks up the new language + date locale.
  try{ if(typeof renderBottomNav === 'function') renderBottomNav(); }catch(e){}
  try{ if(typeof render === 'function') render(true); }catch(e){}
  try{ if(typeof renderChart === 'function') renderChart(); }catch(e){}
  try{ if(typeof renderPieChart === 'function') renderPieChart(); }catch(e){}
  // Settings-modal panels render their own markup outside render()'s reach
  // (only built on tab-open / explicit refresh), so a language switch while
  // one is already open left it showing stale-language text until something
  // else happened to re-trigger it.
  try{ if(typeof renderLayoutEditor === 'function') renderLayoutEditor(); }catch(e){}
  try{ if(typeof renderAccentSwatches === 'function') renderAccentSwatches(); }catch(e){}
  try{ if(typeof renderWalletDefsEditor === 'function') renderWalletDefsEditor(); }catch(e){}
  try{ if(typeof renderDistributionEditor === 'function') renderDistributionEditor(); }catch(e){}
  try{ if(typeof refreshDriveSettingsUI === 'function') refreshDriveSettingsUI(); }catch(e){}
  try{ if(typeof renderCategoryGrid === 'function') renderCategoryGrid(); }catch(e){}
  try{ if(typeof renderEditCategoryGrid === 'function') renderEditCategoryGrid(); }catch(e){}
  // An active wallet/category filter chip's label is only built inside its own
  // toggle function (app.ui.js), not part of render()'s normal cycle — refresh
  // it here so it doesn't stay stuck in whichever language it was toggled on in.
  try{ if(typeof refreshFilterChipLabels === 'function') refreshFilterChipLabels(); }catch(e){}
  // installed-PWA manifest bakes in name/dir/lang at build time — refresh it so
  // the home-screen name and text direction follow the newly chosen language.
  try{ if(typeof applyManifest === 'function') applyManifest(document.body.classList.contains('light')); }catch(e){}
  // theme-toggle button's tooltip text is set inside applyTheme() and otherwise
  // wouldn't refresh until the next manual theme change.
  try{ if(typeof applyTheme === 'function' && typeof _resolveThemeMode === 'function' && typeof _currentThemeMode === 'function') applyTheme(_resolveThemeMode(_currentThemeMode())); }catch(e){}
}

function initLang(){
  _lang = _currentLang();
  applyLang(_lang);
  _updateLangUI(_lang);
}

/* ============================================================
   STRING TABLE — { key: { ar: '…', en: '…' } }
   Add an 'en' value to translate; missing ones fall back to 'ar'.
============================================================ */
var I18N_STRINGS = {
  // ── app shell ──
  'app.title':        { ar: 'محفظتيييي 🙂‍↔️', en: 'Mahfazty 🙂‍↔️' },
  'app.name':         { ar: 'محفظتيييي', en: 'Mahfazty' },

  // ── header actions ──
  'hdr.data':         { ar: 'البيانات', en: 'Data' },
  'hdr.settings':     { ar: 'الإعدادات', en: 'Settings' },
  'hdr.themeToggle':  { ar: 'تبديل المظهر', en: 'Toggle theme' },
  'hdr.syncStatus':   { ar: 'حالة المزامنة', en: 'Sync status' },

  // ── home / hero ──
  'home.spendable':   { ar: 'إجمالي المتاح للصرف', en: 'Total available to spend' },
  'home.monthIncome': { ar: 'دخل الشهر', en: 'Income this month' },
  'home.monthExpense':{ ar: 'مصروف الشهر', en: 'Spent this month' },
  'home.altMode':     { ar: 'الوضع البديل', en: 'Alternate mode' },
  'home.altModeHint': { ar: 'دمج الاحتياطي الثاني (٥٠٪) في احتياطي موحّد واحد', en: 'Merge the second reserve (50%) into one unified reserve' },
  'home.wallets':     { ar: 'المحافظ', en: 'Wallets' },

  // ── quick notes → transactions ──
  'qn.bannerTitle':   { ar: 'ملاحظات سريعة ← معاملات', en: 'Quick notes → transactions' },
  'qn.bannerHint':    { ar: 'اكتب ملاحظاتك بحرية والبرنامج يحوّلها معاملات تلقائيًا', en: 'Jot freely — the app turns your notes into transactions' },
  'qn.bannerCta':     { ar: 'افتح', en: 'Open' },
  'qn.title':         { ar: '📝 ملاحظات سريعة ← معاملات', en: '📝 Quick notes → transactions' },
  'qn.intro':         { ar: 'اكتب كل معاملة في سطر مستقل: الوصف ثم السعر. البرنامج يحوّلها لمعاملات جاهزة تراجعها قبل الحفظ — بدون إدخال يدوي لكل واحدة.', en: 'Write one transaction per line: description then price. The app turns them into ready transactions you review before saving — no manual entry for each.' },
  'qn.ph':            { ar: 'قهوة ١٥\nبنزين ٥٠\nغداء مطعم ٤٥\nراتب ٥٠٠٠ +', en: 'Coffee 15\nGas 50\nLunch 45\nSalary 5000 +' },
  'qn.notesLabel':    { ar: 'الملاحظات السريعة', en: 'Quick notes' },
  'qn.sideHint':      { ar: '💡 سطر لكل معاملة: <b>الوصف وسعره</b> (مثل «قهوة ١٥»). أضِف <b>+</b> في آخر السطر أو اكتب «راتب/دخل» لتسجيلها كدخل.<br>👛 بعد «حوّل لمعاملات» يطلع لكل سطر قائمتان: <b>المحفظة الرئيسية</b> و<b>محفظة التتبّع</b> — تختار منهما مباشرةً.', en: '💡 One line per transaction: <b>description and price</b> (e.g. “Coffee 15”). Add <b>+</b> at the end or write “salary/income” to record it as income.<br>👛 After “Convert”, each line gets two dropdowns — <b>primary wallet</b> and <b>tracking wallet</b> — pick directly from them.' },
  'qn.walletLbl':     { ar: 'المحفظة الافتراضية لكل الأسطر — وبعد التحويل تقدر تعطي كل معاملة محفظتها', en: 'Default wallet for all lines — after converting, you can give each transaction its own wallet' },
  'qn.parse':         { ar: '🔎 حوّل لمعاملات', en: '🔎 Convert to transactions' },
  'qn.previewTitle':  { ar: 'معاينة المعاملات', en: 'Transactions preview' },
  'qn.previewHint':   { ar: 'لكل سطر قائمتان: <b>👛 المحفظة الرئيسية</b> (ذهبية) و<b>🏦 محفظة التتبّع</b> اختيارية (زرقاء). غيّرها من القوائم، عدّل الوصف/المبلغ، بدّل النوع (＋/－)، أو احذف أي سطر.', en: 'Two dropdowns per line: <b>👛 primary wallet</b> (gold) and an optional <b>🏦 tracking wallet</b> (blue). Change them from the dropdowns, edit the description/amount, toggle type (＋/－), or remove a line.' },
  'qn.confirm':       { ar: '✓ سجّل الكل', en: '✓ Record all' },

  // ── tabs / sections ──
  'sec.txLog':        { ar: 'سجل المعاملات', en: 'Transaction log' },
  'sec.monthStats':   { ar: '📊 تحليلات الشهر', en: '📊 This month’s insights' },
  'sec.subs':         { ar: 'الاشتراكات الشهرية', en: 'Monthly subscriptions' },
  'sec.subAdd':       { ar: '＋ اشتراك', en: '＋ Subscription' },
  'sec.byCategory':   { ar: 'التوزيع حسب الفئة', en: 'Breakdown by category' },
  'sec.exportReport': { ar: '📄 تصدير/مشاركة تقرير الشهر', en: '📄 Export / share monthly report' },

  // ── reports: filters & search ──
  'flt.day':          { ar: 'اليوم', en: 'Today' },
  'flt.week':         { ar: 'الأسبوع', en: 'Week' },
  'flt.month':        { ar: 'الشهر', en: 'Month' },
  'flt.year':         { ar: 'السنة', en: 'Year' },
  'flt.all':          { ar: 'الكل', en: 'All' },
  'search.ph':        { ar: 'ابحث في المعاملات...', en: 'Search transactions…' },
  'search.clear':     { ar: 'مسح البحث', en: 'Clear search' },
  'flt.clearWallet':  { ar: 'إلغاء تصفية المحفظة', en: 'Clear wallet filter' },
  'flt.clearCategory':{ ar: 'إلغاء تصفية الفئة', en: 'Clear category filter' },

  // ── summary cards ──
  'sum.income':       { ar: 'دخل', en: 'Income' },
  'sum.expense':      { ar: 'مصروف', en: 'Expense' },
  'sum.net':          { ar: 'الصافي', en: 'Net' },
  'sum.balanceFlow':  { ar: 'حركة الرصيد', en: 'Balance flow' },
  'sum.chartAria':    { ar: 'مخطط حركة الرصيد', en: 'Balance flow chart' },
  'sum.chartEmpty':   { ar: 'سجّل معاملتين لترى حركة رصيدك هنا', en: 'Log two transactions to see your balance flow here' },

  // ── bottom nav ──
  'nav.mainAria':     { ar: 'التنقل الرئيسي', en: 'Main navigation' },
  'nav.home':         { ar: 'الرئيسي', en: 'Home' },
  'nav.transactions': { ar: 'المعاملات', en: 'Transactions' },
  'nav.analytics':    { ar: 'تحليلات', en: 'Insights' },
  'nav.reports':      { ar: 'التقارير', en: 'Reports' },
  'drawer.addTx':     { ar: 'إضافة معاملة', en: 'Add transaction' },

  // ── add-transaction drawer ──
  'add.title':        { ar: '➕ إضافة معاملة', en: '➕ Add Transaction' },
  'add.close':        { ar: 'إغلاق الدرج', en: 'Close drawer' },
  'add.tabDetails':   { ar: 'التفاصيل', en: 'Details' },
  'add.tabTypeCat':   { ar: 'النوع والفئة', en: 'Type & Category' },
  'add.wallet':       { ar: 'المحفظة', en: 'Wallet' },
  'add.chooseWallet': { ar: 'اختر محفظة', en: 'Choose a wallet' },
  'add.trackLinkToggle':{ ar: 'احتساب هذه المعاملة على محفظة تتبع أيضاً؟', en: 'Also count this transaction toward a tracking wallet?' },
  'add.trackLinkWhich':{ ar: 'أي محفظة؟', en: 'Which wallet?' },
  'add.trackLinkLbl':  { ar: '🏦 محفظة التتبّع', en: '🏦 Tracking wallet' },
  'add.desc':         { ar: 'الوصف', en: 'Description' },
  'add.descPh':       { ar: 'مثال: عشاء، راتب، مواصلات...', en: 'e.g. Dinner, Salary, Transport…' },
  'add.voice':        { ar: 'إدخال صوتي', en: 'Voice input' },
  'add.quickAmounts': { ar: 'مبالغ سريعة', en: 'Quick amounts' },
  'add.amount':       { ar: 'المبلغ', en: 'Amount' },
  'add.date':         { ar: 'التاريخ', en: 'Date' },
  'add.typeExpense':  { ar: '➖ مصروف', en: '➖ Expense' },
  'add.typeIncome':   { ar: '➕ دخل', en: '➕ Income' },
  'add.category':     { ar: 'الفئة', en: 'Category' },
  'add.transfer':     { ar: '🔁 تحويل بين المحافظ', en: '🔁 Transfer between wallets' },
  'add.repeatLast':   { ar: '⏪ تكرار آخر معاملة', en: '⏪ Repeat last transaction' },
  'add.btnExpense':   { ar: '➖ مصروف', en: '➖ Expense' },
  'add.btnIncome':    { ar: '➕ دخل', en: '➕ Income' },

  // ── appearance / language settings ──
  'set.appearance':   { ar: '🌗 المظهر', en: '🌗 Appearance' },
  'set.appearanceHint':{ ar: 'اختر نهاري أو ليلي، أو اتركه تلقائياً ليتناغم مع إعداد نظام جهازك ويتغيّر معه فوراً عند تبديله.', en: 'Choose day or night, or leave it on auto to follow your device setting and switch instantly with it.' },
  'set.themeLight':   { ar: 'نهاري', en: 'Day' },
  'set.themeDark':    { ar: 'ليلي', en: 'Night' },
  'set.themeBlack':   { ar: 'مطفي', en: 'Matte' },
  'set.themeAuto':    { ar: 'تلقائي', en: 'Auto' },
  'set.accentHint':   { ar: 'لون التطبيق — لكل وضع (نهاري/ليلي) لونه المستقل.', en: 'App colour — each mode (day / night) keeps its own colour.' },
  'set.language':     { ar: '🌐 اللغة', en: '🌐 Language' },
  'set.languageHint': { ar: 'اختر لغة التطبيق. يتغيّر اتجاه الواجهة تلقائياً مع اللغة.', en: 'Choose the app language. The interface direction changes automatically with the language.' },

  // ── common (shared across modals) ──
  'common.cancel':    { ar: 'إلغاء', en: 'Cancel' },
  'common.close':     { ar: 'إغلاق', en: 'Close' },
  'common.save':      { ar: 'حفظ', en: 'Save' },

  // ── edit-transaction modal ──
  'edit.title':       { ar: '✎ تعديل المعاملة', en: '✎ Edit Transaction' },
  'edit.transferHint':{ ar: '🔁 هذه حركة تحويل بين محفظتين — يمكنك تعديل المبلغ والتاريخ فقط (يُحدَّث الطرفان معًا). المحفظة مقفلة للحفاظ على توازن التحويل.', en: '🔁 This is a transfer between two wallets — you can only edit the amount and date (both sides update together). The wallet is locked to keep the transfer balanced.' },
  'edit.distSourceHint':{ ar: '🔄 هذا الدخل تم توزيعه على محافظ أخرى — المبلغ مقفل لتفادي عدم التطابق مع الحصص الموزعة. لتغييره: احذف المعاملة (سيُحذف التوزيع كله) ثم أضفها من جديد.', en: '🔄 This income was distributed to other wallets — the amount is locked to avoid mismatching the distributed shares. To change it: delete the transaction (this deletes the whole distribution) then add it again.' },
  'edit.delete':      { ar: '🗑 حذف المعاملة', en: '🗑 Delete transaction' },

  // ── transfer modal ──
  'xfer.from':        { ar: 'من محفظة', en: 'From wallet' },
  'xfer.to':          { ar: 'إلى محفظة', en: 'To wallet' },
  'xfer.execute':     { ar: 'تنفيذ التحويل', en: 'Execute transfer' },

  // ── wallet detail modal ──
  'detail.balance':   { ar: 'الرصيد الحالي', en: 'Current balance' },
  'detail.txCount':   { ar: 'عدد المعاملات', en: 'Transaction count' },
  'detail.totalIncome':{ ar: 'إجمالي الدخل', en: 'Total income' },
  'detail.totalExpense':{ ar: 'إجمالي المصروف', en: 'Total expense' },
  'detail.budgetLbl': { ar: 'الميزانية الشهرية (مصروفات)', en: 'Monthly budget (expenses)' },
  'detail.budgetPh':  { ar: 'بدون حد (0 = تعطيل)', en: 'No limit (0 = disabled)' },
  'detail.budgetHint':{ ar: 'عند الوصول إليها سيتلون شريط التقدم بالأحمر وتظهر علامة تحذير ⚠ على بطاقة المحفظة.', en: 'When reached, the progress bar turns red and a ⚠ warning shows on the wallet card.' },
  'detail.syncLbl':   { ar: 'مزامنة الرصيد الفعلي', en: 'Sync actual balance' },
  'detail.syncPh':    { ar: 'الرصيد الجديد', en: 'New balance' },
  'detail.sync':      { ar: 'مزامنة', en: 'Sync' },
  'detail.syncHint':  { ar: 'هذه محفظة تتبع — أدخل رصيدك الفعلي الحالي (من تطبيق بنكك أو نقدًا) وسيتم تسجيل الفرق كمعاملة تلقائيًا.', en: 'This is a tracking wallet — enter your current actual balance (from your bank app or cash) and the difference will be logged as a transaction automatically.' },
  'detail.trackModeLbl':{ ar: 'عند ربط مصروف بهذه المحفظة من نموذج الإضافة:', en: 'When linking an expense to this wallet from the add form:' },
  'detail.trackDebit':{ ar: 'ينقص (رصيد فعلي)', en: 'Decreases (actual balance)' },
  'detail.trackCredit':{ ar: 'يزيد (عدّاد إنفاق)', en: 'Increases (spending counter)' },
  'detail.trackModeAria':{ ar: 'سلوك الربط', en: 'Link behavior' },
  'detail.trackModeHint':{ ar: '«رصيد فعلي»: المصروف ينقص الرصيد (مثل بطاقة/كاش). «عدّاد إنفاق»: المصروف يزيد الرقم (إجمالي ما صرفته على هذا البند).', en: '"Actual balance": the expense decreases the balance (like a card/cash). "Spending counter": the expense increases the number (total spent on this item).' },

  // ── distribute-income modal ──
  'dist.title':       { ar: '🔄 توزيع الدخل', en: '🔄 Income Distribution' },
  'dist.hintPrefix':  { ar: 'تم تسجيل دخل بقيمة ', en: 'Income of ' },
  'dist.hintSuffix':  { ar: '. هل تريد توزيعه على المحافظ حسب نسبك المعتادة؟', en: ' was logged. Distribute it across your wallets using your usual ratios?' },
  'dist.skip':        { ar: 'لا، إبقه هنا', en: 'No, keep it here' },
  'dist.confirm':     { ar: '✓ وزّعه الآن', en: '✓ Distribute now' },
  'dist.autoAlways':  { ar: 'وزّع كل دخل قادم تلقائيًا بدون سؤال', en: 'Auto-distribute every future income without asking' },

  // ── welcome / onboarding modal ──
  'onb.skip':         { ar: 'تخطّي', en: 'Skip' },
  'onb.s1Title':      { ar: 'أهلاً بك في محفظتيييي', en: 'Welcome to Mahfazty' },
  'onb.s1Body':       { ar: 'مدير ميزانيتك الشخصي — يقسّم دخلك تلقائيًا على محافظ مدروسة، ويتتبّع كل ريال يدخل ويطلع.', en: 'Your personal budget manager — automatically splits your income across well-planned wallets and tracks every riyal in and out.' },
  'onb.s1Note':       { ar: '🔒 بياناتك تبقى على جهازك بالكامل، ولا تُرفع لأي خادم.', en: '🔒 Your data stays entirely on your device — never uploaded to any server.' },
  'onb.s2Title':      { ar: 'وزّع دخلك بذكاء', en: 'Distribute your income smartly' },
  'onb.s2Body':       { ar: 'كل دخل تسجّله يتوزّع فورًا على ١٠ محافظ بنِسب جاهزة:', en: 'Every income you log is instantly split across 10 wallets with ready-made ratios:' },
  'onb.pillCore':     { ar: '٥٠٪ أساسي', en: '50% Core' },
  'onb.pillWishlist': { ar: '١٠٪ رغبات', en: '10% Wishlist' },
  'onb.pillGrowth':   { ar: '١٠٪ نمو', en: '10% Growth' },
  'onb.pillInvest':   { ar: '١٠٪ استثمار', en: '10% Investments' },
  'onb.pillJoy':      { ar: '١٠٪ متعة', en: '10% Joy of Life' },
  'onb.pillGiving':   { ar: '٥٪ عطاء', en: '5% Giving' },
  'onb.pillReserve':  { ar: '٥٪ احتياطي', en: '5% Reserve' },
  'onb.s2Note':       { ar: 'تقدر تعدّل النسب في أي وقت من ⚙ الإعدادات.', en: 'You can adjust the ratios anytime from ⚙ Settings.' },
  'onb.s3Title':      { ar: 'اعرف وين تروح فلوسك', en: 'Know where your money goes' },
  'onb.s3Li1':        { ar: '<b>🏷️ فئات ورسوم بيانية</b> — توزيع مصروفك وحركة رصيدك بصريًّا.', en: '<b>🏷️ Categories & charts</b> — visualize your spending breakdown and balance flow.' },
  'onb.s3Li2':        { ar: '<b>🔁 تحويل بين المحافظ</b> — وتسجيل بأي تاريخ ووقت.', en: '<b>🔁 Transfer between wallets</b> — logged with any date and time.' },
  'onb.s3Li3':        { ar: '<b>🎯 ميزانيات شهرية</b> — لكل محفظة، مع تنبيه عند الاقتراب.', en: '<b>🎯 Monthly budgets</b> — per wallet, with an alert as you approach the limit.' },
  'onb.s3Li4':        { ar: '<b>📆 الاشتراكات</b> — تابِع تكاليفك المتكررة وتذكيراتها.', en: '<b>📆 Subscriptions</b> — track your recurring costs and reminders.' },
  'onb.s4Title':      { ar: 'مرن وجاهز معك دائمًا', en: 'Flexible and always ready' },
  'onb.s4Li1':        { ar: '<b>🔄 الوضع البديل</b> — يدمج مدّخراتك في احتياطي واحد وقت الحاجة.', en: '<b>🔄 Alternate mode</b> — merges your savings into one reserve when needed.' },
  'onb.s4Li2':        { ar: '<b>🎙️ إدخال صوتي</b> — سجّل المبلغ والوصف بصوتك.', en: '<b>🎙️ Voice input</b> — log the amount and description by voice.' },
  'onb.s4Li3':        { ar: '<b>☁️ مزامنة Google Drive</b> — اختيارية، بحسابك الخاص.', en: '<b>☁️ Google Drive sync</b> — optional, with your own account.' },
  'onb.s4Li4':        { ar: '<b>📴 يعمل بدون إنترنت</b> — ثبّته كتطبيق على جهازك.', en: '<b>📴 Works offline</b> — install it as an app on your device.' },
  'onb.s4Note':       { ar: '💡 "بانك كاردز" و"كاش" أرقام تتبّع فقط — غير محتسبة بالإجمالي المتاح للصرف.', en: '💡 "Bank Cards" and "Cash" are tracking-only numbers — not counted in the total available to spend.' },
  'onb.s5Title':      { ar: 'أدوات توفّر وقتك', en: 'Tools that save you time' },
  'onb.s5Li1':        { ar: '<b>🔍 بحث وفلاتر سريعة</b> — دوّر بمعاملاتك واطلع فلاتر يوم/أسبوع/شهر بضغطة.', en: '<b>🔍 Search & quick filters</b> — search your transactions and pull up day/week/month filters in a tap.' },
  'onb.s5Li2':        { ar: '<b>👈 سحب للحذف + تراجع</b> — احذف معاملة بسحبة، وارجع خطوة بثانية إذا غيّرت رأيك.', en: '<b>👈 Swipe to delete + undo</b> — delete a transaction with a swipe, and undo within a second if you change your mind.' },
  'onb.s5Li3':        { ar: '<b>🤖 اكتشاف تلقائي للمصاريف المتكررة</b> — يرصد الأنماط ويذكّرك بتسجيلها بضغطة واحدة.', en: '<b>🤖 Automatic recurring-expense detection</b> — spots the patterns and reminds you to log them in one tap.' },
  'onb.s5Li4':        { ar: '<b>🔁 كرّر آخر عملية</b> — أعد إدخال مصروف معتاد بضغطة وحدة.', en: '<b>🔁 Repeat last transaction</b> — re-enter a usual expense in one tap.' },
  'onb.s5Li5':        { ar: '<b>📤 تقرير شهري جاهز</b> — شاركه أو نزّله بضغطة من 📊 التحليلات.', en: '<b>📤 Ready monthly report</b> — share or download it in a tap from 📊 Insights.' },
  'onb.s5Note':       { ar: '🎨 ورتّب التبويبات وحجم القوائم من ⚙ الإعدادات كما يحلو لك.', en: '🎨 Reorder the tabs and list sizes from ⚙ Settings however you like.' },
  'onb.sNotesTitle':  { ar: 'دوّن سريعًا… والباقي علينا', en: 'Jot it down… we’ll do the rest' },
  'onb.sNotesBody':   { ar: 'ما عندك وقت تدخل كل معاملة لحظة بلحظة؟ اكتب ملاحظاتك بحرية — سطر لكل معاملة (الوصف وسعره) — والبرنامج يحوّلها معاملات جاهزة تراجعها بضغطة.', en: 'No time to log every transaction on the spot? Jot freely — one line per transaction (description and price) — and the app turns them into ready transactions you review in a tap.' },
  'onb.notesPill1':   { ar: 'قهوة ١٥', en: 'Coffee 15' },
  'onb.notesPill2':   { ar: 'بنزين ٥٠', en: 'Gas 50' },
  'onb.notesPill3':   { ar: 'راتب ٥٠٠٠ +', en: 'Salary 5000 +' },
  'onb.sNotesNote':   { ar: '📝 تلقاه في البانر بالصفحة الرئيسية تحت «الوضع البديل».', en: '📝 Find it in the banner on the home page, under “Alternate mode”.' },
  'onb.s6Title':      { ar: 'محافظك… على ذوقك', en: 'Your wallets… your way' },
  'onb.s6Li1':        { ar: '<b>➕ أضِف محافظ جديدة</b> — عادية (تُحتسب بالإجمالي) أو تتبّع فقط.', en: "<b>➕ Add new wallets</b> — regular (counted in the total) or tracking-only." },
  'onb.s6Li2':        { ar: '<b>✏️ عدّل الأسماء ورتّب</b> — كل مجموعة على حدة بأسهم أعلى/أسفل.', en: '<b>✏️ Edit names and reorder</b> — each group separately with up/down arrows.' },
  'onb.s6Li3':        { ar: '<b>🗑 احذف ما لا تحتاجه</b> — مع حماية من حذف محفظة مرتبطة برصيد أو معاملات.', en: "<b>🗑 Delete what you don't need</b> — protected from deleting a wallet tied to a balance or transactions." },
  'onb.s6Li4':        { ar: '<b>⚙ إعدادات أنظف</b> — مقسّمة إلى ٣ تبويبات: الترتيب، المحافظ، البيانات.', en: '<b>⚙ Cleaner settings</b> — split into 3 tabs: Layout, Wallets, Data.' },
  'onb.s6Note':       { ar: '💡 تبدأ بـ ١٠ محافظ جاهزة، وتخصّصها كما يناسب حياتك من ⚙ الإعدادات ← المحافظ.', en: '💡 You start with 10 ready-made wallets, and customize them to fit your life from ⚙ Settings → Wallets.' },
  'onb.s7Title':      { ar: 'خصّصها على ذوقك', en: 'Make it yours' },
  'onb.s7Li1':        { ar: '<b>🌐 لغتان: عربي/English</b> — بدّلها بضغطة من زر اللغة بالأعلى.', en: '<b>🌐 Two languages: Arabic/English</b> — switch with one tap from the language button up top.' },
  'onb.s7Li2':        { ar: '<b>🌗 المظهر</b> — فاتح أو داكن أو أسود أو تلقائي حسب جهازك.', en: '<b>🌗 Appearance</b> — light, dark, black, or auto to match your device.' },
  'onb.s7Li3':        { ar: '<b>🎨 لون التطبيق</b> — اختر لونك المفضّل من ⚙ الإعدادات ← المظهر.', en: '<b>🎨 Accent color</b> — pick your favorite from ⚙ Settings → Appearance.' },
  'onb.s7Li4':        { ar: '<b>☀️ مراجعة يومية</b> — ملخّص سريع لحركة أمسك وما يستحقّ انتباهك.', en: '<b>☀️ Daily review</b> — a quick recap of yesterday and what needs your attention.' },
  'onb.s7Note':       { ar: '💡 كل هذا اختياري — التطبيق جاهز للعمل من أول لحظة بدون أي ضبط.', en: '💡 All optional — the app works out of the box with zero setup.' },
  'onb.back':         { ar: 'رجوع', en: 'Back' },
  'onb.next':         { ar: 'التالي', en: 'Next' },
  'onb.startIncome':  { ar: '＋ سجّل أول دخل', en: '＋ Log first income' },
  'onb.startBrowse':  { ar: 'أتصفّح أولاً', en: 'Browse first' },

  // ── daily review modal ──
  'review.title':     { ar: '☀️ مراجعة سريعة', en: '☀️ Quick Review' },
  'review.start':     { ar: 'تمام، يلا نبدأ', en: "Got it, let's start" },

  // ── drive conflict modal ──
  'conflict.title':   { ar: '☁️ تعارض في البيانات', en: '☁️ Data Conflict' },
  'conflict.hint':    { ar: 'وجدنا بيانات محفوظة على Drive <b style="color:var(--text)">وأيضًا</b> بيانات محلية على هذا الجهاز.<br>أيٌّ منهما تريد الاحتفاظ به؟', en: 'We found data saved on Drive <b style="color:var(--text)">and also</b> local data on this device.<br>Which one do you want to keep?' },
  'conflict.useDrive':{ ar: '☁️ استخدم نسخة Drive (تستبدل المحلية)', en: '☁️ Use the Drive copy (replaces local)' },
  'conflict.useLocal':{ ar: '📱 احتفظ بالمحلية (ارفعها إلى Drive)', en: '📱 Keep the local copy (upload it to Drive)' },

  // ── subscription modal ──
  'sub.title':        { ar: '📆 اشتراك جديد', en: '📆 New Subscription' },
  'sub.editTitle':    { ar: '✎ تعديل الاشتراك', en: '✎ Edit subscription' },
  'sub.name':         { ar: 'اسم الاشتراك', en: 'Subscription name' },
  'sub.namePh':       { ar: 'مثال: نتفليكس، شاهد، Spotify...', en: 'e.g. Netflix, Shahid, Spotify…' },
  'sub.amount':       { ar: 'المبلغ الشهري', en: 'Monthly amount' },
  'sub.billingDay':   { ar: 'يوم الاشتراك (1–31)', en: 'Billing day (1–31)' },
  'sub.active':       { ar: 'الاشتراك فعّال', en: 'Subscription active' },
  'sub.delete':       { ar: '🗑 حذف الاشتراك', en: '🗑 Delete subscription' },

  // ── wallet-definition modal ──
  'wdef.type':        { ar: 'نوع المحفظة', en: 'Wallet type' },
  'wdef.regular':     { ar: 'عادية (تُحتسب)', en: 'Regular (counted)' },
  'wdef.track':       { ar: 'تتبع (غير محتسبة)', en: 'Tracking (not counted)' },
  'wdef.name':        { ar: 'اسم المحفظة', en: 'Wallet name' },
  'wdef.namePh':      { ar: 'مثال: تعليم، سفر...', en: 'e.g. Education, Travel…' },
  'wdef.delete':      { ar: '🗑 حذف المحفظة', en: '🗑 Delete wallet' },
  'wdef.editTitle':   { ar: '✎ تعديل المحفظة', en: '✎ Edit wallet' },

  // ── banners (Drive connect, app update) ──
  'banner.driveAsk':      { ar: 'احفظ بياناتك تلقائياً على Google Drive؟', en: 'Save your data automatically to Google Drive?' },
  'banner.driveRemember': { ar: 'تذكّرني — اتصال بضغطة واحدة فقط في كل مرة (بدون كتابة بيانات تسجيل الدخول)', en: 'Remember me — connect with one tap each time (no need to type login details)' },
  'banner.later':         { ar: 'لاحقاً', en: 'Later' },
  'banner.driveYes':      { ar: 'نعم، اتصل', en: 'Yes, connect' },
  'banner.updateAvailable':{ ar: 'تحديث جديد متاح', en: 'New update available' },
  'banner.updateNow':     { ar: 'تحديث الآن', en: 'Update now' },

  // ── settings modal: header, stats, tabs ──
  'set.title':        { ar: '⚙️ الإعدادات', en: '⚙️ Settings' },
  'set.statTxCount':  { ar: 'معاملة', en: 'Transactions' },
  'set.statFirstTx':  { ar: 'أول معاملة', en: 'First transaction' },
  'set.statLastEdit': { ar: 'آخر تعديل', en: 'Last edit' },
  'set.versionLbl':   { ar: 'الإصدار: ', en: 'Version: ' },
  'set.forceUpdate':  { ar: '🔄 تحديث قسري', en: '🔄 Force update' },
  'set.whatsNew':     { ar: 'ما الجديد في التطبيق؟', en: "What's new in the app?" },
  'set.whatsNewSub':  { ar: 'آخر التحديثات والميزات المضافة', en: 'Latest updates and added features' },
  'set.newBadge':     { ar: 'جديد', en: 'New' },
  'set.tabLayout':    { ar: 'الترتيب', en: 'Layout' },
  'set.tabWallets':   { ar: 'المحافظ', en: 'Wallets' },
  'set.tabData':      { ar: 'البيانات', en: 'Data' },
  'set.tabsAria':     { ar: 'أقسام الإعدادات', en: 'Settings sections' },
  'set.appearanceAria':{ ar: 'وضع المظهر', en: 'Appearance mode' },
  'set.accentAria':   { ar: 'لون التطبيق', en: 'App colour' },

  // ── settings: layout panel ──
  'set.layoutHead':   { ar: '🔀 ترتيب الواجهة', en: '🔀 Interface Layout' },
  'set.layoutHint':   { ar: 'رتّب التبويبات والأقسام كما يناسبك. التغيير فوري.', en: 'Reorder the tabs and sections however you like. Changes apply instantly.' },
  'set.resetDefault': { ar: '↺ استعادة الافتراضي', en: '↺ Restore default' },

  // ── settings: wallets panel ──
  'set.walletsHead':  { ar: '🏦 إدارة المحافظ', en: '🏦 Manage Wallets' },
  'set.walletsHint':  { ar: 'أضف محافظ جديدة (عادية تُحتسب بالإجمالي، أو تتبع فقط)، وعدّل الاسم والترتيب.', en: 'Add new wallets (regular ones count toward the total, or tracking-only), and edit the name and order.' },
  'set.newWallet':    { ar: '➕ محفظة جديدة', en: '➕ New wallet' },
  'set.distHead':     { ar: '📐 نسب التوزيع التلقائي', en: '📐 Auto-Distribution Ratios' },
  'set.distHint':     { ar: 'عدّل نسبة كل محفظة من الدخل (المجموع = 100%).', en: 'Adjust each wallet’s share of income (total = 100%).' },
  'set.saveRatios':   { ar: 'حفظ النسب', en: 'Save ratios' },

  // ── settings: data panel ──
  'set.exportHead':   { ar: '⇅ تصدير واستيراد البيانات', en: '⇅ Export & Import Data' },
  'set.exportJson':   { ar: '⬇ تصدير JSON', en: '⬇ Export JSON' },
  'set.importFile':   { ar: '⬆ استيراد ملف', en: '⬆ Import file' },
  'set.pasteJson':    { ar: 'أو الصق/انسخ JSON هنا', en: 'Or paste/copy JSON here' },
  'set.importText':   { ar: 'استيراد من النص', en: 'Import from text' },
  'set.exportHint':   { ar: 'التصدير يحفظ الأرصدة وكل المعاملات. الاستيراد يستبدل البيانات الحالية بالكامل — تأكد من أخذ نسخة احتياطية أولاً.', en: 'Exporting saves the balances and all transactions. Importing fully replaces the current data — make sure to back up first.' },

  'set.driveDisabled':{ ar: 'غير مفعّل — أدخل Client ID للبدء.', en: 'Not enabled — enter a Client ID to start.' },
  'set.driveSaveId':  { ar: 'حفظ Client ID', en: 'Save Client ID' },
  'set.driveEmbeddedWarn':{ ar: '⚠️ افتح التطبيق في Chrome أو Safari مباشرةً لتسجيل الدخول.', en: '⚠️ Open the app directly in Chrome or Safari to sign in.' },
  'set.driveSignIn':  { ar: '🔐 تسجيل الدخول بجوجل', en: '🔐 Sign in with Google' },
  'drive.bannerAria': { ar: 'الاتصال بـ Google Drive', en: 'Connect to Google Drive' },
  'set.driveSyncNow': { ar: '⬆ مزامنة الآن', en: '⬆ Sync now' },
  'set.driveSignOut': { ar: 'خروج', en: 'Sign out' },
  'set.driveAutoTitle':{ ar: '🔐 الاتصال التلقائي', en: '🔐 Auto-Connect' },
  'set.driveAutoBody':{ ar: 'هل تريد الاتصال بـ Drive تلقائياً؟ لن تحتاج لتسجيل الدخول في كل مرة.', en: "Want to connect to Drive automatically? You won't need to sign in every time." },
  'set.driveAutoAlways':{ ar: '✓ دائماً', en: '✓ Always' },
  'set.driveAutoNotNow':{ ar: 'ليس الآن', en: 'Not now' },
  'set.driveAutoRowTitle':{ ar: 'الاتصال التلقائي عند الفتح', en: 'Auto-connect on open' },
  'set.driveAutoRowSub':{ ar: 'يتصل تلقائياً ما دامت جلسة Google نشطة', en: 'Connects automatically as long as the Google session is active' },
  'set.driveChangeId':{ ar: 'تغيير Client ID', en: 'Change Client ID' },

  'set.maintHead':    { ar: '🔧 صيانة الأرصدة', en: '🔧 Balance Maintenance' },
  'set.maintHint':    { ar: 'إذا شككت أن الأرصدة لا تطابق سجل معاملاتك، أعد حسابها من السجل (صفر + مجموع المعاملات).', en: 'If you suspect the balances don\'t match your transaction log, recalculate them from the log (zero + sum of transactions).' },
  'set.maintRepair':  { ar: '🔧 إصلاح الأرصدة من السجل', en: '🔧 Repair balances from log' },

  'set.dangerHead':   { ar: '🗑 الحذف والتصفير', en: '🗑 Deletion & Reset' },
  'set.dangerHint':   { ar: 'خيارات تصفير منفصلة. كل خيار يفعل ما يصفه اسمه فقط. الإجراءات التالية لا يمكن التراجع عنها.', en: 'Separate reset options. Each option only does what its name says. These actions cannot be undone.' },
  'set.resetTrackedTitle':{ ar: 'تصفير محافظ التتبع', en: 'Reset tracking wallets' },
  'set.resetTrackedSub':{ ar: 'أوبر، البطاقات، الكاش تصبح صفر. المعاملات لا تتأثر.', en: 'Uber, Cards, and Cash become zero. Transactions are not affected.' },
  'set.resetRegularTitle':{ ar: 'تصفير المحافظ العادية', en: 'Reset regular wallets' },
  'set.resetRegularSub':{ ar: 'الأرصدة تصبح صفر مع بقاء المعاملات (قد لا تتطابق).', en: 'Balances become zero while transactions remain (may no longer match).' },
  'set.resetSubsTitle':{ ar: 'تصفير الاشتراكات', en: 'Reset subscriptions' },
  'set.resetSubsSub': { ar: 'حذف كل الاشتراكات المسجّلة.', en: 'Delete all logged subscriptions.' },
  'set.resetBalTxTitle':{ ar: 'تصفير الرصيد والمعاملات', en: 'Reset balances and transactions' },
  'set.resetBalTxSub':{ ar: 'الأرصدة تصبح صفر وتُحذف كل المعاملات. الإعدادات تبقى.', en: 'Balances become zero and all transactions are deleted. Settings remain.' },
  'set.wipeAllTitle': { ar: 'حذف كل البيانات', en: 'Delete all data' },
  'set.wipeAllSub':   { ar: 'مسح كامل: الأرصدة والمعاملات والاشتراكات والإعدادات.', en: 'Full wipe: balances, transactions, subscriptions, and settings.' },

  'set.whatsNew2':    { ar: '📋 ما الجديد؟', en: "📋 What's New?" },
  'set.privacy':      { ar: 'سياسة الخصوصية', en: 'Privacy Policy' },
  'set.terms':        { ar: 'شروط الاستخدام', en: 'Terms of Use' }
};
