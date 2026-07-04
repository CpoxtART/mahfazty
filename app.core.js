
/* ============================================================
   CONFIG
============================================================ */
const LS_PREFIX = 'walletTracker_';

const WALLET_DEFS = [
  {id:'core',        name:'Core Expenses',       initial:0, track:false, pct:'50%'},
  {id:'wishlist',    name:'Wishlist',            initial:0, track:false, pct:'10%'},
  {id:'growth',      name:'Growth',              initial:0, track:false, pct:'10%'},
  {id:'investments', name:'Investments',         initial:0, track:false, pct:'10%'},
  {id:'joy',         name:'Joy of Life',         initial:0, track:false, pct:'10%'},
  {id:'giving',      name:'Giving',              initial:0, track:false, pct:'5%'},
  // reinstated in v47.75 as a permanent default (was folded into Core in v47.31)
  {id:'reserve',     name:'Reserve',             initial:0, track:false, pct:'5%'},
  // crisisOnly: hidden in normal mode, appears only when crisis/alternative mode is active
  {id:'crisis_fund', name:'Merged Reserve',      initial:0, track:false, crisisOnly:true},
  {id:'uber',        name:'Uber',                initial:0, track:true,  pct:'تتبع'},
  {id:'cards',       name:'Bank Cards',          initial:0, track:true,  pct:'تتبع'},
  {id:'cash',        name:'Cash',                initial:0, track:true,  pct:'تتبع'},
];

