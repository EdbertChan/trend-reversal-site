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

function drawSession(date){
  if (!DAYS || !DAYS[date]) return;
  currentDay = date;
  const d = DAYS[date];
  const key = $("#d-view").value + $("#d-lag").value;
  const trades = d.trades[key] || [];
  $("#day").hidden = false;
  $("#day-date").textContent = date;
  const lo = Math.min(...d.bars.map(b=>b.l)), hi = Math.max(...d.bars.map(b=>b.h)), pad = (hi-lo)*0.06;

  if (sessionChart) sessionChart.destroy();
  sessionChart = new Chart($("#session"), {
    type:"line",
    data:{labels:d.bars.map(b=>b.t), datasets:[{data:d.bars.map(b=>b.c), borderColor:"transparent", pointRadius:0}]},
    options:{...base,
      plugins:{legend:{display:false}, tooltip:{enabled:false}},
      scales:{ x:{grid:{color:C.line}, ticks:{color:C.dim, maxTicksLimit:14, font:{size:10}}},
               y:{min:lo-pad, max:hi+pad, grid:{color:C.line},
                  ticks:{color:C.dim, font:{size:10}, callback:v=>v.toLocaleString()}}}},
    plugins:[candles, markers]
  });
  sessionChart.$bars = d.bars; sessionChart.$trades = trades; sessionChart.update();

  $("#dtrades tbody").innerHTML = trades.map(t=>`
    <tr><td>${d.bars[t.ei]?.t ?? ""}</td>
    <td class="${t.side}">${t.side.toUpperCase()}</td>
    <td class="num">${t.entry.toLocaleString()}</td>
    <td class="num">${t.stop.toLocaleString()}</td>
    <td>${d.bars[t.xi]?.t ?? ""}</td>
    <td class="num">${t.exit.toLocaleString()}</td>
    <td>${t.why}</td>
    <td class="num" style="color:${t.pts>=0?C.good:C.bad}">${t.pts>0?"+":""}${t.pts}</td>
    <td class="num" style="color:${t.usd>=0?C.good:C.bad}">${fmt(t.usd)}</td></tr>`).join("")
    || `<tr><td colspan="9" style="color:${C.dim}">no signals this session</td></tr>`;

  const net = trades.reduce((a,t)=>a+t.usd,0), wins = trades.filter(t=>t.pts>0).length;
  $("#day-total").textContent = trades.length
    ? `${trades.length} trades, ${wins} winners, net ${fmt(net)} on one NQ contract (times 0.1 for MNQ).`
    : "";
  $("#day").scrollIntoView({behavior:"smooth", block:"start"});
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
  ["#d-view","#d-lag"].forEach(s => $(s).onchange = () => currentDay && drawSession(currentDay));
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
