/**
 * UrbanTwin AI - Master Frontend Controller
 * Centralized Multi-Camera ANPR, Single-Plate Trajectory Tracking, Macro Traffic & Alert System
 */

let cityMap = null;
let trajectoryMap = null;
let trajPolyline = null;
let trajMarkers = [];
let animVehicleMarker = null;
let corridorMap = null;
let corridorPolyline = null;
let corridorMarkers = [];
let corridorVehicleMarker = null;
let activeCorridorId = 'CORRIDOR-AMB-911';
let currentCorridorData = null;
let currentTab = '3dtwin';
let activeTrackedPlate = '7XYZ912';
let speedChart = null;
let heatmapLayerActive = true;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initClock();
  initLeafletMaps();
  loadInitialDashboardData();
  
  // Hash route detection (e.g. #tracking, #corridor, #ocr, #alerts)
  const hash = window.location.hash.replace('#', '');
  if (hash && ['3dtwin', 'tracking', 'corridor', 'macro', 'ocr', 'alerts', 'simulation'].includes(hash)) {
    switchTab(hash);
  } else {
    switchTab('3dtwin');
  }

  // Periodic refresh
  setInterval(() => {
    if (currentTab === 'corridor') loadCorridorData();
    if (currentTab === 'macro') loadMacroTraffic();
    if (currentTab === 'alerts') loadAlerts();
  }, 12000);
});

// Live UTC Clock
function initClock() {
  const clockEl = document.getElementById('live-clock');
  function update() {
    const now = new Date();
    if (clockEl) clockEl.innerText = now.toUTCString().split(' ')[4] + ' UTC';
  }
  update();
  setInterval(update, 1000);
}

// TAB SWITCHER
window.switchTab = function (tabId) {
  currentTab = tabId;
  if (window.playAudioCue) window.playAudioCue('tab');
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('text-white', 'bg-white/15', 'border-white/30', 'shadow-[0_0_15px_rgba(255,255,255,0.08)]', 'bg-cyan-600/30', 'border-cyan-500/40');
    btn.classList.add('text-zinc-400', 'border-transparent');
  });

  const activePanel = document.getElementById(`tab-${tabId}`);
  if (activePanel) activePanel.classList.remove('hidden');

  const activeBtn = document.getElementById(`nav-${tabId}`);
  if (activeBtn) {
    activeBtn.classList.remove('text-zinc-400', 'text-slate-400', 'border-transparent');
    activeBtn.classList.add('text-white', 'bg-white/15', 'border-white/30', 'shadow-[0_0_15px_rgba(255,255,255,0.08)]');
  }

  const activeMobileBtn = document.getElementById(`mobile-nav-${tabId}`);
  if (activeMobileBtn) {
    activeMobileBtn.classList.remove('text-zinc-400', 'text-slate-400', 'border-transparent');
    activeMobileBtn.classList.add('text-white', 'bg-white/15', 'border-white/30');
    try {
      activeMobileBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    } catch (_) {}
  }

  // Synchronize Mobile Bottom Navigation Bar
  document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
    btn.classList.remove('text-white', 'bg-white/15', 'border-white/25', 'text-cyan-400', 'bg-cyan-500/15', 'border-cyan-500/40');
    btn.classList.add('text-zinc-400');
    const dot = btn.querySelector('.active-dot');
    if (dot) dot.classList.add('hidden');
  });
  const activeBottomBtn = document.getElementById(`bottom-nav-${tabId}`);
  if (activeBottomBtn) {
    activeBottomBtn.classList.remove('text-zinc-400', 'text-slate-400');
    activeBottomBtn.classList.add('text-white', 'bg-white/15', 'border-white/25');
    const dot = activeBottomBtn.querySelector('.active-dot');
    if (dot) dot.classList.remove('hidden');
    try {
      activeBottomBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    } catch (_) {}
  }

  // Performance Optimization: Pause inactive 3D & canvas animation loops
  if (tabId === '3dtwin') {
    if (window.resumeDigitalTwin3D) window.resumeDigitalTwin3D();
  } else {
    if (window.pauseDigitalTwin3D) window.pauseDigitalTwin3D();
  }

  if (tabId === 'simulation') {
    if (window.resumeWhatIf3D) window.resumeWhatIf3D();
  } else {
    if (window.pauseWhatIf3D) window.pauseWhatIf3D();
  }

  if (tabId !== 'alerts' && radarAnimFrame) {
    cancelAnimationFrame(radarAnimFrame);
    radarAnimFrame = null;
  }

  if (tabId === '3dtwin') {
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      if (window.set3DCameraMode) window.set3DCameraMode('cinematic');
    }, 50);
  } else if (tabId === 'tracking') {
    setTimeout(() => {
      ensureTrajectoryMap();
      if (trajectoryMap) trajectoryMap.invalidateSize();
      runTrajectorySearch();
    }, 100);
  } else if (tabId === 'corridor') {
    setTimeout(() => {
      ensureCorridorMap();
      if (corridorMap) corridorMap.invalidateSize();
      loadCorridorData();
    }, 100);
  } else if (tabId === 'macro') {
    setTimeout(() => {
      ensureCityMap();
      if (cityMap) cityMap.invalidateSize();
      loadMacroTraffic();
    }, 100);
  } else if (tabId === 'ocr') {
    runOCRTest();
  } else if (tabId === 'streams') {
    if (window.loadStreamStatuses) window.loadStreamStatuses();
  } else if (tabId === 'alerts') {
    loadAlerts();
  } else if (tabId === 'simulation') {
    setTimeout(() => {
      if (window.initWhatIf3D) window.initWhatIf3D();
      if (!window.hasRunWhatIfInitial) {
        window.hasRunWhatIfInitial = true;
        window.runSimulation();
      }
    }, 80);
  }
};

// Window resize listener for responsive Leaflet maps & 3D WebGL
window.addEventListener('resize', () => {
  if (cityMap) cityMap.invalidateSize();
  if (trajectoryMap) trajectoryMap.invalidateSize();
  if (corridorMap) corridorMap.invalidateSize();
});

// Mobile Telemetry KPI Drawer Toggle
window.toggleMobileKPIs = function () {
  const kpiContainer = document.getElementById('kpi-ribbon-grid');
  const toggleIcon = document.getElementById('kpi-toggle-icon');
  const toggleText = document.getElementById('kpi-toggle-text');
  if (!kpiContainer) return;
  const isHidden = kpiContainer.classList.contains('hidden');
  if (isHidden) {
    kpiContainer.classList.remove('hidden');
    if (toggleIcon) toggleIcon.className = 'fa-solid fa-chevron-up text-cyan-400 text-xs transition-transform';
    if (toggleText) toggleText.innerText = 'Hide Telemetry Summary';
  } else {
    kpiContainer.classList.add('hidden');
    if (toggleIcon) toggleIcon.className = 'fa-solid fa-chevron-down text-cyan-400 text-xs transition-transform';
    if (toggleText) toggleText.innerText = 'Show Telemetry Summary';
  }
};

// INITIAL DATA LOADING
let cachedCameras = [];

async function loadInitialDashboardData() {
  try {
    const [camsRes, macroRes] = await Promise.all([
      fetch('/api/v1/cameras'),
      fetch('/api/v1/traffic/macro')
    ]);

    if (camsRes.ok) {
      cachedCameras = await camsRes.json();
      if (cityMap) {
        populateCameraPins(cachedCameras);
      }
    }

    if (macroRes.ok) {
      const macro = await macroRes.json();
      document.getElementById('kpi-ocr').innerHTML = `${macro.system_ocr_accuracy_benchmark_pct}% <span class="text-xs text-gray-400 font-normal">(>90% Spec)</span>`;
      document.getElementById('kpi-speed').innerText = `${macro.current_city_avg_speed_kmh} km/h`;
      document.getElementById('kpi-plates').innerText = macro.total_plates_scanned_today.toLocaleString();
    }
  } catch (e) {
    console.warn("Failed loading live metrics:", e);
  }
}

// LEAFLET MAPS INITIALIZATION (Watermark-free, 100% free OSM with Cyber-Dark styling)
const kolkataCenter = [22.5726, 88.3639];
const osmUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const osmAttr = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" class="text-cyan-400">OpenStreetMap</a> contributors';

function ensureCityMap() {
  if (cityMap || typeof L === 'undefined') return cityMap;
  const cityEl = document.getElementById('city-map');
  if (cityEl) {
    cityEl.classList.add('dark-map-tiles');
    cityMap = L.map('city-map', { zoomControl: true }).setView(kolkataCenter, 12);
    L.tileLayer(osmUrl, {
      maxZoom: 19,
      attribution: osmAttr
    }).addTo(cityMap);
    if (cachedCameras && cachedCameras.length > 0) {
      populateCameraPins(cachedCameras);
    }
  }
  return cityMap;
}

function ensureTrajectoryMap() {
  if (trajectoryMap || typeof L === 'undefined') return trajectoryMap;
  const trajEl = document.getElementById('trajectory-map');
  if (trajEl) {
    trajEl.classList.add('dark-map-tiles');
    trajectoryMap = L.map('trajectory-map', { zoomControl: true }).setView(kolkataCenter, 12);
    L.tileLayer(osmUrl, {
      maxZoom: 19,
      attribution: osmAttr
    }).addTo(trajectoryMap);
  }
  return trajectoryMap;
}

function ensureCorridorMap() {
  if (corridorMap || typeof L === 'undefined') return corridorMap;
  const corrEl = document.getElementById('corridor-map');
  if (corrEl) {
    corrEl.classList.add('dark-map-tiles');
    corridorMap = L.map('corridor-map', { zoomControl: true }).setView(kolkataCenter, 13);
    L.tileLayer(osmUrl, {
      maxZoom: 19,
      attribution: osmAttr
    }).addTo(corridorMap);
  }
  return corridorMap;
}

function initLeafletMaps() {
  // Lazy init: only instantiate if the active tab requires it
  if (currentTab === 'macro') ensureCityMap();
  else if (currentTab === 'tracking') ensureTrajectoryMap();
  else if (currentTab === 'corridor') ensureCorridorMap();
}

function createCustomPin(label, color = '#06b6d4') {
  return L.divIcon({
    className: 'custom-pin',
    html: `
      <div style="background:${color}; width:28px; height:28px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 15px ${color}; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:bold; font-size:11px; font-family:monospace;">
        ${label}
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

// Interactive Trajectory Playback & Scrubbing State
let activeTrajData = null;
let isPlayingTraj = false;
let playbackRatio = 0;
let playbackSpeed = 1;
let playbackTimer = null;

// Interactive Macro Layers & Simulation State
let macroLayerStates = { heat: true, cams: true, corridors: true, od: true };
let macroCameraMarkers = [];
let macroCorridorLayers = [];
let macroODVectorLayers = [];
let activeSimHour = 8.5;
let baseDensities = [];
let baseODData = null;
let activeHighlightedCorridor = null;

function populateCameraPins(cams) {
  if (!cityMap) return;
  macroCameraMarkers.forEach(m => cityMap.removeLayer(m));
  macroCameraMarkers = [];

  cams.forEach(c => {
    const marker = L.marker([c.latitude, c.longitude], {
      icon: createCustomPin(c.camera_id.split('_')[1], '#06b6d4')
    }).addTo(cityMap);

    marker.bindPopup(`
      <div class="custom-leaflet-popup p-1.5 text-xs max-w-xs">
        <div class="flex items-center justify-between border-b border-cyan-500/30 pb-1 mb-1.5">
          <span class="font-bold text-cyan-400 font-mono">${c.camera_id}</span>
          <span class="px-1.5 py-0.2 bg-emerald-950 text-emerald-400 border border-emerald-500/30 rounded text-[9px] font-bold">ONLINE</span>
        </div>
        <div class="font-bold text-white mb-0.5">${c.name}</div>
        <div class="text-gray-400 text-[10px] mb-2">Sector: <strong class="text-gray-200">${c.sector}</strong></div>
        <div class="grid grid-cols-2 gap-1.5 bg-slate-900/80 p-1.5 rounded border border-slate-800 text-[11px] mb-2">
          <div>Flow: <strong class="text-white">${c.flow_rate_vph} vph</strong></div>
          <div>Speed: <strong class="text-emerald-400">${c.avg_speed_kmh} km/h</strong></div>
        </div>
        <button onclick="window.switchTab('3dtwin'); if(window.focusCameraNode) window.focusCameraNode('${c.camera_id}');" class="w-full py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded text-[10px] font-bold transition flex items-center justify-center space-x-1 shadow">
          <i class="fa-solid fa-cube mr-1"></i><span>Inspect in 3D Digital Twin</span>
        </button>
      </div>
    `);
    macroCameraMarkers.push(marker);
  });
}

// SINGLE PLATE TRAJECTORY TRACKING ENGINE
window.queryPlate = function (plate) {
  const cleanPlate = (plate || '').trim().toUpperCase();
  const input = document.getElementById('plate-search-input');
  if (input) input.value = cleanPlate;
  activeTrackedPlate = cleanPlate;
  if (typeof currentTab !== 'undefined' && currentTab !== 'tracking') {
    window.switchTab('tracking');
  } else {
    runTrajectorySearch();
  }
};

window.runTrajectorySearch = async function () {
  const input = document.getElementById('plate-search-input');
  const plate = (input && input.value.trim().toUpperCase()) ? input.value.trim().toUpperCase() : (activeTrackedPlate || '7XYZ912');
  activeTrackedPlate = plate;
  if (input) input.value = plate;

  try {
    const res = await fetch(`/api/v1/vehicles/${encodeURIComponent(plate)}/trajectory`);
    if (!res.ok) {
      alert(`No trajectory records found for plate '${plate}'. Try '7XYZ912' or '3ABC456'.`);
      return;
    }
    const data = await res.json();
    renderTrajectory(data);
  } catch (e) {
    console.error("Failed reconstructing trajectory:", e);
  }
};

function renderTrajectory(traj) {
  activeTrajData = traj;
  pausePlayback();
  playbackRatio = 0;

  // Update banner
  document.getElementById('traj-plate-display').innerText = traj.plate_text;
  document.getElementById('traj-vehicle-desc').innerText = `${traj.vehicle_class} • ${traj.vehicle_color}`;
  document.getElementById('traj-time-window').innerText = `First Sighted: ${traj.first_seen} • Last Seen: ${traj.last_seen}`;
  document.getElementById('traj-checkpoints-count').innerText = `${traj.total_waypoints} Nodes`;
  document.getElementById('traj-distance').innerText = `${traj.total_distance_km} km`;
  document.getElementById('traj-avg-speed').innerText = `${traj.avg_speed_kmh} km/h`;
  document.getElementById('traj-peak-speed').innerText = `${traj.max_speed_kmh} km/h`;

  // Update 3D Digital Twin Trajectory Tube
  if (window.show3DTrajectory && traj.waypoints) {
    window.show3DTrajectory(traj.waypoints);
  }

  // Update 2D Leaflet Trajectory Map
  if (trajectoryMap && traj.route_coordinates) {
    if (trajPolyline) trajectoryMap.removeLayer(trajPolyline);
    trajMarkers.forEach(m => trajectoryMap.removeLayer(m));
    trajMarkers = [];
    if (animVehicleMarker) trajectoryMap.removeLayer(animVehicleMarker);

    // Draw route polyline with crisp white GIS track
    trajPolyline = L.polyline(traj.route_coordinates, {
      color: '#FFFFFF',
      weight: 4,
      opacity: 0.95,
      dashArray: '6, 6'
    }).addTo(trajectoryMap);

    // Add numbered waypoint markers (1, 2, 3...)
    traj.waypoints.forEach(wp => {
      const pinColor = wp.is_speeding ? '#ef4444' : '#10b981';
      const m = L.marker([wp.lat, wp.lng], { icon: createCustomPin(wp.step, pinColor) }).addTo(trajectoryMap);
      m.bindPopup(`
        <div class="custom-leaflet-popup p-1.5 text-xs max-w-xs">
          <div class="flex items-center justify-between border-b ${wp.is_speeding ? 'border-rose-500/40' : 'border-cyan-500/30'} pb-1 mb-1">
            <span class="font-bold ${wp.is_speeding ? 'text-rose-400' : 'text-cyan-400'} font-mono">Step ${wp.step}</span>
            <span class="text-gray-400 font-mono text-[10px]">${wp.timestamp}</span>
          </div>
          <div class="font-bold text-white mb-0.5">${wp.camera_name}</div>
          <div class="text-gray-300 text-[11px] mb-1.5">Speed: <strong class="${wp.is_speeding ? 'text-rose-400 font-bold' : 'text-emerald-400'}">${wp.speed_kmh} km/h</strong> (Heading ${wp.direction_heading})</div>
          ${wp.is_speeding ? '<div class="p-1 bg-rose-950/60 border border-rose-500/40 rounded text-rose-300 font-bold text-[10px] mb-1.5"><i class="fa-solid fa-triangle-exclamation mr-1"></i>SPEED VIOLATION DETECTED</div>' : ''}
          <button onclick="window.focusWaypointIn3D(${wp.x_3d}, ${wp.z_3d}, '${wp.camera_name}')" class="w-full py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-[10px] font-bold transition flex items-center justify-center space-x-1 shadow">
            <i class="fa-solid fa-cube mr-1"></i><span>Focus in 3D Digital Twin</span>
          </button>
        </div>
      `);
      trajMarkers.push(m);
    });

    // Create Animated Car Marker
    const carIcon = L.divIcon({
      className: 'car-icon',
      html: `<div style="background:#00f0ff; width:18px; height:18px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 18px #00f0ff; display:flex; align-items:center; justify-content:center; color:#000; font-size:9px;"><i class="fa-solid fa-car-side"></i></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
    animVehicleMarker = L.marker(traj.route_coordinates[0], { icon: carIcon }).addTo(trajectoryMap);

    trajectoryMap.fitBounds(trajPolyline.getBounds(), { padding: [40, 40] });
  }

  // Render Chronological Timeline Cards (Clickable to fly map!)
  const cardsContainer = document.getElementById('trajectory-timeline-cards');
  if (cardsContainer && traj.waypoints) {
    cardsContainer.innerHTML = traj.waypoints.map(wp => `
      <div onclick="window.focusWaypointOn2D(${wp.step})" class="p-3 bg-slate-900/90 hover:bg-cyan-950/30 rounded-lg border ${wp.is_speeding ? 'border-rose-500/50 bg-rose-950/10' : 'border-slate-800'} hover:border-cyan-500/60 space-y-1 cursor-pointer transition transform hover:-translate-x-0.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <span class="w-5 h-5 rounded-full ${wp.is_speeding ? 'bg-rose-500 text-white' : 'bg-cyan-500/20 text-cyan-400'} flex items-center justify-center font-bold text-[10px]">${wp.step}</span>
            <span class="text-white font-bold text-xs">${wp.camera_id}: ${wp.camera_name.split('-')[0]}</span>
          </div>
          <span class="font-mono text-xs ${wp.is_speeding ? 'text-rose-400 font-bold' : 'text-emerald-400'}">${wp.speed_kmh} km/h</span>
        </div>
        <div class="flex justify-between text-[11px] text-gray-400 font-mono">
          <span>Time: ${wp.timestamp}</span>
          <span>Heading: ${wp.direction_heading}</span>
        </div>
        ${wp.is_speeding ? '<div class="text-[10px] text-rose-400 font-semibold pt-0.5"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Speed Violation (Limit 60 km/h)</div>' : ''}
      </div>
    `).join('');
  }

  // Render Speed Profile Chart
  renderSpeedChart(traj.waypoints);

  // Initialize scrubber at 0
  const scrubber = document.getElementById('traj-scrubber');
  if (scrubber) scrubber.value = 0;
  onScrubTrajectory(0);
}

function renderSpeedChart(waypoints) {
  const canvas = document.getElementById('trajectory-speed-chart');
  if (!canvas) return;

  if (speedChart) speedChart.destroy();

  const labels = waypoints.map(w => `WP ${w.step}`);
  const speeds = waypoints.map(w => w.speed_kmh);
  const limits = waypoints.map(() => 60.0);

  speedChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Vehicle Speed (km/h)',
          data: speeds,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6,182,212,0.15)',
          fill: true,
          tension: 0.3,
          pointBackgroundColor: speeds.map(s => s > 60 ? '#ef4444' : '#10b981'),
          pointRadius: 5
        },
        {
          label: 'Speed Limit (60 km/h)',
          data: limits,
          borderColor: '#ef4444',
          borderDash: [5, 5],
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { display: false } },
        y: { min: 20, max: 90, ticks: { color: '#94a3b8', font: { size: 9 } }, grid: { color: '#1e293b' } }
      }
    }
  });
}

