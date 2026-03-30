// ============================================================
//  Flood Sensor — ESP32 Edition
//  Dual water sensor reading: AO (analog) + DO (digital)
//  combined for accurate water detection confidence level.
//
//  Confidence logic:
//    AO < threshold  AND  DO == LOW  → CONFIRMED (both agree)
//    AO < threshold  OR   DO == LOW  → LIKELY    (one detects)
//    AO >= threshold AND  DO == HIGH → DRY        (both agree)
//
//  sensorHeight auto-calibrates from dry readings:
//    • Startup (dry)     → average N readings → set sensorHeight
//    • Loop (DRY)        → refine sensorHeight via EMA
//    • Loop (LIKELY/CONFIRMED) → waterHeight = sensorHeight - distance
//
//  POSTs waterHeight to server only on LIKELY or CONFIRMED.
// ============================================================

// #include <WiFi.h>
// #include <HTTPClient.h>

// // ---------- WiFi credentials ----------
// const char* WIFI_SSID     = "FloodMapper";
// const char* WIFI_PASSWORD = "0123456788";

// // ---------- Server ----------
// // Use your PC's LAN IP — NOT "localhost".
// // Find it with: ipconfig → IPv4 Address (e.g. 192.168.1.105)
// const char* SERVER_URL = "http://192.168.1.100:3000/api/water-level";

// ---------- Station ----------
// Must match the station `id` in data/stations.csv for this device.
const int STATION_ID = 1;

// ---------- Pin definitions ----------
#define POWER_PIN 32    // D32 — water sensor VCC (controlled output)
#define A0_PIN    36    // VP  — water sensor AO, analog (ADC1, WiFi-safe)
const int DO_PIN   = 26; // D26 — water sensor DO, digital (LOW = water)

const int TRIG_PIN = 5;   // D5  — HC-SR04 Trig
const int ECHO_PIN = 18;  // D18 — HC-SR04 Echo (via voltage divider)
const int BELL_PIN = 25;  // D25 — active buzzer

// ---------- Sound speed ----------
#define SOUND_SPEED  0.034      // cm per microsecond
#define CM_TO_INCH   0.393701

// ---------- Configuration ----------
// Calibration data: wet < 3500, dry > 3800.
// HYSTERESIS prevents flickering at the boundary:
//   Water detected when AO drops BELOW 3500 (WATER_THRESHOLD)
//   Water cleared  when AO rises ABOVE 3800 (WATER_THRESHOLD + WATER_HYSTERESIS)
const int   WATER_THRESHOLD       = 3500;  // enter wet  when AO drops below 3500
const int   WATER_HYSTERESIS      = 150;   // exit  wet  when AO rises above 3800

// AO is the primary/authoritative sensor.
// DO is unreliable on this unit — it can only CONFIRM an AO detection,
// it can never override an AO dry reading.
const int   CALIBRATION_SAMPLES   = 10;
const float EMA_ALPHA             = 0.05;
const float DEFAULT_SENSOR_HEIGHT = 200.0;

const unsigned long POST_INTERVAL = 2000;  // ms between server POSTs

// ---------- Water state ----------
enum WaterState { DRY, LIKELY, CONFIRMED };

// Holds one reading from both AO and DO
struct WaterReading {
    int  analogValue;   // raw AO value (0–4095)
    bool doWater;       // true = DO pin is LOW (hardware threshold triggered)
};

// ---------- Runtime state ----------
float         sensorHeight = DEFAULT_SENSOR_HEIGHT;
unsigned long lastPostTime = 0;
bool          wasWet       = false;   // hysteresis state tracker

// ---------------------------------------------------------------
// Power sensor ON → read both AO and DO → power OFF
WaterReading readWaterSensor() {
    WaterReading r;
    digitalWrite(POWER_PIN, HIGH);
    delay(10);                              // stabilize before reading
    r.analogValue = analogRead(A0_PIN);
    r.doWater     = (digitalRead(DO_PIN) == LOW);
    digitalWrite(POWER_PIN, LOW);           // cut power → prevent corrosion
    return r;
}

// ---------------------------------------------------------------
// Combine AO (primary) and DO (secondary) into a confidence level.
// AO is authoritative — DO can only confirm, never override.
//
// Hysteresis prevents flicker at the wet/dry boundary:
//   Enter wet  when AO < WATER_THRESHOLD            (3500)
//   Exit  wet  when AO > WATER_THRESHOLD+HYSTERESIS (3800)
WaterState evaluateWater(WaterReading r) {
    bool aoWater;

    if (!wasWet) {
        // Currently dry → need AO to drop below threshold to detect water
        aoWater = (r.analogValue < WATER_THRESHOLD);
    } else {
        // Currently wet → need AO to rise above threshold+hysteresis to clear
        aoWater = (r.analogValue < WATER_THRESHOLD + WATER_HYSTERESIS);
    }
    wasWet = aoWater;  // update hysteresis state

    if (!aoWater) return DRY;              // AO says dry → trust it, ignore DO

    // AO says water — DO can upgrade LIKELY to CONFIRMED
    if (r.doWater) return CONFIRMED;       // both agree: high confidence
    return LIKELY;                         // AO detected, DO missed it: still water
}

// ---------------------------------------------------------------
float measureDistance() {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    long duration    = pulseIn(ECHO_PIN, HIGH);
    float distanceCm = duration * SOUND_SPEED / 2;
    return distanceCm;
}

