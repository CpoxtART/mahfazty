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

// Translate static markup: [data-i18n] sets text (or innerHTML with
// data-i18n-html), [data-i18n-ph] placeholder, [data-i18n-aria] aria-label,
// [data-i18n-title] title.
function applyStaticI18n(root){
  root = root || document;
  root.querySelectorAll('[data-i18n]').forEach(function(el){
    var v = t(el.getAttribute('data-i18n'));
    if(el.hasAttribute('data-i18n-html')) el.innerHTML = v; else el.textContent = v;
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
  'set.languageHint': { ar: 'اختر لغة التطبيق. يتغيّر اتجاه الواجهة تلقائياً مع اللغة.', en: 'Choose the app language. The interface direction changes automatically with the language.' }
};