// =========================================================================
// INTERACTIVE PLAYBACK & SCRUBBING CONTROLLER
// =========================================================================
window.onScrubTrajectory = function (val) {
  if (!activeTrajData || !activeTrajData.route_coordinates) return;
  playbackRatio = Math.max(0, Math.min(100, val)) / 100;

  const scrubValEl = document.getElementById('traj-scrub-val');
  if (scrubValEl) scrubValEl.innerText = `${Math.round(playbackRatio * 100)}%`;

  const coords = activeTrajData.route_coordinates;
  const idx = Math.min(coords.length - 1, Math.floor(playbackRatio * (coords.length - 1)));
  const currentCoord = coords[idx];

  if (animVehicleMarker && trajectoryMap) {
    animVehicleMarker.setLatLng(currentCoord);
  }

  // Find nearest waypoint
  const waypoints = activeTrajData.waypoints;
  if (waypoints && waypoints.length) {
    const wpIdx = Math.min(waypoints.length - 1, Math.floor(playbackRatio * waypoints.length));
    const activeWp = waypoints[wpIdx];

    const camEl = document.getElementById('hud-wp-camera');
    const spdEl = document.getElementById('hud-wp-speed');
    const timeEl = document.getElementById('hud-wp-time');
    const violEl = document.getElementById('hud-wp-violation');

    if (camEl) camEl.innerText = `Step ${activeWp.step}: ${activeWp.camera_name}`;
    if (spdEl) {
      spdEl.innerText = `${activeWp.speed_kmh} km/h`;
      spdEl.className = activeWp.is_speeding ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold';
    }
    if (timeEl) timeEl.innerText = activeWp.timestamp;
    if (violEl) {
      if (activeWp.is_speeding) violEl.classList.remove('hidden');
      else violEl.classList.add('hidden');
    }
  }
};

window.togglePlayPause = function () {
  if (isPlayingTraj) {
    pausePlayback();
  } else {
    startPlayback();
  }
};

window.playTrajectoryAnimation = function () {
  playbackRatio = 0;
  startPlayback();
};

function startPlayback() {
  isPlayingTraj = true;
  updatePlayButtonUI(true);

  if (playbackTimer) clearInterval(playbackTimer);
  playbackTimer = setInterval(() => {
    playbackRatio += 0.015 * playbackSpeed;
    if (playbackRatio >= 1.0) {
      playbackRatio = 1.0;
      onScrubTrajectory(100);
      const scrubber = document.getElementById('traj-scrubber');
      if (scrubber) scrubber.value = 100;
      pausePlayback();
      return;
    }
    const pct = Math.round(playbackRatio * 100);
    const scrubber = document.getElementById('traj-scrubber');
    if (scrubber) scrubber.value = pct;
    onScrubTrajectory(pct);
  }, 100);
}

function pausePlayback() {
  isPlayingTraj = false;
  if (playbackTimer) clearInterval(playbackTimer);
  playbackTimer = null;
  updatePlayButtonUI(false);
}

function updatePlayButtonUI(playing) {
  const icon = document.getElementById('playback-btn-icon');
  const mainIcon = document.getElementById('traj-play-icon');
  const mainText = document.getElementById('traj-play-text');
  const btn = document.getElementById('traj-playback-toggle-btn');

  if (playing) {
    if (icon) icon.className = 'fa-solid fa-pause text-xs';
    if (mainIcon) mainIcon.className = 'fa-solid fa-pause';
    if (mainText) mainText.innerText = 'Pause Replay';
    if (btn) { btn.classList.remove('bg-emerald-600'); btn.classList.add('bg-amber-600'); }
  } else {
    if (icon) icon.className = 'fa-solid fa-play text-xs';
    if (mainIcon) mainIcon.className = 'fa-solid fa-play';
    if (mainText) mainText.innerText = 'Play Journey';
    if (btn) { btn.classList.remove('bg-amber-600'); btn.classList.add('bg-emerald-600'); }
  }
}

window.setPlaySpeed = function (spd) {
  playbackSpeed = spd;
  [1, 2, 4].forEach(s => {
    const b = document.getElementById(`spd-btn-${s}`);
    if (b) {
      if (s === spd) {
        b.className = 'px-2 py-0.5 bg-cyan-600 text-white rounded text-[11px] border border-cyan-400';
      } else {
        b.className = 'px-2 py-0.5 bg-slate-900 text-cyan-300 rounded text-[11px] border border-slate-700';
      }
    }
  });
  if (isPlayingTraj) {
    startPlayback();
  }
};

window.stepTrajForward = function () {
  if (!activeTrajData || !activeTrajData.waypoints) return;
  const count = activeTrajData.waypoints.length;
  const currentStep = Math.floor(playbackRatio * count);
  const nextStep = Math.min(count - 1, currentStep + 1);
  const pct = Math.round((nextStep / (count - 1)) * 100);
  const scrubber = document.getElementById('traj-scrubber');
  if (scrubber) scrubber.value = pct;
  onScrubTrajectory(pct);
};

window.stepTrajBackward = function () {
  if (!activeTrajData || !activeTrajData.waypoints) return;
  const count = activeTrajData.waypoints.length;
  const currentStep = Math.floor(playbackRatio * count);
  const prevStep = Math.max(0, currentStep - 1);
  const pct = Math.round((prevStep / (count - 1)) * 100);
  const scrubber = document.getElementById('traj-scrubber');
  if (scrubber) scrubber.value = pct;
  onScrubTrajectory(pct);
};

window.focusWaypointOn2D = function (step) {
  if (!activeTrajData || !activeTrajData.waypoints || !trajectoryMap) return;
  const wp = activeTrajData.waypoints.find(w => w.step === step);
  if (wp) {
    trajectoryMap.flyTo([wp.lat, wp.lng], 15, { animate: true, duration: 0.8 });
    const m = trajMarkers.find((_, i) => activeTrajData.waypoints[i].step === step);
    if (m) m.openPopup();
  }
};

window.focusWaypointIn3D = function (x_3d, z_3d, name) {
  window.switchTab('3dtwin');
  setTimeout(() => {
    if (window.focusCameraOnCoords) {
      window.focusCameraOnCoords(x_3d, 0, z_3d);
    }
  }, 100);
};

// =========================================================================
// INTERACTIVE MACRO TRAFFIC FLOW, LAYERS & HOURLY SIMULATOR
// =========================================================================
window.toggleMacroLayer = function (layer) {
  if (macroLayerStates[layer] !== undefined) {
    macroLayerStates[layer] = !macroLayerStates[layer];
    const isOn = macroLayerStates[layer];

    const btn = document.getElementById(`btn-toggle-${layer}`);
    if (btn) {
      if (isOn) {
        btn.className = 'px-2.5 py-1 bg-cyan-600 text-white rounded font-semibold text-[11px] border border-cyan-400 transition';
        btn.innerHTML = `<i class="fa-solid fa-${getLayerIcon(layer)} mr-1"></i>${getLayerTitle(layer)}: ON`;
      } else {
        btn.className = 'px-2.5 py-1 bg-slate-900 text-slate-400 rounded font-semibold text-[11px] border border-slate-800 transition opacity-60';
        btn.innerHTML = `<i class="fa-solid fa-${getLayerIcon(layer)} mr-1"></i>${getLayerTitle(layer)}: OFF`;
      }
    }

    if (layer === 'cams') {
      macroCameraMarkers.forEach(m => {
        if (isOn) m.addTo(cityMap);
        else cityMap.removeLayer(m);
      });
    } else if (layer === 'corridors') {
      macroCorridorLayers.forEach(l => {
        if (isOn) l.addTo(cityMap);
        else cityMap.removeLayer(l);
      });
    } else if (layer === 'od') {
      macroODVectorLayers.forEach(l => {
        if (isOn) l.addTo(cityMap);
        else cityMap.removeLayer(l);
      });
    } else if (layer === 'heat') {
      window.toggleHeatmapLayer();
    }
  }
};

function getLayerIcon(layer) {
  const map = { heat: 'fire', cams: 'video', corridors: 'road', od: 'arrows-split-up-and-left' };
  return map[layer] || 'layer-group';
}

function getLayerTitle(layer) {
  const map = { heat: 'Heatmap', cams: 'Cameras', corridors: 'Corridors', od: 'OD Vectors' };
  return map[layer] || layer;
}

window.onMacroHourSlide = function (val) {
  activeSimHour = parseFloat(val);
  const hour = Math.floor(activeSimHour);
  const min = (activeSimHour % 1) === 0 ? '00' : '30';
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);

  let desc = 'Normal Urban Transit';
  if (activeSimHour >= 8 && activeSimHour <= 10) desc = 'Morning Rush Peak (High Density)';
  else if (activeSimHour >= 12 && activeSimHour <= 14) desc = 'Midday Lull (Free Flow)';
  else if (activeSimHour >= 17.5 && activeSimHour <= 20) desc = 'Evening Commuter Congestion';
  else if (activeSimHour >= 21) desc = 'Late Night Transit (Optimal Flow)';

  const readout = document.getElementById('macro-time-readout');
  if (readout) {
    readout.innerText = `${h12}:${min} ${ampm} (${desc})`;
  }

  // Update dynamic speed & flow simulation based on active hour
  updateSimulatedMacroDynamics(activeSimHour);
};

window.setSimHour = function (val) {
  const slider = document.getElementById('macro-hour-slider');
  if (slider) slider.value = val;
  window.onMacroHourSlide(val);
};

