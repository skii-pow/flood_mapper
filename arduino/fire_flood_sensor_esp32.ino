// ============================================================
//  Flood + Fire Sensor — ESP32 Edition
//  Combines flood_sensor_v2_esp32 with a flame sensor.
//
//  FLOOD logic (unchanged from v2):
//    Water level sensor (analog) + HC-SR04 ultrasonic.
//    sensorHeight fixed at SENSOR_HEIGHT cm.
//    LEDs and buzzer show flood severity:
//      ≥ 1 cm → green   (safe)
//      ≥ 2 cm → yellow  (warning)
//      ≥ 3 cm → red + buzzer (danger)
//    POSTs scaled waterHeight (× SCALE_RATIO) to /api/water-level.
//
//  FIRE logic:
//    Flame sensor on FLAME_PIN (digital, active LOW).
//    FLAME_CONFIRM_COUNT consecutive LOW readings → fire confirmed.
//    On new fire event: POSTs to /api/rescue-points with type="fire".
//    Alarm resets (ready to report again) once sensor goes back HIGH.
//    FIRE_COOLDOWN_MS minimum time between consecutive fire POSTs.
//
//  POST sequence (flood):
//    • Startup (dry)  → POST once with water_level = 0
//    • Dry            → POST every 1 minute (keep-alive)
//    • Wet            → POST every 2 seconds
//    • Wet → Dry      → POST once immediately, then every 1 minute
// ============================================================

#include <WiFi.h>
#include <HTTPClient.h>

// ---------- WiFi credentials ----------
const char* WIFI_SSID     = "Baba";
const char* WIFI_PASSWORD = "nguyenquanglinh";

// ---------- Server ----------
const char* SERVER_BASE   = "http://172.20.10.2:3000";
const char* WATER_URL     = "http://172.20.10.2:3000/api/water-level";
const char* RESCUE_URL    = "http://172.20.10.2:3000/api/rescue-points";

// ---------- Station ----------
const int   STATION_ID    = 1;

// Location of this sensor (used for fire rescue-point POSTs).
// Update these to match the physical position of your device.
const float STATION_LAT   = 16.033657;
const float STATION_LNG   = 108.221039;

// ──────────────────────────────────────────────────────────────
//  Pin definitions
// ──────────────────────────────────────────────────────────────
// Water level sensor
#define POWER_PIN  17   // TX2 — sensor VCC controlled output
#define SIGNAL_PIN 36   // VP  — analog signal (ADC1, input-only)

// HC-SR04 ultrasonic
const int TRIG_PIN = 5;   // D5
const int ECHO_PIN = 18;  // D18 (via 1kΩ/2kΩ voltage divider)

// Buzzer
const int BELL_PIN = 25;  // D25

// Flood indicator LEDs
const int GREEN_LED_PIN  = 26;  // D26 — green  (≥ 1 cm)
const int YELLOW_LED_PIN = 27;  // D27 — yellow (≥ 2 cm)
const int RED_LED_PIN    = 14;  // D14 — red    (≥ 3 cm)

// Flame sensor
const int FLAME_PIN = 4;   // D4 — digital output (LOW = fire detected)

// ──────────────────────────────────────────────────────────────
//  Constants
// ──────────────────────────────────────────────────────────────
#define SOUND_SPEED  0.034
#define CM_TO_INCH   0.393701

const int   LIKELY_THRESHOLD    = 700;
const int   CONFIRMED_THRESHOLD = 900;

const float SENSOR_HEIGHT = 7.8;   // fixed HC-SR04 to channel floor (cm)
const float SCALE_RATIO   = 100.0; // 1:100 model scale

const unsigned long POST_INTERVAL_WET = 2000;   // 2s while wet
const unsigned long POST_INTERVAL_DRY = 60000;  // 60s keep-alive

// Flame sensor: require this many consecutive LOW reads to confirm fire
const int FLAME_CONFIRM_COUNT = 5;
// Minimum ms between two fire rescue-point POSTs (30 s cooldown)
const unsigned long FIRE_COOLDOWN_MS = 30000;

// ──────────────────────────────────────────────────────────────
//  Runtime state
// ──────────────────────────────────────────────────────────────
enum WaterState { DRY, LIKELY, CONFIRMED };

float         sensorHeight  = SENSOR_HEIGHT;
unsigned long lastPostTime  = 0;
WaterState    lastState     = DRY;

