// app.js - LixCap Trade Flow Dashboard v11
// Improved range slider + USA imports card

const FLOWS_URL = "data/flows_agg.csv";
const CENTROIDS_URL = "data/Country_Centroid.ISO.with_xy.csv";

const COLORS = {
  dark: {
    primary: '#2d7fc4', secondary: '#0F4878', target: '#ef4444', text: '#ffffff',
    grid: 'rgba(255,255,255,0.1)', paper: 'rgba(0,0,0,0)',
    barGradient: ['#05293F', '#0a3a5c', '#0F4878', '#1a6ba8', '#2d7fc4', '#4a9ed6', '#6bb3e0', '#8cc8ea', '#adddf4', '#ceeeff'],
    lines: ['#2d7fc4', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'],
    total: '#ffffff', slider: '#0F4878'
  },
  light: {
    primary: '#0F4878', secondary: '#05293F', target: '#dc2626', text: '#05293F',
    grid: 'rgba(0,0,0,0.1)', paper: 'rgba(0,0,0,0)',
    barGradient: ['#ceeeff', '#adddf4', '#8cc8ea', '#6bb3e0', '#4a9ed6', '#2d7fc4', '#1a6ba8', '#0F4878', '#0a3a5c', '#05293F'],
    lines: ['#0F4878', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#ea580c', '#4f46e5'],
    total: '#05293F', slider: '#0F4878'
  }
};

const els = {
  partner: document.getElementById("partner"),
  year: document.getElementById("year"),
  topn: document.getElementById("topn"),
  product: document.getElementById("product"),
  temp: document.getElementById("temp"),
  metric: document.getElementById("metric"),
  reset: document.getElementById("reset"),
  themeToggle: document.getElementById("themeToggle"),
};

let flows = [], centroids = new Map(), map, layerGroup, tileLayer;
let currentTheme = 'light', currentAnimationId = 0, showTotal = true, showBreakdown = false;
let dataMaxValue = 0;

// Theme
function getTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; }
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  currentTheme = t;
  localStorage.setItem('lixcap-theme', t);
  updateMapTiles();
  rerender();
}
function toggleTheme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); }
function initTheme() {
  const s = localStorage.getItem('lixcap-theme');
  currentTheme = s || 'light';
  document.documentElement.setAttribute('data-theme', currentTheme);
}

// Utils
function uniq(a) { return [...new Set(a)].filter(v => v != null && v !== ""); }
function fillSelect(sel, vals, all = "All") {
  sel.innerHTML = `<option value="">${all}</option>` + vals.map(v => `<option value="${v}">${v}</option>`).join('');
}
function parseNum(x) { const n = Number(x); return isFinite(n) ? n : 0; }
function formatNumber(n) {
  if (n >= 1e9) return (n/1e9).toFixed(1)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toFixed(0);
}
function formatNumberFull(n) {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}
function loadCSV(url) {
  return fetch(url).then(r => r.ok ? r.text() : Promise.reject(url))
    .then(t => Papa.parse(t, {header:true, skipEmptyLines:true}).data);
}

// Map
function initMap() {
  map = L.map("map", {worldCopyJump:true, zoomControl:true, preferCanvas:true}).setView([25,20],3);
  updateMapTiles();
  layerGroup = L.layerGroup().addTo(map);
}
function updateMapTiles() {
  if (tileLayer) map.removeLayer(tileLayer);
  const url = getTheme()==='dark' 
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  tileLayer = L.tileLayer(url, {maxZoom:10, attribution:"© OSM © CartoDB"}).addTo(map);
}