function updateSimulatedMacroDynamics(hour) {
  if (!baseDensities.length) return;

  // Congestion curve: Peaks around 8.5 and 18.5
  const mPeak = Math.exp(-Math.pow(hour - 8.5, 2) / 2.5);
  const ePeak = Math.exp(-Math.pow(hour - 18.5, 2) / 3.0);
  const congestionFactor = Math.min(1.0, 0.25 + mPeak * 0.7 + ePeak * 0.65);

  const losList = document.getElementById('macro-los-list');
  if (losList) {
    losList.innerHTML = baseDensities.map(d => {
      const isCongestedCam = d.camera_id === 'CAM_03' || d.camera_id === 'CAM_05';
      const effCongestion = isCongestedCam ? Math.min(0.96, congestionFactor * 1.25) : congestionFactor * 0.75;
      const speed = Math.round(70 - effCongestion * 48);
      const flow = Math.round(d.flow_rate_vph * (0.6 + effCongestion * 0.7));
      const los = speed < 28 ? 'LOS E (Bottleneck)' : (speed < 42 ? 'LOS C (Moderate)' : 'LOS A (Free Flow)');

      return `
        <div class="p-2.5 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
          <div>
            <div class="text-white font-bold">${d.camera_id}: ${d.camera_name.split('-')[0]}</div>
            <div class="text-[10px] text-gray-400 font-mono">${flow} vph • ${Math.round(effCongestion * 85)}% occ</div>
          </div>
          <div class="text-right">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${speed < 30 ? 'bg-rose-950 text-rose-400 border border-rose-500/30' : (speed < 45 ? 'bg-amber-950 text-amber-400 border border-amber-500/30' : 'bg-emerald-950 text-emerald-400 border border-emerald-500/30')}">${los.split(' ')[0]}</span>
            <div class="text-[10px] text-gray-300 font-mono mt-0.5">${speed} km/h</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Update corridor line colors on map
  drawCongestionCorridors(congestionFactor);
}

function drawCongestionCorridors(factor) {
  if (!cityMap) return;
  macroCorridorLayers.forEach(l => cityMap.removeLayer(l));
  macroCorridorLayers = [];

  if (!macroLayerStates.corridors) return;

  const corridors = [
    { name: 'Maa Flyover High-Speed Viaduct', coords: [[22.5438, 88.3683], [22.5396, 88.3965]], dense: false },
    { name: 'EM Bypass North-South Expressway', coords: [[22.5100, 88.3910], [22.5800, 88.4100]], dense: factor > 0.6 },
    { name: 'Park Street Commercial Arterial', coords: [[22.5535, 88.3512], [22.5480, 88.3680]], dense: factor > 0.45 },
    { name: 'Strand Road - Riverfront Viaduct', coords: [[22.5600, 88.3400], [22.5851, 88.3468]], dense: false },
    { name: 'Sector V to New Town Expressway', coords: [[22.5735, 88.4331], [22.5905, 88.4744]], dense: factor > 0.55 }
  ];

  corridors.forEach(c => {
    const color = c.dense ? '#ef4444' : (factor > 0.6 ? '#f59e0b' : '#10b981');
    const poly = L.polyline(c.coords, {
      color: color,
      weight: 6,
      opacity: 0.8
    }).addTo(cityMap);

    poly.bindPopup(`
      <div class="custom-leaflet-popup p-1 text-xs">
        <div class="font-bold text-white mb-0.5">${c.name}</div>
        <div class="text-[11px] ${c.dense ? 'text-rose-400 font-bold' : 'text-emerald-400'}">Flow State: ${c.dense ? 'LOS E Bottleneck' : 'LOS B Optimal'}</div>
      </div>
    `);
    macroCorridorLayers.push(poly);
  });
}

window.highlightODCorridor = function (originName, destName) {
  if (!cityMap) return;

  if (activeHighlightedCorridor) {
    cityMap.removeLayer(activeHighlightedCorridor);
    activeHighlightedCorridor = null;
  }

  // Find origin and dest coordinates
  const originNode = baseDensities.find(d => d.camera_name.includes(originName.split(' ')[0]));
  const destNode = baseDensities.find(d => d.camera_name.includes(destName.split(' ')[0]));

  if (originNode && destNode) {
    const pts = [[originNode.latitude, originNode.longitude], [destNode.latitude, destNode.longitude]];
    activeHighlightedCorridor = L.polyline(pts, {
      color: '#FFFFFF',
      weight: 6,
      opacity: 0.95,
      dashArray: '8, 8'
    }).addTo(cityMap);

    cityMap.fitBounds(activeHighlightedCorridor.getBounds(), { padding: [60, 60] });

    // Toast
    let toast = document.getElementById('od-corridor-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'od-corridor-toast';
      toast.className = 'fixed top-20 right-8 z-50 p-3 bg-black/90 border border-white/20 rounded-xl text-xs shadow-2xl text-white font-mono flex items-center space-x-2 animate-fade-in backdrop-blur-xl';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<i class="fa-solid fa-arrows-split-up-and-left text-zinc-300"></i><span>Active Corridor: ${originName} • ${destName}</span>`;
    setTimeout(() => { toast.remove(); }, 3500);
  }
};

// MACRO TRAFFIC FLOW & OD MATRIX
async function loadMacroTraffic() {
  try {
    const [densRes, odRes] = await Promise.all([
      fetch('/api/v1/traffic/density'),
      fetch('/api/v1/traffic/od-matrix')
    ]);

    if (densRes.ok) {
      baseDensities = await densRes.json();
      updateSimulatedMacroDynamics(activeSimHour);
      populateCameraPins(baseDensities);
    }

    if (odRes.ok) {
      baseODData = await odRes.json();
      const tbody = document.getElementById('od-table-body');
      if (tbody && baseODData.top_origin_destination_pairs) {
        tbody.innerHTML = baseODData.top_origin_destination_pairs.map(p => `
          <tr onclick="window.highlightODCorridor('${p.origin_name}', '${p.destination_name}')" class="hover:bg-cyan-950/40 cursor-pointer transition border-b border-slate-800/60" title="Click to highlight corridor on 2D map">
            <td class="p-3 font-bold text-white flex items-center space-x-1.5">
              <i class="fa-solid fa-location-dot text-cyan-400 text-[10px]"></i>
              <span>${p.origin_name}</span>
            </td>
            <td class="p-3 text-cyan-300 font-medium">${p.destination_name}</td>
            <td class="p-3 font-mono font-bold text-white">${p.trips_per_hour}</td>
            <td class="p-3 font-mono text-gray-300">${p.avg_transit_minutes} min</td>
            <td class="p-3 text-gray-400">${p.dominant_vehicle_type}</td>
            <td class="p-3 font-mono font-bold ${p.congestion_index > 70 ? 'text-rose-400' : 'text-emerald-400'}">${p.congestion_index}%</td>
          </tr>
        `).join('');
      }
    }
  } catch (e) {
    console.warn("Failed loading macro traffic:", e);
  }
}

window.toggleHeatmapLayer = function () {
  heatmapLayerActive = !heatmapLayerActive;
  const btn = document.getElementById('btn-toggle-heat');
  if (btn) {
    if (heatmapLayerActive) {
      btn.className = 'px-2.5 py-1 bg-cyan-600 text-white rounded font-semibold text-[11px] border border-cyan-400 transition';
      btn.innerHTML = '<i class="fa-solid fa-fire mr-1"></i>Heatmap: ON';
    } else {
      btn.className = 'px-2.5 py-1 bg-slate-900 text-slate-400 rounded font-semibold text-[11px] border border-slate-800 transition opacity-60';
      btn.innerHTML = '<i class="fa-solid fa-fire mr-1"></i>Heatmap: OFF';
    }
  }
};

// HOTLIST ALERTS & SECURITY
async function loadAlerts() {
  try {
    const [regRes, routesRes] = await Promise.all([
      fetch('/api/v1/anomalies/registry'),
      fetch('/api/v1/anomalies/routes')
    ]);

    if (regRes.ok) {
      const registry = await regRes.json();
      const tbody = document.getElementById('blacklist-table-body');
      if (tbody) {
        tbody.innerHTML = registry.map(item => `
          <tr class="hover:bg-white/5 transition">
            <td class="p-3 font-mono font-bold text-white tracking-wider">${item.plate_text}</td>
            <td class="p-3 text-white font-medium">${item.vehicle_desc}</td>
            <td class="p-3 text-zinc-300">${item.reason}</td>
            <td class="p-3"><span class="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-white/10 text-white border border-white/20">${item.severity}</span></td>
            <td class="p-3 font-mono text-zinc-400">${item.warrant_id}</td>
            <td class="p-3 text-zinc-300">${item.registered_owner}</td>
          </tr>
        `).join('');
      }
    }

    if (routesRes.ok) {
      const routes = await routesRes.json();
      const listEl = document.getElementById('route-anomalies-list');
      if (listEl) {
        listEl.innerHTML = routes.map(r => `
          <div class="p-3.5 bg-slate-950 rounded-xl border border-rose-500/30 space-y-1.5">
            <div class="flex justify-between items-center">
              <span class="font-mono font-bold text-rose-400">${r.anomaly_type}</span>
              <span class="px-2 py-0.5 bg-rose-950 text-rose-300 font-bold rounded text-[10px]">${Math.round(r.confidence * 100)}% Conf</span>
            </div>
            <div class="text-white font-bold">${r.plate_text}</div>
            <p class="text-[11px] text-gray-300 leading-relaxed">${r.description}</p>
          </div>
        `).join('');
      }
    }

    // Load Behavioral Radar threats & stats
    await loadBehavioralThreats();
    if (!window.radarCanvasInitialized) {
      initBehavioralRadar();
    }
  } catch (e) {
    console.warn("Failed loading alerts:", e);
  }
}

// =========================================================================
// REAL-TIME VEHICLE ANOMALY & PATTERN-OF-LIFE RADAR ENGINE
// =========================================================================
let activeRadarThreats = [];
let currentRadarFilter = 'ALL';
let radarSweepAngle = 0;
let radarAnimFrame = null;
window.radarCanvasInitialized = false;

async function loadBehavioralThreats() {
  try {
    const [threatsRes, statsRes] = await Promise.all([
      fetch('/api/v1/anomalies/radar/threats'),
      fetch('/api/v1/anomalies/radar/stats')
    ]);

    if (statsRes.ok) {
      const stats = await statsRes.json();
      const tEl = document.getElementById('radar-stat-threats');
      if (tEl) tEl.innerText = `${stats.total_active_threats} Active`;
      const cEl = document.getElementById('radar-stat-clones');
      if (cEl) cEl.innerText = stats.plate_clones_count;
      const cnvEl = document.getElementById('radar-stat-convoys');
      if (cnvEl) cnvEl.innerText = stats.convoys_tracked_count;
      const lEl = document.getElementById('radar-stat-loiter');
      if (lEl) lEl.innerText = stats.loitering_surveillance_count;
      const zEl = document.getElementById('radar-stat-zscore');
      if (zEl) zEl.innerText = `+${stats.mean_anomaly_score}σ Outlier`;
    }

    if (threatsRes.ok) {
      activeRadarThreats = await threatsRes.json();
      renderRadarThreatCards();
    }
  } catch (e) {
    console.error("Error loading behavioral radar threats:", e);
  }
}

window.filterRadarThreats = function (filterType) {
  currentRadarFilter = filterType;
  const filterButtons = [
    { id: 'filter-radar-all', type: 'ALL' },
    { id: 'filter-radar-clone', type: 'PLATE_CLONING' },
    { id: 'filter-radar-convoy', type: 'TACTICAL_CONVOY' },
    { id: 'filter-radar-loiter', type: 'SURVEILLANCE_LOITERING' }
  ];

  filterButtons.forEach(btnInfo => {
    const btn = document.getElementById(btnInfo.id);
    if (btn) {
      if (btnInfo.type === filterType) {
        btn.className = 'px-3 py-1 rounded-full bg-white text-black font-semibold transition text-xs shadow-sm';
      } else {
        btn.className = 'px-3 py-1 rounded-full text-zinc-400 hover:text-white transition text-xs';
      }
    }
  });

  renderRadarThreatCards();
};

function renderRadarThreatCards() {
  const container = document.getElementById('radar-threat-cards-list');
  const countEl = document.getElementById('radar-stream-count');
  if (!container) return;

  const filtered = activeRadarThreats.filter(t => {
    if (currentRadarFilter === 'ALL') return true;
    return t.threat_type === currentRadarFilter;
  });

  if (countEl) countEl.innerText = `${filtered.length} Active Outliers`;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="p-5 bg-white/[0.02] rounded-xl border border-white/10 text-center text-xs text-zinc-400 font-mono">No active threats matching selected filter.</div>';
    return;
  }

  container.innerHTML = filtered.map(t => {
    let typeBadge = 'bg-white/10 text-white border-white/20';
    let typeIcon = 'fa-clone';
    let typeName = 'Plate Cloning Fraud';

    if (t.threat_type === 'TACTICAL_CONVOY') {
      typeBadge = 'bg-white/10 text-white border-white/20';
      typeIcon = 'fa-truck-moving';
      typeName = 'Tactical Convoy Formation';
    } else if (t.threat_type === 'SURVEILLANCE_LOITERING') {
      typeBadge = 'bg-white/10 text-white border-white/20';
      typeIcon = 'fa-arrows-spin';
      typeName = 'Surveillance Loitering Vector';
    }

    return `
      <div id="threat-card-${t.threat_id}" class="p-4 bg-white/[0.03] backdrop-blur-md rounded-xl border border-white/10 hover:border-white/25 transition space-y-2.5 shadow-xl">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center space-x-2">
            <span class="px-2.5 py-0.5 rounded-full border text-[10px] font-semibold font-mono ${typeBadge} flex items-center space-x-1.5">
              <i class="fa-solid ${typeIcon} text-[9px]"></i><span>${typeName}</span>
            </span>
            <span class="px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-[10px] font-mono font-bold text-white">${t.severity}</span>
          </div>
          <div class="flex items-center space-x-2 font-mono text-xs">
            <span class="px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-white font-bold">
              Z-Score: +${t.evidence.anomaly_z_score}σ
            </span>
            <span class="text-[11px] text-zinc-400">${t.detection_timestamp}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <div class="flex items-center space-x-2">
            <span class="font-mono text-base font-bold text-white bg-black/80 px-2.5 py-0.5 rounded border border-white/20 tracking-wider">${t.primary_plate}</span>
            ${t.secondary_plate ? `<span class="text-xs text-zinc-400">• Coupled:</span><span class="font-mono text-xs font-bold text-white bg-white/10 px-2 py-0.5 rounded border border-white/20">${t.secondary_plate}</span>` : ''}
          </div>
          <span class="text-xs text-zinc-300 font-medium">${t.primary_vehicle_desc}</span>
        </div>

        <!-- Mathematical Evidence Box -->
        <div class="p-2.5 bg-black/60 rounded-lg border border-white/10 text-[11px] font-mono space-y-1">
          <div class="flex justify-between text-white font-semibold">
            <span>Evidence: ${t.evidence.metric_name}</span>
            <span class="text-zinc-300">${Math.round(t.evidence.model_confidence * 100)}% Confidence</span>
          </div>
          <div class="text-zinc-200">${t.evidence.physical_discrepancy}</div>
          <div class="text-zinc-400 pt-0.5 flex flex-wrap gap-x-4">
            <span>Observed: <strong class="text-white">${t.evidence.observed_value}</strong></span>
            <span>Limit: <strong class="text-zinc-400">${t.evidence.baseline_threshold}</strong></span>
          </div>
        </div>

        <!-- Camera Trajectory Nodes -->
        <div class="flex flex-wrap items-center justify-between text-[11px] pt-1 text-zinc-400 font-mono">
          <div class="flex items-center space-x-1.5">
            <i class="fa-solid fa-camera text-white/80"></i>
            <span>Nodes: ${t.camera_names.join(' &rarr; ')}</span>
          </div>
          <span class="text-zinc-400">Sector: ${t.sector}</span>
        </div>

        <!-- Recommended Action & Intercept Button -->
        <div class="flex items-center justify-between pt-2 border-t border-white/10">
          <p class="text-[11px] text-zinc-300 font-medium italic truncate max-w-[70%]">
            <i class="fa-solid fa-shield-halved mr-1 text-white/80"></i>${t.suggested_action}
          </p>
          <button onclick="window.dispatchRadarIntercept('${t.threat_id}')" class="px-3 py-1.5 bg-white text-black hover:bg-zinc-200 rounded-lg text-[11px] font-semibold font-mono transition flex items-center space-x-1.5 shadow-sm">
            <i class="fa-solid fa-crosshairs"></i>
            <span>Dispatch Intercept</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.simulateRadarThreat = async function (threatType) {
  try {
    const res = await fetch('/api/v1/anomalies/radar/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threat_type: threatType })
    });

    if (res.ok) {
      await loadBehavioralThreats();
    }
  } catch (e) {
    console.error("Failed to inject simulated radar threat:", e);
  }
};

window.dispatchRadarIntercept = function (threatId) {
  const threat = activeRadarThreats.find(t => t.threat_id === threatId);
  if (threat) {
    alert(`[TACTICAL INTERCEPT DISPATCHED]\nTarget Plate: ${threat.primary_plate}\nType: ${threat.threat_type}\nSector: ${threat.sector}\nAction: ${threat.suggested_action}`);
  }
};

// =========================================================================
// 2D CANVAS TACTICAL RADAR SWEEP ANIMATION
// =========================================================================
function initBehavioralRadar() {
  const canvas = document.getElementById('pol-radar-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = centerX - 14;

  window.radarCanvasInitialized = true;

  function renderRadar() {
    ctx.clearRect(0, 0, width, height);

    // 1. Dark smoked glass radar background
    const bgGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
    bgGrad.addColorStop(0, '#0a0a0a');
    bgGrad.addColorStop(0.7, '#050505');
    bgGrad.addColorStop(1, '#000000');
    ctx.fillStyle = bgGrad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
    ctx.fill();

    // 2. Range concentric rings (2km, 4km, 6km, 8km, 10km)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    ctx.font = '9px IBM Plex Mono, monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';

    for (let r = 1; r <= 5; r++) {
      const curR = (maxRadius / 5) * r;
      ctx.beginPath();
      ctx.arc(centerX, centerY, curR, 0, Math.PI * 2);
      ctx.stroke();

      // Range text
      ctx.fillText(`${r * 2}km`, centerX + 4, centerY - curR + 10);
    }

    // 3. Crosshairs and Diagonal Azimuth Lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(centerX - maxRadius, centerY);
    ctx.lineTo(centerX + maxRadius, centerY);
    ctx.moveTo(centerX, centerY - maxRadius);
    ctx.lineTo(centerX, centerY + maxRadius);
    // 45 degree diagonals
    const dOffset = maxRadius * 0.7071;
    ctx.moveTo(centerX - dOffset, centerY - dOffset);
    ctx.lineTo(centerX + dOffset, centerY + dOffset);
    ctx.moveTo(centerX + dOffset, centerY - dOffset);
    ctx.lineTo(centerX - dOffset, centerY + dOffset);
    ctx.stroke();

    // Azimuth Labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = 'bold 9px IBM Plex Mono, monospace';
    ctx.fillText('N 000°', centerX - 14, centerY - maxRadius + 10);
    ctx.fillText('E 090°', centerX + maxRadius - 38, centerY + 3);
    ctx.fillText('S 180°', centerX - 14, centerY + maxRadius - 4);
    ctx.fillText('W 270°', centerX - maxRadius + 4, centerY + 3);

    // 4. Fixed Camera Network Nodes (Silver Nodes)
    const fixedCams = [
      { id: 'CAM_01', angle: 300, dist: 3.5 },
      { id: 'CAM_02', angle: 30, dist: 4.8 },
      { id: 'CAM_03', angle: 100, dist: 3.2 },
      { id: 'CAM_04', angle: 220, dist: 5.4 },
      { id: 'CAM_05', angle: 120, dist: 6.8 },
      { id: 'CAM_06', angle: 155, dist: 9.2 }
    ];

    fixedCams.forEach(cam => {
      const rad = (cam.angle * Math.PI) / 180;
      const rDist = (cam.dist / 10) * maxRadius;
      const cx = centerX + Math.cos(rad) * rDist;
      const cy = centerY + Math.sin(rad) * rDist;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(200, 200, 200, 0.6)';
      ctx.font = '8px IBM Plex Mono, monospace';
      ctx.fillText(cam.id, cx + 5, cy - 3);
    });

    // 5. Active Behavioral Threat Blips
    activeRadarThreats.forEach(t => {
      if (currentRadarFilter !== 'ALL' && t.threat_type !== currentRadarFilter) return;

      const rad = (t.radar_angle_deg * Math.PI) / 180;
      const rDist = Math.min(maxRadius - 8, (t.radar_distance_km / 10) * maxRadius);
      const bx = centerX + Math.cos(rad) * rDist;
      const by = centerY + Math.sin(rad) * rDist;

      // Restrained minimal semantic differentiation
      let blipColor = '#ffffff'; // White core
      let pulseColor = 'rgba(244, 63, 94, 0.8)'; // Red accent (Cloning)
      if (t.threat_type === 'TACTICAL_CONVOY') pulseColor = 'rgba(245, 158, 11, 0.8)'; // Amber
      if (t.threat_type === 'SURVEILLANCE_LOITERING') pulseColor = 'rgba(192, 132, 252, 0.8)'; // Subtle violet/white

      // Pulsing outer beacon ring
      const pulseSize = 4 + Math.sin(Date.now() * 0.006) * 3;
      ctx.strokeStyle = pulseColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, pulseSize, 0, Math.PI * 2);
      ctx.stroke();

      // Solid core blip
      ctx.fillStyle = blipColor;
      ctx.beginPath();
      ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Plate tag label
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px IBM Plex Mono, monospace';
      ctx.fillText(t.primary_plate, bx + 7, by - 4);

      // If Plate Cloning, draw coupled duplicate blip & dashed link
      if (t.threat_type === 'PLATE_CLONING') {
        const rad2 = ((t.radar_angle_deg + 140) * Math.PI) / 180;
        const rDist2 = Math.min(maxRadius - 10, rDist * 1.15);
        const bx2 = centerX + Math.cos(rad2) * rDist2;
        const by2 = centerY + Math.sin(rad2) * rDist2;

        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx2, by2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Duplicate blip
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(bx2, by2, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(`${t.primary_plate} [CLONE]`, bx2 + 6, by2 + 8);
      }

      // If Tactical Convoy, draw paired trailing vehicle blip
      if (t.threat_type === 'TACTICAL_CONVOY') {
        const bxLead = bx + 7;
        const byLead = by + 6;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(bxLead, byLead, 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bxLead, byLead);
        ctx.stroke();
      }

      // If Surveillance Loitering, draw dashed orbital surveillance loop
      if (t.threat_type === 'SURVEILLANCE_LOITERING') {
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.arc(bx, by, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    // 6. Sweeping Beam Arc (Monochrome white sweep)
    radarSweepAngle += 0.022;
    if (radarSweepAngle >= Math.PI * 2) radarSweepAngle = 0;

    const sweepGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxRadius);
    sweepGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    sweepGrad.addColorStop(1, 'rgba(255, 255, 255, 0.22)');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, maxRadius, radarSweepAngle - 0.45, radarSweepAngle);
    ctx.closePath();
    ctx.fillStyle = sweepGrad;
    ctx.fill();

    // Leading sweep line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + Math.cos(radarSweepAngle) * maxRadius, centerY + Math.sin(radarSweepAngle) * maxRadius);
    ctx.stroke();
    ctx.restore();

    // Outer border ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
    ctx.stroke();

    if (currentTab === 'alerts') {
      radarAnimFrame = requestAnimationFrame(renderRadar);
    } else {
      radarAnimFrame = null;
    }
  }

  renderRadar();
}

// WHAT-IF SIMULATION & 3D DIGITAL TWIN INTEGRATION
window.runSimulation = async function () {
  const closureSelect = document.getElementById('sim-closure-select');
  const volumeSlider = document.getElementById('sim-volume-slider');
  const closure = closureSelect ? closureSelect.value : 'ROAD-A-B';
  const vol = volumeSlider ? (parseFloat(volumeSlider.value) || 20.0) : 20.0;

  const payload = {
    closed_roads: closure !== 'none' ? [closure] : [],
    traffic_volume_change_pct: vol,
    signal_timing_adjustments: { "Junction_Trinity": 35.0 }
  };

  try {
    const res = await fetch('/api/v1/simulation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return;
    const sim = await res.json();
    window.lastSimulationResult = sim;

    const congAfter = sim.overall_congestion_after !== undefined ? sim.overall_congestion_after : (sim.metrics && sim.metrics[0] ? parseFloat(sim.metrics[0].after) : 76.5);
    const speedAfter = sim.avg_speed_after_kmh !== undefined ? sim.avg_speed_after_kmh : (sim.metrics && sim.metrics[1] ? parseFloat(sim.metrics[1].after) : 20.8);
    const delayAfter = sim.avg_delay_after_min !== undefined ? sim.avg_delay_after_min : (sim.metrics && sim.metrics[2] ? parseFloat(sim.metrics[2].after) : 10.3);

    const congEl = document.getElementById('sim-res-congestion');
    if (congEl) congEl.innerText = `${congAfter}%`;

    const congDeltaEl = document.getElementById('sim-res-congestion-delta');
    if (congDeltaEl && sim.metrics && sim.metrics[0]) {
      congDeltaEl.innerText = `${sim.metrics[0].change_pct > 0 ? '+' : ''}${sim.metrics[0].change_pct}% change`;
    }

    const speedEl = document.getElementById('sim-res-speed');
    if (speedEl) speedEl.innerText = `${speedAfter} km/h`;

    const speedDeltaEl = document.getElementById('sim-res-speed-delta');
    if (speedDeltaEl && sim.metrics && sim.metrics[1]) {
      speedDeltaEl.innerText = `${sim.metrics[1].change_pct > 0 ? '+' : ''}${sim.metrics[1].change_pct}% speed`;
    }

    const delayEl = document.getElementById('sim-res-delay');
    if (delayEl) delayEl.innerText = `${delayAfter} min`;

    const delayDeltaEl = document.getElementById('sim-res-delay-delta');
    if (delayDeltaEl && sim.metrics && sim.metrics[2]) {
      delayDeltaEl.innerText = `${sim.metrics[2].change_pct > 0 ? '+' : ''}${sim.metrics[2].change_pct}% delay`;
    }

    // 1. Pass updated scenario data to 3D simulation visualizer
    if (window.updateWhatIf3DSimulation) {
      window.updateWhatIf3DSimulation(sim, closure, vol);
    }

    // 2. Render road-by-road impact matrix cards
    renderWhatIfRoadRack(sim.road_impacts || []);

  } catch (e) {
    console.error("Simulation error:", e);
  }
};

function renderWhatIfRoadRack(impacts) {
  const rack = document.getElementById('whatif-road-breakdown-rack');
  if (!rack) return;
  if (!impacts || impacts.length === 0) {
    rack.innerHTML = '<div class="text-xs text-zinc-500 col-span-full py-2 font-mono">Executing simulation calculations...</div>';
    return;
  }

  rack.innerHTML = impacts.map(r => {
    let badgeClass = 'bg-white/10 text-zinc-300 border-white/20';
    let statusText = 'NORMAL';
    let icon = 'fa-check';

    if (r.is_closed || r.status === 'CLOSED') {
      badgeClass = 'bg-white/20 text-white border-white/40 animate-pulse';
      statusText = 'CLOSED';
      icon = 'fa-ban';
    } else if (r.is_detour || r.status === 'DETOUR_CONGESTED') {
      badgeClass = 'bg-white/15 text-white border-white/30';
      statusText = 'DETOUR SPIKE';
      icon = 'fa-triangle-exclamation';
    } else if (r.simulated_congestion_pct > 65) {
      badgeClass = 'bg-white/15 text-white border-white/30';
      statusText = 'HEAVY';
      icon = 'fa-fire-flame-curved';
    } else if (r.simulated_congestion_pct < 35) {
      badgeClass = 'bg-white/10 text-zinc-300 border-white/20';
      statusText = 'FREE FLOW';
      icon = 'fa-bolt';
    }

    return `
      <div class="p-3 bg-white/[0.03] rounded-xl border border-white/10 space-y-1.5 transition hover:border-white/25 hover:bg-white/[0.06] shadow-lg">
        <div class="flex items-center justify-between text-[10px] font-mono">
          <span class="text-zinc-400 truncate max-w-[85px]">${r.road_id}</span>
          <span class="px-2 py-0.5 rounded-full border text-[9px] font-semibold ${badgeClass}">
            <i class="fa-solid ${icon} mr-0.5"></i>${statusText}
          </span>
        </div>
        <div class="text-xs font-semibold text-white truncate" title="${r.road_name}">${r.road_name}</div>
        <div class="grid grid-cols-2 gap-1 text-[11px] font-mono pt-1.5 border-t border-white/10">
          <div>
            <span class="text-zinc-500 text-[10px]">CONG: </span>
            <span class="text-white font-bold">${r.simulated_congestion_pct}%</span>
          </div>
          <div>
            <span class="text-zinc-500 text-[10px]">SPD: </span>
            <span class="text-zinc-300 font-bold">${r.simulated_speed_kmh} km/h</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Reactive debounced slider & select listeners
let whatIfDebounceTimer = null;
document.addEventListener('DOMContentLoaded', () => {
  const closureSelect = document.getElementById('sim-closure-select');
  const volumeSlider = document.getElementById('sim-volume-slider');

  if (closureSelect) {
    closureSelect.addEventListener('change', () => {
      window.runSimulation();
    });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
      clearTimeout(whatIfDebounceTimer);
      whatIfDebounceTimer = setTimeout(() => {
        window.runSimulation();
      }, 150);
    });
  }
});

// =========================================================================
// DYNAMIC EMERGENCY GREEN CORRIDOR ROUTING CONTROLLER
// =========================================================================

async function loadCorridorData() {
  try {
    let url = activeCorridorId ? `/api/v1/corridors/${activeCorridorId}` : `/api/v1/corridors`;
    let res = await fetch(url);
    if (!res.ok && activeCorridorId) {
      res = await fetch('/api/v1/corridors');
    }
    if (!res.ok) return;

    let data = await res.json();
    if (Array.isArray(data)) {
      if (data.length === 0) return;
      data = data.find(c => c.active) || data[0];
    }
    currentCorridorData = data;
    activeCorridorId = data.corridor_id;

    renderCorridorTelematics(data);
    renderSignalControllersRack(data);
    renderCorridorOnMap(data);

    const coords3D = data.route_3d_coordinates || data.waypoints_3d;
    if (window.show3DGreenCorridor && coords3D && coords3D.length > 0) {
      const vCoords3D = data.current_step_index !== undefined && coords3D[data.current_step_index] 
        ? coords3D[data.current_step_index] 
        : coords3D[0];
      window.show3DGreenCorridor(coords3D, vCoords3D);
    }

    loadCorridorTelemetry();
  } catch (err) {
    console.error("Failed to load corridor data:", err);
  }
}

async function loadCorridorTelemetry() {
  try {
    const res = await fetch('/api/v1/corridors/telemetry');
    if (!res.ok) return;
    const t = await res.json();
    const runsEl = document.getElementById('corr-macro-runs');
    const totalRuns = t.total_active_corridors_today ?? t.active_corridors_count ?? t.total_emergency_runs_today ?? 0;
    if (runsEl) runsEl.innerText = `${totalRuns} Incidents`;
    const minsEl = document.getElementById('corr-macro-mins');
    const avgMins = t.average_time_saved_per_run_min ?? t.avg_minutes_saved ?? t.average_time_saved_minutes ?? 0;
    if (minsEl) minsEl.innerText = `${avgMins} min`;
  } catch (e) {
    console.warn("Failed corridor telemetry fetch:", e);
  }
}

function renderCorridorTelematics(c) {
  const v = c.vehicle || {};
  const callsignEl = document.getElementById('corr-vehicle-callsign');
  if (callsignEl) callsignEl.innerText = v.callsign || 'EMERGENCY UNIT';

  const plateEl = document.getElementById('corr-vehicle-plate');
  if (plateEl) plateEl.innerText = v.plate_number || v.license_plate || 'WB-02-EA-9911';

  const priorityEl = document.getElementById('corr-priority-badge');
  if (priorityEl) priorityEl.innerText = (v.priority_level || 'CODE_RED').replace('_', ' ');

  const incidentEl = document.getElementById('corr-incident-name');
  if (incidentEl) incidentEl.innerText = v.incident_type || 'Emergency Response';

  const speedEl = document.getElementById('corr-speed-val');
  if (speedEl) speedEl.innerText = `${v.current_speed_kmh || 60} km/h`;

  const gainEl = document.getElementById('corr-speed-gain');
  if (gainEl) gainEl.innerText = `+${c.speed_improvement_pct || 42}%`;

  const originEl = document.getElementById('corr-origin-name');
  if (originEl) originEl.innerText = c.origin_name || 'Emergency Origin';

  const destEl = document.getElementById('corr-destination-name');
  if (destEl) destEl.innerText = c.destination_name || 'Hospital Trauma Center';

  const statusBadge = document.getElementById('corr-status-badge');
  if (statusBadge) {
    if (c.active && (c.preemption_enabled || c.preemption_active)) {
      statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span><span class="text-emerald-400 font-mono">GREEN WAVE ACTIVE</span>`;
    } else if (c.active) {
      statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span><span class="text-amber-400 font-mono">STANDBY / DISPATCHED</span>`;
    } else {
      statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-gray-500"></span><span class="text-gray-400 font-mono">CYCLES RESTORED</span>`;
    }
  }

  const preemptCountEl = document.getElementById('corr-preempt-count');
  if (preemptCountEl && c.junctions) {
    const greenCount = c.junctions.filter(j => j.signal_state === 'PREEMPTED_GREEN').length;
    preemptCountEl.innerText = `${greenCount} of ${c.junctions.length} Signals Locked`;
  }

  const savedTimeEl = document.getElementById('corr-saved-time');
  if (savedTimeEl) savedTimeEl.innerText = `${c.time_saved_min ?? c.time_saved_minutes ?? 0} min`;

  const etaTimeEl = document.getElementById('corr-eta-time');
  if (etaTimeEl) etaTimeEl.innerText = `${c.eta_with_corridor_min ?? c.eta_corridor_minutes ?? 0} min`;

  const hudTitle = document.getElementById('map-hud-corridor-title');
  if (hudTitle) hudTitle.innerText = `Corridor: ${c.origin_name} → ${c.destination_name}`;

  const nextJunc = (c.junctions || []).find(j => (j.estimated_arrival_seconds ?? j.eta_seconds ?? 0) > 0) || (c.junctions || [])[(c.junctions || []).length - 1];
  const nextEtaEl = document.getElementById('corr-next-eta');
  if (nextEtaEl && nextJunc) {
    const nextEtaSec = nextJunc.estimated_arrival_seconds ?? nextJunc.eta_seconds ?? 0;
    nextEtaEl.innerText = `${nextEtaSec}s to ${nextJunc.junction_name}`;
  }

  const signalCountEl = document.getElementById('corr-signal-count');
  if (signalCountEl && c.junctions) signalCountEl.innerText = `${c.junctions.length} Intersections`;
}

function renderSignalControllersRack(c) {
  const container = document.getElementById('corridor-signals-list');
  if (!container) return;

  if (!c.junctions || c.junctions.length === 0) {
    container.innerHTML = `<div class="p-4 text-center text-gray-500 text-xs font-mono">No downstream signal controllers mapped.</div>`;
    return;
  }

  container.innerHTML = c.junctions.map((j, idx) => {
    const isGreen = j.signal_state === 'PREEMPTED_GREEN';
    const isFlush = j.signal_state === 'QUEUE_FLUSH';
    const isHold = j.signal_state === 'ALL_RED_HOLD';
    const isRecov = j.signal_state === 'TRANSITION_RECOVERY';
    const distM = Math.round(j.distance_to_junction_meters ?? j.distance_meters ?? 0);
    const etaSec = j.estimated_arrival_seconds ?? j.eta_seconds ?? 0;
    const greenWin = j.green_window_duration_seconds ?? j.green_lock_countdown_sec ?? j.time_to_green_lock ?? 45;
    const queuePct = Math.round(j.queue_clearance_pct ?? j.queue_clearance_percent ?? j.queue_cleared_pct ?? 0);

    let stateBadge = '';
    if (isGreen) {
      stateBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-emerald-950 text-emerald-300 border border-emerald-500/50 flex items-center space-x-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span><span>PREEMPTED GREEN</span></span>`;
    } else if (isFlush) {
      stateBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-amber-950 text-amber-300 border border-amber-500/50 flex items-center space-x-1"><span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></span><span>QUEUE FLUSH</span></span>`;
    } else if (isHold) {
      stateBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-rose-950 text-rose-300 border border-rose-500/50 flex items-center space-x-1"><span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span><span>ALL-RED HOLD</span></span>`;
    } else if (isRecov) {
      stateBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-cyan-950 text-cyan-300 border border-cyan-500/50">TRANSITION RECOVERY</span>`;
    } else {
      stateBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-slate-800 text-gray-300 border border-slate-700">NORMAL CYCLE</span>`;
    }

    const heldStreets = (j.cross_streets_held || []).slice(0, 2).join(', ');
    const isTarget = (c.target_junction_id && c.target_junction_id === j.junction_id) ||
      (c.destination_name && (c.destination_name === j.junction_name || c.destination_name.includes(j.junction_name) || j.junction_name.includes(c.destination_name))) ||
      (c.vehicle && c.vehicle.destination_name && (c.vehicle.destination_name === j.junction_name || c.vehicle.destination_name.includes(j.junction_name) || j.junction_name.includes(c.vehicle.destination_name))) ||
      (!c.target_junction_id && idx === c.junctions.length - 1);

    return `
      <div class="p-3 bg-slate-950/90 rounded-xl border ${isTarget ? 'border-emerald-500 shadow-xl shadow-emerald-950/60 ring-1 ring-emerald-500/40' : (isGreen ? 'border-emerald-500/50 shadow-lg shadow-emerald-950/40' : 'border-slate-800')} space-y-2 transition hover:border-slate-700">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <div class="w-6 h-6 rounded-lg ${isTarget ? 'bg-emerald-500 text-black font-extrabold' : (isGreen ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-gray-400')} flex items-center justify-center text-[10px] font-bold font-mono border border-slate-700">
              #${idx + 1}
            </div>
            <div>
              <div class="text-white font-bold text-xs flex items-center space-x-1.5 flex-wrap gap-1">
                <span>${j.junction_name}</span>
                ${isTarget ? '<span class="bg-emerald-500 text-black font-bold px-2 py-0.5 rounded text-[10px] uppercase tracking-wider">ACTIVE TARGET</span>' : ''}
                ${j.manual_override ? '<span class="px-1.5 py-0.2 bg-purple-950 text-purple-300 text-[9px] rounded border border-purple-500/40">OVERRIDE</span>' : ''}
              </div>
              <div class="text-[10px] text-gray-400 font-mono">${j.junction_id} • ${distM}m downstream</div>
            </div>
          </div>
          <div>${stateBadge}</div>
        </div>

        <!-- Arrival & Queue Telemetry -->
        <div class="grid grid-cols-2 gap-2 text-[11px] font-mono bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
          <div>
            <span class="text-gray-400">ETA Countdown:</span>
            <span class="font-bold ${etaSec <= 30 ? 'text-amber-400' : 'text-cyan-300'} ml-1">${etaSec}s</span>
          </div>
          <div>
            <span class="text-gray-400">Green Window:</span>
            <span class="font-bold text-emerald-400 ml-1">${greenWin}s</span>
          </div>
          <div class="col-span-2 flex items-center justify-between text-[10px]">
            <span class="text-gray-400">Holding Cross-Streets:</span>
            <span class="text-rose-400 font-medium truncate max-w-[170px]" title="${heldStreets}">${heldStreets || 'None'}</span>
          </div>
        </div>

        <!-- Queue Clearance Progress Bar -->
        <div class="space-y-1">
          <div class="flex justify-between text-[10px] font-mono">
            <span class="text-gray-400">Upstream Queue Flushing</span>
            <span class="text-emerald-400 font-bold">${queuePct}%</span>
          </div>
          <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div class="bg-gradient-to-r from-emerald-500 to-cyan-400 h-1.5 rounded-full transition-all duration-500" style="width: ${queuePct}%"></div>
          </div>
        </div>

        <!-- Action Override Buttons -->
        <div class="flex items-center space-x-1.5 pt-1">
          <button onclick="overrideSignal('${j.junction_id}', 'FORCE_GREEN')" class="flex-1 py-1 bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/40 rounded text-[10px] font-bold transition flex items-center justify-center space-x-1">
            <i class="fa-solid fa-traffic-light text-[9px]"></i>
            <span>Force Green</span>
          </button>
          <button onclick="overrideSignal('${j.junction_id}', 'ADD_BUFFER_30S')" class="flex-1 py-1 bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-700 rounded text-[10px] font-bold transition flex items-center justify-center space-x-1">
            <i class="fa-solid fa-plus text-[9px]"></i>
            <span>+30s Buffer</span>
          </button>
          <button onclick="overrideSignal('${j.junction_id}', 'RELEASE_HOLD')" class="py-1 px-2 bg-slate-900 hover:bg-slate-800 text-gray-400 hover:text-white border border-slate-700 rounded text-[10px] transition" title="Release to Normal Cycle">
            <i class="fa-solid fa-rotate-left"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function renderCorridorOnMap(c) {
  const routeCoordinates = c.route_coordinates || c.gis_polyline || [];
  if (!corridorMap || routeCoordinates.length === 0) return;

  corridorMarkers.forEach(m => corridorMap.removeLayer(m));
  corridorMarkers = [];

  if (corridorPolyline) {
    corridorMap.removeLayer(corridorPolyline);
    corridorPolyline = null;
  }
  if (corridorVehicleMarker) {
    corridorMap.removeLayer(corridorVehicleMarker);
    corridorVehicleMarker = null;
  }

  // Draw Glowing Emerald Polyline
  corridorPolyline = L.polyline(routeCoordinates, {
    color: '#10b981',
    weight: 6,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(corridorMap);

  // Add Junction Pins along route
  (c.junctions || []).forEach((j, i) => {
    const isGreen = j.signal_state === 'PREEMPTED_GREEN';
    const pinColor = isGreen ? '#10b981' : (j.signal_state === 'QUEUE_FLUSH' ? '#f59e0b' : '#64748b');

    const pinHtml = `
      <div style="background-color: ${pinColor}; width: 26px; height: 26px; border-radius: 50%; border: 2px solid #ffffff; box-shadow: 0 0 12px ${pinColor}; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #fff; font-weight: bold;">
        ${i + 1}
      </div>
    `;

    const icon = L.divIcon({
      className: 'custom-corridor-pin',
      html: pinHtml,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    const distM = Math.round(j.distance_to_junction_meters ?? j.distance_meters ?? 0);
    const etaSec = j.estimated_arrival_seconds ?? j.eta_seconds ?? 0;
    const marker = L.marker([j.lat, j.lng], { icon: icon }).addTo(corridorMap);
    marker.bindPopup(`
      <div class="p-2 space-y-1 text-xs">
        <div class="font-bold text-white">${j.junction_name}</div>
        <div class="font-mono text-cyan-300 text-[11px]">${j.junction_id}</div>
        <div class="text-[11px] font-mono text-emerald-400">State: ${j.signal_state}</div>
        <div class="text-[10px] text-gray-300">ETA: ${etaSec}s | Dist: ${distM}m</div>
      </div>
    `, { className: 'custom-leaflet-popup' });
    corridorMarkers.push(marker);
  });

  // Emergency Vehicle Marker
  const v = c.vehicle || {};
  const vLat = v.current_lat || (v.current_coords ? v.current_coords[0] : routeCoordinates[0][0]);
  const vLng = v.current_lng || (v.current_coords ? v.current_coords[1] : routeCoordinates[0][1]);

  const vehicleHtml = `
    <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; inset: -4px; border-radius: 50%; background: rgba(16, 185, 129, 0.4); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="width: 32px; height: 32px; border-radius: 50%; background: #020617; border: 2px solid #10b981; box-shadow: 0 0 15px rgba(16, 185, 129, 0.8); display: flex; align-items: center; justify-content: center; color: #10b981; font-size: 14px; position: relative; z-index: 10;">
        <i class="fa-solid fa-truck-medical"></i>
      </div>
    </div>
  `;

  const vIcon = L.divIcon({
    className: 'custom-amb-pin',
    html: vehicleHtml,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  corridorVehicleMarker = L.marker([vLat, vLng], { icon: vIcon, zIndexOffset: 1000 }).addTo(corridorMap);
  corridorVehicleMarker.bindPopup(`
    <div class="p-2 space-y-1 text-xs">
      <div class="font-bold text-white">${v.callsign || 'Emergency Vehicle'}</div>
      <div class="font-mono text-cyan-300 text-[11px]">${v.plate_number || v.license_plate || ''}</div>
      <div class="text-[11px] text-emerald-400 font-bold">Speed: ${v.current_speed_kmh || 60} km/h</div>
      <div class="text-[10px] text-rose-400 font-bold">${v.priority_level || 'CODE_RED'} - ${v.incident_type || ''}</div>
    </div>
  `, { className: 'custom-leaflet-popup' });

  // Destination Hospital Pin
  const destCoords = routeCoordinates[routeCoordinates.length - 1];
  const destHtml = `
    <div style="width: 30px; height: 30px; border-radius: 8px; background: #e11d48; border: 2px solid #ffffff; box-shadow: 0 0 15px rgba(225, 29, 72, 0.8); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 14px;">
      <i class="fa-solid fa-hospital"></i>
    </div>
  `;
  const destIcon = L.divIcon({
    className: 'custom-dest-pin',
    html: destHtml,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
  const destMarker = L.marker(destCoords, { icon: destIcon }).addTo(corridorMap);
  destMarker.bindPopup(`
    <div class="p-2 space-y-1 text-xs">
      <div class="font-bold text-white">${c.destination_name}</div>
      <div class="text-[11px] text-gray-300">Emergency Trauma Destination</div>
    </div>
  `, { className: 'custom-leaflet-popup' });
  corridorMarkers.push(destMarker);

  corridorMap.fitBounds(corridorPolyline.getBounds(), { padding: [40, 40] });
}

// Preset Scenarios
window.dispatchCorridorScenario = async function (presetKey) {
  const presets = {
    'trauma_cardiac': {
      vehicle_id: 'VEH-EMG-01',
      callsign: 'AMB-911 (Cardiac Unit)',
      plate_number: 'WB-02-EA-9911',
      vehicle_type: 'AMBULANCE',
      priority_level: 'CODE_RED',
      incident_type: 'Severe STEMI Cardiac Arrest & Respiratory Distress',
      origin_name: 'SSKM Hospital / IPGMER Emergency Bay',
      destination_name: 'Apollo Multispecialty Hospital Apex Wing',
      speed_kmh: 68.0
    },
    'fire_4alarm': {
      vehicle_id: 'VEH-EMG-02',
      callsign: 'FIRE-04 (Heavy Aerial Platform Engine)',
      plate_number: 'WB-04-FE-101',
      vehicle_type: 'FIRE_ENGINE',
      priority_level: 'CODE_RED',
      incident_type: '4-Alarm Commercial Structure Fire',
      origin_name: 'Howrah Riverfront Fire Station',
      destination_name: 'Sector V IT & Financial Tech Hub',
      speed_kmh: 62.0
    },
    'organ_transport': {
      vehicle_id: 'VEH-EMG-03',
      callsign: 'LIFE-01 (Rapid Organ Transport)',
      plate_number: 'WB-06-OR-5500',
      vehicle_type: 'ORGAN_TRANSPORT',
      priority_level: 'CODE_RED',
      incident_type: 'Zero-Delay Pediatric Donor Heart Transit',
      origin_name: 'Park Circus 7-Point Hub',
      destination_name: 'SSKM Hospital Trauma Center',
      speed_kmh: 74.0
    }
  };

  const payload = presets[presetKey];
  if (!payload) return;

  ['cardiac', 'fire', 'organ'].forEach(k => {
    const b = document.getElementById(`btn-scene-${k}`);
    if (b) {
      b.classList.remove('bg-emerald-600/30', 'border-emerald-500/40', 'bg-amber-950/50', 'bg-purple-950/50');
      b.classList.add('bg-slate-900', 'border-slate-700');
    }
  });

  const activeBtn = document.getElementById(`btn-scene-${presetKey.includes('cardiac') ? 'cardiac' : (presetKey.includes('fire') ? 'fire' : 'organ')}`);
  if (activeBtn) {
    activeBtn.classList.remove('bg-slate-900', 'border-slate-700');
    activeBtn.classList.add('bg-emerald-600/30', 'border-emerald-500/40');
  }

  try {
    const res = await fetch('/api/v1/corridors/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      activeCorridorId = data.corridor_id;
      loadCorridorData();
      showCorridorToast(`🚨 Corridor Dispatched: ${data.vehicle.callsign} en route with dynamic preemption`);
    }
  } catch (err) {
    console.error("Dispatch scenario failed:", err);
  }
};

window.activateCurrentCorridor = async function () {
  if (!activeCorridorId) return;
  try {
    const res = await fetch(`/api/v1/corridors/${activeCorridorId}/activate`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      currentCorridorData = data;
      renderCorridorTelematics(data);
      renderSignalControllersRack(data);
      renderCorridorOnMap(data);
      showCorridorToast("⚡ Dynamic Green Wave Preemption ACTIVATED across all downstream controllers!");
    }
  } catch (e) {
    console.error("Failed activate corridor:", e);
  }
};

window.simulateCorridorProgress = async function () {
  if (!activeCorridorId) return;
  try {
    const res = await fetch(`/api/v1/corridors/${activeCorridorId}/simulate-step`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      currentCorridorData = data;
      renderCorridorTelematics(data);
      renderSignalControllersRack(data);
      renderCorridorOnMap(data);

      const coords3D = data.route_3d_coordinates || data.waypoints_3d;
      if (window.show3DGreenCorridor && coords3D && coords3D.length > 0) {
        const vCoords3D = data.current_step_index !== undefined && coords3D[data.current_step_index] 
          ? coords3D[data.current_step_index] 
          : coords3D[0];
        window.show3DGreenCorridor(coords3D, vCoords3D);
      }
      showCorridorToast(`🚗 Advanced vehicle along corridor. Signals synchronized.`);
    }
  } catch (e) {
    console.error("Failed simulate step:", e);
  }
};

window.deactivateCurrentCorridor = async function () {
  if (!activeCorridorId) return;
  try {
    const res = await fetch(`/api/v1/corridors/${activeCorridorId}/deactivate`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      currentCorridorData = data;
      renderCorridorTelematics(data);
      renderSignalControllersRack(data);
      renderCorridorOnMap(data);
      if (window.clear3DGreenCorridor) window.clear3DGreenCorridor();
      showCorridorToast("🛑 Corridor Deactivated. Downstream signals entering smooth transition recovery.");
    }
  } catch (e) {
    console.error("Failed deactivate corridor:", e);
  }
};

window.overrideSignal = async function (junctionId, action) {
  if (!activeCorridorId) return;
  try {
    const res = await fetch(`/api/v1/corridors/${activeCorridorId}/signal-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ junction_id: junctionId, override_action: action, override_duration_seconds: 30 })
    });
    if (res.ok) {
      const data = await res.json();
      currentCorridorData = data;
      renderCorridorTelematics(data);
      renderSignalControllersRack(data);
      renderCorridorOnMap(data);

      const coords3D = data.route_3d_coordinates || data.waypoints_3d;
      if (window.show3DGreenCorridor && coords3D && coords3D.length > 0) {
        const vCoords3D = data.current_step_index !== undefined && coords3D[data.current_step_index] 
          ? coords3D[data.current_step_index] 
          : coords3D[0];
        window.show3DGreenCorridor(coords3D, vCoords3D);
      }

      if (action === 'FORCE_GREEN') {
        const targetName = data.destination_name || junctionId;
        showCorridorToast(`🚑 Green wave preemption locked to ${targetName}. Route updated.`);
      } else {
        showCorridorToast(`Signal ${junctionId} override applied: ${action}`);
      }
    }
  } catch (e) {
    console.error("Override signal error:", e);
  }
};