int           flameSamples  = 0;    // consecutive LOW reads
bool          fireActive    = false; // true while fire event is in progress
unsigned long lastFirePost  = 0;

// ──────────────────────────────────────────────────────────────
//  Flood sensor helpers
// ──────────────────────────────────────────────────────────────
int readWaterSensor() {
    digitalWrite(POWER_PIN, HIGH);
    delay(10);
    int v = analogRead(SIGNAL_PIN);
    digitalWrite(POWER_PIN, LOW);
    return v;
}

WaterState evaluateWater(int value) {
    if (value > CONFIRMED_THRESHOLD) return CONFIRMED;
    if (value > LIKELY_THRESHOLD)    return LIKELY;
    return DRY;
}

float measureDistance() {
    digitalWrite(TRIG_PIN, LOW);
    delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH);
    delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long duration = pulseIn(ECHO_PIN, HIGH);
    return duration * SOUND_SPEED / 2;
}

// Drive LEDs and buzzer from model-scale waterHeight
void updateIndicators(float waterHeight) {
    if (waterHeight >= 3.0) {
        digitalWrite(GREEN_LED_PIN,  LOW);
        digitalWrite(YELLOW_LED_PIN, LOW);
        digitalWrite(RED_LED_PIN,    HIGH);
        digitalWrite(BELL_PIN,       HIGH);
    } else if (waterHeight >= 2.0) {
        digitalWrite(GREEN_LED_PIN,  LOW);
        digitalWrite(YELLOW_LED_PIN, HIGH);
        digitalWrite(RED_LED_PIN,    LOW);
        digitalWrite(BELL_PIN,       LOW);
    } else if (waterHeight >= 1.0) {
        digitalWrite(GREEN_LED_PIN,  HIGH);
        digitalWrite(YELLOW_LED_PIN, LOW);
        digitalWrite(RED_LED_PIN,    LOW);
        digitalWrite(BELL_PIN,       LOW);
    } else {
        digitalWrite(GREEN_LED_PIN,  LOW);
        digitalWrite(YELLOW_LED_PIN, LOW);
        digitalWrite(RED_LED_PIN,    LOW);
        digitalWrite(BELL_PIN,       LOW);
    }
}

// ──────────────────────────────────────────────────────────────
//  Network helpers
// ──────────────────────────────────────────────────────────────
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

void postWaterLevel(float waterLevel, WaterState state) {
    if (WiFi.status() != WL_CONNECTED) { connectWiFi(); return; }
    HTTPClient http;
    http.begin(WATER_URL);
    http.addHeader("Content-Type", "application/json");
    String confidence = (state == CONFIRMED) ? "confirmed" :
                        (state == LIKELY)    ? "likely"    : "dry";
    String body = "{\"station_id\":\"" + String(STATION_ID) +
                  "\",\"water_level\":"  + String(waterLevel, 2) +
                  ",\"confidence\":\""  + confidence + "\"}";
    int code = http.POST(body);
    if      (code == 200) Serial.println("  [OK] POST nuoc thanh cong");
    else if (code >  0)   { Serial.print("  [LOI SERVER] HTTP "); Serial.println(code); }
    else                  { Serial.print("  [LOI] "); Serial.println(http.errorToString(code)); }
    http.end();
}

void postFireRescuePoint() {
    if (WiFi.status() != WL_CONNECTED) { connectWiFi(); return; }
    HTTPClient http;
    http.begin(RESCUE_URL);
    http.addHeader("Content-Type", "application/json");
    String body = "{\"lat\":"      + String(STATION_LAT, 6) +
                  ",\"lng\":"      + String(STATION_LNG, 6) +
                  ",\"urgency\":\"critical\""
                  ",\"type\":\"fire\""
                  ",\"notes\":\"Phat hien hoa hoan tu dong boi cam bien lua - Tram " + String(STATION_ID) + "\"}";
    int code = http.POST(body);
    if      (code == 200) Serial.println("  [OK] POST hoa hoan thanh cong");
    else if (code >  0)   { Serial.print("  [LOI SERVER] HTTP "); Serial.println(code); }
    else                  { Serial.print("  [LOI] "); Serial.println(http.errorToString(code)); }
    http.end();
}