// // ---------------------------------------------------------------
// void connectWiFi() {
//     Serial.print("Dang ket noi WiFi: ");
//     Serial.println(WIFI_SSID);
//     WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
//
//     int attempts = 0;
//     while (WiFi.status() != WL_CONNECTED && attempts < 20) {
//         delay(500);
//         Serial.print(".");
//         attempts++;
//     }
//
//     if (WiFi.status() == WL_CONNECTED) {
//         Serial.println("\nWiFi ket noi thanh cong!");
//         Serial.print("IP cua thiet bi: ");
//         Serial.println(WiFi.localIP());
//     } else {
//         Serial.println("\n[LOI] Khong the ket noi WiFi. Kiem tra lai SSID/mat khau.");
//     }
// }
//
// // ---------------------------------------------------------------
// void postWaterLevel(float waterLevel, WaterState state) {
//     if (WiFi.status() != WL_CONNECTED) {
//         Serial.println("  [WiFi] Mat ket noi, dang thu lai...");
//         connectWiFi();
//         return;
//     }
//
//     HTTPClient http;
//     http.begin(SERVER_URL);
//     http.addHeader("Content-Type", "application/json");
//
//     String body = "{\"station_id\":\"" + String(STATION_ID) +
//                   "\",\"water_level\":"  + String(waterLevel, 2) +
//                   ",\"confidence\":\""  + (state == CONFIRMED ? "confirmed" : "likely") +
//                   "\"}";
//
//     int httpCode = http.POST(body);
//
//     if (httpCode == 200) {
//         Serial.println("  [OK] POST thanh cong → server");
//     } else if (httpCode > 0) {
//         Serial.print("  [LOI SERVER] HTTP ");
//         Serial.println(httpCode);
//     } else {
//         Serial.print("  [LOI KET NOI] ");
//         Serial.println(http.errorToString(httpCode));
//     }
//
//     http.end();
// }

// ---------------------------------------------------------------
void setup() {
    Serial.begin(115200);
    pinMode(POWER_PIN, OUTPUT);
    pinMode(DO_PIN,    INPUT_PULLUP);  // DO: LOW = water, HIGH = dry
    pinMode(TRIG_PIN,  OUTPUT);
    pinMode(ECHO_PIN,  INPUT);
    pinMode(BELL_PIN,  OUTPUT);
    // VP (GPIO 36 / A0_PIN) is input-only — no pinMode needed

    // connectWiFi();

    // ── Startup calibration ──────────────────────────────────
    delay(300);
    WaterReading  r     = readWaterSensor();
    WaterState    state = evaluateWater(r);

    Serial.print("Startup | AO: ");
    Serial.print(r.analogValue);
    Serial.print(" | DO: ");
    Serial.println(r.doWater ? "co nuoc" : "kho");

    if (state != DRY) {
        sensorHeight = DEFAULT_SENSOR_HEIGHT;
        Serial.print("CANH BAO: Phat hien nuoc khi khoi dong! ");
        Serial.print("Dung gia tri mac dinh: ");
        Serial.print(sensorHeight, 2);
        Serial.println(" cm");
    } else {
        Serial.println("Dang calibrate chieu cao kenh...");
        float sum = 0.0;
        for (int i = 0; i < CALIBRATION_SAMPLES; i++) {
            sum += measureDistance();
            delay(120);
        }
        sensorHeight = sum / CALIBRATION_SAMPLES;
        Serial.print("Calibration hoan tat. CHIEU CAO KENH: ");
        Serial.print(sensorHeight, 2);
        Serial.println(" cm");
    }
}

// ---------------------------------------------------------------
void loop() {
    WaterReading r      = readWaterSensor();
    WaterState   state  = evaluateWater(r);
    float distanceCm    = measureDistance();

    // ── Debug line: always printed ───────────────────────────
    Serial.print("AO: ");
    Serial.print(r.analogValue);
    Serial.print(" | DO: ");
    Serial.print(r.doWater ? "co nuoc" : "kho");
    Serial.print(" | Distance: ");
    Serial.print(distanceCm, 2);
    Serial.print(" cm (");
    Serial.print(distanceCm * CM_TO_INCH, 2);
    Serial.println(" in)");

    if (state == CONFIRMED || state == LIKELY) {
        // ── Water detected ───────────────────────────────────
        digitalWrite(BELL_PIN, HIGH);

        float waterHeight = sensorHeight - distanceCm;
        if (waterHeight < 0) waterHeight = 0;

        Serial.print("TRANG THAI: co nuoc");
        Serial.print(state == CONFIRMED ? " [XAC NHAN]" : " [CO THE]");
        Serial.print(" - TRAM: ");
        Serial.print(STATION_ID);
        Serial.print(" - MUC NUOC: ");
        Serial.print(waterHeight, 2);
        Serial.println(" cm");

        // unsigned long now = millis();
        // if (now - lastPostTime >= POST_INTERVAL) {
        //     postWaterLevel(waterHeight, state);
        //     lastPostTime = now;
        // }

    } else {
        // ── DRY — both sensors agree, refine sensorHeight ────
        digitalWrite(BELL_PIN, LOW);
        sensorHeight = (EMA_ALPHA * distanceCm) + ((1.0 - EMA_ALPHA) * sensorHeight);

        Serial.print("TRANG THAI: kho rao [XAC NHAN]");
        Serial.print(" - TRAM: ");
        Serial.print(STATION_ID);
        Serial.print(" - CHIEU CAO KENH: ");
        Serial.print(sensorHeight, 2);
        Serial.println(" cm");
    }

    delay(500);
}
