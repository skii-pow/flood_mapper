// ============================================================
//  Flood Sensor v2 — ESP32 Edition
//  Uses accurate water level sensor (water_level_esp32.ino)
//  + HC-SR04 ultrasonic sensor.
//
//  Water level sensor behaviour:
//    DRY  (no water touching pads) → value ≈ 0
//    WET  (water rising)           → value increases
//    So: HIGHER value = MORE water  (opposite of rain sensor)
//
//  Confidence from two analog thresholds (no DO pin needed):
//    value > CONFIRMED_THRESHOLD → CONFIRMED  (clearly submerged)
//    value > LIKELY_THRESHOLD    → LIKELY     (barely touching)
//    value ≤ LIKELY_THRESHOLD    → DRY
//
//  sensorHeight auto-calibrates from dry readings:
//    • Startup (DRY)              → average N ultrasonic readings
//    • Loop (DRY)                 → refine via EMA
//    • Loop (LIKELY / CONFIRMED)  → waterHeight = sensorHeight - distance
//
//  WiFi enabled — POSTs waterHeight to server on LIKELY / CONFIRMED.
// ============================================================

#include <WiFi.h>
#include <HTTPClient.h>

// ---------- WiFi credentials ----------
const char* WIFI_SSID     = "Quynh Tram";
const char* WIFI_PASSWORD = "hoang@123";

// ---------- Server ----------
// Use your PC's LAN IP — NOT "localhost".
// Find it with: ipconfig → IPv4 Address
const char* SERVER_URL = "http://192.168.1.120:3000/api/water-level";

// ---------- Station ----------
const int STATION_ID = 1;

// ---------- Pin definitions ----------
// Water level sensor (from water_level_esp32.ino)
#define POWER_PIN  17   // TX2 — sensor VCC controlled output
#define SIGNAL_PIN 36   // VP  — sensor analog signal (ADC1, input-only, WiFi-safe)

// HC-SR04 ultrasonic
const int TRIG_PIN = 5;   // D5  — Trig
const int ECHO_PIN = 18;  // D18 — Echo (via 1kΩ/2kΩ voltage divider)

// Buzzer
const int BELL_PIN = 25;  // D25 — active buzzer

// ---------- Sound speed ----------
#define SOUND_SPEED  0.034      // cm per microsecond
#define CM_TO_INCH   0.393701

// ---------- Thresholds ----------
// New sensor: dry ≈ 0, wet increases.  Calibrate by observing
// "Level:" in Serial Monitor while dry / partially submerged / submerged.
//
//   LIKELY_THRESHOLD    — sensor pad just barely touching water
//   CONFIRMED_THRESHOLD — sensor clearly submerged
//
// Example starting values (adjust after calibration):
const int LIKELY_THRESHOLD    = 700;   // value > 700 → LIKELY water
const int CONFIRMED_THRESHOLD = 900;   // value > 900 → CONFIRMED water

// ---------- General config ----------
const int   CALIBRATION_SAMPLES   = 10;
const float EMA_ALPHA             = 0.05;
const float DEFAULT_SENSOR_HEIGHT = 200.0;

const unsigned long POST_INTERVAL = 2000;  // ms between server POSTs

// ---------- Water state ----------
enum WaterState { DRY, LIKELY, CONFIRMED };

// ---------- Runtime state ----------
float         sensorHeight = DEFAULT_SENSOR_HEIGHT;
unsigned long lastPostTime = 0;
WaterState    lastState    = DRY;   // tracks previous cycle state for transition detection

// ---------------------------------------------------------------
// Power sensor ON → stabilize → read → power OFF
// analogSetAttenuation(ADC_11db) is called in setup() so that
// the full 0–3.9V range maps to 0–4095 correctly.
int readWaterSensor() {
    digitalWrite(POWER_PIN, HIGH);
    delay(10);
    int value = analogRead(SIGNAL_PIN);
    digitalWrite(POWER_PIN, LOW);
    return value;
}

// ---------------------------------------------------------------
// Two-threshold confidence evaluation.
// Higher value = more water (no DO pin needed).
WaterState evaluateWater(int value) {
    if (value > CONFIRMED_THRESHOLD) return CONFIRMED;
    if (value > LIKELY_THRESHOLD)    return LIKELY;
    return DRY;
}

// ---------------------------------------------------------------
float measureDistance() {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);

    long  duration   = pulseIn(ECHO_PIN, HIGH);
    float distanceCm = duration * SOUND_SPEED / 2;
    return distanceCm;
}