window.viewCorridorIn3DTwin = function () {
  window.switchTab('3dtwin');
  if (currentCorridorData && window.show3DGreenCorridor) {
    setTimeout(() => {
      const coords3D = currentCorridorData.route_3d_coordinates || currentCorridorData.waypoints_3d;
      if (coords3D && coords3D.length > 0) {
        const vCoords3D = currentCorridorData.current_step_index !== undefined && coords3D[currentCorridorData.current_step_index] 
          ? coords3D[currentCorridorData.current_step_index] 
          : coords3D[0];
        window.show3DGreenCorridor(coords3D, vCoords3D);
      }
    }, 150);
  }
};

window.openCustomDispatchModal = function () {
  const m = document.getElementById('custom-dispatch-modal');
  if (m) m.classList.remove('hidden');
};

window.closeCustomDispatchModal = function () {
  const m = document.getElementById('custom-dispatch-modal');
  if (m) m.classList.add('hidden');
};

window.submitCustomDispatch = async function () {
  const callsign = document.getElementById('disp-callsign').value;
  const plate = document.getElementById('disp-plate').value;
  const vtype = document.getElementById('disp-type').value;
  const incident = document.getElementById('disp-incident').value;
  const origin = document.getElementById('disp-origin').value;
  const dest = document.getElementById('disp-destination').value;
  const speed = parseFloat(document.getElementById('disp-speed').value) || 65.0;

  const payload = {
    vehicle_id: `VEH-CUSTOM-${Math.floor(Math.random() * 900 + 100)}`,
    callsign: callsign || 'EMG-UNIT-ALPHA',
    plate_number: plate || 'WB-02-XX-0001',
    license_plate: plate || 'WB-02-XX-0001',
    vehicle_type: vtype,
    priority_level: 'CODE_RED',
    incident_type: incident || 'Emergency Intervention',
    origin_name: origin,
    destination_name: dest,
    speed_kmh: speed
  };

  try {
    const res = await fetch('/api/v1/corridors/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const data = await res.json();
      activeCorridorId = data.corridor_id;
      window.closeCustomDispatchModal();
      loadCorridorData();
      showCorridorToast(`Custom Corridor Dispatched: ${data.vehicle.callsign}`);
    }
  } catch (err) {
    console.error("Submit custom dispatch error:", err);
  }
};

