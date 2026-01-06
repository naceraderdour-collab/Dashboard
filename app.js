// app.js - LixCap Trade Flow Dashboard v6
// Axis-aligned single range sliders

const FLOWS_URL = "data/flows_agg.csv";
const CENTROIDS_URL = "data/Country_Centroid.ISO.with_xy.csv";

// LixCap Color Palette
const COLORS = {
  dark: {
    primary: '#2d7fc4',
    secondary: '#0F4878',
    target: '#ef4444',
    text: '#ffffff',
    grid: 'rgba(255,255,255,0.1)',
    paper: 'rgba(0,0,0,0)',
    barGradient: ['#05293F', '#0a3a5c', '#0F4878', '#1a6ba8', '#2d7fc4', '#4a9ed6', '#6bb3e0', '#8cc8ea', '#adddf4', '#ceeeff'],
    lines: ['#2d7fc4', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'],
    total: '#ffffff'
  },
  light: {
    primary: '#0F4878',
    secondary: '#05293F',
    target: '#dc2626',
    text: '#05293F',
    grid: 'rgba(0,0,0,0.1)',
    paper: 'rgba(0,0,0,0)',
    barGradient: ['#ceeeff', '#adddf4', '#8cc8ea', '#6bb3e0', '#4a9ed6', '#2d7fc4', '#1a6ba8', '#0F4878', '#0a3a5c', '#05293F'],
    lines: ['#0F4878', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#ea580c', '#4f46e5'],
    total: '#05293F'
  }
};

// DOM Elements
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

// Global state
let flows = [];
let centroids = new Map();
let map, layerGroup;
let currentTheme = 'light';
let currentAnimationId = 0;
let showTotal = true;

// Data range
let dataYears = [];
let dataMaxValue = 0;

// ============================================
// THEME MANAGEMENT
// ============================================

function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  currentTheme = theme;
  localStorage.setItem('lixcap-theme', theme);
  updateMapTiles();
  rerender();
}

function toggleTheme() {
  const newTheme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
}

function initTheme() {
  const saved = localStorage.getItem('lixcap-theme');
  if (saved) {
    currentTheme = saved;
    document.documentElement.setAttribute('data-theme', saved);
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    currentTheme = 'light';
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function uniq(arr) {
  return [...new Set(arr)].filter(v => v !== null && v !== undefined && v !== "");
}

function fillSelect(select, values, labelAll = "All") {
  select.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = labelAll;
  select.appendChild(all);
  values.forEach(v => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    select.appendChild(o);
  });
}

function parseNum(x) {
  const n = Number(x);
  return isFinite(n) ? n : 0;
}

function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toFixed(0);
}

function loadCSV(url) {
  return fetch(url)
    .then(r => {
      if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
      return r.text();
    })
    .then(txt => Papa.parse(txt, { header: true, skipEmptyLines: true }).data);
}

// ============================================
// MAP INITIALIZATION
// ============================================

let tileLayer;

function initMap() {
  map = L.map("map", {
    worldCopyJump: true,
    zoomControl: true,
    preferCanvas: true
  }).setView([25, 20], 3);
  updateMapTiles();
  layerGroup = L.layerGroup().addTo(map);
}

function updateMapTiles() {
  if (tileLayer) map.removeLayer(tileLayer);
  const theme = getTheme();
  const tileUrl = theme === 'dark' 
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  tileLayer = L.tileLayer(tileUrl, {
    maxZoom: 10,
    attribution: "&copy; OpenStreetMap &copy; CartoDB",
  }).addTo(map);
}

// ============================================
// FILTERS
// ============================================

function getFilters() {
  return {
    partner: els.partner.value,
    year: els.year.value,
    product: els.product.value,
    temp: els.temp.value,
    topn: Number(els.topn.value || 10),
    metric: els.metric.value,
  };
}

function applyFilters(ignoreYear = false) {
  const f = getFilters();
  return flows.filter(r =>
    (!f.partner || r.PartnerISO3 === f.partner) &&
    (ignoreYear || !f.year || String(r.Year) === String(f.year)) &&
    (!f.product || r["Value chains"] === f.product) &&
    (!f.temp || r.Temperature === f.temp)
  );
}

function topNReporters(filtered, metric, n) {
  const m = new Map();
  for (const r of filtered) {
    const k = r.ReporterISO3;
    if (k) m.set(k, (m.get(k) || 0) + parseNum(r[metric]));
  }
  return [...m.entries()]
    .filter(d => d[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

// ============================================
// CHARTS
// ============================================

function renderBar(top, metric) {
  const theme = getTheme();
  const colors = COLORS[theme];
  
  const y = top.map(d => {
    const c = centroids.get(d[0]);
    return c ? c.Country : d[0];
  }).reverse();
  const x = top.map(d => d[1]).reverse();

  const barColors = x.map((_, i) => {
    const t = i / (x.length - 1 || 1);
    const idx = Math.floor(t * (colors.barGradient.length - 1));
    return colors.barGradient[idx];
  });

  Plotly.react("bar", [{
    type: "bar",
    orientation: "h",
    x, y,
    marker: { color: barColors, line: { color: 'rgba(255,255,255,0.2)', width: 1 } },
    hovertemplate: '<b>%{y}</b><br>%{x:,.0f}<extra></extra>'
  }], {
    margin: { l: 110, r: 20, t: 10, b: 50 },
    paper_bgcolor: colors.paper,
    plot_bgcolor: colors.paper,
    font: { color: colors.text, size: 11, family: 'Inter, sans-serif' },
    xaxis: { title: metric === "value_usd" ? "Trade Value (USD)" : "Quantity (MT)", gridcolor: colors.grid, zerolinecolor: colors.grid },
    yaxis: { gridcolor: colors.grid },
    hoverlabel: { bgcolor: theme === 'dark' ? '#05293F' : '#ffffff', bordercolor: colors.primary, font: { color: colors.text, family: 'Inter, sans-serif' } },
    transition: { duration: 400, easing: 'cubic-in-out' }
  }, { displayModeBar: false, responsive: true });
}

function renderLine(filtered, metric, topN, yearRange, valueRange) {
  const theme = getTheme();
  const colors = COLORS[theme];
  
  let allYears = [...new Set(filtered.map(r => String(r.Year)))].sort((a, b) => Number(a) - Number(b));
  
  // Apply year range
  if (yearRange && yearRange[0] !== null && yearRange[1] !== null) {
    allYears = allYears.filter(y => Number(y) >= yearRange[0] && Number(y) <= yearRange[1]);
  }
  
  // Get top N reporters
  const reporterTotals = new Map();
  for (const r of filtered) {
    const k = r.ReporterISO3;
    if (k) reporterTotals.set(k, (reporterTotals.get(k) || 0) + parseNum(r[metric]));
  }
  
  const topReporters = [...reporterTotals.entries()]
    .filter(d => d[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(d => d[0]);

  // Total by year
  const totalByYear = new Map();
  allYears.forEach(y => totalByYear.set(y, 0));
  filtered.forEach(r => {
    const y = String(r.Year);
    if (allYears.includes(y)) {
      totalByYear.set(y, (totalByYear.get(y) || 0) + parseNum(r[metric]));
    }
  });

  const traces = [];
  
  if (showTotal) {
    traces.push({
      type: "scatter",
      mode: "lines",
      name: "TOTAL",
      x: allYears,
      y: allYears.map(y => totalByYear.get(y) || 0),
      line: { color: colors.total, width: 4, shape: 'spline' },
      hovertemplate: `<b>TOTAL</b><br>%{x}: %{y:,.0f}<extra></extra>`
    });
  }

  topReporters.forEach((iso3, index) => {
    const countryData = new Map();
    allYears.forEach(y => countryData.set(y, 0));
    filtered.filter(r => r.ReporterISO3 === iso3).forEach(r => {
      const y = String(r.Year);
      if (allYears.includes(y)) {
        countryData.set(y, (countryData.get(y) || 0) + parseNum(r[metric]));
      }
    });
    const countryName = centroids.get(iso3)?.Country || iso3;
    traces.push({
      type: "scatter",
      mode: "lines",
      name: countryName,
      x: allYears,
      y: allYears.map(y => countryData.get(y) || 0),
      line: { color: colors.lines[index % colors.lines.length], width: 1.5, shape: 'spline' },
      hovertemplate: `<b>${countryName}</b><br>%{x}: %{y:,.0f}<extra></extra>`
    });
  });

  // Y-axis range
  let yAxisRange = null;
  if (valueRange && valueRange[0] !== null && valueRange[1] !== null) {
    yAxisRange = [valueRange[0], valueRange[1]];
  }

  Plotly.react("line", traces, {
    margin: { l: 70, r: 20, t: 10, b: 40 },
    paper_bgcolor: colors.paper,
    plot_bgcolor: colors.paper,
    font: { color: colors.text, size: 11, family: 'Inter, sans-serif' },
    xaxis: { title: "", gridcolor: colors.grid, zerolinecolor: colors.grid },
    yaxis: { title: metric === "value_usd" ? "USD" : "MT", gridcolor: colors.grid, zerolinecolor: colors.grid, range: yAxisRange },
    legend: { orientation: 'h', y: -0.15, x: 0.5, xanchor: 'center', font: { size: 9 }, bgcolor: 'rgba(0,0,0,0)' },
    hovermode: 'x unified',
    hoverlabel: { bgcolor: theme === 'dark' ? 'rgba(5, 41, 63, 0.95)' : 'rgba(255,255,255,0.95)', bordercolor: colors.primary, font: { color: colors.text, family: 'Inter, sans-serif', size: 10 } },
    transition: { duration: 400, easing: 'cubic-in-out' }
  }, { displayModeBar: false, responsive: true });
}

// ============================================
// MAP RENDERING
// ============================================

function drawArc(from, to, weight, color) {
  if (typeof L.curve === 'function') {
    const midLat = (from.lat + to.lat) / 2 + Math.abs(from.lon - to.lon) * 0.12;
    const midLon = (from.lon + to.lon) / 2;
    return L.curve(["M", [from.lat, from.lon], "Q", [midLat, midLon], [to.lat, to.lon]], { weight, opacity: 0.7, color, fill: false });
  }
  return L.polyline([[from.lat, from.lon], [to.lat, to.lon]], { weight, opacity: 0.6, color });
}

function renderMap(partnerISO3, top, metric) {
  const theme = getTheme();
  const colors = COLORS[theme];
  const thisAnimationId = ++currentAnimationId;
  layerGroup.clearLayers();

  // Remove existing legend
  const existingLegend = document.querySelector('.map-legend');
  if (existingLegend) existingLegend.remove();

  const dest = centroids.get(partnerISO3);
  if (!dest || !top || top.length === 0) return;

  const maxVal = Math.max(...top.map(d => d[1]), 1);
  const minVal = Math.min(...top.map(d => d[1]), 0);
  const maxScaled = Math.sqrt(maxVal);
  const boundsPts = [[dest.lat, dest.lon]];

  const exporterData = [];
  top.forEach(([iso3, val]) => {
    const src = centroids.get(iso3);
    if (!src) return;
    boundsPts.push([src.lat, src.lon]);
    const scaled = Math.sqrt(Math.max(val, 0));
    const t = scaled / maxScaled;
    exporterData.push({ iso3, val, src, radius: 5 + 14 * t, lineWeight: 1.5 + 5 * t });
  });

  const destMarker = L.circleMarker([dest.lat, dest.lon], { radius: 12, weight: 3, color: '#ffffff', fillColor: colors.target, fillOpacity: 0.95 });
  destMarker.bindTooltip(`<b>Destination: ${dest.Country}</b>`, { permanent: true, direction: 'bottom' });
  destMarker.addTo(layerGroup);

  exporterData.forEach((data) => {
    if (currentAnimationId !== thisAnimationId) return;
    const arc = drawArc(data.src, dest, data.lineWeight, colors.primary);
    arc.bindTooltip(`<b>${data.src.Country}</b> → ${dest.Country}<br><b>${formatNumber(data.val)}</b> ${metric === "value_usd" ? "USD" : "MT"}`, { sticky: true });
    arc.addTo(layerGroup);
    const marker = L.circleMarker([data.src.lat, data.src.lon], { radius: data.radius, weight: 2, color: '#ffffff', fillColor: colors.primary, fillOpacity: 0.85 });
    marker.bindTooltip(`<b>${data.src.Country}</b><br><b>${formatNumber(data.val)}</b> ${metric === "value_usd" ? "USD" : "MT"}`, { sticky: true });
    marker.addTo(layerGroup);
  });

  // Add size legend
  addMapLegend(maxVal, minVal, metric, colors);

  map.flyToBounds(L.latLngBounds(boundsPts).pad(0.15), { duration: 0.8, easeLinearity: 0.25 });
}

function addMapLegend(maxVal, minVal, metric, colors) {
  const mapContainer = document.getElementById('map');
  
  // Create legend element
  const legend = document.createElement('div');
  legend.className = 'map-legend';
  
  const unit = metric === "value_usd" ? "USD" : "MT";
  
  // Calculate sizes for legend (max, mid, min)
  const maxRadius = 19; // 5 + 14 * 1
  const midRadius = 12; // 5 + 14 * 0.5
  const minRadius = 5;  // 5 + 14 * 0
  
  const midVal = maxVal * 0.25; // sqrt(0.5)^2 = 0.25
  
  legend.innerHTML = `
    <div class="legend-title">Export Volume</div>
    <div class="legend-items">
      <div class="legend-item">
        <svg width="40" height="40">
          <circle cx="20" cy="20" r="${maxRadius}" fill="${colors.primary}" fill-opacity="0.85" stroke="white" stroke-width="2"/>
        </svg>
        <span>${formatNumber(maxVal)}</span>
      </div>
      <div class="legend-item">
        <svg width="40" height="40">
          <circle cx="20" cy="20" r="${midRadius}" fill="${colors.primary}" fill-opacity="0.85" stroke="white" stroke-width="2"/>
        </svg>
        <span>${formatNumber(midVal)}</span>
      </div>
      <div class="legend-item">
        <svg width="40" height="40">
          <circle cx="20" cy="20" r="${minRadius}" fill="${colors.primary}" fill-opacity="0.85" stroke="white" stroke-width="2"/>
        </svg>
        <span>Min</span>
      </div>
    </div>
    <div class="legend-unit">${unit}</div>
  `;
  
  mapContainer.appendChild(legend);
}

// ============================================
// CHART CONTROLS
// ============================================

function setupLineChartControls() {
  const container = document.getElementById('line').parentElement;
  if (document.getElementById('lineChartWrapper')) return;

  const chartDiv = document.getElementById('line');
  
  // Create wrapper
  const wrapper = document.createElement('div');
  wrapper.id = 'lineChartWrapper';
  wrapper.className = 'line-chart-wrapper';
  
  // Header with toggle and reset
  const header = document.createElement('div');
  header.className = 'chart-header-controls';
  header.innerHTML = `
    <div class="toggle-container">
      <span class="toggle-label">Show Total</span>
      <label class="toggle-switch">
        <input type="checkbox" id="totalToggle" checked>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <button id="resetZoom" class="btn-zoom-reset">Reset Zoom</button>
  `;
  
  // Chart area with Y slider
  const chartArea = document.createElement('div');
  chartArea.className = 'chart-area';
  
  // Y-axis slider (left side)
  const ySlider = document.createElement('div');
  ySlider.className = 'y-slider-container';
  ySlider.innerHTML = `
    <input type="range" id="yZoomSlider" class="axis-slider y-slider" min="0" max="100" value="100">
    <div class="slider-thumb-custom y-thumb" id="yThumb"></div>
  `;
  
  // Chart container
  const chartContainer = document.createElement('div');
  chartContainer.className = 'chart-container';
  chartContainer.appendChild(chartDiv);
  
  chartArea.appendChild(ySlider);
  chartArea.appendChild(chartContainer);
  
  // X-axis slider (bottom)
  const xSlider = document.createElement('div');
  xSlider.className = 'x-slider-container';
  xSlider.innerHTML = `
    <input type="range" id="xZoomSlider" class="axis-slider x-slider" min="0" max="100" value="100">
    <div class="slider-thumb-custom x-thumb" id="xThumb"></div>
  `;
  
  wrapper.appendChild(header);
  wrapper.appendChild(chartArea);
  wrapper.appendChild(xSlider);
  
  container.appendChild(wrapper);
  
  // Event listeners
  document.getElementById('totalToggle').addEventListener('change', function() {
    showTotal = this.checked;
    updateLineChart();
  });
  
  document.getElementById('resetZoom').addEventListener('click', () => {
    document.getElementById('xZoomSlider').value = 100;
    document.getElementById('yZoomSlider').value = 100;
    updateThumbPositions();
    updateLineChart();
  });
  
  document.getElementById('xZoomSlider').addEventListener('input', function() {
    updateThumbPositions();
    updateLineChart();
  });
  
  document.getElementById('yZoomSlider').addEventListener('input', function() {
    updateThumbPositions();
    updateLineChart();
  });
  
  updateThumbPositions();
}

function updateThumbPositions() {
  const xSlider = document.getElementById('xZoomSlider');
  const ySlider = document.getElementById('yZoomSlider');
  const xThumb = document.getElementById('xThumb');
  const yThumb = document.getElementById('yThumb');
  
  if (xSlider && xThumb) {
    const xPercent = xSlider.value / 100;
    xThumb.style.left = `${xPercent * 100}%`;
  }
  
  if (ySlider && yThumb) {
    const yPercent = ySlider.value / 100;
    // Y slider is inverted (100 at top, 0 at bottom)
    yThumb.style.top = `${(1 - yPercent) * 100}%`;
  }
}

function updateLineChart() {
  const f = getFilters();
  const filtered = applyFilters(true);
  
  const xZoom = Number(document.getElementById('xZoomSlider')?.value || 100) / 100;
  const yZoom = Number(document.getElementById('yZoomSlider')?.value || 100) / 100;
  
  // Calculate ranges based on zoom
  const minYear = Math.min(...dataYears);
  const maxYear = Math.max(...dataYears);
  const yearSpan = maxYear - minYear;
  
  // X zoom: 100% = all years, lower = fewer years from the end
  const yearRangeStart = minYear;
  const yearRangeEnd = minYear + Math.round(yearSpan * xZoom);
  
  // Y zoom: 100% = full range, lower = smaller max value  
  const valueRangeMin = 0;
  const valueRangeMax = dataMaxValue * yZoom;
  
  renderLine(filtered, f.metric, f.topn, 
    [yearRangeStart, yearRangeEnd], 
    [valueRangeMin, valueRangeMax]
  );
}

// ============================================
// MAIN RENDER
// ============================================

function rerender() {
  const f = getFilters();
  
  const filteredForBar = applyFilters(false);
  const top = topNReporters(filteredForBar, f.metric, f.topn);
  
  const filteredForLine = applyFilters(true);
  
  // Calculate data range
  dataYears = [...new Set(filteredForLine.map(r => Number(r.Year)))].filter(y => !isNaN(y));
  const totalByYear = new Map();
  filteredForLine.forEach(r => {
    const y = String(r.Year);
    totalByYear.set(y, (totalByYear.get(y) || 0) + parseNum(r[f.metric]));
  });
  dataMaxValue = Math.max(...totalByYear.values(), 1);
  
  renderBar(top, f.metric);
  setupLineChartControls();
  
  // Reset zoom on filter change
  const xSlider = document.getElementById('xZoomSlider');
  const ySlider = document.getElementById('yZoomSlider');
  if (xSlider) xSlider.value = 100;
  if (ySlider) ySlider.value = 100;
  updateThumbPositions();
  
  renderLine(filteredForLine, f.metric, f.topn, null, null);

  if (f.partner) {
    renderMap(f.partner, top, f.metric);
  } else {
    layerGroup.clearLayers();
    map.setView([25, 20], 2);
  }
}

// ============================================
// INITIALIZATION
// ============================================

async function main() {
  initTheme();
  initMap();

  try {
    const centroidData = await loadCSV(CENTROIDS_URL);
    for (const r of centroidData) {
      const iso = String(r.ReporterISO3 || '').trim();
      const lat = parseNum(r.y_lat);
      const lon = parseNum(r.x_lon);
      if (iso && isFinite(lat) && isFinite(lon)) {
        centroids.set(iso, { lat, lon, Country: r.Country });
      }
    }

    flows = await loadCSV(FLOWS_URL);
    for (const r of flows) {
      r.value_usd = parseNum(r.value_usd);
      r.quantity_mt = parseNum(r.quantity_mt);
    }

    const partners = uniq(flows.map(r => r.PartnerISO3)).sort();
    els.partner.innerHTML = '';
    partners.forEach(iso => {
      const c = centroids.get(iso);
      const o = document.createElement("option");
      o.value = iso;
      o.textContent = c ? `${c.Country} (${iso})` : iso;
      els.partner.appendChild(o);
    });
    // Set default country (first in list)
    if (partners.length > 0) {
      els.partner.value = partners[0];
    }

    fillSelect(els.year, uniq(flows.map(r => String(r.Year))).sort((a, b) => Number(b) - Number(a)));
    fillSelect(els.product, uniq(flows.map(r => r["Value chains"])).sort());
    fillSelect(els.temp, uniq(flows.map(r => r.Temperature)).sort());

    [els.partner, els.year, els.topn, els.product, els.temp, els.metric].forEach(el =>
      el.addEventListener("change", rerender)
    );

    els.reset.addEventListener("click", () => {
      els.partner.value = "";
      els.year.value = "";
      els.product.value = "";
      els.temp.value = "";
      els.topn.value = "10";
      els.metric.value = "value_usd";
      showTotal = true;
      const toggle = document.getElementById('totalToggle');
      if (toggle) toggle.checked = true;
      rerender();
    });

    els.themeToggle.addEventListener("click", toggleTheme);
    rerender();

  } catch (err) {
    console.error("Initialization error:", err);
    alert("Failed to load data. Run via local web server.\n\n" + err.message);
  }
}

main();
