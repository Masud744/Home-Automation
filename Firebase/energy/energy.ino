#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// -------- WIFI --------
#define WIFI_SSID     "Masud Plays"
#define WIFI_PASSWORD "44444444"

// -------- FIREBASE --------
#define FIREBASE_HOST "https://homeautomationesp32-bc13f-default-rtdb.asia-southeast1.firebasedatabase.app"
#define DEVICE_PATH   "/devices/esp32_1"

// -------- PINS --------
#define RELAY1_PIN     5
#define RELAY2_PIN     17
#define SWITCH1_PIN    18
#define SWITCH2_PIN    19
#define CURRENT1_PIN   34
#define CURRENT2_PIN   35
#define VOLTAGE_PIN    32

WiFiClientSecure client;
HTTPClient https;

// -------- ENERGY --------
float session_wh = 0;
float today_wh   = 0;
float month_wh   = 0;
float total_wh   = 0;

// -------- BILLING --------
float unit_rate = 7.5;

// -------- TIMING --------
unsigned long lastMillis = 0;

// -------- CALIBRATION --------
float ACS_SENS = 0.066;   // ACS712-30A (V/A)
float ZMPT_CAL = 260.0;   // Voltage calibration (tune later)

// -------- SENSOR FUNCTIONS --------
float readVoltage() {
  long sum = 0;
  for (int i = 0; i < 200; i++) {
    int raw = analogRead(VOLTAGE_PIN);
    sum += (raw - 2048) * (raw - 2048);
    delayMicroseconds(200);
  }
  float rms = sqrt(sum / 200.0);
  float voltage = (rms / 2048.0) * ZMPT_CAL;
  return voltage;
}

float readCurrent(int pin) {
  long sum = 0;
  for (int i = 0; i < 200; i++) {
    int raw = analogRead(pin);
    sum += (raw - 2048) * (raw - 2048);
    delayMicroseconds(200);
  }
  float rms = sqrt(sum / 200.0);
  float voltage = (rms / 2048.0) * 3.3;
  float current = voltage / ACS_SENS;
  return current < 0.05 ? 0 : current; // noise cutoff
}

// -------- FIREBASE PUT --------
void firebasePUT(String path, JsonDocument &doc) {
  String url = String(FIREBASE_HOST) + path + ".json";
  https.begin(client, url);
  https.addHeader("Content-Type", "application/json");
  String payload;
  serializeJson(doc, payload);
  https.PUT(payload);
  https.end();
}

// -------- SETUP --------
void setup() {
  Serial.begin(115200);

  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  pinMode(SWITCH1_PIN, INPUT_PULLUP);
  pinMode(SWITCH2_PIN, INPUT_PULLUP);

  digitalWrite(RELAY1_PIN, HIGH);
  digitalWrite(RELAY2_PIN, HIGH);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);

  client.setInsecure();

  StaticJsonDocument<128> info;
  info["ip"] = WiFi.localIP().toString();
  info["status"] = "online";
  firebasePUT(String(DEVICE_PATH) + "/info", info);
}

// -------- LOOP --------
void loop() {

  // ---- READ CONTROL ----
  https.begin(client, String(FIREBASE_HOST) + DEVICE_PATH + "/control.json");
  https.GET();
  String control = https.getString();
  https.end();

  bool r1 = control.indexOf("\"relay1\":1") >= 0 || digitalRead(SWITCH1_PIN) == LOW;
  bool r2 = control.indexOf("\"relay2\":1") >= 0 || digitalRead(SWITCH2_PIN) == LOW;

  digitalWrite(RELAY1_PIN, r1 ? LOW : HIGH);
  digitalWrite(RELAY2_PIN, r2 ? LOW : HIGH);

  // ---- SENSORS ----
  float voltage = readVoltage();
  float i1 = r1 ? readCurrent(CURRENT1_PIN) : 0;
  float i2 = r2 ? readCurrent(CURRENT2_PIN) : 0;
  float power = voltage * (i1 + i2);

  // ---- ENERGY ----
  if (millis() - lastMillis >= 1000) {
    lastMillis = millis();
    float wh = power / 3600.0;
    session_wh += wh;
    today_wh   += wh;
    month_wh   += wh;
    total_wh   += wh;
  }

  // ---- MONTH RESET FLAG ----
  https.begin(client, String(FIREBASE_HOST) + DEVICE_PATH + "/settings/reset_monthly.json");
  https.GET();
  String resetFlag = https.getString();
  https.end();

  if (resetFlag.indexOf("true") >= 0) {
    month_wh = 0;
    StaticJsonDocument<64> reset;
    reset["reset_monthly"] = false;
    firebasePUT(String(DEVICE_PATH) + "/settings", reset);
  }

  // ---- PUSH SENSORS ----
  StaticJsonDocument<128> sensors;
  sensors["voltage"] = voltage;
  sensors["current1"] = i1;
  sensors["current2"] = i2;
  sensors["power"] = power;
  firebasePUT(String(DEVICE_PATH) + "/sensors", sensors);

  // ---- PUSH ENERGY ----
  StaticJsonDocument<256> energy;
  energy["session_wh"] = session_wh;
  energy["today_wh"]   = today_wh;
  energy["month_wh"]   = month_wh;
  energy["total_wh"]   = total_wh;
  firebasePUT(String(DEVICE_PATH) + "/energy", energy);

  Serial.printf(
    "R1:%d R2:%d | V:%.1f | I1:%.2f I2:%.2f | P:%.1fW | E:%.2fWh\n",
    r1, r2, voltage, i1, i2, power, total_wh
  );

  delay(1500);
}
