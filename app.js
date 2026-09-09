const $ = s => document.querySelector(s);
const fmt = n => (n<0?"-":"") + "$" + Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:0});
const C = {good:"#3fb950", bad:"#f85149", ghost:"#6e7681", accent:"#58a6ff", dim:"#8b949e", line:"#232b36"};
let DATA = [], equityChart = null, gapChart = null;

const base = {
  responsive:true, maintainAspectRatio:false, animation:{duration:250},
  interaction:{mode:"nearest", intersect:false},
  plugins:{legend:{display:false}, tooltip:{
    backgroundColor:"#161b22", borderColor:C.line, borderWidth:1, padding:10,
    callbacks:{label:c => `${c.dataset.label}: ${fmt(c.parsed.y)}`}}},
  scales:{
    x:{grid:{color:C.line}, ticks:{color:C.dim, maxTicksLimit:10, font:{size:11}}},
    y:{grid:{color:C.line}, ticks:{color:C.dim, font:{size:11},
       callback:v => "$" + (Math.abs(v)>=1000 ? (v/1000).toFixed(0)+"k" : v)}}}
};

function headline(){
  const live12 = DATA.filter(c => c.view==="live" && c.lookback===12 && c.instrument==="MNQ");
  const best = live12.sort((a,b)=>b.final-a.final)[0];
  $("#v-live").textContent = best ? `+${best.ret}%` : "—";
  $("#v-live").parentElement.querySelector(".s").textContent =
    best ? `$10,000 → ${fmt(best.final)}, ${best.maxdd_pct}% drawdown` : "";
  const chart12 = DATA.filter(c => c.view==="chart" && c.lookback===12 && c.instrument==="MNQ")
    .sort((a,b)=>b.final-a.final)[0];
  $("#v-chart").textContent = chart12 ? `+${Math.round(chart12.ret).toLocaleString()}%` : "—";
  const beat = DATA.filter(c => c.view==="live" && c.survived && c.ret>0).length;
  $("#v-beat").textContent = `${beat} of ${DATA.length}`;
}

function equity(){
  const inst=$("#f-inst").value, view=$("#f-view").value, lb=+$("#f-lb").value,
        scn=$("#f-scn").value, lag=$("#f-lag").value;
  const sel = DATA.filter(c => c.instrument===inst && c.lookback===lb
    && (!view || c.view===view) && (!scn || c.scenario===scn) && (!lag || String(c.atr_lag)===lag));
  const seen = new Set(), uniq = [];
  for (const c of sel){                       // stop sweeps are duplicates; show each shape once
    const k = `${c.scenario}|${c.view}|${c.atr_lag}`;
    if (!seen.has(k)) { seen.add(k); uniq.push(c); }
  }
  const labels = uniq.length ? uniq[0].dates : [];
  const ds = uniq.map(c => ({
    label:`${c.scenario} · ${c.view} · atr${c.atr_lag}`,
    data:c.eq, borderColor: c.view==="chart" ? C.ghost : (c.final>=10000 ? C.good : C.bad),
    borderWidth: c.view==="chart" ? 1 : 2, borderDash: c.view==="chart" ? [4,3] : [],
    pointRadius:0, tension:.1, _cell:c
  }));
  if (equityChart) equityChart.destroy();
  equityChart = new Chart($("#equity"), {type:"line", data:{labels, datasets:ds},
    options:{...base, plugins:{...base.plugins, annotation:undefined}}});
  $("#legend").innerHTML = uniq.map(c =>
    `<span><i style="background:${c.view==="chart"?C.ghost:(c.final>=10000?C.good:C.bad)}"></i>
     ${c.scenario} · ${c.view} · atr${c.atr_lag} — <b>${fmt(c.final)}</b>${c.survived?"":" (dead)"}</span>`
  ).join("");
}