function showCorridorToast(msg) {
  let toast = document.getElementById('corridor-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'corridor-toast';
    toast.className = 'fixed bottom-8 right-8 z-[9999] px-4 py-3 bg-emerald-950/95 border border-emerald-500 rounded-xl text-emerald-300 font-bold text-xs shadow-2xl flex items-center space-x-2 animate-bounce';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<i class="fa-solid fa-truck-medical text-emerald-400"></i><span>${msg}</span>`;
  setTimeout(() => { if (toast) toast.remove(); }, 4000);
}

// =========================================================================
// TAB 4: ANPR OCR INSPECTION LAB CONTROLLER
// =========================================================================
window.setOCRPreset = function (plate, degradation) {
  const plateInput = document.getElementById('ocr-plate-input');
  const degSelect = document.getElementById('ocr-degradation-select');
  const extractedTextEl = document.getElementById('ocr-extracted-text');
  const previewBox = document.getElementById('ocr-image-preview-box');
  if (plateInput) plateInput.value = plate;
  if (degSelect && degradation) degSelect.value = degradation;
  if (previewBox && extractedTextEl && (extractedTextEl.innerText.includes('Error') || extractedTextEl.innerText === '--')) {
    previewBox.classList.add('hidden');
  }
  runOCRTest();
};

window.runOCRTest = async function () {
  const plateInput = document.getElementById('ocr-plate-input');
  const degSelect = document.getElementById('ocr-degradation-select');
  const btn = document.getElementById('ocr-run-btn');
  const svgContainer = document.getElementById('ocr-svg-container');
  const charBreakdown = document.getElementById('ocr-char-breakdown');
  const badge = document.getElementById('ocr-accuracy-badge');
  const rectType = document.getElementById('ocr-rect-type');
  const latency = document.getElementById('ocr-latency');
  const kpiOcr = document.getElementById('kpi-ocr');

  const rawPlate = (plateInput && plateInput.value.trim()) ? plateInput.value.trim().toUpperCase() : '7XYZ912';
  const degradation = degSelect ? degSelect.value : 'rain';

  // Loading state
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-75');
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i><span>Running Neural Inference...</span>`;
  }
  if (svgContainer && !svgContainer.innerHTML.trim()) {
    svgContainer.innerHTML = `<div class="py-6 text-center text-xs font-mono text-cyan-400 animate-pulse"><i class="fa-solid fa-microchip text-lg mb-2 block"></i>Processing Spatial Transformer Homography...</div>`;
  }

  try {
    const res = await fetch('/api/v1/cameras/ocr_test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plate_text: rawPlate, degradation: degradation })
    });

    if (res.ok) {
      const data = await res.json();

      // 1. Render SVG Plate Crop
      if (svgContainer) {
        svgContainer.innerHTML = data.ocr_visual_svg;
      }

      // 2. Accuracy Badge
      if (badge) {
        badge.innerText = `${data.overall_accuracy_pct.toFixed(1)}% Accuracy (${data.passes_90_pct_threshold ? 'PASS' : 'FLAGGED'})`;
        if (data.passes_90_pct_threshold) {
          badge.className = 'px-2.5 py-0.5 bg-emerald-950 text-emerald-400 font-bold rounded border border-emerald-500/40 text-xs flex items-center space-x-1';
        } else {
          badge.className = 'px-2.5 py-0.5 bg-amber-950 text-amber-400 font-bold rounded border border-amber-500/40 text-xs flex items-center space-x-1';
        }
      }

      // 3. Preprocessing and Latency
      if (rectType) rectType.innerText = data.rectification_applied || 'CLAHE + Retinex';
      if (latency) latency.innerText = `${data.processing_time_ms.toFixed(1)} ms`;

      // 4. Character Breakdown Cards
      if (charBreakdown && data.character_breakdown) {
        charBreakdown.innerHTML = data.character_breakdown.map((item) => {
          const pct = (item.confidence * 100).toFixed(1);
          const isHigh = item.confidence >= 0.90;
          const borderColor = isHigh ? 'border-emerald-500/40 bg-emerald-950/40' : 'border-amber-500/40 bg-amber-950/40';
          const textColor = isHigh ? 'text-emerald-400' : 'text-amber-400';
          const statusBg = isHigh ? 'text-emerald-400 bg-emerald-950/80 border-emerald-500/30' : 'text-amber-400 bg-amber-950/80 border-amber-500/30';
          return `
            <div class="p-2 rounded-lg border ${borderColor} flex flex-col items-center justify-between min-w-[42px] transition hover:scale-105">
              <span class="text-base font-extrabold text-white font-mono">${item.char}</span>
              <span class="text-[10px] font-bold ${textColor} mt-1">${pct}%</span>
              <span class="text-[8px] uppercase tracking-wider px-1 py-0.2 rounded border mt-1 font-semibold ${statusBg}">${item.status || (isHigh ? 'PASS' : 'RECT')}</span>
            </div>
          `;
        }).join('');
      }

      // 5. Update Top Ribbon KPI
      if (kpiOcr) {
        kpiOcr.innerHTML = `${data.overall_accuracy_pct.toFixed(1)}% <span class="text-xs text-gray-400 font-normal">(>90% Spec)</span>`;
      }
    } else {
      console.warn("OCR test returned non-200 status:", res.status);
    }
  } catch (err) {
    console.error("Failed executing OCR test:", err);
    if (svgContainer) {
      svgContainer.innerHTML = `<div class="p-3 text-center text-xs text-rose-400 font-mono"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Network Error connecting to OCR Engine</div>`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-75');
      btn.innerHTML = `<i class="fa-solid fa-microchip"></i><span>Run Deep OCR Inference</span>`;
    }
  }
};

