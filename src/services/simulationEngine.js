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
const pool                  = require('../db/pool');

// Test data ranges from specification table — values stay well within the
// normal zone (below safety threshold) so signals always show green.
// Format: { device, min (test data min), max (test data max) }
const SENSOR_RANGES = [
  { device: 'Z4-M1-AST-01', min: 10.94, max: 12.93 },
  { device: 'Z3-M2-AST-02', min: 13.05, max: 15.42 },
  { device: 'Z1-M2-AST-03', min: 28.56, max: 33.76 },
  { device: 'Z4-M3-AST-04', min: 13.20, max: 15.44 },
  { device: 'Z2-M3-AST-05', min: 35.29, max: 41.70 },
  { device: 'Z3-M4-AST-06', min: 16.27, max: 19.23 },
  { device: 'Z1-M4-AST-07', min: 10.59, max: 12.52 },
  { device: 'Z2-M4-AST-08', min: 11.10, max: 13.12 },
  { device: 'Z2-M4-AST-09', min: 11.10, max: 13.12 },
  { device: 'Z4-M5-AST-10', min: 21.10, max: 24.94 },
  { device: 'Z4-M1-ASG-01', min:  4.00, max:  5.60 },
  { device: 'Z4-M1-ASG-02', min:  3.21, max:  4.49 },
  { device: 'Z2-M1-ASG-03', min:  2.56, max:  3.58 },
  { device: 'Z4-M2-ASG-04', min:  4.21, max:  5.89 },
  { device: 'Z2-M2-ASG-05', min:  3.12, max:  4.37 },
  { device: 'Z4-M3-ASG-06', min: 17.41, max: 20.58 },
  { device: 'Z2-M3-ASG-07', min: 17.41, max: 20.58 },
  { device: 'Z4-M3-ASG-08', min:  2.70, max:  3.78 },
  { device: 'Z4-M4-ASG-09', min: 15.13, max: 17.88 },
  { device: 'Z2-M4-ASG-10', min: 15.13, max: 17.88 },
  { device: 'Z4-M5-ASG-11', min: 15.00, max: 17.73 },
  { device: 'Z2-M5-ASG-12', min: 15.00, max: 17.73 },
  { device: 'Z4-M5-ASG-13', min:  8.05, max:  9.52 },
  { device: 'Z2-M6-ASG-14', min: 17.66, max: 20.87 },
];

function randBetween(min, max) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(6));
}

async function buildPayload() {
  // Fetch active status for all devices in one query
  const [rows] = await pool.query('SELECT device_name, active FROM devices');
  const activeMap = {};
  rows.forEach(r => { activeMap[r.device_name] = !!r.active; });

  const now        = new Date();
  const timestamp  = now.getTime();
  const p          = n => String(n).padStart(2, '0');
  const deviceTime = new Date(now.getTime() - (Math.floor(Math.random() * 5) + 1) * 1000);
  const dateStr    = `${deviceTime.getFullYear()}-${p(deviceTime.getMonth()+1)}-${p(deviceTime.getDate())} ${p(deviceTime.getHours())}:${p(deviceTime.getMinutes())}:${p(deviceTime.getSeconds())}`;

  const readings = SENSOR_RANGES.map(s => {
    const isActive = activeMap[s.device] !== false; // default active if not in DB yet
    return {
      DeviceName:  s.device,
      Data:        isActive ? String(randBetween(s.min, s.max)) : '0.000000',
      Calibration: '1.000000',
      Timestamp:   timestamp,
      Date:        dateStr,
    };
  });

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

  const tick = async () => {
    try {
      const payload = await buildPayload();
      console.log('[SimEngine] Tick — injecting simulated sensor data');
      handleDataMessage(payload, io, true); // skipWatchdog — sim data has a 30-min gap by design
    } catch (err) {
      console.error('[SimEngine] Tick error:', err.message);
    }
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
