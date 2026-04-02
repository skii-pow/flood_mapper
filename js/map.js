const DN_center = [16.0544, 108.2022];
const map = L.map("map", { zoomControl: true, minZoom: 10, maxZoom: 18 }).setView(DN_center, 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
}).addTo(map);

let isRecuseMode = false;
const rescueMarkersLayer = L.layerGroup().addTo(map);
const stationMarkersLayer = L.layerGroup().addTo(map);

// id → L.Marker  (never cleared after init)
const stationMarkersMap = new Map();
const rescueMarkersMap  = new Map();

// id → hash string  (detects which markers need updating)
const rescueDataCache  = new Map();
const stationDataCache = new Map(); // id → { flood_level, current_water_level, rise_rate, last_update }
const stationBaseCache = new Map(); // id → station CSV row (static: name, coords, thresholds)

const API_BASE_URL = window.location.origin;

// ─── Pure builder helpers (no network, no DOM side-effects) ──────────────────

function floodLevelToColor(level) {
    return { safe: '#2ecc71', caution: '#f1cf40', warning: '#e67e22', danger: '#e74c3c' }[level] || '#95a5a6';
}

function buildStationIcon(color, floodLevel) {
    return L.divIcon({
        className: `station-marker${floodLevel === 'danger' ? ' station-marker-danger' : ''}`,
        html: `<div style="background:${color};width:24px;height:24px;border-radius:50%;
                    border:3px solid white;box-shadow:0 0 15px ${color}80;
                    display:flex;align-items:center;justify-content:center;
                    font-weight:bold;color:white;font-size:14px;">📊</div>`,
        iconSize: [24, 24], iconAnchor: [12, 12]
    });
}

function buildStationPopupContent(station, details) {
    const waterLevel = details?.current_water_level;
    const floodLevel = details?.flood_level || 'unknown';
    const floodText  = {
        safe: '🟢 An toàn', caution: '🟡 Cảnh báo nhẹ',
        warning: '🟠 Cảnh báo', danger: '🔴 Nguy hiểm', unknown: '⚪ Chưa có dữ liệu'
    }[floodLevel] || '⚪ Chưa có dữ liệu';

    let html = `<div style="min-width:250px;">
        <b style="font-size:14px;">${station.name}</b><br/>
        <hr style="margin:8px 0;border-color:#ddd;"/>`;

    if (details && waterLevel != null) {
        const rr = details.rise_rate != null
            ? `${details.rise_rate > 0 ? '+' : ''}${parseFloat(details.rise_rate).toFixed(2)}`
            : 'N/A';
        html += `<strong>Mực nước hiện tại:</strong> ${parseFloat(waterLevel).toFixed(2)} cm<br/>
                 <strong>Tốc độ dâng:</strong> ${rr} cm/giờ<br/>
                 <strong>Mức độ ngập:</strong> ${floodText}<br/>
                 ${details.last_update ? `<strong>Cập nhật:</strong> ${new Date(details.last_update).toLocaleString('vi-VN')}<br/>` : ''}`;
    } else {
        html += `<div style="color:#95a5a6;font-size:12px;">Chưa có dữ liệu mực nước</div>`;
    }

    html += `<hr style="margin:8px 0;border-color:#ddd;"/>
             <div style="font-size:11px;color:#7f8c8d;">
               <strong>Ngưỡng:</strong><br/>
               An toàn: ${parseFloat(station.threshold_safe || 0).toFixed(0)} cm<br/>
               Cảnh báo: ${parseFloat(station.threshold_warning || 0).toFixed(0)} cm<br/>
               Nguy hiểm: ${parseFloat(station.threshold_danger || 0).toFixed(0)} cm
             </div></div>`;
    return html;
}

function buildStationSidebarItem(station, details) {
    const floodLevel = details?.flood_level || 'unknown';
    const waterLevel = details?.current_water_level;
    const color = floodLevelToColor(floodLevel);
    const text  = {
        safe: '🟢 An toàn', caution: '🟡 Cảnh báo nhẹ',
        warning: '🟠 Cảnh báo', danger: '🔴 Nguy hiểm', unknown: '⚪ Chưa có dữ liệu'
    }[floodLevel] || '⚪ Chưa có dữ liệu';
    return `<div id="station-item-${station.id}" class="station-item"
                 onclick="focusOnStation('${station.id}')"
                 style="padding:10px;margin-bottom:8px;background:rgba(0,0,0,0.2);border-radius:6px;
                        border-left:3px solid ${color};cursor:pointer;transition:all 0.2s;"
                 onmouseover="this.style.background='rgba(0,0,0,0.4)'"
                 onmouseout="this.style.background='rgba(0,0,0,0.2)'">
              <div style="font-weight:600;font-size:13px;margin-bottom:4px;">${station.name}</div>
              <div style="font-size:11px;color:#95a5a6;">
                ${waterLevel != null ? `Mực nước: ${parseFloat(waterLevel).toFixed(2)} cm` : 'Chưa có dữ liệu'}
              </div>
              <div style="font-size:11px;margin-top:4px;">${text}</div>
            </div>`;
}