// Manually curated "what's new" log shown from Settings → 📋 ما الجديد؟.
// Newest entry first; add one entry per shipped feature round (not every
// commit) and keep `version` matching the CACHE bump in sw.js for that round
// — the unseen-badge logic in app.logic.js compares against CHANGELOG[0].version.
//
// Numbering: whole numbers (v47, v48, ...) are the baseline. Smaller follow-up
// rounds on top of that baseline get a decimal point instead of their own
// whole number — v47.1, v47.2, v47.3, ... up to v47.99 — then roll over to
// the next whole number (v48) and restart the decimals from there.
const CHANGELOG = [
  {
    version: 'v47.76',
    date: '2026-07-03',
    title: { ar: 'جولة إصلاحات من تدقيق شامل: حذف المحافظ الافتراضية، تطابق أرصدة التتبع بين الأجهزة، وحماية أقوى للبيانات', en: 'Fix round from a full audit: default-wallet deletion, cross-device tracked-balance convergence, and stronger data protection' },
    items: [
      { ar: 'إصلاح عالٍ: حذف محفظة Reserve أو «الاحتياطي المدمج» من إدارة المحافظ كان يفشل بصمت — التطبيق يعرض «تم الحذف» لكن منطق الترحيل يعيد إضافتها فورًا داخل نفس العملية. الآن الحذف يثبت نهائيًا (محليًا وعبر المزامنة وبعد إعادة الفتح)، ومن حذفها يقدر يرجعها بإنشاء محفظة جديدة بنفس الاسم.', en: 'High fix: deleting the Reserve or "Merged Reserve" wallet from Manage Wallets silently failed — the app showed "deleted" but the migration logic re-added it within the same operation. Deletion now sticks for good (locally, across sync, and after reopening), and anyone who deletes it can bring it back by creating a new wallet with the same name.' },
      { ar: 'إصلاح عالٍ (خفي منذ شهور، اكتُشف أثناء إصلاح ما سبق): تحميل بيانات المحافظ المخصّصة عند فتح التطبيق كان يتعطّل داخليًا في كل مرة لدى أي مستخدم لديه محافظ محفوظة، ويُصنَّف خطأً كـ«بيانات تالفة» فيُعاد تحميلها بصمت من النسخة الاحتياطية الداخلية — التي قد تكون أقدم من النسخة الأساسية بلحظات، ما قد يُرجِع تعديلًا حديثًا جدًا على المحافظ (كحذفٍ أو إعادة تسمية) دون أي إشعار. أُصلح الخلل من جذره وأصبح التحميل الأساسي يعمل فعليًا كما صُمِّم.', en: "High fix (hidden for months, uncovered while fixing the above): loading custom wallet data at app open was internally crashing every time for any user with saved wallets, getting misclassified as \"corrupt data\", and silently re-served from the internal backup copy — which could be moments older than the primary copy, quietly reverting a very recent wallet change (like a delete or rename) with no indication. Fixed at the root; the primary load now actually works as designed." },
      { ar: 'إصلاح عالٍ (قديم): أرصدة محافظ التتبع (أوبر/البطاقات/الكاش) لم تكن تتطابق بين جهازين أبدًا — تعديل الرصيد على جهاز يصل كسجل معاملة للجهاز الآخر لكن رصيده المعروض لا يتحرك. الآن أي تعديل/حذف لمعاملة تتبع قادمة من جهاز آخر يحرّك الرصيد المعروض فورًا بنفس المقدار.', en: "High fix (longstanding): tracked-wallet balances (Uber/Cards/Cash) never converged between two devices — a balance adjustment on one device arrived as a ledger entry on the other, but its displayed balance never moved. Now any tracked transaction merged in (or deleted) from another device moves the displayed balance immediately by the same amount." },
      { ar: 'إصلاح عالٍ: عند امتلاء مساحة التخزين المحلية كان آخر تعديل يضيع بصمت عند إعادة الفتح (النسخة القديمة العالقة كانت «تفوز» على النسخة الاحتياطية الأحدث رغم رسالة «يتم الحفظ في النسخة الاحتياطية»). الآن التطبيق يكتشف هذه الحالة تلقائيًا ويرجّح النسخة الاحتياطية الأحدث.', en: 'High fix: when local storage filled up, the latest edit was silently lost on reopen (the stuck old copy "won" over the newer backup copy despite the "saving to the backup copy" message). The app now detects this state automatically and prefers the newer backup.' },
      { ar: 'إصلاح متوسط: زر «الاتصال التلقائي عند الفتح» في إعدادات Drive كان يختفي بعد إعادة التشغيل ولا يعكس الاختيار المحفوظ — الآن يظهر دائمًا بعد ضبط Client ID ويعكس حالته الحقيقية.', en: 'Medium fix: the "auto-connect on open" toggle in Drive settings vanished after a restart and never reflected the stored choice — it now always shows once a Client ID is set, mirroring its real state.' },
      { ar: 'إصلاح متوسط: حساب قديم بقيت فيه نسبة Reserve يتيمة على 0% مع Core على 55% (توقيع الدمج القديم بالضبط) يُصلَّح الآن تلقائيًا إلى 5%/50% — دون لمس أي نسب خصّصها المستخدم بنفسه.', en: 'Medium fix: an older account left with an orphaned 0% Reserve share while Core sat at the old merged 55% (the exact legacy signature) is now auto-repaired to 5%/50% — without touching any user-customized ratios.' },
      { ar: 'متانة: قاعدة التحقق من صحة المعاملات أصبحت موحّدة في كل منافذ الدخول (الفتح، المزامنة، الاستيراد، تبنّي نسخة سحابية) بدل أربع نسخ متقاربة؛ وربط معاملات التتبع (trackWallet) صار محميًا من الضياع عند وصول نسخة سحابية قديمة، بنفس حماية روابط التوزيع.', en: 'Robustness: the transaction-validity rule is now one shared implementation across every entry point (load, sync, import, cloud adoption) instead of four near-copies; and tracked-transaction links (trackWallet) are now protected from being lost to a stale cloud copy, same as distribution links.' },
      { ar: 'أمان (وقائي): معرّفات المحافظ من نوع __proto__/constructor مرفوضة الآن عند الاستيراد (سد استباقي لتلوث النموذج الأولي)، وحقل النسبة في محرر التوزيع صار يُهرَّب دائمًا، وأُضيف form-action لسياسة أمان المحتوى.', en: 'Security (preventive): __proto__/constructor-style wallet ids are now rejected at import (proactive prototype-pollution foreclosure), the ratio field in the distribution editor is always escaped, and form-action was added to the Content-Security-Policy.' },
      { ar: 'اختبارات: 15 اختبارًا آليًا جديدًا تغطي منطق الدمج بين الأجهزة وترحيل المحافظ الافتراضية ونسب التوزيع — بالضبط المنطقة التي خرجت منها أخطاء هذه الجولة، حتى لا تتكرر بصمت.', en: 'Tests: 15 new automated tests covering cross-device merge logic, default-wallet migration, and distribution shares — exactly the area this round\'s bugs came from, so they can\'t silently recur.' },
    ],
  },
  {
    version: 'v47.75',
    date: '2026-07-03',
    title: { ar: '«Reserve» عادت محفظة افتراضية دائمة بنسبة 5%', en: '"Reserve" is a permanent default wallet again, with a 5% share' },
    items: [
      { ar: 'تغيير (بطلب مستخدم): محفظة "Reserve" — التي أُلغيت في v47.31 ودُمجت نسبتها (5%) مع Core Expenses — عادت الآن كمحفظة افتراضية دائمة بنسبة توزيع 5% ثابتة، ومحفظة Core Expenses رجعت لـ 50% كما كانت قبل الدمج.', en: 'Change (user-requested): the "Reserve" wallet — removed in v47.31 with its 5% folded into Core Expenses — is now back as a permanent default wallet with a fixed 5% distribution share, and Core Expenses is back to 50% like before the merge.' },
      { ar: 'إصلاح: أي حساب كانت عنده محفظة "Reserve" يتيمة بنسبة 0% (من قبل v47.31) يحصل الآن تلقائيًا على نسبة 5% الصحيحة بدل الصفر — سواء عند فتح التطبيق أو عند مزامنة/استيراد نسخة قديمة. إن كانت نسبة Core عندك مخصّصة يدويًا (غير 55%)، لا نلمسها ونكتفي بإضافة نسبة Reserve.', en: 'Fix: any account with an orphaned 0%-share "Reserve" wallet (a leftover from before v47.31) now automatically gets the correct 5% share instead of zero — whether on app launch or when syncing/importing an older backup. If your Core percentage was manually customized (not 55%), it is left untouched and only the Reserve share is added.' },
    ],
  },
  {
    version: 'v47.74',
    date: '2026-07-03',
    title: { ar: 'إصلاح حرج: خطأ تحديث نادر كان يمنع فتح التطبيق بالكامل', en: 'Critical fix: a rare update glitch could block the app from loading at all' },
    items: [
      { ar: 'حرج (مُبلَّغ من مستخدم): بعض من كان لديه تحديث معلّق منذ عدة إصدارات وطبّقه أخيراً واجه شاشة خطأ كاملة تمنع فتح التطبيق («Identifier VOICE_NUMBER_WORDS has already been declared»). السبب: عند إضافة ملفات كود جديدة في تحديث سابق (تقسيم الكود لملفات أصغر)، كانت آلية التحديث في بعض المتصفحات تجلب نسخة قديمة من ملف قديم من ذاكرة التخزين المؤقت للمتصفح نفسه (وليس ذاكرة التطبيق) بالتزامن مع الملف الجديد — فيتصادم الاثنان. الإصلاح: تحديث التطبيق الآن يتجاوز ذاكرة تخزين المتصفح المؤقتة تماماً ويجلب كل ملف طازجاً دائماً عند كل تحديث، فلا يتكرر هذا التصادم أبداً في تحديثات لاحقة.', en: 'Critical (user-reported): someone with an update pending for several versions who finally applied it hit a full error screen that blocked the app from opening ("Identifier VOICE_NUMBER_WORDS has already been declared"). Root cause: when new code files were added in a previous update (splitting the code into smaller files), the update mechanism in some browsers could pull a stale copy of an old file from the BROWSER\'s own cache (not the app\'s cache) alongside the genuinely new file — the two collided. Fix: updates now always bypass the browser\'s own cache and fetch every file fresh on every update, so this exact collision can never recur on future updates.' },
      { ar: 'ملاحظة لمن واجه الخطأ فعلاً: هذا الإصلاح يمنع تكرار المشكلة مستقبلاً، لكن الجهاز المتأثر قد يحتاج مسحاً يدوياً لبيانات الموقع مرة واحدة (من إعدادات المتصفح) للخروج من الحالة العالقة الحالية، لأن التطبيق نفسه لا يستطيع العمل لإصلاح نفسه أثناء ظهور هذا الخطأ بالذات.', en: "Note for anyone who actually hit the error: this fix prevents it from happening again going forward, but the already-affected device may need a one-time manual clear of the site's data (from the browser's settings) to break out of the current stuck state, since the app itself can't run to self-heal while this specific error is showing." },
    ],
  },
  {
    version: 'v47.73',
    date: '2026-07-03',
    title: { ar: 'فواصل الآلاف التلقائية + إصلاح تعرّف الملاحظات على المحافظ', en: 'Automatic thousands separators + fixed wallet recognition in Quick Notes' },
    items: [
      { ar: 'جديد: حقول المبلغ تُنسّق الآن تلقائياً بفواصل الآلاف وأنت تكتب — "1000" تصبح "1,000"، وهكذا حتى المليارات، في نموذج الإضافة والتعديل والتحويل والاشتراكات وميزانية المحفظة ومزامنة الرصيد وأسطر الملاحظات السريعة. المؤشر يبقى في مكانه الصحيح أثناء الكتابة حتى لو عدّلت رقماً في المنتصف.', en: 'New: amount fields now auto-format with thousands separators as you type — "1000" becomes "1,000", up through the billions — in the add form, edit modal, transfer, subscriptions, wallet budget, balance sync, and Quick Notes rows. The cursor stays exactly where it should even when editing a digit in the middle of a number.' },
      { ar: 'إصلاح: الملاحظات السريعة كانت تفشل في التعرف على أي محفظة إذا كانت الكلمة الأخيرة بالسطر غير معروفة — حتى لو كانت الكلمة قبلها اسم محفظة صحيحاً (مثال: «...المتعة كاردز» كانت تفشل بالكامل لأن «كاردز» غير معروفة، رغم أن «المتعة» صحيحة). أُضيف «كاردز» و«كارد» كأسماء بديلة لمحفظة البطاقات.', en: 'Fix: Quick Notes failed to recognize ANY wallet if the line\'s last word wasn\'t a known alias — even when the word right before it WAS a valid wallet name (e.g. "...Joy Cardz" failed entirely because "Cardz" was unrecognized, even though "Joy" was valid). Added "كاردز"/"كارد" as Arabic aliases for the Cards wallet.' },
      { ar: 'إصلاح ثانوي: رقم ملتصق مباشرة بحرف جر عربي («ب500» بدون مسافة) كان يترك ذلك الحرف عالقاً وحيداً في وصف المعاملة بعد حذف الرقم — أُصلح.', en: 'Minor fix: a number glued directly to a leading Arabic preposition ("ب500", no space) used to leave that single letter stranded in the transaction description after the number was removed — fixed.' },
    ],
  },
  {
    version: 'v47.72',
    date: '2026-07-03',
    title: { ar: 'صيانة داخلية: تقسيم الكود لملفات أصغر وأنظف', en: 'Internal maintenance: splitting the code into smaller, cleaner files' },
    items: [
      { ar: 'صيانة: أكبر ملفين في التطبيق (app.logic.js بـ 3489 سطراً، app.ui.js بـ 2549 سطراً) قُسِّما إلى 7 ملفات أصغر ومتخصصة — الملاحظات السريعة، النوافذ المنبثقة وسجل التصفح، إدارة البيانات (تصدير/استيراد/تصفير/إصلاح)، الترحيب والمراجعة اليومية، دورة حياة PWA، الإدخال الصوتي، وتخصيص الترتيب — كل ملف بنطاق واحد واضح. لا تغيير في أي سلوك ظاهر؛ فقط إعادة تنظيم لسهولة الصيانة المستقبلية.', en: "Maintenance: the app's two largest files (app.logic.js at 3489 lines, app.ui.js at 2549 lines) were split into 7 smaller, focused files — Quick Notes, modals & back-button history, data management (export/import/reset/repair), onboarding & daily review, PWA lifecycle, voice input, and layout customization — each with one clear scope. No visible behavior change; purely a reorganization for easier future maintenance." },
      { ar: 'إصلاح ثانوي مكتشف أثناء الصيانة: دالة ترتيب التبويبات/الأقسام (sanitizeOrder) كانت تخطئ أحياناً في تحديد موضع عنصر مفقود عند تطابق رقمي عرضي بين حسابين داخليين — أُصلح.', en: 'Minor fix found during maintenance: the tab/section ordering function (sanitizeOrder) could occasionally misplace a missing item when two internal calculations happened to produce the same number — fixed.' },
    ],
  },
  {
    version: 'v47.71',
    date: '2026-07-03',
    title: { ar: 'إصلاح حرج: تصفير رصيد المحفظة كان يرتد بعد المزامنة', en: 'Critical fix: zeroing a wallet balance was reverting after sync' },
    items: [
      { ar: 'حرج: أزرار «تصفير محافظ التتبع» و«تصفير المحافظ العادية» كانتا تكتبان صفراً مباشرة على الرصيد بدون أي أثر في سجل المعاملات — فور تشغيل أي مزامنة مع Drive (خلال ~1.5 ثانية تلقائياً)، كانت الدالة الداخلية لإعادة حساب الأرصدة من السجل تُعيد الرصيد القديم فوراً وبصمت، للمحافظ العادية بشكل مؤكّد 100% (تحقّقنا منه مباشرة) وللمحافظ التتبعية بنفس فئة الخطر. السبب الجذري ليس «الحذف محلي فقط بدون مزامنة» كما بدا — بل العكس: التصفير لم يكن له أي وجود حقيقي في البيانات المُزامنة أصلاً. الإصلاح: كلا الزرّين الآن يسجّلان معاملة «تسوية» توازن الرصيد إلى صفر (نفس الآلية المستخدمة أصلاً في مزامنة رصيد محفظة تتبع واحدة) بدل كتابة الرقم مباشرة — فيصبح التصفير جزءاً حقيقياً من السجل يُزامَن ويصمد أمام أي عملية مزامنة أو إصلاح أرصدة لاحقة.', en: 'Critical: the "reset tracking wallets" and "reset regular wallets" buttons wrote a bare zero directly onto the balance with no trace in the transaction ledger — the moment any Drive sync ran (automatically within ~1.5s), the internal balance-recalculation-from-ledger logic silently restored the old balance. Confirmed 100% reproducible for regular wallets, and in the same risk class for tracked wallets. The root cause wasn\'t "the delete stays local and never reaches sync" as it appeared — it was the reverse: the reset was never a real fact in the synced data to begin with. Fix: both buttons now record a "balance reset" adjustment transaction that brings the balance to zero (the same mechanism already used for single tracked-wallet balance sync) instead of writing the number directly — making the reset a real, durable ledger entry that survives any sync or balance-repair operation afterward.' },
      { ar: 'تحقّق: أُعيد إنتاج الخلل ببيئة اختبار حقيقية، وأُثبت الإصلاح ضد محاكاة دمج بيانات سحابية أقدم ثم إعادة حساب يدوي — الرصيد يبقى صفراً في الحالتين.', en: 'Verified: the bug was reproduced in a real browser test environment, and the fix was proven against a simulated older-cloud-snapshot merge followed by a manual recalculation — the balance stays at zero in both cases.' },
      { ar: 'إصلاح إضافي: عدة أزرار حساسة (إصلاح الأرصدة من السجل، حذف كل الاشتراكات، تصفير الرصيد والمعاملات، حذف كل البيانات) كانت تفتقر لحارس منع التداخل مع عملية أخرى قيد التنفيذ — أُضيف لها جميعاً.', en: 'Additional fix: several sensitive buttons (repair balances from ledger, delete all subscriptions, reset balance and transactions, delete all data) were missing the standard cross-operation write guard — added to all of them.' },
      { ar: 'صيانة داخلية: إزالة دالة غير مستخدمة، وتوحيد 3 مواضع منطق مكرر (فحص صحة المعاملة، استعادة أرصدة المحافظ، دمج وسوم الحذف) في دوال مشتركة — بدون أي تغيير في السلوك الظاهر.', en: 'Internal maintenance: removed one unused function, and consolidated 3 duplicated logic blocks (transaction validity check, wallet-balance restore, tombstone-map merging) into shared helpers — no change in visible behavior.' },
    ],
  },
  {
    version: 'v47.70',
    date: '2026-07-03',
    title: { ar: 'سجل «ما الجديد؟» صار ثنائي اللغة بالكامل', en: 'The "What\'s new?" log is now fully bilingual' },
    items: [
      { ar: 'خفيف (تحسين تجربة): سجل التحديثات كان يعرض كل الملاحظات بالعربية دائماً حتى في الوضع الإنجليزي — كل الإصدارات الـ77 (من v34 إلى الآن) تُرجمت بالكامل، وصار السجل يعرض لغتك الحالية فوراً.', en: 'Low (UX): the changelog used to always show its notes in Arabic, even in English mode — all 77 historical entries (from v34 to today) are now fully translated, and the log displays your current language instantly.' },
    ],
  },
  {
    version: 'v47.69',
    date: '2026-07-02',
    title: { ar: 'العدسات الثلاث المتبقية — الصوت والأرقام والنوافذ', en: 'The last three audit lenses — voice, numbers, and modals' },
    items: [
      { ar: 'عالي: الإدخال الصوتي كان معطوباً بالكامل — أي جملة من أكثر من كلمة («صرفت خمسين على عشاء») كانت تفشل بـ«لم يتم العثور على رقم» لأن التطبيع كان يحذف المسافات قبل تقطيع الكلمات. أُصلح وأضيفت الأعداد المركبة («احد عشر» = 11).', en: 'High: voice input was completely broken — any multi-word phrase ("spent fifty on dinner") failed with "no number found" because digit normalization stripped spaces before the words were split. Fixed, and compound numbers ("eleven") are now recognized too.' },
      { ar: 'عالي: نافذة تعديل المعاملة كانت تفتح خلف نافذة تفاصيل المحفظة (النقر يبدو بلا أثر) — ترتيب الرسم صار يتبع ترتيب الفتح، وأزرار Escape/الرجوع تغلق النافذة المرئية فعلاً.', en: 'High: the edit-transaction modal opened BEHIND the wallet-detail modal (tapping a row appeared to do nothing) — paint order now follows open order, and Escape/back now close the visible dialog.' },
      { ar: 'متوسط: «قهوة 1,234.56» في الملاحظات السريعة كانت تُسجَّل بمبلغ 56 (فساد صامت) — نمط الأرقام صار يفهم فواصل الآلاف اللاتينية والعربية ٬.', en: 'Medium: "coffee 1,234.56" in Quick Notes silently saved as 56 — the number pattern now understands Latin and Arabic thousands separators.' },
      { ar: 'متوسط: حقول المبالغ تحولت من type=number إلى type=text — المتصفح كان يمسح الأرقام العربية-الهندية (١٥٫٥) قبل وصولها للمحلل أصلاً؛ الآن تعمل في كل الحقول.', en: 'Medium: amount fields switched from type=number to type=text — the browser was silently blanking Arabic-Indic digits (١٥٫٥) before they ever reached the parser; they now work in every field.' },
      { ar: 'متوسط: الاستيراد يقصّ التواريخ المستقبلية (ملف من جهاز ساعته متقدمة كان يفسد فرز القوائم وإجماليات الشهر)، وأضيف له حارس التزامن الذي يملكه كل كتّاب المال.', en: 'Medium: import now clamps future timestamps (a backup from a fast-clock device could corrupt list ordering and month totals), and gained the same cross-operation write guard every other money-writer already has.' },
      { ar: 'متوسط: التطبيق كان قابلاً للتفاعل قبل اكتمال تحميل البيانات (عبر Tab أو مهلة الـ 6 ثوان) — معاملة تُضاف حينها كانت تُمحى بصمت؛ الآن يرفض الكتابة برسالة واضحة حتى يكتمل التحميل.', en: 'Medium: the app was interactive before data finished loading (via Tab, or the 6-second watchdog) — a transaction added during that window was silently wiped; it now refuses to write, with a clear message, until loading completes.' },
      { ar: 'ترجمة: 4 تسميات وصول (aria) كانت تبقى عربية في الوضع الإنجليزي أُصلحت، سهمان معكوسان في النص الإنجليزي، وأسماء الألوان تتحدث فور تبديل اللغة.', en: 'Translation: 4 aria labels that stayed Arabic in English mode are fixed, two reversed arrows in the English copy were corrected, and accent-color names now refresh the instant the language is switched.' },
      { ar: 'وصول: منتقيات المحافظ كانت صمّاء لقارئات الشاشة (فلتر النقرات الاصطناعية) — صارت تفرق بين صدى لوحة المفاتيح ونقرة TalkBack/VoiceOver الحقيقية.', en: 'Accessibility: wallet pickers were deaf to screen readers (a synthetic-click filter blocked them) — they now distinguish a keyboard echo from a real TalkBack/VoiceOver tap.' },
      { ar: 'تحليلات: مقارنة «عن الشهر الماضي» صارت مقابل نفس الفترة منه (كانت تعرض ▼95% في ثاني يوم من كل شهر)، ومراجعة اليوم تظهر حتى لو بقي التطبيق مفتوحاً عبر منتصف الليل.', en: 'Analytics: the "vs last month" comparison now compares the same period (it used to show "▼95%" on the 2nd of every month), and the daily review now still appears for a tab kept open across midnight.' },
    ],
  },
  {
    version: 'v47.68',
    date: '2026-07-02',
    title: { ar: 'إغلاق المؤجلات — حذف لا يرتد، واستعادة حقيقية', en: 'Closing the deferred items — durable deletes, real restore' },
    items: [
      { ar: 'متوسط: حذف اشتراك أو محفظة على جهاز ما عاد "يُبعث من الموت" من الجهاز الآخر المتزامن — أضيفت وسوم حذف (tombstones) للاشتراكات وتعريفات المحافظ تنتشر عبر Drive مثل المعاملات تماماً. محفظة موسومة بالحذف لكنها تحمل بيانات على جهازك تبقى حية (البيانات تغلب الحذف).', en: 'Medium: deleting a subscription or wallet on one device could no longer be "resurrected" by another synced device — subscriptions and wallet definitions now get delete tombstones that propagate through Drive exactly like transactions. A wallet marked for deletion that still holds data on your device stays alive (data beats deletion).' },
      { ar: 'متوسط: استيراد نسخة احتياطية صار استبدالاً حقيقياً حتى مع Drive متصل — كل ما كان موجوداً قبل الاستيراد وغائب عن ملف النسخة يوسَم بالحذف، فلا يعيده الدمج السحابي التالي.', en: "Medium: restoring a backup now genuinely replaces your data even with Drive connected — anything that existed before the import and is absent from the backup file gets tombstoned, so the next cloud merge can't bring it back." },
      { ar: 'خفيف: قفل تمرير الخلفية خلف النوافذ صار مقاوماً لـ iOS Safari — تثبيت الصفحة بموضعها (position:fixed) بدل overflow:hidden الذي يتجاهله سفاري أثناء سحب الإصبع، مع استعادة موضع التمرير عند الإغلاق.', en: "Low: the background scroll lock behind modals is now iOS Safari-proof — the page is pinned in place (position:fixed) instead of overflow:hidden, which Safari ignores during a finger drag, with scroll position restored on close." },
    ],
  },
  {
    version: 'v47.67',
    date: '2026-07-02',
    title: { ar: 'تدقيق عميق بزوايا جديدة — 15 إصلاحاً', en: 'Deep audit, new angles — 15 fixes' },
    items: [
      { ar: 'حرج: 15 زراً كانوا معطّلين تماماً بسبب CSP (شارات ⓘ/⚖️ على بطاقات المحافظ، أزرار إدارة المحافظ ✎▲▼🗑، محرر ترتيب الواجهة، زر «سجّل أول دخل»، أزرار الحالة الفارغة في التقارير، قائمة عدد المعاملات) — كانت onclick= داخل HTML مُولَّد برمجياً والمتصفح يحجبها. حُوِّلت كلها إلى ربط برمجي.', en: 'Critical: 15 buttons were completely dead because of CSP (the ⓘ/⚖️ badges on wallet cards, the wallet-management ✎▲▼🗑 buttons, the layout editor, the "record first income" button, the empty-state buttons in Reports, the transaction-count picker) — they were onclick= attributes inside JS-generated HTML, which the browser now blocks. All converted to programmatic binding.' },
      { ar: 'عالي: الحفظ المؤجل (400ms) صار يُفرَّغ فوراً عند pagehide وقبل أي إعادة تحميل (تحديث التطبيق/التحديث القسري) — كانت آخر معاملة مسجلة قبل التحديث مباشرة قد تضيع.', en: 'High: the 400ms debounced save now flushes immediately on pagehide and before any reload (app update / force refresh) — a transaction saved right before an update could previously be lost.' },
      { ar: 'عالي: خيار «احتفظ بالمحلية» عند تعارض Drive كان يدمج سراً بيانات السحابة المرفوضة قبل الرفع — الآن يرفع نسختك المحلية فعلاً كما وعد.', en: 'High: the "keep local" choice in a Drive conflict was secretly merging the rejected cloud data back in before uploading — it now genuinely uploads your local copy as promised.' },
      { ar: 'عالي: مسودة الملاحظات السريعة صارت تدخل في النسخة الاحتياطية (تصدير/استيراد) — كانت تضيع عند تغيير الجهاز.', en: 'High: the Quick Notes draft is now included in the backup (export/import) — it used to be lost when switching devices.' },
      { ar: 'متوسط: «تحديث قسري» بدون إنترنت كان يمسح الكاش ويترك التطبيق ميتاً حتى عودة الاتصال — الآن يرفض بأدب.', en: 'Medium: "force refresh" with no internet used to wipe the cache and leave the app dead until connectivity returned — it now politely refuses.' },
      { ar: 'متوسط: تأكيد «حذف كل البيانات» يوضّح الآن أن الحذف يشمل نسخة Drive وكل الأجهزة المتزامنة.', en: 'Medium: the "delete all data" confirmation now makes clear the wipe also covers the Drive copy and every synced device.' },
      { ar: 'متوسط: صفوف مفتاح المخطط الدائري كانت ~18px فقط كهدف لمس — رُفعت لحجم قابل للنقر.', en: 'Medium: pie-chart legend rows were only ~18px tall as tap targets — raised to a usable size.' },
      { ar: 'متوسط: زر «مزامنة الآن» صار يعرض حالة انشغال ويمنع النقر المزدوج.', en: 'Medium: the "sync now" button now shows a busy state and blocks double-taps.' },
      { ar: 'تحسينات: مقبض السحب للإغلاق صار قابلاً للإمساك فعلياً (كان 36×4px)، التبويبات تفتح من أعلى الصفحة، تعطيل سحب-للتحديث المزعج في وضع PWA، حقل Client ID لن يُفسده التصحيح التلقائي، تصفير أوضاع الربط يثبت بعد «حذف الكل».', en: 'Improvements: the drag-to-close handle is now actually grabbable (was 36×4px), tabs open scrolled to the top, the annoying pull-to-refresh in PWA mode is disabled, the Client ID field is no longer mangled by autocorrect, and resetting link modes now sticks after "delete all".' },
    ],
  },
  {
    version: 'v47.66',
    date: '2026-07-01',
    title: { ar: 'إصلاح زر ＋ والتحليلات', en: 'Fixing the ＋ button and Analytics' },
    items: [
      { ar: 'إصلاح: زر إضافة معاملة (＋) لم يعمل بعد v47.65 — السبب: renderBottomNav() تُعيد بناء الشريط السفلي وتحذف معرّف fabAddTx فلا يجد _bindEvents() العنصر. الحل: تحويل الاستماع للنقر إلى event delegation على عنصر <nav> الثابت.', en: 'Fix: the add-transaction (＋) button stopped working after v47.65 — renderBottomNav() rebuilds the bottom bar and drops the fabAddTx id, so _bindEvents() could no longer find it. Fixed by switching to click delegation on the stable <nav> element.' },
      { ar: 'إصلاح: ألوان فئات المخطط الدائري وأشرطة المحافظ اختفت — السبب: style-src بدون unsafe-inline يحجب قيم style="…" المحسوبة برمجياً (transform:scaleX, background-color) في innerHTML. أُعيد unsafe-inline لـ style-src لأن هذه القيم لا يمكن نقلها لفئات CSS ثابتة.', en: 'Fix: pie-chart category colors and wallet bars disappeared — style-src without unsafe-inline was blocking runtime-computed style="…" values (transform:scaleX, background-color) in innerHTML. unsafe-inline was restored for style-src only, since these values can\'t be expressed as static CSS classes.' },
      { ar: 'أُزيل onclick= من أزرار شريط التنقل المُنشأة ديناميكياً — الآن تُعالج بالكامل عبر event delegation بدون inline handlers.', en: 'Removed onclick= from the dynamically-generated nav-bar buttons — now handled entirely through event delegation with no inline handlers.' },
    ],
  },
  {
    version: 'v47.65',
    date: '2026-07-01',
    title: { ar: 'CSP مكتمل — إزالة unsafe-inline من style-src', en: 'CSP complete — unsafe-inline removed from style-src' },
    items: [
      { ar: 'أمان (مهم جداً): إزالة unsafe-inline من style-src في سياسة CSP — جميع سمات style="…" من HTML (67 سمة) نُقلت إلى قواعد CSS بالمعرّفات والأصناف في style.css. المتصفح يرفض الآن أي نمط مُحقون عبر XSS سواء في الـ script أو الـ style.', en: "Security (important): unsafe-inline removed from the CSP's style-src — all 67 style=\"…\" HTML attributes were moved into ID/class CSS rules in style.css. The browser now refuses any injected style, exactly like it already refuses injected scripts." },
      { ar: 'السكريبت الثالث (معالج الأخطاء) تغيّر هاشه لأن الـ <span style=…> الداخلي داخل سلسلة JS أُبدل بـ class="mhf-err-code" — الهاشات الثلاثة مُحدَّثة في الـ CSP.', en: 'The third inline script (the error handler) got a new hash because its internal <span style=…> was replaced with class="mhf-err-code" — all three hashes are updated in the CSP.' },
      { ar: 'لم يتغيّر أي سلوك مرئي: الفئات والمعرّفات الجديدة تُنتج نفس المظهر السابق.', en: 'No visible behavior changed: the new classes and IDs reproduce the exact same appearance as before.' },
    ],
  },
  {
    version: 'v47.64',
    date: '2026-07-01',
    title: { ar: 'CSP صارم — إزالة unsafe-inline من script-src', en: 'Strict CSP — unsafe-inline removed from script-src' },
    items: [
      { ar: 'أمان (مهم جداً): جميع معالجات الأحداث المضمّنة في HTML (onclick= / onkeydown= / oninput= / onchange=) أُزيلت بالكامل ونُقلت إلى addEventListener في JavaScript (_bindEvents). هذا يُفعّل الـ Content Security Policy كاملاً: script-src لم يعد يحتوي على unsafe-inline، فالمتصفح يرفض الآن أي سكريبت مُحقون (XSS) حتى لو وصل للصفحة.', en: "Security (important): every inline event-handler attribute in HTML (onclick= / onkeydown= / oninput= / onchange=) was removed entirely and moved to addEventListener in JavaScript (_bindEvents). This activates the full Content Security Policy: script-src no longer contains unsafe-inline, so the browser now refuses any injected script (XSS) even if it reaches the page." },
      { ar: 'البديل: السكريبتات الثلاثة الضرورية المضمّنة (منع وميض المظهر، اسم التطبيق، معالج الأخطاء) تعمل عبر SHA-256 هاشات محددة في الـ CSP بدلاً من unsafe-inline العام.', en: 'The three inline scripts that must stay (theme-flash prevention, app name, error handler) run via specific SHA-256 hashes in the CSP instead of a blanket unsafe-inline.' },
      { ar: 'style-src لا يزال يحتوي على unsafe-inline مؤقتاً — أُزيل في v47.65.', en: 'style-src still carries unsafe-inline temporarily — removed in v47.65.' },
    ],
  },
  {
    version: 'v47.63',
    date: '2026-07-01',
    title: { ar: 'إصلاحات أمنية — CSP وحماية رمز Drive', en: 'Security fixes — CSP and Drive token protection' },
    items: [
      { ar: 'أمان (عالي): رمز Drive OAuth لم يعد يُحفظ في localStorage الدائم — انتقل إلى sessionStorage ويختفي تلقائياً عند إغلاق المتصفح، مما يُقلّص نافذة الخطر من "حتى انتهاء الرمز" إلى "انتهاء الجلسة".', en: 'Security (high): the Drive OAuth token is no longer stored in persistent localStorage — it moved to sessionStorage and disappears automatically when the browser closes, shrinking the exposure window from "until the token expires" to "until the session ends".' },
      { ar: 'أمان (عالي): كوكيز Drive أصبحت session cookies بدل كوكيز دائمة — تختفي هي الأخرى عند إغلاق المتصفح.', en: 'Security (high): Drive cookies became session cookies instead of persistent ones — they too disappear when the browser closes.' },
      { ar: 'أمان (متوسط): أُضيف مؤشر Content-Security-Policy يقيّد الموارد الخارجية المسموح بها (روابط السكريبتات، الخطوط، الاتصالات بـ API) حتى لو بقيت معالجات الأحداث المضمّنة بسبب ضرورة التوافق.', en: 'Security (medium): a Content-Security-Policy header now restricts which external resources are allowed (script sources, fonts, API connections), even while inline event handlers still had to remain for compatibility.' },
    ],
  },
  {
    version: 'v47.62',
    date: '2026-07-01',
    title: { ar: 'تدقيق عميق متعدد الزوايا — 15 إصلاحًا', en: 'Deep multi-angle audit — 15 fixes' },
    items: [
      { ar: 'إصلاح (عالي): الفاصلة الأوروبية كفاصل عشري ("1,5" = 1.5 مش ألف وخمسة) — يعني لو كتبت "اشتراك 9,99" يحسبها صح الحين.', en: 'Fix (high): the European comma decimal separator ("1,5" = 1.5, not "one thousand five") — so writing "subscription 9,99" now computes correctly.' },
      { ar: 'إصلاح (عالي): حدّ أقصى 50,000 حرف في الملاحظات السريعة مع إشعار واضح عند الوصول للحدّ — لحماية الأداء من اللصق الزائد.', en: 'Fix (high): a 50,000-character cap on Quick Notes with a clear notice when the limit is hit — protects performance against pasting excessive text.' },
      { ar: 'إصلاح (عالي): شريط إشعار Google Drive يأخذ التركيز (Focus) مباشرة وبشكل صحيح لمستخدمي لوحة المفاتيح، والـ Escape يغلقه.', en: 'Fix (high): the Google Drive banner now correctly takes focus for keyboard users, and Escape closes it.' },
      { ar: 'إصلاح (عالي): زر "تراجع" في تنبيه الحذف صار له وصف واضح لقارئات الشاشة بدل مجرد ايموجي.', en: 'Fix (high): the "undo" button in the delete toast now has a clear screen-reader label instead of just an emoji.' },
      { ar: 'إصلاح (عالي): حقل الملاحظات السريعة صار له تسمية نصية لقارئات الشاشة.', en: 'Fix (high): the Quick Notes field now has a text label for screen readers.' },
      { ar: 'إصلاح (متوسط): ترتيب الحفظ في التحويل بين المحافظ صار: السجل أولًا ثم الأرصدة — لو انقطع الكهرباء بينهما تبقى البيانات سليمة.', en: 'Fix (medium): the save order for wallet transfers is now: ledger first, then balances — if power is lost between the two writes, the data stays consistent.' },
      { ar: 'إصلاح (متوسط): قائمة اختيار المحفظة (Pop-up) صارت تدعم التنقل بالأسهم (↑↓ + Home/End) بالكامل وتعلن الخيار المحدد لقارئات الشاشة.', en: 'Fix (medium): the wallet-picker popup now fully supports arrow-key navigation (↑↓ + Home/End) and announces the selected option to screen readers.' },
      { ar: 'إصلاح (متوسط): في معاينة توزيع الراتب الفرق "الريال الأخير" صار يُوزَّع بنفس الطريقة الحقيقية — لا فرق بين المعاينة والنتيجة.', en: 'Fix (medium): in the income-distribution preview, the "last unit" rounding remainder is now distributed exactly the way the real save does it — the preview now matches the outcome exactly.' },
      { ar: 'إصلاح (متوسط): أوصاف المعاملات ذات الاتجاه المختلط (عربي + إنكليزي) تظهر بالاتجاه الصحيح تلقائيًا.', en: 'Fix (medium): mixed-direction transaction descriptions (Arabic + English) now display in the correct direction automatically.' },
      { ar: 'إصلاح (متوسط): مبلغ الرقم في وصف توزيع الراتب معزول بشكل صحيح فلا ينعكس في السياق العربي.', en: 'Fix (medium): the numeric amount inside the income-distribution description is now correctly isolated so it doesn\'t reverse inside Arabic text.' },
      { ar: 'إصلاح (متوسط): المجموع في شاشة الاشتراكات معزول اتجاهيًا ويقرأ بالشكل الصحيح.', en: 'Fix (medium): the total on the Subscriptions screen is now direction-isolated and reads correctly.' },
      { ar: 'إصلاح (متوسط): شريط الميزانية يعلن حالته ("تجاوز الميزانية / اقتراب / ضمن") لقارئات الشاشة بدل صمت تام.', en: 'Fix (medium): the budget bar now announces its state ("over budget / near limit / within budget") to screen readers instead of staying silent.' },
      { ar: 'إصلاح (منخفض): اقتطاع اسم المحفظة بعدد حروف حقيقي — لا يعبر على وسط رمز Unicode أو emoji.', en: "Fix (low): wallet-name truncation now counts real characters — it no longer cuts through the middle of a Unicode code point or emoji." },
      { ar: 'إصلاح (منخفض): حقل الملاحظات السريعة يحافظ على الاتجاه الصحيح عند تغيير اللغة.', en: 'Fix (low): the Quick Notes field keeps the correct text direction when the language is switched.' },
      { ar: 'إصلاح (منخفض): معاينة توزيع الراتب تطابق النتيجة الحقيقية تمامًا حتى لآخر قرش.', en: 'Fix (low): the income-distribution preview now matches the real result exactly, down to the last cent.' },
    ],
  },
  {
    version: 'v47.61',
    date: '2026-06-30',
    title: { ar: 'تعرّف على المحافظ الافتراضية بأسماء عربية شائعة', en: 'Recognize default wallets by common Arabic names' },
    items: [
      { ar: 'إصلاح: المحافظ الجاهزة بالبرنامج مخزّنة بأسماء إنكليزية ("Cash"، "Core Expenses"...) رغم إن واجهة البرنامج عربية بالكامل — فكانت كتابة اسمها بالعربي بالملاحظات السريعة (مثل "الرئيسية" أو "بالكاش") ما تتعرّف عليها إطلاقًا. صار للمحافظ الجاهزة فقط أسماء عربية بديلة معروفة يتعرّف عليها البرنامج بالإضافة لاسمها الفعلي — المحافظ المخصّصة (اللي غيّرت اسمها بنفسك) تبقى تتعرّف عليها باسمها الحالي فقط زي ما هي.', en: 'Fix: the app\'s built-in wallets are stored under English names ("Cash", "Core Expenses"...) even though the interface is fully Arabic — writing their Arabic name in Quick Notes (like "the main one" or "in cash") wasn\'t recognized at all. The default wallets now also recognize known Arabic aliases in addition to their real name; custom wallets (ones you renamed yourself) are still matched only by their current name, as before.' },
    ],
  },
  {
    version: 'v47.60',
    date: '2026-06-30',
    title: { ar: 'تلطيف حدّ قائمة المحفظة الرئيسية', en: 'Softening the primary-wallet picker border' },
    items: [
      { ar: 'إصلاح: التحسين السابق (v47.58) بالغ في تباين حدّ قائمة المحفظة الرئيسية — صار يبدو لامعًا وغير متناسق مع حدّ محفظة التتبّع الأزرق الأهدأ، خصوصًا بالوضع الليلي. صار للحدّ لون رمادي محايد بين الباهت والساطع، يحافظ على وضوح القائمة بدون أن "يلمع" أو يطغى على القائمة المجاورة.', en: 'Fix: the previous tweak (v47.58) overdid the contrast on the primary-wallet picker border — it looked overly bright and clashed with the calmer blue tracking-wallet border, especially in dark mode. The border is now a neutral gray between dim and bright, keeping the picker clear without "glowing" or overpowering the adjacent picker.' },
    ],
  },
  {
    version: 'v47.59',
    date: '2026-06-30',
    title: { ar: 'تعرّف أذكى على اسم المحفظة بالملاحظات السريعة', en: 'Smarter wallet-name recognition in Quick Notes' },
    items: [
      { ar: 'تحسين: كتابة اسم محفظة بصيغة طبيعية مع حرف جر ملتصق (مثل "بالكاش" أو "بالبنك الأهلي" أو "في الكاش") صار يتعرّف عليها البرنامج ويربط السطر بالمحفظة الصحيحة تلقائيًا، بدل ما تتطلب كتابة اسم المحفظة حرفيًا بدون أي إضافة. التعرّف يبقى مبنيًا على أسماء محافظك الفعلية فقط (مو قائمة كلمات ثابتة).', en: 'Improvement: writing a wallet name in natural phrasing with an attached preposition (like "in cash" or "at Al Ahli Bank") is now recognized and the line is automatically linked to the right wallet, instead of requiring the wallet name to be typed literally with nothing added. Recognition is still based only on your actual wallet names, not a fixed word list.' },
    ],
  },
  {
    version: 'v47.58',
    date: '2026-06-30',
    title: { ar: 'دفعة تباين إضافية لقوائم اختيار المحفظة', en: 'Another contrast pass for the wallet pickers' },
    items: [
      { ar: 'تحسين إضافي: التحسين السابق لقائمة المحفظة الرئيسية لم يكن كافيًا — حدّها كان رماديًا خافتًا. صار الحدّ بلون النص الأساسي (بتباين كامل، بلا أي لون) وأعرض قليلًا، فيظهر كإطار واضح ومحدد بدل خط رمادي باهت.', en: "Further improvement: the previous tweak to the primary-wallet picker wasn't enough — its border was a faint gray. The border is now the main text color (full contrast, no tint) and slightly thicker, reading as a clear, defined frame instead of a dim gray line." },
      { ar: 'تحسين إضافي: حدّ قائمة محفظة التتبّع (المتقطّع والمصمت) صار أعرض أيضًا ليطابق وزن القائمة الرئيسية الجديد.', en: "Further improvement: the tracking-wallet picker's border (both dashed and solid states) is also thicker now, to match the new weight of the primary picker." },
    ],
  },
  {
    version: 'v47.57',
    date: '2026-06-30',
    title: { ar: 'تحسين تباين قوائم اختيار المحفظة الرئيسية والتتبّع', en: 'Improving contrast for the primary and tracking wallet pickers' },
    items: [
      { ar: 'تحسين تصميم: قائمة اختيار المحفظة الرئيسية كانت بنفس درجة لون خلفية النافذة المحيطة تقريبًا، مما جعلها تبدو باهتة وحدودها تكاد لا تُرى — صار لها لون خلفية وحدّ أوضح (بدرجات محايدة لا تتأثر بثيمات الألوان) فتبرز بوضوح عن محيطها.', en: 'Design improvement: the primary-wallet picker was nearly the same shade as the surrounding modal background, making it look washed-out with a barely visible border — it now has a clearer background and border color (neutral tones unaffected by accent themes) so it stands out clearly.' },
      { ar: 'تحسين تصميم: حدّ قائمة محفظة التتبّع (المتقطّع والمصمت) كان رفيعًا بعض الشيء — صار أعرض قليلًا ليعطي القائمتين معًا حضورًا بصريًا متقاربًا وتمييزًا أوضح بين الرئيسية (محايدة) والتتبّع (زرقاء).', en: "Design improvement: the tracking-wallet picker's border (dashed and solid) was a bit thin — it's now slightly thicker so both pickers have a similar visual presence, with a clearer distinction between primary (neutral) and tracking (blue)." },
    ],
  },
  {
    version: 'v47.56',
    date: '2026-06-30',
    title: { ar: 'جولة تحسينات بصرية: تناسق رمز التصنيف وتوازن ألوان الثيم بالإعدادات', en: 'Visual polish pass: category-icon consistency and settings color-swatch balance' },
    items: [
      { ar: 'تناسق: تفاصيل المحفظة كانت تعرض رمز التصنيف عاديًا بلا أي لون، بينما المعاملات والتقارير يعرضانه بشارة لونية صغيرة — صار رمز التصنيف موحّد الشكل في الأماكن الثلاثة.', en: 'Consistency: the wallet-detail screen showed the category icon as plain, uncolored text, while Transactions and Reports showed it as a small colored badge — the category icon now looks the same in all three places.' },
      { ar: 'تحسين تصميم بسيط: صف ألوان الثيم في الإعدادات (7 ألوان) كان يترك اللون السابع معلّقًا لوحده على حافة الصف الثاني — صار يتوسّط الصف بدل ذلك.', en: 'Minor design tweak: the row of 7 accent-color swatches in Settings used to leave the 7th color dangling alone at the edge of the second row — it now centers instead.' },
    ],
  },
  {
    version: 'v47.55',
    date: '2026-06-30',
    title: { ar: 'شبكات أمان للتحديث والتخزين الاحتياطي + تناسق بصري في الملاحظات السريعة وسجل المعاملات', en: 'Update and backup-storage safety nets + visual consistency in Quick Notes and the transaction list' },
    items: [
      { ar: 'إصلاح: زر اختيار المحفظة الرئيسية في الملاحظات السريعة كان مميّزًا بلون ذهبي مختلف عن نظيره بنموذج الإضافة — تحت ثيم «الياقوتية» بالوضع النهاري كان هذا يجعله يتشابه بصريًا مع لون محفظة التتبّع الأزرق. أُزيل التمييز الذهبي وصار يطابق شكل نموذج الإضافة في كل الأوضاع والثيمات.', en: 'Fix: the primary-wallet picker in Quick Notes was styled with a gold accent different from the one in the add-transaction form — under the "Ruby" theme in day mode this made it visually similar to the blue tracking-wallet color. The gold styling was removed so it now matches the add form in every mode and theme.' },
      { ar: 'شبكة أمان جديدة: فحص انحراف نسخة Service Worker عند إقلاع التطبيق — لو اكتشف البرنامج أن النسخة المُحمَّلة فعليًا تختلف عن النسخة المسجَّلة، يستخدم نفس مسار بانر التحديث الموجود (غير الهدّام) بدل تركه صامتًا.', en: 'New safety net: a Service Worker version-drift check at app boot — if the app detects the actually-loaded version differs from the registered one, it uses the existing (non-destructive) update banner path instead of staying silent about it.' },
      { ar: 'شبكة أمان جديدة: تحذير «تعذّر الحفظ» عند امتلاء التخزين الاحتياطي (localStorage) في المتصفحات بلا IndexedDB صار يتكرر كل بضع دقائق بدل مرة واحدة فقط بالجلسة، حتى لا يفوت المستخدم تنبيهًا مهمًا لو استمرت المشكلة.', en: 'New safety net: the "could not save" warning, shown when the localStorage fallback fills up on browsers without IndexedDB, now re-fires every few minutes instead of just once per session, so an important warning isn\'t missed if the problem persists.' },
      { ar: 'تحسينات تصميم متفرقة: توحيد أحجام خطوط كانت مكتوبة بأرقام ثابتة بدل مقياس الخطوط الموحّد للتطبيق، دمج تكرار CSS لمسافات أزرار النوافذ المنبثقة في صنف واحد، تصحيح إيموجي محفظة التتبّع في تفاصيل المحفظة والتقرير النصي، وإضافة شارة لونية صغيرة لرمز التصنيف في سجل المعاملات (بدل رمز عادي بلا لون) لتناسقه مع الشارة الملوّنة بنفس الشكل بالصفحة الرئيسية.', en: 'Assorted design tweaks: unified a few font sizes that were hardcoded instead of following the app\'s shared type scale, merged duplicated modal-button-spacing CSS into one class, fixed the tracking-wallet emoji in the wallet-detail screen and the text report, and added a small colored badge for the category icon in the transaction list (instead of a plain uncolored icon) to match the same badge style on the home screen.' },
    ],
  },
  {
    version: 'v47.54',
    date: '2026-06-30',
    title: { ar: 'إصلاح انعكاس ألوان محفظة التتبّع/الرئيسية + إصلاحات وصولية حرجة', en: 'Fixing swapped tracking/primary wallet colors + critical accessibility fixes' },
    items: [
      { ar: 'إصلاح: في الملاحظات السريعة كانت محفظة التتبّع تظهر أحيانًا بلون ذهبي (لون المحفظة الرئيسية) بدل الأزرق — السبب اجتماع خللين: تمييز القائمة المنبثقة المشتركة للمحفظة المختارة كان ذهبيًا دائمًا بلا استثناء لسياق التتبّع، وتيمة الألوان «الياقوتية» كانت تستخدم درجة زرقاء تتعارض بصريًا مع لون التتبّع. تم إصلاح الاثنين والتحقق بصريًا بكل الأوضاع.', en: 'Fix: in Quick Notes, the tracking wallet sometimes showed gold (the primary-wallet color) instead of blue — caused by two overlapping bugs: the shared popup\'s "selected" highlight was always gold with no exception for the tracking context, and the "Ruby" color theme used a blue shade that visually clashed with the tracking color. Both fixed and verified visually across every mode.' },
      { ar: 'إصلاح حرج: 3 قوائم اختيار محافظ أساسية (في الإضافة، التعديل، والتحويل) لم تكن تفتح أبدًا بلوحة المفاتيح (Enter/Space) — أصبحت تعمل، مع إصلاح خلل مصاحب كان يجعل الزر يفتح ثم يُغلق نفسه فورًا بسبب ازدواج التفعيل.', en: 'Critical fix: 3 core wallet pickers (add, edit, and transfer) never opened with the keyboard (Enter/Space) — now fixed, along with an accompanying bug that made the button open and instantly re-close itself due to duplicate activation.' },
      { ar: 'إصلاح حرج: شارة النسبة ⚖️/ⓘ داخل بطاقة المحفظة (تفتح شاشة تفاصيل المحفظة) كانت غير قابلة للوصول بلوحة المفاتيح إطلاقًا — تم إصلاحها.', en: 'Critical fix: the ⚖️/ⓘ percentage badge on a wallet card (which opens the wallet-detail screen) was not keyboard-reachable at all — fixed.' },
      { ar: 'إصلاحات وصولية: تحسين تباين النص الأزرق الخافت في الوضع الداكن، إضافة مؤشر تركيز واضح لقوائم المحافظ المنبثقة، إعادة التركيز لمكانه الصحيح بعد إغلاق القائمة بدل فقدانه بالصفحة، وربط رسالة تحذير «المبلغ ناقص» بحقل الإدخال لقارئات الشاشة.', en: 'Accessibility fixes: improved contrast for dim blue text in dark mode, added a clear focus indicator to the wallet popups, restored focus to the right place after closing a popup instead of losing it in the page, and linked the "amount missing" warning message to its input field for screen readers.' },
      { ar: 'إصلاح: ألوان أزرار الدخل/المصروف والتحويل وبعض الحدود كانت ثابتة على درجات الوضع الداكن حتى في الوضع الفاتح — صححت لتطابق ثيم كل وضع.', en: "Fix: the income/expense/transfer button colors and some borders were hardcoded to dark-mode shades even in light mode — corrected to follow each mode's theme." },
      { ar: 'تحسينات تصميم بسيطة: حجم أيقونة مزامنة Google Drive في الترويسة كان أصغر من باقي الأيقونات، ووزن خط محفظة التتبّع بالملاحظات السريعة كان غامقًا دائمًا بعكس نظيرتها بنموذج الإضافة.', en: "Minor design tweaks: the Google Drive sync icon in the header was smaller than the other icons, and the tracking-wallet label's font weight in Quick Notes was always bold, unlike its counterpart in the add form." },
    ],
  },
  {
    version: 'v47.53',
    date: '2026-06-30',
    title: { ar: 'إصلاح حرج: إغلاق نموذج التحويل بين المحافظ كان يخرج من التطبيق', en: 'Critical fix: closing the wallet-transfer form was exiting the app' },
    items: [
      { ar: 'إصلاح حرج: الضغط على «إلغاء»/إغلاق بعد فتح «تحويل بين المحافظ» من نموذج الإضافة (أو بدء أول دخل من شاشة الترحيب) كان أحيانًا يُخرج من التطبيق فعليًا بدل إغلاق النافذة فقط — كان السبب تعارضًا داخليًا في إدارة سجل التصفح، وتم إصلاحه.', en: 'Critical fix: tapping "cancel"/close after opening "transfer between wallets" from the add form (or starting the first income from the welcome screen) could actually exit the app instead of just closing the dialog — caused by an internal browser-history bookkeeping conflict, now fixed.' },
      { ar: 'تمييز أوضح لمحفظة التتبّع: قائمتها (في نموذج الإضافة وفي كل سطر بالملاحظات السريعة) صارت بلون أزرق دائمًا — حتى قبل اختيار محفظة — لتتميّز بوضوح عن المحفظة الرئيسية الذهبية فوقها.', en: 'Clearer tracking-wallet distinction: its picker (in the add form and in every Quick Notes line) is now always blue — even before a wallet is chosen — to stand out clearly from the gold primary-wallet picker above it.' },
      { ar: 'ميزة جديدة بالملاحظات السريعة: اكتب اسم محفظتك (الرئيسية أو التتبّع) كآخر كلمة/كلمات بالسطر — مثل «قهوة 15 أوبر» — وسيتعرّف عليها البرنامج تلقائيًا ويحدد المحفظة المناسبة لتلك المعاملة بدل تركها على المحفظة الافتراضية.', en: 'New Quick Notes feature: write your wallet name (primary or tracking) as the trailing word(s) of a line — like "coffee 15 Uber" — and the app now recognizes it automatically and assigns the right wallet to that transaction instead of leaving it on the default wallet.' },
    ],
  },
  {
    version: 'v47.52',
    date: '2026-06-29',
    title: { ar: 'كل قوائم المحافظ صارت قائمة داخلية أنيقة (لا قائمة نظام)', en: 'Every wallet picker is now a clean in-page popup (no native dropdown)' },
    items: [
      { ar: 'تغيير: محفظة التتبّع في نموذج الإضافة + قائمتا كل سطر بالملاحظات (الرئيسية والتتبّع) صارت كلها تفتح <b>قائمة منبثقة داخل الصفحة</b> بنفس شكل منتقي المحفظة الرئيسي — لا قوائم نظام، ومقروءة في كل الثيمات.', en: 'Change: the tracking-wallet picker in the add form, plus both pickers on every Quick Notes line (primary and tracking), now all open an <b>in-page popup</b> matching the main wallet picker\'s look — no native OS dropdowns, and legible in every theme.' },
      { ar: 'محرّك واحد مشترك للقوائم: داكنة بالداكن، تعرض اسم المحفظة ورصيدها، وتُغلق بالنقر خارجها أو Escape.', en: 'One shared popup engine for all of them: dark in dark mode, shows the wallet name and balance, and closes on an outside click or Escape.' },
    ],
  },
  {
    version: 'v47.51',
    date: '2026-06-29',
    title: { ar: 'إصلاح: قوائم المحافظ المنسدلة تطلع فاتحة/غير مقروءة بالوضع الداكن', en: 'Fix: wallet dropdowns rendered light/unreadable in dark mode' },
    items: [
      { ar: 'إصلاح: قوائم اختيار المحفظة (التتبّع بالإضافة + قائمتا كل سطر بالملاحظات) كانت تفتح بخلفية فاتحة/نص غير واضح في الوضع الداكن — أُضيف color-scheme فصارت تتبع ألوان الثيم.', en: 'Fix: the wallet-picker dropdowns (tracking in the add form + both Quick Notes line pickers) opened with a light background / unclear text in dark mode — a color-scheme hint was added so they now follow the theme colors.' },
      { ar: 'تذكير: لو ما ظهرت التغييرات (مثل اختفاء رموز @ من الملاحظات) فالنسخة المخزّنة قديمة — حدّثها من ⚙ الإعدادات ← زر «مسح الكاش/تحديث»، أو أغلق التطبيق تمامًا وافتحه.', en: 'Reminder: if a recent change (like the @ symbols disappearing from Quick Notes) isn\'t showing, your cached copy is out of date — refresh it from ⚙ Settings → "clear cache/update", or fully close and reopen the app.' },
    ],
  },
  {
    version: 'v47.50',
    date: '2026-06-29',
    title: { ar: 'محفظة التتبّع صارت قائمة منسدلة دائمة (لا زر تفعيل) + حذف رموز @ من الملاحظات', en: 'Tracking wallet is now an always-visible picker (no toggle button) + @ symbols removed from Quick Notes' },
    items: [
      { ar: 'تغيير: في نموذج الإضافة، محفظة التتبّع صارت <b>قائمة منسدلة دائمة الظهور</b> (بتصميم أزرق مميّز) بدل زر التفعيل/الصح — تختارها مباشرةً مثل المحفظة الرئيسية، و«بدون تتبّع» هو الخيار الأول.', en: 'Change: in the add form, the tracking wallet is now an <b>always-visible picker</b> (with a distinct blue design) instead of a toggle/checkmark button — you pick it directly, just like the primary wallet, with "no tracking" as the first option.' },
      { ar: 'حذف: أُزيلت رموز @ نهائيًا من الملاحظات السريعة — لا حاجة لكتابة أي رمز.', en: 'Removed: the @ symbols are gone from Quick Notes for good — no symbol needs to be typed anymore.' },
      { ar: 'تناسق: بعد «حوّل لمعاملات»، كل سطر يطلع له قائمتان منسدلتان مثل نموذج الإضافة: <b>👛 المحفظة الرئيسية</b> و<b>🏦 محفظة التتبّع</b> — تختار منهما المحفظتين مباشرةً (وحدة الصرف ووحدة التتبّع).', en: 'Consistency: after "Convert to transactions", every line gets two pickers just like the add form: <b>👛 primary wallet</b> and <b>🏦 tracking wallet</b> — you choose both directly (the spending unit and the tracking unit).' },
    ],
  },
  {
    version: 'v47.49',
    date: '2026-06-29',
    title: { ar: 'نموذج محافظ موحّد: رئيسي + تتبّع في كل مكان (تصحيح تناسق الملاحظات)', en: 'A unified wallet model: primary + tracking everywhere (Quick Notes consistency fix)' },
    items: [
      { ar: 'تصحيح: أُرجعت محافظ التتبّع من منتقي المحفظة الرئيسية — صارت تُعيَّن من قسمها الخاص (تتبّع) كما في نموذج الإضافة، فلا خلط.', en: 'Correction: tracking wallets were removed from the primary-wallet picker again — they\'re now set from their own (tracking) section, matching the add form, so there\'s no mix-up.' },
      { ar: 'تناسق: في معاينة الملاحظات السريعة صار لكل سطر قائمتان ثابتتان مثل نموذج الإضافة: <b>👛 المحفظة الرئيسية</b> (ذهبية) و<b>🏦 محفظة تتبّع</b> اختيارية (زرقاء).', en: 'Consistency: in the Quick Notes preview, every line now has two fixed pickers matching the add form: <b>👛 primary wallet</b> (gold) and an optional <b>🏦 tracking wallet</b> (blue).' },
      { ar: 'تحسين: الصيغة @المحفظة صارت ذكية — اسم محفظة ميزانية يضبط الرئيسية، واسم محفظة تتبّع يضبط التتبّع تلقائيًا، ويمكن الاثنان في سطر واحد (مثال: «@رغبات @كاش قهوة ١٥»). تعمل كعناوين تنطبق على ما تحتها أو داخل السطر.', en: 'Improvement: the @wallet syntax got smarter — a budget wallet name sets the primary wallet, and a tracking wallet name sets the tracking wallet automatically, and both can appear on one line (e.g. "@Wishlist @Cash coffee 15"). They act as headers applying to the lines below, or inline within a single line.' },
      { ar: 'إصلاح: تلميح المعاينة كان يُظهر وسوم <b> كنص؛ صار يُعرض منسّقًا.', en: 'Fix: the preview hint used to show <b> tags as literal text; it now renders formatted.' },
    ],
  },
  {
    version: 'v47.48',
    date: '2026-06-29',
    title: { ar: 'محافظ التتبع صارت أساسية + فرز محافظ الملاحظات قبل التحويل + إصلاح قصّ الأسماء بالوضع البديل', en: 'Tracking wallets promoted to first-class + sort Quick Notes wallets before converting + fixed name truncation in alternate mode' },
    items: [
      { ar: 'إصلاح: أسماء المحافظ (خاصة في الوضع البديل مثل «الاحتياطي المدمج» و«Core Expenses») لم تعد تُقصّ — تلتفّ على سطرين مع محاذاة متناسقة للبطاقات.', en: 'Fix: wallet names (especially in alternate mode, like "Merged Reserve" and "Core Expenses") no longer get truncated — they now wrap onto two lines with consistent card alignment.' },
      { ar: 'جديد: محافظ التتبع (أوبر/كاش/بطاقات) صارت محافظ أساسية قابلة للاختيار في نموذج الإضافة وفي بانر الملاحظات — للمصروف وللدخل. (تبقى غير محتسبة بالإجمالي المتاح للصرف، ولا تدخل في التوزيع التلقائي.)', en: 'New: tracking wallets (Uber/Cash/Cards) are now first-class, selectable wallets in the add form and the Quick Notes banner — for both expenses and income. (They still aren\'t counted in the total available to spend, and don\'t take part in auto-distribution.)' },
      { ar: 'سلوك: الدخل المُسجَّل في محفظة تتبع لا يُوزَّع تلقائيًا — يبقى في محفظته كعدّاد مستقل.', en: 'Behavior: income recorded into a tracking wallet is not auto-distributed — it stays in that wallet as an independent counter.' },
      { ar: 'جديد وأهم: في الملاحظات السريعة تقدر تفرز المحافظ <b>قبل التحويل</b> — اكتب سطر محفظة مثل «@كاش» أو «@اوبر» فينطبق على كل الأسطر تحته حتى السطر التالي، أو ضع «@المحفظة» داخل أي سطر. حلٌّ لمن لديه ٢٠+ محفظة بدل تعديل كل معاملة يدويًا.', en: 'New (and most important): in Quick Notes you can now sort by wallet <b>before converting</b> — write a wallet-header line like "@Cash" or "@Uber" and it applies to every line below it until the next header, or put "@wallet" inline within any line. A real solution for anyone with 20+ wallets, instead of editing every transaction by hand.' },
      { ar: 'تحسين: في معاينة الملاحظات صارت محفظة كل سطر قائمة ذهبية بارزة مع 👛، والتلميحات تشرح الصيغة @المحفظة وتشمل محافظ التتبع.', en: 'Improvement: in the Quick Notes preview, each line\'s wallet is now a prominent gold picker with 👛, and the hints explain the @wallet syntax and now cover tracking wallets too.' },
    ],
  },
  {
    version: 'v47.47',
    date: '2026-06-29',
    title: { ar: 'إصلاح قصّ أسماء المحافظ + توضيح ميزة محفظة كل سطر في الملاحظات', en: 'Fixed wallet-name truncation + clarified the per-line wallet feature in Quick Notes' },
    items: [
      { ar: 'إصلاح: اسم المحفظة في البطاقة كان يُقصّ بشكل نشاز (مثل «...e Expenses» بنقاط على اليسار). الآن يستخدم كامل المساحة المتاحة، والقصّ (عند الضرورة القصوى) يقع في نهايته الطبيعية، وتتّسع كل الأسماء الافتراضية على الشاشات الشائعة.', en: 'Fix: the wallet name on a card was being truncated awkwardly (e.g. "...e Expenses" with dots on the left). It now uses the full available space, and if truncation is ever unavoidable it happens at the natural end of the name — every default wallet name now fits on common screen sizes.' },
      { ar: 'تحسين: في معاينة الملاحظات السريعة صارت محفظة كل سطر بقائمة ذهبية بارزة مع أيقونة 👛 — توضّح أن لكل معاملة محفظتها وتقدر توزّع المعاملات على محافظ مختلفة (كانت الميزة غير ظاهرة).', en: 'Improvement: in the Quick Notes preview, each line\'s wallet is now a prominent gold picker with a 👛 icon, making it clear that every transaction has its own wallet and you can split transactions across different wallets (the feature was previously not visible).' },
      { ar: 'تحسين: نصوص إرشادية أوضح — شرائح المحفظة الافتراضية تُبيّن أنها لكل الأسطر، والمعاينة تشرح كيف تعطي كل معاملة محفظتها.', en: 'Improvement: clearer guidance text — the default wallet chips now show that they apply to all lines, and the preview explains how to give each transaction its own wallet.' },
    ],
  },
  {
    version: 'v47.46',
    date: '2026-06-29',
    title: { ar: 'تحليل عميق (الجولة السادسة): تزامن وأرقام وسلامة الملاحظات السريعة', en: 'Deep audit (round six): sync, numbers, and Quick Notes robustness' },
    items: [
      { ar: 'إصلاح عالٍ: الملاحظات السريعة تتحقق من المحافظ مقابل أحدث تعريف محفوظ عند الحفظ — معاملة لمحفظة حُذفت في تبويب آخر (أثناء فتح النافذة) كانت تُسجَّل ثم تُفقد بصمت عند إعادة التحميل؛ الآن تُحوَّل للمحفظة الافتراضية مع تنبيه.', en: 'High fix: Quick Notes now validates wallets against the freshest saved definitions at commit time — a transaction targeting a wallet that was deleted in another tab (while the sheet was open) used to be recorded and then silently lost on reload; it now falls back to the default wallet with a warning.' },
      { ar: 'إصلاح متوسط: حارس كتابة متقاطع — منع تداخل عمليتي كتابة (إضافة/تعديل/تحويل/حذف/ملاحظات) عبر نقاط await، كان يمكن أن يفسد الأرصدة في توقيت نادر.', en: 'Medium fix: a cross-operation write guard — prevents two writes (add/edit/transfer/delete/quick notes) from interleaving across await points, which in rare timing could corrupt balances.' },
      { ar: 'إصلاح متوسط: اختصار الأرقام في الرسوم (مثل 999,950) كان يعرض «1000K» بدل «1M» — صُحِّحت العتبات وأُضيفت درجة المليار.', en: 'Medium fix: number abbreviation on charts (e.g. 999,950) was showing "1000K" instead of "1M" — the thresholds were corrected and a billion tier was added.' },
      { ar: 'إصلاح متوسط: حدّ أقصى 300 سطر لدفعة الملاحظات السريعة (منع تجميد) + طوابع زمنية متمايزة وغير مستقبلية تحفظ ترتيب الدفعة.', en: 'Medium fix: a 300-line cap on a single Quick Notes batch (prevents a freeze) + distinct, non-future timestamps that preserve the batch order.' },
      { ar: 'إصلاح متوسط: مُعرّفات معاملات الملاحظات السريعة صارت 5 أحرف عشوائية (كبقية التطبيق) لتقليل احتمال التصادم.', en: 'Medium fix: Quick Notes transaction IDs are now 5 random characters (matching the rest of the app) to reduce collision risk.' },
      { ar: 'إصلاح منخفض: checkBalanceDrift يستخدم round2 (كمسار الإصلاح) فلا ينبثق تنبيه انحراف وهمي لا يُصلِح شيئًا.', en: "Low fix: checkBalanceDrift now uses round2 (matching the repair path), so it no longer raises a phantom drift warning that the repair itself wouldn't actually fix." },
      { ar: 'تحسين: إلغاء إطار الرسم المعلّق عند التبديل السريع للتبويبات؛ عزل اتجاهي (bidi) لمبلغ تنبيه الرصيد؛ توحيد اتجاه شارة المقارنة في الرسم؛ تعزيز مسار التحديث القسري.', en: 'Improvements: canceling a pending chart-render frame on rapid tab switching; bidi isolation for the balance-alert amount; unified direction for the comparison badge on the chart; hardened the force-update path.' },
    ],
  },
  {
    version: 'v47.45',
    date: '2026-06-29',
    title: { ar: 'توحيد دلالي لأحجام القيم النقدية (إيقاع بصري أوضح)', en: 'Semantic unification of money-value sizes (a clearer visual rhythm)' },
    items: [
      { ar: 'تحسين: القيمة النقدية صارت تتبع المعنى لا المكان — أربع درجات موحّدة (--money-*) بدل ٦ أحجام مرتجلة (38/19/17/16/15/14).', en: 'Improvement: money values now follow meaning, not location — four unified size tiers (--money-*) instead of 6 ad-hoc sizes (38/19/17/16/15/14).' },
      { ar: 'تغيير بصري: كل القيم الإحصائية الثانوية توحّدت على 16px — أرقام تفاصيل المحفظة (17←16) وأرقام ملخّص الدخل/المصروف/الصافي (15←16) — فصار للعين تدرّج واحد واضح: رصيد رئيسي ← قيمة محفظة ← قيمة إحصائية ← مبلغ معاملة.', en: 'Visual change: every secondary statistic value is unified to 16px — the wallet-detail figures (17→16) and the income/expense/net summary figures (15→16) — giving the eye one clear scale: main balance → wallet value → stat value → transaction amount.' },
    ],
  },
  {
    version: 'v47.44',
    date: '2026-06-29',
    title: { ar: 'توحيد نظام التصميم: سلّم خطوط بمتغيرات + اتساق الحدود والحركات والتباعد', en: 'Design-system unification: a variable font scale + consistent borders, motion, and spacing' },
    items: [
      { ar: 'جديد: سلّم خطوط موحّد بمتغيرات (--fs-*) يغذّي كل أحجام الخط من مصدر واحد بدل القيم المتناثرة (152 موضعًا) — بلا أي تغيير بصري، مع طيّ القيم الكسرية (11.5/12.5px) على أقرب درجة.', en: 'New: a unified font-size scale of CSS variables (--fs-*) feeds every font size from one source instead of 152 scattered hardcoded values — no visual change, with fractional sizes (11.5/12.5px) folded onto the nearest step.' },
      { ar: 'اتساق: توحيد سُمك حدود الأزرار على 1px عبر متغيّر --bd — كانت الأزرار الثانوية/الخطرة 1.5px بينما البقية 1px.', en: 'Consistency: button border thickness unified to 1px via a --bd variable — secondary/danger buttons used to be 1.5px while the rest were 1px.' },
      { ar: 'اتساق: استبدال قيمة الانتقال الثابتة .15s بمتغيّر --dur-fast في 51 موضعًا لتتبع سلّم الحركة الموحّد.', en: 'Consistency: replaced the hardcoded .15s transition value with a --dur-fast variable in 51 places, following the unified motion scale.' },
      { ar: 'اتساق: توحيد حشو أزرار الصفوف على 13px (مطابقًا لأزرار النوافذ)، وتنظيف هوامش بطاقة المحفظة الشاذّة (9px ← 8px).', en: 'Consistency: unified row-button padding to 13px (matching modal buttons), and cleaned up an odd 9px→8px wallet-card margin.' },
    ],
  },
  {
    version: 'v47.43',
    date: '2026-06-29',
    title: { ar: 'تحسين تجربة وتصميم ميزة «الملاحظات السريعة» (تحليل بصري عميق)', en: 'UX and design pass for "Quick Notes" (deep visual review)' },
    items: [
      { ar: 'إصلاح حرج: حقول الملاحظات السريعة (مربع النص وحقول الوصف/المبلغ) كانت تظهر بخلفية بيضاء ونص أسود في الوضع الداكن/الأسود — الآن تتبع ألوان الثيم بالكامل مع حلقة تركيز موحّدة.', en: 'Critical fix: Quick Notes fields (the textarea and the description/amount inputs) showed a white background and black text in dark/black mode — they now fully follow the theme colors with a unified focus ring.' },
      { ar: 'إصلاح عالٍ: شارة «مسودة» على البانر صارت تستخدم زوج ألوان الزر المتباين — كانت غير مقروءة في الوضع الفاتح.', en: 'High fix: the "draft" badge on the banner now uses a proper contrasting button color pair — it was unreadable in light mode.' },
      { ar: 'إصلاح عالٍ: أهداف اللمس لأزرار النوع والحذف في المعاينة وُسّعت إلى 44px (منطقة لمس خفية) لتفادي النقر الخاطئ.', en: 'High fix: the touch targets for the type-toggle and delete buttons in the preview were widened to 44px (an invisible hit area) to avoid mis-taps.' },
      { ar: 'إصلاح عالٍ: زر «سجّل الكل» يتعطّل بصريًا عند عدم وجود سطر صالح، والعدّاد يعرض «الصالح/الإجمالي» دائمًا.', en: 'High fix: the "record all" button now visually disables when there\'s no valid line, and the counter always shows "valid/total".' },
      { ar: 'إصلاح: حذف كل أسطر المعاينة يطوي المعاينة ويعيد التركيز لمربع النص بدل ترك منطقة فارغة محيّرة.', en: 'Fix: deleting every preview line now collapses the preview and returns focus to the textarea instead of leaving a confusing empty area.' },
      { ar: 'إصلاح: كل سطر غير صالح يعرض سبب صريح «أضِف سعرًا» بدل الاعتماد على اللون فقط (وصولية).', en: 'Fix: every invalid line now shows an explicit reason ("add a price") instead of relying on color alone (accessibility).' },
      { ar: 'تحسين وصولية: نقل التركيز للمعاينة بعد التحويل، تسميات ARIA ديناميكية لزر النوع، شرائح المحفظة كمجموعة اختيار (radiogroup)، وتسمية أيقونة الفئة.', en: 'Accessibility improvement: focus moves to the preview after conversion, dynamic ARIA labels on the type-toggle button, wallet chips grouped as a radiogroup, and a label on the category icon.' },
      { ar: 'إصلاح تجاوب: أسماء المحافظ الطويلة لم تعد تتجاوز عرض الشاشة (قصّ ذكي + منتقي مرن)، وأُضيف تكيّف للشاشات الضيقة (≤360px).', en: 'Responsive fix: long wallet names no longer overflow the screen width (smart truncation + a flexible picker), and narrow-screen (≤360px) adaptations were added.' },
      { ar: 'إصلاح RTL: عدّاد المعاينة «٣ / ٤» يُعرض باتجاه صحيح.', en: 'RTL fix: the preview counter ("3 / 4") now displays in the correct direction.' },
      { ar: 'اتساق: توهّج زر الإضافة العائم وأثر زر الأدوات يتبعان لون التطبيق المختار بدل الذهبي الثابت؛ وأزرار بانر التحديث رفعت لـ44px؛ وتوحيد زوايا عناصر الميزة على متغيرات النظام.', en: 'Consistency: the floating add-button glow and the toolbar-button ripple now follow the chosen accent color instead of a hardcoded gold; the update-banner buttons were raised to 44px; and the feature\'s corner radii were unified onto the design-system variables.' },
    ],
  },
  {
    version: 'v47.42',
    date: '2026-06-29',
    title: { ar: 'إصلاح حاسم: بانر الملاحظات السريعة يرجع تحت «الوضع البديل»', en: 'Decisive fix: the Quick Notes banner keeps snapping back under "Alternate Mode"' },
    items: [
      { ar: 'إصلاح: عند من كان ترتيبه المحفوظ (محليًا أو عبر Drive) يضع قسم الملاحظات السريعة في النهاية، صار يُعاد لمكانه تحت «الوضع البديل» تلقائيًا في كل فتح — إصلاح v47.41 السابق كان يعالج فقط حالة غياب القسم لا حالة كونه «عالقًا» في النهاية.', en: 'Fix: for anyone whose saved layout (local or via Drive) placed the Quick Notes section at the very end, it was automatically moved back under "Alternate Mode" on every launch — the earlier v47.41 fix only handled the section being entirely absent, not the case of it being "stuck" at the end.' },
      { ar: 'سلوك: إذا رتّبت أقسام الصفحة الرئيسية يدويًا من محرّر التخطيط، يُحترم ترتيبك ويتوقف إعادة التموضع التلقائي.', en: 'Behavior: if you manually reorder the home-screen sections in the layout editor, your order is now respected and the automatic repositioning stops.' },
    ],
  },
  {
    version: 'v47.41',
    date: '2026-06-29',
    title: { ar: 'إصلاح: بانر «الملاحظات السريعة» ما يظهر للمستخدمين الحاليين', en: 'Fix: the "Quick Notes" banner wasn\'t showing for existing users' },
    items: [
      { ar: 'إصلاح: القسم الجديد (بانر الملاحظات السريعة) كان يُضاف في آخر الصفحة الرئيسية للمستخدمين الذين لديهم ترتيب أقسام محفوظ مسبقًا — فيظهر أسفل كل المحافظ بدل أن يكون تحت «الوضع البديل».', en: 'Fix: the new section (the Quick Notes banner) was being appended to the very end of the home screen for users who already had a saved section order — showing up below every wallet instead of under "Alternate Mode".' },
      { ar: 'تحسين: sanitizeOrder تُدرج أي قسم جديد في موضعه الافتراضي (بعد جاره المناسب) بدل إلحاقه في النهاية دائمًا — يضمن ظهور الأقسام المستقبلية في مكانها الصحيح لكل المستخدمين.', en: 'Improvement: sanitizeOrder now inserts any new section at its intended default position (after the right neighbor) instead of always appending it at the end — ensuring future sections land in the right place for every user.' },
    ],
  },
  {
    version: 'v47.40',
    date: '2026-06-29',
    title: { ar: 'تحسين: محفظة مستقلة لكل سطر في «ملاحظات سريعة ← معاملات»', en: 'Improvement: a separate wallet per line in "Quick Notes → Transactions"' },
    items: [
      { ar: 'جديد: في معاينة الملاحظات السريعة، صار لكل سطر منتقي محفظة خاص — تقدر توجّه بعض المعاملات لمحفظة وبعضها لمحفظة ثانية في نفس الدفعة (مثلاً ٣ معاملات لمحفظة و٣ لأخرى).', en: 'New: in the Quick Notes preview, every line now gets its own wallet picker — you can send some transactions to one wallet and others to a different wallet in the same batch (e.g. 3 to one wallet, 3 to another).' },
      { ar: 'تغيير: شرائح المحفظة بالأعلى صارت «المحفظة الافتراضية» — تُطبَّق على كل سطر عند التحويل، وتقدر تغيّرها لكل سطر بعدها.', en: 'Change: the wallet chips at the top are now the "default wallet" — applied to every line on conversion, and you can still change it per line afterward.' },
      { ar: 'تحسين: صفوف المعاينة أصبحت بسطرين (نوع/وصف/حذف ثم فئة/محفظة/مبلغ) لاستيعاب منتقي المحفظة بوضوح على شاشات الجوال.', en: 'Improvement: preview rows are now two lines (type/description/delete, then category/wallet/amount) to fit the wallet picker clearly on mobile screens.' },
    ],
  },
  {
    version: 'v47.39',
    date: '2026-06-29',
    title: { ar: 'جديد: ملاحظات سريعة ← معاملات (تحويل تلقائي من نص حر)', en: 'New: Quick Notes → Transactions (auto-convert from free text)' },
    items: [
      { ar: 'جديد: بانر «ملاحظات سريعة ← معاملات» في الصفحة الرئيسية (تحت الوضع البديل) — اكتب ملاحظاتك بحرية، سطر لكل معاملة (الوصف وسعره)، والبرنامج يحوّلها معاملات جاهزة.', en: 'New: a "Quick Notes → Transactions" banner on the home screen (under Alternate Mode) — write your notes freely, one line per transaction (description and price), and the app converts them into ready-to-save transactions.' },
      { ar: 'جديد: محرّك تحليل ذكي يقتبس المبلغ والوصف من كل سطر، ويخمّن الفئة تلقائيًا (طعام/مواصلات/فواتير…)، ويكتشف الدخل عبر علامة + أو كلمات مثل «راتب/دخل».', en: 'New: a smart parsing engine extracts the amount and description from each line, auto-guesses the category (food/transport/bills…), and detects income via a + sign or words like "salary/income".' },
      { ar: 'جديد: شاشة معاينة قبل الحفظ — عدّل الوصف أو المبلغ، بدّل النوع (دخل/مصروف)، أو احذف أي سطر، ثم سجّل الكل دفعةً واحدة.', en: 'New: a preview screen before saving — edit the description or amount, toggle the type (income/expense), or delete any line, then save everything in one batch.' },
      { ar: 'جديد: مسوّدة الملاحظات تُحفظ تلقائيًا وتبقى عبر إعادة التشغيل والأجهزة — دوّن طوال اليوم وحوّلها وقت ما يناسبك. شارة على البانر تعرض عدد الأسطر المعلّقة.', en: 'New: the notes draft autosaves and survives restarts and device changes — jot things down all day and convert them whenever suits you. A badge on the banner shows the count of pending lines.' },
      { ar: 'جديد: شريحة اختيار المحفظة المستهدفة، ودعم كامل للأرقام العربية، وتوزيع الدخل تلقائيًا إذا كان مفعّلًا.', en: 'New: a target-wallet selector chip, full support for Arabic-Indic numerals, and automatic income distribution if enabled.' },
      { ar: 'جديد: شريحة شرح للميزة في جولة الترحيب بأول فتح للبرنامج.', en: 'New: an explanatory slide for the feature in the first-run welcome tour.' },
    ],
  },
  {
    version: 'v47.38',
    date: '2026-06-29',
    title: { ar: 'تحليل عميق (الجولة الرابعة): إصلاحات مزامنة واستيراد وأداء من زوايا جديدة', en: 'Deep audit (round four): new-angle sync, import, and performance fixes' },
    items: [
      { ar: 'إصلاح عالٍ: إغلاق نافذة تعارض Drive عبر زر الرجوع/Escape بدون اختيار كان يُجمِّد مؤشر المزامنة على "يزامن" إلى الأبد ويترك نسخة السحابة معلّقة — الآن يُلغى التعارض بأمان ويعود المؤشر لحالة "جاهز" مع إبقاء البيانات المحلية.', en: 'High fix: dismissing the Drive conflict dialog via back/Escape without choosing a side used to freeze the sync indicator on "syncing" forever and leave the cloud snapshot dangling — it now safely cancels the conflict and the indicator returns to "ready" while keeping local data.' },
      { ar: 'إصلاح عالٍ: مزامنة التبويبات — التبويب المستقبِل كان قد يقرأ نسخة IndexedDB قديمة قبل اكتمال كتابة التبويب الآخر (نافذة الـ 400ms)؛ زِيد تأخير القراءة الأولي إلى 600ms ليغطيها.', en: 'High fix: cross-tab sync — the receiving tab could read a stale IndexedDB copy before the other tab finished writing (a 400ms window); the initial read delay was increased to 600ms to cover it.' },
      { ar: 'إصلاح متوسط: مطابقة الاشتراكات المتتبَّعة صارت باتجاه واحد فقط (الوصف يحتوي اسم الاشتراك) مع حد أدنى 3 أحرف — يمنع اسم اشتراك قصير من كبت معاملات غير مرتبطة بالخطأ.', en: 'Medium fix: subscription matching is now one-directional only (the description contains the subscription name) with a 3-character minimum — prevents a short subscription name from wrongly swallowing unrelated transactions.' },
      { ar: 'إصلاح متوسط: applyImport يحد عدد المعاملات المستوردة بـ 100,000 مع تنبيه — يمنع تجميد المتصفح عند ملف ضخم/تالف.', en: 'Medium fix: applyImport now caps imported transactions at 100,000 with a warning — prevents a browser freeze on a huge or corrupted file.' },
      { ar: 'إصلاح متوسط: exportData لا يضع JSON ضخماً في حقل المعاينة (يبقى التنزيل كاملاً) — يمنع تجميد الواجهة عند بيانات كبيرة.', en: "Medium fix: exportData no longer puts a huge JSON blob into the preview field (the downloaded file still contains everything) — prevents the UI from freezing on large datasets." },
      { ar: 'إصلاح متوسط: تحسين أداء قائمة المعاملات — تُبنى خارج DOM في DocumentFragment وتُلحَق دفعةً واحدة بدلاً من reflow لكل صف (حتى 500 صف).', en: 'Medium fix: transaction-list rendering performance improved — built off-DOM in a DocumentFragment and appended in one batch instead of a reflow per row (up to 500 rows).' },
      { ar: 'إصلاح منخفض: buildTxTs وsaveEdit يضعان حداً أدنى للتاريخ عند 2010 — تاريخ خارج النطاق برمجياً لم يعد يُنشئ طابعاً زمنياً يُثبِّت المعاملة أعلى كل القوائم.', en: "Low fix: buildTxTs and saveEdit now floor the date at 2010 — an out-of-range date can no longer create a timestamp that pins a transaction at the top of every list." },
      { ar: 'إصلاح منخفض: detectRecurring يُبطل الكاش عند تغيير اسم/مبلغ اشتراك (وليس عدده فقط).', en: 'Low fix: detectRecurring now invalidates its cache when a subscription\'s name/amount changes (not just its count).' },
      { ar: 'إصلاح منخفض: فلتر الاشتراكات المتتبَّعة يستبعد ذوات المبلغ صفر مبكراً.', en: 'Low fix: the tracked-subscriptions filter now excludes zero-amount subscriptions earlier.' },
      { ar: 'إصلاح منخفض: مقارنة وقت نسخة Drive محصّنة ضد طابع ISO تالف (Date.parse → NaN) لا يُفسد المقارنة.', en: 'Low fix: the Drive-snapshot time comparison is now hardened against a corrupt ISO timestamp (Date.parse → NaN) so it can\'t break the comparison.' },
      { ar: 'إصلاح منخفض: applyImport يطبّق الـ tombstones فوراً على المجموعة المستوردة (لا ينتظر إعادة التحميل).', en: 'Low fix: applyImport now applies tombstones immediately to the freshly-imported set (doesn\'t wait for a reload).' },
    ],
  },
  {
    version: 'v47.37',
    date: '2026-06-26',
    title: { ar: 'تحليل عميق (الجولة الثالثة): 19 إصلاحاً من زوايا تحليلية جديدة', en: 'Deep audit (round three): 19 fixes from new analytical angles' },
    items: [
      { ar: 'إصلاح عالٍ: repeatLastTx لا تختار محفظة crisisOnly (كـ crisis_fund) إذا كانت مخفية في الوضع العادي — كانت تكتب المعاملة إلى محفظة غير مرئية بصمت.', en: "High fix: repeatLastTx no longer picks a crisisOnly wallet (like crisis_fund) if it's hidden in normal mode — it used to silently write the transaction into an invisible wallet." },
      { ar: 'إصلاح عالٍ: undoDelete تحفظ saveConfig (إزالة الـ tombstone) قبل saveTx — يمنع crash بين الحفظين من إعادة إخفاء المعاملة المُستعادة عند إعادة التحميل.', en: 'High fix: undoDelete now saves the config (removing the tombstone) before saveTx — prevents a crash between the two saves from re-hiding the restored transaction on reload.' },
      { ar: 'إصلاح متوسط: saveEdit لا تُبطل _txMutationStamp عند حالات الإرجاع المبكر (معاملة غير موجودة أو مبلغ غير صحيح) — يمنع إبطال كاش غير ضروري.', en: "Medium fix: saveEdit no longer bumps _txMutationStamp on early-return cases (missing transaction or invalid amount) — avoids an unnecessary cache invalidation." },
      { ar: 'إصلاح متوسط: closeModal وcloseAddDrawer لا تسحبان من _focusStack إذا كان الـ overlay مغلقاً أصلاً — يمنع تلف تسلسل التركيز عند استدعائهما على overlay مغلق.', en: "Medium fix: closeModal and closeAddDrawer no longer pop from _focusStack if the overlay was already closed — prevents corrupting the focus-return sequence when called on an already-closed overlay." },
      { ar: 'إصلاح متوسط: انقطاع الإنترنت يُظهر الآن toast للمستخدم بدلاً من تحديث مؤشر Drive الصامت فقط.', en: 'Medium fix: losing internet connectivity now shows a toast to the user instead of only silently updating the Drive indicator.' },
      { ar: 'إصلاح متوسط: renderRecentTx تحترم الآن walletFilter وcategoryFilter وsearchQuery — تبويب المعاملات يعكس الفلتر النشط بدلاً من عرض كل المعاملات دائماً.', en: 'Medium fix: renderRecentTx now respects walletFilter, categoryFilter, and searchQuery — the Transactions tab reflects the active filter instead of always showing every transaction.' },
      { ar: 'إصلاح متوسط: setWalletFilter وclearWalletFilter يُحدِّثان قائمة تبويب المعاملات فور تغيير الفلتر.', en: 'Medium fix: setWalletFilter and clearWalletFilter now refresh the Transactions tab list the instant the filter changes.' },
      { ar: 'إصلاح متوسط: onSearchInput وclearSearch يُحدِّثان تبويب المعاملات عند البحث من تلك الشاشة.', en: 'Medium fix: onSearchInput and clearSearch now refresh the Transactions tab when searching from that screen.' },
      { ar: 'إصلاح متوسط: saveWalletBudget تتحقق من وجود المحفظة — محفظة محذوفة من تبويب آخر أثناء فتح نافذة التفاصيل تُغلق بتنبيه بدلاً من استثناء صامت.', en: 'Medium fix: saveWalletBudget now checks the wallet still exists — a wallet deleted from another tab while the detail dialog is open now closes with a warning instead of a silent exception.' },
      { ar: 'إصلاح متوسط: قائمة تفاصيل المحفظة تُظهر الآن تلميح "X معاملة أقدم" عند تجاوز 50 معاملة.', en: 'Medium fix: the wallet-detail transaction list now shows an "X older transactions" hint once it exceeds 50 entries.' },
      { ar: 'إصلاح متوسط-منخفض: computeRenderSig تشمل currentTab — تحديثات cross-tab لن تتخطى إعادة الرسم بعد تغيير التبويب مع بيانات ثابتة.', en: "Medium-low fix: computeRenderSig now includes currentTab — cross-tab updates no longer skip re-rendering after a tab change with unchanged data." },
      { ar: 'إصلاح متوسط-منخفض: loadState تستخدم round2() بدلاً من Math.round()*100/100 في ثلاثة مواضع — يزيل انجراف IEEE-754 عند استعادة الأرصدة.', en: 'Medium-low fix: loadState now uses round2() instead of Math.round()*100/100 in three places — eliminates IEEE-754 drift when restoring balances.' },
      { ar: 'إصلاح متوسط-منخفض: saveConfig ترجع true/false — المُستدعيات يمكنها الآن الكشف عن فشل الحفظ.', en: 'Medium-low fix: saveConfig now returns true/false — callers can now detect a failed save.' },
      { ar: 'إصلاح متوسط-منخفض: _pruneRecurringDismissals تحد الحجم بـ 200 مدخل — يمنع تجاوز حصة localStorage عندما تطابق جميع الأنماط معاملات حية.', en: 'Medium-low fix: _pruneRecurringDismissals now caps its size at 200 entries — prevents exceeding the localStorage quota when every pattern still matches live transactions.' },
      { ar: 'إصلاح منخفض: _wireGrabber — snap-back يستخدم rAF لضمان تفعيل CSS transition قبل إعادة transform، يمنع الحركة المتقطعة عند touchcancel.', en: 'Low fix: _wireGrabber\'s snap-back now uses requestAnimationFrame to guarantee the CSS transition is active before resetting the transform — prevents jerky motion on touchcancel.' },
      { ar: 'إصلاح منخفض: _nextPushOverlayReplaces = false في try/finally — يُضمن إعادة الضبط حتى لو openDistributionModal رمى استثناءً.', en: '_nextPushOverlayReplaces = false now lives in a try/finally — guarantees the reset even if openDistributionModal throws.' },
      { ar: 'إصلاح منخفض: sanitizeBudgets تحد القيم بـ MAX_AMOUNT وتطبق round2 — تمنع قيم ضخمة من إظهار شريط ميزانية صفري دائماً.', en: 'Low fix: sanitizeBudgets now caps values at MAX_AMOUNT and applies round2 — prevents an absurdly large value from always showing a zeroed-out budget bar.' },
      { ar: 'إصلاح منخفض: نص المجموع في مركز مخطط الدائرة مُقيَّد بحدود الثقب الداخلي — أرقام كبيرة لا تتجاوز الحلقة بعد الآن.', en: 'Low fix: the total text at the center of the pie chart is now bounded within the inner hole — large numbers no longer overflow the ring.' },
      { ar: 'إصلاح منخفض: _heroStatsSig تشمل _txMutationStamp — كاش إحصائيات البطل يبطل دائماً عند أي تعديل (حماية إضافية لأي مسار يستدعيها مباشرةً).', en: '_heroStatsSig now includes _txMutationStamp — the hero-stats cache always invalidates on any edit (extra protection for any path that calls it directly).' },
    ],
  },
  {
    version: 'v47.36',
    date: '2026-06-26',
    title: { ar: 'تحليل عميق (الجولة الثانية): 20 إصلاحاً من زوايا تحليلية جديدة', en: 'Deep audit (round two): 20 fixes from new analytical angles' },
    items: [
      { ar: 'إصلاح عالٍ: _editingDistSource تنشّط عند وجود ضلع واحد مرتبط (>= 1) بدلاً من > 1 — كانت مصادر التوزيع ذات الضلع اليتيم تُفلت من القفل.', en: 'High fix: _editingDistSource now activates with just one linked leg (>= 1) instead of > 1 — a distribution source with a single orphaned leg used to slip past the lock.' },
      { ar: 'إصلاح عالٍ: حذف ضلع توزيع دخل (_distributionLeg) يعطي تنبيهاً بدلاً من حذف المجموعة كاملاً بصمت.', en: 'High fix: deleting an income-distribution leg (_distributionLeg) now gives a warning instead of silently removing the entire group.' },
      { ar: 'إصلاح عالٍ: محرر التوزيع يعمل الآن على نسخة مسودة — إغلاق الإعدادات بدون حفظ لا يُطبق التغييرات على النسب الحية.', en: 'High fix: the distribution editor now works on a draft copy — closing Settings without saving no longer applies the changes to the live percentages.' },
      { ar: 'إصلاح عالٍ: زر اختيار محفظة معاملة التحويل يُقفل بـ tabIndex=-1 وaria-disabled أيضاً (وليس CSS فقط) لمنع الوصول لوحة المفاتيح.', en: "High fix: the wallet picker on a transfer transaction is now also locked with tabIndex=-1 and aria-disabled (not CSS alone), preventing keyboard access." },
      { ar: 'إصلاح عالٍ: saveEdit يطبّق قفل المحفظة برمجياً لمعاملات التحويل بالإضافة للقيد المرئي.', en: 'High fix: saveEdit now enforces the wallet lock programmatically for transfer transactions, in addition to the visual restriction.' },
      { ar: 'إصلاح عالٍ: saveEdit تسمح بتعديل الوصف/التاريخ/النوع لمصادر الدخل الموزعة — كانت تعيد الخطأ لأي حفظ حتى لو المبلغ لم يتغير.', en: "High fix: saveEdit now allows editing the description/date/type of a distributed income source — it used to reject every save even when the amount hadn't changed." },
      { ar: 'إصلاح متوسط: runDistribution تُعيد قيمة منطقية — addTx لا تُظهر "تم التوزيع تلقائياً" إذا لم يكن هناك ما يُوزَّع فعلاً.', en: 'Medium fix: runDistribution now returns a boolean — addTx no longer shows "auto-distributed" when there was actually nothing to distribute.' },
      { ar: 'إصلاح متوسط: pruneTombstones تُستدعى بعد عمليات الحذف الشاملة (wipeAll/clearBalancesAndTx) لمنع تجاوز حصة localStorage.', en: 'Medium fix: pruneTombstones is now called after bulk deletions (wipeAll/clearBalancesAndTx) to prevent exceeding the localStorage quota.' },
      { ar: 'إصلاح متوسط: closeModal للـ editModal يُصفِّر _editingDistSource و_editingTransferLeg ويعيد tabIndex زر المحفظة.', en: 'Medium fix: closeModal on the edit modal now resets _editingDistSource and _editingTransferLeg and restores the wallet button\'s tabIndex.' },
      { ar: 'إصلاح متوسط: deleteFromEdit يستخدم try/finally لضمان إغلاق النافذة حتى لو deleteTx رمى استثناءً.', en: 'Medium fix: deleteFromEdit now uses try/finally to guarantee the dialog closes even if deleteTx throws.' },
      { ar: 'إصلاح متوسط: saveWalletBudget تتحقق من صحة المدخل — حقل غير رقمي يُظهر تنبيهاً بدلاً من حذف الميزانية بصمت.', en: 'Medium fix: saveWalletBudget now validates the input — a non-numeric field shows a warning instead of silently clearing the budget.' },
      { ar: 'إصلاح متوسط: doTransfer يحتسب الرصيد المدمج لـ crisis_fund عند التحقق من الرصيد الكافي في الوضع البديل.', en: 'Medium fix: doTransfer now accounts for crisis_fund\'s merged balance when checking for sufficient funds in Alternate Mode.' },
      { ar: 'إصلاح متوسط: sumExpenses وrenderAnalytics تحترمان walletFilter — بطاقات التحليلات كانت تعرض مجموع كل المحافظ بغض النظر عن الفلتر.', en: 'Medium fix: sumExpenses and renderAnalytics now respect walletFilter — the Analytics cards used to show the total for every wallet regardless of the active filter.' },
      { ar: 'إصلاح متوسط: applyImport تنظّف مراجع trackWallet اليتيمة التي تشير لمحافظ غير موجودة في النسخة المستوردة.', en: 'Medium fix: applyImport now cleans up orphaned trackWallet references pointing at wallets absent from the imported backup.' },
      { ar: 'إصلاح: switchTab للمعاملات يُصفِّر _recentVisibleCount — التبديل بين التبويبات لم يكن يُعيد الصفحة الأولى.', en: 'Fix: switchTab to Transactions now resets _recentVisibleCount — switching tabs used to not return to the first page.' },
      { ar: 'إصلاح: saveSubModal تقارن الأسماء المكررة بدون حساسية الحالة (case-insensitive).', en: 'Fix: saveSubModal now compares duplicate names case-insensitively.' },
      { ar: 'إصلاح: moveWalletDef تعيد ترتيب DISTRIBUTION ليطابق ترتيب المحافظ الجديد.', en: "Fix: moveWalletDef now reorders DISTRIBUTION to match the wallets' new order." },
      { ar: 'إصلاح: renderChart يستخدم Math.max(1, points.length-1) لمنع القسمة على صفر (حارس دفاعي).', en: 'Fix: renderChart now uses Math.max(1, points.length-1) to prevent a division by zero (a defensive guard).' },
    ],
  },
  {
    version: 'v47.35',
    date: '2026-06-25',
    title: { ar: 'تحليل عميق: 24 إصلاحاً لأخطاء المنطق والأداء وتجربة المستخدم', en: 'Deep audit: 24 fixes for logic bugs, performance, and UX' },
    items: [
      { ar: 'إصلاح حرج: driveSyncToCloud كانت تُرسل البيانات بدون walletDefs — المحافظ المخصصة كانت تُفقد على الأجهزة الأخرى عبر Drive.', en: "Critical fix: driveSyncToCloud was sending data without walletDefs — custom wallets were being lost on other devices via Drive." },
      { ar: 'إصلاح حرج: sanitizeWalletDefs تتحقق الآن من صيغة id المحفظة (أحرف آمنة فقط) للحماية من XSS في ملفات النسخ الاحتياطية المُعدَّلة.', en: 'Critical fix: sanitizeWalletDefs now validates the wallet id format (safe characters only), protecting against XSS via a hand-edited backup file.' },
      { ar: 'إصلاح عالٍ: applyWalletDefs تُصحح الآن crisis_fund التي تفتقر لـ crisisOnly في النسخ القديمة بدلاً من تجاهلها.', en: 'High fix: applyWalletDefs now repairs a crisis_fund entry missing the crisisOnly flag in older backups instead of ignoring it.' },
      { ar: 'إصلاح عالٍ: saveBalances لا تُحدِّث dataEdit إذا فشل الحفظ بسبب امتلاء التخزين — يمنع IDB الأحدث من أن يُهزم بنسخة فارغة.', en: 'High fix: saveBalances no longer updates dataEdit if the save fails due to full storage — prevents a newer IndexedDB copy from being beaten by an empty one.' },
      { ar: 'إصلاح عالٍ: applyImport تختم الآن dataEdit بالوقت الحالي بدلاً من وقت النسخة الاحتياطية — يمنع Drive من إعادة دمج البيانات السحابية فوق الاستيراد الجديد.', en: "High fix: applyImport now stamps dataEdit with the current time instead of the backup's own time — prevents Drive from re-merging older cloud data over a fresh import." },
      { ar: 'إصلاح عالٍ: adoptCloudSnapshot تتحقق الآن من حقل id في كل معاملة وتزيل المكررات (كما في applyImport).', en: 'High fix: adoptCloudSnapshot now validates the id field on every transaction and removes duplicates (matching applyImport).' },
      { ar: 'إصلاح عالٍ: toggleCrisis تُصفِّي walletFilter عند الخروج من الوضع البديل إذا كانت تشير لمحفظة crisisOnly مخفية.', en: 'High fix: toggleCrisis now clears walletFilter when leaving Alternate Mode if it was pointing at a now-hidden crisisOnly wallet.' },
      { ar: 'إصلاح عالٍ: controllerchange لا يُعيد تحميل سوى النافذة التي أطلقت التحديث — باقي النوافذ لا تُعاد تلقائياً.', en: 'High fix: controllerchange now reloads only the window that triggered the update — other open windows no longer auto-reload.' },
      { ar: 'إصلاح: reconcileBalances تستخدم round2 بدلاً من Math.round لمنع تراكم أخطاء التقريب.', en: 'Fix: reconcileBalances now uses round2 instead of Math.round to prevent accumulating rounding errors.' },
      { ar: 'إصلاح: loadState تدمج tombstones من IDB مع localStorage (union merge) بدلاً من تجاهل IDB عند وجود أي tombstone محلي.', en: 'Fix: loadState now unions tombstones from IndexedDB with localStorage instead of ignoring IndexedDB whenever any local tombstone exists.' },
      { ar: 'إصلاح: parseAmount ترفض الآن المدخلات ذات النقطتين مثل 1.2.3 بدلاً من تمريرها كـ 1.2.', en: 'Fix: parseAmount now rejects inputs with two decimal points, like "1.2.3", instead of silently passing it through as 1.2.' },
      { ar: 'إصلاح: showUpdateBanner لا تُنشئ timer مزدوجاً إذا استُدعيت مرتين قبل ظهور الـ CSS class.', en: "Fix: showUpdateBanner no longer creates a duplicate timer if called twice before the CSS class appears." },
      { ar: 'إصلاح: dismissUpdate تُصفِّي _pendingWorker لمنع الإشارة لـ SW قديم بعد رفض التحديث.', en: 'Fix: dismissUpdate now clears _pendingWorker to prevent a stale reference to an old service worker after declining an update.' },
      { ar: 'إصلاح: matchesTrackedSub تتجاهل الاشتراكات التي يصبح اسمها فارغاً بعد التطبيع.', en: 'Fix: matchesTrackedSub now ignores subscriptions whose name becomes empty after normalization.' },
      { ar: 'إصلاح: barMax في شبكة المحافظ يحتسب القيمة المدمجة لـ crisis_fund في الوضع البديل.', en: "Fix: barMax in the wallets grid now accounts for crisis_fund's merged value in Alternate Mode." },
      { ar: 'إصلاح: openWalletDetail يطبق round2 على إجمالي الدخل والمصروف.', en: 'Fix: openWalletDetail now applies round2 to the total income and expense figures.' },
      { ar: 'إصلاح: exportMonthlyReport وبuildDailyReviewContent يستخدمان round2 في التجميع.', en: 'Fix: exportMonthlyReport and buildDailyReviewContent now use round2 when aggregating.' },
      { ar: 'إصلاح: _initQuickAmountSync يستخدم parseAmount للمقارنة بدلاً من parseFloat يدوياً.', en: 'Fix: _initQuickAmountSync now uses parseAmount for comparison instead of a hand-rolled parseFloat.' },
      { ar: 'إصلاح: normalizeDigits تحوِّل الإشارة السالبة Unicode (−) إلى ASCII hyphen.', en: 'Fix: normalizeDigits now converts the Unicode minus sign (−) to an ASCII hyphen.' },
      { ar: 'إصلاح: نسبة core في WALLET_DEFS صُحِّحت من 50% إلى 55%.', en: "Fix: the core wallet's percentage in WALLET_DEFS was corrected from 50% to 55%." },
      { ar: 'إصلاح: remainderPct في نافذة التوزيع محسوبة من نفس الأساس لمنع عرض 0%.', en: 'Fix: remainderPct in the distribution dialog is now computed from the same base, preventing a spurious 0% display.' },
      { ar: 'تحسين: زر فلاتر التقارير min-height أصبح 44px (معيار touch target).', en: 'Improvement: the Reports filter buttons now have a 44px min-height (the standard touch-target size).' },
    ],
  },
  {
    version: 'v47.34',
    date: '2026-06-25',
    title: { ar: 'إصلاح: رصيد محفظة Merged Reserve يظهر صفراً في الوضع البديل', en: 'Fix: the Merged Reserve wallet balance showed zero in Alternate Mode' },
    items: [
      { ar: 'إصلاح: بطاقة "الاحتياطي المدمج" في شبكة المحافظ ومنتقي الإضافة كانت تعرض رصيد crisis_fund فقط (0.00) بدلاً من مجموع المحافظ المخفية (wishlist + growth + investments + joy + giving) + رصيد crisis_fund.', en: 'Fix: the "Merged Reserve" card in the wallets grid and the add-form picker was showing only the crisis_fund balance (0.00) instead of the sum of the hidden wallets (wishlist + growth + investments + joy + giving) plus the crisis_fund balance.' },
      { ar: 'تغيير: حُذفت بطاقة "الاحتياطي البديل (مدمج)" الإضافية — بطاقة Merged Reserve الموجودة أصبحت تعرض الرصيد الكامل مباشرةً.', en: 'Change: the extra "Alternate Reserve (merged)" card was removed — the existing Merged Reserve card now shows the full balance directly.' },
    ],
  },
  {
    version: 'v47.33',
    date: '2026-06-25',
    title: { ar: 'بانر التحديث يظهر ويُحدِّث تلقائياً + إشعار بعد التحديث في الإعدادات', en: 'The update banner now auto-applies + a post-update notice in Settings' },
    items: [
      { ar: 'تغيير: بانر "تحديث جديد متاح" يظهر الآن عند اكتشاف نسخة جديدة، ويُطبِّق التحديث تلقائياً بعد 8 ثوانٍ أو فور الضغط على "تحديث الآن".', en: 'Change: the "new update available" banner now appears as soon as a new version is detected, and auto-applies the update after 8 seconds or immediately on tapping "update now".' },
      { ar: 'جديد: بعد إعادة التحميل التلقائية، يظهر إشعار يؤكد النسخة الجديدة مع دعوة لفتح الإعدادات لمعرفة الجديد.', en: "New: after the automatic reload, a toast confirms the new version and invites opening Settings to see what's new." },
      { ar: 'إصلاح: Service Worker لم يعد يستدعي skipWaiting تلقائياً — التحديث الآن يمر عبر البانر بدلاً من إعادة التحميل الصامتة.', en: 'Fix: the Service Worker no longer calls skipWaiting automatically — updates now go through the banner instead of a silent reload.' },
    ],
  },
  {
    version: 'v47.32',
    date: '2026-06-25',
    title: { ar: 'إصلاح: Merged Reserve لا تظهر في قائمة المحافظ عند الإضافة في الوضع البديل', en: 'Fix: Merged Reserve missing from the add-form wallet list in Alternate Mode' },
    items: [
      { ar: 'إصلاح: sanitizeWalletDefs كانت تحذف خاصية crisisOnly عند إعادة تحميل المحافظ المحفوظة — النتيجة: crisis_fund تختفي من قائمة الإضافة في الوضع البديل.', en: 'Fix: sanitizeWalletDefs was dropping the crisisOnly flag when reloading saved wallets — the result: crisis_fund would vanish from the add-form list in Alternate Mode.' },
      { ar: 'إصلاح: applyWalletDefs تضمن الآن وجود crisis_fund دائماً حتى لو ملف الحفظ القديم لا يحتويها.', en: "Fix: applyWalletDefs now guarantees crisis_fund always exists, even if an older save file doesn't contain it." },
      { ar: 'تغيير: اسم المحفظة أصبح "Merged Reserve" بالإنجليزية.', en: 'Change: the wallet is now named "Merged Reserve" in English.' },
    ],
  },
  {
    version: 'v47.31',
    date: '2026-06-25',
    title: { ar: 'الوضع البديل: محفظة "الاحتياطي المدمج" تظهر فقط عند التفعيل', en: 'Alternate Mode: the "Merged Reserve" wallet only appears when enabled' },
    items: [
      { ar: 'جديد: محفظة "الاحتياطي المدمج" (crisis_fund) مخفية في الوضع العادي وتظهر تلقائيًا فقط عند تفعيل الوضع البديل — يمكن تسجيل المعاملات إليها مباشرةً.', en: 'New: the "Merged Reserve" wallet (crisis_fund) is hidden in normal mode and appears automatically only when Alternate Mode is enabled — transactions can be recorded to it directly.' },
      { ar: 'تغيير: حذف محفظة Reserve — نسبة التوزيع الخاصة بها (5%) أُضيفت إلى Core Expenses (أصبحت 55%).', en: "Change: the standalone Reserve wallet was removed — its distribution share (5%) was folded into Core Expenses (now 55%)." },
      { ar: 'تغيير: الوضع البديل يعرض الآن: Core Expenses + الاحتياطي المدمج + محافظ التتبع فقط.', en: 'Change: Alternate Mode now shows only Core Expenses + the Merged Reserve + tracking wallets.' },
    ],
  },
  {
    version: 'v47.30',
    date: '2026-06-25',
    title: { ar: 'الوضع البديل: يُظهر الآن محفظتي الأساسيات والاحتياطي فقط', en: 'Alternate Mode: now shows only the Core and Reserve wallets' },
    items: [
      { ar: 'تغيير: الوضع البديل يُظهر الآن محفظة Core Expenses + محفظة Reserve فقط (بالإضافة لمحافظ التتبع) — بدلاً من إظهار الأساسيات فقط.', en: 'Change: Alternate Mode now shows the Core Expenses wallet plus the Reserve wallet (in addition to tracking wallets) — instead of showing only the essentials wallet.' },
    ],
  },
  {
    version: 'v47.29',
    date: '2026-06-25',
    title: { ar: 'إصلاح حرج: قائمة المحافظ في نموذج الإضافة لا تتغير عند تفعيل الوضع البديل', en: "Critical fix: the add-form wallet list wasn't updating when Alternate Mode was enabled" },
    items: [
      { ar: 'إصلاح (حرج): عند تفعيل الوضع البديل، كانت قائمة اختيار المحفظة في نموذج تسجيل المصروف/الدخل تعرض كل المحافظ بدلاً من المحافظ المتاحة في الوضع البديل فقط — الإصلاح: recomputeSelectableWallets تراعي الآن حالة الوضع البديل وتُستدعى عند تفعيله/إيقافه وعند تحميل التطبيق.', en: "Fix (critical): when enabling Alternate Mode, the wallet picker in the expense/income form was showing every wallet instead of only the ones available in Alternate Mode — fix: recomputeSelectableWallets now accounts for Alternate Mode's state and is called on enabling/disabling it and on app load." },
    ],
  },
  {
    version: 'v47.28',
    date: '2026-06-24',
    title: { ar: 'إصلاح شامل: أمان التوزيع، دقة الأرقام، استقرار التطبيق وتحسينات UX', en: 'Comprehensive fixes: distribution safety, number accuracy, app stability, and UX improvements' },
    items: [
      { ar: 'إصلاح (حرج): توزيع الدخل كان يُودع في المحفظة المصدر مرة ثانية إذا كانت ضمن قائمة النسب — تم استثناؤها تلقائيًا.', en: "Fix (critical): income distribution was depositing back into the source wallet a second time if it appeared in the percentage list — it's now automatically excluded." },
      { ar: 'إصلاح (حرج): كان رصيد المحفظة بعد استيراد النسخة الاحتياطية قد يتضارب مع المعاملات إذا أزال الاستيراد أرجلًا معزولة — تم إضافة إعادة حساب الرصيد (reconcileBalances) فور الاستيراد.', en: 'Fix (critical): a wallet balance after restoring a backup could disagree with the ledger if the import removed orphaned legs — a balance recalculation (reconcileBalances) is now run immediately after import.' },
      { ar: 'إصلاح (عالٍ): Back-Forward Cache — عند استعادة الصفحة من ذاكرة التصفح (bfcache)، قد تتعطل قائمة الشاشات المفتوحة وزر الرجوع. الإصلاح: إعادة مزامنة عمق السجل عند حدث pageshow.', en: 'Fix (high): Back-Forward Cache — restoring the page from the browser\'s bfcache could break the stack of open dialogs and the back button. Fix: history depth is re-synced on the pageshow event.' },
      { ar: 'إصلاح (متوسط): حقل الكشف عن المدفوعات المتكررة كان يُعيد الحساب في كل رسم حتى عند تغيير الفلاتر فقط — الآن يستخدم _txMutationStamp لتجنب إعادة الفحص غير الضرورية.', en: 'Fix (medium): recurring-payment detection used to recompute on every render even when only a filter changed — it now uses _txMutationStamp to skip unnecessary rescans.' },
      { ar: 'إصلاح (متوسط): Service Worker يُفعَّل الآن بعد اكتمال التخزين المؤقت وليس أثناءه — يمنع تقديم ملفات قديمة من ذاكرة ناقصة.', en: 'Fix (medium): the Service Worker now activates only after caching completes, not during it — prevents serving stale files from an incomplete cache.' },
      { ar: 'إصلاح (متوسط): الأرقام التي تحتوي على مسافات كفاصل آلاف ("1 000") كانت تُحلَّل خطأً كـ1 — تم دعم هذا التنسيق في normalizeDigits.', en: 'Fix (medium): numbers using a space as a thousands separator ("1 000") were being parsed incorrectly as 1 — this format is now supported in normalizeDigits.' },
      { ar: 'إصلاح (متوسط): أسماء المحافظ المكررة كانت تُقبل إذا اختلف حجم الحروف (مثال: "حساب" و"حساب") — المقارنة الآن غير حساسة لحجم الحروف.', en: 'Fix (medium): duplicate wallet names were accepted if their letter casing differed — the comparison is now case-insensitive.' },
      { ar: 'إصلاح (متوسط): تحديث رصيد المحفظة المتتبعة يقبل قيمًا سالبة — تم إضافة حماية لرفض القيم السالبة.', en: "Fix (medium): updating a tracking wallet's balance used to accept negative values — a guard now rejects negative input." },
      { ar: 'إصلاح (متوسط): رسالة "ترحيب المستخدم الجديد" تظهر للمستخدم العائد الذي يمسح كل معاملاته رغم وجود أرصدة — الآن تشترط أن تكون جميع الأرصدة صفرًا أيضًا.', en: 'Fix (medium): the "welcome, new user" prompt was appearing for a returning user who cleared all their transactions despite having balances — it now also requires every balance to be zero.' },
      { ar: 'إصلاح (متوسط): إشعارات الـToast كانت تظهر خلف شريط التحديث — رُفع مستوى z-index فوقه.', en: 'Fix (medium): toast notifications were appearing behind the update banner — their z-index was raised above it.' },
      { ar: 'إصلاح (متوسط): تسجيل إشعار بالرصيد كانت تتضاعف نداءات الرسم عند التوزيع التلقائي — تم توحيدها في استدعاء واحد.', en: 'Fix (medium): recording a balance notification was doubling render calls during auto-distribution — consolidated into a single call.' },
      { ar: 'إصلاح (متوسط): عداد _txMutationStamp في confirmDistribution يُحدَّث بعد التحقق من الشروط وليس قبلها.', en: 'Fix (medium): the _txMutationStamp counter in confirmDistribution now updates after the condition checks, not before them.' },
      { ar: 'إصلاح (منخفض): وصف حصة التوزيع يعرض اسم المحفظة الإنجليزي بشكل صحيح داخل نص عربي باستخدام عزل اتجاه النص (bidi isolates).', en: "Fix (low): the distribution-share description now shows an English wallet name correctly inside Arabic text, using bidi text-direction isolates." },
      { ar: 'إصلاح (منخفض): رابط link لمعاملة الدخل يُضاف فقط بعد التحقق من وجود مبلغ للتوزيع.', en: "Fix (low): the link field on the income transaction is now only added after confirming there's actually an amount to distribute." },
      { ar: 'إصلاح (منخفض): نافذة التوزيع الآن لا تعرض المحفظة المصدر كهدف توزيع.', en: 'Fix (low): the distribution dialog no longer lists the source wallet itself as a distribution target.' },
      { ar: 'إصلاح (منخفض): matchesTrackedSub تتجنب القسمة على صفر إذا كان مبلغ الاشتراك 0.', en: 'Fix (low): matchesTrackedSub now avoids a division by zero when a subscription amount is 0.' },
      { ar: 'إصلاح (منخفض): saveDistribution تُعيد تطبيع النسب دائمًا قبل الحفظ.', en: 'Fix (low): saveDistribution now always re-normalizes the percentages before saving.' },
      { ar: 'تحسين: padding سفلي للصفحة معدَّل (96px → 74px) ليتطابق مع ارتفاع شريط التنقل الفعلي.', en: "Improvement: the page's bottom padding was adjusted (96px → 74px) to match the nav bar's actual height." },
    ],
  },
  {
    version: 'v47.27',
    date: '2026-06-24',
    title: { ar: 'تحديث تلقائي: لم يعد التطبيق يطلب موافقة لتطبيق التحديثات', en: 'Automatic updates: the app no longer asks for approval to apply them' },
    items: [
      { ar: 'تغيير: Service Worker الجديد يُفعَّل فورًا عند تثبيته (skipWaiting) دون انتظار موافقة المستخدم — الصفحة تُعاد تحميلها تلقائيًا عند تسلّمه للتحكم.', en: 'Change: a newly installed Service Worker now activates immediately (skipWaiting) without waiting for user approval — the page reloads automatically once it takes control.' },
    ],
  },
  {
    version: 'v47.26',
    date: '2026-06-24',
    title: { ar: 'إصلاح حرج: رصيد المحفظة الأساسية يصبح سالبًا بعد حذف معاملة التوزيع', en: "Critical fix: the core wallet's balance went negative after deleting a distribution transaction" },
    items: [
      { ar: 'إصلاح (حرج): حذف معاملة الدخل المصدر بعد التوزيع (إذا فُقد رابط link عبر مزامنة/دمج) كان يُبقي سحب التوزيع والودائع في السجل دون مصدرها، مما يجعل رصيد المحفظة الأساسية سالبًا. الإصلاح: دالة stripOrphanedDistributionLegs تكتشف هذه الأرجل المعزولة وتحذفها مع عكس أثرها على الرصيد، وتُستدعى عند الحذف والتحميل والاستيراد والدمج وإصلاح الرصيد.', en: "Fix (critical): deleting the source income transaction after distribution (if its link field was lost via sync/merge) left the distribution withdrawal and deposits in the ledger without their source, driving the core wallet's balance negative. Fix: a stripOrphanedDistributionLegs function now detects these orphaned legs and removes them while reversing their balance effect — called on delete, load, import, merge, and balance repair." },
      { ar: 'إصلاح: دمج البيانات (Drive وIDB) الآن يحافظ على خاصية link في المعاملة المحلية إذا كانت النسخة الواردة تفتقر إليها، مما يمنع السباق الزمني (race condition) الذي كان يفصل معاملة الدخل عن مجموعة التوزيع.', en: "Fix: data merges (Drive and IndexedDB) now preserve a local transaction's link field if the incoming copy is missing it, preventing the race condition that could split the income transaction from its distribution group." },
    ],
  },
  {
    version: 'v47.25',
    date: '2026-06-24',
    title: { ar: 'إصلاح حرج: "وزّعه الآن" كان يخرج المستخدم من التطبيق', en: 'Critical fix: "distribute now" was exiting the app' },
    items: [
      { ar: 'إصلاح (حرج): الضغط على "وزّعه الآن" في مودال توزيع الدخل كان يُخرج المستخدم من التطبيق تمامًا إلى صفحة خارجية — بسبب سباق (race condition) بين history.back() من إغلاق السحب وhistory.pushState() من فتح المودال، مما كان يُربك عداد التاريخ ويجعل history.back() التالي يتجاوز حدود التطبيق. الإصلاح: استبدال المعادلة back()+push() بعملية history.replaceState() ذرية تستبدل entry السحب مباشرةً بـ entry المودال.', en: 'Fix (critical): tapping "distribute now" in the income-distribution dialog could exit the app entirely to an outside page — caused by a race between history.back() closing the drawer and history.pushState() opening the dialog, which confused the history counter and made the next history.back() overshoot past the app\'s boundary. Fix: the back()+push() pairing was replaced with a single atomic history.replaceState() call that swaps the drawer entry directly for the dialog entry.' },
    ],
  },
  {
    version: 'v47.24',
    date: '2026-06-24',
    title: { ar: 'إصلاح 4 أخطاء: المراجعة اليومية، شارة المحفظة، حقل الرصيد، المعاملات المتكررة', en: 'Fixed 4 bugs: daily review, wallet badge, balance field, recurring transactions' },
    items: [
      { ar: 'إصلاح (متوسط): المراجعة اليومية كانت تعرض "صرفت 0.00 على 0 معاملة" عند تسجيل دخل فقط دون مصروفات — صارت الآن تعرض "لم تُسجَّل مصروفات · دخل X" بشكل صحيح.', en: 'Fix (medium): the daily review showed "you spent 0.00 on 0 transactions" when only income was recorded with no expenses — it now correctly shows "no expenses recorded · income X".' },
      { ar: 'إصلاح (خفيف-متوسط): شارة نسبة محفظة التتبع كانت تعرض نسبة سالبة عند وجود رصيد سالب — صارت الآن تُعرض صفراً كحد أدنى.', en: 'Fix (low-medium): the tracking-wallet percentage badge could show a negative percentage when the balance was negative — it now floors at zero.' },
      { ar: 'إصلاح (خفيف): حقل "الرصيد الجديد" في تفاصيل محفظة التتبع كان يعرض أرقاماً غير مُنسَّقة (كـ 1.1 بدل 1.10) — صار يعرض دائماً بمنزلتين عشريتين.', en: 'Fix (low): the "new balance" field in the tracking-wallet detail view showed unformatted numbers (like 1.1 instead of 1.10) — it now always shows two decimal places.' },
      { ar: 'إصلاح (خفيف): كشف المعاملات المتكررة كان يستخدم وصف أول معاملة بدل الأحدث — صار يستخدم الوصف الأحدث زمنياً.', en: "Fix (low): recurring-transaction detection was using the first transaction's description instead of the most recent one — it now uses the chronologically latest description." },
    ],
  },
  {
    version: 'v47.23',
    date: '2026-06-22',
    title: { ar: 'تحسين إمكانية الوصول: إعلان الأخطاء لقارئ الشاشة', en: 'Accessibility improvement: announcing errors to the screen reader' },
    items: [
      { ar: 'إصلاح: تنبيهات الأخطاء والتحذيرات الحرجة (فشل الحفظ/الاستيراد) صارت تُعلَن لقارئ الشاشة فوراً (assertive) بدل أن تنتظر، بينما تبقى رسائل التأكيد العادية مهذّبة (polite) حتى لا تقاطع المستخدم.', en: 'Fix: critical error/warning toasts (failed save/import) are now announced to the screen reader immediately (assertive) instead of waiting, while ordinary confirmation messages stay polite so they don\'t interrupt the user.' },
    ],
  },
  {
    version: 'v47.22',
    date: '2026-06-22',
    title: { ar: 'جولة التعريف: شريحة تخصيص + إصلاح ترجمة', en: 'Onboarding tour: a customization slide + a translation fix' },
    items: [
      { ar: 'إضافة شريحة جديدة لجولة التعريف الترحيبية تعرّف بميزات التخصيص التي لم تكن مذكورة: تبديل اللغة (عربي/إنجليزي)، المظهر (فاتح/داكن/أسود/تلقائي)، لون التطبيق، والمراجعة اليومية.', en: 'Added a new slide to the welcome tour covering previously-unmentioned customization features: language toggle (Arabic/English), appearance (light/dark/black/auto), accent color, and the daily review.' },
      { ar: 'إصلاح جذري: نقاط القوائم في جولة التعريف (وتلميح تعارض مزامنة Drive) كانت تبقى بالعربية حتى عند اختيار الإنجليزية — صارت الآن تُترجم بشكل صحيح في كلتا اللغتين.', en: 'Root-cause fix: bullet points in the welcome tour (and the Drive sync-conflict hint) stayed in Arabic even in English mode — they now translate correctly in both languages.' },
    ],
  },
  {
    version: 'v47.21',
    date: '2026-06-22',
    title: { ar: 'تحسين داخلي: فحص الأنواع (type-checking)', en: 'Internal improvement: type-checking' },
    items: [
      { ar: 'إضافة فحص أنواع آلي (TypeScript بوضع الفحص فقط، بدون أي build) يكتشف الأخطاء البرمجية وقت الكتابة — مع توثيق أنواع الدوال المالية الحرجة. كما تم تشديد بضعة مواضع كانت تعتمد على التحويل الضمني للأنواع لتصير صريحة (سلوك مطابق تماماً، أمتن مستقبلاً).', en: "Added automatic type-checking (TypeScript in check-only mode, no build step) that catches coding mistakes at write-time — with the critical financial functions' types documented. A few spots that relied on implicit type coercion were also tightened to be explicit (identical behavior, more robust going forward)." },
    ],
  },
  {
    version: 'v47.20',
    date: '2026-06-22',
    title: { ar: 'تحسين داخلي: تنظيم كود الرسوم البيانية', en: 'Internal improvement: organizing the charting code' },
    items: [
      { ar: 'فصل كود الرسوم البيانية (المخطط الدائري للفئات ومخطط الرصيد الخطي) إلى ملف مستقل (app.charts.js) لتقليص حجم الملف الرئيسي للواجهة وتسهيل صيانته — بدون أي تغيير في السلوك.', en: 'Split the charting code (the category pie chart and the balance line chart) into its own file (app.charts.js) to shrink the main UI file and make it easier to maintain — no behavior change.' },
    ],
  },
  {
    version: 'v47.19',
    date: '2026-06-22',
    title: { ar: 'تحسينات داخلية: اختبارات آلية وتنظيم الكود', en: 'Internal improvements: automated tests and code organization' },
    items: [
      { ar: 'إضافة مجموعة اختبارات آلية (وحدة + تكامل) تُشغَّل بأمر واحد للتحقق من صحة الحسابات المالية وتجربة العربي/الإنجليزي تلقائياً قبل أي تحديث — بدون أي تغيير على طريقة عمل التطبيق نفسه.', en: "Added an automated test suite (unit + integration), run with a single command, to automatically verify the money math and the Arabic/English experience before any update — no change to how the app itself behaves." },
      { ar: 'تقسيم ميزة المزامنة مع Google Drive إلى ملف مستقل (app.drive.js) لتقليص حجم الملف الرئيسي وتسهيل صيانته — بدون أي تغيير في السلوك.', en: 'Split the Google Drive sync feature into its own file (app.drive.js) to shrink the main file and make it easier to maintain — no behavior change.' },
    ],
  },
  {
    version: 'v47.18',
    date: '2026-06-22',
    title: { ar: 'تدقيق جديد: انعكاس التخطيط بين العربي والإنجليزي', en: 'New audit: layout mirroring between Arabic and English' },
    items: [
      { ar: 'إصلاح: في الوضع الإنجليزي (LTR)، كان مبلغ البطاقة الرئيسية ("0.00") وأرصدة المحافظ تبقى محاذاةً لليمين كأنها منفصلة عن باقي الصفحة المحاذاة لليسار — صارت الآن تُحاذى لليسار بشكل متناسق.', en: 'Fix: in English mode (LTR), the hero-card amount ("0.00") and wallet balances stayed right-aligned as if disconnected from the rest of the left-aligned page — they now align left consistently.' },
      { ar: 'إصلاح: أشرطة تقدّم الميزانية في كروت المحافظ كانت تمتلئ من اليمين لليسار حتى في الوضع الإنجليزي — صارت تمتلئ من اليسار لليمين كما هو المتعارف عليه في الإنجليزية.', en: 'Fix: budget progress bars on wallet cards were filling right-to-left even in English mode — they now fill left-to-right, as expected in English.' },
      { ar: 'إصلاح: خط الفاصل المتلاشي بعد عناوين الأقسام (التقارير/التحليلات…) كان اتجاه تلاشيه معكوساً في الوضع الإنجليزي — صار يتلاشى بالاتجاه الصحيح في كلتا اللغتين.', en: 'Fix: the fading divider line after section titles (Reports/Analytics…) faded in the reversed direction in English mode — it now fades correctly in both languages.' },
      { ar: 'إصلاح: بطاقة الاشتراك التي يتجاوز يوم تحصيلها عدد أيام الشهر الحالي (مثل اليوم 31 في شهر من 30 يوماً) صارت تُوضّح اليوم الفعلي لهذا الشهر بدلاً من إظهار يوم لا يقع فيه.', en: "Fix: a subscription card whose billing day exceeds the current month's day count (like day 31 in a 30-day month) now clarifies the actual day for this month instead of showing a day that doesn't exist in it." },
    ],
  },
  {
    version: 'v47.17',
    date: '2026-06-22',
    title: { ar: 'تدقيق شامل جديد: تجربة عربي/إنجليزي وتطابق الهوية', en: 'A new comprehensive audit: Arabic/English experience and brand consistency' },
    items: [
      { ar: 'ترجمة عشرات النصوص المتبقية التي كانت بالعربي فقط حتى مع اختيار الإنجليزية: نافذة "المراجعة اليومية" بالكامل، نص التقرير الشهري القابل للمشاركة، مؤشر وتعارض مزامنة Drive، أسماء ألوان التطبيق (الإعدادات ← المظهر)، بطاقات الاشتراكات والمعاملات المتكررة، وأزرار "عرض المزيد".', en: 'Translated dozens of remaining strings that stayed Arabic-only even in English mode: the entire "Daily Review" dialog, the shareable monthly report text, the Drive sync indicator and conflict dialog, accent-color names (Settings → Appearance), subscription and recurring-transaction cards, and "show more" buttons.' },
      { ar: 'إصلاح: تلميح زر تبديل المظهر (الوضع الفاتح/الداكن) كان يظهر بالعربي دائماً بغض النظر عن اللغة المختارة.', en: "Fix: the appearance-toggle button's tooltip (light/dark mode) always showed Arabic regardless of the chosen language." },
      { ar: 'إصلاح: تنبيه "تعذّر حفظ البيانات" الحرج (عند امتلاء التخزين) لم يكن مُترجماً.', en: 'Fix: the critical "could not save data" warning (on full storage) was untranslated.' },
      { ar: 'إصلاح جوهري: التطبيق المثبَّت (PWA) كان يحمل اسماً واتجاهاً عربياً (RTL) ثابتاً في بياناته الوصفية بغض النظر عن اللغة المختارة — صار الآن يتبع اللغة الحالية فوراً عند تبديلها، بما يشمل اسم الأيقونة على الشاشة الرئيسية.', en: 'Root-cause fix: the installed PWA carried a hardcoded Arabic name and RTL direction in its metadata regardless of the chosen language — it now follows the current language immediately when switched, including the home-screen icon name.' },
      { ar: 'إصلاح: اسم ملف تقرير الشهر المُنزَّل كان بالعربي دائماً حتى عند مشاركة تقرير بالإنجليزية.', en: 'Fix: the downloaded monthly-report filename was always Arabic, even when sharing a report in English.' },
      { ar: 'توحيد شكل علامة النسبة بالكروت المدمجة (الوضع البديل) مع بقية التطبيق.', en: "Unified the percentage badge's look on merged cards (Alternate Mode) with the rest of the app." },
    ],
  },
  {
    version: 'v47.16',
    date: '2026-06-21',
    title: { ar: 'ترجمة كل رسائل التنبيهات وصناديق التأكيد', en: 'Translated every toast message and confirmation dialog' },
    items: [
      { ar: 'استكمال الترجمة إلى الإنجليزية لكل رسائل التنبيه السريعة (toast) في التطبيق — أكثر من 120 رسالة عبر إضافة/تعديل المعاملات، التحويل، المحافظ، الاشتراكات، التعرّف الصوتي، Google Drive، الاستيراد/التصدير، وإصلاح الأرصدة.', en: 'Completed the English translation of every toast message in the app — over 120 messages across adding/editing transactions, transfers, wallets, subscriptions, voice recognition, Google Drive, import/export, and balance repair.' },
      { ar: 'ترجمة كل صناديق تأكيد الحذف/التصفير (confirm) ونوافذ كتابة كلمة التأكيد (prompt) — بما فيها كلمتا التأكيد المكتوبتان يدوياً ("تصفير"/"حذف") واللتان أصبحتا "RESET"/"DELETE" عند اختيار الإنجليزية.', en: 'Translated every delete/reset confirmation dialog, including the typed-word confirmation prompts — the manually-typed confirmation words ("reset"/"delete") now become "RESET"/"DELETE" in English mode.' },
      { ar: 'ترجمة نص أزرار الحفظ أثناء التنفيذ ("جارٍ الحفظ..."، "جارٍ التنفيذ...") في نماذج المعاملة والتحويل.', en: 'Translated the in-progress save-button text ("Saving...", "Working...") in the transaction and transfer forms.' },
    ],
  },
  {
    version: 'v47.15',
    date: '2026-06-21',
    title: { ar: 'إصلاح تزامن الترجمة عند تبديل اللغة', en: 'Fixed translation sync when switching languages' },
    items: [
      { ar: 'إصلاح: لوحات الإعدادات المفتوحة (الترتيب، تعريف المحافظ، توزيع الدخل، حالة Google Drive، شبكة الفئات) كانت تبقى بلغتها القديمة عند تبديل اللغة من داخل الإعدادات، وصارت الآن تتحدّث فوراً.', en: 'Fix: open Settings panels (layout, wallet definitions, income distribution, Google Drive status, category grid) used to stay in their old language when switching languages from inside Settings — they now refresh instantly.' },
      { ar: 'إصلاح: تبويبات محرر الترتيب وعناوين الأقسام داخله كانت بالعربي دائماً حتى مع اختيار الإنجليزية — تُرجمت بالكامل.', en: "Fix: the layout editor's tabs and section headings inside it always stayed Arabic even in English mode — fully translated now." },
      { ar: 'إصلاح: أسماء الفئات (طعام، مواصلات، تسوق...) كانت لا تُترجم عند اختيار الإنجليزية — أُضيفت ترجمتها في كل مكان تظهر فيه (شبكة الإضافة والتعديل، قوائم المعاملات).', en: 'Fix: category names (food, transport, shopping...) weren\'t translated in English mode — translations were added everywhere they appear (the add/edit grids, transaction lists).' },
      { ar: 'إصلاح جوهري: تنسيق التاريخ والوقت واسم اليوم/الشهر كان يستخدم التقويم العربي دائماً بغض النظر عن اللغة المختارة — صار يتبع اللغة الحالية في كل قوائم المعاملات والتقارير.', en: "Root-cause fix: date/time formatting and day/month names always used the Arabic locale regardless of the chosen language — they now follow the current language throughout every transaction list and report." },
      { ar: 'ترجمة بطاقات "تحليلات هذا الشهر" (مصروف الشهر، المقارنة بالشهر الماضي، المتوقع نهاية الشهر) إلى الإنجليزية.', en: 'Translated the "this month\'s analytics" cards (month spending, comparison to last month, projected month-end total) into English.' },
      { ar: 'ترجمة رسائل الحالات الفارغة، تسميات الفلاتر، وعناوين الوصول (aria-label) المتبقية في قوائم المعاملات والاشتراكات والتوزيع.', en: 'Translated the remaining empty-state messages, filter labels, and aria-labels in the transaction, subscription, and distribution lists.' },
    ],
  },
  {
    version: 'v47.14',
    date: '2026-06-21',
    title: { ar: 'إصلاح تعارض مزامنة Drive + تحسينات لمسات وإتاحة', en: 'Fixed Drive sync conflicts + touch and accessibility polish' },
    items: [
      { ar: 'إصلاح مهم: عند اتصال جهازين بـ Google Drive في نفس الوقت، صار التطبيق يتأكد من عدم وجود تحديث أحدث على السحابة قبل كل رفع تلقائي للبيانات ويدمجه بدل الكتابة فوقه — يمنع فقدان معاملات صامت كان ممكناً يحصل بين جهازين متصلين معاً.', en: 'Important fix: when two devices are connected to Google Drive at the same time, the app now checks for a newer cloud update before every automatic upload and merges it instead of overwriting it — prevents the silent transaction loss that could otherwise happen between two simultaneously connected devices.' },
      { ar: 'إصلاح: مقبض سحب نافذة الإضافة (لإغلاقها بالسحب لأسفل) كان معطّلاً في بعض الحالات.', en: 'Fix: the add-drawer\'s drag handle (for swipe-down closing) was disabled in some cases.' },
      { ar: 'تكبير مساحة اللمس لأزرار نوع المعاملة وتبويبات قائمة المعاملات (المساحة المرئية لم تتغيّر، فقط سهولة الضغط عليها).', en: "Enlarged the tap area for the transaction-type buttons and the transaction-list tabs (the visible size is unchanged, just easier to hit)." },
      { ar: 'تحسين تباين أزرار إعادة الترتيب المعطّلة لتكون أوضح للقراءة.', en: 'Improved the contrast of disabled reorder buttons for better readability.' },
      { ar: 'تأمين عناصر التحكم في النص داخل التطبيق (وصف المعاملة في القوائم) ضد رموز اتجاه نص خبيثة قد تُربك قارئ الشاشة.', en: 'Hardened in-app text controls (transaction descriptions in lists) against malicious text-direction characters that could confuse a screen reader.' },
      { ar: 'تأمين استيراد البيانات واستلام نسخ Google Drive ضد قيم تالفة أو غير صالحة في قوائم المعاملات المحذوفة والمتجاهَلة.', en: 'Hardened data import and Google Drive snapshot ingestion against corrupt or invalid values in the deleted/ignored transaction lists.' },
      { ar: 'إضافة "احتواء التمرير الزائد" لقوائم المحافظ وتفاصيل المعاملات حتى لا ينزلق الصفحة كلها عند الوصول لنهاية قائمة داخلية.', en: 'Added scroll containment to wallet lists and transaction details, so the whole page no longer scrolls when an inner list reaches its end.' },
      { ar: 'توحيد أيقونة عنوان نافذة الإعدادات مع بقية النوافذ، وضبط زر "تم" في لوحة المفاتيح ليناسب كل حقل رقمي وحقل البحث.', en: 'Unified the Settings dialog title icon with the other dialogs, and set the keyboard\'s "done" button to fit every numeric field and the search field.' },
    ],
  },
  {
    version: 'v47.13',
    date: '2026-06-21',
    title: { ar: 'استكمال ترجمة كل النوافذ المنبثقة', en: 'Completed the translation of every dialog' },
    items: [
      { ar: 'استكمال ترجمة كل النوافذ المنبثقة المتبقية إلى الإنجليزية: تعديل المعاملة، التحويل، تفاصيل المحفظة، توزيع الدخل، الترحيب بالتطبيق، المراجعة اليومية، تعارض المزامنة، الاشتراكات، تعريف المحفظة، وسجل التحديثات.', en: 'Completed the English translation of every remaining dialog: edit transaction, transfer, wallet detail, income distribution, welcome tour, daily review, sync conflict, subscriptions, wallet definition, and the changelog.' },
      { ar: 'استكمال ترجمة الإعدادات بالكامل: الترتيب، إدارة المحافظ والتوزيع، البيانات (تصدير/استيراد)، Google Drive، الصيانة، والحذف وإعادة الضبط.', en: 'Completed the full translation of Settings: layout, wallet and distribution management, data (export/import), Google Drive, maintenance, and delete/reset.' },
      { ar: 'إصلاح بضع حالات كانت فيها عناصر تُحدَّث ديناميكياً (مثل رقم الإصدار ومبلغ التوزيع) تُكتب فوقها الترجمة أو العكس.', en: 'Fixed a few cases where dynamically-updated elements (like the version number and the distribution amount) had the translation overwrite them or vice versa.' },
    ],
  },
  {
    version: 'v47.12',
    date: '2026-06-21',
    title: { ar: 'لون مستقل لليل والنهار + استكمال الترجمة', en: 'A separate accent for day and night + more translation' },
    items: [
      { ar: 'جديد: صار لون التطبيق مستقلاً لكل وضع — اختر لوناً للنهاري وآخر لليلي/المطفي، والتبديل بين الأوضاع يستعيد لون كل وضع تلقائياً.', en: "New: the accent color is now independent per mode — choose one color for day and another for night/black, and switching modes restores each mode's own color automatically." },
      { ar: 'أُعيدت تسمية وضعي "فاتح/داكن" إلى "نهاري/ليلي" في الإعدادات.', en: 'Renamed the "light/dark" modes to "day/night" in Settings.' },
      { ar: 'استكمال ترجمة نافذة "إضافة معاملة" إلى الإنجليزية.', en: 'Completed the English translation of the "add transaction" dialog.' },
    ],
  },
  {
    version: 'v47.11',
    date: '2026-06-21',
    title: { ar: 'لغة إنجليزية + تحكّم أدق بوضع الليل', en: 'English language support + finer control over night mode' },
    items: [
      { ar: 'جديد: دعم اللغة الإنجليزية — بدّلها من الإعدادات ← الترتيب ← اللغة، ويتحوّل اتجاه الواجهة تلقائياً (يمين↔يسار) مع اللغة. يُحفظ الاختيار ويُزامَن بين التبويبات ويُحفظ في النسخة الاحتياطية. (الترجمة تشمل الشاشات الرئيسية الآن وتتوسّع تباعاً لبقية النوافذ.)', en: 'New: English language support — switch it from Settings → Layout → Language, and the interface direction (right↔left) switches automatically with it. Your choice is saved, synced across tabs, and included in backups. (Translation covers the main screens for now and will expand to the rest over time.)' },
      { ar: 'أُعيدت تسمية وضع "أسود" إلى "مطفي".', en: 'Renamed the "black" mode to "matte black".' },
      { ar: 'صار التطبيق يتذكّر نمط الليل المفضّل لك (داكن أو مطفي): عند الضغط على زر تبديل المظهر، أو عند التبديل التلقائي حسب نظام جهازك، يذهب إلى النمط الذي اخترته آخر مرة بدل الداكن العادي دائماً.', en: 'The app now remembers your preferred night variant (dark or matte black): tapping the appearance toggle, or auto-switching with your device\'s system setting, now goes to whichever variant you last chose instead of always defaulting to plain dark.' },
    ],
  },
  {
    version: 'v47.10',
    date: '2026-06-21',
    title: { ar: 'وضع أسود مطفي + لون بنّي', en: 'A matte black mode + a brown accent color' },
    items: [
      { ar: 'جديد: وضع "أسود" مطفي للّيل — خيار رابع بجانب فاتح/داكن/تلقائي في الإعدادات ← الترتيب ← المظهر. أسود محايد عميق مريح للعين وموفّر للطاقة على شاشات OLED.', en: 'New: a matte-black night mode — a fourth option alongside light/dark/auto in Settings → Layout → Appearance. A deep, neutral black that\'s easy on the eyes and power-efficient on OLED screens.' },
      { ar: 'جديد: لون "بنّي" أُضيف إلى ألوان التطبيق — متاح في الوضعين الفاتح والداكن (والأسود) بدرجات مضبوطة على معايير التباين.', en: 'New: a "brown" accent color was added — available in light, dark, and black modes, with shades tuned to contrast standards.' },
      { ar: 'كل ألوان التطبيق السبعة تعمل فوق الوضع الأسود الجديد، وتُحفظ وتُزامَن وتُستعاد كالمعتاد.', en: 'All seven accent colors now work on top of the new black mode, and are saved, synced, and restored as usual.' },
    ],
  },
  {
    version: 'v47.9',
    date: '2026-06-21',
    title: { ar: 'ألوان للتطبيق + لمسات بصرية أدق', en: 'App accent colors + finer visual polish' },
    items: [
      { ar: 'جديد: اختر لون التطبيق من الإعدادات ← الترتيب ← المظهر — ٦ ألوان متناغمة (ذهبي، ياقوتي، زمردي، بنفسجي، وردي، فيروزي) تُطبَّق في الوضعين الفاتح والداكن بدرجات مضبوطة على معايير التباين (WCAG AA).', en: 'New: choose an app accent color from Settings → Layout → Appearance — 6 harmonized colors (gold, ruby, emerald, violet, pink, turquoise) applied across both light and dark modes with shades tuned to WCAG AA contrast standards.' },
      { ar: 'اللون المختار يتبعك: يُحفظ، يُزامَن فوراً بين تبويبات التطبيق المفتوحة، ويُحفظ ويُستعاد ضمن النسخة الاحتياطية (تصدير/استيراد).', en: 'Your chosen color follows you: it\'s saved, synced instantly across open tabs, and included in backups (export/import).' },
      { ar: 'حركة مفتاح "الوضع البديل" صارت أنعم وأخف على البطارية (تتحرك عبر transform بدل إعادة حساب التخطيط في كل إطار).', en: 'The "Alternate Mode" switch animation is now smoother and lighter on the battery (moves via a CSS transform instead of re-computing layout every frame).' },
      { ar: 'إغلاق النوافذ المنبثقة صار يتزامن فيه اختفاء الخلفية مع انزلاق النافذة بدل تفاوت بسيط بينهما.', en: 'Closing a dialog now syncs the backdrop fade with the sheet slide instead of a slight mismatch between the two.' },
      { ar: 'تحسين وضوح النص التلميحي داخل الحقول (placeholder)، وزيادة مساحة لمس بطاقات الفئات، وتوحيد انحناءات الزوايا في الأزرار العلوية.', en: 'Improved placeholder-text clarity in input fields, enlarged the tap area on category cards, and unified corner-radius consistency on the top-bar buttons.' },
    ],
  },
  {
    version: 'v47.8',
    date: '2026-06-21',
    title: { ar: 'تحسينات إتاحة (Accessibility) ودقّة الأرقام', en: 'Accessibility improvements and numeric precision' },
    items: [
      { ar: 'اختيار المحفظة من قوائم الإضافة/التعديل/التحويل صار يعمل بلوحة المفاتيح فقط (Enter/مسافة)، بعد أن كان يتطلب لمس/نقر الفأرة حصراً.', en: 'Choosing a wallet from the add/edit/transfer pickers now works with the keyboard alone (Enter/space), after previously requiring a touch or mouse click.' },
      { ar: 'مقارنة المصروف بالميزانية الشهرية صارت تتجاهل فروقات عشرية غير مرئية كانت قد تُسبب عدم ظهور تنبيه الميزانية بدقة عند حدود النسبة (80% أو 100%).', en: 'Comparing spending against the monthly budget now ignores invisible decimal-precision drift that could have caused the budget alert to misfire right at the 80% or 100% threshold.' },
      { ar: 'حفظ ميزانية محفظة برقم بأكثر من خانتين عشريتين صار يُقرَّب بنفس طريقة باقي المبالغ في التطبيق بدل تخزينه بدقة زائدة غير متّسقة.', en: 'Saving a wallet budget with more than two decimal places now rounds it the same way every other amount in the app is rounded, instead of storing it with inconsistent extra precision.' },
      { ar: 'زر "وزّعه الآن" في نافذة توزيع الدخل صار يُعطّل نفسه أثناء التنفيذ مثل بقية أزرار الحفظ، فلا يلتبس على المستخدم هل سُجّل ضغطه أم لا.', en: 'The "distribute now" button in the income-distribution dialog now disables itself while running, matching the other save buttons, so it\'s never unclear whether the tap registered.' },
      { ar: 'الضغط على "تحديث الآن" أثناء فتح نافذة تحتوي بيانات غير محفوظة (تحويل، اشتراك، محفظة، إلخ) صار يسأل للتأكيد بدل إغلاقها وإعادة التحميل بصمت.', en: 'Tapping "update now" while a dialog with unsaved data is open (transfer, subscription, wallet, etc.) now asks for confirmation instead of silently closing it and reloading.' },
    ],
  },
  {
    version: 'v47.7',
    date: '2026-06-21',
    title: { ar: 'تصحيح عطل خطير: فقدان معاملة عند فتح التطبيق بأكثر من تبويب', en: 'Fixed a serious bug: losing a transaction when the app was open in multiple tabs' },
    items: [
      { ar: 'فتح التطبيق في تبويبين/نافذتين بنفس الوقت وإضافة معاملة مختلفة في كل منهما خلال أقل من ثانية كان أحياناً يمحو إحدى المعاملتين نهائياً من التخزين الدائم بصمت — تم إصلاحه بدمج التغييرات بدل الكتابة فوق بعضها.', en: 'Opening the app in two tabs/windows at once and adding a different transaction in each within under a second could silently and permanently erase one of the two transactions from persistent storage — fixed by merging the changes instead of one write overwriting the other.' },
      { ar: 'بعد دمج معاملات تبويبين، صار التطبيق يعيد حساب أرصدة المحافظ تلقائياً من سجل المعاملات الصحيح بدل ترك التبويب الآخر بأرقام غير متطابقة.', en: 'After merging transactions from two tabs, the app now recomputes wallet balances automatically from the correct transaction ledger instead of leaving the other tab with mismatched numbers.' },
      { ar: 'تبويب "تلقائي" في إعدادات المظهر لم يعد ينقطع نصه على الشاشات الضيقة جداً (320px فأقل).', en: 'The "auto" tab in the appearance settings no longer has its text cut off on very narrow screens (320px and below).' },
      { ar: 'أسماء/أوصاف المعاملات المُدخلة بخليط عربي/إنجليزي أو رموز اتجاه خفية صارت تُعرض دائماً بالاتجاه الصحيح في قائمة المعاملات ونافذة المراجعة اليومية.', en: 'Transaction names/descriptions entered with a mix of Arabic/English or hidden direction characters now always display in the correct direction in the transaction list and the daily-review dialog.' },
    ],
  },
  {
    version: 'v47.6',
    date: '2026-06-20',
    title: { ar: 'مظهر تلقائي يتناغم مع نظام جهازك', en: 'An automatic appearance that follows your system' },
    items: [
      { ar: 'وضع تلقائي جديد للمظهر (فاتح/داكن) من الإعدادات ← الترتيب — يتبع إعداد نظام جهازك مباشرة، وهو الافتراضي لمن لم يختر مظهراً يدوياً من قبل.', en: "A new automatic appearance mode (light/dark) from Settings → Layout — follows your device's system setting directly, and is the default for anyone who hasn't manually chosen an appearance before." },
      { ar: 'عند تبديل مظهر نظام جهازك (مثلاً تلقائياً عند الغروب) والتطبيق مفتوح، يتغيّر مظهر التطبيق فوراً بدون إعادة تحميل — طالما الوضع التلقائي مفعّل.', en: "When your device's system appearance switches (e.g. automatically at sunset) while the app is open, the app's appearance changes instantly with no reload — as long as auto mode is on." },
      { ar: 'اختيار مظهر يدوي (فاتح/داكن) من زر الشريط العلوي أو الإعدادات يوقف المتابعة التلقائية لنظام الجهاز حتى تُعيد تفعيلها بنفسك.', en: "Manually choosing an appearance (light/dark) from the header button or Settings stops following your device's system automatically, until you re-enable it yourself." },
      { ar: 'النسخة الاحتياطية (تصدير/استيراد، ومزامنة Drive) صارت تحفظ اختيارك (تلقائي/فاتح/داكن) بدل تجميد لون واحد، فجهاز ثانٍ بالوضع التلقائي يتبع نظامه هو لا نظام الجهاز الذي صدّر النسخة.', en: "Backups (export/import, and Drive sync) now save your actual choice (auto/light/dark) instead of freezing a single appearance — a second device on auto mode follows its own system, not the system of the device that exported the backup." },
    ],
  },
  {
    version: 'v47.5',
    date: '2026-06-20',
    title: { ar: 'تدقيق من زوايا جديدة: استيراد، صوت وأمان', en: 'A new-angle audit: import, voice, and security' },
    items: [
      { ar: 'اسم محفظة يحتوي كوداً خبيثاً (مثلاً عبر مزامنة Drive من جهاز آخر) لم يعد يمكن أن يُنفَّذ — صار يُعرض كنص عادي بملاحظة "يبقى في المحفظة" بنافذة توزيع الدخل.', en: 'A wallet name containing malicious code (e.g. arriving via Drive sync from another device) can no longer execute — it now displays as plain text with a "stays in this wallet" note in the income-distribution dialog.' },
      { ar: 'استيراد نسخة احتياطية بملف تالف لم يعد يقدر يصفّر كل أرصدة المحافظ بصمت دون استرجاعها.', en: 'Importing a backup from a corrupted file can no longer silently zero out every wallet balance without recovering them.' },
      { ar: 'استيراد معاملات بمبلغ ضخم وغير منطقي صار يُرفض عند الاستيراد، تماماً مثل الإدخال اليدوي.', en: 'Importing transactions with an absurdly large amount is now rejected at import time, exactly like manual entry.' },
      { ar: 'معاملات بدون معرّف صار تُرفض عند الاستيراد، ومعاملات بمعرّف مكرر صار يُحتفظ بأول نسخة صالحة منها فقط بدل تكرارها.', en: 'Transactions without an id are now rejected on import, and transactions sharing a duplicate id now keep only the first valid copy instead of duplicating it.' },
      { ar: 'الإدخال الصوتي صار يتجاهل نتيجة متأخرة تصل بعد إلغاء التسجيل، بدل تعبئة الحقول بكلام كان يُفترض إلغاؤه.', en: 'Voice input now ignores a late result that arrives after the recording was canceled, instead of filling in fields with speech that was meant to be discarded.' },
    ],
  },
  {
    version: 'v47.4',
    date: '2026-06-20',
    title: { ar: 'تدقيق عميق: إتاحة ودقة العرض', en: 'A deep audit: accessibility and display accuracy' },
    items: [
      { ar: 'فخّ تركيز (focus trap) جديد بكل نافذة منبثقة ودرج الإضافة — مفتاح Tab لم يعد يُخرج التركيز للخلفية المخفية أثناء فتح نافذة.', en: 'A new focus trap in every dialog and the add drawer — Tab no longer lets keyboard focus escape into the hidden background while a dialog is open.' },
      { ar: 'محتوى الصفحة خلف أي نافذة منبثقة أو درج الإضافة صار مخفياً فعلياً عن قارئ الشاشة (aria-hidden) بدل أن يبقى ظاهراً وهو غير قابل للاستخدام.', en: 'Page content behind any dialog or the add drawer is now genuinely hidden from the screen reader (aria-hidden) instead of remaining announced while it\'s unusable.' },
      { ar: 'إضافة محفظة جديدة من الإعدادات صارت تُحدّث محرر توزيع الدخل فوراً، بدل احتمال بقائه بحالة قديمة حتى يحدث تحديث آخر للواجهة.', en: 'Adding a new wallet from Settings now refreshes the income-distribution editor immediately, instead of possibly staying stale until some other UI update happened to trigger.' },
      { ar: 'نفس إصلاح التوزيع طُبّق على تصفير التوزيع الافتراضي ومزامنة محافظ جديدة قادمة من جهاز آخر عبر Drive.', en: 'The same distribution fix was applied to resetting to the default distribution and to syncing new wallets arriving from another device via Drive.' },
      { ar: 'تسريب رابط أيقونة التطبيق المؤقت (blob) عند تبديل الوضع الفاتح/الداكن بسرعة صار مُتتبَّعاً ويُحرَّر بشكل صحيح.', en: 'A leaking temporary app-icon blob URL from rapidly toggling light/dark mode is now tracked and properly released.' },
      { ar: 'تنظيف كود CSS غير مستخدم لتأثير حذف معاملة بالسحب.', en: 'Cleaned up unused CSS for the swipe-to-delete transaction effect.' },
    ],
  },
  {
    version: 'v47.3',
    date: '2026-06-20',
    title: { ar: 'تدقيق إضافي: لمس، تزامن وموثوقية', en: 'A further audit: touch, sync, and reliability' },
    items: [
      { ar: 'تعديل معاملة على جهاز ثم تعديلها على جهاز آخر صار يحتفظ بالتعديل الأحدث بدل تجاهله عند مزامنة Drive.', en: "Editing a transaction on one device and then again on another now keeps the more recent edit instead of discarding it during Drive sync." },
      { ar: 'سحب-للحذف صار يتجاهل لمسة إصبع ثانية بدل الخلط بين صفّين أثناء السحب.', en: 'Swipe-to-delete now ignores a second finger touch instead of mixing up two rows mid-swipe.' },
      { ar: 'مقبض السحب أعلى النوافذ المنبثقة صار يعمل فعلياً للإغلاق بالسحب لأسفل.', en: 'The drag handle at the top of dialogs now actually works for swipe-down closing.' },
      { ar: 'حفظ النسخة الاحتياطية المحلية صار مجمّعاً بدل تكراره مع كل حفظ صغير، لتقليل الكتابة الزائدة على القرص.', en: 'Local backup saves are now batched instead of repeating on every tiny save, reducing excess disk writes.' },
      { ar: 'تنبيه تحديث التطبيق صار يتحقق من وجود تعديل معاملة غير محفوظ، مو بس إضافة جديدة.', en: 'The app-update prompt now also checks for an unsaved transaction edit, not just a new addition.' },
      { ar: 'مدة ظهور رسائل التنبيه الطويلة صارت أطول تلقائياً لإعطاء وقت كافٍ لقراءتها.', en: 'Longer toast messages now automatically stay on screen longer to give enough time to read them.' },
    ],
  },
  {
    version: 'v47.2',
    date: '2026-06-20',
    title: { ar: 'تدقيق شامل: إتاحة ودقة وموثوقية', en: 'A comprehensive audit: accessibility, accuracy, and reliability' },
    items: [
      { ar: 'تباين ألوان أفضل بالوضع الفاتح لمبالغ المعاملات والأرصدة (كانت لا تحقق معيار الوضوح القياسي).', en: 'Better color contrast in light mode for transaction amounts and balances (they previously failed the standard readability guideline).' },
      { ar: 'حذف محفظة كانت تُبقي فلتر المعاملات عالقاً عليها فاضياً للأبد — صار يُمسح تلقائياً.', en: 'Deleting a wallet used to leave the transaction filter stuck on it, showing an empty list forever — it now clears automatically.' },
      { ar: 'مؤشر مزامنة Drive صار يعمل بلوحة المفاتيح، مو بس باللمس/الفأرة.', en: 'The Drive sync indicator now works with the keyboard, not just touch/mouse.' },
      { ar: 'منطقة لمس أكبر لزر مسح البحث، وحماية إضافية من تكرار العمليات بشاشة تفاصيل المحفظة.', en: 'A larger tap area for the clear-search button, plus extra protection against duplicate operations on the wallet-detail screen.' },
      { ar: 'إصلاحات داخلية متفرقة لتقليل احتمالية تعارض المزامنة السحابية وتثبيت سلوك زر الرجوع عند تكدّس عدة نوافذ.', en: 'Assorted internal fixes to reduce the chance of a cloud-sync conflict and to make the back button behave consistently with several dialogs stacked.' },
    ],
  },
  {
    version: 'v47.1',
    date: '2026-06-20',
    title: { ar: 'مزامنة بدل التحديث لمحافظ التتبع', en: '"Sync" instead of "update" for tracking wallets' },
    items: [
      { ar: 'شارة محافظ التتبع بالواجهة صارت تعرض نسبة رصيد المحفظة من إجمالي كل محافظك بدل كلمة "تحديث".', en: "The tracking-wallet badge on the home screen now shows the wallet's percentage share of your total money instead of the word \"update\"." },
      { ar: 'أيقونة جديدة ⚖️ بدل أيقونة الأسهم القديمة بكل مكان متعلق بمحافظ التتبع (الواجهة، الإعدادات، شاشة التفاصيل).', en: 'A new ⚖️ icon replaces the old arrows icon everywhere related to tracking wallets (home screen, Settings, the detail view).' },
      { ar: 'كلمة "تحديث" تغيّرت إلى "مزامنة" بكل نصوص محافظ التتبع لوضوح أكبر.', en: 'The word "update" was changed to "sync" throughout the tracking-wallet copy for clarity.' },
    ],
  },
  {
    version: 'v47',
    date: '2026-06-20',
    title: { ar: 'تصميم أنيق لمكان "ما الجديد؟"', en: 'A polished design for "What\'s new?"' },
    items: [
      { ar: 'زر "ما الجديد في التطبيق؟" بالإعدادات صار بطاقة بأيقونة ووصف بدل سطر مسطّح، بنفس أسلوب بقية أزرار الإعدادات.', en: 'The "What\'s new in the app?" entry in Settings is now a card with an icon and description instead of a flat line, matching the style of the other Settings entries.' },
      { ar: 'نقطة "جديد" تبرز بشكل أوضح فقط لمن عنده تحديث لم يطّلع عليه بعد.', en: 'The "new" dot now shows more clearly, and only for someone who has an update they haven\'t viewed yet.' },
    ],
  },
  {
    version: 'v46',
    date: '2026-06-20',
    title: { ar: 'شارة موحّدة لكل المحافظ', en: 'A unified badge for every wallet' },
    items: [
      { ar: 'محافظ عادية: زر ⓘ جديد بإعدادات → المحافظ يفتح تفاصيل المحفظة وميزانيتها مباشرة (مثل زر 🔄 لمحافظ التتبع).', en: 'Regular wallets: a new ⓘ button in Settings → Wallets opens the wallet\'s details and budget directly (like the 🔄 button for tracking wallets).' },
      { ar: 'شارة محافظ التتبع بالواجهة والإعدادات صارت بنفس اللون والشكل الذهبي للمحافظ العادية — تصميم واحد متسق للكل.', en: "The tracking-wallet badge on the home screen and in Settings now shares the same gold color and shape as regular wallets — one consistent design for both." },
    ],
  },
  {
    version: 'v45',
    date: '2026-06-20',
    title: { ar: 'سجل "ما الجديد؟"', en: 'A "What\'s new?" log' },
    items: [
      { ar: 'مكان جديد تحت زر التحديث القسري بالإعدادات يعرض آخر التحديثات والميزات المُضافة.', en: 'A new entry under the force-refresh button in Settings shows the latest updates and added features.' },
      { ar: 'نقطة "جديد" تظهر تلقائياً كلما توفر تحديث لم تطّلع عليه بعد.', en: "A \"new\" dot appears automatically whenever there's an update you haven't seen yet." },
    ],
  },
  {
    version: 'v44',
    date: '2026-06-20',
    title: { ar: 'شارة معلومات أوضح للمحافظ', en: 'A clearer info badge for wallets' },
    items: [
      { ar: 'شارة ⓘ بجانب كل محفظة صارت شريحة بحدود وألوان واضحة بدل نص باهت، لتعرف إنها قابلة للضغط.', en: 'The ⓘ badge next to each wallet is now a chip with a clear border and color instead of dim text, so it reads as tappable.' },
      { ar: 'محافظ التتبع: زر 🔄 تحديث يفتح مباشرة شاشة تحديث رصيدك الفعلي.', en: 'Tracking wallets: the 🔄 update button opens the actual-balance sync screen directly.' },
      { ar: 'إصلاح اقتطاع أسماء المحافظ الطويلة داخل الإعدادات.', en: 'Fixed long wallet names being cut off inside Settings.' },
    ],
  },
  {
    version: 'v42',
    date: '2026-06-20',
    title: { ar: 'حذف المحافظ ودليل ترحيب محدث', en: 'Deleting wallets + an updated welcome guide' },
    items: [
      { ar: 'زر 🗑 لحذف أي محفظة مباشرة من قائمة الترتيب بالإعدادات.', en: 'A 🗑 button to delete any wallet directly from the reorder list in Settings.' },
      { ar: 'شريحة جديدة بجولة الترحيب تشرح إضافة/تسمية/ترتيب/حذف المحافظ.', en: 'A new welcome-tour slide explaining adding/renaming/reordering/deleting wallets.' },
    ],
  },
  {
    version: 'v41',
    date: '2026-06-20',
    title: { ar: 'الإعدادات بثلاث تبويبات', en: 'Settings, now with three tabs' },
    items: [
      { ar: 'الإعدادات صارت مقسّمة: 🔀 الترتيب · 🏦 المحافظ · 💾 البيانات، بدل قائمة طويلة واحدة.', en: 'Settings is now split into: 🔀 Layout · 🏦 Wallets · 💾 Data, instead of one long list.' },
    ],
  },
  {
    version: 'v40',
    date: '2026-06-20',
    title: { ar: 'إدارة المحافظ الكاملة', en: 'Full wallet management' },
    items: [
      { ar: 'أضف محافظ جديدة (عادية تُحتسب بالإجمالي، أو تتبع فقط).', en: 'Add new wallets (regular, counted in the total, or tracking-only).' },
      { ar: 'عدّل اسم وترتيب أي محفظة من الإعدادات.', en: 'Edit the name and order of any wallet from Settings.' },
    ],
  },
  {
    version: 'v34',
    date: '2026-06-19',
    title: { ar: 'ربط المصروف بمحفظة تتبع', en: 'Linking an expense to a tracking wallet' },
    items: [
      { ar: 'اختياري الآن: اربط أي مصروف بمحفظة تتبع (مثل بطاقة بنكية) عند تسجيله.', en: 'Now optional: link any expense to a tracking wallet (like a bank card) when recording it.' },
      { ar: 'اختر سلوك الربط من تفاصيل المحفظة: ينقص الرصيد الفعلي، أو يزيد عدّاد إنفاق.', en: 'Choose the link behavior from the wallet details: decrease the actual balance, or increase a spending counter.' },
    ],
  },
];
// Tombstones for delete propagation in multi-device merge sync: {txId: deletedAtMs}.
// Without these, a union merge would resurrect a transaction deleted on another
// device. Tx/sub tombstones are pruned to the last 90 days so the sets stay bounded.
// Declared here (not with the rest of the mutable state below) because
// applyWalletDefs() consults deletedWalletDefIds and already runs at parse time
// via the _loadCustomWalletDefsSync IIFE just after it — a later `let` would TDZ-throw.
let deletedTxIds = {};
// Same role for subscriptions and wallet definitions — mergeCloudData unions
// both by id, so without tombstones a subscription/wallet deleted on device A
// reappears from device B's copy on the very next sync, forever ping-ponging.
let deletedSubIds = {};
let deletedWalletDefIds = {};
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
function pruneTombstones(){
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  for(const id in deletedTxIds){ if(!(deletedTxIds[id] > cutoff)) delete deletedTxIds[id]; }
  for(const id in deletedSubIds){ if(!(deletedSubIds[id] > cutoff)) delete deletedSubIds[id]; }
  // deletedWalletDefIds is deliberately NOT pruned: it's bounded by wallet count
  // (tiny), custom wallet ids are never reused (generated w_<ts>_<rand>), and the
  // default-wallet ids ('reserve'/'crisis_fund') rely on a PERMANENT tombstone to
  // record "the user deleted this default" — applyWalletDefs() would otherwise
  // resurrect them the moment a 90-day expiry dropped the record.
}
// Union a {id: deletedAtMs} tombstone map from an external snapshot (cloud/IDB/
// import) into a local one — newest stamp wins, non-numeric entries dropped.
function _unionTombstoneMap(local, incoming){
  if(!incoming || typeof incoming !== 'object') return local;
  for(const id in incoming){
    const t = incoming[id];
    if(typeof t === 'number' && (!local[id] || t > local[id])) local[id] = t;
  }
  return local;
}
// Validates/cleans a candidate wallet-defs array (from localStorage, IndexedDB,
// an imported backup, or a Drive snapshot) before it's allowed to replace the
// live WALLET_DEFS. Returns a fresh array of plain {id,name,initial,track,pct}
// objects, or null if the input is unusable (caller should keep what it has).
function sanitizeWalletDefs(arr){
  if(!Array.isArray(arr) || !arr.length) return null;
  const seen = new Set();
  const out = [];
  arr.forEach(w => {
    if(!w || typeof w !== 'object') return;
    const id = typeof w.id === 'string' ? w.id.trim() : '';
    // Strip bidi-control/zero-width chars same as escHtml — a wallet name
    // bypasses escHtml's protection wherever it's rendered via textContent
    // (which doesn't need HTML-escaping but is still vulnerable to display
    // corruption from a name like "Cash‮hsac").
    // [...str].slice() counts Unicode code points, not UTF-16 code units — avoids
    // stranding a lone surrogate when the 40th position falls inside an emoji pair.
    const name = typeof w.name === 'string' ? [...stripBidiControls(w.name).trim()].slice(0,40).join('') : '';
    // '__proto__'/'constructor'/'prototype' match the id regex but wallet ids are
    // used as bracket-notation object keys all over (state.wallets[id], budgets[id],
    // trackLinkMode[id]) — every current write is a primitive so nothing is
    // exploitable today, but a future `someMap[id] = {...}` would become real
    // prototype pollution. Cheap to foreclose at the gate.
    if(!id || !/^[a-zA-Z0-9_\-]+$/.test(id) || id === '__proto__' || id === 'constructor' || id === 'prototype' || !name || seen.has(id)) return;
    seen.add(id);
    out.push({id, name, initial:0, track: !!w.track, pct: typeof w.pct === 'string' ? w.pct : (w.track ? 'تتبع' : '0%'), ...(w.crisisOnly ? {crisisOnly:true} : {})});
  });
  // Every screen that lets the user pick a spendable wallet (add form, transfers)
  // assumes at least one non-track wallet exists — a corrupt/edited blob with only
  // track wallets would otherwise brick those screens.
  if(!out.length || !out.some(w => !w.track)) return null;
  return out;
}
// Mutates WALLET_DEFS IN PLACE (clear + refill) so every other module's direct
// references to the same array — there are dozens across app.core/logic/ui.js —
// pick up the change without needing to be updated individually.
function applyWalletDefs(clean){
  WALLET_DEFS.length = 0;
  clean.forEach(w => WALLET_DEFS.push(w));
  // crisis_fund may be absent from wallet defs saved before v47.31 — always
  // ensure it exists, inserted before track wallets to preserve display order.
  // UNLESS the user deliberately deleted it (tombstoned): re-inserting here made
  // deleteWalletDef() silently self-defeating — the very call it used to remove
  // the wallet (applyWalletDefs(filtered)) re-added it before returning, while
  // the UI showed a "deleted" success toast.
  const cfIdx = WALLET_DEFS.findIndex(w => w.id === 'crisis_fund');
  if(cfIdx === -1 && !deletedWalletDefIds['crisis_fund']){
    const firstTrack = WALLET_DEFS.findIndex(w => w.track);
    const pos = firstTrack === -1 ? WALLET_DEFS.length : firstTrack;
    WALLET_DEFS.splice(pos, 0, {id:'crisis_fund', name:'Merged Reserve', initial:0, track:false, crisisOnly:true, pct:'0%'});
  } else if(cfIdx !== -1 && !WALLET_DEFS[cfIdx].crisisOnly){
    WALLET_DEFS[cfIdx] = {...WALLET_DEFS[cfIdx], crisisOnly: true};
  }
  // "Reserve" was a default wallet, got folded into Core Expenses in v47.31, then
  // reinstated as a permanent default in v47.75 — always ensure it exists (same
  // pattern + same tombstone escape-hatch as crisis_fund above) so an account
  // created in that window gets it back too, not just fresh installs.
  // _ensureReserveShare() (below) handles giving it back its 5% distribution share.
  if(WALLET_DEFS.findIndex(w => w.id === 'reserve') === -1 && !deletedWalletDefIds['reserve']){
    const givingIdx = WALLET_DEFS.findIndex(w => w.id === 'giving');
    const pos = givingIdx === -1 ? Math.max(0, cfIdx === -1 ? WALLET_DEFS.length : cfIdx) : givingIdx + 1;
    WALLET_DEFS.splice(pos, 0, {id:'reserve', name:'Reserve', initial:0, track:false, pct:'5%'});
  }
  recomputeSelectableWallets();
}
// Companion to the reserve-wallet guarantee in applyWalletDefs() above: if the
// wallet exists but DISTRIBUTION has no matching share (a pre-v47.31 account
// whose Reserve wallet was left at an orphaned 0%, or a wallet just re-added by
// applyWalletDefs()), give it the 5% back. Takes it out of Core if Core still
// sits at the old v47.31 merged 55% so the total lands on exactly 100% instead
// of silently going over; otherwise (Core was customized) just adds the 5% —
// openDistributionModal()/settings already handle a >100% total gracefully.
function _ensureReserveShare(){
  if(!WALLET_DEFS.find(w => w.id === 'reserve' && !w.track)) return;
  const existing = DISTRIBUTION.find(d => d.id === 'reserve');
  const core = DISTRIBUTION.find(d => d.id === 'core');
  if(existing){
    // A reserve entry at 0% while Core still sits at the old v47.31 merged 55%
    // is the exact orphaned-account signature (reserve's 5% was folded into
    // Core back then; the entry itself survived at 0). A user who deliberately
    // zeroed reserve AFTER v47.75 has core at 50 (or their own number), never
    // this pair — so repairing only this combination can't clobber a choice.
    if(existing.pct === 0 && core && core.pct === 55){ existing.pct = 5; core.pct = 50; }
    return;
  }
  DISTRIBUTION = DISTRIBUTION.concat([{id:'reserve', pct:5}]);
  if(core && core.pct === 55) core.pct = 50;
}
// Set when localStorage's walletDefs key exists but is corrupted/unusable —
// loadState()'s IndexedDB-recovery check below only looked at "key absent",
// so a present-but-corrupt blob used to silently skip recovery too (worse
// than a missing key) and fall back to default wallets with zero warning.
// (The synchronous custom-wallet-defs loader IIFE that sets this lives further
// DOWN, after the state/SELECTABLE_WALLETS/selectedWallet declarations it
// transitively depends on — see the comment there for the TDZ bug that forced
// the move.)
let _walletDefsLoadFailed = false;