// Edge Frame & Custom Upload Handlers
window.currentUploadedFile = null;

window.handleOCRDrop = function (event) {
  event.preventDefault();
  const zone = document.getElementById('ocr-upload-zone');
  if (zone) zone.classList.remove('border-cyan-500', 'bg-cyan-950/20');

  if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
    const file = event.dataTransfer.files[0];
    const fileInput = document.getElementById('ocr-image-file');
    if (fileInput) {
      try {
        fileInput.files = event.dataTransfer.files;
      } catch (err) {
        // Fallback for browsers that don't allow modifying files list
      }
    }
    window.handleOCRImageUpload({ target: { files: [file] } });
  }
};

window.rescanUploadedImage = function () {
  if (window.currentUploadedFile) {
    window.handleOCRImageUpload({ target: { files: [window.currentUploadedFile] } });
  } else {
    const fileInput = document.getElementById('ocr-image-file');
    if (fileInput && fileInput.files && fileInput.files[0]) {
      window.handleOCRImageUpload({ target: fileInput });
    } else {
      if (fileInput) fileInput.click();
    }
  }
};

window.handleOCRImageUpload = async function (event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  window.currentUploadedFile = file;

  const previewBox = document.getElementById('ocr-image-preview-box');
  const previewImg = document.getElementById('ocr-uploaded-preview');
  const extractedTextEl = document.getElementById('ocr-extracted-text');
  const extractedBadge = document.getElementById('ocr-extracted-badge');
  const plateInput = document.getElementById('ocr-plate-input');
  const btn = document.getElementById('ocr-run-btn');
  const svgContainer = document.getElementById('ocr-svg-container');
  const badge = document.getElementById('ocr-accuracy-badge');
  const rectType = document.getElementById('ocr-rect-type');
  const latency = document.getElementById('ocr-latency');
  const charBreakdown = document.getElementById('ocr-char-breakdown');
  const kpiOcr = document.getElementById('kpi-ocr');

  // 1. Show immediate preview
  if (previewBox) previewBox.classList.remove('hidden');
  const reader = new FileReader();
  reader.onload = function (e) {
    if (previewImg) previewImg.src = e.target.result;
  };
  reader.readAsDataURL(file);

  // 2. Set interactive loading states
  if (extractedTextEl) {
    extractedTextEl.innerHTML = `<span class="inline-flex items-center text-cyan-400 font-mono text-xs"><i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Running Deep Neural ANPR...</span>`;
  }
  if (extractedBadge) {
    extractedBadge.innerText = 'Scanning...';
    extractedBadge.className = 'text-[10px] text-cyan-400 font-bold bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-500/40 animate-pulse';
  }
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-75');
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i><span>Scanning Number Plate...</span>`;
  }
  if (svgContainer) {
    svgContainer.innerHTML = `<div class="py-6 text-center text-xs font-mono text-cyan-400 animate-pulse"><i class="fa-solid fa-microchip text-lg mb-2 block"></i>Extracting Plate Contours & Homography...</div>`;
  }

  // 3. Post actual image bytes to deep-learning ANPR OCR backend
  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/v1/cameras/ocr_upload', {
      method: 'POST',
      body: formData
    });

    if (res.ok) {
      const data = await res.json();
      const testRes = data.ocr_test_result || data;
      const recognized = (data.recognized_plate || testRes.recognized_plate || '').trim();
      const conf = data.recognition_confidence || (testRes.raw_confidence || 0.92);
      const engine = data.recognition_engine || testRes.rectification_applied || 'EasyOCR Deep Reader';

      // Update extracted plate text display
      if (recognized && recognized !== 'NO_PLATE_DETECTED' && recognized !== 'ERR_INVALID') {
        if (extractedTextEl) {
          extractedTextEl.innerHTML = `<span>${recognized}</span>`;
        }
        if (extractedBadge) {
          extractedBadge.innerText = `${(conf * 100).toFixed(1)}% Conf`;
          extractedBadge.className = 'text-[10px] text-emerald-400 font-bold bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/40';
        }
        if (plateInput) plateInput.value = recognized;
      } else {
        if (extractedTextEl) {
          extractedTextEl.innerHTML = `<span class="text-amber-400 text-xs font-mono"><i class="fa-solid fa-triangle-exclamation mr-1"></i>No Plate Recognized</span>`;
        }
        if (extractedBadge) {
          extractedBadge.innerText = 'Check Image';
          extractedBadge.className = 'text-[10px] text-amber-400 font-bold bg-amber-950 px-2 py-0.5 rounded border border-amber-500/40';
        }
      }

      // 1. Render SVG Plate Crop
      if (svgContainer && testRes.ocr_visual_svg) {
        svgContainer.innerHTML = testRes.ocr_visual_svg;
      }

      // 2. Accuracy Badge
      if (badge && testRes.overall_accuracy_pct !== undefined) {
        badge.innerText = `${testRes.overall_accuracy_pct.toFixed(1)}% Accuracy (${testRes.passes_90_pct_threshold ? 'PASS' : 'FLAGGED'})`;
        badge.className = testRes.passes_90_pct_threshold
          ? 'px-2.5 py-0.5 bg-emerald-950 text-emerald-400 font-bold rounded border border-emerald-500/40 text-xs flex items-center space-x-1'
          : 'px-2.5 py-0.5 bg-amber-950 text-amber-400 font-bold rounded border border-amber-500/40 text-xs flex items-center space-x-1';
      }

      // 3. Preprocessing and Latency
      if (rectType) rectType.innerText = testRes.rectification_applied || engine;
      if (latency) latency.innerText = `${(testRes.processing_time_ms || 24.5).toFixed(1)} ms`;

      // 4. Character Breakdown Cards
      if (charBreakdown && testRes.character_breakdown && testRes.character_breakdown.length > 0) {
        charBreakdown.innerHTML = testRes.character_breakdown.map((item) => {
          const pct = (item.confidence * 100).toFixed(1);
          const isHigh = item.confidence >= 0.90;
          const borderColor = isHigh ? 'border-emerald-500/40 bg-emerald-950/40' : 'border-amber-500/40 bg-amber-950/40';
          const textColor = isHigh ? 'text-emerald-400' : 'text-amber-400';
          const statusBg = isHigh ? 'text-emerald-400 bg-emerald-950/80 border-emerald-500/30' : 'text-amber-400 bg-amber-950/80 border-amber-500/30';
          return `
            <div class="p-2 rounded-lg border ${borderColor} flex flex-col items-center justify-between min-w-[42px] transition hover:scale-105">
              <span class="text-base font-extrabold text-white font-mono">${item.char}</span>
              <span class="text-[10px] font-bold ${textColor} mt-1">${pct}%</span>
              <span class="text-[8px] uppercase tracking-wider px-1 py-0.2 rounded border mt-1 font-semibold ${statusBg}">${item.status || (isHigh ? 'PASS' : 'RECT')}</span>
            </div>
          `;
        }).join('');
      } else if (charBreakdown && (recognized === 'NO_PLATE_DETECTED' || recognized === 'ERR_INVALID')) {
        charBreakdown.innerHTML = `<div class="col-span-full py-2 text-center text-xs text-amber-400/80 font-mono">No characters identified in uploaded image</div>`;
      }

      // 5. Update Top Ribbon KPI
      if (kpiOcr && testRes.overall_accuracy_pct) {
        kpiOcr.innerHTML = `${testRes.overall_accuracy_pct.toFixed(1)}% <span class="text-xs text-gray-400 font-normal">(>90% Spec)</span>`;
      }

      if (window.playAudioCue) window.playAudioCue('success');
    } else {
      console.warn("OCR test upload returned status:", res.status);
      if (extractedTextEl) extractedTextEl.innerHTML = `<span class="text-rose-400 text-xs font-mono"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Server returned ${res.status}</span>`;
      if (extractedBadge) {
        extractedBadge.innerText = 'Failed';
        extractedBadge.className = 'text-[10px] text-rose-400 font-bold bg-rose-950 px-2 py-0.5 rounded border border-rose-500/40';
      }
      if (svgContainer) {
        svgContainer.innerHTML = `<div class="p-3 text-center text-xs text-rose-400 font-mono"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Server returned status ${res.status}</div>`;
      }
    }
  } catch (err) {
    console.error("Failed uploading image for OCR:", err);
    if (extractedTextEl) extractedTextEl.innerHTML = `<span class="text-rose-400 text-xs font-mono"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Network Error</span>`;
    if (extractedBadge) {
      extractedBadge.innerText = 'Failed';
      extractedBadge.className = 'text-[10px] text-rose-400 font-bold bg-rose-950 px-2 py-0.5 rounded border border-rose-500/40';
    }
    if (svgContainer) {
      svgContainer.innerHTML = `<div class="p-3 text-center text-xs text-rose-400 font-mono"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Network Error connecting to OCR Engine</div>`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-75');
      btn.innerHTML = `<i class="fa-solid fa-microchip"></i><span>Run Deep OCR Inference</span>`;
    }
  }
};

window.loadSamplePlateCrop = function (plate, degradation) {
  const previewBox = document.getElementById('ocr-image-preview-box');
  const previewImg = document.getElementById('ocr-uploaded-preview');
  const extractedTextEl = document.getElementById('ocr-extracted-text');
  const extractedBadge = document.getElementById('ocr-extracted-badge');
  const plateInput = document.getElementById('ocr-plate-input');
  const degSelect = document.getElementById('ocr-degradation-select');

  if (previewBox) previewBox.classList.remove('hidden');
  if (extractedTextEl) extractedTextEl.innerText = plate;
  if (extractedBadge) {
    extractedBadge.innerText = 'Sample Crop';
    extractedBadge.className = 'text-[10px] text-cyan-400 font-bold bg-cyan-950 px-2 py-0.5 rounded border border-cyan-500/40';
  }
  if (plateInput) plateInput.value = plate;
  if (degSelect) degSelect.value = degradation;

  // Generate an authentic synthetic plate crop graphic as DataURL for visual preview
  const canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 90;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const isCommercial = plate.startsWith('WB06') || plate.startsWith('KA') || plate.startsWith('MH') || plate.includes('BUS');
    ctx.fillStyle = isCommercial ? '#fef08a' : '#f8fafc';
    ctx.fillRect(0, 0, 300, 90);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, 300, 90);

    // Blue IND strip
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(8, 8, 16, 74);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 8px sans-serif';
    ctx.fillText('IND', 9, 48);

    // Plate Text
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 26px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(plate, 165, 54);

    // Simulated degradation overlay on raw crop
    if (degradation === 'rain') {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        const rx = 30 + i * 32;
        ctx.moveTo(rx, 10);
        ctx.lineTo(rx + 20, 80);
        ctx.stroke();
      }
    } else if (degradation === 'glare') {
      const grad = ctx.createRadialGradient(150, 20, 10, 150, 20, 100);
      grad.addColorStop(0, 'rgba(255,255,255,0.7)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 300, 90);
    } else if (degradation === 'motion_blur') {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(0, 0, 300, 90);
    }

    if (previewImg) previewImg.src = canvas.toDataURL();
  }

  runOCRTest();
};

window.runFullOCRBenchmark = async function () {
  const btn = document.getElementById('ocr-benchmark-matrix-btn');
  const plateInput = document.getElementById('ocr-plate-input');
  const targetPlate = (plateInput && plateInput.value ? plateInput.value.trim() : 'WB02AK4921');

  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-75');
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i><span>Running 6-Condition SLA Benchmark...</span>`;
  }

  try {
    const res = await fetch(`/api/v1/cameras/ocr_benchmark_matrix?plate=${encodeURIComponent(targetPlate)}`);
    if (res.ok) {
      const data = await res.json();
      const results = data.benchmark_matrix || [];

      results.forEach((item) => {
        const id = item.degradation_id;
        const valEl = document.getElementById(`val-deg-${id}`);
        const rectEl = document.getElementById(`rect-deg-${id}`);
        const badgeEl = document.getElementById(`badge-deg-${id}`);
        const cardEl = document.getElementById(`card-deg-${id}`);

        if (valEl) valEl.innerText = `${item.accuracy_pct.toFixed(1)}%`;
        if (rectEl) rectEl.innerText = item.rectification_applied || 'STN Homography';

        if (badgeEl) {
          if (item.passes_sla) {
            badgeEl.innerText = `>90% SLA PASS`;
            badgeEl.className = 'px-2 py-0.5 bg-emerald-950/80 text-emerald-400 text-[9px] font-bold rounded border border-emerald-500/30 text-center uppercase tracking-wider';
          } else {
            badgeEl.innerText = `BELOW SLA`;
            badgeEl.className = 'px-2 py-0.5 bg-amber-950/80 text-amber-400 text-[9px] font-bold rounded border border-amber-500/30 text-center uppercase tracking-wider';
          }
        }

        if (cardEl) {
          cardEl.classList.add('border-emerald-500/60');
          setTimeout(() => {
            cardEl.classList.remove('border-emerald-500/60');
          }, 1500);
        }
      });

      if (window.playAudioCue) window.playAudioCue('success');
    }
  } catch (err) {
    console.error("Failed running full OCR benchmark:", err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-75');
      btn.innerHTML = `<i class="fa-solid fa-play"></i><span>Run Full 6-Condition SLA Benchmark</span>`;
    }
  }
};


// ==================== PROFESSIONAL DESIGNER AUDIO TELEMETRY & CONTROLS ====================

let audioTelemetryEnabled = false;
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