function buildRescueIcon(point) {
    const isRescued = point.status === 'rescued';
    const isFire    = point.type === 'fire';
    const bg   = isRescued ? '#95a5a6' : (isFire ? '#e67e22' : '#e74c3c');
    const glow = isRescued ? 'rgba(149,165,166,0.8)' : (isFire ? 'rgba(230,126,34,0.8)' : 'rgba(231,76,60,0.8)');
    const sym  = isRescued ? '✓' : (isFire ? '🔥' : '!');
    return L.divIcon({
        className: 'rescue-marker',
        html: `<div style="background:${bg};width:30px;height:30px;border-radius:50%;
                    border:3px solid white;box-shadow:0 0 15px ${glow};
                    display:flex;align-items:center;justify-content:center;
                    font-weight:bold;color:white;font-size:${isFire ? '16px' : '18px'};">${sym}</div>`,
        iconSize: [30, 30], iconAnchor: [15, 15]
    });
}

function buildRescuePopupContent(point) {
    const isRescued   = point.status === 'rescued';
    const isFire      = point.type === 'fire';
    const urgencyText = { normal: '🟢 Bình thường', urgent: '🟡 Khẩn cấp', critical: '🔴 Rất khẩn cấp' }[point.urgency] || '🟢 Bình thường';
    const typeLabel   = isFire ? '🔥 Hỏa hoạn' : '🌊 Lũ lụt';
    return `<div style="min-width:250px;">
      <b>${isRescued ? '✓ Đã được cứu' : (isFire ? '🔥 Phát hiện hỏa hoạn!' : '🚨 Cần cứu hộ')}</b><br/>
      <hr style="margin:8px 0;border-color:#ddd;"/>
      <strong>📋 Loại:</strong> ${typeLabel}<br/>
      ${point.phone ? `<strong>📞 SĐT:</strong> ${point.phone}<br/>` : ''}
      ${point.people_count ? `<strong>👥 Số người:</strong> ${point.people_count}<br/>` : ''}
      <strong>⚠️ Mức độ:</strong> ${urgencyText}<br/>
      <strong>🕐 Thời gian:</strong> ${new Date(point.timestamp).toLocaleString('vi-VN')}<br/>
      ${point.notes ? `<hr style="margin:8px 0;border-color:#ddd;"/><strong>📝 Ghi chú:</strong><br/>${point.notes}<br/>` : ''}
      ${isRescued && point.rescuedAt ? `<hr style="margin:8px 0;border-color:#ddd;"/><strong>✓ Đã cứu lúc:</strong> ${new Date(point.rescuedAt).toLocaleString('vi-VN')}<br/>` : ''}
      ${!isRescued ? `<div style="margin-top:8px;color:${isFire ? '#e67e22' : '#e74c3c'};font-size:12px;">Chỉ đội cứu hộ mới có thể đánh dấu đã cứu</div>` : ''}
    </div>`;
}

// ─── Network helpers ──────────────────────────────────────────────────────────

async function laydiemSOS() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/rescue-points`);
        if (!res.ok) throw new Error('Lỗi khi tải dữ liệu');
        return await res.json();
    } catch (error) { console.error('Lỗi:', error); return []; }
}

async function saveRescuePoint(point) {
    const res = await fetch(`${API_BASE_URL}/api/rescue-points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            lat: point.lat, lng: point.lng,
            phone: point.phone || '', people_count: point.people_count || '',
            urgency: point.urgency || 'normal', notes: point.notes || ''
        })
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Lỗi khi lưu dữ liệu'); }
    return res.json();
}

async function xoaDiemSOS(id) {
    const res = await fetch(`${API_BASE_URL}/api/rescue-points/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Lỗi khi xóa');
    return res.json();
}

async function getStations() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/stations`);
        if (!res.ok) throw new Error();
        return res.json();
    } catch { return []; }
}

async function notiSta(stationId) {
    try {
        const res = await fetch(`${API_BASE_URL}/api/stations/${stationId}`);
        if (!res.ok) throw new Error();
        return res.json();
    } catch { return null; }
}

// ─── Rescue points: diff-and-patch (no clearLayers, no full redraw) ───────────
// First call: rescueMarkersMap is empty → all points treated as "new" → markers created.
// Subsequent calls: only add/update/remove markers that actually changed.

