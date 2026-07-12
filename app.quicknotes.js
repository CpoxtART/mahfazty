/* ============================================================
   QUICK NOTES -> TRANSACTIONS
   Split out of app.logic.js. Free-form-text-to-transactions feature: parsing,
   the shared in-page wallet-picker popup, the preview/commit flow.
   Loaded AFTER app.ui.js and BEFORE app.logic.js/app.main.js. Calls
   addTx/runDistribution (app.logic.js) and openModal (app.overlay.js) at
   runtime — cross-file call order is fine since none of this executes until
   the boot sequence in app.main.js actually runs, well after every script
   has loaded.
============================================================ */
let _qnWallet = null;        // chosen target wallet id for the parsed rows
let _qnPreview = [];         // current parsed/preview rows
let _quickNotesDraft = '';   // persisted free-form notes text
let _qnCommitBusy = false;

// Category/income keyword tables now live in app.voice.js (CATEGORY_KEYWORDS,
// INCOME_KEYWORDS, guessCategoryShared, isIncomeTextShared) — unified in
// v47.78 so voice input and Quick Notes share one list instead of two
// independently-maintained copies (app.voice.js loads before this file).

function _qnNorm(s){ return normalizeSearch(s); }
function _qnGuessCategory(desc, type){
  // Quick Notes wants a concrete fallback (voice's guessCategoryShared alone
  // returns null on no match) — 'salary' for an income row, else 'other'.
  return guessCategoryShared(desc, type) || (type === 'income' ? 'salary' : 'other');
}

// Matches a number token in either ASCII, Arabic-Indic (٠-٩) or Persian (۰-۹)
// digits, with optional 3-digit thousands groups (, or ٬) and an optional
// decimal part. Used on the ORIGINAL line (not the space-stripped
// normalizeDigits output) so the description keeps its spaces.
// The grouping part matters: without it "1,234.56" tokenized as ["1,234","56"]
// and the amount-is-last-number rule silently committed 56 instead of 1234.56.
const _QN_NUM_RE = /[\d٠-٩۰-۹]+(?:[٬,][\d٠-٩۰-۹]{3})*(?:[.,٫][\d٠-٩۰-۹]+)?/g;
// Cap the batch so a pasted wall of text can't build thousands of preview rows
// (each row is several DOM nodes + handlers) and freeze the main thread. 300 is
// far beyond any realistic "jot a few transactions" session.
const QN_MAX_LINES = 300;
// Raw character cap on the draft string — prevents the in-memory variable and the
// per-keystroke localStorage write from growing without bound when the user pastes
// a large document. 50 000 chars is ~250+ real-world transactions; well above any
// realistic use and comfortably under the typical 5MB localStorage quota.
const QN_MAX_CHARS = 50000;
let _qnTruncated = false; // set when the last parse hit the cap (surfaced as a toast)