// Filters
function getFilters() {
  return {
    partner: els.partner.value, year: els.year.value, product: els.product.value,
    temp: els.temp.value, topn: Number(els.topn.value||10), metric: els.metric.value
  };
}
function applyFilters(ignoreYear=false) {
  const f = getFilters();
  return flows.filter(r =>
    (!f.partner || r.PartnerISO3===f.partner) &&
    (ignoreYear || !f.year || String(r.Year)===String(f.year)) &&
    (!f.product || r["Value chains"]===f.product) &&
    (!f.temp || r.Temperature===f.temp)
  );
}
function topNReporters(filtered, metric, n) {
  const m = new Map();
  filtered.forEach(r => { if(r.ReporterISO3) m.set(r.ReporterISO3, (m.get(r.ReporterISO3)||0)+parseNum(r[metric])); });
  return [...m.entries()].filter(d=>d[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,n);
}

// Get USA ranking and value
function getUSAData(filtered, metric) {
  const m = new Map();
  filtered.forEach(r => { 
    if(r.ReporterISO3) m.set(r.ReporterISO3, (m.get(r.ReporterISO3)||0)+parseNum(r[metric])); 
  });
  const sorted = [...m.entries()].filter(d=>d[1]>0).sort((a,b)=>b[1]-a[1]);
  const usaIndex = sorted.findIndex(d => d[0] === 'USA');
  const usaValue = m.get('USA') || 0;
  return {
    rank: usaIndex >= 0 ? usaIndex + 1 : null,
    value: usaValue,
    total: sorted.length
  };
}

// Update USA Card
function updateUSACard() {
  const f = getFilters();
  const filtered = applyFilters(false);
  const usaData = getUSAData(filtered, f.metric);
  
  const valueEl = document.getElementById('usaValue');
  const rankEl = document.getElementById('usaRank');
  const unitEl = document.getElementById('usaUnit');
  
  if (valueEl && rankEl && unitEl) {
    if (usaData.value > 0) {
      valueEl.textContent = formatNumber(usaData.value);
      rankEl.textContent = usaData.rank ? `Rank #${usaData.rank} of ${usaData.total}` : 'Not ranked';
      unitEl.textContent = f.metric === 'value_usd' ? 'USD' : 'MT';
    } else {
      valueEl.textContent = 'N/A';
      rankEl.textContent = 'No imports from USA';
      unitEl.textContent = f.metric === 'value_usd' ? 'USD' : 'MT';
    }
  }
}

// Bar Chart
function renderBar(top, metric) {
  const theme = getTheme(), colors = COLORS[theme];
  const y = top.map(d => centroids.get(d[0])?.Country || d[0]).reverse();
  const x = top.map(d => d[1]).reverse();
  const barColors = x.map((_,i) => colors.barGradient[Math.floor((i/(x.length-1||1))*(colors.barGradient.length-1))]);

  Plotly.react("bar", [{
    type:"bar", orientation:"h", x, y,
    marker:{color:barColors, line:{color:'rgba(255,255,255,0.2)',width:1}},
    hovertemplate:'<b>%{y}</b><br>%{x:,.0f}<extra></extra>'
  }], {
    margin:{l:110,r:20,t:10,b:50},
    paper_bgcolor:colors.paper, plot_bgcolor:colors.paper,
    font:{color:colors.text, size:11, family:'Inter,sans-serif'},
    xaxis:{title:metric==="value_usd"?"Trade Value (USD)":"Quantity (MT)", gridcolor:colors.grid, zerolinecolor:colors.grid},
    yaxis:{gridcolor:colors.grid},
    hoverlabel:{bgcolor:theme==='dark'?'#05293F':'#fff', bordercolor:colors.primary, font:{color:colors.text}},
    transition:{duration:400,easing:'cubic-in-out'}
  }, {displayModeBar:false, responsive:true});
}

// Line Chart - Clean design with custom range slider
function renderLine(filtered, metric, topN) {
  const theme = getTheme();
  const colors = COLORS[theme];

  // Years present in current filtered dataset
  let allYears = [...new Set(filtered.map(r => String(r.Year)))]
    .filter(y => y && y !== "undefined" && y !== "null")
    .sort((a, b) => Number(a) - Number(b));

  // Top N reporters by selected metric (within current filters)
  const reporterTotals = new Map();
  for (const r of filtered) {
    const k = r.ReporterISO3;
    if (!k) continue;
    reporterTotals.set(k, (reporterTotals.get(k) || 0) + parseNum(r[metric]));
  }
  const topReporters = [...reporterTotals.entries()]
    .filter(d => d[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(d => d[0]);

  // Total line
  const totalByYear = new Map();
  allYears.forEach(y => totalByYear.set(y, 0));
  for (const r of filtered) {
    const y = String(r.Year);
    if (!totalByYear.has(y)) continue;
    totalByYear.set(y, (totalByYear.get(y) || 0) + parseNum(r[metric]));
  }

  // Build traces
  const traces = [];

  if (showTotal) {
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      name: "TOTAL",
      x: allYears,
      y: allYears.map(y => totalByYear.get(y) || 0),
      line: { color: colors.total || colors.accent || "#5cc8ff", width: 3, shape: "spline" },
      marker: { size: 6, color: colors.total },
      hovertemplate: `<b>TOTAL</b><br>%{x}: %{y:,.0f}<extra></extra>`
    });
  }

  if (showBreakdown) {
    topReporters.forEach((iso3, index) => {
      const countryData = new Map();
      allYears.forEach(y => countryData.set(y, 0));
  
      for (const r of filtered) {
        if (r.ReporterISO3 !== iso3) continue;
        const y = String(r.Year);
        if (!countryData.has(y)) continue;
        countryData.set(y, (countryData.get(y) || 0) + parseNum(r[metric]));
      }
  
      const countryName = (centroids && centroids.get && centroids.get(iso3))
        ? (centroids.get(iso3).Country || iso3)
        : iso3;
  
      traces.push({
        type: "scatter",
        mode: "lines+markers",
        name: countryName,
        x: allYears,
        y: allYears.map(y => countryData.get(y) || 0),
        line: { color: (colors.lines && colors.lines.length) ? colors.lines[index % colors.lines.length] : undefined, width: 2, shape: "spline" },
        marker: { size: 5 },
        hovertemplate: `<b>${countryName}</b><br>%{x}: %{y:,.0f}<extra></extra>`
      });
    });
  }

  // Y-axis range
  const maxY = Math.max(1, ...traces.flatMap(t => (t.y || [])));
  const yAxisRange = [0, maxY * 1.1];

  Plotly.react("line", traces, {
    margin: { l: 60, r: 15, t: 10, b: 55 },
    paper_bgcolor: colors.paper,
    plot_bgcolor: colors.paper,
    font: { color: colors.text, size: 11, family: "Inter, sans-serif" },

    xaxis: {
      title: { text: "", font: { size: 10 } },
      type: "category",
      gridcolor: colors.grid,
      zerolinecolor: colors.grid,
      tickfont: { size: 10 },
      automargin: false,
      fixedrange: false,
      rangeslider: {
        visible: true,
        thickness: 0.08,
        bgcolor: theme === 'dark' ? 'rgba(15, 72, 120, 0.2)' : 'rgba(15, 72, 120, 0.1)',
        bordercolor: colors.primary,
        borderwidth: 1
      }
    },

    yaxis: {
      title: { text: metric === "value_usd" ? "USD" : "MT", standoff: 5, font: { size: 10 } },
      gridcolor: colors.grid,
      zerolinecolor: colors.grid,
      range: yAxisRange,
      automargin: true,
      tickfont: { size: 10 },
      tickformat: "~s"
    },

    legend: {
      orientation: "h",
      y: -0.32,
      yanchor: "top",
      x: 0.5,
      xanchor: "center",
      font: { size: 9 },
      bgcolor: "rgba(0,0,0,0)"
    },

    hovermode: "x unified",
    hoverlabel: {
      bgcolor: theme === "dark" ? "rgba(5,41,63,0.92)" : "rgba(255,255,255,0.92)",
      bordercolor: colors.grid,
      font: { color: colors.text, family: "Inter, sans-serif", size: 10 }
    }
  }, { displayModeBar: false, responsive: true });
}

// Map
function drawArc(from, to, weight, color) {
  if (typeof L.curve==='function') {
    const midLat=(from.lat+to.lat)/2+Math.abs(from.lon-to.lon)*0.12, midLon=(from.lon+to.lon)/2;
    return L.curve(["M",[from.lat,from.lon],"Q",[midLat,midLon],[to.lat,to.lon]],{weight,opacity:0.7,color,fill:false,interactive:false,bubblingMouseEvents:false});
  }
  return L.polyline([[from.lat,from.lon],[to.lat,to.lon]],{weight,opacity:0.6,color,interactive:false,bubblingMouseEvents:false});
}

function renderMap(partnerISO3, top, metric) {
  const theme=getTheme(), colors=COLORS[theme], thisId=++currentAnimationId;
  layerGroup.clearLayers();
  document.querySelector('.map-legend')?.remove();

  const dest=centroids.get(partnerISO3);
  if(!dest||!top?.length) return;

  const maxVal=Math.max(...top.map(d=>d[1]),1), maxScaled=Math.sqrt(maxVal);
  const boundsPts=[[dest.lat,dest.lon]];
  const data=[];
  
  top.forEach(([iso3,val])=>{
    const src=centroids.get(iso3);
    if(!src)return;
    boundsPts.push([src.lat,src.lon]);
    const t=Math.sqrt(Math.max(val,0))/maxScaled;
    data.push({iso3,val,src,radius:5+14*t,lineWeight:1.5+5*t});
  });

  L.circleMarker([dest.lat,dest.lon],{radius:12,weight:3,color:'#fff',fillColor:colors.target,fillOpacity:0.95})
    .bindTooltip(`<b>Importer: ${dest.Country}</b>`,{permanent:true,direction:'bottom'}).addTo(layerGroup);

  data.forEach(d=>{
    if(currentAnimationId!==thisId)return;
    drawArc(d.src,dest,d.lineWeight,colors.primary).addTo(layerGroup);
    L.circleMarker([d.src.lat,d.src.lon],{radius:d.radius,weight:2,color:'#fff',fillColor:colors.primary,fillOpacity:0.85})
      .bindTooltip(`<b>${d.src.Country}</b><br><b>${formatNumber(d.val)}</b> ${metric==="value_usd"?"USD":"MT"}`,{sticky:true}).addTo(layerGroup);
  });

  // Legend
  const legend=document.createElement('div');
  legend.className='map-legend';
  legend.innerHTML=`
    <div class="legend-title">Import flow</div>
    <div class="legend-items">
      <div class="legend-item"><svg width="40" height="40"><circle cx="20" cy="20" r="19" fill="${colors.primary}" fill-opacity="0.85" stroke="white" stroke-width="2"/></svg><span>${formatNumber(maxVal)}</span></div>
      <div class="legend-item"><svg width="40" height="40"><circle cx="20" cy="20" r="12" fill="${colors.primary}" fill-opacity="0.85" stroke="white" stroke-width="2"/></svg><span>${formatNumber(maxVal*0.25)}</span></div>
      <div class="legend-item"><svg width="40" height="40"><circle cx="20" cy="20" r="5" fill="${colors.primary}" fill-opacity="0.85" stroke="white" stroke-width="2"/></svg><span>Min</span></div>
    </div>
    <div class="legend-unit">${metric==="value_usd"?"USD":"MT"}</div>`;
  document.getElementById('map').appendChild(legend);

  map.flyToBounds(L.latLngBounds(boundsPts).pad(0.15),{duration:0.8,easeLinearity:0.25});
}

// Setup controls
function setupControls() {
  const card = document.querySelector('.card:has(#line)');
  if (!card || document.getElementById('totalToggle')) return;
  
  const header = card.querySelector('.card-header');
  
  const toggle = document.createElement('div');
  toggle.className = 'header-controls';
  toggle.innerHTML = `
    <div class="toggle-item">
      <label class="toggle-switch">
        <input type="checkbox" id="totalToggle" checked>
        <span class="toggle-slider"></span>
      </label>
      <span>Total</span>
    </div>
    <div class="toggle-item">
      <label class="toggle-switch">
        <input type="checkbox" id="breakdownToggle">
        <span class="toggle-slider"></span>
      </label>
      <span>Breakdown (Top N)</span>
    </div>`;
  header.appendChild(toggle);
  
  const totalEl = document.getElementById('totalToggle');
  const breakdownEl = document.getElementById('breakdownToggle');

  function enforceLineToggles(changed) {
    const t = !!totalEl.checked;
    const b = !!breakdownEl.checked;

    if (changed === 'breakdown' && b) totalEl.checked = false;
    if (changed === 'total' && totalEl.checked) breakdownEl.checked = false;

    if (!totalEl.checked && !breakdownEl.checked) totalEl.checked = true;

    showTotal = !!totalEl.checked;
    showBreakdown = !!breakdownEl.checked;
  }

  totalEl.addEventListener('change', () => {
    enforceLineToggles('total');
    const f = getFilters();
    renderLine(applyFilters(true), f.metric, f.topn);
  });

  breakdownEl.addEventListener('change', () => {
    enforceLineToggles('breakdown');
    const f = getFilters();
    renderLine(applyFilters(true), f.metric, f.topn);
  });

  showTotal = !!totalEl.checked;
  showBreakdown = !!breakdownEl.checked;
}

// Main render
function rerender() {
  const f = getFilters();
  const filteredBar = applyFilters(false);
  const top = topNReporters(filteredBar, f.metric, f.topn);
  const filteredLine = applyFilters(true);

  // Titles
  const importerName = (f.partner && centroids.get(f.partner)) ? centroids.get(f.partner).Country : (f.partner || "Importer");
  const metricLabel = f.metric === "value_usd" ? "Value (USD)" : "Quantity (MT)";
  const topLabel = `Top ${f.topn}`;

  const mapTitleEl = document.getElementById("mapTitle");
  if (mapTitleEl) {
    mapTitleEl.textContent = f.partner
      ? `${topLabel} Export Sources to ${importerName} — ${metricLabel}`
      : `Top Export Sources — ${metricLabel}`;
  }
  const barTitleEl = document.getElementById("barTitle");
  if (barTitleEl) barTitleEl.textContent = f.partner ? `${topLabel} Exporters to ${importerName}` : `${topLabel} Exporters`;

  const lineTitleEl = document.getElementById("lineTitle");
  if (lineTitleEl) lineTitleEl.textContent = f.partner ? `Imports to ${importerName} Over Time — ${metricLabel}` : `Over Time — ${metricLabel}`;

  renderBar(top, f.metric);
  setupControls();
  renderLine(filteredLine, f.metric, f.topn);
  updateUSACard();

  if (f.partner) {
    renderMap(f.partner, top, f.metric);
  } else {
    layerGroup.clearLayers();
    map.setView([25,20],2);
  }
}

// Init
async function main() {
  initTheme();
  initMap();

  try {
    const centroidData = await loadCSV(CENTROIDS_URL);
    centroidData.forEach(r => {
      const iso=String(r.ReporterISO3||'').trim(), lat=parseNum(r.y_lat), lon=parseNum(r.x_lon);
      if(iso&&isFinite(lat)&&isFinite(lon)) centroids.set(iso,{lat,lon,Country:r.Country});
    });

    flows = await loadCSV(FLOWS_URL);
    flows.forEach(r => { r.value_usd=parseNum(r.value_usd); r.quantity_mt=parseNum(r.quantity_mt); });

    const partners = uniq(flows.map(r=>r.PartnerISO3)).sort();
    els.partner.innerHTML = '';
    partners.forEach(iso => {
      const c=centroids.get(iso), o=document.createElement("option");
      o.value=iso; o.textContent=c?`${c.Country} (${iso})`:iso;
      els.partner.appendChild(o);
    });
    if(partners.length) els.partner.value=partners[0];

    fillSelect(els.year, uniq(flows.map(r=>String(r.Year))).sort((a,b)=>b-a));
    fillSelect(els.product, uniq(flows.map(r=>r["Value chains"])).sort());
    fillSelect(els.temp, uniq(flows.map(r=>r.Temperature)).sort());

    [els.partner,els.year,els.topn,els.product,els.temp,els.metric].forEach(el=>el.addEventListener("change",rerender));

    els.reset.addEventListener("click", () => {
      els.partner.value=partners[0]||""; els.year.value=""; els.product.value=""; els.temp.value="";
      els.topn.value="10"; els.metric.value="value_usd"; showTotal=true; showBreakdown=false;
      const t=document.getElementById('totalToggle'); if(t)t.checked=true;
      const b=document.getElementById('breakdownToggle'); if(b)b.checked=false;
      rerender();
    });

    els.themeToggle.addEventListener("click", toggleTheme);
    rerender();
  } catch(err) {
    console.error(err);
    alert("Failed to load. Use local server.\n\n"+err);
  }
}

main();