window.toggleAudioTelemetry = function () {
  audioTelemetryEnabled = !audioTelemetryEnabled;
  const btn = document.getElementById('audio-toggle-btn');
  const icon = document.getElementById('audio-toggle-icon');
  const label = document.getElementById('audio-toggle-label');
  
  if (audioTelemetryEnabled) {
    const ctx = getAudioContext();
    if (ctx) window.playAudioCue('tab');
    if (btn) {
      btn.classList.remove('text-slate-400', 'border-slate-800');
      btn.classList.add('text-cyan-300', 'border-cyan-500/40', 'bg-cyan-950/40');
    }
    if (icon) icon.className = 'fa-solid fa-volume-high text-cyan-400';
    if (label) label.innerText = 'Audio: ON';
  } else {
    if (btn) {
      btn.classList.remove('text-cyan-300', 'border-cyan-500/40', 'bg-cyan-950/40');
      btn.classList.add('text-slate-400', 'border-slate-800');
    }
    if (icon) icon.className = 'fa-solid fa-volume-xmark text-slate-500';
    if (label) label.innerText = 'Audio: MUTED';
  }
};

window.playAudioCue = function (type = 'tab') {
  if (!audioTelemetryEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'tab') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.05);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.start(now);
      osc.stop(now + 0.06);
    } else if (type === 'alert') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(880, now + 0.08);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.start(now);
      osc.stop(now + 0.16);
    } else if (type === 'corridor') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.1);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    }
  } catch (e) {
    console.warn("Audio cue error:", e);
  }
};

window.toggleFullscreen = function () {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }
};

// ============================================================================
// PHASE 3: DUAL-FEED EDGE VIDEO INGESTION & ANPR PIPELINE CONTROLLER
// ============================================================================

let streamPollingTimer = null;
let activeSnapshotCamera = 'CAM_01';

window.setCameraStreamMode = async function (camId, mode) {
  const btnSynth = document.getElementById(`btn-mode-synth-${camId}`);
  const btnWebcam = document.getElementById(`btn-mode-webcam-${camId}`);
  const btnPhone = document.getElementById(`btn-mode-phone-${camId}`);
  const btnUpload = document.getElementById(`btn-mode-upload-${camId}`);
  const panelWebcam = document.getElementById(`panel-webcam-${camId}`);
  const panelPhone = document.getElementById(`panel-phone-${camId}`);
  const panelUpload = document.getElementById(`panel-upload-${camId}`);
  const modeLabel = document.getElementById(`current-mode-${camId.toLowerCase()}`);

  [btnSynth, btnWebcam, btnPhone, btnUpload].forEach(btn => {
    if (btn) {
      btn.className = "p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white transition flex items-center justify-center space-x-1";
    }
  });

  if (panelWebcam) panelWebcam.classList.add('hidden');
  if (panelPhone) panelPhone.classList.add('hidden');
  if (panelUpload) panelUpload.classList.add('hidden');

  // Stop browser webcam stream if active for this camera
  if (window._browserStreams && window._browserStreams[camId]) {
    window._browserStreams[camId].stop();
    delete window._browserStreams[camId];
    const lbl = document.getElementById(`label-browser-cam-${camId}`);
    if (lbl) lbl.textContent = "Browser Cam";
  }

  if (mode === 'synthetic') {
    if (btnSynth) btnSynth.className = "p-2 rounded-lg bg-cyan-600/30 border border-cyan-500/40 text-white transition flex items-center justify-center space-x-1";
    if (modeLabel) modeLabel.textContent = "Active: Synthetic Highway";
    try {
      await fetch(`/api/v1/cameras/${camId}/stream/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'synthetic', source_url: '' })
      });
      refreshStreamImage(camId);
      if (window.playAudioCue) window.playAudioCue('tab');
    } catch (err) {
      console.error(`Error configuring ${camId} synthetic mode:`, err);
    }
  } else if (mode === 'webcam') {
    if (btnWebcam) btnWebcam.className = "p-2 rounded-lg bg-emerald-600/30 border border-emerald-500/40 text-white transition flex items-center justify-center space-x-1";
    if (panelWebcam) panelWebcam.classList.remove('hidden');
    if (modeLabel) modeLabel.textContent = "Active: Local Hardware Webcam (DirectShow)";
    window.connectWebcamFeed(camId);
    if (window.playAudioCue) window.playAudioCue('tab');
  } else if (mode === 'phone_live') {
    if (btnPhone) btnPhone.className = "p-2 rounded-lg bg-amber-600/30 border border-amber-500/40 text-white transition flex items-center justify-center space-x-1";
    if (panelPhone) panelPhone.classList.remove('hidden');
    if (modeLabel) modeLabel.textContent = "Mode: Phone IP Webcam (Enter URL)";
  } else if (mode === 'video_file') {
    if (btnUpload) btnUpload.className = "p-2 rounded-lg bg-purple-600/30 border border-purple-500/40 text-white transition flex items-center justify-center space-x-1";
    if (panelUpload) panelUpload.classList.remove('hidden');
    if (modeLabel) modeLabel.textContent = "Mode: Video File (.mp4)";
    window.loadSampleVideo(camId, camId === 'CAM_01' ? 'CAM_01_2.mov.mp4' : 'CAM_02_2.mov.mp4');
  }
};

window.connectWebcamFeed = async function (camId) {
  const input = document.getElementById(`input-webcam-${camId}`);
  const statusEl = document.getElementById(`status-webcam-${camId}`);
  const modeLabel = document.getElementById(`current-mode-${camId.toLowerCase()}`);
  const btnConnect = document.getElementById(`btn-connect-webcam-${camId}`);

  let devId = input ? input.value.trim() : "0";
  if (!devId) devId = "0";

  if (btnConnect) {
    btnConnect.disabled = true;
    btnConnect.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>Starting...`;
  }
  if (statusEl) {
    statusEl.innerHTML = `<span class="text-emerald-400"><i class="fa-solid fa-circle-notch fa-spin mr-1"></i>Initializing hardware webcam index ${devId}...</span>`;
  }
  if (modeLabel) modeLabel.textContent = `Connecting to Webcam (Device ${devId})...`;

  try {
    const res = await fetch(`/api/v1/cameras/${camId}/stream/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'webcam', source_url: devId })
    });
    const data = await res.json();
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-emerald-400 font-semibold"><i class="fa-solid fa-check-circle mr-1"></i>Host Webcam connected (Dev ${devId})! Point camera at cars or steady number plates.</span>`;
    }
    if (modeLabel) modeLabel.textContent = `Active: Local Webcam (${data.status})`;
    refreshStreamImage(camId);
    if (window.playAudioCue) window.playAudioCue('action');
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-rose-400 font-semibold"><i class="fa-solid fa-xmark mr-1"></i>Webcam error: ${err.message}</span>`;
    }
  } finally {
    if (btnConnect) {
      btnConnect.disabled = false;
      btnConnect.innerHTML = `<i class="fa-solid fa-video mr-1"></i><span>Connect PC Cam</span>`;
    }
  }
};

window.toggleBrowserWebcamStream = async function (camId) {
  window._browserStreams = window._browserStreams || {};
  const lbl = document.getElementById(`label-browser-cam-${camId}`);
  const statusEl = document.getElementById(`status-webcam-${camId}`);
  const modeLabel = document.getElementById(`current-mode-${camId.toLowerCase()}`);

  if (window._browserStreams[camId]) {
    // Stop browser streaming
    window._browserStreams[camId].stop();
    delete window._browserStreams[camId];
    if (lbl) lbl.textContent = "Browser Cam";
    if (statusEl) statusEl.innerHTML = `<span class="text-gray-400">Browser camera stopped. Reverting to Host Webcam...</span>`;
    window.connectWebcamFeed(camId);
    return;
  }

  // Start browser streaming via getUserMedia
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("Browser mediaDevices API not supported on this browser/insecure context.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { max: 30 } },
      audio: false
    });

    const videoEl = document.createElement('video');
    videoEl.srcObject = stream;
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    await videoEl.play();

    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    const ctx = canvas.getContext('2d');

    if (lbl) lbl.textContent = "Stop Browser Cam";
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-cyan-400 font-bold"><i class="fa-solid fa-circle-dot text-rose-500 animate-ping mr-1"></i>STREAMING FROM BROWSER WEBCAM (Zero-Lag WebRTC Canvas)</span>`;
    }
    if (modeLabel) modeLabel.textContent = "Active: Browser WebRTC Stream";

    let isStreaming = true;
    const pushInterval = setInterval(async () => {
      if (!isStreaming) return;
      if (videoEl.readyState >= 2) {
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(async (blob) => {
          if (!blob || !isStreaming) return;
          try {
            const formData = new FormData();
            formData.append('file', blob, 'frame.jpg');
            await fetch(`/api/v1/cameras/${camId}/stream/frame_ingest`, {
              method: 'POST',
              body: formData
            });
          } catch (_) {}
        }, 'image/jpeg', 0.70);
      }
    }, 60);

    refreshStreamImage(camId);

    window._browserStreams[camId] = {
      stop: () => {
        isStreaming = false;
        clearInterval(pushInterval);
        stream.getTracks().forEach(t => t.stop());
        videoEl.pause();
      }
    };
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-rose-400 font-semibold"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Browser camera permission denied: ${err.message}</span>`;
    }
  }
};

window.snapPlateFromWebcam = async function (camId = 'CAM_01') {
  try {
    const res = await fetch(`/api/v1/cameras/${camId}/stream/snapshot?t=${Date.now()}`);
    if (!res.ok) {
      alert("Camera snapshot not available yet. Please select Webcam or Phone mode first.");
      return;
    }
    const blob = await res.blob();
    const file = new File([blob], `steady_plate_snap_${Date.now()}.jpg`, { type: 'image/jpeg' });
    window.handleOCRImageUpload({ target: { files: [file] } });

    const previewBox = document.getElementById('ocr-image-preview-box');
    if (previewBox) {
      previewBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (err) {
    console.error("Failed to snap from webcam:", err);
    alert(`Failed to snap from webcam: ${err.message}`);
  }
};


window.normalizePhoneUrl = function(rawUrl) {
  let url = (rawUrl || '').trim();
  if (!url) return '';
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('rtsp://')) {
    url = 'http://' + url;
  }
  try {
    const u = new URL(url);
    // If user provided a plain IP without port, default to 8080 (IP Webcam)
    if (!u.port && /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) {
      u.port = '8080';
    }
    // Only append /video if pathname is empty or root '/'
    if (!u.pathname || u.pathname === '/') {
      u.pathname = '/video';
    }
    return u.toString();
  } catch (_) {
    if (!url.includes('/video') && !url.includes('/videofeed') && !url.includes('.mjpg') && !url.includes('.jpg') && !url.includes('/live')) {
      url = url.replace(/\/+$/, '') + '/video';
    }
    return url;
  }
};

window.testPhoneFeed = async function (camId) {
  const input = document.getElementById(`input-phone-${camId}`);
  const statusEl = document.getElementById(`status-phone-${camId}`);
  const btnTest = document.getElementById(`btn-test-${camId}`);

  let url = input ? input.value.trim() : "";
  if (!url && input && input.placeholder) {
    url = input.placeholder.trim();
    if (input) input.value = url;
  }

  if (!url) {
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-rose-400 font-semibold"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Please enter a phone IP (e.g. 192.168.0.xxx:8080)</span>`;
    }
    return;
  }

  url = window.normalizePhoneUrl(url);
  if (input) input.value = url;

  if (btnTest) {
    btnTest.disabled = true;
    btnTest.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>Testing...`;
  }
  if (statusEl) {
    statusEl.innerHTML = `<span class="text-amber-400"><i class="fa-solid fa-circle-notch fa-spin mr-1"></i>Pinging phone camera at <code class="bg-black/50 px-1 py-0.5 rounded text-white">${url}</code>...</span>`;
  }

  try {
    const res = await fetch('/api/v1/cameras/probe_phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, camera_id: camId })
    });
    const data = await res.json();
    if (data.reachable) {
      if (input && data.resolved_url) input.value = data.resolved_url;
      if (statusEl) {
        statusEl.innerHTML = `<span class="text-emerald-400 font-bold"><i class="fa-solid fa-circle-check mr-1"></i>FEED FOUND! ${data.service_type} (${data.latency_ms}ms). Click 'Connect' to stream!</span>`;
      }
      if (window.playAudioCue) window.playAudioCue('action');
    } else {
      if (statusEl) {
        statusEl.innerHTML = `<span class="text-rose-400 font-semibold"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${data.error || 'Phone unreachable'} ${data.hint ? `<span class="text-white/60 block mt-0.5">${data.hint}</span>` : ''}</span>`;
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-rose-400 font-semibold"><i class="fa-solid fa-xmark mr-1"></i>Diagnostic error: ${err.message}</span>`;
    }
  } finally {
    if (btnTest) {
      btnTest.disabled = false;
      btnTest.innerHTML = `<i class="fa-solid fa-vial mr-1"></i>Test Feed`;
    }
  }
};

window.connectPhoneFeed = async function (camId) {
  const input = document.getElementById(`input-phone-${camId}`);
  const statusEl = document.getElementById(`status-phone-${camId}`);
  const modeLabel = document.getElementById(`current-mode-${camId.toLowerCase()}`);
  const btnConnect = document.getElementById(`btn-connect-${camId}`);

  let url = input ? input.value.trim() : "";
  if (!url && input && input.placeholder) {
    url = input.placeholder.trim();
    if (input) input.value = url;
  }

  if (!url) {
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-rose-400 font-semibold"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Please enter an IP address (e.g. 192.168.0.xxx:8080)</span>`;
    }
    return;
  }

  // Normalize URL intelligently
  url = window.normalizePhoneUrl(url);
  if (input) input.value = url;

  if (btnConnect) {
    btnConnect.disabled = true;
    btnConnect.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>Connecting...`;
  }
  if (statusEl) {
    statusEl.innerHTML = `<span class="text-amber-400"><i class="fa-solid fa-circle-notch fa-spin mr-1"></i>Negotiating stream with <code class="bg-black/50 px-1 py-0.5 rounded text-white">${url}</code>...</span>`;
  }
  if (modeLabel) modeLabel.textContent = `Connecting to ${url}...`;

  try {
    const res = await fetch(`/api/v1/cameras/${camId}/stream/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'phone_live', source_url: url })
    });
    const data = await res.json();
    
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-emerald-400 font-semibold"><i class="fa-solid fa-satellite-dish mr-1"></i>Pipeline locked onto <b class="text-white">${url}</b>! Awaiting frames...</span>`;
    }
    if (modeLabel) modeLabel.textContent = `Active: Phone IP (${data.status})`;
    
    refreshStreamImage(camId);
    if (window.playAudioCue) window.playAudioCue('action');

    // Resilient periodic polling with up to 15 attempts (18-20s grace period)
    let attempts = 0;
    const maxAttempts = 15;
    const checkStreamInterval = setInterval(async () => {
      attempts++;
      try {
        const checkRes = await fetch('/api/v1/cameras/streams/status');
        if (checkRes.ok) {
          const statuses = await checkRes.json();
          const cur = statuses.find(s => s.camera_id === camId);
          if (cur && statusEl) {
            if (cur.status === 'STREAMING') {
              clearInterval(checkStreamInterval);
              statusEl.innerHTML = `<span class="text-emerald-400 font-bold"><i class="fa-solid fa-satellite-dish mr-1"></i>LIVE STREAMING! FPS: ${cur.fps} • ${cur.frames_processed} frames</span>`;
              if (modeLabel) modeLabel.textContent = `Active: Phone IP (STREAMING)`;
              refreshStreamImage(camId);
              return;
            } else if (cur.status === 'SOURCE_UNREACHABLE' && attempts >= 10) {
              clearInterval(checkStreamInterval);
              statusEl.innerHTML = `<span class="text-rose-400 font-semibold"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Phone unreachable at ${url}. Tap 'Test Feed' or ensure IP Webcam server is running & on same Wi-Fi!</span>`;
              if (modeLabel) modeLabel.textContent = `Phone Unreachable (${url})`;
              return;
            } else {
              statusEl.innerHTML = `<span class="text-amber-400"><i class="fa-solid fa-circle-notch fa-spin mr-1"></i>Connecting to phone (${attempts}/${maxAttempts})... Handshake in progress</span>`;
            }
          }
        }
      } catch (_) {}

      if (attempts >= maxAttempts) {
        clearInterval(checkStreamInterval);
      }
    }, 1200);

  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = `<span class="text-rose-400 font-semibold"><i class="fa-solid fa-xmark mr-1"></i>Connection error: ${err.message}</span>`;
    }
    if (modeLabel) modeLabel.textContent = `Error connecting to ${url}`;
  } finally {
    if (btnConnect) {
      btnConnect.disabled = false;
      btnConnect.innerHTML = `<i class="fa-solid fa-link mr-1"></i>Connect`;
    }
  }
};

window.initPhoneNetworkInfo = async function() {
  try {
    const res = await fetch('/api/v1/cameras/network_info');
    if (!res.ok) return;
    const data = await res.json();
    ['CAM_01', 'CAM_02'].forEach(camId => {
      const input = document.getElementById(`input-phone-${camId}`);
      if (input && (!input.value || input.value.includes('192.168.1.105') || input.value.includes('192.168.1.106'))) {
        input.value = `http://${data.subnet}.117:8080/video`;
        input.placeholder = `http://${data.subnet}.xxx:8080/video`;
      }
      const netBadge = document.getElementById(`net-badge-${camId}`);
      if (netBadge) {
        netBadge.textContent = `Laptop Wi-Fi: ${data.local_ip} (Subnet: ${data.subnet}.x)`;
      }
    });
  } catch (_) {}
};