/* ------------------------------------------------------------
   Trailing free-text wallet recognition — no marker character required.
   Writing a real wallet's name as the LAST word(s) of a quick-notes line
   (e.g. "قهوة 15 Uber" or "قهوة 15 نقدي بطاقات") pre-selects that wallet for
   the row instead of leaving it on the default chip. Matches against the
   user's ACTUAL wallet names (normalized for Arabic spelling variants via
   normalizeSearch), not a fixed/predefined word list — so it works for
   whatever wallets the user has created. Matched ONLY against the same
   wallet lists the preview UI itself offers (SELECTABLE_WALLETS for primary,
   trackWalletDefs() for tracking) so a resolved id can never be one the
   preview's own fallback logic would silently reject.
------------------------------------------------------------ */
// WALLET_DEFS ships its built-in wallets with English names ("Core Expenses",
// "Cash", "Bank Cards"...) even though the rest of this app's UI is Arabic —
// so an Arabic phrase like "بالكاش" can never literal-match "Cash" no matter
// how much Arabic-internal clitic stripping is applied; the scripts don't
// overlap at all. These are common Arabic aliases for the STOCK wallet ids
// only (not a general fixed-word list — a user's own custom/renamed wallets
// are still matched purely by their actual current name, same as before).
// If a user later renames one of these ids to something unrelated, its old
// alias(es) keep matching too; an acceptable trade-off for fixing the much
// more common "never recognized at all" case on fresh/default wallets.
const _QN_BUILTIN_WALLET_ALIASES = {
  core:        ['الرئيسية','الأساسية','المصاريف الأساسية','المصاريف الرئيسية'],
  wishlist:    ['قائمة الأمنيات','الأمنيات'],
  growth:      ['النمو'],
  investments: ['الاستثمارات'],
  joy:         ['متعة الحياة','المتعة'],
  giving:      ['العطاء'],
  crisis_fund: ['الاحتياطي','الاحتياطي المدمج'],
  uber:        ['اوبر'],
  cards:       ['البطاقات','بطاقات البنك','بطاقات بنكية','كاردز','كارد','الكاردز'],
  cash:        ['كاش','نقدي','نقدا'],
};
function _qnWalletMatchList(){
  const toEntry = (w, track, name) => { const norm = _qnNorm(name); return { id:w.id, track, norm, words: norm.split(/\s+/).filter(Boolean).length }; };
  const wallets = SELECTABLE_WALLETS.map(w => ({w, track:false})).concat(trackWalletDefs().map(w => ({w, track:true})));
  const entries = [];
  wallets.forEach(({w, track}) => {
    entries.push(toEntry(w, track, w.name));
    (_QN_BUILTIN_WALLET_ALIASES[w.id] || []).forEach(alias => entries.push(toEntry(w, track, alias)));
  });
  return entries.filter(e => e.norm);
}
// Arabic prepositions/the definite article often glue directly onto the next
// word with no space ("بالكاش" = بـ + الـ + كاش, "فالبنك" = فـ + الـ + بنك) —
// matching by exact equality alone would miss these even though the wallet
// name itself ("كاش"/"البنك") is right there. Peel a single leading clitic
// letter (ب ل ك ف و) and/or the definite article (ال) off the window's FIRST
// word and offer that as an extra candidate to compare — still pure Arabic
// grammar, not a fixed vocabulary of wallet-type words like "cash"/"bank".
function _qnCliticVariants(word){
  const out = [word];
  let core = word;
  const m = core.match(/^[بلكفو](.{2,})$/);
  if(m){ core = m[1]; out.push(core); }
  const m2 = core.match(/^ال(.{2,})$/);
  if(m2) out.push(m2[1]);
  return out;
}
// Standalone (space-separated, not glued) leading preposition words — once a
// match is found, also swallow one of these immediately before it ("قهوة 15
// في الكاش" → drop "في" too, not just "الكاش") so it doesn't linger in desc.
const _QN_LEAD_PREP_WORDS = ['في','من','مع','عن','الى','الي','in','by','via','using','with'];
// Peels at most one trailing PRIMARY wallet-name match and one trailing
// TRACKING wallet-name match (in either order) off the end of `desc`, by
// normalized-equality against `candidates` (allowing the leading-clitic
// leniency above) — the longest matching name wins over a shorter one that
// happens to share the same ending. Never returns an empty description
// (falls back to the original text if peeling would empty it).
function _qnPeelTrailingWallets(desc, candidates, maxWindow){
  let words = desc.split(/\s+/).filter(Boolean);
  let wallet = null, track = null;
  for(let pass = 0; pass < 2 && words.length; pass++){
    let hit = null, win = 0;
    for(win = Math.min(maxWindow, words.length); win >= 1; win--){
      const tailWords = _qnNorm(words.slice(words.length - win).join(' ')).split(' ').filter(Boolean);
      if(!tailWords.length) continue;
      const rest = tailWords.slice(1).join(' ');
      hit = candidates.find(c => _qnCliticVariants(tailWords[0]).some(v => (rest ? v + ' ' + rest : v) === c.norm));
      if(hit) break;
    }
    if(!hit) break;
    const beforeIdx = words.length - win - 1;
    if(beforeIdx >= 0 && _QN_LEAD_PREP_WORDS.includes(_qnNorm(words[beforeIdx]))) win++;
    if(hit.track){ if(track == null) track = hit.id; }
    else if(wallet == null) wallet = hit.id;
    words = words.slice(0, words.length - win);
  }
  const stripped = words.join(' ').trim();
  return { desc: stripped || desc, wallet, track };
}

