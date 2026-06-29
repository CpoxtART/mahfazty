/* ============================================================
   CANVAS CHARTS  (split out of app.ui.js)
   The category pie chart + the running-balance line chart.
   Loaded via its own <script> AFTER app.ui.js and BEFORE app.logic.js.
   Declaration-only (no top-level executable statements). Functions here are
   invoked at runtime by switchTab()/render(), so cross-file call order is fine;
   the file just needs to precede app.logic.js, which reassigns _pieChartSig.
============================================================ */
/* ============================================================
   CATEGORY PIE CHART
============================================================ */
// Caches the expensive part (full-ledger scan + totals/percentages) keyed on
// what can actually change it — every other render-triggering event (resize,
// tab switch back to analytics, category-filter tap which only toggles a CSS
// class elsewhere) used to re-scan all transactions from scratch for nothing.
let _pieChartCache = null;
let _pieChartSig = '';
function renderPieChart(){
  const wrap = document.getElementById('pieContent');
  const sig = _txMutationStamp + '|' + currentFilter + '|' + walletFilter;
  let data = (sig === _pieChartSig && _pieChartCache) ? _pieChartCache : null;

  if(!data){
    const filtered = state.transactions
      .filter(tx => inRange(tx.ts))
      .filter(tx => !walletFilter || tx.wallet === walletFilter)
      .filter(tx => tx.type==='expense' && tx.category !== 'transfer' && tx.category !== 'adjustment');

    const totals = {};
    filtered.forEach(tx => {
      const cat = tx.category || 'other';
      totals[cat] = (totals[cat]||0) + tx.amount;
    });
    const total = Object.values(totals).reduce((a,b)=>a+b,0);
    let entries = [], pctMap = {}, prevTotals = null;
    // guard against an all-zero-amount set (e.g. crafted import) — every downstream
    // amt/total below would be NaN/Infinity and the donut + legend would render broken
    if(total > 0){
      entries = Object.entries(totals).sort((a,b)=>b[1]-a[1]);

      // largest-remainder rounding so the displayed integer percentages always sum
      // to exactly 100 (plain toFixed(0) per slice could yield 99% or 101%)
      let floorSum = 0;
      const fracs = entries.map(([catId, amt]) => {
        const exact = amt / total * 100;
        const fl = Math.floor(exact);
        pctMap[catId] = fl; floorSum += fl;
        return { catId, frac: exact - fl };
      });
      let leftover = Math.round(100 - floorSum);
      fracs.sort((a,b)=> b.frac - a.frac);
      for(let i=0; i<leftover && i<fracs.length; i++) pctMap[fracs[i].catId] += 1;

      // per-category comparison vs last month (only meaningful when viewing "month")
      if(currentFilter === 'month'){
        prevTotals = {};
        const [prevStart, prevEnd] = monthRange(1);
        state.transactions.forEach(tx=>{
          if(tx.type!=='expense' || tx.category==='transfer' || tx.category==='adjustment') return;
          if(tx.ts < prevStart || tx.ts >= prevEnd) return;
          if(walletFilter && tx.wallet !== walletFilter) return;
          const cat = tx.category || 'other';
          prevTotals[cat] = (prevTotals[cat]||0) + tx.amount;
        });
      }
    }
    data = { filteredLen: filtered.length, total, entries, pctMap, prevTotals };
    _pieChartCache = data;
    _pieChartSig = sig;
  }

  if(data.filteredLen === 0 || !(data.total > 0)){
    wrap.innerHTML = `<div class="empty" style="flex:1;"><span class="ic">🍰</span>${t({ar:'أول مصروف يظهر هنا موزّعاً حسب الفئة', en:'Your first expense will appear here broken down by category'})}</div>`;
    return;
  }
  const { total, entries, pctMap, prevTotals } = data;

  const containerW = document.getElementById('pieContent')?.parentElement?.clientWidth || 320;
  const size = Math.min(120, Math.max(80, Math.round(containerW * 0.3)));
  const r = Math.round(size * 0.46), cx = size/2, cy = size/2;
  let html = `<canvas id="pieCanvas" width="${size}" height="${size}" style="width:${size}px;height:${size}px;" role="img" aria-label="${escHtml(t({ar:'مخطط دائري لتوزيع المصروفات حسب الفئة', en:'Pie chart of expenses by category'}))}"></canvas>`;
  html += '<div class="pie-legend">';
  entries.forEach(([catId, amt]) => {
    const cat = getCategory(catId);
    const pct = pctMap[catId] ?? Math.round(amt/total*100);
    let cmpHtml = '';
    if(prevTotals){
      const prevAmt = prevTotals[catId] || 0;
      if(prevAmt > 0){
        const diff = ((amt-prevAmt)/prevAmt*100);
        const up = diff > 0;
        if(Math.abs(diff) >= 1){
          cmpHtml = `<span class="cat-cmp ${up?'up':'down'}">${up?'▲':'▼'}${Math.abs(diff).toFixed(0)}%</span>`;
        }
      } else if(amt > 0){
        cmpHtml = `<span class="cat-cmp up">${escHtml(t({ar:'جديد', en:'New'}))}</span>`;
      }
    }
    html += `<div class="row cat-row" data-cat="${escHtml(catId)}" role="button" tabindex="0" aria-label="${escHtml(t({ar:`تصفية حسب ${cat.name}`, en:`Filter by ${cat.name}`}))}"><span class="sw" style="background:${escHtml(cat.color)}"></span><span class="name">${escHtml(cat.icon)} ${escHtml(cat.name)}</span>${cmpHtml}<span class="pct">${fmt(amt)} (${pct}%)</span></div>`;
  });
  html += '</div>';
  wrap.innerHTML = html;
  wrap.querySelectorAll('.cat-row').forEach(row=>{
    row.style.cursor = 'pointer';
    row.onclick = () => toggleCategoryFilter(row.dataset.cat);
    row.onkeydown = (e) => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggleCategoryFilter(row.dataset.cat); } };
  });

  // draw pie
  const canvas = document.getElementById('pieCanvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size*dpr; canvas.height = size*dpr;
  const ctx = canvas.getContext('2d');
  if(!ctx) return;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  let start = -Math.PI/2;
  entries.forEach(([catId, amt]) => {
    const cat = getCategory(catId);
    const slice = (amt/total) * Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,r,start,start+slice);
    ctx.closePath();
    ctx.fillStyle = cat.color;
    ctx.fill();
    start += slice;
  });
  // donut hole
  ctx.beginPath();
  ctx.arc(cx,cy,r*0.55,0,Math.PI*2);
  ctx.fillStyle = themeColor('--card', '#1e222a');
  ctx.fill();
  // total label in center
  const isLightPie = document.body.classList.contains('light');
  const fmtPieShort = n => {
    // thresholds use the rounded boundary (999.5k/999.5M) so a value like 999,950
    // promotes to "1M" instead of rendering the impossible "1000K"
    if(n >= 999.5e6) return (n/1e9).toFixed(1).replace(/\.0$/,'') + 'B';
    if(n >= 999.5e3) return (n/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
    if(n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
    return Math.round(n).toLocaleString('en-US');
  };
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isLightPie ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.45)';
  const totalLabel = fmtPieShort(total);
  // auto-shrink to fit the donut hole — very large totals (e.g. corrupted/huge
  // imports) can otherwise overflow fillText past the inner circle into the ring
  let pieFontPx = Math.round(size*0.09);
  const innerW = r*0.55*2*0.86; // small margin so text doesn't touch the ring edge
  ctx.font = `600 ${pieFontPx}px system-ui,sans-serif`;
  while(pieFontPx > 7 && ctx.measureText(totalLabel).width > innerW){
    pieFontPx--;
    ctx.font = `600 ${pieFontPx}px system-ui,sans-serif`;
  }
  // Clip to the donut hole so extremely long numbers (e.g. corrupted imports)
  // can't bleed into the ring even when the font-shrink loop hits the 7px floor.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillText(totalLabel, cx, cy + 1);
  ctx.restore();
}


