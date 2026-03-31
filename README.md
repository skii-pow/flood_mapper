# 🌊 Flood Mapper - Hệ thống Cảnh báo Lũ lụt Đà Nẵng

Ứng dụng web giám sát mực nước và cảnh báo lũ lụt theo thời gian thực với tính năng phát tín hiệu cứu hộ.

## 📋 Yêu cầu hệ thống

- Node.js (phiên bản 14 trở lên)
- npm hoặc yarn
- Trình duyệt web hiện đại (Chrome, Firefox, Safari, Edge)

## 🚀 Cài đặt và Chạy Project

### Bước 1: Clone hoặc Download project

```bash
# Nếu dùng Git
git clone https://github.com/skii-pow/flood_mapper.git
cd flood_mapper

# Hoặc giải nén file ZIP và cd vào thư mục
```

### Bước 2: Cài đặt Dependencies

```bash
npm install
```

Lệnh này sẽ cài đặt các thư viện cần thiết:
- `express` - Web framework
- `cors` - Cross-Origin Resource Sharing
- `csv-parser` - Đọc file CSV
- `csv-writer` - Ghi file CSV

### Bước 3: Chạy Server

```bash
npm start
```

Hoặc:

```bash
node server.js
```

Sau khi chạy thành công, bạn sẽ thấy thông báo:
```
Server đang chạy tại http://localhost:3000
```

### Bước 4: Mở Frontend trong Trình duyệt

Mở một trong các URL sau trong trình duyệt:

#### Trang chính - Bản đồ cảnh báo lũ lụt:
```
http://localhost:3000/index.html
```

#### Trang dành cho đội cứu hộ:
```
http://localhost:3000/rescue-team.html
```

#### Trang test bản đồ (đơn giản):
```
http://localhost:3000/test-map.html
```

---

## 📁 Cấu trúc Thư mục

```
flood_mapper/
├── data/                    # Dữ liệu CSV
│   ├── stations.csv         # Thông tin trạm đo
│   ├── water_level.csv      # Dữ liệu mực nước
│   ├── rescue_points.csv    # Điểm cần cứu hộ
│   └── map.geojson          # Dữ liệu bản đồ
├── css/
│   └── style.css            # Styles cho ứng dụng
├── js/
│   ├── map.js               # Logic bản đồ chính
│   └── rescue-team.js       # Logic trang cứu hộ
├── index.html               # Trang chính
├── rescue-team.html         # Trang đội cứu hộ
├── test-map.html            # Trang test
├── server.js                # Express server (Backend)
├── package.json             # Dependencies
├── START_GUIDE.md           # Hướng dẫn chi tiết các lỗi đã fix
└── README.md                # File này
```

---

## 🔌 API Endpoints

---

### 📡 Trạm đo mực nước

#### Lấy danh sách tất cả trạm
```http
GET /api/stations
```
**Response:**
```json
[
  {
    "id": "1",
    "name": "Trạm Cầu Rồng",
    "location_lat": "16.060553",
    "location_lng": "108.227380",
    "threshold_safe": "100.00",
    "threshold_warning": "200.00",
    "threshold_danger": "300.00",
    "status": "active",
    "create_at": "2026-02-09T00:00:00.000Z"
  }
]
```

---

#### Lấy tóm tắt trạng thái tất cả trạm *(dùng cho polling frontend)*
```http
GET /api/stations/summary
```
Trả về mực nước hiện tại và mức độ ngập của tất cả trạm trong một request duy nhất.

**Response:**
```json
[
  {
    "id": "1",
    "current_water_level": 250.00,
    "flood_level": "warning",
    "last_update": "2026-03-31T10:00:00.000Z"
  }
]
```

**`flood_level` values:**

| Giá trị | Ý nghĩa |
|---|---|
| `safe` | Dưới ngưỡng an toàn |
| `caution` | Vượt ngưỡng an toàn |
| `warning` | Vượt ngưỡng cảnh báo |
| `danger` | Vượt ngưỡng nguy hiểm |
| `unknown` | Chưa có dữ liệu |

---