// Parse free-form text into transaction candidates — one per non-empty line:
// "description price" ("+" or an income keyword marks it as income), with an
// optional trailing wallet name (see _qnPeelTrailingWallets above). Wallets
// not specified in the text fall back to each row's own primary + tracking
// dropdowns at render time (primary = the default chip, tracking = none).
function parseQuickNotes(text){
  const rows = [];
  _qnTruncated = false;
  const _walletCandidates = _qnWalletMatchList();
  const _walletMaxWindow = _walletCandidates.reduce((m,c) => Math.max(m,c.words), 1);
  const lines = String(text == null ? '' : text).split('\n');
  for(const rawLine of lines){
    if(rows.length >= QN_MAX_LINES){ _qnTruncated = true; break; }
    const line = rawLine.trim();
    if(!line) continue;
    const isIncome = /\+/.test(line) || isIncomeTextShared(line);
    const type = isIncome ? 'income' : 'expense';
    const nums = line.match(_QN_NUM_RE);
    if(!nums || !nums.length){
      rows.push({raw:line, desc:line.replace(/\+/g,' ').replace(/\s+/g,' ').trim(), amount:NaN, type, category:_qnGuessCategory(line, type), valid:false, wallet:null, track:null});
      continue;
    }
    const amtRaw = nums[nums.length-1];           // amount = last number (description comes first)
    const amount = round2(parseAmount(amtRaw));   // parseAmount folds Arabic/Persian digits itself
    let desc = line;
    const numEnd = desc.lastIndexOf(amtRaw);
    let cutStart = numEnd;
    // A number glued directly to a leading Arabic preposition ("ب500" = "for
    // 500", no space) otherwise leaves that single letter orphaned once the
    // number itself is cut out ("...مكسرات ب500" → "...مكسرات ب"). Same
    // glued-clitic set _qnCliticVariants uses elsewhere for wallet names —
    // extend the cut backward over the clitic when it's a standalone
    // one-letter "word" (preceded by start-of-string or whitespace).
    if(cutStart > 0 && /[بلكفو]/.test(desc[cutStart-1]) && (cutStart === 1 || /\s/.test(desc[cutStart-2]))){
      cutStart -= 1;
    }
    if(numEnd >= 0) desc = desc.slice(0, cutStart) + desc.slice(numEnd + amtRaw.length);
    desc = desc.replace(/\+/g,' ').replace(/\s+/g,' ').trim();
    desc = desc.replace(/(ريال|ر\.?\s?س|درهم|دينار|جنيه|sar|usd|riyal|\$)\s*$/i,'').trim(); // drop a trailing currency word
    const valid = isFinite(amount) && amount > 0;
    let wallet = null, track = null;
    if(valid && desc){
      const resolved = _qnPeelTrailingWallets(desc, _walletCandidates, _walletMaxWindow);
      desc = resolved.desc;
      wallet = resolved.wallet;
      track = resolved.track;
    }
    rows.push({raw:line, desc, amount: valid ? amount : NaN, type, category:_qnGuessCategory(desc, type), valid, wallet, track});
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

/* ============================================================
   SHARED IN-PAGE WALLET PICKER
   One reusable floating menu (NOT the OS native <select>) so every wallet
   dropdown — the add-form tracking control and the two per-line pickers in
   quick-notes — opens the same elegant in-page list as the primary wallet.
============================================================ */
let _wpAnchor = null, _wpOnPick = null, _wpAnchorRectAtOpen = null;
function _walletPopEl(){
  let pop = document.getElementById('walletPop');
  if(!pop){
    pop = document.createElement('div');
    pop.id = 'walletPop';
    pop.className = 'wallet-pop';
    pop.setAttribute('role', 'listbox');
    pop.setAttribute('aria-hidden', 'true');
    document.body.appendChild(pop);
  }
  return pop;
}
function closeWalletPop(){
  const pop = document.getElementById('walletPop');
  if(pop){ pop.classList.remove('open'); pop.setAttribute('aria-hidden', 'true'); pop.innerHTML = ''; }
  if(_wpAnchor){
    _wpAnchor.classList.remove('open'); _wpAnchor.setAttribute('aria-expanded', 'false');
    // the focused option is about to be destroyed (innerHTML=''), which would
    // otherwise silently drop keyboard/SR focus to <body> — send it back to the
    // control that opened the popup, mirroring openModal/closeModal's focus-stack.
    try{ _wpAnchor.focus({preventScroll:true}); }catch(_){}
  }
  _wpAnchor = null; _wpOnPick = null; _wpAnchorRectAtOpen = null;
}
// items: [{id, name, bal?}]. onPick(id) fires on selection.
function openWalletPop(anchor, items, currentId, onPick){
  if(!anchor) return;
  if(_wpAnchor === anchor){ closeWalletPop(); return; } // tapping the open anchor closes it
  closeWalletPop();
  const pop = _walletPopEl();
  pop.innerHTML = '';
  // Anchor already carries its own identity class (qn-cs-track / track-cs for the
  // tracking picker) — reuse it so the popup's selected-row highlight matches the
  // anchor's blue/gold identity instead of always defaulting to gold.
  pop.classList.toggle('wallet-pop--track', anchor.classList.contains('qn-cs-track') || anchor.classList.contains('track-cs'));
  items.forEach(it => {
    const isSel = it.id === currentId;
    const o = document.createElement('div');
    o.className = 'opt' + (isSel ? ' selected' : '');
    o.setAttribute('role', 'option');
    o.setAttribute('aria-selected', String(isSel));
    o.tabIndex = isSel ? 0 : -1; // roving tabindex: Tab moves in/out; arrows move within
    o.innerHTML = (it.bal != null)
      ? `<span>${escHtml(it.name)}</span><span class="bal">${escHtml(it.bal)}</span>`
      : `<span>${escHtml(it.name)}</span>`;
    const pick = () => { const f = _wpOnPick; closeWalletPop(); if(f) f(it.id); };
    o.onclick = pick;
    // Arrow/Home/End navigation is delegated once on `pop` via wireOptionArrowNav
    // (app.core.js) — shared with the three legacy in-form wallet dropdowns
    // (app.ui.js) since v47.79, this was the original/only implementation.
    o.onkeydown = (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); pick(); } };
    pop.appendChild(o);
  });
  wireOptionArrowNav(pop);
  _wpAnchor = anchor; _wpOnPick = onPick;
  anchor.classList.add('open'); anchor.setAttribute('aria-expanded', 'true');
  // fixed-position under the anchor (or above it if there's no room below).
  // Width: never NARROWER than the anchor (stays visually aligned under it),
  // but allowed to grow wider to fit its content — some anchors are tight
  // (e.g. a Quick Notes row's primary-wallet select shares its row with a
  // type toggle, a track select, and a category icon) while option rows
  // carry both a name AND a balance; locking width to the anchor squeezed
  // longer names like "Core Expenses"/"Investments" into "... Expenses" /
  // "...vestments" against the balance column. CSS's max-width caps how far
  // it can grow (ellipsis remains the fallback only past that).
  const r = anchor.getBoundingClientRect();
  _wpAnchorRectAtOpen = r;
  pop.style.left = Math.round(r.left) + 'px';
  pop.style.minWidth = Math.round(r.width) + 'px';
  pop.style.width = 'auto';
  pop.classList.add('open');
  pop.setAttribute('aria-hidden', 'false');
  // Grown wider than the anchor, this could now overflow the viewport's right
  // edge (or left, in a narrow RTL layout) — clamp back on-screen once its
  // natural width is resolved (needs to be laid out first, hence .open above).
  const popRectPreClamp = pop.getBoundingClientRect();
  const margin = 8;
  if(popRectPreClamp.right > window.innerWidth - margin){
    pop.style.left = Math.max(margin, window.innerWidth - margin - popRectPreClamp.width) + 'px';
  }
  // Clip to WHOLE rows: the CSS fallback cap (300px) usually lands mid-row,
  // leaving the last visible option half-cut — looks broken and half-hides a
  // row the user can't read. Measure a real row (heights vary with the user's
  // font-size setting) and cap at the largest whole-row count that fits.
  // Box-sizing is border-box app-wide, so the popup's own 2px of borders come
  // out of max-height; each .opt's offsetHeight already includes its 1px
  // divider (the borderless :last-child just leaves a 1px slack, invisible).
  let maxH = 300;
  const firstOpt = pop.querySelector('.opt');
  if(firstOpt && firstOpt.offsetHeight > 0){
    const rowH = firstOpt.offsetHeight;
    const wholeRows = Math.max(1, Math.floor((300 - 2) / rowH));
    if(items.length > wholeRows){
      maxH = wholeRows * rowH + 2;
      pop.style.maxHeight = maxH + 'px';
    } else {
      pop.style.maxHeight = ''; // fits fully — no cap needed
    }
  }
  const popH = Math.min(pop.scrollHeight, maxH);
  const below = window.innerHeight - r.bottom;
  if(below >= popH + 8 || below >= r.top){ pop.style.top = Math.round(r.bottom + 4) + 'px'; pop.style.bottom = 'auto'; }
  else { pop.style.bottom = Math.round(window.innerHeight - r.top + 4) + 'px'; pop.style.top = 'auto'; }
  const sel = pop.querySelector('.opt[aria-selected="true"]') || pop.querySelector('.opt');
  if(sel){
    sel.tabIndex = 0;
    try{ sel.focus({preventScroll:true}); }catch(_){}
    // A selected wallet below the whole-row cap would open out of sight — bring
    // it into view by setting pop.scrollTop DIRECTLY (confined to the popup's
    // own box) instead of Element.scrollIntoView(). scrollIntoView walks up
    // the ancestor chain for a scroll container and, for a position:fixed
    // popup appended to <body>, can decide the nearest one is the WINDOW —
    // firing a real window 'scroll' event that the outside-scroll-dismiss
    // listener above then reacts to, closing the popup the instant it opens.
    if(sel.offsetTop < pop.scrollTop) pop.scrollTop = sel.offsetTop;
    else if(sel.offsetTop + sel.offsetHeight > pop.scrollTop + pop.clientHeight){
      pop.scrollTop = sel.offsetTop + sel.offsetHeight - pop.clientHeight;
    }
  }
}
// dismiss on outside click / Escape / scroll / resize
document.addEventListener('click', (e) => {
  if(_wpAnchor && !_wpAnchor.contains(e.target)){
    const pop = document.getElementById('walletPop');
    if(!pop || !pop.contains(e.target)) closeWalletPop();
  }
}, true);
document.addEventListener('keydown', (e) => { if(e.key === 'Escape' && _wpAnchor){ closeWalletPop(); e.stopPropagation(); } }, true);
window.addEventListener('scroll', (e) => {
  if(!_wpAnchor) return;
  // Only OUTSIDE scrolls dismiss (the fixed-position popup would drift away from
  // its anchor). A scroll INSIDE the popup's own option list — a finger swiping
  // through a long wallet list on touch screens — fires this same capture-phase
  // listener, and closing on it made the popup vanish at the first touch-move,
  // making long lists impossible to scroll on mobile.
  const pop = document.getElementById('walletPop');
  if(pop && e.target instanceof Node && pop.contains(e.target)) return;
  // A scroll ELSEWHERE doesn't necessarily mean the ANCHOR moved — e.g. opening
  // the popup inside a modal can itself trigger the browser's own scroll-anchoring
  // (auto-adjusting an unrelated scrollable ancestor's position to compensate for
  // a layout/content-height change), firing a real 'scroll' event on that container
  // an instant after opening, with no user gesture involved. Reacting to that
  // closed the popup the moment it opened. Only close if the anchor's on-screen
  // position actually shifted since open — that's the real reason to dismiss
  // (the fixed-position popup would otherwise drift away from it).
  if(_wpAnchorRectAtOpen){
    const now = _wpAnchor.getBoundingClientRect();
    const moved = Math.abs(now.left - _wpAnchorRectAtOpen.left) > 2 ||
                  Math.abs(now.top - _wpAnchorRectAtOpen.top) > 2;
    if(!moved) return;
  }
  closeWalletPop();
}, true);
window.addEventListener('resize', () => { if(_wpAnchor) closeWalletPop(); });
// Add-form tracking-wallet picker (opens the shared menu).
function openTrackPicker(anchor){
  const items = [{id:'', name:t({ar:'بدون تتبّع', en:'No tracking'})}]
    .concat(WALLET_DEFS.filter(w => w.track).map(w => ({id:w.id, name:w.name})));
  openWalletPop(anchor, items, selectedTrackWallet || '', (id) => { selectTrackLink(id); });
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
  if(!ta) return;
  if(ta.value.length > QN_MAX_CHARS){
    ta.value = ta.value.slice(0, QN_MAX_CHARS);
    toast(t({ar:`⚠ تجاوزت الحد الأقصى (${QN_MAX_CHARS.toLocaleString()} حرف)`, en:`⚠ Exceeded max length (${QN_MAX_CHARS.toLocaleString()} chars)`}), true);
  }
  _quickNotesDraft = ta.value;
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
  const pw = document.getElementById('qnPreviewWrap');
  // Refocus qnNotes BEFORE hiding pw — the Cancel button lives inside pw, so
  // hiding it while it holds focus drops focus to <body> (browser default),
  // silent to a screen reader until the next Tab press recovers it.
  const hadFocus = !!(pw && document.activeElement && pw.contains(document.activeElement));
  if(pw) pw.style.display = 'none';
  if(hadFocus){
    const ta = document.getElementById('qnNotes');
    if(ta) try{ ta.focus(); }catch(_){}
  }
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
  const tracks = trackWalletDefs();
  _qnPreview.forEach((r, i) => {
    // Two consistent controls per row (mirrors the add form): a PRIMARY (budget)
    // wallet, and an OPTIONAL tracking wallet.
    if(!r.wallet || !SELECTABLE_WALLETS.find(w => w.id === r.wallet)) r.wallet = _qnWallet;
    if(r.track && !tracks.find(w => w.id === r.track)) r.track = null;
    const cat = getCategory(r.category);
    const primaryName = (SELECTABLE_WALLETS.find(w => w.id === r.wallet) || {}).name || t({ar:'اختر محفظة', en:'Choose a wallet'});
    const trackName = r.track ? ((tracks.find(w => w.id === r.track) || {}).name || '') : t({ar:'بدون تتبّع', en:'No tracking'});
    const typeLabel = r.type === 'income'
      ? t({ar:'النوع: دخل — اضغط للتبديل إلى مصروف', en:'Type: income — tap to switch to expense'})
      : t({ar:'النوع: مصروف — اضغط للتبديل إلى دخل', en:'Type: expense — tap to switch to income'});
    const row = document.createElement('div');
    row.className = 'qn-row' + (r.valid ? '' : ' invalid');
    // Both wallet controls are in-page custom dropdowns (NOT native <select>) —
    // they open the shared wallet popup, matching the primary-wallet widget.
    row.innerHTML =
      `<div class="qn-row-top">` +
        `<button type="button" class="qn-type ${r.type}" data-i="${i}" aria-label="${escHtml(typeLabel)}" aria-pressed="${r.type === 'income'}">${r.type === 'income' ? '＋' : '－'}</button>` +
        `<input class="qn-row-desc" data-i="${i}" value="${escHtml(r.desc)}" placeholder="${escHtml(t({ar:'الوصف', en:'Description'}))}" autocomplete="off">` +
        `<button type="button" class="qn-row-del" data-i="${i}" aria-label="${escHtml(t({ar:'حذف هذا السطر', en:'Remove this line'}))}">✕</button>` +
      `</div>` +
      `<div class="qn-row-bottom">` +
        `<span class="qn-row-cat" role="img" aria-label="${escHtml(cat.name)}" title="${escHtml(cat.name)}">${cat.icon}</span>` +
        `<span class="qn-wlabel" aria-hidden="true">👛</span>` +
        `<div class="custom-select qn-cs qn-cs-primary" data-i="${i}" role="button" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-label="${escHtml(t({ar:'المحفظة الرئيسية لهذا السطر', en:'Primary wallet for this line'}))}"><span class="qn-cs-label">${escHtml(primaryName)}</span><span class="arrow">▾</span></div>` +
        `<input class="qn-row-amt" data-i="${i}" inputmode="decimal" value="${r.valid ? groupThousandsDisplay(r.amount) : ''}" placeholder="0" autocomplete="off" aria-invalid="${!r.valid}" aria-label="${escHtml(t({ar:'المبلغ', en:'Amount'}))}"${r.valid ? '' : ` aria-describedby="qnRowWarn${i}"`}>` +
      `</div>` +
      (tracks.length ? `<div class="qn-row-track-row">` +
        `<span class="qn-wlabel" aria-hidden="true">🏦</span>` +
        `<div class="custom-select qn-cs qn-cs-track${r.track ? ' has-track' : ''}" data-i="${i}" role="button" tabindex="0" aria-haspopup="listbox" aria-expanded="false" aria-label="${escHtml(t({ar:'محفظة التتبّع لهذا السطر (اختياري)', en:'Tracking wallet for this line (optional)'}))}"><span class="qn-cs-label">${escHtml(trackName)}</span><span class="arrow">▾</span></div>` +
      `</div>` : '') +
      (r.valid ? '' : `<div class="qn-row-warn" id="qnRowWarn${i}">⚠ ${escHtml(t({ar:'أضِف سعرًا لهذا السطر', en:'Add a price for this line'}))}</div>`);
    list.appendChild(row);
  });
  // Desc/amount inputs only mutate the model (no re-render → keeps focus while
  // typing). Type-toggle and delete re-render because they change structure.
  list.querySelectorAll('.qn-type').forEach(btn => btn.onclick = () => {
    const i = +btn.dataset.i;
    _qnPreview[i].type = _qnPreview[i].type === 'income' ? 'expense' : 'income';
    _qnPreview[i].category = _qnGuessCategory(_qnPreview[i].desc, _qnPreview[i].type);
    renderQuickNotesPreview();
  });
  list.querySelectorAll('.qn-row-desc').forEach(inp => inp.oninput = () => { _qnPreview[+inp.dataset.i].desc = inp.value; });
  // Primary wallet: open the shared in-page popup, update model + label on pick.
  // Must swallow the keyboard echo — see bindKbdSelect (app.core.js): without
  // it, our keydown runs open(), then the synthesized detail-0 click ran it
  // again, and openWalletPop treats a second call on the same anchor as a
  // toggle, so the popup opened and instantly closed for keyboard users.
  const _qnPick = bindKbdSelect;
  list.querySelectorAll('.qn-cs-primary').forEach(btn => _qnPick(btn, () => {
    const i = +btn.dataset.i;
    const items = SELECTABLE_WALLETS.map(w => ({ id:w.id, name:w.name, bal: fmt(state.wallets[w.id] ?? 0) }));
    openWalletPop(btn, items, _qnPreview[i].wallet, (id) => {
      _qnPreview[i].wallet = id;
      btn.querySelector('.qn-cs-label').textContent = (SELECTABLE_WALLETS.find(w => w.id === id) || {}).name || '';
    });
  }));
  // Tracking wallet: same popup, "no tracking" first; blue once chosen.
  const _trk = trackWalletDefs();
  list.querySelectorAll('.qn-cs-track').forEach(btn => _qnPick(btn, () => {
    const i = +btn.dataset.i;
    const items = [{ id:'', name:t({ar:'بدون تتبّع', en:'No tracking'}) }]
      .concat(_trk.map(w => ({ id:w.id, name:w.name, bal: fmt(state.wallets[w.id] ?? 0) })));
    openWalletPop(btn, items, _qnPreview[i].track || '', (id) => {
      _qnPreview[i].track = id || null;
      btn.classList.toggle('has-track', !!id);
      btn.querySelector('.qn-cs-label').textContent = id ? ((_trk.find(w => w.id === id) || {}).name || '') : t({ar:'بدون تتبّع', en:'No tracking'});
    });
  }));
  list.querySelectorAll('.qn-row-amt').forEach(inp => inp.oninput = () => {
    liveFormatThousands(inp); // "1000" -> "1,000" as the user types
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
  if(_stateNotReady()) return;
  // cross-op write guard: refuse to start while another mutation is mid-flight
  // (each write path has its own busy flag, but none blocked the others across an
  // await — two interleaving writers could corrupt balances)
  if(_opBusy()) return;
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
        desc: truncateCodePoints(r.desc, MAX_DESC_LEN),
        amount: round2(r.amount),
        type: r.type,
        category: category,
        // distinct, ascending, never-future timestamps: [baseTs-(n-1) .. baseTs]
        // (the old Math.min(baseTs+k, now) collapsed to identical ts in fast loops)
        ts: baseTs - (n - 1 - k)
      };
      // optional tracking-wallet link (same shape addTx stamps): the linked track
      // wallet must exist, be a track wallet, and differ from the primary wallet.
      if(r.track && r.track !== rowWallet){
        const tw = WALLET_DEFS.find(w => w.id === r.track && w.track);
        if(tw){ tx.trackWallet = tw.id; tx.trackSign = (trackLinkMode[tw.id] === 'credit') ? 1 : -1; }
      }
      state.transactions.push(tx);
      applyTxToBalance(tx, +1);
      // budget-wallet income distributes; track-wallet income stays put (see addTx)
      if(tx.type === 'income' && tx.category !== 'transfer' && !isTrackWallet(tx.wallet)) incomeTxs.push(tx);
    });
    // Rows that never became a transaction (missing/unparseable amount) were
    // silently excluded from `committable` above — the preview DOES mark them
    // invalid before this point, but nothing here told the user any were
    // actually dropped, and the draft/textarea get wiped unconditionally
    // right after regardless, permanently discarding that raw line the
    // moment a user who skimmed past a red row taps Confirm. Report the
    // count explicitly, same pattern as the existing _reassigned notice.
    const _skipped = _qnPreview.length - committable.length;
    if(_reassigned || _skipped){
      const parts = [];
      if(_skipped) parts.push(t({ar:`${arPlural(_skipped, 'سطر تُجوهل', 'سطران تُجوهلا', 'أسطر تُجوهلت', 'سطر واحد تُجوهل')} (بلا سعر صالح)`, en:`${_skipped} line${_skipped===1?'':'s'} skipped (no valid price)`}));
      if(_reassigned) parts.push(t({ar:`${_reassigned} حُوّل للمحفظة الافتراضية`, en:`${_reassigned} moved to the default wallet`}));
      toast('⚠ ' + parts.join(' · '), true);
    }
    await saveTx(); // saveTx first — see app.logic.js's addTx comment
    await saveBalances();
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