// ---------------------------------------------------------------
void connectWiFi() {
    Serial.print("Dang ket noi WiFi: ");
    Serial.println(WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
        delay(500);
        Serial.print(".");
        attempts++;
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi ket noi thanh cong!");
        Serial.print("IP: ");
        Serial.println(WiFi.localIP());
    } else {
        Serial.println("\n[LOI] Khong the ket noi WiFi.");
    }
}

// ---------------------------------------------------------------
void postWaterLevel(float waterLevel, WaterState state) {
    if (WiFi.status() != WL_CONNECTED) { connectWiFi(); return; }
    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    String confidence = (state == CONFIRMED) ? "confirmed" :
                        (state == LIKELY)    ? "likely"    : "dry";
    String body = "{\"station_id\":\"" + String(STATION_ID) +
                  "\",\"water_level\":"  + String(waterLevel, 2) +
                  ",\"confidence\":\""  + confidence +
                  "\"}";
    int httpCode = http.POST(body);
    if      (httpCode == 200) Serial.println("  [OK] POST thanh cong");
    else if (httpCode >  0)   { Serial.print("  [LOI SERVER] HTTP "); Serial.println(httpCode); }
    else                      { Serial.print("  [LOI] "); Serial.println(http.errorToString(httpCode)); }
    http.end();
}

// ---------------------------------------------------------------
void setup() {
    Serial.begin(115200);

    // Required for accurate full-range ADC (0–3.9V → 0–4095)
    analogSetAttenuation(ADC_11db);

    pinMode(POWER_PIN, OUTPUT);
    digitalWrite(POWER_PIN, LOW);   // sensor off by default
    pinMode(TRIG_PIN,  OUTPUT);
    pinMode(ECHO_PIN,  INPUT);
    pinMode(BELL_PIN,  OUTPUT);
    // SIGNAL_PIN (VP / GPIO 36) is input-only — no pinMode needed

    connectWiFi();

    // ── Startup calibration ──────────────────────────────────
    delay(300);
    int        level = readWaterSensor();
    WaterState state = evaluateWater(level);

    Serial.print("Startup | Level: ");
    Serial.println(level);

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
    int        level      = readWaterSensor();
    WaterState state      = evaluateWater(level);
    float      distanceCm = measureDistance();

    // ── Debug line ───────────────────────────────────────────
    Serial.print("Level: ");
    Serial.print(level);
    Serial.print(" | Distance: ");
    Serial.print(distanceCm, 2);
    Serial.print(" cm (");
    Serial.print(distanceCm * CM_TO_INCH, 2);
    Serial.println(" in)");

    // ── Cross-validate: ultrasonic overrides level sensor ────
    float waterHeight = sensorHeight - distanceCm;
    if (waterHeight < 0) waterHeight = 0;

    if ((state == CONFIRMED || state == LIKELY) && waterHeight == 0) {
        // Level sensor triggered but ultrasonic sees no water above floor
        // → false positive (condensation / humidity). Force DRY.
        state = DRY;
    }

    if (state == CONFIRMED || state == LIKELY) {
        // ── Both sensors agree: water present ────────────────
        digitalWrite(BELL_PIN, HIGH);

        Serial.print("TRANG THAI: co nuoc");
        Serial.print(state == CONFIRMED ? " [XAC NHAN]" : " [CO THE]");
        Serial.print(" - TRAM: ");
        Serial.print(STATION_ID);
        Serial.print(" - MUC NUOC: ");
        Serial.print(waterHeight, 2);
        Serial.println(" cm");

        // POST periodically while wet
        unsigned long now = millis();
        if (now - lastPostTime >= POST_INTERVAL) {
            postWaterLevel(waterHeight, state);
            lastPostTime = now;
        }

    } else {
        // ── DRY ──────────────────────────────────────────────
        digitalWrite(BELL_PIN, LOW);
        sensorHeight = (EMA_ALPHA * distanceCm) + ((1.0 - EMA_ALPHA) * sensorHeight);

        Serial.print("TRANG THAI: kho rao");
        if (waterHeight == 0 && lastState != DRY) {
            Serial.print(" [MUC NUOC VE 0]");
        }
        Serial.print(" - TRAM: ");
        Serial.print(STATION_ID);
        Serial.print(" - CHIEU CAO KENH: ");
        Serial.print(sensorHeight, 2);
        Serial.println(" cm");

        // POST once when transitioning wet → dry (waterHeight = 0)
        if (lastState != DRY) {
            Serial.println("  [CHUYEN TRANG THAI: nuoc → kho] POST lan cuoi...");
            postWaterLevel(0, DRY);
            lastPostTime = millis();
        }
    }

    lastState = state;   // remember state for next cycle
    delay(500);
}
