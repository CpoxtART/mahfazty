/* ============================================================
   VOICE INPUT (Web Speech API)
   Split out of app.ui.js. Arabic number-word parsing, category/type
   guessing from a spoken transcript, and the mic button's recognition
   lifecycle. Only reachable via startVoiceInput(), wired in _bindEvents()
   (app.logic.js) — safe to load anywhere after app.ui.js.
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

const CATEGORY_KEYWORDS = {
  food: ['عشاء','غداء','فطور','اكل','أكل','مطعم','قهوة','كافيه','مأكولات'],
  transport: ['تكسي','تاكسي','بنزين','وقود','مواصلات','سيارة','أوبر','اوبر','باص'],
  shopping: ['تسوق','سوق','ملابس','شراء','محل'],
  bills: ['فاتورة','فواتير','كهرباء','ماء','انترنت','إنترنت','اتصالات','موبايل'],
  health: ['دواء','صيدلية','طبيب','مستشفى','علاج'],
  entertainment: ['سينما','ترفيه','لعبة','العاب','ألعاب','رحلة'],
  salary: ['راتب','دخل','مكافأة','أجرة','اجرة'],
};

function parseArabicNumber(text){
  // Tokenize the ORIGINAL transcript FIRST, then normalize each token.
  // normalizeDigits strips ALL whitespace (its "1 000" thousands support), so
  // normalizing the whole phrase before splitting collapsed every multi-word
  // transcript into one unparseable token — "صرفت خمسين على عشاء" became
  // "صرفتخمسينعلىعشاء" and every realistic voice phrase failed with
  // "لم يتم العثور على رقم". Per-token normalization keeps the digit/separator
  // handling without destroying the word boundaries.
  const tokens = String(text == null ? '' : text).split(/\s+/).map(normalizeDigits);
  const values = [];            // ordered numeric values pulled from digits AND words
  let sawAny = false;
  for(let i = 0; i < tokens.length; i++){
    let raw = tokens[i];
    if(!raw) continue;
    // a token may be a digit group, possibly stuck to a scale word ("5آلاف")
    if(/^\d/.test(raw)){
      const dm = raw.match(/\d+(\.\d+)?/);
      if(dm){ values.push(parseFloat(dm[0])); sawAny = true; raw = raw.slice(dm[0].length); }
      if(!raw) continue;
    }
    const clean = raw.replace(/[^ء-ي]/g,'');
    if(!clean) continue;
    // two-token compounds ("احد عشر" = 11) — must be tried BEFORE the single
    // word, or "عشر" (10) claims the second token and the pair reads as 10
    const _next = i + 1 < tokens.length ? String(tokens[i+1]).replace(/[^ء-ي]/g,'') : '';
    if(_next && VOICE_NUMBER_WORDS[clean + ' ' + _next] !== undefined){
      values.push(VOICE_NUMBER_WORDS[clean + ' ' + _next]); sawAny = true; i++; continue;
    }
    if(VOICE_NUMBER_WORDS[clean] !== undefined){ values.push(VOICE_NUMBER_WORDS[clean]); sawAny = true; continue; }
    // strip a leading connective و ("وعشرين" → "عشرين") and retry — but only when
    // the remainder is itself a number word, so real words like "واحد" stay intact
    if(clean.length > 2 && clean[0] === 'و' && VOICE_NUMBER_WORDS[clean.slice(1)] !== undefined){
      values.push(VOICE_NUMBER_WORDS[clean.slice(1)]); sawAny = true;
    }
  }
  if(!sawAny) return null;
  const result = _combineNumberValues(values);
  return isFinite(result) ? result : null;
}

function guessCategory(text){
  for(const [catId, keywords] of Object.entries(CATEGORY_KEYWORDS)){
    if(keywords.some(k => text.includes(k))) return catId;
  }
  return null;
}

function guessType(text){
  const incomeWords = ['استلمت','استقبلت','دخل','راتب','ربحت','كسبت','حولوا لي','حول لي','حولني','حولولي','وصلني','وصل لي','وصلتني','جاني','جاتني','جانا','هدية','مكافأة','بونص','عائد','فائدة','أرسلوا لي','ارسلولي'];
  return incomeWords.some(w => text.includes(w)) ? 'income' : 'expense';
}

let voiceRecognition = null;
let _voiceTimer = null;
// Browsers without Web Speech support (notably Firefox, which implements
// neither SpeechRecognition nor webkitSpeechRecognition) would otherwise show
// a mic button that does nothing useful until tapped. Hide it up front instead
// of failing only on click, so the UI never advertises a feature that can't work.
(function hideVoiceBtnIfUnsupported(){
  if(window.SpeechRecognition || window.webkitSpeechRecognition) return;
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
function startVoiceInput(){
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SpeechRecognition){
    toast(t({ar:'⚠ متصفحك لا يدعم الإدخال الصوتي', en:'⚠ Your browser does not support voice input'}), true);
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
  voiceRecognition.lang = 'ar-SA';
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
    if(e.error === 'not-allowed'){
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
    applyVoiceTranscript(transcript);
  };

  try{ voiceRecognition.start(); }
  catch(e){ cleanup(); toast(t({ar:'⚠ تعذر بدء التعرف الصوتي', en:'⚠ Could not start voice recognition'}), true); }
}

function applyVoiceTranscript(text){
  const amount = parseArabicNumber(text);
  const category = guessCategory(text);
  const type = guessType(text);

  // strip number-ish tokens from text to build a cleaner description
  let desc = text
    .replace(/\d+(\.\d+)?/g, '')
    .replace(/[٠-٩]+/g, '')
    .trim();
  Object.keys(VOICE_NUMBER_WORDS).forEach(w => { desc = desc.replace(new RegExp(w,'g'), ''); });
  desc = desc.replace(/\s{2,}/g,' ').trim();
  // remove common verbs/particles. JS \b is ASCII-only so it never matches around
  // Arabic letters — use whitespace anchors instead so these are actually stripped.
  // (bare single-letter particles like "ل" are intentionally omitted — too risky to
  // strip without butchering real words.)
  ['صرفت','دفعت','اشتريت','استلمت','استقبلت','على','ريال','دينار','من'].forEach(w=>{
    desc = desc.replace(new RegExp('(^|\\s)'+w+'(?=\\s|$)','g'), ' ');
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
