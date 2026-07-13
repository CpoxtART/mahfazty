/* ============================================================
   VOICE INPUT (Web Speech API)
   Split out of app.ui.js. Arabic number-word parsing, category/type
   guessing from a spoken transcript, and the mic button's recognition
   lifecycle. Only reachable via startVoiceInput(), wired in _bindEvents()
   (app.main.js) — safe to load anywhere after app.ui.js.
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
// English counterpart — added in v47.78 so an English-language user's spoken
// numbers parse too (voiceRecognition.lang now follows the app's language
// instead of being hardcoded to 'ar-SA'). Only needed for engines that
// transcribe spoken numbers as words ("fifty"); ones that already transcribe
// as digits ("50") go through the digit-detection branch below regardless of
// language. _combineNumberValues' multiply/add semantics are language-agnostic
// (tens+ones add, hundred/thousand/million multiply) so no combining-logic
// changes were needed — this is purely a word→value lookup table.
const VOICE_NUMBER_WORDS_EN = {
  zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
  eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19,
  twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90,
  hundred:100, thousand:1000, million:1000000,
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

// Shared bilingual keyword tables — used by BOTH voice input (below) and Quick
// Notes free-text parsing (app.quicknotes.js's _qnGuessCategory). Previously
// each entry point kept its own independent list: this one was Arabic-only
// with plain substring matching, while Quick Notes' was bilingual and folded
// through normalizeSearch (Arabic orthographic variants: "قهوه"/"قهوة" etc.).
// Voice was strictly weaker as a result. Unified here (v47.78) — an improved
// keyword only needs adding once, and both consumers get the same
// orthographic-variant folding via normalizeSearch. Salary words are only
// consulted for an already-income-typed row (see guessCategoryShared) since
// "راتب"/"salary" describes what the money IS, not a place it was spent.
const CATEGORY_KEYWORDS = [
  {cat:'food',          words:['عشاء','غداء','فطور','اكل','أكل','مطعم','قهوة','قهوه','كوفي','كافيه','شاي','برجر','بيتزا','وجبه','عصير','حلى','مأكولات','coffee','cafe','food','lunch','dinner','breakfast','restaurant','meal','snack','juice']},
  {cat:'transport',     words:['تكسي','تاكسي','بنزين','وقود','مواصلات','سيارة','سياره','أوبر','اوبر','كريم','باص','قطار','رحلة','رحله','تذكرة','تذكره','gas','fuel','taxi','uber','careem','transport','bus','train','ride','ticket']},
  {cat:'shopping',      words:['تسوق','سوق','ملابس','شراء','محل','متجر','حذاء','قميص','هدية','هديه','عبايه','shopping','clothes','store','mall','shoes','gift']},
  {cat:'bills',         words:['فاتورة','فاتوره','فواتير','كهرباء','ماء','مويه','انترنت','إنترنت','نت','اتصالات','موبايل','جوال','ايجار','إيجار','bill','bills','electricity','water','internet','phone','mobile','rent']},
  {cat:'health',        words:['دواء','صيدلية','صيدليه','طبيب','دكتور','مستشفى','علاج','عيادة','عياده','صحة','صحه','تحليل','pharmacy','doctor','hospital','clinic','health','medicine']},
  {cat:'entertainment', words:['سينما','ترفيه','لعبة','لعبه','العاب','ألعاب','رحلة','فيلم','اشتراك','نتفلكس','نتفليكس','game','games','cinema','movie','netflix','spotify','subscription','entertainment']},
  {cat:'salary',        words:['راتب','مرتب','دخل','مدخول','مكافأة','مكافاه','أجرة','اجرة','salary','income','wage','payroll','bonus']},
];
// income detection: a line/transcript is income if it names an income-type
// concept, independent of category (a raw "+" marker also triggers income in
// Quick Notes, checked separately there — this list is just the word side).
const INCOME_KEYWORDS = ['استلمت','استقبلت','دخل','راتب','مرتب','مدخول','ربحت','كسبت','حولوا لي','حول لي','حولني','حولولي','وصلني','وصل لي','وصلتني','جاني','جاتني','جانا','هدية','هديه','مكافأة','مكافاه','بونص','عائد','فائدة','أرسلوا لي','ارسلولي','ايداع','إيداع','استرجاع','salary','income','deposit','refund','bonus','payroll','wage'];
// Shared category guess: normalizeSearch-folds both the haystack and each
// keyword so Arabic orthographic variants and casing match identically for
// every consumer. type is only used to gate the salary group (see comment
// above); pass null/omit if the caller doesn't track a type yet.
function guessCategoryShared(text, type){
  const d = normalizeSearch(text);
  if(!d) return null;
  for(const grp of CATEGORY_KEYWORDS){
    if(grp.cat === 'salary' && type !== 'income') continue;
    if(grp.words.some(w => d.includes(normalizeSearch(w)))) return grp.cat;
  }
  return null;
}
function isIncomeTextShared(text){
  const d = normalizeSearch(text);
  return !!d && INCOME_KEYWORDS.some(w => d.includes(normalizeSearch(w)));
}

function parseArabicNumber(text){
  // Tokenize the ORIGINAL transcript FIRST, then normalize each token.
  // normalizeDigits strips ALL whitespace (its "1 000" thousands support), so
  // normalizing the whole phrase before splitting collapsed every multi-word
  // transcript into one unparseable token — "صرفت خمسين على عشاء" became
  // "صرفتخمسينعلىعشاء" and every realistic voice phrase failed with
  // "لم يتم العثور على رقم". Per-token normalization keeps the digit/separator
  // handling without destroying the word boundaries.
  const tokens = String(text == null ? '' : text).split(/\s+/).map(normalizeDigits);
  const hits = [];               // {value, idx} — idx = LAST token index this value consumed
  let sawAny = false;
  for(let i = 0; i < tokens.length; i++){
    let raw = tokens[i];
    if(!raw) continue;
    // a token may be a digit group, possibly stuck to a scale word ("5آلاف")
    if(/^\d/.test(raw)){
      const dm = raw.match(/\d+(\.\d+)?/);
      if(dm){ hits.push({value: parseFloat(dm[0]), idx: i}); sawAny = true; raw = raw.slice(dm[0].length); }
      if(!raw) continue;
    }
    const clean = raw.replace(/[^ء-ي]/g,'');
    if(clean){
      // two-token compounds ("احد عشر" = 11) — must be tried BEFORE the single
      // word, or "عشر" (10) claims the second token and the pair reads as 10
      const _next = i + 1 < tokens.length ? String(tokens[i+1]).replace(/[^ء-ي]/g,'') : '';
      if(_next && VOICE_NUMBER_WORDS[clean + ' ' + _next] !== undefined){
        hits.push({value: VOICE_NUMBER_WORDS[clean + ' ' + _next], idx: i+1}); sawAny = true; i++; continue;
      }
      if(VOICE_NUMBER_WORDS[clean] !== undefined){ hits.push({value: VOICE_NUMBER_WORDS[clean], idx: i}); sawAny = true; continue; }
      // strip a leading connective و ("وعشرين" → "عشرين") and retry — but only when
      // the remainder is itself a number word, so real words like "واحد" stay intact
      if(clean.length > 2 && clean[0] === 'و' && VOICE_NUMBER_WORDS[clean.slice(1)] !== undefined){
        hits.push({value: VOICE_NUMBER_WORDS[clean.slice(1)], idx: i}); sawAny = true; continue;
      }
    }
    // English words — a separate pass (not merged with the Arabic one above)
    // since the Arabic filter strips Latin letters to '' and vice versa; a
    // token can only ever match one script.
    const cleanEn = raw.replace(/[^a-zA-Z]/g,'').toLowerCase();
    if(cleanEn && VOICE_NUMBER_WORDS_EN[cleanEn] !== undefined){
      hits.push({value: VOICE_NUMBER_WORDS_EN[cleanEn], idx: i}); sawAny = true;
    }
  }
  if(!sawAny) return null;
  // Group hits into RUNS of STRICTLY ADJACENT number mentions (zero tokens
  // between them) — this is what lets a genuine multi-word number like
  // "one hundred fifty" or "مية وخمسين" (the و is fused onto the following
  // token, "وخمسين", not a separate word — so these are already adjacent)
  // combine correctly via _combineNumberValues' scale semantics. A run BREAKS
  // the moment ANY other word separates two number mentions (e.g. "20 on
  // coffee and 30 on lunch" / "20 على قهوة و30 على غداء" — two DIFFERENT
  // purchases, not one combined amount): those two numbers used to get
  // silently summed into a single wrong-but-perfectly-plausible total with no
  // indication anything was off. Voice input targets ONE transaction, so only
  // the FIRST run is used — a later, clearly-separate number mention is
  // ignored rather than folded in.
  const runs = [];
  let run = [];
  for(let k = 0; k < hits.length; k++){
    if(run.length && hits[k].idx !== run[run.length-1].idx + 1){ runs.push(run); run = []; }
    run.push(hits[k]);
  }
  if(run.length) runs.push(run);
  const result = _combineNumberValues(runs[0].map(h => h.value));
  return isFinite(result) ? result : null;
}

function _guessCategory(text, type){
  return guessCategoryShared(text, type);
}

function _guessType(text){
  return isIncomeTextShared(text) ? 'income' : 'expense';
}

let voiceRecognition = null;
let _voiceTimer = null;
// Browsers without Web Speech support (notably Firefox, which implements
// neither SpeechRecognition nor webkitSpeechRecognition) would otherwise show
// a mic button that does nothing useful until tapped. Hide it up front instead
// of failing only on click, so the UI never advertises a feature that can't work.
(function hideVoiceBtnIfUnsupported(){
  // SpeechRecognition requires a secure context (HTTPS or localhost) to ever
  // actually grant microphone access — Chromium still exposes the
  // constructor on a plain-HTTP non-localhost origin, so this check alone
  // wasn't enough: the button rendered and was tappable, but the mic could
  // never be granted, and the resulting 'not-allowed' error looked
  // IDENTICAL to a real user denial (see startVoiceInput's onerror below) —
  // guidance to "allow microphone access" is unfixable/misleading when the
  // real cause is "this site isn't served over HTTPS." Hide the button
  // entirely in that case instead, matching how an unsupported browser is
  // already handled.
  if((window.SpeechRecognition || window.webkitSpeechRecognition) && window.isSecureContext) return;
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
// Set once a real mic-permission denial is observed this session — lets a
// repeat tap show the actionable message immediately instead of silently
// re-attempting .start(), which some browsers no-op after a denial (no
// onstart/onerror/onend at all) until the page reloads. Without this, a
// repeat tap after a block could look like nothing happened for the full
// 12s watchdog window, with zero explanation.
let _voiceMicDenied = false;
function startVoiceInput(){
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRecognition){
    toast(t({ar:'⚠ متصفحك لا يدعم الإدخال الصوتي', en:'⚠ Your browser does not support voice input'}), true);
    return;
  }
  if(!window.isSecureContext){
    // Distinct from a real permission denial — "allow microphone access"
    // guidance is unfixable here since there's no browser-settings toggle
    // for it; the site itself needs HTTPS. hideVoiceBtnIfUnsupported already
    // hides this button on a fresh load for this exact reason, but this is a
    // defensive fallback in case it's somehow still reachable.
    toast(t({ar:'⚠ الإدخال الصوتي يحتاج اتصالًا آمنًا (HTTPS)', en:'⚠ Voice input requires a secure (HTTPS) connection'}), true);
    return;
  }
  if(_voiceMicDenied){
    toast(t({ar:'⚠ يجب السماح بالوصول للميكروفون من إعدادات المتصفح', en:'⚠ Microphone access must be allowed from your browser settings'}), true);
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
  // Follow the app's language setting instead of a hardcoded 'ar-SA' — an
  // English-language user's speech was previously always recognized as
  // Arabic regardless of their chosen UI language.
  voiceRecognition.lang = _currentLang() === 'en' ? 'en-US' : 'ar-SA';
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
    if(e.error === 'not-allowed' || e.error === 'service-not-allowed'){
      // 'service-not-allowed' is a browser/OS/enterprise-policy block of the
      // speech recognition SERVICE itself (distinct from the user denying the
      // in-page mic permission prompt) — same actionable "allow microphone
      // access" guidance applies either way, so it shouldn't fall into the
      // generic "couldn't recognize speech" message below (which reads like
      // the user just mumbled, not that access is blocked).
      // Cache the denial for this session — see _voiceMicDenied's declaration.
      _voiceMicDenied = true;
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
    _applyVoiceTranscript(transcript);
  };

  try{ voiceRecognition.start(); }
  catch(e){ cleanup(); toast(t({ar:'⚠ تعذر بدء التعرف الصوتي', en:'⚠ Could not start voice recognition'}), true); }
}

function _applyVoiceTranscript(text){
  const amount = parseArabicNumber(text);
  // type first — _guessCategory needs it to decide whether the salary keyword
  // group applies (salary describes what the money IS, not where it was spent).
  const type = _guessType(text);
  const category = _guessCategory(text, type);

  // strip number-ish tokens from text to build a cleaner description
  let desc = text
    .replace(/\d+(\.\d+)?/g, '')
    .replace(/[٠-٩]+/g, '')
    .trim();
  // Whitespace-anchored (not a bare substring match) — same reasoning as the
  // verb/particle strip below: JS \b doesn't match around Arabic letters, and
  // without SOME anchor a number word that's also a substring of an unrelated
  // word gets eaten out of its middle (e.g. "خمسين" inside "دفعت خمسين لشراء
  // كمية" is a real number word, but "كمية" also contains "مية"/100 — an
  // unanchored strip mangled it into "ك من").
  Object.keys(VOICE_NUMBER_WORDS).forEach(w => { desc = desc.replace(new RegExp('(^|\\s)'+w+'(?=\\s|$)','g'), ' '); });
  // English number words too — \b is safe here (ASCII-only), unlike the
  // whitespace-anchor approach the Arabic particle strip below needs.
  Object.keys(VOICE_NUMBER_WORDS_EN).forEach(w => { desc = desc.replace(new RegExp('\\b'+w+'\\b','gi'), ''); });
  desc = desc.replace(/\s{2,}/g,' ').trim();
  // remove common verbs/particles. JS \b is ASCII-only so it never matches around
  // Arabic letters — use whitespace anchors instead so these are actually stripped.
  // (bare single-letter particles like "ل" are intentionally omitted — too risky to
  // strip without butchering real words.)
  ['صرفت','دفعت','اشتريت','استلمت','استقبلت','على','ريال','دينار','من'].forEach(w=>{
    desc = desc.replace(new RegExp('(^|\\s)'+w+'(?=\\s|$)','g'), ' ');
  });
  // English counterparts — \b is fine here (ASCII-only words)
  ['spent','paid','bought','on','from','dollars','dollar','riyals','riyal'].forEach(w=>{
    desc = desc.replace(new RegExp('\\b'+w+'\\b','gi'), ' ');
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
