const DN_center = [16.0544, 108.2022];
const map = L.map("map", { zoomControl: true, minZoom: 10, maxZoom: 18 }).setView(DN_center, 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
}).addTo(map);

const rescueMarkersLayer  = L.layerGroup().addTo(map);
const stationMarkersLayer = L.layerGroup().addTo(map);

// id → L.Marker  (never cleared after init)
const stationMarkersMap = new Map();
const rescueMarkersMap  = new Map();

// id → hash string  (detects which markers need updating)
const rescueDataCache  = new Map();
const stationDataCache = new Map(); // id → { flood_level, current_water_level, rise_rate, last_update }
const stationBaseCache = new Map(); // id → station CSV row (static)

const API_BASE_URL = window.location.origin;

let allDiem         = [];
let allRescuePoints = [];

// ─── Pure builder helpers ─────────────────────────────────────────────────────

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
    let color = '#95a5a6';
    if (!isRescued) {
        color = isFire
            ? '#e67e22'
            : ({ critical: '#e74c3c', urgent: '#f1c40f', normal: '#2ecc71' }[point.urgency] || '#e74c3c');
    }
    const sym = isRescued ? '✓' : (isFire ? '🔥' : '!');
    const sz  = isRescued ? 28 : 32;
    const fs  = isRescued ? '16' : (isFire ? '14' : '18');
    return L.divIcon({
        className: 'rescue-marker',
        html: `<div style="background:${color};width:${sz}px;height:${sz}px;border-radius:50%;
                    border:3px solid white;box-shadow:0 0 15px ${color}80;
                    display:flex;align-items:center;justify-content:center;
                    font-weight:bold;color:white;font-size:${fs}px;">${sym}</div>`,
        iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2]
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
      <div style="margin-top:12px;">
        ${!isRescued ? `<button onclick="markAsRescued('${point.id}')" style="background:#2ecc71;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;margin-right:5px;font-weight:600;">✓ Đánh dấu đã cứu</button>` : ''}
        <button onclick="deleteRescuePoint('${point.id}')" style="background:#e74c3c;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-weight:600;">🗑️ Xóa</button>
      </div>
    </div>`;
}

// ─── Network helpers ──────────────────────────────────────────────────────────

async function laydiemSOS() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/rescue-points`);
        if (!res.ok) throw new Error();
        return res.json();
    } catch (error) { console.error('Lỗi:', error); return []; }
}

async function xoaDiemSOS(id) {
    const res = await fetch(`${API_BASE_URL}/api/rescue-points/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Lỗi khi xóa');
    return res.json();
}

async function danhDauDaCuu(id) {
    const res = await fetch(`${API_BASE_URL}/api/rescue-points/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rescued' })
    });
    if (!res.ok) throw new Error('Lỗi khi cập nhật');
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

async function xoaAll() {
    const rescued = allRescuePoints.filter(p => p.status === 'rescued');
    for (const p of rescued) await xoaDiemSOS(p.id);
}

// ─── Rescue points: diff-and-patch ───────────────────────────────────────────

async function hienThiDiemSOS() {
    try {
        const points = await laydiemSOS();
        allDiem         = points;
        allRescuePoints = points;

        // Remove markers for deleted points
        const serverIds = new Set(points.map(p => p.id));
        for (const [id, marker] of rescueMarkersMap) {
            if (!serverIds.has(id)) {
                rescueMarkersLayer.removeLayer(marker);
                rescueMarkersMap.delete(id);
                rescueDataCache.delete(id);
            }
        }

        // Add new markers; patch changed ones in-place (popup stays open)
        for (const point of points) {
            const hash = JSON.stringify({ status: point.status, notes: point.notes, urgency: point.urgency, rescuedAt: point.rescuedAt });
            if (!rescueMarkersMap.has(point.id)) {
                const marker = L.marker([parseFloat(point.lat), parseFloat(point.lng)], { icon: buildRescueIcon(point) });
                marker.bindPopup(buildRescuePopupContent(point));
                marker.addTo(rescueMarkersLayer);
                rescueMarkersMap.set(point.id, marker);
                rescueDataCache.set(point.id, hash);
            } else if (rescueDataCache.get(point.id) !== hash) {
                const marker = rescueMarkersMap.get(point.id);
                marker.setIcon(buildRescueIcon(point));
                marker.setPopupContent(buildRescuePopupContent(point));
                rescueDataCache.set(point.id, hash);
            }
            // Unchanged → skip
        }

        capnhatDsCanSOS();
        updateRescueCountWithFilter();
    } catch (error) {
        console.error('Error loading rescue points:', error);
    }
}