// In crisis/alternative mode the budget wallets (wishlist, growth, joy, giving, …)
// are hidden and replaced by the single crisis_fund wallet.
// crisisOnly wallets are intentionally excluded from this list — they are NOT hidden
// in crisis mode (they become visible precisely when crisis mode is on).
function crisisWalletIds(){
  return WALLET_DEFS.filter(w => !w.track && w.id !== 'core' && !w.crisisOnly).map(w => w.id);
}

// `name` stays the canonical Arabic string (also used as the stable fallback
// when 'en' isn't applicable); `nameEn` is resolved through t() at lookup
// time by getCategory()/the[_makeCatChip] grid renderer, not baked in here.
const CATEGORIES = [
  {id:'food',          types:['expense'],          name:'طعام وشراب',   nameEn:'Food & drinks',  icon:'🍽️', color:'#e3a07a'},
  {id:'transport',     types:['expense'],          name:'مواصلات',      nameEn:'Transport',      icon:'🚗', color:'#86adcf'},
  {id:'shopping',      types:['expense'],          name:'تسوق',         nameEn:'Shopping',       icon:'🛍️', color:'#dcb674'},
  {id:'bills',         types:['expense'],          name:'فواتير',       nameEn:'Bills',          icon:'🧾', color:'#a78bd6'},
  {id:'health',        types:['expense'],          name:'صحة',          nameEn:'Health',         icon:'💊', color:'#86c39a'},
  {id:'entertainment', types:['expense'],          name:'ترفيه',        nameEn:'Entertainment',  icon:'🎮', color:'#e3918f'},
  {id:'salary',        types:['income'],           name:'راتب/دخل',     nameEn:'Salary/income',  icon:'💼', color:'#7fcf9f'},
  {id:'transfer',      types:['expense','income'], name:'تحويل',        nameEn:'Transfer',       icon:'🔁', color:'#9aa0ad'},
  {id:'other',         types:['expense','income'], name:'أخرى',         nameEn:'Other',          icon:'✨', color:'#8d94a3'},
];
const QUICK_AMOUNTS = [250, 500, 1000, 2000, 5000, 10000];
// `let` + explicit recompute (not a one-time const filter) because WALLET_DEFS
// can grow/shrink at runtime once wallets become user-editable, and crisis mode
// changes which wallets are visible so the add-form dropdown must match.
// PRIMARY selectable wallets are budget wallets only — tracking wallets
// (Uber/Cards/Cash) are NOT primary targets; they're assigned via the SEPARATE
// "track wallet" control (the add-form link, and the per-line track dropdown in
// quick-notes), consistently. This keeps one clear model everywhere: a primary
// (budget) wallet + an optional tracking wallet.
let SELECTABLE_WALLETS = WALLET_DEFS.filter(w => !w.track && !w.crisisOnly);
function recomputeSelectableWallets(){
  if(state.crisisMode){
    const crisisIds = new Set(crisisWalletIds());
    // crisis mode: show core + crisisOnly wallets (crisis_fund), hide normal budget wallets
    SELECTABLE_WALLETS = WALLET_DEFS.filter(w => !w.track && !crisisIds.has(w.id));
  } else {
    // normal mode: hide crisisOnly wallets (they only make sense in crisis context)
    SELECTABLE_WALLETS = WALLET_DEFS.filter(w => !w.track && !w.crisisOnly);
  }
  // If the currently selected wallet is no longer available, fall back to the first one
  if(SELECTABLE_WALLETS.length && !SELECTABLE_WALLETS.find(w => w.id === selectedWallet)){
    selectedWallet = SELECTABLE_WALLETS[0].id;
  }
}
function isTrackWallet(id){ const w = WALLET_DEFS.find(x => x.id === id); return !!(w && w.track); }
// The tracking wallets (for the secondary "track" control). Order matches WALLET_DEFS.
function trackWalletDefs(){ return WALLET_DEFS.filter(w => w.track); }

