// ============================================================
//  Flood Sensor — Combined Water Detector + Ultrasonic Gauge
//  Ultrasonic always fires every cycle.
//  sensorHeight auto-calibrates from dry readings:
//    • Startup (dry)  → average N readings → set sensorHeight
//    • Loop (dry)     → slowly refine sensorHeight via EMA
//    • Loop (wet)     → waterHeight = sensorHeight - distance
// ============================================================

// ---------- Pin definitions ----------
const int RAIN_DIGITAL_PIN = 3;   // Digital output of water sensor
const int BELL_PIN         = 4;   // Active buzzer / bell
const int TRIG_PIN         = 8;   // HC-SR04 Trig
const int ECHO_PIN         = 7;   // HC-SR04 Echo

// ---------- Configuration ----------
// Must match the station `id` in data/stations.csv for this device.
const int STATION_ID = 1;

// Analog threshold: readings BELOW this value mean water is present.
const int WATER_THRESHOLD = 600;

// Number of ultrasonic readings averaged during startup calibration.
const int CALIBRATION_SAMPLES = 10;

// Fallback height (cm) used only when water is detected at boot
// and calibration cannot run. Update to match your installation.
const float DEFAULT_SENSOR_HEIGHT = 200.0;

// EMA smoothing factor for live dry-cycle refinement.
// Lower = slower adaptation (more stable). Range: 0.01 – 0.2.
const float EMA_ALPHA = 0.05;

// Measured at runtime — do NOT make this const.
float sensorHeight = DEFAULT_SENSOR_HEIGHT;

// ---------------------------------------------------------------
// Fire one ultrasonic pulse and return distance in cm.
float measureDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);  // 10 µs pulse — HC-SR04 datasheet spec
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration = pulseIn(ECHO_PIN, HIGH);  // µs
  return duration / 2.0 / 29.412;                    // cm
}

// ---------------------------------------------------------------
void setup() {
  pinMode(RAIN_DIGITAL_PIN, INPUT);
  pinMode(BELL_PIN,         OUTPUT);
  pinMode(TRIG_PIN,         OUTPUT);
  pinMode(ECHO_PIN,         INPUT);
  Serial.begin(9600);

  delay(300);  // let sensors power up before first read

  int rainAnalog = analogRead(A0);

  if (rainAnalog < WATER_THRESHOLD) {
    // Water already present at boot — cannot calibrate safely.
    sensorHeight = DEFAULT_SENSOR_HEIGHT;
    Serial.print("CANH BAO: Phat hien nuoc khi khoi dong! ");
    Serial.print("Dung gia tri mac dinh: ");
    Serial.print(sensorHeight, 2);
    Serial.println(" cm");
  } else {
    // Dry — take CALIBRATION_SAMPLES readings and average them.
    Serial.println("Dang calibrate chieu cao kenh...");
    float sum = 0.0;
    for (int i = 0; i < CALIBRATION_SAMPLES; i++) {
      sum += measureDistance();
      delay(120);  // slightly longer than loop delay for clean readings
    }
    sensorHeight = sum / CALIBRATION_SAMPLES;

    Serial.print("Calibration hoan tat. CHIEU CAO KENH: ");
    Serial.print(sensorHeight, 2);
    Serial.println(" cm");
  }
}

// ---------------------------------------------------------------
void loop() {
  int   rainAnalog = analogRead(A0);
  float distance   = measureDistance();

  if (rainAnalog < WATER_THRESHOLD) {
    // ── Water detected ───────────────────────────────────────
    digitalWrite(BELL_PIN, HIGH);

    float waterHeight = sensorHeight - distance;
    if (waterHeight < 0) waterHeight = 0;  // clamp negatives

    Serial.print("TRANG THAI: co nuoc - ");
    Serial.print("TRAM: ");
    Serial.print(STATION_ID);
    Serial.print(" - MUC NUOC: ");
    Serial.print(waterHeight, 2);
    Serial.println(" cm");

  } else {
    // ── No water — refine sensorHeight with EMA ──────────────
    digitalWrite(BELL_PIN, LOW);
    sensorHeight = (EMA_ALPHA * distance) + ((1.0 - EMA_ALPHA) * sensorHeight);

    Serial.print("TRANG THAI: kho rao - ");
    Serial.print("TRAM: ");
    Serial.print(STATION_ID);
    Serial.print(" - CHIEU CAO KENH: ");
    Serial.print(sensorHeight, 2);
    Serial.println(" cm");
  }

  delay(500);
}