async function hienThiDiemSOS() {
    const points = await laydiemSOS();

    // Update badge counter
    const activeCount = points.filter(p => p.status !== 'rescued').length;
    const countDiv = document.getElementById('rescue-count');
    if (countDiv) {
        countDiv.textContent = `Có ${activeCount} điểm cần cứu hộ`;
        countDiv.style.color = activeCount > 0 ? '#e74c3c' : '#2ecc71';
    }

    // 1. Remove markers for points that no longer exist on the server
    const serverIds = new Set(points.map(p => p.id));
    for (const [id, marker] of rescueMarkersMap) {
        if (!serverIds.has(id)) {
            rescueMarkersLayer.removeLayer(marker);
            rescueMarkersMap.delete(id);
            rescueDataCache.delete(id);
        }
    }

    // 2. Add new markers; patch changed markers in-place
    for (const point of points) {
        const hash = JSON.stringify({ status: point.status, notes: point.notes, urgency: point.urgency, rescuedAt: point.rescuedAt });

        if (!rescueMarkersMap.has(point.id)) {
            // New point
            const marker = L.marker([parseFloat(point.lat), parseFloat(point.lng)], { icon: buildRescueIcon(point) });
            marker.bindPopup(buildRescuePopupContent(point));
            marker.addTo(rescueMarkersLayer);
            rescueMarkersMap.set(point.id, marker);
            rescueDataCache.set(point.id, hash);
        } else if (rescueDataCache.get(point.id) !== hash) {
            // Changed: patch icon + popup without touching other markers or closing open popups
            const marker = rescueMarkersMap.get(point.id);
            marker.setIcon(buildRescueIcon(point));
            marker.setPopupContent(buildRescuePopupContent(point));
            rescueDataCache.set(point.id, hash);
        }
        // Unchanged → skip entirely
    }

    capnhatDsSOS();
}

// ─── Stations: initial full load ─────────────────────────────────────────────

async function loadStations() {
    stationMarkersLayer.clearLayers();
    stationMarkersMap.clear();
    stationBaseCache.clear();
    stationDataCache.clear();

    const stations = await getStations();
    for (const station of stations) {
        stationBaseCache.set(station.id, station);
        const details = await notiSta(station.id);
        if (details) {
            stationDataCache.set(station.id, {
                flood_level:         details.flood_level,
                current_water_level: details.current_water_level,
                rise_rate:           details.rise_rate,
                last_update:         details.last_update
            });
        }
        const color  = floodLevelToColor(details?.flood_level);
        const marker = L.marker(
            [parseFloat(station.location_lat), parseFloat(station.location_lng)],
            { icon: buildStationIcon(color, details?.flood_level) }
        );
        marker.bindPopup(buildStationPopupContent(station, details));
        marker.addTo(stationMarkersLayer);
        stationMarkersMap.set(station.id, marker);
    }
    capnhatDsSOS(stations);
}

// ─── Stations: surgical patch — only changed stations ────────────────────────
// Called on every summary poll instead of loadStations().
// For each station that changed: fetches its detail once, patches icon + popup + sidebar item.

async function updateStations(summary) {
    for (const s of summary) {
        const cached  = stationDataCache.get(s.id);
        const changed = !cached
            || cached.current_water_level !== s.current_water_level
            || cached.flood_level         !== s.flood_level
            || cached.last_update         !== s.last_update;
        if (!changed) continue;

        const details = await notiSta(s.id);
        if (!details) continue;

        stationDataCache.set(s.id, {
            flood_level:         details.flood_level,
            current_water_level: details.current_water_level,
            rise_rate:           details.rise_rate,
            last_update:         details.last_update
        });

        // Patch marker: setIcon + setPopupContent keeps popup open if user has it open
        const marker  = stationMarkersMap.get(s.id);
        const station = stationBaseCache.get(s.id);
        if (marker && station) {
            const color = floodLevelToColor(details.flood_level);
            marker.setIcon(buildStationIcon(color, details.flood_level));
            marker.setPopupContent(buildStationPopupContent(station, details));
        }

        // Patch only this station's sidebar item in-place
        const el = document.getElementById(`station-item-${s.id}`);
        if (el && station) {
            el.outerHTML = buildStationSidebarItem(station, stationDataCache.get(s.id));
        }
    }
}

// ─── Station sidebar: built from in-memory cache (zero API calls) ─────────────

function capnhatDsSOS(stations) {
    const listDiv = document.getElementById('stations-list');
    if (!listDiv) return;
    const src = stations || Array.from(stationBaseCache.values());
    if (src.length === 0) {
        listDiv.innerHTML = '<div style="color:#95a5a6;font-size:12px;text-align:center;padding:8px;">Chưa có trạm nào</div>';
        return;
    }
    listDiv.innerHTML = src.map(station =>
        buildStationSidebarItem(station, stationDataCache.get(station.id))
    ).join('');
}

