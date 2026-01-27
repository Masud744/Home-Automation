/* =====================================================
   SMART HOME DASHBOARD - COMPLETE JAVASCRIPT v6.0
   With Timer + Fixed Buzzer Alerts
   ===================================================== */

// Firebase Configuration
const firebaseConfig = {
  apiKey: "",//your firebase api key
  authDomain: "homeautomationesp32-bc13f.firebaseapp.com",
  databaseURL: "https://homeautomationesp32-bc13f-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "homeautomationesp32-bc13f"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

// Global Variables
let currentUserRole = 'admin';
let charts = {};
let historyData = { power: [], temperature: [], gas: [], cost: [] };
let alertsShown = { gas: false, water: false, voltage: false };
let previousBuzzerState = null;
let activeTimers = {};

// Store last known sensor values for alert context
let lastSensorData = {
  gas: 0,
  water_level: 0,
  voltage: 0
};

const WEATHER_API_KEY = '';
const WEATHER_CITY = 'Dhaka';

/* =====================================================
   LOGIN
   ===================================================== */
function login() {
  const email = document.getElementById('email')?.value.trim();
  const password = document.getElementById('password')?.value;
  const loader = document.getElementById('loader');
  
  if (!email || !password) {
    showToast('Please fill in all fields', 'error');
    return;
  }
  
  if (loader) loader.classList.add('active');
  
  auth.signInWithEmailAndPassword(email, password)
    .then(userCredential => {
      db.ref(`users/${userCredential.user.uid}/role`).once('value').then(snap => {
        localStorage.setItem('userRole', snap.val() || 'viewer');
        showToast('Login successful!', 'success');
        setTimeout(() => location.href = "dashboard.html", 800);
      });
    })
    .catch(e => {
      if (loader) loader.classList.remove('active');
      showToast(e.message, 'error');
    });
}

document.addEventListener('DOMContentLoaded', () => {
  const passInput = document.getElementById('password');
  if (passInput) passInput.addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
});

/* =====================================================
   LOGOUT
   ===================================================== */
function logout() {
  showToast('Logging out...', 'success');
  setTimeout(() => {
    auth.signOut().then(() => {
      localStorage.removeItem('userRole');
      location.href = "index.html";
    });
  }, 500);
}

/* =====================================================
   AUTH GUARD
   ===================================================== */
auth.onAuthStateChanged(user => {
  if (location.pathname.includes("dashboard")) {
    if (!user) {
      location.href = "index.html";
    } else {
      currentUserRole = localStorage.getItem('userRole') || 'viewer';
      document.getElementById('userRole').innerText = currentUserRole === 'admin' ? 'Admin' : 'Viewer';
      initDashboard();
    }
  }
});

/* =====================================================
   DASHBOARD INIT
   ===================================================== */
function initDashboard() {
  loadDeviceNames();
  loadSchedules();
  initCharts();
  loadWeather();
  checkActiveTimers();
  setInterval(checkSchedules, 60000);
  setInterval(checkActiveTimers, 30000);
}

/* =====================================================
   ESP32-1 DATA (Energy)
   ===================================================== */
db.ref("devices/esp32_1").on("value", snap => {
  const d = snap.val();
  if (!d) return;
  
  setText('esp1_ip', d.info?.ip || '---');
  setText('esp1_status', d.info?.status || 'offline');
  setStatus('esp1_status_dot', d.info?.status);
  
  const v = parseFloat(d.sensors?.voltage) || 0;
  const i1 = parseFloat(d.sensors?.current1) || 0;
  const i2 = parseFloat(d.sensors?.current2) || 0;
  const p = parseFloat(d.sensors?.power) || 0;
  
  lastSensorData.voltage = v;
  
  animateNum('v1', v, 1);
  animateNum('i1', i1, 2);
  animateNum('i2', i2, 2);
  animateNum('p1', p, 1);
  animateNum('today_wh', parseFloat(d.energy?.today_wh) || 0, 2);
  animateNum('month_wh', parseFloat(d.energy?.month_wh) || 0, 2);
  
  setGauge('v1_gauge', v, 260);
  setGauge('i1_gauge', i1, 15);
  setGauge('i2_gauge', i2, 15);
  setGauge('p1_gauge', p, 3000);
  
  // Controls
  const r1 = document.getElementById('relay1');
  const r2 = document.getElementById('relay2');
  if (r1) { r1.checked = d.control?.relay1 === 1; setText('relay1_status', r1.checked ? 'ON' : 'OFF'); }
  if (r2) { r2.checked = d.control?.relay2 === 1; setText('relay2_status', r2.checked ? 'ON' : 'OFF'); }
  
  // Billing
  animateNum('today_cost', parseFloat(d.billing?.today_cost) || 0, 2);
  animateNum('month_cost', parseFloat(d.billing?.month_cost) || 0, 2);
  animateNum('total_cost', parseFloat(d.billing?.total_cost) || 0, 2);
  setText('unit_rate', parseFloat(d.billing?.unit_rate) || 0);
  
  // High Voltage Alert (not buzzer connected, just warning)
  if (v > 255) {
    showAlert('voltage');
  } else {
    hideAlert('voltage');
  }
  
  // Chart data
  addChartData('power', p);
  addChartData('cost', parseFloat(d.billing?.today_cost) || 0);
  setText('chartPowerValue', p.toFixed(1) + ' W');
  setText('chartCostValue', 'BDT ' + (parseFloat(d.billing?.today_cost) || 0).toFixed(2));
});

/* =====================================================
   ESP32-2 DATA (Environment) + BUZZER ALERTS
   ===================================================== */
db.ref("devices/esp32_2").on("value", snap => {
  const d = snap.val();
  if (!d) return;
  
  setText('esp2_ip', d.info?.ip || '---');
  setText('esp2_status', d.info?.status || 'offline');
  setStatus('esp2_status_dot', d.info?.status);
  
  const wl = parseFloat(d.sensors?.water_level) || 0;
  const gas = parseFloat(d.sensors?.gas) || 0;
  const temp = parseFloat(d.sensors?.temperature) || 0;
  const danger = d.sensors?.danger === true || d.sensors?.danger === 1;
  
  // Get buzzer state from Firebase
  const buzzerOn = d.control?.buzzer === 1 || d.control?.buzzer === true;
  
  // Store last sensor values
  lastSensorData.gas = gas;
  lastSensorData.water_level = wl;
  
  animateNum('wl', wl, 1);
  animateNum('dist', parseFloat(d.sensors?.distance_cm) || 0, 1);
  animateNum('gas', gas, 0);
  animateNum('temp', temp, 1);
  animateNum('hum', parseFloat(d.sensors?.humidity) || 0, 1);
  
  // Water tank
  const tank = document.getElementById('water_tank');
  if (tank) tank.style.height = Math.min(wl, 100) + '%';
  
  setGauge('gas_gauge', gas, 1000);
  
  // Danger status
  setText('danger', danger ? 'YES' : 'NO');
  document.getElementById('danger_card')?.classList.toggle('active', danger);
  
  // ========== BUZZER-CONNECTED ALERTS ==========
  // Only trigger alerts when buzzer turns ON (edge detection)
  
  if (buzzerOn && previousBuzzerState === false) {
    // Buzzer just turned ON - determine the reason
    determineBuzzerReason(gas, wl, danger);
  } else if (!buzzerOn && previousBuzzerState === true) {
    // Buzzer just turned OFF - hide all buzzer alerts
    hideAlert('gas');
    hideAlert('water');
  }
  
  previousBuzzerState = buzzerOn;
  
  // Controls
  const pump = document.getElementById('pump');
  const auto = document.getElementById('autoCutoff');
  if (pump) { pump.checked = d.control?.pump === 1; setText('pump_status', pump.checked ? 'ON' : 'OFF'); }
  if (auto) { auto.checked = d.settings?.auto_cutoff === 1; setText('auto_status', auto.checked ? 'ON' : 'OFF'); }
  
  // Chart data
  addChartData('temperature', temp);
  addChartData('gas', gas);
  setText('chartTempValue', temp.toFixed(1) + '°C');
  setText('chartGasValue', gas.toFixed(0) + ' ppm');
});

/* =====================================================
   BUZZER REASON DETECTION
   ===================================================== */
function determineBuzzerReason(gas, waterLevel, danger) {
  // Priority: Gas leak is more dangerous, check first
  if (gas > 400 || danger) {
    // Gas leak detected
    showAlert('gas');
    playAlertSound('gas');
    document.getElementById('gasAlertMsg').innerText = 
      `Gas level: ${gas.toFixed(0)} ppm - DANGEROUS! Buzzer is ON`;
  } else if (waterLevel >= 90) {
    // Water tank full
    showAlert('water');
    playAlertSound('water');
    document.getElementById('waterAlertMsg').innerText = 
      `Water level: ${waterLevel.toFixed(0)}% - Tank Full! Buzzer is ON`;
  } else {
    // Unknown reason - show generic alert
    showAlert('gas');
    playAlertSound('gas');
    document.getElementById('gasAlertMsg').innerText = 
      'Alert triggered - Buzzer is ON';
  }
}

/* =====================================================
   ALERT FUNCTIONS
   ===================================================== */
function showAlert(type) {
  const alertMap = {
    'gas': 'gasAlert',
    'water': 'waterAlert',
    'voltage': 'voltageAlert'
  };
  
  const alertId = alertMap[type];
  const el = document.getElementById(alertId);
  
  if (el && !alertsShown[type]) {
    el.style.display = 'flex';
    setTimeout(() => el.classList.add('show'), 10);
    alertsShown[type] = true;
  }
}

function hideAlert(type) {
  const alertMap = {
    'gas': 'gasAlert',
    'water': 'waterAlert',
    'voltage': 'voltageAlert'
  };
  
  const alertId = alertMap[type];
  const el = document.getElementById(alertId);
  
  if (el && alertsShown[type]) {
    el.classList.remove('show');
    setTimeout(() => {
      el.style.display = 'none';
    }, 300);
    alertsShown[type] = false;
  }
}

function dismissAlert(alertId) {
  const el = document.getElementById(alertId);
  if (el) {
    el.classList.remove('show');
    setTimeout(() => {
      el.style.display = 'none';
    }, 300);
    
    if (alertId === 'gasAlert') alertsShown.gas = false;
    if (alertId === 'waterAlert') alertsShown.water = false;
    if (alertId === 'voltageAlert') alertsShown.voltage = false;
  }
}

function playAlertSound(type) {
  let sound;
  if (type === 'gas') {
    sound = document.getElementById('gasAlertSound');
  } else if (type === 'water') {
    sound = document.getElementById('waterAlertSound');
  }
  
  if (sound) {
    sound.currentTime = 0;
    sound.play().catch(() => {});
  }
}

/* =====================================================
   CONTROLS
   ===================================================== */
function toggleRelay(num) {
  const ref = db.ref(`devices/esp32_1/control/relay${num}`);
  ref.once('value').then(s => {
    const newVal = s.val() === 1 ? 0 : 1;
    ref.set(newVal);
    showToast(`Relay ${num} ${newVal ? 'ON' : 'OFF'}`, 'success');
  });
}

function togglePump() {
  const ref = db.ref("devices/esp32_2/control/pump");
  ref.once('value').then(s => {
    const newVal = s.val() === 1 ? 0 : 1;
    ref.set(newVal);
    showToast(`Pump ${newVal ? 'ON' : 'OFF'}`, 'success');
  });
}

function toggleAuto() {
  const auto = document.getElementById('autoCutoff');
  if (!auto) return;
  db.ref("devices/esp32_2/settings/auto_cutoff").set(auto.checked ? 1 : 0);
  showToast(`Auto Cutoff ${auto.checked ? 'ON' : 'OFF'}`, 'success');
}

/* =====================================================
   QUICK ACTIONS
   ===================================================== */
function activateScene(scene) {
  switch(scene) {
    case 'allOff':
      db.ref("devices/esp32_1/control/relay1").set(0);
      db.ref("devices/esp32_1/control/relay2").set(0);
      db.ref("devices/esp32_2/control/pump").set(0);
      showToast('All devices OFF', 'success');
      break;
    case 'allOn':
      db.ref("devices/esp32_1/control/relay1").set(1);
      db.ref("devices/esp32_1/control/relay2").set(1);
      showToast('All lights ON', 'success');
      break;
    case 'goodNight':
      db.ref("devices/esp32_1/control/relay1").set(0);
      db.ref("devices/esp32_1/control/relay2").set(0);
      db.ref("devices/esp32_2/control/pump").set(0);
      showToast('Good Night!', 'success');
      break;
    case 'goodMorning':
      db.ref("devices/esp32_1/control/relay1").set(1);
      showToast('Good Morning!', 'success');
      break;
  }
}

/* =====================================================
   DEVICE NAMES
   ===================================================== */
function loadDeviceNames() {
  db.ref("settings/device_names").on("value", snap => {
    const n = snap.val() || {};
    setText('relay1_name', n.relay1 || 'Relay 1');
    setText('relay2_name', n.relay2 || 'Relay 2');
    setText('pump_name', n.pump || 'Water Pump');
  });
}

/* =====================================================
   BILLING
   ===================================================== */
function openRateModal() {
  const m = document.getElementById('rateModal');
  const input = document.getElementById('newRate');
  if (m && input) {
    input.value = document.getElementById('unit_rate')?.innerText || '';
    m.classList.add('active');
    input.focus();
  }
}

function saveUnitRate() {
  const rate = parseFloat(document.getElementById('newRate')?.value);
  if (isNaN(rate) || rate <= 0) {
    showToast('Enter valid rate', 'error');
    return;
  }
  db.ref("devices/esp32_1/billing/unit_rate").set(rate).then(() => {
    showToast('Rate updated', 'success');
    closeModal('rateModal');
  });
}

/* =====================================================
   SCHEDULES WITH TIMER
   ===================================================== */
function loadSchedules() {
  db.ref("schedules").on("value", snap => {
    const schedules = snap.val() || {};
    renderSchedules(schedules);
  });
}

function renderSchedules(schedules) {
  const list = document.getElementById('schedulesList');
  if (!list) return;
  
  const arr = Object.entries(schedules);
  if (arr.length === 0) {
    list.innerHTML = '<div class="no-schedules">No schedules set</div>';
    return;
  }
  
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  list.innerHTML = arr.map(([id, s]) => {
    const durationText = s.duration && s.duration > 0 
      ? `<span class="schedule-timer">${formatDuration(s.duration)}</span>` 
      : '';
    
    return `
      <div class="schedule-item">
        <div class="schedule-time">${s.time}</div>
        <div class="schedule-info">
          <div class="schedule-device">${s.device} ${durationText}</div>
          <div class="schedule-days">${s.days ? s.days.map(d => days[d]).join(', ') : 'Once'}</div>
        </div>
        <span class="schedule-action ${s.action}">${s.action}</span>
        <button class="schedule-delete" onclick="deleteSchedule('${id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;
  }).join('');
}

function formatDuration(minutes) {
  if (minutes >= 60) {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  return `${minutes}m`;
}

function openScheduleModal() {
  const m = document.getElementById('scheduleModal');
  if (m) {
    document.getElementById('scheduleDevice').value = 'relay1';
    document.getElementById('scheduleAction').value = 'on';
    document.getElementById('scheduleTime').value = '';
    document.getElementById('scheduleDuration').value = '0';
    document.querySelectorAll('.day-btn input').forEach(cb => cb.checked = false);
    m.classList.add('active');
  }
}

function saveSchedule() {
  const device = document.getElementById('scheduleDevice').value;
  const action = document.getElementById('scheduleAction').value;
  const time = document.getElementById('scheduleTime').value;
  const duration = parseInt(document.getElementById('scheduleDuration').value) || 0;
  
  if (!time) {
    showToast('Select time', 'error');
    return;
  }
  
  const days = [];
  document.querySelectorAll('.day-btn input:checked').forEach(cb => days.push(parseInt(cb.value)));
  
  const scheduleData = {
    device, 
    action, 
    time,
    duration, // Timer duration in minutes
    days: days.length > 0 ? days : null,
    enabled: true
  };
  
  db.ref("schedules").push(scheduleData).then(() => {
    const timerMsg = duration > 0 ? ` (Auto OFF after ${formatDuration(duration)})` : '';
    showToast(`Schedule added${timerMsg}`, 'success');
    closeModal('scheduleModal');
  });
}

function deleteSchedule(id) {
  if (confirm('Delete schedule?')) {
    db.ref(`schedules/${id}`).remove().then(() => showToast('Deleted', 'success'));
    // Also remove any active timer for this schedule
    db.ref(`active_timers/${id}`).remove();
  }
}

function checkSchedules() {
  const now = new Date();
  const time = now.toTimeString().slice(0, 5);
  const day = now.getDay();
  
  db.ref("schedules").once("value").then(snap => {
    Object.entries(snap.val() || {}).forEach(([id, s]) => {
      if (!s.enabled || s.time !== time) return;
      if (s.days && !s.days.includes(day)) return;
      
      const val = s.action === 'on' ? 1 : 0;
      let ref;
      
      if (s.device === 'relay1') ref = db.ref("devices/esp32_1/control/relay1");
      else if (s.device === 'relay2') ref = db.ref("devices/esp32_1/control/relay2");
      else if (s.device === 'pump') ref = db.ref("devices/esp32_2/control/pump");
      
      if (ref) {
        ref.set(val);
        showToast(`Schedule: ${s.device} ${s.action.toUpperCase()}`, 'success');
        
        // If there's a timer and action is ON, set auto-off
        if (s.duration > 0 && s.action === 'on') {
          const offTime = new Date(now.getTime() + s.duration * 60000);
          db.ref(`active_timers/${id}`).set({
            device: s.device,
            offTime: offTime.getTime(),
            scheduleId: id
          });
          showToast(`Will auto OFF in ${formatDuration(s.duration)}`, 'success');
        }
      }
    });
  });
}

function checkActiveTimers() {
  const now = Date.now();
  
  db.ref("active_timers").once("value").then(snap => {
    Object.entries(snap.val() || {}).forEach(([id, timer]) => {
      if (now >= timer.offTime) {
        // Time to turn off
        let ref;
        if (timer.device === 'relay1') ref = db.ref("devices/esp32_1/control/relay1");
        else if (timer.device === 'relay2') ref = db.ref("devices/esp32_1/control/relay2");
        else if (timer.device === 'pump') ref = db.ref("devices/esp32_2/control/pump");
        
        if (ref) {
          ref.set(0);
          showToast(`Timer: ${timer.device} auto OFF`, 'success');
        }
        
        // Remove the timer
        db.ref(`active_timers/${id}`).remove();
      }
    });
  });
}

/* =====================================================
   CHARTS
   ===================================================== */
function initCharts() {
  const config = (color) => ({
    type: 'line',
    data: { 
      labels: [], 
      datasets: [{ 
        data: [], 
        borderColor: color, 
        backgroundColor: color + '20', 
        fill: true, 
        tension: 0.4, 
        pointRadius: 0, 
        borderWidth: 2 
      }] 
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false, 
      plugins: { legend: { display: false } }, 
      scales: { 
        x: { display: false }, 
        y: { display: false } 
      },
      animation: {
        duration: 500,
        easing: 'easeOutQuart'
      }
    }
  });
  
  charts.power = new Chart(document.getElementById('powerChart'), config('#00d4ff'));
  charts.temperature = new Chart(document.getElementById('tempChart'), config('#ff6348'));
  charts.gas = new Chart(document.getElementById('gasChart'), config('#ffa502'));
  charts.cost = new Chart(document.getElementById('costChart'), config('#00ff9c'));
}

function addChartData(type, value) {
  if (!historyData[type]) historyData[type] = [];
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  historyData[type].push({ time, value });
  if (historyData[type].length > 20) historyData[type].shift();
  
  if (charts[type]) {
    charts[type].data.labels = historyData[type].map(d => d.time);
    charts[type].data.datasets[0].data = historyData[type].map(d => d.value);
    charts[type].update('none');
  }
}

/* =====================================================
   WEATHER
   ===================================================== */
function loadWeather() {
  if (!WEATHER_API_KEY) {
    updateWeather({ temp: 28, feels: 32, humidity: 75, wind: 12, desc: 'Partly Cloudy', city: 'Dhaka' });
    return;
  }
  fetch(`https://api.openweathermap.org/data/2.5/weather?q=${WEATHER_CITY}&appid=${WEATHER_API_KEY}&units=metric`)
    .then(r => r.json())
    .then(d => updateWeather({
      temp: Math.round(d.main.temp),
      feels: Math.round(d.main.feels_like),
      humidity: d.main.humidity,
      wind: Math.round(d.wind.speed * 3.6),
      desc: d.weather[0].description,
      city: d.name
    }))
    .catch(() => updateWeather({ temp: 28, feels: 32, humidity: 75, wind: 12, desc: 'Partly Cloudy', city: 'Dhaka' }));
}

function updateWeather(w) {
  setText('weatherTemp', w.temp);
  setText('weatherDesc', w.desc);
  setText('weatherHumidity', w.humidity + '%');
  setText('weatherWind', w.wind + ' km/h');
  setText('weatherFeels', w.feels + '°C');
  setText('weatherCity', w.city);
}

/* =====================================================
   VOICE CONTROL
   ===================================================== */
let recognition = null;

function startVoiceControl() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('Voice not supported', 'error');
    return;
  }
  
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  
  document.getElementById('voiceOverlay')?.classList.add('active');
  document.getElementById('voiceBtn')?.classList.add('listening');
  
  recognition.onresult = (e) => {
    const cmd = e.results[0][0].transcript.toLowerCase();
    document.getElementById('voiceStatus').innerText = `"${cmd}"`;
    processVoice(cmd);
    setTimeout(stopVoiceControl, 1500);
  };
  
  recognition.onerror = () => {
    document.getElementById('voiceStatus').innerText = 'Not recognized';
    setTimeout(stopVoiceControl, 1500);
  };
  
  recognition.start();
}

function stopVoiceControl() {
  if (recognition) recognition.stop();
  document.getElementById('voiceOverlay')?.classList.remove('active');
  document.getElementById('voiceBtn')?.classList.remove('listening');
}

function processVoice(cmd) {
  if (cmd.includes('turn on') && (cmd.includes('light') || cmd.includes('relay 1'))) {
    db.ref("devices/esp32_1/control/relay1").set(1);
    showToast('Light ON', 'success');
  } else if (cmd.includes('turn off') && (cmd.includes('light') || cmd.includes('relay 1'))) {
    db.ref("devices/esp32_1/control/relay1").set(0);
    showToast('Light OFF', 'success');
  } else if (cmd.includes('turn on') && (cmd.includes('fan') || cmd.includes('relay 2'))) {
    db.ref("devices/esp32_1/control/relay2").set(1);
    showToast('Fan ON', 'success');
  } else if (cmd.includes('turn off') && (cmd.includes('fan') || cmd.includes('relay 2'))) {
    db.ref("devices/esp32_1/control/relay2").set(0);
    showToast('Fan OFF', 'success');
  } else if (cmd.includes('turn on') && cmd.includes('pump')) {
    db.ref("devices/esp32_2/control/pump").set(1);
    showToast('Pump ON', 'success');
  } else if (cmd.includes('turn off') && cmd.includes('pump')) {
    db.ref("devices/esp32_2/control/pump").set(0);
    showToast('Pump OFF', 'success');
  } else if (cmd.includes('all') && cmd.includes('off')) {
    activateScene('allOff');
  } else if (cmd.includes('all') && cmd.includes('on')) {
    activateScene('allOn');
  } else {
    showToast('Command not recognized', 'error');
  }
}

/* =====================================================
   HELPERS
   ===================================================== */
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.innerText = val;
}