/* ============================================================
   CHART — running balance line over filtered period
============================================================ */
function renderChart(){
  const canvas = document.getElementById('chartCanvas');
  const emptyEl = document.getElementById('chartEmpty');
  if(!canvas || !emptyEl) return; // guard against missing DOM (e.g. while loading)
  const ctx = canvas.getContext('2d');
  if(!ctx){ emptyEl.style.display='block'; canvas.style.display='none'; return; }
  const dpr = window.devicePixelRatio || 1;
  const cssW = (canvas.parentElement?.clientWidth || 400) - 28;
  if(cssW < 50){ emptyEl.style.display='block'; canvas.style.display='none'; return; }
  const cssH = 130;
  canvas.width = cssW*dpr; canvas.height = cssH*dpr;
  canvas.style.width = cssW+'px'; canvas.style.height = cssH+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);

  // cached list is newest-first; chart needs oldest-first — reverse a copy (O(n),
  // cheaper than the full re-sort this used to do on every render)
  const filtered = getFilteredTx().slice().reverse();
  if(filtered.length < 2){
    emptyEl.style.display = 'block';
    canvas.style.display = 'none';
    document.getElementById('chartNet').textContent = '';
    return;
  }
  emptyEl.style.display = 'none';
  canvas.style.display = 'block';

  const netChange = filtered.reduce((s,tx)=> s + (tx.type==='income' ? tx.amount : -tx.amount), 0);
  let running = walletFilter ? ((state.wallets[walletFilter] ?? 0) - netChange) : 0;
  const points = filtered.map(tx => {
    running += (tx.type==='income' ? tx.amount : -tx.amount);
    return running;
  });
  points.unshift(walletFilter ? ((state.wallets[walletFilter] ?? 0) - netChange) : 0);

  const min = Math.min(...points);
  const max = Math.max(...points);
  // when every point is identical the spread is 0; draw the line through the
  // vertical centre instead of pinning it to the bottom (range fallback of 1)
  const flat = max === min;
  const range = flat ? 1 : (max - min);
  const padX = 6, padY = 14, padYAxisLabel = 44;
  const w = cssW - padX*2 - padYAxisLabel;
  const h = cssH - padY*2;
  const yOf = p => flat ? (padY + h/2) : (padY + h - ((p - min) / range) * h);

  // theme-aware grid color (light vs dark) — hardcoded white was invisible in light mode
  const isLightTheme = document.body.classList.contains('light');
  ctx.strokeStyle = isLightTheme ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  for(let i=0;i<=2;i++){
    const y = padY + (h/2)*i;
    ctx.beginPath(); ctx.moveTo(padX,y); ctx.lineTo(padX+w,y); ctx.stroke();
  }

  const zeroY = yOf(0);
  ctx.strokeStyle = isLightTheme ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.12)';
  ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(padX,zeroY); ctx.lineTo(padX+w,zeroY); ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  points.forEach((p,i)=>{
    const x = padX + (w * i / Math.max(1, points.length - 1)); // Math.max(1,...) guards against divide-by-zero
    const y = yOf(p);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  const finalNet = points[points.length-1];
  // Read from CSS variables so the chart adapts to light/dark theme (cached)
  const colorPos = themeColor('--green', '#86c39a');
  const colorNeg = themeColor('--red', '#e3918f');
  const lineColor = finalNet >= 0 ? colorPos : colorNeg;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2.25;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  const grad = ctx.createLinearGradient(0,0,0,cssH);
  const isLightForChart = document.body.classList.contains('light');
  const gradTop = finalNet>=0
    ? (isLightForChart ? 'rgba(62,141,89,.18)'   : 'rgba(134,195,154,.20)')
    : (isLightForChart ? 'rgba(192,90,87,.18)'   : 'rgba(227,145,143,.20)');
  grad.addColorStop(0, gradTop);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.lineTo(padX+w, padY+h);
  ctx.lineTo(padX, padY+h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  const lastX = padX + w;
  const lastY = yOf(finalNet);
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI*2);
  ctx.fillStyle = lineColor;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lastX, lastY, 7, 0, Math.PI*2);
  ctx.strokeStyle = lineColor + '55';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Y-axis labels on the inline-end side (right in LTR, but canvas ignores dir)
  const labelX = padX + w + 6;
  const labelColor = isLightTheme ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.38)';
  ctx.fillStyle = labelColor;
  ctx.font = `600 9px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const fmtShort = n => {
    const abs = Math.abs(n);
    const s = n < 0 ? '-' : '';
    // rounded boundaries (999.5k/999.5M) prevent "1000K"/"1000M" at the edges
    if(abs >= 999.5e6) return s + (abs/1e9).toFixed(1).replace(/\.0$/,'') + 'B';
    if(abs >= 999.5e3) return s + (abs/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
    if(abs >= 1e3) return s + (abs/1e3).toFixed(1).replace(/\.0$/,'') + 'K';
    return s + Math.round(abs);
  };
  if(!flat){
    ctx.fillText(fmtShort(max), labelX, padY);
    ctx.fillText(fmtShort(min), labelX, padY + h);
  }
  if(min < 0 && max > 0){
    ctx.fillStyle = isLightTheme ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.25)';
    ctx.fillText('0', labelX, yOf(0));
  }

  const netBadge = document.getElementById('chartNet');
  netBadge.textContent = (finalNet>=0?'+':'') + fmt(finalNet);
  netBadge.style.color = lineColor;
}