// Wallets that participate in automatic income distribution, with their share %
const DEFAULT_DISTRIBUTION = [
  {id:'core',        pct:50},
  {id:'wishlist',    pct:10},
  {id:'growth',      pct:10},
  {id:'investments', pct:10},
  {id:'joy',         pct:10},
  {id:'giving',      pct:5},
  {id:'reserve',     pct:5},
];
let DISTRIBUTION = DEFAULT_DISTRIBUTION.map(d=>({...d}));

let state = { wallets:{}, transactions:[], crisisMode:false };
let _txMutationStamp = 0;
// >0 while a multi-step async mutation is running (add/delete/distribute). The
// cross-tab storage listener checks this so another tab's save can't trigger a
// loadState() that resets `state` mid-mutation and corrupts balances.
let _opInFlight = 0;
// Shared guard for every money-writing entry point: refuse to start while
// another mutation is mid-flight across an await. Was copy-pasted verbatim at
// 11+ call sites; centralized here so a future wording/behavior change only
// needs one edit.
function _opBusy(){
  if(_opInFlight > 0){
    toast(t({ar:'⏳ هناك عملية قيد التنفيذ — أعد المحاولة بعد لحظة', en:'⏳ Another operation is in progress — try again in a moment'}), true);
    return true;
  }
  return false;
}
let currentFilter = 'all';
let walletFilter = null;
let categoryFilter = null;
let selectedWallet = WALLET_DEFS[0].id;
// Optional secondary tracked-wallet a new transaction also updates (e.g. pay Uber
// from Core, and also move the linked tracked "Uber" wallet automatically). null =
// none. See applyTxToBalance + addTx + trackLinkMode.
let selectedTrackWallet = null;