// ─── Rescue sidebar (reads from allRescuePoints — zero API calls) ─────────────

function updateRescueCountWithFilter() {
    const searchTerm    = (document.getElementById('search-input')?.value || '').toLowerCase();
    const filterStatus  = document.getElementById('filter-status')?.value || 'all';
    const filterUrgency = document.getElementById('filter-urgency')?.value || 'all';

    const filtered = allRescuePoints.filter(p => {
        if (filterStatus === 'active'  && p.status === 'rescued') return false;
        if (filterStatus === 'rescued' && p.status !== 'rescued') return false;
        if (filterUrgency !== 'all'    && p.urgency !== filterUrgency) return false;
        if (searchTerm) {
            const hay = [p.phone || '', p.notes || '', p.people_count || ''].join(' ').toLowerCase();
            if (!hay.includes(searchTerm)) return false;
        }
        return true;
    });

    const activeCount = filtered.filter(p => p.status !== 'rescued').length;
    const countDiv    = document.getElementById('rescue-count');
    if (countDiv) {
        countDiv.innerHTML = `
          <div style="font-size:14px;margin-bottom:4px;">
            <strong style="color:#e74c3c;">${activeCount}</strong> điểm cần cứu hộ
            ${searchTerm || filterStatus !== 'all' || filterUrgency !== 'all' ? ` (${filtered.length} kết quả)` : ''}
          </div>
          <div style="font-size:12px;color:#95a5a6;">
            Tổng: ${allRescuePoints.length} điểm (${allRescuePoints.filter(p => p.status === 'rescued').length} đã cứu)
          </div>`;
    }
}

