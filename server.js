const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const app=express();
const PORT=3000;
const HOST='0.0.0.0';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static('.'));

const WATER_LEVER_CSV=path.join(__dirname, 'data', 'water_level.csv');
const RESCUE_POINTS_CSV=path.join(__dirname, 'data', 'rescue_points.csv');
const STAIONS_CSV=path.join(__dirname, 'data', 'stations.csv');

if (!fs.existsSync(path.join(__dirname, 'data'))){
    fs.mkdirSync(path.join(__dirname, 'data'));
}

function initCsvFile(filePath, headers){
    if (!fs.existsSync(filePath)){
        const csvwriter=createCsvWriter({
            path: filePath,
            header: headers
        });
        csvwriter.writeRecords([]).then(()=>{
            console.log(`Đã tạo CSV:${filePath}`);
        });
    }
}

initCsvFile(STAIONS_CSV,[
    {id:'id', title:'id'},
    {id:'name', title:'name'},
    {id:'location_lat', title:'location_lat'},
    {id:'location_lng', title:'location_lng'},
    {id:'threshold_safe', title:'threshold_safe'},
    {id:'threshold_warning', title:'threshold_warning'},
    {id:'threshold_danger', title:'threshold_danger'},
    {id:'status', title:'status'},
    {id:'create_at', title:'create_at'},
]);

initCsvFile(WATER_LEVER_CSV,[
    {id:'id', title:'id'},
    {id:'station_id', title:'station_id'},
    {id:'water_level', title:'water_level'},
    {id:'timestamp', title:'timestamp'},
    {id:'status', title:'status'},
]);

initCsvFile(RESCUE_POINTS_CSV,[
    {id:'id', title:'id'},
    {id:'lat', title:'lat'},
    {id:'lng', title:'lng'},
    {id:'timestamp', title:'timestamp'},
    {id:'phone', title:'phone'},
    {id:'people_count', title:'people_count'},
    {id:'urgency', title:'urgency'},
    {id:'type', title:'type'},
    {id:'notes', title:'notes'},
    {id:'status', title:'status'},
    {id:'rescueAt', title:'rescueAt'},
]);

/**
 * Tính tốc độ dâng nước (cm/giờ) từ mảng bản ghi của một trạm.
 * Thuật toán:
 *   1. Lấy tất cả bản ghi trong cửa sổ 5 phút gần nhất.
 *   2. Tính tốc độ giữa từng cặp bản ghi liên tiếp → mảng rates[].
 *   3. Khử nhiễu bằng IQR: loại bỏ giá trị nằm ngoài [Q1-1.5×IQR, Q3+1.5×IQR].
 *   4. Trả về trung bình các rate còn lại.
 *
 * @param {Array} records - Mảng bản ghi đã sắp xếp MỚI NHẤT trước, cùng một trạm.
 * @returns {number|null} Tốc độ dâng nước (cm/h), null nếu không đủ dữ liệu.
 */
function calcRiseRate(records) {
    if (!records || records.length < 2) return null;

    const WINDOW_MS    = 5  * 60 * 1000;   // 5 phút
    const MIN_GAP_MS   = 1  * 1000;         // bỏ qua các cặp cách nhau < 1 giây

    const latestTime = new Date(records[0].timestamp);
    if (isNaN(latestTime.getTime())) return null;

    // --- 1. Lấy bản ghi trong cửa sổ 5 phút ---
    const window = records.filter(r => {
        const t = new Date(r.timestamp);
        if (isNaN(t.getTime())) return false;
        const diff = latestTime - t;
        return diff >= 0 && diff <= WINDOW_MS;
    });

    if (window.length < 2) return null;

    // --- 2. Tính tốc độ giữa từng cặp liên tiếp ---
    const rates = [];
    for (let i = 0; i < window.length - 1; i++) {
        const tNewer = new Date(window[i].timestamp);
        const tOlder = new Date(window[i + 1].timestamp);
        const deltaMs = tNewer - tOlder;
        if (deltaMs < MIN_GAP_MS) continue;
        const deltaLevel = parseFloat(window[i].water_level) - parseFloat(window[i + 1].water_level);
        if (isNaN(deltaLevel)) continue;
        rates.push(deltaLevel / (deltaMs / (1000 * 60 * 60)));  // cm/h
    }

    if (rates.length === 0) return null;
    if (rates.length === 1) return rates[0];

    // --- 3. Khử nhiễu bằng IQR ---
    const sorted = [...rates].sort((a, b) => a - b);
    const q1  = sorted[Math.floor(sorted.length * 0.25)];
    const q3  = sorted[Math.ceil(sorted.length  * 0.75) - 1];
    const iqr = q3 - q1;

    let filtered;
    if (iqr === 0) {
        // Tất cả rate giống nhau → không có nhiễu, giữ nguyên
        filtered = rates;
    } else {
        const lo = q1 - 1.5 * iqr;
        const hi = q3 + 1.5 * iqr;
        filtered = rates.filter(r => r >= lo && r <= hi);
    }

    if (filtered.length === 0) return null;

    // --- 4. Trung bình các rate sau lọc ---
    return filtered.reduce((sum, r) => sum + r, 0) / filtered.length;
}