// Custom wallets (added via Settings → إدارة المحافظ) are loaded synchronously
// here — at parse time, before any other module runs — so the very first render
// already reflects them. MUST stay BELOW the state/SELECTABLE_WALLETS/
// selectedWallet declarations: applyWalletDefs() ends in
// recomputeSelectableWallets(), which reads all three, and calling it above
// them (where this loader originally lived) hit their temporal dead zone —
// every saved-defs boot threw, was caught as "corrupt", and got silently
// re-served from IndexedDB by loadState()'s recovery, which could apply a
// STALE snapshot (e.g. resurrecting a just-deleted wallet).
// IndexedDB-side recovery (in case localStorage was wiped) still happens later
// in loadState(), same pattern as the Drive client id / subscriptions recovery.
(function _loadCustomWalletDefsSync(){
  // Seed the wallet-def tombstones from the config blob FIRST — applyWalletDefs()
  // consults deletedWalletDefIds to decide whether to re-insert the default
  // 'reserve'/'crisis_fund' wallets, and loadState() (which normally loads the
  // tombstones) only runs later, asynchronously. Without this seed, a default
  // wallet the user deleted would resurrect at every boot before loadState ran.
  try{
    const cfg = JSON.parse(localStorage.getItem(LS_PREFIX + 'config') || 'null');
    if(cfg && cfg.deletedWalletDefIds && typeof cfg.deletedWalletDefIds === 'object'){
      _unionTombstoneMap(deletedWalletDefIds, cfg.deletedWalletDefIds);
    }
  }catch(e){}
  const raw = localStorage.getItem(LS_PREFIX + 'walletDefs');
  if(!raw) return;
  try{
    const clean = sanitizeWalletDefs(JSON.parse(raw));
    if(clean) applyWalletDefs(clean);
    else _walletDefsLoadFailed = true;
  }catch(e){ _walletDefsLoadFailed = true; }
})();
let editingTxId = null;
let editType = 'expense';
let editWallet = WALLET_DEFS[0].id;
let _editingTransferLeg = false; // when true, type/category are locked (transfer)
let _editingDistSource = false; // when true, amount is locked (already-distributed income source)
let searchQuery = '';
let prevSpendable = null;
let selectedCategory = 'other';
let editCategory = 'other';
let addFormType = 'expense';
let detailWalletId = null; // when set, shows wallet detail view
let pendingIncomeTx = null;
let autoDistribute = false;
let budgets = {}; // walletId -> monthly budget limit (expenses)
// Per-tracked-wallet direction for the optional transaction link (above): 'debit'
// (a real balance — an expense DECREASES it, income increases it) or 'credit' (a
// spending counter — an expense INCREASES it). Persisted via uiPrefs. The resolved
// direction is also stamped onto each linked tx (trackSign) so later config changes
// never retroactively flip the effect of past entries.
let trackLinkMode = {}; // walletId -> 'debit' | 'credit'
let dismissedRecurring = new Set();
// (Tombstone maps — deletedTxIds/deletedSubIds/deletedWalletDefIds — are declared
// further UP, before sanitizeWalletDefs/applyWalletDefs, because applyWalletDefs
// consults deletedWalletDefIds and is already called at parse time by the
// _loadCustomWalletDefsSync IIFE.)
// The single "is this transaction well-formed" rule — used at every boundary
// that ingests transactions from outside the app's own write paths (initial
// load, cloud merge, import, cloud snapshot adoption). Was once re-implemented
// per boundary with subtle drift (import required a string id, load/merge only
// a truthy one); centralized so a future rule change (e.g. adjusting the
// MAX_AMOUNT ceiling) can't be applied to only one entry point. Every id the
// app has ever generated is a 'tx_...' string, so the string requirement is safe.
function isValidTx(t){
  return !!(t && typeof t.id === 'string' && t.id && (t.type === 'income' || t.type === 'expense') &&
    typeof t.ts === 'number' && isFinite(t.ts) && t.ts > 0 &&
    typeof t.amount === 'number' && isFinite(t.amount) && t.amount > 0 && t.amount <= MAX_AMOUNT &&
    WALLET_DEFS.find(w => w.id === t.wallet));
}
// Restore wallet balances from a persisted snapshot ({walletId: number}) —
// used identically for the localStorage copy, the wallet-defs IDB-recovery
// path, and the primary IDB snapshot; coerces to a finite number so a
// tampered/corrupt source can't poison balances with NaN/Infinity.
function _restoreWalletBalances(source){
  if(!source) return;
  WALLET_DEFS.forEach(w => {
    if(source[w.id] !== undefined){
      const v = parseFloat(source[w.id]);
      if(isFinite(v)) state.wallets[w.id] = round2(v);
    }
  });
}

