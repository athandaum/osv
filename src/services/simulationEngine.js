// ─────────────────────────────────────────────────────────────────────────────
// Simulation Engine
// Generates random sensor readings every 30 seconds, saves them to the DB,
// and evaluates alarm thresholds — exactly as if real MQTT data arrived.
//
// Does NOT send any MQTT signal commands to physical devices.
//
// To disable: set SIMULATION_ENGINE=false in .env or flip the flag below.
// ─────────────────────────────────────────────────────────────────────────────

const SIMULATION_ENGINE = process.env.SIMULATION_ENGINE !== 'false';
const INTERVAL_MS       = 30 * 60 * 1000; // 30 minutes

const { handleDataMessage } = require('../mqtt/handlers/dataHandler');

// Test data ranges from specification table — values stay well within the
// normal zone (below safety threshold) so signals always show green.
// Format: { device, min (test data min), max (test data max) }
const SENSOR_RANGES = [
  { device: 'M4-F1-AST-01', min: 10.94, max: 12.93 },
  { device: 'M3-F2-AST-02', min: 13.05, max: 15.42 },
  { device: 'M1-F2-AST-03', min: 28.56, max: 33.76 },
  { device: 'M4-F3-AST-04', min: 15.44, max: 18.25 },
  { device: 'M2-F3-AST-05', min: 35.29, max: 41.70 },
  { device: 'M3-F4-AST-06', min: 16.27, max: 19.23 },
  { device: 'M1-F4-AST-07', min: 10.59, max: 12.52 },
  { device: 'M2-F4-AST-08', min: 11.10, max: 13.12 },
  { device: 'M2-F4-AST-09', min: 11.10, max: 13.12 },
  { device: 'M4-F5-AST-10', min: 21.10, max: 24.94 },
  { device: 'M4-F1-ASG-01', min: 15.20, max: 17.97 },
  { device: 'M4-F1-ASG-02', min: 14.55, max: 17.20 },
  { device: 'M2-F1-ASG-03', min: 15.20, max: 17.97 },
  { device: 'M4-F2-ASG-04', min: 15.01, max: 17.74 },
  { device: 'M2-F2-ASG-05', min: 15.01, max: 17.74 },
  { device: 'M4-F3-ASG-06', min: 17.41, max: 20.58 },
  { device: 'M2-F3-ASG-07', min: 17.41, max: 20.58 },
  { device: 'M4-F3-ASG-08', min: 23.01, max: 27.20 },
  { device: 'M4-F4-ASG-09', min: 15.13, max: 17.88 },
  { device: 'M2-F4-ASG-10', min: 15.13, max: 17.88 },
  { device: 'M4-F5-ASG-11', min: 15.00, max: 17.73 },
  { device: 'M2-F5-ASG-12', min: 15.00, max: 17.73 },
  { device: 'M4-F5-ASG-13', min:  8.05, max:  9.52 },
  { device: 'M2-F6-ASG-14', min: 17.66, max: 20.87 },
];

function randBetween(min, max) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(6));
}

function buildPayload() {
  const now       = new Date();
  const timestamp = now.getTime();
  const p         = n => String(n).padStart(2, '0');
  // Simulate sensor-side timestamp: 1–5 seconds behind server receive time
  const deviceTime = new Date(now.getTime() - (Math.floor(Math.random() * 5) + 1) * 1000);
  const dateStr   = `${deviceTime.getFullYear()}-${p(deviceTime.getMonth()+1)}-${p(deviceTime.getDate())} ${p(deviceTime.getHours())}:${p(deviceTime.getMinutes())}:${p(deviceTime.getSeconds())}`;

  const readings = SENSOR_RANGES.map(s => ({
    DeviceName:  s.device,
    Data:        String(randBetween(s.min, s.max)),
    Calibration: '1.000000',
    Timestamp:   timestamp,
    Date:        dateStr,
  }));

  // Wrap in outer array to match real payload structure [[{...},...]]
  return JSON.stringify([readings]);
}

let _timer = null;

function start(io) {
  if (!SIMULATION_ENGINE) {
    console.log('[SimEngine] Disabled — set SIMULATION_ENGINE=true in .env to enable');
    return;
  }

  console.log(`[SimEngine] Started — sending simulated readings every ${INTERVAL_MS / 60000} minutes`);

  const tick = () => {
    const payload = buildPayload();
    console.log('[SimEngine] Tick — injecting simulated sensor data');
    handleDataMessage(payload, io, true); // skipWatchdog — sim data has a 30-min gap by design
  };

  // Fire once immediately, then on interval
  tick();
  _timer = setInterval(tick, INTERVAL_MS);
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log('[SimEngine] Stopped');
  }
}

module.exports = { start, stop };
