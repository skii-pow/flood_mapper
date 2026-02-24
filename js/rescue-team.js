const DN_center=[16.0544, 108.2022];
const map= L.map("map", {
    zoomControl: true,
    minZoom: 10,
    maxZoom: 18
}).setView(DN_center, 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

let rescueMarkersLayer=L.layerGroup().addTo(map);
let stationMarkersLayer= L.layerGroup().addTo(map);
const stationMarkersMap = new Map();
const API_BASE_URL= window.location.origin;
// Lấy ds điểm cần cứu hộ
async function laydiemSOS() {
    try{
        const response= await fetch(`${API_BASE_URL}/api/rescue-points`);
        if (!response.ok) throw new Error('Lỗi khi tải dữ liệu');
        return await response.json();
    }catch (error){
        console.error('Lỗi:', error);
        return [];
    };
    }
    
// Xóa điểm cần cứu hộ
async function xoaDiemSOS(id){
    try{
        const response = await fetch(`${API_BASE_URL}/api/rescue-points/${id}`,{
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Lỗi khi xóa');
        return await response.json();
    } catch (error){
        console.error('Lỗi:', error);
        throw error;
    }
}
// Đánh dấu điểm đã dc cứu
async function danhDauDaCuu(id) {
    try{
        const response=await fetch(`${API_BASE_URL}/api/rescue-points/${id}`,{
            method: 'PUT',
            headers:{
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({status:'rescued'})
        });
        if(!response.ok) throw new Error('Lỗi khi cập nhật');
        return await response.json();
    }catch(error){
    console.error('Lỗi:', error);
    throw error;
    }
}
// Lấy ds trạm đo mực nước
async function getStations() {
    try{
        const response = await fetch (`${API_BASE_URL}/api/stations`);
        if (!response.ok) throw new Error('Lỗi khi tải dữ liệu');
        return await response.json();
    } catch (error){
        console.error('Lỗi:', error);
        return [];
    }
}
// Lấy thông tin chi tiết trạm
async function notiSta(stationId) {
    try{
        const response = await fetch (`${API_BASE_URL}/api/stations/${stationId}`);
        if (!response.ok) throw new Error('Lỗi khi tải dữ liệu');
        return await response.json();
    } catch (error){
        console.error('Lỗi:', error);
        return null;
    }
}
// Xóa tất cả điểm đã cứu
async function xoaAll() {
    try{
        const points=await laydiemSOS();
      // Xóa từng điểm đã cứu
        const rescuedPoints=points.filter(p=>p.status==='rescued');
        for (const point of rescuedPoints){
            await xoaDiemSOS(point.id);
        }
        return true;
    }catch(error){
        console.error('lỗi khi xóa điểm đã cứu:', error);
        throw error;
    }
}
let allDiem=[];
let allRescuePoints=[];
// Hiển thị các điểm cần cứu
async function hienThiDiemSOS() {
    try{
        rescueMarkersLayer.clearLayers();
        const points=await laydiemSOS();
        allDiem=points;
        allRescuePoints=points;
        points.sort((a, b)=>{
            if (a.status==='rescued' && b.status!=='rescued') return 1;
            if (b.status==='rescued' && a.status!=='rescued') return -1;

            const urgencyOder={'critical':3, 'urgent':2, 'normal':1};
            const aUrgency=urgencyOder[a.urgency]||1;
            const bUrgency=urgencyOder[b.urgency]||1;
            if(aUrgency!==bUrgency) return bUrgency-aUrgency;

            return new Date(b.timestamp)-new Date(a.timestamp);
        });
        points.forEach(point => {
        const isRecused=point.status==='rescued';

        let markerColor ='#95a5a6';
        if (!isRecused){
            switch (point.urgency){
                case 'critical':
                    markerColor='#e74c3c';
                    break;
                case 'urgent':
                    markerColor='#f1c40f'
                    break;
                case 'normal':
                    markerColor='#2ecc71';
                    break;
                default:
                    markerColor='#e74c3c';
            }
        }
        const icon = L.divIcon({
        className: 'rescue-marker',
        html: `
          <div style="
            background: ${markerColor};
            width: ${isRecused ? '28' : '32'}px;
            height: ${isRecused ? '28' : '32'}px;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 0 15px ${markerColor}80;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            color: white;
            font-size: ${isRecused ? '16' : '18'}px;
          ">${isRecused ? '✓' : '!'}</div>
        `,
        iconSize: [isRecused ? 28 : 32, isRecused ? 28 : 32],
        iconAnchor: [isRecused ? 14 : 16, isRecused ? 14 : 16]
      });

      const marker = L.marker([parseFloat(point.lat), parseFloat(point.lng)], { icon });
        const urgencyText = {
            'normal': '🟢 Bình thường',
            'urgent': '🟡 Khẩn cấp',
            'critical': '🔴 Rất khẩn cấp'
        }[point.urgency] || '🟢 Bình thường';
        
        const popupContent = `
        <div style="min-width: 250px;">
          <b>${isRecused ? '✓ Đã được cứu' : '🚨 Cần cứu hộ'}</b><br/>
          <hr style="margin: 8px 0; border-color: #ddd;"/>
          ${point.phone ? `<strong>📞 SĐT:</strong> ${point.phone}<br/>` : ''}
          ${point.people_count ? `<strong>👥 Số người:</strong> ${point.people_count}<br/>` : ''}
          <strong>⚠️ Mức độ:</strong> ${urgencyText}<br/>
          <strong>🕐 Thời gian:</strong> ${new Date(point.timestamp).toLocaleString('vi-VN')}<br/>
          ${point.notes ? `<hr style="margin: 8px 0; border-color: #ddd;"/><strong>📝 Ghi chú:</strong><br/>${point.notes}<br/>` : ''}
          ${isRecused && point.rescuedAt ? `<hr style="margin: 8px 0; border-color: #ddd;"/><strong>✓ Đã cứu lúc:</strong> ${new Date(point.rescuedAt).toLocaleString('vi-VN')}<br/>` : ''}
          <div style="margin-top: 12px;">
            ${!isRecused ? `<button onclick="markAsRescued('${point.id}')" style="
              background: #2ecc71;
              color: white;
              border: none;
              padding: 8px 16px;
              border-radius: 4px;
              cursor: pointer;
              margin-right: 5px;
              font-weight: 600;
            ">✓ Đánh dấu đã cứu</button>` : ''}
            <button onclick="deleteRescuePoint('${point.id}')" style="
              background: #e74c3c;
              color: white;
              border: none;
              padding: 8px 16px;
              border-radius: 4px;
              cursor: pointer;
              font-weight: 600;
            ">🗑️ Xóa</button>
          </div>
        </div>
      `;
        
        marker.bindPopup(popupContent);
        marker.addTo(rescueMarkersLayer);
        });
        capnhatDsCanSOS();
        capNhatSlSOS();
    }catch(error){
        console.error('Error loading rescue points:', error);
    }
}
// Cập nhật số lượng qua filter
function updateRescueCountWithFilter() {
    const searchTerm = (document.getElementById('search-input')?.value || '').toLowerCase();
    const filterStatus = document.getElementById('filter-status')?.value || 'all';
    const filterUrgency = document.getElementById('filter-urgency')?.value || 'all';

    let filteredPoints = allRescuePoints.filter(point => {
      if (filterStatus === 'active' && point.status === 'rescued') return false;
      if (filterStatus === 'rescued' && point.status !== 'rescued') return false;
      if (filterUrgency !== 'all' && point.urgency !== filterUrgency) return false;
      if (searchTerm) {
        const searchIn = [
          point.phone || '',
          point.notes || '',
          point.people_count || ''
        ].join(' ').toLowerCase();
        if (!searchIn.includes(searchTerm)) return false;
      }
      return true;
    });

    const activeCount = filteredPoints.filter(p => p.status !== 'rescued').length;
    const totalCount = filteredPoints.length;
    const countDiv = document.getElementById('rescue-count');
    if (countDiv) {
      countDiv.innerHTML = `
        <div style="font-size: 14px; margin-bottom: 4px;">
          <strong style="color: #e74c3c;">${activeCount}</strong> điểm cần cứu hộ
          ${searchTerm || filterStatus !== 'all' || filterUrgency !== 'all' ? ` (${totalCount} kết quả)` : ''}
        </div>
        <div style="font-size: 12px; color: #95a5a6;">
          Tổng: ${allRescuePoints.length} điểm (${allRescuePoints.filter(p => p.status === 'rescued').length} đã cứu)
        </div>
      `;
    }
  }
// Cập nhật danh sách điểm cần cứu
  function capnhatDsCanSOS(){
    const listDiv = document.getElementById('rescue-list');
    if(!listDiv){
        console.warn('rescue-list element not found');
        return;
    }
    const searchTerm = (document.getElementById('search-input')?.value || '').toLowerCase();
    const filterStatus = document.getElementById('filter-status')?.value || 'all';
    const filterUrgency = document.getElementById('filter-urgency')?.value || 'all';

    let filteredPoints = allRescuePoints.filter(point => {
      // Filter theo status
      if (filterStatus === 'active' && point.status === 'rescued') return false;
      if (filterStatus === 'rescued' && point.status !== 'rescued') return false;
      
      // Filter theo urgency
      if (filterUrgency !== 'all' && point.urgency !== filterUrgency) return false;
      
      // Filter theo search term
      if (searchTerm) {
        const searchIn = [
          point.phone || '',
          point.notes || '',
          point.people_count || ''
        ].join(' ').toLowerCase();
        if (!searchIn.includes(searchTerm)) return false;
      }
      
      return true;
    });
    if (filteredPoints.length === 0) {
      listDiv.innerHTML = '<div style="text-align: center; color: #95a5a6; padding: 20px;">Không tìm thấy điểm nào</div>';
      return;
    }

    listDiv.innerHTML = filteredPoints.map(point => {
      const isRescued = point.status === 'rescued';
      const urgencyText = {
        'normal': '🟢',
        'urgent': '🟡',
        'critical': '🔴'
      }[point.urgency] || '🟢';
      
      const urgencyColor = {
        'normal': '#2ecc71',
        'urgent': '#f1c40f',
        'critical': '#e74c3c'
      }[point.urgency] || '#95a5a6';
      
      return `
        <div class="rescue-item ${isRescued ? 'rescued' : ''}" onclick="focusOnPoint('${point.id}')" style="
          border-left-color: ${isRescued ? '#95a5a6' : urgencyColor};
        ">
          <div class="rescue-item-header">
            <span class="status-badge ${isRescued ? 'status-rescued' : 'status-active'}">
              ${isRescued ? '✓ Đã cứu' : '🚨 Cần cứu'}
            </span>
            <span class="rescue-item-time">${new Date(point.timestamp).toLocaleString('vi-VN')}</span>
          </div>
          <div class="rescue-item-details" style="font-size: 12px; color: #95a5a6; margin-top: 4px;">
            ${point.phone ? `<strong style="color: #ecf0f1;">📞</strong> ${point.phone}` : ''}
            ${point.phone && point.people_count ? ' • ' : ''}
            ${point.people_count ? `<strong style="color: #ecf0f1;">👥</strong> ${point.people_count} người` : ''}
            ${(point.phone || point.people_count) ? ' • ' : ''}
            <span style="color: ${urgencyColor};">${urgencyText}</span> 
            <span style="color: ${urgencyColor}; font-weight: 600;">
              ${point.urgency === 'normal' ? 'Bình thường' : point.urgency === 'urgent' ? 'Khẩn cấp' : 'Rất khẩn cấp'}
            </span>
          </div>
          ${point.notes ? `<div class="rescue-item-notes" style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1);">${point.notes}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  // Filter danh sách
  window.filterRescueList=function(){
    capnhatDsCanSOS();
    updateRescueCountWithFilter();
  }
// Cập nhật số lượng điểm cần cứu
async function capNhatSlSOS() {
    updateRescueCountWithFilter();
}

async function focusOnPoint(id) {
  const points= await laydiemSOS();
  const point=points.find(p=>p.id===id);
  if(point){
    map.setView([point.lat, point.lng], map.getZoom(), {animate: true});
    rescueMarkersLayer.eachLayer(layer=>{
      if(layer instanceof L.Marker){
        const latlng = layer.getLatLng();
        if (Math.abs(latlng.lat-point.lat)<0.001 && Math.abs(latlng.lng-point.lng)<0.001){
          layer.openPopup();
        }
      }
    });
  }
}
// Tải và hiển thị trạm đo mực nước
async function loadStations() {
    stationMarkersLayer.clearLayers();
    stationMarkersMap.clear();
    const stations =await getStations();

    for (const station of stations){
        const details= await notiSta(station.id);
    let color = '#95a5a6';
    let floodLevel='unknown';
    let waterLevel=null;
    if (details){
        floodLevel=details.flood_level || 'unknown';
        waterLevel=details.current_water_level;
        switch (floodLevel){
            case 'safe':
                color='#2ecc71';
                break;
            case 'caution':
                color='#f1cf40';
                break;
            case 'warning':
                color= '#e67e22';
                break;
            case 'danger':
                color='#e74c3c'
                break;
            default:
                color='#95a5a6';
        }
    }

    const isDanger=floodLevel==='danger';
    const icon = L.divIcon({
        className: `station-marker ${isDanger ? 'station-marker-danger' : ''}`,
        html: `
          <div style="
            background: ${color};
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 0 15px ${color}80;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            color: white;
            font-size: 14px;
          ">📊</div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      
      const marker = L.marker([parseFloat(station.location_lat), parseFloat(station.location_lng)], {icon});
      stationMarkersMap.set(station.id, marker);
      let popupContent = `
        <div style="min-width: 250px;">
          <b style="font-size: 14px;">${station.name}</b><br/>
          <hr style="margin: 8px 0; border-color: #ddd;"/>
      `;
      
      if (details && waterLevel !== null) {
        const riseRate = details.rise_rate !== null ? `${details.rise_rate > 0 ? '+' : ''}${details.rise_rate.toFixed(2)}` : 'N/A';
        const floodLevelText = {
          'safe': '🟢 An toàn',
          'caution': '🟡 Cảnh báo nhẹ',
          'warning': '🟠 Cảnh báo',
          'danger': '🔴 Nguy hiểm',
          'unknown': '⚪ Chưa có dữ liệu'
        }[floodLevel] || '⚪ Chưa có dữ liệu';
        
        popupContent += `
          <strong>Mực nước hiện tại:</strong> ${waterLevel.toFixed(2)} cm<br/>
          <strong>Tốc độ dâng:</strong> ${riseRate} cm/giờ<br/>
          <strong>Mức độ ngập:</strong> ${floodLevelText}<br/>
          ${details.last_update ? `<strong>Cập nhật:</strong> ${new Date(details.last_update).toLocaleString('vi-VN')}<br/>` : ''}
        `;
      } else {
        popupContent += `
          <div style="color: #95a5a6; font-size: 12px;">Chưa có dữ liệu mực nước</div>
        `;
      }
      
      popupContent += `
          <hr style="margin: 8px 0; border-color: #ddd;"/>
          <div style="font-size: 11px; color: #7f8c8d;">
            <strong>Ngưỡng:</strong><br/>
            An toàn: ${parseFloat(station.threshold_safe || 0).toFixed(0)} cm<br/>
            Cảnh báo: ${parseFloat(station.threshold_warning || 0).toFixed(0)} cm<br/>
            Nguy hiểm: ${parseFloat(station.threshold_danger || 0).toFixed(0)} cm
          </div>
        </div>
      `;
      marker.bindPopup(popupContent);
      marker.addTo(stationMarkersLayer);
    }

    capnhatDsTram(stations);

}
// Cập nhật danh sách trạm
async function capnhatDsTram(stations) {
    const stationsListDiv = document.getElementById('stations-list');
    if (!stationsListDiv) return;
    if (stations.length===0){
        stationsListDiv.innerHTML= '<div style="color: #95a5a6; font-size: 12px; text-align: center; padding: 8px;">Chưa có trạm nào</div>';
        return;
    }
    let html='';
    for (const station of stations){
        const details=await notiSta(station.id);
        const floodLevel=details?.flood_level || 'unknown';
        const waterLevel = details?.current_water_level;
        const floodLevelText={
            'safe': '🟢 An toàn',
          'caution': '🟡 Cảnh báo nhẹ',
          'warning': '🟠 Cảnh báo',
          'danger': '🔴 Nguy hiểm',
          'unknown': '⚪ Chưa có dữ liệu'
        }[floodLevel] || '⚪ Chưa có dữ liệu';
        
        html += `
        <div class="station-item" onclick="focusOnStation('${station.id}')" style="
          padding: 10px;
          margin-bottom: 8px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 6px;
          border-left: 3px solid ${details ? {
            'safe': '#2ecc71',
            'caution': '#f1c40f',
            'warning': '#e67e22',
            'danger': '#e74c3c',
            'unknown': '#95a5a6'
          }[floodLevel] : '#95a5a6'};
          cursor: pointer;
          transition: all 0.2s;
        " onmouseover="this.style.background='rgba(0, 0, 0, 0.4)'" onmouseout="this.style.background='rgba(0, 0, 0, 0.2)'">
          <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">${station.name}</div>
          <div style="font-size: 11px; color: #95a5a6;">
            ${waterLevel !== null ? `Mực nước: ${waterLevel.toFixed(2)} cm` : 'Chưa có dữ liệu'}
          </div>
          <div style="font-size: 11px; margin-top: 4px;">${floodLevelText}</div>
        </div>
      `;
        }
    stationsListDiv.innerHTML=html;
    }

    window.focusOnStation=function(stationId){
        const marker=stationMarkersMap.get(stationId);
        if (marker){
            map.setView(marker.getLatLng(), 15);
            marker.openPopup();
        }
    };
    hienThiDiemSOS();
    loadStations();
    let lastRescuePointHash='';

    setInterval(async function () {
        try{
            const points=await laydiemSOS();
            const currentHash=JSON.stringify(points.map(p=> ({id: p.id, status: p.status})));
            if (currentHash!==lastRescuePointHash){
                lastRescuePointHash=currentHash;
                hienThiDiemSOS();
            }
        } catch (error){
            console.error('Lỗi khi kiểm tra cập nhật:', error);
        }
    }, 2000);
// Cập nhật trạm đo mực nước
    setInterval (async function () {
        try{
            loadStations();
        } catch(error){
            console.error('Lỗi khi cập nhật trạm:', error);
        }
    }, 10000);

    window.markAsRescued=async function (id) {
      try{
        await danhDauDaCuu(id);
        await hienThiDiemSOS();
        map.closePopup();
      }catch (error){
        alert('Không thể đánh dấu đã cứu. Vui lòng thử lại.')
      }
    }

// Xóa điểm cần cứu
    window.deleteRescuePoint=async function (id) {
        if (confirm('Bạn có chắc muốn xóa điểm này?')){
            try{
                await xoaDiemSOS(id);
                await hienThiDiemSOS();
            }catch(error){
                alert ('Không thể xóa điểm. Vui lòng thử lại.');
            }
        }
    };

// Xóa tất cả điểm đã cứu
window.clearAllRescued=async function () {
  if (confirm('Bạn có chắc chắn muốn xóa điểm đã được cứu?')){
    try{
      await xoaAll();
      await hienThiDiemSOS();
      alert ('Đã xóa điểm đã được cứu thành công!');
    }catch (error){
      console.error('Error:', error);
      alert('Không thể xóa điểm. Vui lòng thử lại.');
    }
  }
};