#### Lấy chi tiết trạm
```http
GET /api/stations/:id
```
**Response:**
```json
{
  "id": "1",
  "name": "Trạm Cầu Rồng",
  "location_lat": "16.060553",
  "location_lng": "108.227380",
  "threshold_safe": "100.00",
  "threshold_warning": "200.00",
  "threshold_danger": "300.00",
  "status": "active",
  "current_water_level": 250.00,
  "rise_rate": 5.2,
  "flood_level": "warning",
  "last_update": "2026-03-31T10:00:00.000Z",
  "water_level_history": [
    { "id": "...", "station_id": "1", "water_level": "250.00", "timestamp": "...", "status": "warning" }
  ]
}
```
> `water_level_history` trả về tối đa 10 bản ghi gần nhất.  
> `rise_rate` đơn vị là cm/giờ, `null` nếu chỉ có 1 bản ghi.

---

#### Tạo trạm mới
```http
POST /api/stations
Content-Type: application/json
```
**Request body:**
```json
{
  "name": "Tên trạm",
  "location_lat": 16.0544,
  "location_lng": 108.2022,
  "threshold_safe": 100,
  "threshold_warning": 200,
  "threshold_danger": 300
}
```
> `threshold_safe`, `threshold_warning`, `threshold_danger` là tuỳ chọn, mặc định `50 / 100 / 150`.

**Response:**
```json
{ "success": true, "data": { "id": "...", "name": "Tên trạm", ... } }
```

---

### 🌊 Mực nước cảm biến

#### Nhận dữ liệu mực nước từ ESP32/sensor
```http
POST /api/water-level
Content-Type: application/json
```
**Request body:**
```json
{
  "station_id": "1",
  "water_level": 250.00,
  "timestamp": "2026-03-31T10:00:00.000Z"
}
```
> `timestamp` là tuỳ chọn; nếu bỏ qua, server tự dùng thời gian hiện tại.  
> Mỗi trạm chỉ giữ tối đa **500 bản ghi** gần nhất.  
> `water_level` nên được nhân với hệ số tỉ lệ mô hình trước khi gửi (ví dụ: 1:100 → nhân 100).

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "station_id": "1",
    "water_level": "250.00",
    "timestamp": "2026-03-31T10:00:00.000Z",
    "status": "warning"
  }
}
```

---

### 🚨 Điểm cần cứu hộ

#### Lấy tất cả điểm cần cứu hộ
```http
GET /api/rescue-points
```
**Response:**
```json
[
  {
    "id": "...",
    "lat": "16.059056",
    "lng": "108.206104",
    "timestamp": "2026-03-31T10:00:00.000Z",
    "phone": "0987654321",
    "people_count": "3",
    "urgency": "critical",
    "type": "flood",
    "notes": "Cần hỗ trợ gấp",
    "status": "active",
    "rescuedAt": ""
  }
]
```

---

#### Thêm điểm cần cứu hộ
```http
POST /api/rescue-points
Content-Type: application/json
```
**Request body:**
```json
{
  "lat": 16.0544,
  "lng": 108.2022,
  "phone": "0123456789",
  "people_count": 5,
  "urgency": "critical",
  "type": "fire",
  "notes": "Mô tả tình huống"
}
```

| Trường | Bắt buộc | Mô tả |
|---|---|---|
| `lat`, `lng` | ✅ | Toạ độ vị trí |
| `urgency` | | `normal` / `urgent` / `critical` (mặc định `normal`) |
| `type` | | `flood` / `fire` (mặc định `flood`) |
| `phone` | | Số điện thoại liên hệ |
| `people_count` | | Số người cần cứu |
| `notes` | | Ghi chú thêm |

> **Chống trùng lặp:** Nếu đã có điểm cùng `type` chưa được cứu trong bán kính ~11m, server trả về điểm đó thay vì tạo mới, kèm `"duplicate": true`.

**Response (mới):**
```json
{ "success": true, "data": { "id": "...", "type": "fire", "status": "active", ... } }
```
**Response (trùng lặp):**
```json
{ "success": true, "duplicate": true, "data": { "id": "...", ... } }
```

---

#### Cập nhật trạng thái điểm cứu hộ
```http
PUT /api/rescue-points/:id
Content-Type: application/json
```
**Request body:**
```json
{
  "status": "rescue",
  "notes": "Đã tiếp cận hiện trường"
}
```
> Khi `status = "rescue"`, trường `rescuedAt` được tự động ghi nhận thời gian.

**Response:**
```json
{ "success": true, "data": { "id": "...", "status": "rescue", "rescuedAt": "2026-03-31T10:05:00.000Z", ... } }
```

---

#### Xóa điểm cứu hộ
```http
DELETE /api/rescue-points/:id
```
**Response:**
```json
{ "success": true }
```

---

## 🎯 Tính năng

### 1. Hiển thị Bản đồ
- Bản đồ OpenStreetMap tập trung vào khu vực Đà Nẵng
- Zoom và pan để khám phá

### 2. Trạm đo Mực nước
- 5 trạm đo mẫu ở các vị trí chiến lược
- Màu sắc theo mức độ nguy hiểm:
  - 🟢 Xanh lá: An toàn
  - 🟡 Vàng: Cảnh báo nhẹ
  - 🟠 Cam: Cảnh báo
  - 🔴 Đỏ: Nguy hiểm
- Click vào trạm để xem chi tiết mực nước

### 3. Hệ thống Cứu hộ
- Phát tín hiệu cần cứu hộ bằng cách click trên bản đồ
- Nhập thông tin: số điện thoại, số người, mức độ khẩn cấp
- Hiển thị tất cả điểm cần cứu hộ trên bản đồ
- Đội cứu hộ có thể xem và đánh dấu đã cứu

### 4. Cập nhật Thời gian Thực
- Poll `GET /api/stations/summary` mỗi **3 giây**; chỉ re-render bản đồ khi dữ liệu thực sự thay đổi (hash-based polling)
- Dữ liệu mực nước từ ESP32 được đẩy lên server mỗi **2 giây** (khi có nước) hoặc **1 phút** (khi khô)

---

## 🔧 Cấu hình

### Thay đổi Port

Mặc định server chạy trên port 3000. Để thay đổi, sửa trong `server.js`:

```javascript
const PORT = 3000;  // Thay đổi số này
```

### Thay đổi Vị trí Bản đồ

Để thay đổi vị trí trung tâm bản đồ, sửa trong `js/map.js`:

```javascript
const DN_center = [16.0544, 108.2022];  // [latitude, longitude]
```

### Thay đổi Ngưỡng Mực nước

Sửa trong file `data/stations.csv` hoặc qua API:
- `threshold_safe`: Ngưỡng an toàn (cm)
- `threshold_warning`: Ngưỡng cảnh báo (cm)
- `threshold_danger`: Ngưỡng nguy hiểm (cm)

---

## 🐛 Xử lý Lỗi

### Server không khởi động được

```bash
# Kiểm tra port 3000 có đang được sử dụng không
lsof -ti:3000

