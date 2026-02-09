const DN_center=[16.0544, 108.2022];
const map= L.map("map", {
    center: DN_center,
    zoomControl: true,
    minZoom: 10,
    maxZoom: 18,
    }
);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

let isRecuseMode=false;
let rescueMarkersLayer=L.layerGroup().addTo(map);
let stationMarkersLayer= L.layerGroup().addTo(map);
const stationMarkersMap = new Map();
const API_BASE_URL= window.location.origin;

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
    


async function saveRescuePoint(point){
    try{
        const response = await fetch(`${API_BASE_URL}/api/rescue-points`,{
            method: 'POST',
            headers:{
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                lat: point.lat,
                lng: point.lng,
                phone: point.phone ||'',
                people_count: point.people_count ||'',
                urgency: point.urgency || 'normal',
                notes: point.notes || ''
            })
        });
        if (!response.ok){
            const errorData = await response.json();
            throw new Error(errorData.error || 'Lỗi khi lưu dữ liệu');
        }
        return await response.json();
    } catch(error){
        console.error('Lỗi:',error);
        throw error;
    }
}

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

async function hienThiDiemSOS() {
    rescueMarkersLayer.clearLayers();
    const points=await laydiemSOS();
    points.forEach(point => {
    const isRecused=point.status==='rescued';
    const icon = L.divIcon({
        className: 'rescue-marker',
        html: `
          <div style="
            background: ${isRecused ? '#95a5a6' : '#e74c3c'};
            width: 30px;
            height: 30px;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 0 15px ${isRecused ? 'rgba(149,165,166,0.8)' : 'rgba(231,76,60,0.8)'};
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            color: white;
            font-size: 18px;
          ">${isRecused ? '✓' : '!'}</div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      const marker = L.marker([point.lat, point.lng], {icon});
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
          ${isRecused && point.recusedAt ? `<hr style="margin: 8px 0; border-color: #ddd;"/><strong>✓ Đã cứu lúc:</strong> ${new Date(point.rescuedAt).toLocaleString('vi-VN')}<br/>` : ''}
          ${!isRecused ? '<div style="margin-top: 8px; color: #e74c3c; font-size: 12px;">Chỉ đội cứu hộ mới có thể đánh dấu đã cứu</div>' : ''}
        </div>
      `;
      
      marker.bindPopup(popupContent);
      marker.addTo(rescueMarkersLayer);
    });
    capNhatSOS();
}

async function capNhatSOS() {
    const points=await laydiemSOS();
    const activeCount =points.filter(p=> p.status !=='rescued').length;
    const countDiv=document.getElementById('rescue-count');
    if (countDiv){
        countDiv.textContent=`Có ${activeCount} điểm cần cứu hộ`;
        countDiv.style.color = activeCount>0? '#e74c3c': "#2ecc71";
    }
}

let clickedLocation=null;

function handleMapClick(e){
    if (!isRecuseMode) return;

    clickedLocation ={
        lat:e.latlng.lat,
        lng:e.latlng.lng
    };

    openRescueModal();
}

map.on('click', handleMapClick);

async function loadStations() {
    stationMarkersLayer.clearLayers();
    stationMarkersMap.clear();
    const stations =await getStations();

    for (const station of stations){
        const detals= await notiSta(station.id);
    let color = '#95a5a6';
    let floodLevel='unknow';
    let waterLevel=null;
    if (detals){
        floodLevel=detals.flood_level || 'unknow';
        waterLevel=detals.current_water_lever;
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

    capnhatDsSOS(stations);

}

async function capnhatDsSOS(stations) {
    const sationsListDiv = document.getElementById('station-list');
    if (!sationsListDiv) return;
    if (stations.length===0){
        sationsListDiv.innerHTML= '<div style="color: #95a5a6; font-size: 12px; text-align: center; padding: 8px;">Chưa có trạm nào</div>';
        return;
    }
    let html='';
    for (const station of stations){
        const detals=await notiSta(station.id);
        const floodLevel=detals?.flood_level || 'unknown';
        const waterLevel = detals?.current_water_lever;
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
    sationsListDiv.innerHTML=html;
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

    setInterval (async function () {
        try{
            capNhatSOS();
        } catch(error){
            console.error('Lỗi khi cập nhật trạm:', error);
        }
    }, 10000);

    window.toggleRescueMode= function(){
        isRecuseMode=!isRecuseMode;
        const btn=document.getElementById('rescue-toggle-btn');
        const infor=document.getElementById('rescue-infor');

        if (isRecuseMode){
            btn.textContent='Tắt phát tín hiệu';
            btn.style.background='#e74c3c';
            if (infor){
                infor.textContent='Click vào bản đồ để đặt điểm cần cứu hộ';
                infor.style.color='#e74c3c';
            }
            map.getContainer().style.cursor='crosshair';
        } else{
            btn.textContent='Phát tín hiệu cần cứu';
            btn.style.background='#e74c3c';
            if(infor){
                infor.textContent='Nhấn nút để bật chế độ phát tính hiệu cầu cứu';
                infor.style.color='#95a5a6';
            }
            map.getContainer().style.cursor='';
        }
    };

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

    window.openRescueModal=function(){
        const modal=document.getElementById('rescue-modal');
        if (modal && clickedLocation){
            modal.style.display='block';
            document.getElementById('rescue-form').reset();
        }
    };

    window.closeRescueModal=function(){
        const modal=document.getElementById('rescue-modal');
        if (modal){
            modal.style.display='none';
            clickedLocation=null;
        }
    };
    window.submitRescueForm=async function (event) {
        event.preventDefault();

        if(!clickedLocation){
            alert ('Vui lòng chọn vị trí trên bản đồ');
            return;
        }

        const phone=document.getElementById('rescue-phone').value.trim();
        const peopleCount=document.getElementById('rescue-people').value;
        const urgency=document.getElementById('rescue-urgency').value;
        const notes=document.getElementById('rescue-note').value.trim();

        if(!phone){
            alert ('Vui lòng nhập số điện thoại');
            return;
        }
        
        const rescuePoint={
            lat:clickedLocation.lat,
            lng: clickedLocation.lng,
            phone:phone,
            people_count: peopleCount || '',
            urgency: urgency,
            notes:notes 
        };
        try{
            await saveRescuePoint(rescuePoint);
            await hienThiDiemSOS();
            closeRescueModal();

            const successMsg=document.createElement('div');
            successMsg.textContent = '✅ Đã phát tín hiệu cần cứu hộ thành công!';
      successMsg.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #2ecc71;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        font-weight: 600;
      `;
      document.body.appendChild(successMsg);
      setTimeout(()=> successMsg.remove(), 3000);
        }catch(error){
            alert('Không thể lưu điểm cứu hộ', +error.message);
        }
    };

    window.onclick=function(event){
        const modal = document.getElementById('rescue-modal');
        if (event.target===modal){
            closeRescueModal();
        }
    };