function readCsv(filePath){
    return new Promise((resolve, reject)=>{
        const result=[];
        if (!fs.existsSync(filePath)){
            resolve([]);
            return;
        }
        fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data)=>{
            const hasId=data.id && data.id.trim()!=='';
            const hasAnyValue= Object.values(data).some(val=>val && val.toString().trim()!=='');
            if (hasId || hasAnyValue){
                result.push(data);
            }
        })
        .on('end',() =>resolve(result))
        .on('error',(error) =>reject(error));
    });
}

function writeCsv(filePath,data,headers){
    return new Promise((resolve,reject)=>{
        const csvWriter=createCsvWriter({
            path:filePath,
            header:headers
        });
        csvWriter.writeRecords(data)
        .then(()=>resolve())
        .catch((error)=>reject(error));
    });
}

app.get('/api/stations', async(req,res)=>{
    try{
        const stations=await readCsv(STAIONS_CSV);
        res.json(stations);
    }catch(error){
        res.status(500).json({error: error.message});
    }
});

// lấy tóm tắt tất cả trạm (water level + flood_level) trong 1 request
// phải đặt TRƯỚC route /api/stations/:id để tránh "summary" bị parse thành id
app.get('/api/stations/summary', async (req, res) => {
    try {
        const stations   = await readCsv(STAIONS_CSV);
        const waterLevels = await readCsv(WATER_LEVER_CSV);

        const summary = stations.map(station => {
            const levels = waterLevels
                .filter(w => w.station_id === station.id)
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            if (levels.length === 0) {
                return { id: station.id, current_water_level: null, flood_level: 'unknown', last_update: null };
            }

            const currentLevel = parseFloat(levels[0].water_level);
            const safe    = parseFloat(station.threshold_safe    || 50);
            const warning = parseFloat(station.threshold_warning || 100);
            const danger  = parseFloat(station.threshold_danger  || 150);

            let floodLevel = 'unknown';
            if      (currentLevel < safe)    floodLevel = 'safe';
            else if (currentLevel < warning) floodLevel = 'caution';
            else if (currentLevel < danger)  floodLevel = 'warning';
            else                             floodLevel = 'danger';

            return {
                id:                   station.id,
                current_water_level:  currentLevel,
                flood_level:          floodLevel,
                last_update:          levels[0].timestamp
            };
        });

        res.json(summary);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// lấy thông tin chi tiết trạm
app.get('/api/stations/:id', async (req,res)=> {
    try{
        const {id}=req.params;
        const stations=await readCsv(STAIONS_CSV);
        const station = stations.find(s=>s.id===id);

        if(!station){
            return res.status(404).json({error: 'Không tìm thấy trạm'});
        }
        // lấy dữ liệu mực nước
        const waterLevels=await readCsv(WATER_LEVER_CSV);
        const stationLevels=waterLevels
        .filter(w=>w.station_id===id)
        .sort((a,b)=> new Date(b.timestamp)-new Date(a.timestamp));

        if (stationLevels.length===0){
            return res.json({
                ...station,
                current_water_level: null,
                rise_rate:null,
                water_level_history:[],
                flood_level: 'unknown'
            });
        }

        // mực nước hiện tại
        const currentLevel=parseFloat(stationLevels[0].water_level);
        
        // tính tốc độ dâng — sliding window 5 phút + IQR noise filtering
        const riseRate = calcRiseRate(stationLevels);
        
        // xác định mức độ ngập
        const thresholdSafe = parseFloat(station.threshold_safe || 50);
        const thresholdWarning = parseFloat(station.threshold_warning || 100);
        const thresholdDanger = parseFloat(station.threshold_danger || 150);
        
        let floodLevel = 'unknown';
        if (currentLevel < thresholdSafe) {
            floodLevel = 'safe';
        } else if (currentLevel < thresholdWarning) {
            floodLevel = 'caution';
        } else if (currentLevel < thresholdDanger) {
            floodLevel = 'warning';
        } else {
            floodLevel = 'danger';
        }
        
        res.json({
            ...station,
            current_water_level: currentLevel,
            rise_rate: riseRate,
            water_level_history: stationLevels.slice(0, 10),
            flood_level: floodLevel,
            last_update: stationLevels[0].timestamp
        });
    }catch(error){
        res.status(500).json({error:error.message});
    }    
});

// nhận dữ liệu mực nước từ cảm biến
app.post('/api/water-level', async (req, res) => {
    try {
        const { station_id, water_level, timestamp } = req.body;

        if (station_id === undefined || water_level === undefined) {
            return res.status(400).json({ error: 'Thiếu station_id hoặc water_level' });
        }

        const level = parseFloat(water_level);
        if (isNaN(level)) {
            return res.status(400).json({ error: 'water_level không hợp lệ' });
        }

        // tính trạng thái dựa trên ngưỡng của trạm
        const stations = await readCsv(STAIONS_CSV);
        const station = stations.find(s => s.id === station_id.toString());
        let status = 'unknown';
        if (station) {
            const thresholdSafe    = parseFloat(station.threshold_safe    || 50);
            const thresholdWarning = parseFloat(station.threshold_warning || 100);
            const thresholdDanger  = parseFloat(station.threshold_danger  || 150);
            if      (level < thresholdSafe)    status = 'safe';
            else if (level < thresholdWarning) status = 'caution';
            else if (level < thresholdDanger)  status = 'warning';
            else                               status = 'danger';
        }

        const records = await readCsv(WATER_LEVER_CSV);

        // giữ tối đa 500 bản ghi mỗi trạm để tránh CSV phình to
        const MAX_PER_STATION = 500;
        const others  = records.filter(r => r.station_id !== station_id.toString());
        const thisStation = records
            .filter(r => r.station_id === station_id.toString())
            .slice(-(MAX_PER_STATION - 1));   // giữ N-1 cũ, sẽ thêm 1 mới

        const newRecord = {
            id:          Date.now().toString(),
            station_id:  station_id.toString(),
            water_level: level.toFixed(2),
            timestamp:   timestamp || new Date().toISOString(),
            status
        };

        const allRecords = [...others, ...thisStation, newRecord];

        await writeCsv(WATER_LEVER_CSV, allRecords, [
            { id: 'id',          title: 'id' },
            { id: 'station_id',  title: 'station_id' },
            { id: 'water_level', title: 'water_level' },
            { id: 'timestamp',   title: 'timestamp' },
            { id: 'status',      title: 'status' },
        ]);

        res.json({ success: true, data: newRecord });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// tạo trạm mới
app.post('/api/stations', async(req,res)=>{
    try{
        const {name, location_lat, location_lng, threshold_safe, threshold_warning, threshold_danger}=req.body;

        if(!name || location_lat===undefined || location_lng===undefined){
            return res.status(400).json({error:'Thiếu thông tin bắt buộc'});
        }

        const stations=await readCsv(STAIONS_CSV);

        const newStations={
            id: Date.now().toString(),
            name:name,
            location_lat:parseFloat(location_lat).toFixed(6),
            location_lng:parseFloat(location_lng).toFixed(6),
            threshold_safe:threshold_safe? parseFloat(threshold_safe).toFixed(2):'50.00',
            threshold_warning:threshold_warning? parseFloat(threshold_warning).toFixed(2):'100.00',
            threshold_danger:threshold_danger? parseFloat(threshold_danger).toFixed(2):'150.00',
            status: 'active',
            created_at: new Date().toISOString()
        };

        stations.push(newStations);

        await writeCsv(STAIONS_CSV, stations,[
            {id:'id', title:'id'},
            {id:'name', title:'name'},
            {id:'location_lat', title:'location_lat'},
            {id:'location_lng', title:'location_lng'},
             {id:'threshold_safe', title:'threshold_safe'},
            {id:'threshold_warning', title:'threshold_warning'},
            {id:'threshold_danger', title:'threshold_danger'},
            {id:'status', title:'status'},
            {id:'created_at', title:'created_at'}
        ]);

        res.json({success:true, data:newStations});
    }catch(error){
        res.status(500).json({error:error.message});
    }
});

// lấy tất cả điểm cần cứu hộ
app.get('/api/rescue-points', async(req, res)=>{
    try{
        const data=await readCsv(RESCUE_POINTS_CSV);
        // đảm bảo các trường hợp có giá trị mặc định nếu thiếu (tương thích dữ liệu cũ)
        const normalizedData=data.map(point=>({
            ...point,
            phone: point.phone || '',
            people_count: point.people_count || '',
            urgency:point.urgency || 'normal',
        }));
        res.json(normalizedData);
    }catch(error){
        res.status(500).json({error:error.message});
    }
});

// thêm điểm cần cứu hộ
app.post('/api/rescue-points', async (req,res)=>{
    try{
        const {lat, lng, phone, people_count, urgency, type, notes}=req.body;

        if (lat===undefined || lng===undefined){
            return res.status(400).json({error:'Thiếu tọa độ'});
        }

        // if (!phone || phone.trim()===''){
        //     return res.status(400).json({error:'Số điện thoại là bắt buộc'});
        // }
        
        const data= await readCsv(RESCUE_POINTS_CSV);

        // Deduplicate: if an active point of the same type already exists within
        // ~11 m (0.0001°) of the requested coordinates, return it without inserting.
        const COORD_THRESHOLD = 0.0001;
        const duplicate = data.find(p =>
            p.status !== 'rescued' &&
            (p.type || 'flood') === (type || 'flood') &&
            Math.abs(parseFloat(p.lat) - parseFloat(lat)) < COORD_THRESHOLD &&
            Math.abs(parseFloat(p.lng) - parseFloat(lng)) < COORD_THRESHOLD
        );
        if (duplicate) {
            return res.json({ success: true, duplicate: true, data: duplicate });
        }

        const newPoint={
            id: Date.now().toString(),
            lat: parseFloat(lat).toFixed(6),
            lng: parseFloat(lng).toFixed(6),
            timestamp: new Date().toISOString(),
            phone: phone || '',
            people_count: people_count ? parseInt(people_count).toString():'',
            urgency: urgency || 'normal',
            type: type || 'flood',
            notes: notes || '',
            status: 'active',
            rescuedAt:''
        };

        data.push(newPoint);
        await writeCsv(RESCUE_POINTS_CSV, data,[
                {id:'id', title:'id'},
                {id:'lat', title:'lat'},
                {id:'lng', title:'lng'},
                {id:'timestamp', title:'timestamp'},
                {id:'phone', title:'phone'},
                {id:'people_count', title:'people_count'},
                {id:'urgency', title:'urgency'},
                {id:'type', title:'type'},
                {id:'status', title:'status'},
                {id:'notes', title:'notes'},
                {id:'rescuedAt', title:'rescuedAt'}
        ]);

        res.json({success:true, data:newPoint});
    }catch(error){
        res.status(500).json({error:error.message});
    }
    }
);
// cập nhật điểm đã cứu hộ
app.put('/api/rescue-points/:id', async (req,res)=>{
    try{
        const {id}=req.params;
        const {status, notes}=req.body;
        
        const data= await readCsv(RESCUE_POINTS_CSV);
        const pointIndex=data.findIndex(p=>p.id===id);

        if (pointIndex===-1){
            return res.status(404).json({error:'Không tìm thấy điểm'});
        }
        if (status){
            data[pointIndex].status=status;
        }
        if (status==='rescue'){
            data[pointIndex].rescuedAt=new Date().toISOString();
        }
        if (notes!==undefined){
            data[pointIndex].notes=notes;
        }

        await writeCsv(RESCUE_POINTS_CSV, data,[
                {id:'id', title:'id'},
                {id:'lat', title:'lat'},
                {id:'lng', title:'lng'},
                {id:'timestamp', title:'timestamp'},
                {id:'phone', title:'phone'},
                {id:'people_count', title:'people_count'},
                {id:'urgency', title:'urgency'},
                {id:'type', title:'type'},
                {id:'status', title:'status'},
                {id:'notes', title:'notes'},
                {id:'rescuedAt', title:'rescuedAt'}
        ]);

        res.json({success:true, data: data[pointIndex]});
    }catch(error){
        res.status(500).json({error:error.message});
    }
    }
);

// xoá điểm cần cứu hộ
app.delete('/api/rescue-points/:id', async (req,res)=>{
    try{
        const {id}=req.params;
        const data=await readCsv(RESCUE_POINTS_CSV);
        const filtered=data.filter(p=>p.id!==id);

        if (filtered.length===data.length){
            return res.status(404).json({error:'Không tìm thấy điểm'});
        }
        await writeCsv(RESCUE_POINTS_CSV, filtered,[
                {id:'id', title:'id'},
                {id:'lat', title:'lat'},
                {id:'lng', title:'lng'},
                {id:'timestamp', title:'timestamp'},
                {id:'phone', title:'phone'},
                {id:'people_count', title:'people_count'},
                {id:'urgency', title:'urgency'},
                {id:'type', title:'type'},
                {id:'status', title:'status'},
                {id:'notes', title:'notes'},
                {id:'rescuedAt', title:'rescuedAt'}
        ]);

        res.json({success:true});
    }catch(error){
        res.status(500).json({error:error.message});
    }
});
app.listen(PORT,HOST,()=>{
    console.log(`Server đang chạy tại http://localhost:${PORT}`)
})