function gap(){
  const lbs=[1,3,6,12];
  const pick=(v,lb)=>{const r=DATA.filter(c=>c.view===v&&c.lookback===lb&&c.instrument==="NQ"&&c.scenario==="A");
    return r.length?r.sort((a,b)=>b.final-a.final)[0]:null;};
  const chartNet=lbs.map(lb=>{const c=pick("chart",lb);return c?Math.max(c.final-10000,1):1;});
  const liveNet =lbs.map(lb=>{const c=pick("live",lb); return c?Math.max(c.final-10000,1):1;});
  if (gapChart) gapChart.destroy();
  gapChart = new Chart($("#gap"), {type:"bar",
    data:{labels:lbs.map(l=>`${l} month${l>1?"s":""}`), datasets:[
      {label:"Chart view (hindsight)", data:chartNet, backgroundColor:C.ghost},
      {label:"Live view (tradeable)",  data:liveNet,  backgroundColor:C.good}]},
    options:{...base, plugins:{...base.plugins, legend:{display:true,labels:{color:C.dim,font:{size:12}}}},
      scales:{...base.scales, y:{...base.scales.y, type:"logarithmic"}}}});
}

function table(){
  const f=$("#t-filter").value, s=$("#t-sort").value;
  let rows=DATA.slice();
  if (f==="live") rows=rows.filter(c=>c.view==="live");
  if (f==="survived") rows=rows.filter(c=>c.survived);
  if (f==="implausible") rows=rows.filter(c=>c.implausible);
  rows.sort((a,b)=> s==="maxdd_pct" ? a[s]-b[s] : b[s]-a[s]);
  $("#grid tbody").innerHTML = rows.slice(0,400).map(c=>`
    <tr class="${c.survived?"":"dead"} ${c.implausible?"imp":""}">
      <td>${c.instrument}</td><td>${c.lookback}mo</td>
      <td>${c.scenario}${c.stop_pct?` <span class="pill">${c.stop_pct}%</span>`:""}</td>
      <td>${c.view}${c.implausible?' <span class="pill n">impossible</span>':""}</td>
      <td>${c.atr_lag}</td>
      <td class="num">${fmt(c.final)}</td>
      <td class="num" style="color:${c.ret>=0?C.good:C.bad}">${c.ret>0?"+":""}${c.ret}%</td>
      <td class="num">${c.maxdd_pct}%</td>
      <td class="num">${c.green}/${c.days}</td>
      <td><span class="pill ${c.survived?"y":"n"}">${c.survived?"yes":"no"}</span></td>
    </tr>`).join("");
}


// ---- session detail: candles + trade markers ----
let DAYS = null, sessionChart = null, currentDay = null;
let zoom = null;               // [from, to] bar indices, null = whole session
let pickedBar = null;

const candles = {
  id:"candles",
  beforeDatasetsDraw(chart){
    const {ctx, scales:{x,y}} = chart;
    const bars = chart.$bars || [];
    ctx.save();
    const w = Math.max(1.5, (x.getPixelForValue(1) - x.getPixelForValue(0)) * 0.62);
    bars.forEach((b,i) => {
      const px = x.getPixelForValue(i), up = b.c >= b.o;
      ctx.strokeStyle = up ? "#26a69a" : "#ef5350";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, y.getPixelForValue(b.h)); ctx.lineTo(px, y.getPixelForValue(b.l)); ctx.stroke();
      const top = y.getPixelForValue(Math.max(b.o,b.c)), bot = y.getPixelForValue(Math.min(b.o,b.c));
      ctx.fillRect(px - w/2, top, w, Math.max(1, bot - top));
    });
    ctx.restore();
  }
};

