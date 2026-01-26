#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "DHT.h"

// -------- WIFI --------
#define WIFI_SSID     "Masud Plays"
#define WIFI_PASSWORD "44444444"

// -------- FIREBASE --------
#define FIREBASE_HOST "https://homeautomationesp32-bc13f-default-rtdb.asia-southeast1.firebasedatabase.app"
#define DEVICE_PATH   "/devices/esp32_2"

// -------- PINS (UNCHANGED) --------
#define TRIG_PIN     5
#define ECHO_PIN     18
#define DHTPIN       4
#define DHTTYPE      DHT22
#define GAS_PIN      34
#define BUZZER_PIN   27
#define RELAY_PIN    26
#define SWITCH_PIN   25

DHT dht(DHTPIN, DHTTYPE);
WiFiClientSecure client;
HTTPClient https;

// -------- HELPERS --------
void firebasePUT(String path, JsonDocument &doc) {
  https.begin(client, String(FIREBASE_HOST) + path + ".json");
  https.addHeader("Content-Type", "application/json");
  String payload;
  serializeJson(doc, payload);
  https.PUT(payload);
  https.end();
}

// -------- SETUP --------
void setup() {
  Serial.begin(115200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(GAS_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(SWITCH_PIN, INPUT_PULLUP);

  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(RELAY_PIN, LOW);

  dht.begin();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);

  client.setInsecure();

  // -------- PUSH INFO --------
  StaticJsonDocument<128> info;
  info["ip"] = WiFi.localIP().toString();
  info["status"] = "online";
  firebasePUT(String(DEVICE_PATH) + "/info", info);

  Serial.println("ESP32_2 ONLINE");
}

// -------- LOOP --------
void loop() {

  // -------- READ CONTROL --------
  https.begin(client, String(FIREBASE_HOST) + DEVICE_PATH + "/control.json");
  https.GET();
  String control = https.getString();
  https.end();

  bool pumpFirebase = control.indexOf("\"pump\":1") >= 0;
  bool sourceFirebase = control.indexOf("\"source\":\"firebase\"") >= 0;

  bool manualSwitch = digitalRead(SWITCH_PIN) == LOW;

  bool pumpState = sourceFirebase ? pumpFirebase : manualSwitch;
  digitalWrite(RELAY_PIN, pumpState ? HIGH : LOW);

  // -------- ULTRASONIC --------
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  float distance = duration == 0 ? 0 : duration * 0.034 / 2;

  int waterLevel = (distance <= 10) ? 2 : (distance <= 20 ? 1 : 0);

  // -------- DHT --------
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();
  if (isnan(temp) || isnan(hum)) temp = hum = 0;

  // -------- GAS --------
  int gas = analogRead(GAS_PIN);

  bool danger = (gas > 1800 || waterLevel == 2);
  digitalWrite(BUZZER_PIN, danger ? HIGH : LOW);

  // -------- PUSH SENSORS --------
  StaticJsonDocument<256> sensors;
  sensors["distance_cm"] = distance;
  sensors["water_level"] = waterLevel;
  sensors["temperature"] = temp;
  sensors["humidity"] = hum;
  sensors["gas"] = gas;
  sensors["danger"] = danger;

  firebasePUT(String(DEVICE_PATH) + "/sensors", sensors);

  Serial.println("ESP32_2 Firebase update OK");
  delay(1500);
}
