int rainAnalog;
int rainDigital = 3; 
int rainDigital_stus;
int bell = 4;

void setup() {
  pinMode(rainDigital, INPUT);
  pinMode(bell, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  // Đọc giá trị từ cảm biến
  rainDigital_stus = digitalRead(rainDigital);
  rainAnalog = analogRead(A0);

 
  if (rainAnalog < 600) {
    digitalWrite(bell, HIGH); // Bật chuông
    Serial.print("TRANG THAI: co nuoc - ");
  } 
  else {
    digitalWrite(bell, LOW);  // Tắt chuông
    Serial.print("TRANG THAI: kho rao - ");
  }

  delay(200);
}