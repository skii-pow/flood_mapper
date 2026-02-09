const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const app=express();
const PORT=3000;
const HOST='0.0.0.0';

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));
app.use(express.static('.'));

const WATER_LEVER_CSV=path.join(__dirname, 'data', 'water_level.csv');
const RESCUE_POINTS_CSV=path.join(__dirname, 'data', 'rescue_points.csv');
const STAIONS_CSV=path.join(__dirname, 'data', 'stations.csv');

if (!fs.existsSync(path.join(__dirname, 'data'))){
    fs.mkdiSync(path.join(__dirname, 'data'));
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
    {id:'notes', title:'notes'},
    {id:'status', title:'status'},
    {id:'rescueAt', title:'rescueAt'},
]);

function readCsv(filePath){
    return new Promise((resolve, reject)=>{
        const result=[];
        if (!existSync(filePath)){
            resolve([]);
            return;
        }
        createReadStream(filePath)
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
        .cacth((error)=>reject(error));
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
        const currenLevel=parseFloat(stationLevels[0].water_level);
    }catch(error){
        res.status(500).json({error:error.message});
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
            crated_at: new Date().toISOString()
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
        const {lat, lng, phone, people_count,urgency, notes}=req.body;

        if (lat===undefined || lng===undefined){
            return res.status(400).json({error:'Thiếu tọa độ'});
        }

        // if (!phone || phone.trim()===''){
        //     return res.status(400).json({error:'Số điện thoại là bắt buộc'});
        // }
        
        const data= await readCsv(RESCUE_POINTS_CSV);

        const newPoint={
            id: Date.now().toString(),
            lat: parseFloat(lat).toFixed(6),
            lng: parseFloat(lng).toFixed(6),
            timestamp: new Date().toISOString(),
            phone: point.phone || '',
            people_count: point.people_count ? parseInt(people_count).toString():'',
            urgency:point.urgency || 'normal',
            notes:notes || '',
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

        data.push(newPoint);
        await writeCsv(RESCUE_POINTS_CSV, data,[
                {id:'id', title:'id'},
                {id:'lat', title:'lat'},
                {id:'lng', title:'lng'},
                {id:'timestamp', title:'timestamp'},
                {id:'phone', title:'phone'},
                {id:'people_count', title:'people_count'},
                {id:'urgency', title:'urgency'},
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
        const filtered=data.filter(p=>p.id===id);

        if (filtered.length===data.length){
            return res.status(404).json({error:'Không tìm thấy điểm'});
        }
        await writeCsv(RESCUE_POINTS_CSV, data,[
                {id:'id', title:'id'},
                {id:'lat', title:'lat'},
                {id:'lng', title:'lng'},
                {id:'timestamp', title:'timestamp'},
                {id:'phone', title:'phone'},
                {id:'people_count', title:'people_count'},
                {id:'urgency', title:'urgency'},
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