window.loadSampleVideo = async function (camId, sampleName) {
  const modeLabel = document.getElementById(`current-mode-${camId.toLowerCase()}`);
  if (modeLabel) modeLabel.textContent = `Loading ${sampleName}...`;
  try {
    const res = await fetch(`/api/v1/cameras/${camId}/stream/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'video_file', source_url: sampleName })
    });
    const data = await res.json();
    if (modeLabel) modeLabel.textContent = `Active: MP4 Video (${sampleName})`;
    refreshStreamImage(camId);
    if (window.playAudioCue) window.playAudioCue('action');
  } catch (err) {
    console.error(`Failed to load sample video: ${err.message}`);
  }
};

window.uploadVideoFeed = async function (camId) {
  const fileInput = document.getElementById(`input-file-${camId}`);
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    alert("Please select a video file (.mp4) to ingest.");
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', file);

  const modeLabel = document.getElementById(`current-mode-${camId.toLowerCase()}`);
  if (modeLabel) modeLabel.textContent = `Uploading ${file.name}...`;

  try {
    const res = await fetch(`/api/v1/cameras/${camId}/stream/upload`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (modeLabel) modeLabel.textContent = `Active: MP4 Video (${file.name})`;
    refreshStreamImage(camId);
    if (window.playAudioCue) window.playAudioCue('action');
  } catch (err) {
    alert(`Video ingestion failed: ${err.message}`);
    if (modeLabel) modeLabel.textContent = `Upload failed for ${file.name}`;
  }
};

window.refreshStreamImage = function (camId) {
  const img = document.getElementById(`stream-img-${camId}`);
  if (img) {
    img.src = `/api/v1/cameras/${camId}/stream/live?t=${Date.now()}`;
  }
};

window.captureCameraSnapshot = async function (camId) {
  activeSnapshotCamera = camId;
  const modal = document.getElementById('snapshot-modal');
  const modalImg = document.getElementById('snapshot-modal-img');
  const modalCam = document.getElementById('snapshot-modal-cam');
  const title = document.getElementById('snapshot-modal-title');

  if (modalCam) modalCam.textContent = camId;
  if (title) title.textContent = `Live Camera Snapshot & ANPR Extract — ${camId}`;

  try {
    const res = await fetch(`/api/v1/cameras/${camId}/stream/snapshot?t=${Date.now()}`);
    if (!res.ok) throw new Error("Snapshot not available");
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    if (modalImg) modalImg.src = objectUrl;
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }
    if (window.playAudioCue) window.playAudioCue('tab');
  } catch (err) {
    alert(`Snapshot capture error: ${err.message}`);
  }
};

window.closeSnapshotModal = function () {
  const modal = document.getElementById('snapshot-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
};

window.locateSnapshotPlate = function () {
  const hudPlate = document.getElementById(`hud-${activeSnapshotCamera.toLowerCase()}-plate`);
  let plate = "WB02AK4921";
  if (hudPlate && hudPlate.textContent) {
    const match = hudPlate.textContent.match(/([A-Z0-9]{8,11})/);
    if (match) plate = match[1];
  }
  closeSnapshotModal();
  window.switchTab('tracking');
  if (window.queryPlate) {
    window.queryPlate(plate);
  } else {
    const input = document.getElementById('target-plate-input');
    if (input) input.value = plate;
    if (window.runTrajectorySearch) window.runTrajectorySearch();
  }
};

window.recognizedVehiclesFilter = 'ALL';
window.currentRecognizedVehicles = [];

window.setRecognizedVehiclesFilter = function (camId) {
  window.recognizedVehiclesFilter = camId;
  ['all', 'cam01', 'cam02'].forEach(id => {
    const btn = document.getElementById(`btn-filter-cam-${id}`);
    if (btn) {
      if ((id === 'all' && camId === 'ALL') || (id === 'cam01' && camId === 'CAM_01') || (id === 'cam02' && camId === 'CAM_02')) {
        btn.className = "px-2.5 py-1 rounded bg-cyan-600/40 text-cyan-300 font-bold border border-cyan-500/40 transition";
      } else {
        btn.className = "px-2.5 py-1 rounded text-gray-400 hover:text-white transition";
      }
    }
  });
  window.fetchCameraRecognizedVehicles(camId);
};

window.fetchCameraRecognizedVehicles = async function (camId = window.recognizedVehiclesFilter || 'ALL') {
  try {
    const res = await fetch(`/api/v1/cameras/${camId}/recognized_vehicles`);
    if (!res.ok) return;
    const data = await res.json();
    const vehicles = data.vehicles || [];
    window.currentRecognizedVehicles = vehicles;
    renderRecognizedVehiclesTable(vehicles);

    // Update Live Stream Telemetry KPI Strip
    const liveActiveCount = document.getElementById('telemetry-live-active-count');
    const liveAvgSpeed = document.getElementById('telemetry-live-avg-speed');
    const liveAvgConf = document.getElementById('telemetry-live-avg-conf');
    const liveLatestPlate = document.getElementById('telemetry-live-latest-plate');

    if (liveActiveCount) {
      liveActiveCount.textContent = `${vehicles.length} Vehicle${vehicles.length === 1 ? '' : 's'}`;
    }

    if (vehicles.length > 0) {
      const avgSpeed = (vehicles.reduce((acc, d) => acc + (d.speed_kmh || 0), 0) / vehicles.length).toFixed(1);
      if (liveAvgSpeed) liveAvgSpeed.textContent = `${avgSpeed} km/h`;
      const avgConf = Math.round((vehicles.reduce((acc, d) => acc + (d.confidence || 0.95), 0) / vehicles.length) * 100);
      if (liveAvgConf) liveAvgConf.textContent = `${avgConf}%`;
      if (liveLatestPlate) liveLatestPlate.textContent = vehicles[0].plate_text;
    } else {
      if (liveAvgSpeed) liveAvgSpeed.textContent = "0.0 km/h";
      if (liveAvgConf) liveAvgConf.textContent = "96.4%";
      if (liveLatestPlate) liveLatestPlate.textContent = "SCANNING...";
    }
  } catch (err) {
    console.warn("Error fetching recognized vehicles:", err);
  }
};

window.exportRecognizedVehiclesCSV = function () {
  const list = window.currentRecognizedVehicles || [];
  if (list.length === 0) {
    if (window.showToast) window.showToast("No recognized vehicles available to export yet", "warning");
    return;
  }

  const headers = ["Camera Node", "Timestamp", "License Plate", "Vehicle Class", "Body Color", "Speed (km/h)", "Lane", "OCR Confidence", "Verification Status"];
  const rows = list.map(v => [
    `"${v.camera_id || ''}"`,
    `"${v.timestamp || ''}"`,
    `"${v.plate_text || ''}"`,
    `"${v.vehicle_type || ''}"`,
    `"${v.vehicle_color || ''}"`,
    v.speed_kmh || 0,
    `"${v.lane || ''}"`,
    `${Math.round((v.confidence || 0.94) * 100)}%`,
    `"${v.status || 'VERIFIED'}"`
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `UrbanTwin_Recognized_Vehicles_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "_")}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (window.showToast) window.showToast(`Exported ${list.length} vehicles to CSV`, "success");
};

window.clearRecognizedVehiclesLog = async function () {
  const targetCam = window.recognizedVehiclesFilter || 'ALL';
  try {
    const res = await fetch(`/api/v1/cameras/${targetCam}/recognized_vehicles/clear`, { method: 'POST' });
    if (res.ok) {
      window.currentRecognizedVehicles = [];
      renderRecognizedVehiclesTable([]);
      const liveActiveCount = document.getElementById('telemetry-live-active-count');
      if (liveActiveCount) liveActiveCount.textContent = "0 Vehicles";
      if (window.showToast) window.showToast(`Recognized vehicles log cleared (${targetCam})`, "info");
    }
  } catch (err) {
    console.error("Failed to clear log:", err);
  }
};

window.loadStreamStatuses = async function () {
  try {
    const res = await fetch('/api/v1/cameras/streams/status');
    if (!res.ok) return;
    const statuses = await res.json();
    let totalPlates = 0;

    statuses.forEach(s => {
      totalPlates += s.plates_detected || 0;
      const camIdLower = s.camera_id.toLowerCase();
      
      const modeEl = document.getElementById(`telemetry-${camIdLower}-mode`);
      if (modeEl) {
        modeEl.innerHTML = `<span class="w-2 h-2 rounded-full ${s.status === 'ERROR' ? 'bg-rose-500' : 'bg-emerald-400'} animate-pulse"></span><span class="truncate">${s.mode.toUpperCase()} (${s.status})</span>`;
      }
      const fpsEl = document.getElementById(`telemetry-${camIdLower}-fps`);
      if (fpsEl) {
        fpsEl.textContent = `FPS: ${s.fps.toFixed(1)} • Frames: ${s.frames_processed}`;
      }

      const hudPlate = document.getElementById(`hud-${camIdLower}-plate`);
      if (hudPlate && s.latest_detections && s.latest_detections.length > 0) {
        const topDet = s.latest_detections[0];
        const spdStr = (topDet.speed_kmh && topDet.speed_kmh > 0) ? `${topDet.speed_kmh.toFixed(1)} km/h` : 'STATIONARY';
        hudPlate.textContent = `LATEST: ${topDet.plate_text} • ${spdStr} (${Math.round((topDet.confidence || 0.95)*100)}%)`;
      }
    });

    const totalPlatesEl = document.getElementById('telemetry-total-plates');
    if (totalPlatesEl) totalPlatesEl.textContent = `${totalPlates} Plates`;

    // Fetch the live recognized vehicles log
    await window.fetchCameraRecognizedVehicles();
  } catch (err) {
    console.warn("Error updating stream telemetry:", err);
  }
};

function getVehicleIcon(vType) {
  const t = (vType || '').toLowerCase();
  if (t.includes('bus')) return '<i class="fa-solid fa-bus text-amber-400 mr-1.5"></i>';
  if (t.includes('truck')) return '<i class="fa-solid fa-truck text-purple-400 mr-1.5"></i>';
  if (t.includes('motorcycle') || t.includes('two-wheeler') || t.includes('bike')) return '<i class="fa-solid fa-motorcycle text-emerald-400 mr-1.5"></i>';
  if (t.includes('taxi')) return '<i class="fa-solid fa-taxi text-yellow-400 mr-1.5"></i>';
  if (t.includes('suv')) return '<i class="fa-solid fa-car-side text-blue-400 mr-1.5"></i>';
  return '<i class="fa-solid fa-car text-cyan-400 mr-1.5"></i>';
}

let lastRenderedVehiclesFingerprint = "";

function renderRecognizedVehiclesTable(vehicles) {
  const tbody = document.getElementById('stream-detections-table-body');
  if (!tbody) return;

  if (!vehicles || vehicles.length === 0) {
    if (lastRenderedVehiclesFingerprint !== "EMPTY") {
      lastRenderedVehiclesFingerprint = "EMPTY";
      tbody.innerHTML = `<tr><td colspan="10" class="py-6 text-center text-gray-500 font-mono"><div class="flex flex-col items-center justify-center space-y-1"><i class="fa-solid fa-video text-cyan-500/40 text-lg mb-1 animate-pulse"></i><span>Awaiting live vehicle recognition &amp; ANPR lock...</span><span class="text-[10px] text-gray-600">Position vehicle or license plate in camera reticle</span></div></td></tr>`;
    }
    return;
  }

  // Fast change-detection fingerprint to avoid 250+ DOM node rebuilds when data hasn't changed
  const currentFingerprint = vehicles.slice(0, 10).map(v => `${v.plate_text}_${v.speed_kmh}_${v.status}`).join('|');
  if (currentFingerprint === lastRenderedVehiclesFingerprint) {
    return; // Unchanged data: skip expensive DOM re-render
  }
  lastRenderedVehiclesFingerprint = currentFingerprint;

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];

  const rowsHtml = vehicles.slice(0, 25).map(d => {
    const speedVal = d.speed_kmh || 0.0;
    const speedColor = speedVal > 55 ? 'text-rose-400 font-bold bg-rose-950/40 border-rose-500/30' : (speedVal > 25 ? 'text-emerald-400 font-semibold bg-emerald-950/40 border-emerald-500/30' : (speedVal > 0 ? 'text-cyan-400 font-semibold bg-cyan-950/40 border-cyan-500/30' : 'text-amber-400 font-normal bg-amber-950/30 border-amber-500/30'));
    const speedLabel = speedVal > 0 ? `${speedVal.toFixed(1)} km/h` : '0.0 km/h (Stationary)';
    const colorHex = d.color_hex || '#cbd5e1';
    const colorName = d.vehicle_color || 'Silver Metallic';
    const laneStr = d.lane || 'Lane 2 (Express Center)';
    const vType = d.vehicle_type || 'Sedan / Passenger Car';
    const vIcon = getVehicleIcon(vType);
    const confVal = Math.round((d.confidence || 0.94) * 100);
    const isVerified = (d.status === 'VERIFIED') || confVal >= 88;

    return `
    <tr class="hover:bg-cyan-950/25 transition border-b border-slate-800/60">
      <td class="py-2.5 px-3 font-bold text-cyan-400 flex items-center space-x-1.5 whitespace-nowrap">
        <span class="w-1.5 h-1.5 rounded-full ${d.camera_id === 'CAM_01' ? 'bg-cyan-400' : 'bg-purple-400'}"></span>
        <span>${d.camera_id || 'CAM_01'}</span>
      </td>
      <td class="py-2.5 px-3 text-gray-400 whitespace-nowrap">${d.timestamp || timeStr}</td>
      <td class="py-2.5 px-3 whitespace-nowrap">
        <div class="inline-flex items-center bg-slate-900 border border-slate-700/80 rounded overflow-hidden shadow-sm font-mono select-all">
          <div class="bg-blue-600 px-1 py-0.5 text-[8px] font-bold text-white flex flex-col items-center leading-none justify-center">
            <span>IND</span>
          </div>
          <div class="px-2 py-0.5 text-white font-bold tracking-wider text-xs bg-slate-950/90 font-mono">
            ${d.plate_text}
          </div>
        </div>
      </td>
      <td class="py-2.5 px-3 text-slate-300 font-sans font-semibold whitespace-nowrap">
        <div class="flex items-center">
          ${vIcon}
          <span>${vType}</span>
        </div>
      </td>
      <td class="py-2.5 px-3 whitespace-nowrap">
        <div class="flex items-center space-x-1.5">
          <span class="w-2.5 h-2.5 rounded-full border border-slate-700 shadow-sm shrink-0" style="background-color: ${colorHex}"></span>
          <span class="text-slate-300 text-[11px] truncate max-w-[120px]">${colorName}</span>
        </div>
      </td>
      <td class="py-2.5 px-3 whitespace-nowrap">
        <span class="px-2 py-0.5 rounded border text-[11px] font-mono ${speedColor}">${speedLabel}</span>
      </td>
      <td class="py-2.5 px-3 whitespace-nowrap">
        <span class="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-cyan-300 text-[10px] whitespace-nowrap">${laneStr}</span>
      </td>
      <td class="py-2.5 px-3 whitespace-nowrap">
        <div class="flex items-center space-x-2">
          <div class="w-12 bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div class="bg-gradient-to-r from-teal-400 to-emerald-400 h-1.5 rounded-full" style="width: ${confVal}%"></div>
          </div>
          <span class="text-emerald-400 font-bold text-[11px] font-mono">${confVal}%</span>
        </div>
      </td>
      <td class="py-2.5 px-3 whitespace-nowrap">
        <span class="px-2 py-0.5 rounded ${isVerified ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/40' : 'bg-cyan-950/80 text-cyan-300 border border-cyan-500/40'} text-[10px] font-bold font-mono">
          <i class="fa-solid ${isVerified ? 'fa-circle-check text-emerald-400' : 'fa-crosshairs text-cyan-400'} mr-1"></i>
          ${d.status || (isVerified ? 'VERIFIED' : 'ANPR LOCK')}
        </span>
      </td>
      <td class="py-2.5 px-3 text-right whitespace-nowrap">
        <button onclick="window.switchTab('tracking'); if(window.queryPlate) window.queryPlate('${d.plate_text}');" class="px-2.5 py-1 bg-cyan-600/30 hover:bg-cyan-600 text-cyan-300 hover:text-white border border-cyan-500/40 rounded transition text-[10px] font-bold whitespace-nowrap shadow-sm">
          <i class="fa-solid fa-crosshairs mr-1"></i>Track Route
        </button>
      </td>
    </tr>
  `}).join('');

  tbody.innerHTML = rowsHtml;
}

// Auto-poll stream status and recognized vehicles every 2500ms whenever streams tab is opened and document is visible
if (!streamPollingTimer) {
  streamPollingTimer = setInterval(() => {
    if (document.hidden) return;
    const streamsTab = document.getElementById('tab-streams');
    const isVisible = streamsTab && !streamsTab.classList.contains('hidden');
    if (isVisible || (typeof currentTab !== 'undefined' && currentTab === 'streams')) {
      window.loadStreamStatuses();
    }
  }, 2500);
}

// Initial status load
setTimeout(() => {
  if (window.loadStreamStatuses) window.loadStreamStatuses();
  if (window.initPhoneNetworkInfo) window.initPhoneNetworkInfo();
}, 400);