function capnhatDsCanSOS() {
    const listDiv = document.getElementById('rescue-list');
    if (!listDiv) { console.warn('rescue-list element not found'); return; }

    const searchTerm    = (document.getElementById('search-input')?.value || '').toLowerCase();
    const filterStatus  = document.getElementById('filter-status')?.value || 'all';
    const filterUrgency = document.getElementById('filter-urgency')?.value || 'all';

    const filtered = allRescuePoints.filter(p => {
        if (filterStatus === 'active'  && p.status === 'rescued') return false;
        if (filterStatus === 'rescued' && p.status !== 'rescued') return false;
        if (filterUrgency !== 'all'    && p.urgency !== filterUrgency) return false;
        if (searchTerm) {
            const hay = [p.phone || '', p.notes || '', p.people_count || ''].join(' ').toLowerCase();
            if (!hay.includes(searchTerm)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        listDiv.innerHTML = '<div style="text-align:center;color:#95a5a6;padding:20px;">Không tìm thấy điểm nào</div>';
        return;
    }

    listDiv.innerHTML = filtered.map(point => {
        const isRescued    = point.status === 'rescued';
        const isFire       = point.type === 'fire';
        const urgencyEmoji = { normal: '🟢', urgent: '🟡', critical: '🔴' }[point.urgency] || '🟢';
        const urgencyColor = isRescued ? '#95a5a6' : (isFire ? '#e67e22' : ({ normal: '#2ecc71', urgent: '#f1c40f', critical: '#e74c3c' }[point.urgency] || '#95a5a6'));
        const statusLabel  = isRescued ? '✓ Đã cứu' : (isFire ? '🔥 Hỏa hoạn' : '🚨 Cần cứu');
        const typeLabel    = isFire ? '🔥 Hỏa hoạn' : '🌊 Lũ lụt';
        return `
          <div class="rescue-item ${isRescued ? 'rescued' : ''}" onclick="focusOnPoint('${point.id}')" style="border-left-color:${urgencyColor};">
            <div class="rescue-item-header">
              <span class="status-badge ${isRescued ? 'status-rescued' : 'status-active'}" style="${isFire && !isRescued ? 'background:#e67e22;' : ''}">
                ${statusLabel}
              </span>
              <span class="rescue-item-time">${new Date(point.timestamp).toLocaleString('vi-VN')}</span>
            </div>
            <div class="rescue-item-details" style="font-size:12px;color:#95a5a6;margin-top:4px;">
              <strong style="color:${urgencyColor};">${typeLabel}</strong>
              ${point.phone ? ` • <strong style="color:#ecf0f1;">📞</strong> ${point.phone}` : ''}
              ${point.people_count ? ` • <strong style="color:#ecf0f1;">👥</strong> ${point.people_count} người` : ''}
              ${!isFire ? ` • <span style="color:${urgencyColor};">${urgencyEmoji}</span>
                <span style="color:${urgencyColor};font-weight:600;">
                  ${point.urgency === 'normal' ? 'Bình thường' : point.urgency === 'urgent' ? 'Khẩn cấp' : 'Rất khẩn cấp'}
                </span>` : ''}
            </div>
            ${point.notes ? `<div class="rescue-item-notes" style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);">${point.notes}</div>` : ''}
          </div>`;
    }).join('');
}

window.filterRescueList = function() {
    capnhatDsCanSOS();
    updateRescueCountWithFilter();
};

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
    capnhatDsTram(stations);
}

// ─── Stations: surgical patch ─────────────────────────────────────────────────

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

        const marker  = stationMarkersMap.get(s.id);
        const station = stationBaseCache.get(s.id);
        if (marker && station) {
            const color = floodLevelToColor(details.flood_level);
            marker.setIcon(buildStationIcon(color, details.flood_level));
            marker.setPopupContent(buildStationPopupContent(station, details));
        }

        const el = document.getElementById(`station-item-${s.id}`);
        if (el && station) {
            el.outerHTML = buildStationSidebarItem(station, stationDataCache.get(s.id));
        }
    }
}

// ─── Station sidebar ─────────────────────────────────────────────────────────

function capnhatDsTram(stations) {
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

// ─── Focus helpers — O(1) via Map lookup ──────────────────────────────────────

window.focusOnPoint = function(id) {
    const point  = allRescuePoints.find(p => p.id === id);
    const marker = rescueMarkersMap.get(id);
    if (point && marker) {
        map.setView([parseFloat(point.lat), parseFloat(point.lng)], map.getZoom(), { animate: true });
        marker.openPopup();
    }
};

window.focusOnStation = function(stationId) {
    const marker = stationMarkersMap.get(stationId);
    if (marker) { map.setView(marker.getLatLng(), 15); marker.openPopup(); }
};

// ─── Startup ─────────────────────────────────────────────────────────────────

hienThiDiemSOS();
loadStations();

// Rescue points: poll every 2 s — diff-aware
let lastRescuePointHash = '';
setInterval(async function() {
    try {
        const points = await laydiemSOS();
        const hash = JSON.stringify(points.map(p => ({ id: p.id, status: p.status, rescuedAt: p.rescuedAt })));
        if (hash !== lastRescuePointHash) {
            lastRescuePointHash = hash;
            await hienThiDiemSOS();
        }
    } catch (error) { console.error('Lỗi khi kiểm tra cập nhật:', error); }
}, 2000);

// Stations: poll every 3 s — only patch changed stations
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

window.markAsRescued = async function(id) {
    try {
        await danhDauDaCuu(id);
        await hienThiDiemSOS();
        map.closePopup();
    } catch { alert('Không thể đánh dấu đã cứu. Vui lòng thử lại.'); }
};

window.deleteRescuePoint = async function(id) {
    if (confirm('Bạn có chắc muốn xóa điểm này?')) {
        try { await xoaDiemSOS(id); await hienThiDiemSOS(); }
        catch { alert('Không thể xóa điểm. Vui lòng thử lại.'); }
    }
};

window.clearAllRescued = async function() {
    if (confirm('Bạn có chắc chắn muốn xóa điểm đã được cứu?')) {
        try {
            await xoaAll();
            await hienThiDiemSOS();
            alert('Đã xóa điểm đã được cứu thành công!');
        } catch (error) {
            console.error('Error:', error);
            alert('Không thể xóa điểm. Vui lòng thử lại.');
        }
    }
};