const markers = {
  id:"markers",
  afterDatasetsDraw(chart){
    const {ctx, scales:{x,y}} = chart;
    const trades = chart.$trades || [], bars = chart.$bars || [];
    ctx.save(); ctx.font = "600 10px system-ui"; ctx.textAlign = "center";
    trades.forEach(t => {
      const be = bars[t.ei], bx = bars[t.xi]; if (!be || !bx) return;
      const xe = x.getPixelForValue(t.ei), xx = x.getPixelForValue(t.xi);
      const ye = y.getPixelForValue(t.entry), yx = y.getPixelForValue(t.exit);
      const win = t.pts > 0, col = win ? "#3fb950" : "#f85149";
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.globalAlpha = .85;
      ctx.beginPath(); ctx.moveTo(xe, ye); ctx.lineTo(xx, yx); ctx.stroke();
      ctx.setLineDash([3,3]); ctx.strokeStyle = "#ffb74d"; ctx.lineWidth = 1;
      const ys = y.getPixelForValue(t.stop);
      ctx.beginPath(); ctx.moveTo(xe, ys); ctx.lineTo(xx, ys); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1; ctx.fillStyle = t.side === "long" ? "#00e5ff" : "#ff4081";
      const up = t.side === "long", ty = up ? y.getPixelForValue(be.l) + 12 : y.getPixelForValue(be.h) - 12;
      ctx.beginPath();
      if (up) { ctx.moveTo(xe, ty-8); ctx.lineTo(xe-6, ty+2); ctx.lineTo(xe+6, ty+2); }
      else    { ctx.moveTo(xe, ty+8); ctx.lineTo(xe-6, ty-2); ctx.lineTo(xe+6, ty-2); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(xx, yx, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = "#e6edf3";
      ctx.fillText(`${t.pts > 0 ? "+" : ""}${t.pts}`, xx, yx + (up ? -9 : 15));
    });
    ctx.restore();
  }
};

function drawSession(date, keepZoom){
  if (!DAYS || !DAYS[date]) return;
  if (currentDay !== date || !keepZoom) { zoom = null; pickedBar = null; }
  currentDay = date;
  const d = DAYS[date];
  const key = $("#d-view").value + $("#d-lag").value;
  const lag = $("#d-lag").value;
  const trades = d.trades[key] || [];
  const mathRows = (d.math && d.math[lag]) || [];
  const n = d.bars.length;
  const [a, b] = zoom || [0, n - 1];
  const bars = d.bars.slice(a, b + 1);

  $("#day").hidden = false;
  $("#day-date").textContent = date;
  $("#zrange").textContent = `bars ${a}–${b} of ${n - 1}  (${d.bars[a].t}–${d.bars[b].t} PT)`;
  const lo = Math.min(...bars.map(x=>x.l)), hi = Math.max(...bars.map(x=>x.h)), pad = (hi-lo)*0.06 || 1;

  const shifted = trades
    .filter(t2 => t2.xi >= a && t2.ei <= b)
    .map(t2 => ({...t2, ei: t2.ei - a, xi: t2.xi - a}));

  if (sessionChart) sessionChart.destroy();
  sessionChart = new Chart($("#session"), {
    type:"line",
    data:{labels:bars.map(x=>x.t), datasets:[{data:bars.map(x=>x.c), borderColor:"transparent", pointRadius:0}]},
    options:{...base,
      plugins:{legend:{display:false}, tooltip:{enabled:false}},
      onClick:(e, els, chart)=>{
        if (suppressClick) { suppressClick = false; return; }
        const idx = Math.round(chart.scales.x.getValueForPixel(e.x));
        if (idx >= 0 && idx < bars.length) { pickedBar = a + idx; explainBar(date); }
      },
      scales:{ x:{grid:{color:C.line}, ticks:{color:C.dim, maxTicksLimit:14, font:{size:10}}},
               y:{min:lo-pad, max:hi+pad, grid:{color:C.line},
                  ticks:{color:C.dim, font:{size:10}, callback:v=>v.toLocaleString()}}}},
    plugins:[candles, markers]
  });
  sessionChart.$bars = bars; sessionChart.$trades = shifted; sessionChart.update();
  wireChartGestures();

  $("#dtrades tbody").innerHTML = trades.map(t2=>`
    <tr><td>${d.bars[t2.ei]?.t ?? ""}</td>
    <td class="${t2.side}">${t2.side.toUpperCase()}</td>
    <td class="num">${t2.entry.toLocaleString()}</td>
    <td class="num">${t2.stop.toLocaleString()}</td>
    <td>${d.bars[t2.xi]?.t ?? ""}</td>
    <td class="num">${t2.exit.toLocaleString()}</td>
    <td>${t2.why}</td>
    <td class="num" style="color:${t2.pts>=0?C.good:C.bad}">${t2.pts>0?"+":""}${t2.pts}</td>
    <td class="num" style="color:${t2.usd>=0?C.good:C.bad}">${fmt(t2.usd)}</td></tr>`).join("")
    || `<tr><td colspan="9" style="color:${C.dim}">no signals this session</td></tr>`;

  const net = trades.reduce((s,t2)=>s+t2.usd,0), wins = trades.filter(t2=>t2.pts>0).length;
  $("#day-total").textContent = trades.length
    ? `${trades.length} trades, ${wins} winners, net ${fmt(net)} on one NQ contract (times 0.1 for MNQ).`
    : "";
  if (pickedBar !== null) explainBar(date); 
  if (!keepZoom) $("#day").scrollIntoView({behavior:"smooth", block:"start"});
}


function wireChartGestures(){
  const cv = $("#session");
  if (!cv || cv.dataset.wired) return;
  cv.dataset.wired = "1";

  const clampZoom = (a, b, n) => {
    const w = Math.max(10, Math.min(n, b - a + 1));
    let lo = Math.round(a), hi = lo + w - 1;
    if (lo < 0) { lo = 0; hi = w - 1; }
    if (hi > n - 1) { hi = n - 1; lo = hi - w + 1; }
    return (w >= n) ? null : [lo, hi];
  };

  cv.addEventListener("wheel", e => {
    if (!currentDay || !DAYS || !sessionChart) return;
    e.preventDefault();
    const n = DAYS[currentDay].bars.length;
    let [a, b] = zoom || [0, n - 1];
    const span = b - a + 1;
    // keep the bar under the cursor fixed while the window grows or shrinks
    const frac = Math.min(1, Math.max(0, sessionChart.scales.x.getValueForPixel(e.offsetX) / (span - 1)));
    const anchor = a + frac * (span - 1);
    const factor = e.deltaY < 0 ? 0.8 : 1.25;
    const w = Math.max(10, Math.min(n, Math.round(span * factor)));
    zoom = clampZoom(anchor - frac * (w - 1), anchor + (1 - frac) * (w - 1), n);
    drawSession(currentDay, true);
  }, {passive:false});

  let dragging = false, startX = 0, startZoom = null;
  cv.addEventListener("pointerdown", e => {
    if (!currentDay || !DAYS) return;
    dragging = true; startX = e.offsetX;
    const n = DAYS[currentDay].bars.length;
    startZoom = zoom || [0, n - 1];
    cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing";
  });
  cv.addEventListener("pointermove", e => {
    if (!dragging || !sessionChart) return;
    const n = DAYS[currentDay].bars.length;
    const [a, b] = startZoom, span = b - a + 1;
    const perPx = span / sessionChart.chartArea.width;
    const shift = Math.round((startX - e.offsetX) * perPx);
    if (!shift) return;
    zoom = clampZoom(a + shift, b + shift, n);
    drawSession(currentDay, true);
  });
  const endDrag = e => {
    if (!dragging) return;
    dragging = false; cv.style.cursor = "crosshair";
    // a drag is not a click; suppress the bar-pick that would otherwise fire
    if (Math.abs(e.offsetX - startX) > 3) suppressClick = true;
  };
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);
  cv.addEventListener("dblclick", () => { zoom = null; drawSession(currentDay, true); });
}
let suppressClick = false;

function explainBar(date){
  const d = DAYS[date], lag = $("#d-lag").value, key = $("#d-view").value + lag;
  const i = pickedBar, bar = d.bars[i];
  if (!bar) return;
  const m = (d.math && d.math[lag] && d.math[lag][i]) || null;
  const trades = d.trades[key] || [];
  const entered = trades.find(t2 => t2.ei === i);
  const exited  = trades.find(t2 => t2.xi === i);
  const held    = trades.find(t2 => t2.ei < i && t2.xi > i);

  let html = `<div class="hdr">${bar.t} PT — ${bar.c.toLocaleString()}</div>`;
  html += `<div class="row"><span>Bar</span><b>O ${bar.o.toLocaleString()} · H ${bar.h.toLocaleString()} · L ${bar.l.toLocaleString()} · C ${bar.c.toLocaleString()}</b></div>`;

  if (m) {
    const [fall, rise, need, peak, trough, peakT, troughT] = m;
    const upFires = rise >= need, dnFires = fall >= need;
    html += `<div class="row"><span>Threshold here (2×ATR)</span><b>${need.toFixed(1)} pts</b></div>`;
    html += `<div class="row"><span>Rise from the low held at ${troughT} (${trough.toLocaleString()})</span>
             <b class="${upFires?"fire":"nofire"}">${rise.toFixed(1)} / ${need.toFixed(1)}</b></div>`;
    html += `<div class="row"><span>Fall from the high held at ${peakT} (${peak.toLocaleString()})</span>
             <b class="${dnFires?"fire":"nofire"}">${fall.toFixed(1)} / ${need.toFixed(1)}</b></div>`;
    html += `<div class="why">`;
    if (upFires)      html += `<span class="fire">Rise cleared the threshold</span> — a low is confirmed, so this is a BUY bar.`;
    else if (dnFires) html += `<span class="fire">Fall cleared the threshold</span> — a high is confirmed, so this is a SELL bar.`;
    else {
      const short = Math.min(need - rise, need - fall);
      html += `<span class="nofire">No signal.</span> Price is still ${short.toFixed(1)} points short of the
               ${need.toFixed(1)}-point move the rule needs before it will call either extreme a reversal.
               The swing may already be over — the rule cannot know that yet.`;
    }
    html += `</div>`;
  } else {
    html += `<div class="why nofire">No threshold data for this bar.</div>`;
  }

  if (entered) html += `<div class="traded"><b>Traded here.</b> ${entered.side.toUpperCase()} at
      ${entered.entry.toLocaleString()}, stop ${entered.stop.toLocaleString()}, exited ${d.bars[entered.xi]?.t}
      at ${entered.exit.toLocaleString()} (${entered.why}) for
      <b style="color:${entered.pts>=0?C.good:C.bad}">${entered.pts>0?"+":""}${entered.pts} pts</b>.</div>`;
  else if (exited) html += `<div class="traded"><b>Position closed here</b> (${exited.why}) at
      ${exited.exit.toLocaleString()} for <b style="color:${exited.pts>=0?C.good:C.bad}">${exited.pts>0?"+":""}${exited.pts} pts</b>.</div>`;
  else if (held) html += `<div class="traded">Holding a ${held.side} from ${d.bars[held.ei]?.t}
      at ${held.entry.toLocaleString()}, stop ${held.stop.toLocaleString()}.</div>`;
  else html += `<div class="traded nofire">No position open or opened on this bar.</div>`;

  $("#barinfo").innerHTML = html;
}

function wireSession(){
  $("#equity").onclick = e => {
    if (!equityChart) return;
    const pts = equityChart.getElementsAtEventForMode(e, "index", {intersect:false}, true);
    if (!pts.length) return;
    const label = equityChart.data.labels[pts[0].index];
    if (!DAYS) { fetch("days.json").then(r=>r.json()).then(d=>{DAYS=d; drawSession(label);}); }
    else drawSession(label);
  };
  ["#d-view","#d-lag"].forEach(s => $(s).onchange = () => currentDay && drawSession(currentDay, true));
  document.querySelectorAll(".zoombar button").forEach(btn => btn.onclick = () => {
    if (!currentDay || !DAYS) return;
    const bars = DAYS[currentDay].bars, n = bars.length;
    let [a,b] = zoom || [0, n-1];
    const mid = Math.round((a+b)/2), span = b-a+1;
    const k = btn.dataset.z;
    if (k === "all") zoom = null;
    else if (k === "rth") {
      const s = bars.findIndex(x => x.t >= "06:30"), e = bars.findIndex(x => x.t >= "13:00");
      zoom = [s < 0 ? 0 : s, e < 0 ? n-1 : e];
    }
    else if (k === "in")  { const w = Math.max(12, Math.round(span/2));
                            zoom = [Math.max(0, mid - Math.round(w/2)), Math.min(n-1, mid + Math.round(w/2))]; }
    else if (k === "out") { const w = Math.min(n, span*2);
                            zoom = (w >= n) ? null : [Math.max(0, mid - Math.round(w/2)), Math.min(n-1, mid + Math.round(w/2))]; }
    drawSession(currentDay, true);
  });
  $("#d-close").onclick = () => { $("#day").hidden = true; };
}

fetch("data.json").then(r=>r.json()).then(d=>{
  DATA=d; headline(); equity(); gap(); table(); wireSession();
  ["#f-inst","#f-view","#f-lb","#f-scn","#f-lag"].forEach(s=>$(s).onchange=equity);
  ["#t-filter","#t-sort"].forEach(s=>$(s).onchange=table);
  const secs=[...document.querySelectorAll("section,header")];
  new IntersectionObserver(es=>es.forEach(e=>{ if(!e.isIntersecting) return;
    document.querySelectorAll("nav a").forEach(a=>
      a.classList.toggle("on", a.getAttribute("href")==="#"+e.target.id));
  }),{rootMargin:"-45% 0px -50% 0px"}).observe && secs.forEach(s=>{
    new IntersectionObserver(es=>es.forEach(e=>{ if(!e.isIntersecting) return;
      document.querySelectorAll("nav a").forEach(a=>
        a.classList.toggle("on", a.getAttribute("href")==="#"+e.target.id));
    }),{rootMargin:"-45% 0px -50% 0px"}).observe(s);
  });
});