// ──────────────────────────────────────────────────────────────
//  setup
// ──────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    analogSetAttenuation(ADC_11db);

    pinMode(POWER_PIN,      OUTPUT); digitalWrite(POWER_PIN,      LOW);
    pinMode(TRIG_PIN,       OUTPUT);
    pinMode(ECHO_PIN,       INPUT);
    pinMode(BELL_PIN,       OUTPUT); digitalWrite(BELL_PIN,       LOW);
    pinMode(GREEN_LED_PIN,  OUTPUT); digitalWrite(GREEN_LED_PIN,  LOW);
    pinMode(YELLOW_LED_PIN, OUTPUT); digitalWrite(YELLOW_LED_PIN, LOW);
    pinMode(RED_LED_PIN,    OUTPUT); digitalWrite(RED_LED_PIN,    LOW);
    pinMode(FLAME_PIN,      INPUT);
    // SIGNAL_PIN (VP / GPIO 36) is input-only — no pinMode needed

    connectWiFi();

    Serial.print("CHIEU CAO CAM BIEN (co dinh): ");
    Serial.print(sensorHeight, 2);
    Serial.println(" cm");

    Serial.println("Startup POST: kho rao, muc nuoc = 0...");
    postWaterLevel(0, DRY);
    lastPostTime = millis();
}

// ──────────────────────────────────────────────────────────────
//  loop
// ──────────────────────────────────────────────────────────────
void loop() {
    // ── Flame sensor ─────────────────────────────────────────
    int flameReading = digitalRead(FLAME_PIN);
    if (flameReading == LOW) {
        flameSamples = min(flameSamples + 1, FLAME_CONFIRM_COUNT + 1);
    } else {
        flameSamples = max(flameSamples - 1, 0);
        if (flameSamples == 0) fireActive = false;  // fire cleared — reset for next event
    }

    if (flameSamples >= FLAME_CONFIRM_COUNT) {
        unsigned long now = millis();
        if (!fireActive || (now - lastFirePost >= FIRE_COOLDOWN_MS)) {
            Serial.println("!!! PHAT HIEN HOA HOAN !!! -> POST diem cuu ho...");
            postFireRescuePoint();
            fireActive   = true;
            lastFirePost = now;
        }
    }

    // ── Flood sensor ─────────────────────────────────────────
    int        level      = readWaterSensor();
    WaterState state      = evaluateWater(level);
    float      distanceCm = measureDistance();

    Serial.print("Level: "); Serial.print(level);
    Serial.print(" | Flame: "); Serial.print(flameReading == LOW ? "FIRE" : "OK");
    Serial.print(" | Distance: "); Serial.print(distanceCm, 2);
    Serial.println(" cm");

    float waterHeight = sensorHeight - distanceCm;
    if (waterHeight < 0) waterHeight = 0;

    if ((state == CONFIRMED || state == LIKELY) && waterHeight == 0) {
        state = DRY;
    }

    updateIndicators((state == DRY) ? 0 : waterHeight);

    if (state == CONFIRMED || state == LIKELY) {
        Serial.print("TRANG THAI: co nuoc");
        Serial.print(state == CONFIRMED ? " [XAC NHAN]" : " [CO THE]");
        Serial.print(" - MUC NUOC (mo hinh): "); Serial.print(waterHeight, 2);
        Serial.print(" cm | (thuc te x100): "); Serial.print(waterHeight * SCALE_RATIO, 1);
        Serial.println(" cm");

        unsigned long now = millis();
        if (now - lastPostTime >= POST_INTERVAL_WET) {
            postWaterLevel(waterHeight * SCALE_RATIO, state);
            lastPostTime = now;
        }

    } else {
        Serial.print("TRANG THAI: kho rao");
        if (waterHeight == 0 && lastState != DRY) Serial.print(" [MUC NUOC VE 0]");
        Serial.print(" - CHIEU CAO KENH: "); Serial.print(sensorHeight, 2); Serial.println(" cm");

        unsigned long now = millis();
        if (lastState != DRY) {
            Serial.println("  [CHUYEN TRANG THAI: nuoc -> kho] POST ngay...");
            postWaterLevel(0, DRY);
            lastPostTime = now;
        } else if (now - lastPostTime >= POST_INTERVAL_DRY) {
            Serial.println("  [KHO RAO - KEEP ALIVE] POST dinh ky 1 phut...");
            postWaterLevel(0, DRY);
            lastPostTime = now;
        }
    }

    lastState = state;
    delay(500);
}