/* v9.3 */
let currentTab = 'home';
let addDrawerOpen = false;
let drawerTab = 0;
let subscriptions = []; // [{id, name, amount, billingDay, active}]
let editingSubId = null;

/* v9.9 — user-editable wallet definitions (add/rename/reorder) */
let editingWalletDefId = null; // null = "add new" mode in #walletDefModal
let _walletDefModalTrack = false; // pending track/regular choice while the modal is open

/* v9.4 — customizable layout (tab + section order) */
let _layoutEditorTab = 'tab'; // which sub-tab is active in the layout editor
const TAB_DEFS = {
  home:         {icon:'🏠', label:'الرئيسي',   panel:'tabHome'},
  transactions: {icon:'🧾', label:'المعاملات', panel:'tabTransactions'},
  analytics:    {icon:'📊', label:'تحليلات',   panel:'tabAnalytics'},
  reports:      {icon:'📋', label:'التقارير',  panel:'tabReports'}
};
const DEFAULT_TAB_ORDER = ['home','transactions','analytics','reports'];
// `label` is either an I18N_STRINGS key or an inline {ar,en} t() literal —
// resolved lazily via t() at render time (renderLayoutEditor) so it always
// reflects the current language instead of freezing at script-load time.
const SECTION_DEFS = {
  home: [
    {key:'balance',    label:{ar:'💰 إجمالي المتاح', en:'💰 Total available'}},
    {key:'crisis',     label:{ar:'🔄 الوضع البديل', en:'🔄 Alternate mode'}},
    {key:'quicknotes', label:{ar:'📝 ملاحظات سريعة', en:'📝 Quick notes'}},
    {key:'wallets',    label:{ar:'👛 المحافظ', en:'👛 Wallets'}}
  ],
  analytics: [
    {key:'stats',         label:'sec.monthStats'},
    {key:'recurring',     label:{ar:'🔔 تنبيهات متكررة', en:'🔔 Recurring alerts'}},
    {key:'export',        label:{ar:'📄 تصدير التقرير', en:'📄 Export report'}},
    {key:'subscriptions', label:{ar:'📆 الاشتراكات', en:'📆 Subscriptions'}},
    {key:'chart',         label:{ar:'🥧 التوزيع حسب الفئة', en:'🥧 Breakdown by category'}}
  ],
  reports: [
    {key:'summary', label:{ar:'🧮 ملخص الدخل/المصروف', en:'🧮 Income/expense summary'}},
    {key:'chart',   label:{ar:'📈 حركة الرصيد', en:'📈 Balance flow'}},
    {key:'list',    label:{ar:'🧾 قائمة المعاملات', en:'🧾 Transactions list'}}
  ]
};
let tabOrder = DEFAULT_TAB_ORDER.slice();
let sectionOrder = {}; // {home:[...], analytics:[...], reports:[...]}
const RECENT_TX_LIMIT_MAX = 50;
const RECENT_TX_LIMIT_DEFAULT = 25;
let recentTxLimit = RECENT_TX_LIMIT_DEFAULT; // how many tx the log shows per page (user-set, capped at 50)

/* SW update flow */
let _swRegistration = null;
let _pendingWorker = null;
let _reloadOnControllerChange = false;

/* ============================================================
   FORMAT HELPERS
============================================================ */
/**
 * Format a number as a 2-decimal display string with thousands separators.
 * @param {number} n
 * @returns {string}
 */