function setStatus(id, status) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('online', status?.toLowerCase() === 'online');
}

function setGauge(id, val, max) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.min((val / max) * 100, 100) + '%';
}

function animateNum(id, newVal, dec) {
  const el = document.getElementById(id);
  if (!el) return;
  const cur = parseFloat(el.innerText) || 0;
  const diff = newVal - cur;
  const steps = 20;
  let step = 0;
  const anim = setInterval(() => {
    step++;
    el.innerText = (cur + diff * step / steps).toFixed(dec);
    if (step >= steps) { clearInterval(anim); el.innerText = newVal.toFixed(dec); }
  }, 20);
}

/* =====================================================
   TIME & DATE
   ===================================================== */
function updateDateTime() {
  const now = new Date();
  setText('time', now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  setText('date', now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' }));
  
  const h = now.getHours();
  let g = 'Good Evening!';
  if (h >= 0 && h < 5) g = 'Good Night!';
  else if (h < 12) g = 'Good Morning!';
  else if (h < 18) g = 'Good Afternoon!';
  else if (h < 21) g = 'Good Evening!';
  else g = 'Good Night!';
  setText('greeting', g);
}

setInterval(updateDateTime, 1000);
updateDateTime();

/* =====================================================
   THEME
   ===================================================== */
function toggleTheme() {
  document.body.classList.toggle('light-theme');
  localStorage.setItem('theme', document.body.classList.contains('light-theme') ? 'light' : 'dark');
  showToast(document.body.classList.contains('light-theme') ? 'Light mode' : 'Dark mode', 'success');
}

document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('theme') === 'light') document.body.classList.add('light-theme');
});

/* =====================================================
   MODAL & TOAST
   ===================================================== */
function closeModal(id) {
  document.getElementById(id)?.classList.remove('active');
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerText = msg;
  t.className = 'toast ' + type;
  void t.offsetWidth;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('active');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    stopVoiceControl();
  }
});


console.log('%c Smart Home v6.0 ', 'background: linear-gradient(135deg, #00d4ff, #7c3aed); color: white; padding: 10px 20px; border-radius: 8px; font-weight: bold; font-size: 14px;');