# Nếu có, kill process đó
kill -9 $(lsof -ti:3000)

# Hoặc đổi sang port khác trong server.js
```

### Không hiển thị bản đồ

1. Kiểm tra Console trong Developer Tools (F12)
2. Đảm bảo kết nối Internet (để tải Leaflet và OpenStreetMap tiles)
3. Hard refresh trang (Ctrl+Shift+R hoặc Cmd+Shift+R)

### Lỗi "Cannot read package.json"

```bash
# Đảm bảo bạn đang ở đúng thư mục
cd flood_mapper

# Kiểm tra file package.json có tồn tại không
ls -la package.json
```

### API không trả về dữ liệu

```bash
# Kiểm tra server có đang chạy không
curl http://localhost:3000/api/stations

# Kiểm tra file CSV có tồn tại không
ls -la data/*.csv
```

---

## 📦 Dữ liệu Mẫu

Project đi kèm với dữ liệu mẫu:

### 5 Trạm đo mực nước:
1. **Trạm Cầu Rồng** - Mức nước: 125-130cm (NGUY HIỂM) 🔴
2. **Trạm Sông Hàn** - Mức nước: 85-90cm (AN TOÀN) 🟢
3. **Trạm Cầu Thuận Phước** - Mức nước: 65-70cm (AN TOÀN) 🟢
4. **Trạm Hòa Xuân** - Mức nước: 55-60cm (AN TOÀN) 🟢
5. **Trạm Hải Châu** - Mức nước: 75-80cm (AN TOÀN) 🟢

---

## 🛠️ Development

### Thêm Trạm đo mới

Có 2 cách:

**Cách 1: Qua API**
```bash
curl -X POST http://localhost:3000/api/stations \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Trạm Mới",
    "location_lat": 16.0544,
    "location_lng": 108.2022,
    "threshold_safe": 50,
    "threshold_warning": 100,
    "threshold_danger": 150
  }'
```

**Cách 2: Sửa trực tiếp file CSV**

Thêm dòng mới vào `data/stations.csv`:
```csv
6,Trạm Mới,16.054400,108.202200,50.00,100.00,150.00,active,2026-02-09T00:00:00.000Z
```

### Thêm Dữ liệu Mực nước

Thêm vào `data/water_level.csv`:
```csv
16,1,132.00,2026-02-09T11:00:00.000Z,active
```

Format: `id,station_id,water_level,timestamp,status`

---

## 🧪 Testing

### Test API với curl

```bash
# Test stations
curl http://localhost:3000/api/stations

# Test station detail
curl http://localhost:3000/api/stations/1

# Test rescue points
curl http://localhost:3000/api/rescue-points

# Test thêm rescue point (lũ lụt)
curl -X POST http://localhost:3000/api/rescue-points \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 16.0544,
    "lng": 108.2022,
    "phone": "0123456789",
    "people_count": 3,
    "urgency": "urgent",
    "type": "flood",
    "notes": "Cần hỗ trợ gấp"
  }'

# Test thêm rescue point (hỏa hoạn - từ cảm biến lửa)
curl -X POST http://localhost:3000/api/rescue-points \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 16.060553,
    "lng": 108.227380,
    "urgency": "critical",
    "type": "fire",
    "notes": "Phat hien hoa hoan tu dong boi cam bien lua - Tram 1"
  }'

# Test stations summary
curl http://localhost:3000/api/stations/summary

# Test gửi mực nước từ sensor
curl -X POST http://localhost:3000/api/water-level \
  -H "Content-Type: application/json" \
  -d '{"station_id": "1", "water_level": 250.00}'
```

### Test Frontend

Mở Developer Console (F12) và kiểm tra:
- Network tab: Xem các request API
- Console tab: Xem log và lỗi
- Application tab: Xem local storage

---

## 📝 Lịch sử Phát triển

Xem file `START_GUIDE.md` để biết chi tiết về các bug đã được fix:
- Sửa 9 lỗi trong `server.js`
- Sửa 8 lỗi trong `js/map.js`
- Hoàn thiện API endpoints
- Thêm dữ liệu mẫu

---

## 🤝 Contributing

Để đóng góp vào project:

1. Fork repository
2. Tạo branch mới (`git checkout -b feature/TenTinhNang`)
3. Commit changes (`git commit -m 'Thêm tính năng X'`)
4. Push to branch (`git push origin feature/TenTinhNang`)
5. Tạo Pull Request

---

## 📄 License

ISC License

---

## 👥 Tác giả

- **skii-pow** - Repository gốc
- **hoailuong123** - Bug fixes và improvements

---

## 📞 Liên hệ & Hỗ trợ

Nếu gặp vấn đề:
1. Kiểm tra phần **Xử lý Lỗi** ở trên
2. Xem file `START_GUIDE.md` để biết chi tiết các lỗi thường gặp
3. Mở issue trên GitHub repository

---

## 🎓 Công nghệ sử dụng

### Backend:
- **Node.js** - JavaScript runtime
- **Express.js 5** - Web framework
- **CSV Parser/Writer** - Xử lý dữ liệu CSV
- **CORS** - Cross-origin resource sharing

### Frontend:
- **Leaflet.js** - Thư viện bản đồ tương tác
- **OpenStreetMap** - Dữ liệu bản đồ
- **Vanilla JavaScript** - Không dùng framework
- **CSS3** - Styling hiện đại

### Dữ liệu:
- **CSV** - Lưu trữ dữ liệu đơn giản
- **GeoJSON** - Dữ liệu địa lý

---

**🌊 Chúc bạn sử dụng ứng dụng thành công! 🚀**
