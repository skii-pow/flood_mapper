// ===== Flame Sensor Local Read =====
const int FLAME_PIN = 4;

int lastState = HIGH;

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(FLAME_PIN, INPUT);
  Serial.println("Flame sensor monitor started...");
}

void loop() {
  int state = digitalRead(FLAME_PIN);

  if (state != lastState) {
    if (state == LOW) {
      Serial.println("🔥 PHÁT HIỆN NGỌN LỬA!");
    } else {
      Serial.println("🟢 Không có lửa");
    }
    lastState = state;
  }

  delay(50);
}