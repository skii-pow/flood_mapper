#define POWER_PIN 17
#define SIGNAL_PIN 36

int value = 0;

void setup()
{
    Serial.begin(9600);
    analogSetAttenuation(ADC_11db);
    pinMode(POWER_PIN, OUTPUT);
    digitalWrite(POWER_PIN, LOW);
}

void loop()
{
    digitalWrite(POWER_PIN, HIGH);
    delay(10);
    value = analogRead(SIGNAL_PIN);
    digitalWrite(POWER_PIN, LOW);

    Serial.print("The water sensor value: ");
    Serial.println(value);

    delay(1000);
}