// ─── Map click ────────────────────────────────────────────────────────────────

let clickedLocation = null;
map.on('click', function(e) {
    if (!isRecuseMode) return;
    clickedLocation = { lat: e.latlng.lat, lng: e.latlng.lng };
    openRescueModal();
});

// ─── Startup ─────────────────────────────────────────────────────────────────

window.focusOnStation = function(stationId) {
    const marker = stationMarkersMap.get(stationId);
    if (marker) { map.setView(marker.getLatLng(), 15); marker.openPopup(); }
};

hienThiDiemSOS();
loadStations();

// Rescue points: poll every 2 s — diff-aware, no redraw unless data changed
let lastRescuePointHash = '';
setInterval(async function() {
    try {
        const points = await laydiemSOS();
        const hash = JSON.stringify(points.map(p => ({ id: p.id, status: p.status, rescuedAt: p.rescuedAt })));
        if (hash !== lastRescuePointHash) {
            lastRescuePointHash = hash;
            await hienThiDiemSOS();
        }
    } catch (error) { console.error('Lỗi khi kiểm tra cập nhật điểm cứu hộ:', error); }
}, 2000);

// Stations: poll every 3 s — only patch markers/sidebar for changed stations
let lastStationHash = '';
setInterval(async function() {
    try {
        const res     = await fetch(`${API_BASE_URL}/api/stations/summary`);
        const summary = await res.json();
        const hash    = JSON.stringify(summary.map(s => ({ id: s.id, level: s.current_water_level, ts: s.last_update })));
        if (hash !== lastStationHash) {
            lastStationHash = hash;
            await updateStations(summary);
        }
    } catch (error) { console.error('Lỗi khi kiểm tra cập nhật trạm:', error); }
}, 3000);

// ─── Global action handlers ───────────────────────────────────────────────────

window.toggleRescueMode = function() {
    isRecuseMode = !isRecuseMode;
    const btn  = document.getElementById('rescue-toggle-btn');
    const info = document.getElementById('rescue-info');
    if (isRecuseMode) {
        btn.textContent = 'Tắt phát tín hiệu';
        btn.style.background = '#e74c3c';
        if (info) { info.textContent = 'Click vào bản đồ để đặt điểm cần cứu hộ'; info.style.color = '#e74c3c'; }
        map.getContainer().style.cursor = 'crosshair';
    } else {
        btn.textContent = 'Phát tín hiệu cần cứu';
        btn.style.background = '#e74c3c';
        if (info) { info.textContent = 'Nhấn nút để bật chế độ phát tín hiệu cần cứu'; info.style.color = '#95a5a6'; }
        map.getContainer().style.cursor = '';
    }
};

window.deleteRescuePoint = async function(id) {
    if (confirm('Bạn có chắc muốn xóa điểm này?')) {
        try { await xoaDiemSOS(id); await hienThiDiemSOS(); }
        catch { alert('Không thể xóa điểm. Vui lòng thử lại.'); }
    }
};

window.openRescueModal = function() {
    const modal = document.getElementById('rescue-modal');
    if (modal && clickedLocation) { modal.style.display = 'block'; document.getElementById('rescue-form').reset(); }
};

window.closeRescueModal = function() {
    const modal = document.getElementById('rescue-modal');
    if (modal) { modal.style.display = 'none'; clickedLocation = null; }
};

window.submitRescueForm = async function(event) {
    event.preventDefault();
    if (!clickedLocation) { alert('Vui lòng chọn vị trí trên bản đồ'); return; }
    const phone       = document.getElementById('rescue-phone').value.trim();
    const peopleCount = document.getElementById('rescue-people').value;
    const urgency     = document.getElementById('rescue-urgency').value;
    const notes       = document.getElementById('rescue-notes').value.trim();
    if (!phone) { alert('Vui lòng nhập số điện thoại'); return; }
    try {
        await saveRescuePoint({ lat: clickedLocation.lat, lng: clickedLocation.lng, phone, people_count: peopleCount || '', urgency, notes });
        await hienThiDiemSOS();
        closeRescueModal();
        const msg = document.createElement('div');
        msg.textContent = '✅ Đã phát tín hiệu cần cứu hộ thành công!';
        msg.style.cssText = 'position:fixed;top:20px;right:20px;background:#2ecc71;color:white;padding:15px 20px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:10000;font-weight:600;';
        document.body.appendChild(msg);
        setTimeout(() => msg.remove(), 3000);
    } catch (error) { alert('Không thể lưu điểm cứu hộ: ' + error.message); }
};

window.onclick = function(event) {
    const modal = document.getElementById('rescue-modal');
    if (event.target === modal) closeRescueModal();
};