function fmt(n){
  if(isNaN(n) || !isFinite(n)) return '0.00';
  // collapse -0 and sub-cent negatives so they never render as "-0.00"
  if(Object.is(n, -0) || (n < 0 && n > -0.005)) n = 0;
  return Number(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
}

// Build a grammatically-correct "<count> <noun>" Arabic phrase. Arabic number
// agreement: 1 → singular ("معاملة واحدة"), 2 → dual ("معاملتان"), 3-10 → plural
// ("3 معاملات"), 11+ → singular form again ("11 معاملة"). Naively concatenating
// `${count} ${singular}` is only ever correct for the 11+ case, so every count+noun
// spot in the UI needs this instead of raw template-literal interpolation.
// `singular` must stay a bare noun/short phrase — it's reused as-is in the 11+
// branch below ("15 معاملة"). Appending واحدة to it for the n===1 case only
// works when `singular` is noun-first ("معاملة" -> "معاملة واحدة"); phrases that
// lead with an adjective ("متبقية") or a verb ("ستبقى مخفية") need واحدة placed
// differently, or have no noun to attach to at all — pass the fully-formed
// phrase via `singularOne` for those instead of relying on the default.
/**
 * Build a grammatically-correct Arabic "<count> <noun>" phrase.
 * @param {number} count
 * @param {string} singular  bare noun, reused as-is for the 11+ form
 * @param {string} dual
 * @param {string} plural
 * @param {string} [singularOne]  fully-formed phrase for the count===1 case
 * @returns {string}
 */
function arPlural(count, singular, dual, plural, singularOne){
  const n = Math.abs(Number(count) || 0);
  if(n === 1) return singularOne || `${singular} واحدة`;
  if(n === 2) return dual;
  if(n >= 3 && n <= 10) return `${n} ${plural}`;
  return `${n} ${singular}`;
}

// Normalize Arabic-Indic (٠-٩) and Persian (۰-۹) digits + Arabic decimal/thousands
// separators to ASCII so amount fields accept numbers typed on Arabic keyboards.
function normalizeDigits(str){
  return String(str == null ? '' : str)
    .replace(/−/g, '-')  // Unicode minus → ASCII hyphen-minus
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)) // Arabic-Indic digits
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0)) // Extended (Persian) digits
    .replace(/[٫]/g, '.')   // Arabic decimal separator
    // A comma followed by exactly 1–2 digits at the end of the string is almost
    // certainly a decimal separator (European convention: "1,5" = 1.5, "9,99" = 9.99).
    // A comma before 3+ digits is a thousands separator ("1,500") — left for the
    // next replace to strip. This prevents "1,5" from silently becoming 15.
    .replace(/,(\d{1,2})$/, '.$1')
    .replace(/[٬,\s]/g, '');  // Arabic + Latin thousands separators + spaces ("1 000")
}
// Parse a user-entered money string robustly (Arabic numerals, separators).
// Rejects parseFloat quirks that silently create absurd balances: scientific/
// hex notation ("1e9", "0x10") and values beyond a sane money ceiling. Returns
// NaN on any rejection so every caller's existing isFinite/isNaN guard catches it.
const MAX_AMOUNT = 1e12; // one trillion — well above any realistic single entry
/**
 * Parse a user-entered money string, rejecting junk (scientific/hex notation,
 * out-of-range values) by returning NaN.
 * @param {string} str
 * @returns {number} the parsed value, or NaN on any rejection
 */
function parseAmount(str){
  const norm = normalizeDigits(str);
  if(/[a-zA-Z]/.test(norm)) return NaN; // block 1e9 / 0x10 / Infinity / NaN-style strings
  if((norm.match(/\./g) || []).length > 1) return NaN; // reject "1.2.3"
  const v = parseFloat(norm);
  if(!isFinite(v) || Math.abs(v) > MAX_AMOUNT) return NaN;
  return v;
}

// Pure string transform behind liveFormatThousands()/groupThousandsDisplay()
// below: normalizes all digits to ASCII (matching fmt()'s display convention
// everywhere else in the app) and inserts "," every 3 digits in the integer
// part. "." or Arabic "٫" both mean "decimal point here" and normalize to
// "." — the digits after it are normalized but never regrouped, so an
// in-progress "1,000." isn't fought while more digits are still being typed.
const _toAsciiDigits = s => s.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
                              .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
function groupThousands(str){
  let raw = _toAsciiDigits(String(str == null ? '' : str)).replace(/[,٬]/g, ''); // drop existing grouping
  const decIdx = raw.search(/[.٫]/);
  let intPart = decIdx === -1 ? raw : raw.slice(0, decIdx);
  const decPart = decIdx === -1 ? '' : '.' + raw.slice(decIdx + 1).replace(/[^\d]/g, '');
  const isNeg = intPart.startsWith('-');
  if(isNeg) intPart = intPart.slice(1);
  intPart = intPart.replace(/[^\d]/g, ''); // drop anything else that slipped through
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (isNeg ? '-' : '') + grouped + decPart;
}
// One-shot grouping for a value being written into an input's HTML (not live
// typing) — e.g. pre-filling the Quick Notes preview row from a parsed
// amount. No cursor to preserve, so this is just groupThousands() with a
// friendlier name at call sites.
function groupThousandsDisplay(n){
  return groupThousands(String(n == null ? '' : n));
}
// Live thousands-separator formatting for money <input>s: as the user types,
// "1000" becomes "1,000", "1000000" becomes "1,000,000", etc. — the grouping
// regex handles any magnitude (millions/billions/trillions) with no
// special-casing. Meant to be wired via `el.addEventListener('input', () =>
// liveFormatThousands(el))`; every other 'input' listener on the same field
// keeps working unmodified because it reads the value through parseAmount(),
// which already tolerates thousands separators (normalizeDigits strips them).
//
// Arabic-Indic/Persian digits the user types are normalized to ASCII as part
// of formatting — matching fmt()'s display convention everywhere else in the
// app (money is always *shown* in ASCII digits) — so typing "١٠٠٠" also
// becomes "1,000" live.
//
// Cursor handling: naively reformatting on every keystroke jumps the caret to
// the end, which is unusable once a comma is inserted before the point the
// user is typing. Fixed by counting digits before the caret in the OLD value,
// then placing the caret after that many digits in the NEW (regrouped) value
// — comma insertions shift position but never change digit count or order.
function liveFormatThousands(el){
  const oldValue = el.value;
  const oldPos = el.selectionStart == null ? oldValue.length : el.selectionStart;
  const isDigit = ch => /[\d٠-٩۰-۹]/.test(ch);
  let digitsBeforeCaret = 0;
  for(let i = 0; i < oldPos && i < oldValue.length; i++){ if(isDigit(oldValue[i])) digitsBeforeCaret++; }

  const newValue = groupThousands(oldValue);
  if(newValue === oldValue) return; // no change — leave the caret alone
  el.value = newValue;
  let count = 0, newPos = newValue.length;
  if(digitsBeforeCaret === 0){
    newPos = 0;
  } else {
    for(let i = 0; i < newValue.length; i++){
      if(isDigit(newValue[i])) count++;
      if(count === digitsBeforeCaret){ newPos = i + 1; break; }
    }
  }
  try{ el.setSelectionRange(newPos, newPos); }catch(_){} // some input states disallow it (e.g. type=number, unused here)
}

// Shared by escHtml() and any other text that ends up displayed/rendered
// (e.g. wallet names) — strips Unicode bidi controls + zero-width chars. A
// pasted/imported string containing e.g. U+202E or U+200F can otherwise
// visually scramble the whole RTL layout of surrounding UI text
// ("Trojan Source"-style display corruption). Covers: zero-width
// (200B-200D, FEFF), LRM/RLM (200E-200F), Arabic letter mark (061C),
// embeddings/overrides (202A-202E), isolates (2066-2069). Explicit \u
// escapes are immune to source-editor stripping of literal controls.
function stripBidiControls(str){
  return String(str||'').replace(/[\u200B-\u200F\u061C\u202A-\u202E\u2066-\u2069\uFEFF]/g,'');
}
function escHtml(str){
  return stripBidiControls(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#x27;');
}

// Body scroll lock for modals/drawers. overflow:hidden alone is not enough on
// iOS Safari — it keeps scrolling the page under a finger dragging the backdrop,
// and the page jumps when the on-screen keyboard opens. Pin the body with
// position:fixed at the current offset instead, and restore the offset on
// unlock. Idempotent (a flag, not a counter) because both openModal and the add
// drawer call lock, and both close paths already gate the unlock on
// _anyOverlayOpen() — the LAST closer is the one that actually unlocks.
let _bodyScrollLocked = false;
let _bodyLockScrollY = 0;
function lockBodyScroll(){
  if(_bodyScrollLocked) return;
  _bodyScrollLocked = true;
  _bodyLockScrollY = window.scrollY || window.pageYOffset || 0;
  const s = document.body.style;
  s.overflow = 'hidden';
  s.position = 'fixed';
  s.top = (-_bodyLockScrollY) + 'px';
  // left/right 0 (not width) so the body's own max-width + margin:auto keep
  // centering it exactly as in normal flow
  s.left = '0';
  s.right = '0';
}
function unlockBodyScroll(){
  if(!_bodyScrollLocked) return;
  _bodyScrollLocked = false;
  const s = document.body.style;
  s.overflow = ''; s.position = ''; s.top = ''; s.left = ''; s.right = '';
  window.scrollTo(0, _bodyLockScrollY);
}

// Short tactile pulse on meaningful actions (add/delete/toggle) — makes the app
// feel native. Silently no-ops where unsupported, and respects reduced-motion.
function haptic(pattern){
  try{
    if(typeof navigator !== 'undefined' && navigator.vibrate &&
       !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)){
      navigator.vibrate(pattern);
    }
  }catch(_){}
}

// Visual counterpart to the various _xBusy guard flags: those flags correctly
// block a double-tap from corrupting state, but gave no on-screen sign anything
// was happening, so a slow save looked like a no-op and invited a second tap.
function _setBtnSaving(btn, saving, savingText){
  if(!btn) return;
  if(saving){
    if(btn.dataset.origLabel === undefined) btn.dataset.origLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = savingText || '...';
  } else {
    btn.disabled = false;
    if(btn.dataset.origLabel !== undefined){ btn.textContent = btn.dataset.origLabel; delete btn.dataset.origLabel; }
  }
}

const _animFrames = {}; // track active animation frames per element id to allow cancellation
function animateNumber(el, from, to, duration){
  if(!el) return; // guard against missing/detached DOM element
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    el.textContent = fmt(to);
    return;
  }
  // key by id, falling back to a stable per-element key so two id-less elements
  // can't share the "" slot and cancel each other's frames
  const key = el.id || (el._animKey || (el._animKey = 'anon_' + Math.random().toString(36).slice(2)));
  const dur = (typeof duration === 'number' && duration > 0) ? duration : 450;
  if(_animFrames[key]) cancelAnimationFrame(_animFrames[key]);
  const start = performance.now();
  function frame(now){
    // stop animating a node that was removed mid-flight (avoids writing to a
    // detached element and leaking the rAF chain)
    if(el.isConnected === false){ delete _animFrames[key]; return; }
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.textContent = fmt(from + (to - from) * eased);
    if(t < 1) _animFrames[key] = requestAnimationFrame(frame);
    else delete _animFrames[key];
  }
  _animFrames[key] = requestAnimationFrame(frame);
}
/* ============================================================
   THEME (dark / light)
============================================================ */
// Cache resolved CSS theme colors — getComputedStyle() forces a synchronous
// layout flush, and the charts read these on every redraw. Invalidated whenever
// the theme changes (applyTheme below).
let _themeColorCache = {};
function themeColor(name, fallback){
  let v = _themeColorCache[name];
  if(v === undefined){
    v = getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
    _themeColorCache[name] = v;
  }
  return v;
}

// Smooth-scroll the tx list into view AFTER the current render settles (deferring
// to the next frame stops the scroll animation from competing with layout/canvas
// work, which caused visible stutter on filter/search changes)
function scrollToTxList(){
  switchTab('reports');
  const el = document.getElementById('txList');
  if(el) requestAnimationFrame(()=> el.scrollIntoView({behavior:'smooth', block:'start'}));
}

function applyTheme(theme){
  _themeColorCache = {}; // theme switch — drop cached colors so charts re-read them
  const isLight = theme === 'light';
  const isBlack = theme === 'black';
  document.body.classList.toggle('light', isLight);
  document.body.classList.toggle('theme-black', isBlack); // matte-black variant of dark
  const btn = document.getElementById('themeToggle');
  if(btn){
    btn.textContent = isLight ? '🌙' : '☀️';
    btn.title = isLight ? t({ar:'التبديل للوضع الداكن', en:'Switch to dark mode'}) : t({ar:'التبديل للوضع الفاتح', en:'Switch to light mode'});
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', isLight ? '#f4f2ed' : (isBlack ? '#0b0b0d' : '#15171c'));
  // keep the installed PWA splash/chrome color in sync with the chosen theme
  if(typeof applyManifest === 'function') applyManifest(isLight);
  // day/night each keep their own accent — re-resolve for the bucket we just
  // switched into, and refresh the swatch selection if Settings is open.
  if(typeof applyAccent === 'function') applyAccent();
  if(typeof _updateAccentUI === 'function') _updateAccentUI(_currentAccent());
}
// Theme MODE is one of 'light' | 'dark' | 'black' | 'auto'. 'auto' isn't stored
// explicitly — its absence from localStorage IS the auto state, so a value written
// before this feature existed ('light'/'dark') keeps behaving as an explicit choice.
// 'black' is a manual-only matte-dark variant ('auto' never resolves to it — auto
// only follows the OS light/dark switch).
function _systemPrefersLight(){
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
}
function _currentThemeMode(){
  let m = null;
  try{ m = localStorage.getItem(LS_PREFIX + 'theme'); }catch(e){}
  return (m === 'light' || m === 'dark' || m === 'black') ? m : 'auto';
}
// Which dark style to use whenever the theme resolves to "dark" — either the
// standard dark or the matte ('black'). Remembered from the user's last explicit
// dark/matte pick so 'auto' AND the header quick-toggle both honour it.
function _darkVariant(){
  let v = null;
  try{ v = localStorage.getItem(LS_PREFIX + 'darkVariant'); }catch(e){}
  return v === 'black' ? 'black' : 'dark';
}
function _resolveThemeMode(mode){
  if(mode === 'auto') return _systemPrefersLight() ? 'light' : _darkVariant();
  return mode;
}
function _updateThemeModeUI(mode){
  document.querySelectorAll('#themeModeTabs [data-theme-mode]').forEach(btn => {
    const active = btn.dataset.themeMode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}
function setThemeMode(mode){
  try{
    if(mode === 'auto') localStorage.removeItem(LS_PREFIX + 'theme');
    else localStorage.setItem(LS_PREFIX + 'theme', mode);
    // Remember the preferred dark style so 'auto' and the header toggle resolve
    // dark to the same variant the user last chose (standard dark vs matte).
    if(mode === 'dark' || mode === 'black') localStorage.setItem(LS_PREFIX + 'darkVariant', mode);
  }catch(e){}
  applyTheme(_resolveThemeMode(mode));
  _updateThemeModeUI(mode);
  // canvas charts bake theme colors at draw time — redraw so they match the new theme
  if(typeof renderChart === 'function') renderChart();
  if(typeof renderPieChart === 'function') renderPieChart();
}
function toggleTheme(){
  // quick header tap = explicit manual choice (the opposite of what's showing now),
  // matching the long-standing one-tap behavior; pick 'auto' from Settings instead.
  // Going to dark uses the user's preferred dark variant (standard or matte).
  const isLight = document.body.classList.contains('light');
  setThemeMode(isLight ? _darkVariant() : 'light');
}
function initTheme(){
  const mode = _currentThemeMode();
  applyTheme(_resolveThemeMode(mode));
  _updateThemeModeUI(mode);
  // live-follow the device's light/dark switch (e.g. sunset auto-dark-mode) while
  // in auto mode, instead of only resolving it once at page load
  if(window.matchMedia){
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onSystemThemeChange = () => {
      if(_currentThemeMode() !== 'auto') return;
      applyTheme(_resolveThemeMode('auto'));
      if(typeof renderChart === 'function') renderChart();
      if(typeof renderPieChart === 'function') renderPieChart();
    };
    if(mq.addEventListener) mq.addEventListener('change', onSystemThemeChange);
    else if(mq.addListener) mq.addListener(onSystemThemeChange); // older Safari
  }
}

/* ============================================================
   ACCENT PALETTE (works in both light & dark)
============================================================ */
// Each palette re-skins the accent (--gold* + --accent-rgb) via a body.accent-<id>
// class defined in style.css (with a light variant). 'gold' is the default and
// has NO class — it falls back to the :root/body.light gold tokens. The c1/c2/on
// triple here is ONLY the swatch preview gradient shown in Settings; the authored,
// contrast-tuned applied colors live in CSS so they can differ per light/dark.
const ACCENTS = [
  {id:'gold',     name:'ذهبي',   nameEn:'Gold',     c1:'#dcb674', c2:'#b88c46', on:'#241d0d'},
  {id:'sapphire', name:'ياقوتي', nameEn:'Sapphire', c1:'#6fa0f0', c2:'#4178d0', on:'#08152b'},
  {id:'emerald',  name:'زمردي',  nameEn:'Emerald',  c1:'#54bd8a', c2:'#2f8a63', on:'#052016'},
  {id:'amethyst', name:'بنفسجي', nameEn:'Amethyst', c1:'#a987e6', c2:'#7d56c8', on:'#160a2a'},
  {id:'rose',     name:'وردي',   nameEn:'Rose',     c1:'#e985a4', c2:'#c25c7f', on:'#2a0f18'},
  {id:'teal',     name:'فيروزي', nameEn:'Teal',     c1:'#46c2c2', c2:'#2a9393', on:'#042020'},
  {id:'brown',    name:'بنّي',   nameEn:'Brown',    c1:'#b88a5e', c2:'#8a6038', on:'#1f1408'},
];
const _ACCENT_IDS = ACCENTS.map(a => a.id);
// The accent colour is remembered SEPARATELY for day vs night, so a user can run
// (say) blue in the daytime light theme and purple at night — switching the theme
// also restores that theme's own accent. 'day' = light theme; 'night' = the dark
// and matte themes (they share one night accent). Stored keys: 'accent' (day,
// kept for backward-compat with older single-accent backups) and 'accentDark'
// (night). 'gold' is the default and is represented by the key being absent.
function _accentBucket(){
  return document.body.classList.contains('light') ? 'day' : 'night';
}
function _accentKey(bucket){
  return (bucket === 'night') ? (LS_PREFIX + 'accentDark') : (LS_PREFIX + 'accent');
}
function _currentAccent(bucket){
  bucket = bucket || _accentBucket();
  let a = null;
  try{ a = localStorage.getItem(_accentKey(bucket)); }catch(e){}
  return _ACCENT_IDS.indexOf(a) > -1 ? a : 'gold';
}
// Resolve + apply the accent for the CURRENT theme bucket (no argument — it reads
// whichever bucket the active theme falls into). Called on load, on accent change,
// and at the end of every theme switch so day/night accents follow the theme.
function applyAccent(){
  const id = _currentAccent();
  _ACCENT_IDS.forEach(a => { if(a !== 'gold') document.body.classList.remove('accent-' + a); });
  if(id !== 'gold') document.body.classList.add('accent-' + id);
  _themeColorCache = {}; // accent changed --gold etc — drop cached colors
}
function _updateAccentUI(id){
  document.querySelectorAll('#accentSwatches [data-accent]').forEach(el => {
    const active = el.dataset.accent === id;
    el.classList.toggle('active', active);
    el.setAttribute('aria-checked', active ? 'true' : 'false');
  });
}
function renderAccentSwatches(){
  const wrap = document.getElementById('accentSwatches');
  if(!wrap) return;
  wrap.innerHTML = '';
  const cur = _currentAccent();
  ACCENTS.forEach(a => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'accent-swatch' + (a.id === cur ? ' active' : '');
    b.dataset.accent = a.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', a.id === cur ? 'true' : 'false');
    const swatchName = t({ar: a.name, en: a.nameEn});
    b.setAttribute('aria-label', swatchName);
    b.title = swatchName;
    b.style.background = 'linear-gradient(150deg,' + a.c1 + ',' + a.c2 + ')';
    b.style.setProperty('--sw-on', a.on);
    b.onclick = () => setAccent(a.id);
    b.onkeydown = (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); setAccent(a.id); } };
    wrap.appendChild(b);
  });
}
function setAccent(id){
  if(_ACCENT_IDS.indexOf(id) === -1) id = 'gold';
  const key = _accentKey(_accentBucket()); // write into the active theme's bucket
  try{
    if(id === 'gold') localStorage.removeItem(key);
    else localStorage.setItem(key, id);
  }catch(e){}
  applyAccent();
  _updateAccentUI(id);
  // canvas charts bake some theme colors at draw time — redraw so any accent-tinted
  // pixels stay in sync (cheap, and future-proofs charts that adopt --gold)
  if(typeof renderChart === 'function') renderChart();
  if(typeof renderPieChart === 'function') renderPieChart();
}
function initAccent(){
  applyAccent();
}

