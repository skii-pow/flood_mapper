#define POWER_PIN 32
#define A0_PIN 36

void setup() {
    Serial.begin(115200);
    pinMode(POWER_PIN, OUTPUT);
}

void loop() {
    digitalWrite(POWER_PIN, HIGH);
    delay(10);
    int analogValue = analogRead(A0_PIN);
    digitalWrite(POWER_PIN, LOW);
    Serial.println(analogValue);
    delay(1000);
}