function todayISO(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// Timestamp for a transaction on the chosen date at the current time, INCLUDING
// milliseconds — so two entries within the same second still get distinct,
// correctly-ordered ts values (the sort's id tiebreaker covers any exact-ms tie).
const MIN_TX_TS = new Date('2010-01-01T00:00:00').getTime(); // matches the date pickers' min=
function buildTxTs(dateVal){
  const now = new Date();
  const ts = new Date(dateVal + 'T' + now.toTimeString().slice(0,8)).getTime();
  if(!isFinite(ts)) return Date.now(); // guard against an invalid date string
  // never allow a future ts (clock skew / DST edge) — it would sort above
  // everything and corrupt "this month" filters. Edit path already caps; do it here too.
  // Also floor at 2010 so a programmatically-set out-of-range date (the HTML min=
  // attribute is only an input-side hint) can't store a tiny/negative ts that would
  // pin the entry to the top of every list and skew monthly filters.
  return Math.max(MIN_TX_TS, Math.min(ts + now.getMilliseconds(), now.getTime()));
}

// Cap all date pickers at today so a transaction can't be accidentally future-dated
function capDateInputsToToday(){
  const t = todayISO();
  ['dateInput','editDate','transferDate'].forEach(id=>{
    const el = document.getElementById(id);
    if(el){ el.setAttribute('max', t); el.setAttribute('min', '2010-01-01'); }
  });
}

/* ============================================================
   STORAGE
============================================================ */
async function loadState(){
  state.wallets = {};
  WALLET_DEFS.forEach(w => state.wallets[w.id] = 0);
  state.transactions = [];
  state.crisisMode = false;

  let _lsHadBalances = false;
  try{
    const bal = localStorage.getItem(LS_PREFIX + 'balances');
    if(bal){
      const saved = JSON.parse(bal);
      // only restore known wallet ids — prevents orphaned keys from corrupted imports.
      _restoreWalletBalances(saved);
      _lsHadBalances = true;
    }
  }catch(e){}

  let _lsHadConfig = false;
  try{
    const cfg = localStorage.getItem(LS_PREFIX + 'config');
    if(cfg){
      const c = JSON.parse(cfg);
      state.crisisMode = !!c.crisisMode;
      autoDistribute = !!c.autoDistribute;
      if(c.budgets && typeof c.budgets === 'object'){
        budgets = {};
        WALLET_DEFS.forEach(w => {
          const v = parseFloat(c.budgets[w.id]);
          if(isFinite(v) && v > 0) budgets[w.id] = v;
        });
      }
      if(c.distribution && Array.isArray(c.distribution) && c.distribution.length){
        // sanitizeDistribution also clamps/validates each pct (a raw filter would
        // let a NaN/negative/string pct from a tampered config into the money math)
        DISTRIBUTION = sanitizeDistribution(c.distribution);
      }
      dismissedRecurring = new Set(Array.isArray(c.dismissedRecurring) ? c.dismissedRecurring : []);
      if(c.deletedTxIds && typeof c.deletedTxIds === 'object') deletedTxIds = c.deletedTxIds;
      if(c.deletedSubIds && typeof c.deletedSubIds === 'object') deletedSubIds = c.deletedSubIds;
      if(c.deletedWalletDefIds && typeof c.deletedWalletDefIds === 'object') deletedWalletDefIds = c.deletedWalletDefIds;
      _lsHadConfig = true;
    }
  }catch(e){}

  const _validTx = arr => (Array.isArray(arr) ? arr : []).filter(isValidTx);

  // ── Transactions: IndexedDB is the PRIMARY store (scales far past localStorage's
  //    ~5MB cap). localStorage may still hold a legacy copy from older versions or
  //    an IDB-unavailable fallback — used only when newer than the IDB snapshot. ──
  // Wrapped (unlike a plain read) because some locked-down browsers (e.g. old Safari
  // private mode) throw on EVERY localStorage call, not just setItem — an uncaught
  // throw here would reject loadState() and leave the splash screen stuck for 6s
  // until the fatal-error watchdog kicks in, instead of degrading to IDB-only state.
  let _lsLastEdit = 0, _lsDataEdit = 0;
  try{ _lsLastEdit = parseInt(localStorage.getItem(LS_PREFIX + 'lastEdit') || '0', 10) || 0; }catch(e){}
  // Prefer dataEdit (bumped only by real DATA changes) so a pref-only save that
  // bumped lastEdit can't make a stale localStorage tx blob win over fresher IDB.
  // Fall back to lastEdit only when dataEdit is absent (legacy migration path).
  try{ _lsDataEdit = parseInt(localStorage.getItem(LS_PREFIX + 'dataEdit') || '0', 10) || 0; }catch(e){}
  const _idb = await idbRestore(); // also opens the DB, setting _idbAvailable
  const _idbTime = (_idb && typeof _idb.savedAt === 'number' && isFinite(_idb.savedAt)) ? _idb.savedAt : 0;
  // "IDB snapshot is strictly newer than every localStorage stamp" can only mean
  // a localStorage save FAILED (quota full / locked down) while its paired
  // idbBackup succeeded — every successful save writes the same ts to both.
  // In that state a localStorage key can be present yet silently STALE, so
  // "present" alone must not win: prefer the IDB copy for the small data too
  // (balances/config/wallet defs/subscriptions below), otherwise the user's
  // last edits quietly revert on reload despite the "saved to the backup
  // copy" toast having promised otherwise.
  const _idbFresher = _idbTime > Math.max(_lsDataEdit, _lsLastEdit);
  // Recover custom wallet definitions from IndexedDB if localStorage's copy was
  // wiped OR corrupted (_walletDefsLoadFailed) — same wipe-recovery pattern as
  // driveClientId/subscriptions below. Must happen before _validTx/balance-restore
  // loops run (just below) so a custom wallet's transactions and balance aren't
  // silently dropped as "unknown wallet".
  if(_idb && Array.isArray(_idb.walletDefs) && (_walletDefsLoadFailed || _idbFresher || !localStorage.getItem(LS_PREFIX + 'walletDefs'))){
    const _cleanWD = sanitizeWalletDefs(_idb.walletDefs);
    if(_cleanWD){
      // union the IDB tombstones BEFORE applyWalletDefs — with localStorage wiped,
      // the config-blob seed at parse time found nothing, and applyWalletDefs
      // would otherwise re-insert a default wallet the user deleted.
      _unionTombstoneMap(deletedWalletDefIds, _idb.deletedWalletDefIds);
      applyWalletDefs(_cleanWD);
      WALLET_DEFS.forEach(w => { if(state.wallets[w.id] === undefined) state.wallets[w.id] = 0; });
      _restoreWalletBalances(_idb.wallets);
      try{ localStorage.setItem(LS_PREFIX + 'walletDefs', JSON.stringify(WALLET_DEFS)); }catch(e){}
    }
  } else if(_walletDefsLoadFailed){
    // Corrupted locally and no usable IDB copy to recover from — the app is
    // about to fall back to default wallets, so say so instead of silently
    // dropping the user's custom wallet setup with zero indication why.
    toast(t({ar:'⚠ تعذّرت قراءة بيانات المحافظ محليًا — تم الرجوع للمحافظ الافتراضية', en:'⚠ Could not read wallet data locally — fell back to default wallets'}), true);
  }
  let _lsTx = null;
  try{ const raw = localStorage.getItem(LS_PREFIX + 'transactions'); if(raw) _lsTx = JSON.parse(raw); }catch(e){}
  const _idbHasTx = _idb && Array.isArray(_idb.transactions);
  const _lsTxNewer = Array.isArray(_lsTx) && (_lsDataEdit || _lsLastEdit) > _idbTime;

  if(_idbHasTx && !_lsTxNewer){
    // IndexedDB snapshot is the source of truth
    state.transactions = _validTx(_idb.transactions);
    // Recover the small data too when localStorage was wiped — or when its keys
    // are present but STALE (_idbFresher: the last ls save failed on quota while
    // the IDB mirror succeeded; see the _idbFresher comment above).
    if(!_lsHadBalances || _idbFresher) _restoreWalletBalances(_idb.wallets);
    if(!_lsHadConfig || _idbFresher){
      if(typeof _idb.crisisMode === 'boolean') state.crisisMode = _idb.crisisMode;
      if(typeof _idb.autoDistribute === 'boolean') autoDistribute = _idb.autoDistribute;
      if(_idb.budgets && typeof _idb.budgets === 'object') budgets = sanitizeBudgets(_idb.budgets);
      if(Array.isArray(_idb.dismissedRecurring)) dismissedRecurring = new Set(_idb.dismissedRecurring);
      if(_idb.distribution && Array.isArray(_idb.distribution)) DISTRIBUTION = sanitizeDistribution(_idb.distribution);
    }
    if(_idb.deletedTxIds && typeof _idb.deletedTxIds === 'object' && !Array.isArray(_idb.deletedTxIds)){
      _unionTombstoneMap(deletedTxIds, _idb.deletedTxIds);
    }
    _unionTombstoneMap(deletedSubIds, _idb.deletedSubIds);
    _unionTombstoneMap(deletedWalletDefIds, _idb.deletedWalletDefIds);
    if(Array.isArray(_idb.subscriptions)){
      try{ localStorage.setItem(LS_PREFIX + 'subs', JSON.stringify(_idb.subscriptions)); }catch(e){}
    }
    // Same recovery for the Drive client id: without this, a wiped localStorage
    // makes driveClientId read back empty, initDrive() silently no-ops (its whole
    // body is gated on `if(driveClientId)`), and Drive sync turns itself off with
    // zero indication — the user just stops syncing and has no idea why. Restoring
    // it (but never the OAuth token, which has its own cookie fallback) lets
    // initDrive() detect "Drive was connected" and surface a normal reconnect prompt.
    if(_idb.driveClientId && !localStorage.getItem(LS_PREFIX + 'driveClientId')){
      try{ localStorage.setItem(LS_PREFIX + 'driveClientId', _idb.driveClientId); }catch(e){}
    }
    if(!_lsHadBalances && state.transactions.length) toast(t({ar:'✓ تمت استعادة البيانات من النسخ الاحتياطي', en:'✓ Data restored from backup'}));
  } else if(Array.isArray(_lsTx)){
    // Legacy localStorage copy (older version) or IDB unavailable — adopt it; the
    // idbBackup below migrates it into IndexedDB.
    state.transactions = _validTx(_lsTx);
  }

  // Drop any tx that's tombstoned (deleted on another device that synced its
  // delete) and prune expired tombstones so the set stays bounded.
  pruneTombstones();
  if(Object.keys(deletedTxIds).length){
    state.transactions = state.transactions.filter(t => !deletedTxIds[t.id]);
  }

  // A restored snapshot may contain a half-surviving linked group (one leg of a
  // transfer/distribution dropped by the validity filter). Clear the dangling
  // link so a later delete doesn't try to cascade to a partner that isn't there.
  stripOrphanLinks(state.transactions);
  if(typeof stripOrphanedDistributionLegs === 'function'){
    const _now = Date.now();
    stripOrphanedDistributionLegs(state.transactions).forEach(t => { deletedTxIds[t.id] = _now; });
  }
  _allTxSortedCache = null; // freshly replaced array — drop the sorted cache

  // If the DB couldn't be opened (blocked by another tab / corrupt) and we ended up
  // with NO transactions despite having used the app before, the data is intact in
  // IDB but unreachable. Warn the user and DO NOT run idbBackup — writing our empty
  // in-memory state could clobber the real snapshot if the DB becomes writable.
  const _hadPriorData = _lsLastEdit > 0 || _lsDataEdit > 0 || _lsHadBalances;
  const _idbLockedOut = _idbOpenFailed && state.transactions.length === 0 && _hadPriorData;
  if(_idbLockedOut){
    try{ toast(t({ar:'⚠ تعذّر فتح قاعدة البيانات — أغلق نسخ التطبيق الأخرى المفتوحة ثم أعد التحميل', en:'⚠ Could not open the database — close other open copies of the app, then reload'}), true); }catch(e){}
  }

  // Persist the consistent state into IndexedDB, then (only once confirmed) drop the
  // big legacy localStorage transactions key to free the ~5MB quota for small data.
  const _backupStamp = Math.max(_lsLastEdit, _idbTime) || Date.now();
  const _idbOk = _idbLockedOut ? false : await idbBackup(_backupStamp);
  if(_idbOk && _lsTx !== null){
    try{ localStorage.removeItem(LS_PREFIX + 'transactions'); }catch(e){}
  }

  // trackLinkMode (debit/credit direction for tracked wallets) is normally only
  // read once at startup via loadLayoutPrefs(), but it directly feeds balance
  // math (trackModeFor/applyTxToBalance). The cross-tab storage listener calls
  // loadState() for any data-relevant key — including this one — so without
  // re-reading it here a second tab keeps computing totals with a stale mode
  // after the first tab changes it, until a hard page reload.
  try{ trackLinkMode = sanitizeTrackLinkMode(JSON.parse(localStorage.getItem(LS_PREFIX + 'trackLinkMode') || 'null')); }
  catch(e){}

  _ensureReserveShare();

  _txMutationStamp++; // fresh data set loaded — invalidate any derived caches
  const _di = document.getElementById('dateInput');
  if(_di) _di.value = todayISO();
  capDateInputsToToday();
  loadSubs(_idb, _idbFresher);
  // Rebuild the wallet dropdown to match the restored crisis-mode state — if the
  // app last closed in crisis mode, SELECTABLE_WALLETS must exclude the hidden wallets.
  recomputeSelectableWallets();
  render(true);
}

// Multi-device union merge: combine local + cloud transactions/subscriptions by id
// (so a transaction added on either device is never lost), honor tombstones from
// BOTH sides (so a deletion on either device propagates instead of resurrecting),
// then recompute balances from the merged ledger (0 + Σ — the app's model). Config
// (crisis/budgets/distribution/prefs) is taken from whichever side edited last.
// Returns {added, removed} counts for an informative toast.
function mergeCloudData(cloud, cloudNewer){
  // 0) wallet defs — additive id union FIRST (unconditionally, regardless of
  //    cloudNewer) so a wallet added on the OTHER device is already known
  //    locally before validTx below runs; otherwise its transactions would be
  //    silently rejected as "unknown wallet" and lost on this device.
  // union wallet-def tombstones from the cloud FIRST so both the "add cloud-only
  // defs" step below and the local-removal step after the tx merge see them
  _unionTombstoneMap(deletedWalletDefIds, cloud.deletedWalletDefIds);
  const cloudWD = Array.isArray(cloud.walletDefs) ? sanitizeWalletDefs(cloud.walletDefs) : null;
  if(cloudWD){
    const localIds = new Set(WALLET_DEFS.map(w => w.id));
    // a def that exists only on the cloud AND is tombstoned is a deletion still
    // propagating — re-adding it here is exactly the resurrection bug
    const onlyOnCloud = cloudWD.filter(w => !localIds.has(w.id) && !deletedWalletDefIds[w.id]);
    if(onlyOnCloud.length){
      const merged = WALLET_DEFS.concat(onlyOnCloud);
      applyWalletDefs(merged);
      onlyOnCloud.forEach(w => { if(state.wallets[w.id] === undefined) state.wallets[w.id] = 0; });
      // Reassign (not push) — computeRenderSig() caches the distribution signature by
      // object-reference equality and only re-stringifies when the reference changes;
      // an in-place push() here would silently keep the stale cached signature, so a
      // wallet synced in from another device could fail to show its new 0% share
      // until something else happens to force a full render.
      if(!cloudNewer){
        const newEntries = onlyOnCloud.filter(w => !DISTRIBUTION.find(d => d.id === w.id)).map(w => ({id: w.id, pct: 0}));
        if(newEntries.length) DISTRIBUTION = DISTRIBUTION.concat(newEntries);
      }
    }
    // Renames/reordering: only adopted from the side that edited most recently —
    // names/order are config-like, not additive data, same rule as step 5 below.
    if(cloudNewer){
      const cloudById = new Map(cloudWD.map(w => [w.id, w]));
      const renamed = WALLET_DEFS.map(w => {
        const cw = cloudById.get(w.id);
        return cw ? {...w, name: cw.name} : w;
      });
      // order: cloud ids first (in cloud order), then any local-only ids appended
      // at the end so a wallet added locally isn't dropped just because the cloud
      // snapshot predates it.
      const byId = new Map(renamed.map(w => [w.id, w]));
      const ordered = [];
      cloudWD.forEach(cw => { const w = byId.get(cw.id); if(w){ ordered.push(w); byId.delete(cw.id); } });
      byId.forEach(w => ordered.push(w));
      applyWalletDefs(ordered);
    }
  }

  const validTx = isValidTx;

  // 1) union tombstones from both sides
  if(cloud.deletedTxIds && typeof cloud.deletedTxIds === 'object'){
    _unionTombstoneMap(deletedTxIds, cloud.deletedTxIds);
  }
  pruneTombstones();

  // 2) union transactions by id (local first, then cloud fills in the rest),
  //    skipping anything tombstoned on either side so deletes win over a stale copy.
  //    When an id exists on both sides, the copy with the newer editedAt wins (an
  //    edit made on one device after the last sync should overwrite the stale
  //    other-device copy); if either side lacks editedAt (data synced before this
  //    field existed) local keeps winning, same as before.
  const localCount = state.transactions.length;
  const byId = new Map();
  state.transactions.forEach(t => { if(validTx(t) && !deletedTxIds[t.id]) byId.set(t.id, t); });
  // Local rows a remote delete removes — keep the actual tx objects (not just a
  // count) so their tracked-wallet effects can be REVERSED below; regular-wallet
  // effects self-heal via reconcileBalances(), track wallets don't.
  const removedTxs = state.transactions.filter(t => deletedTxIds[t.id]);
  let removed = removedTxs.length;
  let added = 0;
  const addedTxs = [];
  const replacedTxs = []; // {before, after} pairs from editedAt-newer conflict wins
  (Array.isArray(cloud.transactions) ? cloud.transactions : []).forEach(t => {
    if(!validTx(t) || deletedTxIds[t.id]) return;
    const local = byId.get(t.id);
    if(!local){ byId.set(t.id, t); added++; addedTxs.push(t); return; }
    if(typeof t.editedAt === 'number' && typeof local.editedAt === 'number' && t.editedAt > local.editedAt){
      // Preserve the local link if the incoming version lost it (e.g. older snapshot
      // from before distribution ran).  Without this guard a Drive sync arriving
      // seconds after runDistribution would strip the link, turning the income source
      // into a standalone tx whose delete later orphans the withdrawal+deposits.
      let winner = local.link && !t.link ? {...t, link: local.link} : t;
      // Same guard for the tracked-wallet link: these fields are set at creation
      // and never removed by an edit (saveEdit mutates in place), so an incoming
      // copy lacking them is a stale snapshot, not a deliberate unlink — losing
      // them would silently stop this expense from moving its tracked counter.
      if(local.trackWallet && typeof local.trackSign === 'number' && winner.trackWallet === undefined){
        winner = {...winner, trackWallet: local.trackWallet, trackSign: local.trackSign};
      }
      byId.set(t.id, winner);
      replacedTxs.push({ before: local, after: winner });
    }
  });
  state.transactions = [...byId.values()];
  // Converge tracked-wallet balances with the merged ledger deltas. Without this,
  // an adjustment/track-linked tx from another device appeared in the list but
  // this device's displayed Uber/Cards/Cash balance never moved (and a remote
  // deletion of one never un-moved it) — permanent cross-device divergence.
  removedTxs.forEach(t => _applyTrackEffects(t, -1));
  addedTxs.forEach(t => _applyTrackEffects(t, +1));
  replacedTxs.forEach(r => { _applyTrackEffects(r.before, -1); _applyTrackEffects(r.after, +1); });
  stripOrphanLinks(state.transactions);
  if(typeof stripOrphanedDistributionLegs === 'function'){
    const _now = Date.now();
    stripOrphanedDistributionLegs(state.transactions).forEach(t => { deletedTxIds[t.id] = _now; });
  }
  _allTxSortedCache = null;

  // 3b) apply wallet-def tombstones to LOCAL defs, now that the merged ledger is
  //     known: drop a tombstoned local def only when nothing references it —
  //     no transactions and a zero balance ('core' is structural, never dropped).
  //     A tombstoned wallet that still holds data keeps living on this device;
  //     data beats a stale deletion.
  {
    const doomed = [];
    WALLET_DEFS.forEach(w => {
      if(!deletedWalletDefIds[w.id]) return;
      const hasData = w.id === 'core' || Math.abs(state.wallets[w.id] || 0) > 0 ||
        state.transactions.some(t => t.wallet === w.id);
      // tombstoned but still holding data → legitimately alive on this device;
      // clear the local tombstone so it stops being treated as pending-delete.
      if(hasData) delete deletedWalletDefIds[w.id];
      else doomed.push(w);
    });
    if(doomed.length){
      const doomedIds = new Set(doomed.map(w => w.id));
      applyWalletDefs(WALLET_DEFS.filter(w => !doomedIds.has(w.id)));
      doomed.forEach(w => { delete state.wallets[w.id]; delete budgets[w.id]; delete trackLinkMode[w.id]; });
      DISTRIBUTION = DISTRIBUTION.filter(d => !doomedIds.has(d.id));
    }
  }

  // 4) merge subscriptions by id (union; cloud wins on a true id clash),
  //    skipping anything tombstoned on either side so deletes propagate
  //    instead of ping-ponging back from the other device's copy.
  _unionTombstoneMap(deletedSubIds, cloud.deletedSubIds);
  const subById = new Map();
  subscriptions.forEach(s => { if(!deletedSubIds[s.id]) subById.set(s.id, s); });
  (Array.isArray(cloud.subscriptions) ? cloud.subscriptions : []).forEach(s => {
    if(s && s.id && s.name && isFinite(s.amount) && s.amount > 0 && !deletedSubIds[s.id]) subById.set(s.id, _normalizeSub(s));
  });
  subscriptions = [...subById.values()];

  // 5) config from the side that edited most recently
  if(cloudNewer){
    if(typeof cloud.crisisMode === 'boolean') state.crisisMode = cloud.crisisMode;
    if(typeof cloud.autoDistribute === 'boolean') autoDistribute = cloud.autoDistribute;
    if(cloud.budgets && typeof cloud.budgets === 'object') budgets = sanitizeBudgets(cloud.budgets);
    if(cloud.distribution && Array.isArray(cloud.distribution)) DISTRIBUTION = sanitizeDistribution(cloud.distribution);
    if(cloud.uiPrefs && typeof applyUiPrefs === 'function') applyUiPrefs(cloud.uiPrefs);
  }
  // dismissedRecurring: union both sides (a dismissal on either device sticks)
  if(Array.isArray(cloud.dismissedRecurring)) cloud.dismissedRecurring.forEach(k => dismissedRecurring.add(k));

  _ensureReserveShare();

  // 6) rebuild balances from the merged ledger so they're provably consistent
  reconcileBalances();
  _txMutationStamp++;
  prevSpendable = null;
  return { added, removed, hadLocal: localCount };
}

// Apply ONLY the tracked-wallet effects of a transaction to state.wallets —
// the track-wallet subset of applyTxToBalance (app.logic.js). Used by
// mergeCloudData: reconcileBalances() below rebuilds regular wallets from the
// merged ledger but deliberately skips track wallets, so a tx merged in FROM
// ANOTHER DEVICE (an adjustment on Uber/Cards/Cash, or a track-linked expense)
// used to land in the transaction list without ever moving this device's
// displayed track balance — the two devices never converged until a wholesale
// snapshot adoption. sign: +1 to apply (tx merged in), -1 to reverse (tx
// removed by a propagated deletion).
function _applyTrackEffects(tx, sign){
  if(!tx || !isFinite(tx.amount) || tx.amount <= 0) return;
  const w = WALLET_DEFS.find(x => x.id === tx.wallet);
  if(w && w.track){
    const delta = (tx.type === 'expense' ? -tx.amount : tx.amount) * sign;
    state.wallets[w.id] = round2((state.wallets[w.id] ?? 0) + delta);
  }
  // secondary link effect — same semantics as applyTxToBalance's trackSign math
  if(tx.trackWallet && typeof tx.trackSign === 'number'){
    const tw = WALLET_DEFS.find(x => x.id === tx.trackWallet && x.track);
    if(tw){
      const dir = (tx.type === 'expense' ? tx.trackSign : -tx.trackSign) * sign;
      state.wallets[tw.id] = round2((state.wallets[tw.id] ?? 0) + dir * tx.amount);
    }
  }
}

// Recompute every (non-track) wallet balance purely from the transaction ledger
// (model: balance = 0 + Σ ledger; an expense subtracts, income/adjustment adds).
// Source of truth is the ledger, so this self-heals any drift between the stored
// balances and the transactions (from a crash mid-write, a tampered backup, or a
// rounding bug). Returns a {id: delta} diff of what changed, applies nothing
// destructive on its own beyond setting state.wallets — caller decides to persist.
// Track wallets (Uber/Cards/Cash) are skipped — their balance is intentionally
// maintained manually (see checkBalanceDrift) and can legitimately diverge from
// the ledger (real-world fees/interest never entered as a transaction). Without
// this exclusion, an automatic background Drive merge would silently blow away a
// manually-set tracked balance back to the ledger sum.
function reconcileBalances(){
  const computed = {}, diff = {};
  WALLET_DEFS.forEach(w => { if(!w.track) computed[w.id] = 0; }); // baseline 0 per the app's model
  state.transactions.forEach(tx => {
    if(computed[tx.wallet] === undefined) return; // skip unknown/track wallet ids
    const amt = parseFloat(tx.amount);
    if(!isFinite(amt)) return;
    computed[tx.wallet] = round2(computed[tx.wallet] + (tx.type === 'expense' ? -amt : amt));
  });
  WALLET_DEFS.forEach(w => {
    if(w.track) return; // leave manually-tracked balances untouched
    const before = parseFloat(state.wallets[w.id]) || 0;
    const after = computed[w.id];
    if(Math.abs(after - before) >= 0.005) diff[w.id] = round2(after - before);
    state.wallets[w.id] = after;
  });
  return diff;
}

// dataEdit marks the last change to actual user DATA (balances/transactions/subs),
// distinct from lastEdit which any save (incl. config/prefs) bumps. Drive conflict
// resolution compares dataEdit so a pref-only change (crisis toggle, layout) can't
// make a stale local copy "win" over fresher cloud transaction data.
function stampDataEdit(ts){ try{ localStorage.setItem(LS_PREFIX + 'dataEdit', String(ts)); }catch(e){} }
async function saveBalances(){
  const ts = Date.now();
  let lsOk = false;
  try{
    localStorage.setItem(LS_PREFIX + 'balances', JSON.stringify(state.wallets));
    localStorage.setItem(LS_PREFIX + 'lastEdit', String(ts));
    lsOk = true;
  }catch(e){
    toast(t({ar:'⚠ فشل الحفظ المحلي — يتم الحفظ في النسخة الاحتياطية', en:'⚠ Local save failed — saving to the backup copy'}), true);
  }
  if(lsOk) stampDataEdit(ts);
  scheduleDriveSync();
  scheduleIdbBackup(ts);
}
async function saveTx(){
  _allTxSortedCache = null;
  const ts = Date.now();
  // Transactions are stored in IndexedDB (idbBackup below) so they scale far past
  // the ~5MB localStorage cap. Here we only stamp the small timestamps. If IDB is
  // unavailable, idbBackup() mirrors the array to localStorage as a fallback.
  try{ localStorage.setItem(LS_PREFIX + 'lastEdit', String(ts)); }catch(e){}
  stampDataEdit(ts);
  scheduleDriveSync();
  scheduleIdbBackup(ts);
}
function _pruneRecurringDismissals(){
  if(dismissedRecurring.size < 40) return;
  // dismissal keys are "desc\x00walletId" (see detectRecurring, which keys on
  // normalizeSearch(desc)) — build the live set with the SAME shape, otherwise
  // NONE of the keys ever match and we wipe every dismissal at once, making
  // dismissed suggestions reappear.
  const live = new Set(
    state.transactions
      .map(tx => normalizeSearch(tx.desc) + '\x00' + tx.wallet)
      .filter(k => k.charAt(0) !== '\x00') // drop empty-description keys
  );
  for(const k of dismissedRecurring){ if(!live.has(k)) dismissedRecurring.delete(k); }
  // Hard cap so a user with 200+ unique recurring patterns never exhausts localStorage
  // quota (all keys match live transactions so the live-set pruning above removes nothing)
  while(dismissedRecurring.size > 200) dismissedRecurring.delete(dismissedRecurring.values().next().value);
}
async function saveConfig(){
  const ts = Date.now();
  _pruneRecurringDismissals();
  pruneTombstones();
  let ok = false;
  try{
    localStorage.setItem(LS_PREFIX + 'config', JSON.stringify({crisisMode: state.crisisMode, autoDistribute: autoDistribute, budgets: budgets, dismissedRecurring: Array.from(dismissedRecurring), distribution: DISTRIBUTION, deletedTxIds: deletedTxIds, deletedSubIds: deletedSubIds, deletedWalletDefIds: deletedWalletDefIds}));
    localStorage.setItem(LS_PREFIX + 'lastEdit', String(ts));
    ok = true;
  }catch(e){ toast(t({ar:'⚠ فشل حفظ الإعدادات محليًا', en:'⚠ Failed to save settings locally'}), true); }
  scheduleDriveSync();
  scheduleIdbBackup(ts);
  return ok;
}
// clamp a subscription's billing day into 1–31 so corrupt data can't produce
// "يوم 99" that never matches the daily-review check
function _normalizeSub(x){
  let d = parseInt(x.billingDay, 10);
  if(!isFinite(d)) d = 1;
  x.billingDay = Math.min(31, Math.max(1, d));
  return x;
}
function loadSubs(idbSnapshot, preferIdb){
  // preferIdb: the IDB snapshot is strictly newer than every localStorage stamp
  // (a quota-failed ls save — see loadState's _idbFresher), so a present-but-
  // stale ls 'subs' key must not win over the successfully-mirrored IDB copy.
  if(preferIdb && idbSnapshot && Array.isArray(idbSnapshot.subscriptions)){
    subscriptions = idbSnapshot.subscriptions
      .filter(x => x && x.id && x.name && isFinite(x.amount) && x.amount > 0)
      .map(_normalizeSub);
    return;
  }
  try{
    const s = localStorage.getItem(LS_PREFIX + 'subs');
    if(s) subscriptions = JSON.parse(s)
      .filter(x => x && x.id && x.name && isFinite(x.amount) && x.amount > 0)
      .map(_normalizeSub);
  }catch(e){
    // localStorage's 'subs' key is corrupted (e.g. a crash mid-write) — fall back
    // to the IndexedDB snapshot's copy (idbBackup mirrors subscriptions into it on
    // every save) instead of silently wiping the user's recurring subscriptions.
    if(idbSnapshot && Array.isArray(idbSnapshot.subscriptions) && idbSnapshot.subscriptions.length){
      subscriptions = idbSnapshot.subscriptions
        .filter(x => x && x.id && x.name && isFinite(x.amount) && x.amount > 0)
        .map(_normalizeSub);
      toast(t({ar:'⚠ تعذّرت قراءة الاشتراكات محليًا — تم استرجاعها من النسخة الاحتياطية', en:'⚠ Could not read subscriptions locally — recovered from the backup copy'}), true);
    } else {
      subscriptions = [];
      toast(t({ar:'⚠ تعذّرت قراءة الاشتراكات المحفوظة، تم البدء بقائمة فارغة', en:'⚠ Could not read saved subscriptions — starting with an empty list'}), true);
    }
  }
}
async function saveSubs(){
  const ts = Date.now();
  // stamp dataEdit ONLY if the data write itself succeeded (same rule as
  // saveBalances): loadState detects a quota-failed save by "IDB savedAt is
  // newer than every localStorage stamp" — stamping here on failure would
  // advance the ls stamp and mask exactly the condition it needs to see.
  let lsOk = false;
  try{ localStorage.setItem(LS_PREFIX + 'subs', JSON.stringify(subscriptions)); lsOk = true; }catch(e){ toast(t({ar:'⚠ فشل حفظ الاشتراكات محليًا', en:'⚠ Failed to save subscriptions locally'}), true); }
  if(lsOk) stampDataEdit(ts);
  scheduleDriveSync();
  scheduleIdbBackup(ts);
}
async function saveWalletDefs(){
  const ts = Date.now();
  // stamp-on-success-only: see saveSubs above
  let lsOk = false;
  try{ localStorage.setItem(LS_PREFIX + 'walletDefs', JSON.stringify(WALLET_DEFS)); lsOk = true; }catch(e){ toast(t({ar:'⚠ فشل حفظ بيانات المحافظ محليًا', en:'⚠ Failed to save wallet data locally'}), true); }
  if(lsOk) stampDataEdit(ts);
  scheduleDriveSync();
  scheduleIdbBackup(ts);
}

/* ============================================================
   INDEXEDDB BACKUP (extra resilience alongside localStorage)
============================================================ */
let _idbInstance = null;
let _idbAvailable = false; // becomes true once the DB opens — gates IDB-primary storage
let _idbOpenPromise = null; // in-flight open() shared by concurrent early callers
function idbOpen(){
  if(_idbInstance) return Promise.resolve(_idbInstance);
  // Without this cache, two saves fired back-to-back before the FIRST-EVER open()
  // resolves (e.g. loadState's idbRestore racing an early saveBalances) would each
  // issue their own indexedDB.open() and end up with two separate connection
  // objects to the same DB — their later writes are then only ordered by whichever
  // connection's request callback the browser happens to fire first, not by call
  // order, which can let an older write silently land after a newer one.
  if(_idbOpenPromise) return _idbOpenPromise;
  _idbOpenPromise = new Promise((resolve, reject)=>{
    if(!('indexedDB' in window)){ reject('no idb'); return; }
    const req = indexedDB.open('walletTrackerDB', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('backup');
    };
    req.onsuccess = () => { _idbInstance = req.result; _idbAvailable = true; resolve(_idbInstance); };
    req.onerror   = () => reject(req.error);
    // Fires when another tab holds the DB at an older version and hasn't closed
    // it — without this the open request hangs indefinitely.
    req.onblocked = () => reject(new Error('idb blocked'));
  }).finally(() => { _idbOpenPromise = null; });
  return _idbOpenPromise;
}
// Writes the full snapshot to IndexedDB — the PRIMARY store for transactions
// (localStorage only holds the small balances/config/prefs). Returns true on a
// confirmed write so callers can safely migrate/free the legacy localStorage copy.
let _idbWriteInFlight = 0; // >0 while an IDB snapshot write is committing
async function idbBackup(savedAt){
  _idbWriteInFlight++;
  try{
    const db = await idbOpen();
    await new Promise((resolve, reject)=>{
      const tx = db.transaction('backup','readwrite');
      const store = tx.objectStore('backup');
      const getReq = store.get('snapshot');
      getReq.onsuccess = () => {
        const existing = getReq.result;
        // Two tabs of the same app can each debounce-write within the same ~400ms
        // window; without this, whichever write commits last would blindly overwrite
        // the other tab's already-persisted transactions (each tab only knows its
        // OWN in-memory copy). Union by id against whatever's currently in IDB —
        // same tombstone + newer-editedAt-wins rule as mergeCloudData — so a
        // transaction added in the other tab survives instead of being silently
        // erased. This get+put runs inside one IDB transaction, which browsers
        // serialize against the other tab's own transaction on this store, so the
        // merge sees a consistent snapshot rather than racing the read itself.
        let mergedTx = state.transactions;
        let mergedTombstones = deletedTxIds;
        if(existing && existing.deletedTxIds && typeof existing.deletedTxIds === 'object'){
          mergedTombstones = _unionTombstoneMap(Object.assign({}, deletedTxIds), existing.deletedTxIds);
          deletedTxIds = mergedTombstones;
        }
        // same cross-tab union for the sub / wallet-def tombstone maps
        if(existing){
          _unionTombstoneMap(deletedSubIds, existing.deletedSubIds);
          _unionTombstoneMap(deletedWalletDefIds, existing.deletedWalletDefIds);
        }
        if(existing && Array.isArray(existing.transactions)){
          const byId = new Map();
          state.transactions.forEach(t => { if(t && t.id && !mergedTombstones[t.id]) byId.set(t.id, t); });
          existing.transactions.forEach(t => {
            if(!t || !t.id || mergedTombstones[t.id]) return;
            const local = byId.get(t.id);
            if(!local){ byId.set(t.id, t); return; }
            if(typeof t.editedAt === 'number' && typeof local.editedAt === 'number' && t.editedAt > local.editedAt){
              // Preserve link + tracked-wallet link from local if the IDB snapshot
              // lost them (same stale-snapshot guard as mergeCloudData)
              let winner = local.link && !t.link ? {...t, link: local.link} : t;
              if(local.trackWallet && typeof local.trackSign === 'number' && winner.trackWallet === undefined){
                winner = {...winner, trackWallet: local.trackWallet, trackSign: local.trackSign};
              }
              byId.set(t.id, winner);
            }
          });
          mergedTx = [...byId.values()];
        }
        store.put({
          wallets: state.wallets,
          walletDefs: WALLET_DEFS,
          transactions: mergedTx,
          crisisMode: state.crisisMode,
          autoDistribute, budgets,
          distribution: DISTRIBUTION,
          dismissedRecurring: Array.from(dismissedRecurring),
          deletedTxIds: mergedTombstones,
          deletedSubIds: deletedSubIds,
          deletedWalletDefIds: deletedWalletDefIds,
          subscriptions: subscriptions,
          // mirrored so a wiped localStorage can still recover "Drive was connected"
          // (see loadState) instead of Drive sync silently going dark with no UI cue
          driveClientId: driveClientId,
          savedAt: (typeof savedAt === 'number' && isFinite(savedAt)) ? savedAt : Date.now()
        }, 'snapshot');
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('idb abort'));
    });
    _idbAvailable = true;
    return true;
  }catch(e){
    // IndexedDB unavailable/failed (e.g. private mode) — fall back to a localStorage
    // mirror so transactions still persist (bounded by the ~5MB quota in that case).
    _idbAvailable = false;
    try{
      localStorage.setItem(LS_PREFIX + 'transactions', JSON.stringify(state.transactions));
    }catch(_){
      // BOTH IndexedDB and the localStorage fallback failed — the latest change is
      // memory-only and will be lost on reload. This fires AFTER the optimistic
      // success toast (idbBackup runs unawaited in the background from
      // saveTx/saveBalances/etc, so render()+toast('✓ ...') already happened).
      // A plain toast() here would just overwrite/be overwritten by whatever
      // routine toast fires next (e.g. the distribution-flow toast in addTx) and
      // vanish in 2.2s — easy to miss for a data-loss-grade warning. Use
      // toastWithAction: longer-lived (5s), gives a real recovery step, and is
      // visually distinct from a routine success/error toast.
      // Re-arms every few minutes instead of firing once per session — a user
      // stuck in this state keeps losing every subsequent edit, so a one-shot
      // warning would go silent on them after the first toast while the drift
      // (unsaved changes piling up) continues unannounced.
      if(Date.now() - _persistFailWarnedAt > PERSIST_FAIL_REWARN_MS){
        _persistFailWarnedAt = Date.now();
        try{
          toastWithAction(t({ar:'⚠ تعذّر حفظ البيانات على هذا الجهاز — صدّرها الآن قبل إغلاق التطبيق', en:'⚠ Couldn\'t save data on this device — export it now before closing the app'}), t({ar:'تصدير الآن', en:'Export now'}), () => { try{ exportData(); }catch(e){} }, true);
        }catch(__){}
      }
    }
    return false;
  }finally{
    _idbWriteInFlight--;
  }
}
// saveBalances/saveTx/saveConfig/saveSubs/saveWalletDefs each fire idbBackup()
// independently, so a single user action that touches more than one (e.g.
// deleteTx → saveBalances + saveTx + saveConfig) used to write the entire
// transactions array to IndexedDB 2-3x in a row. Debounce into one coalesced
// write — flushed immediately on tab-hide/page-unload (see visibilitychange
// and beforeunload below) so a backgrounded/closed tab never loses the pending
// write entirely.
let _idbBackupTimer = null;
let _idbBackupPendingTs = 0;
function scheduleIdbBackup(ts){
  _idbBackupPendingTs = (typeof ts === 'number' && isFinite(ts)) ? ts : Date.now();
  clearTimeout(_idbBackupTimer);
  _idbBackupTimer = setTimeout(()=>{ _idbBackupTimer = null; idbBackup(_idbBackupPendingTs); }, 400);
}
function flushIdbBackup(){
  if(_idbBackupTimer){ clearTimeout(_idbBackupTimer); _idbBackupTimer = null; idbBackup(_idbBackupPendingTs); }
}
// Re-arming cooldown (not a one-shot flag) for the "could not persist" warning
// — see the toastWithAction call above for why a single lifetime-of-session
// warning isn't enough here.
const PERSIST_FAIL_REWARN_MS = 3 * 60 * 1000;
let _persistFailWarnedAt = 0;
let _idbOpenFailed = false; // true when the DB exists but couldn't be opened (blocked/corrupt)
async function idbRestore(){
  try{
    const db = await idbOpen();
    // A successful open clears any earlier failure latch — otherwise a
    // transient open failure (e.g. another tab briefly holding an older DB
    // version during startup) would permanently arm the "data locked out"
    // warning for the rest of the session even after IDB recovers.
    _idbOpenFailed = false;
    return new Promise((resolve)=>{
      const tx = db.transaction('backup','readonly');
      const req = tx.objectStore('backup').get('snapshot');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }catch(e){
    // Distinguish "IndexedDB unsupported" (expected → LS fallback) from a real open
    // failure such as onblocked (another tab holds an older version) or corruption.
    // The latter means the user's data is SAFE in IDB but unreachable right now —
    // loadState must warn rather than present an empty app and must NOT overwrite it.
    if(e !== 'no idb') _idbOpenFailed = true;
    return null;
  }
}


function toggleCrisis(){
  state.crisisMode = !state.crisisMode;
  if(walletFilter){
    const _wf = WALLET_DEFS.find(x => x.id === walletFilter);
    const _hidden = state.crisisMode
      ? crisisWalletIds().includes(walletFilter)
      : (_wf && _wf.crisisOnly);
    if(_hidden) walletFilter = null;
  }
  const _ct = document.getElementById('crisisToggle');
  if(_ct) _ct.setAttribute('aria-checked', state.crisisMode ? 'true' : 'false'); // may be hidden via layout editor
  // Rebuild the wallet dropdown so it only shows wallets visible in the current mode
  recomputeSelectableWallets();
  // crisis flips the spendable total by the reserve amount — that's not a real
  // money movement, so snap to the new value instead of count-up animating across it
  prevSpendable = null;
  saveConfig();
  render();
  haptic(15);
  toast(state.crisisMode ? t({ar:'🔄 تم تفعيل الوضع البديل', en:'🔄 Crisis mode enabled'}) : t({ar:'✓ تم إيقاف الوضع البديل', en:'✓ Crisis mode disabled'}));
}

