const pool = require('../db/pool');

// Infer sensor type from DeviceName (MZ-ASG-xx or MZ-AST-xx)
function inferSensorType(deviceName) {
  const upper = deviceName.toUpperCase();
  if (upper.includes('ASG')) return 'ASG';
  if (upper.includes('AST')) return 'AST';
  return 'UNKNOWN';
}

// Parse zone name from device name prefix: M4-F1-AST-01 → "M-4"
function inferZoneName(deviceName) {
  const match = deviceName.match(/^M(\d+)-/i);
  if (!match) return null;
  return `M-${match[1]}`;
}

// Look up zone_id by zone name
async function resolveZoneId(zoneName) {
  if (!zoneName) return null;
  const [rows] = await pool.query('SELECT id FROM zones WHERE name = ?', [zoneName]);
  return rows.length ? rows[0].id : null;
}

// Get or auto-create device record, auto-assigning zone from device name
async function resolveOrCreateDevice(deviceName) {
  const [rows] = await pool.query(
    'SELECT * FROM devices WHERE device_name = ?',
    [deviceName]
  );
  if (rows.length) return rows[0];

  const sensorType    = inferSensorType(deviceName);
  const zoneName      = inferZoneName(deviceName);
  const zoneId        = await resolveZoneId(zoneName);
  const defaultSafety  = parseFloat(process.env.DEFAULT_SAFETY_THRESHOLD)  || 0.0;
  const defaultWarning = parseFloat(process.env.DEFAULT_WARNING_THRESHOLD) || 5.0;
  const defaultDanger  = parseFloat(process.env.DEFAULT_DANGER_THRESHOLD)  || 10.0;

  await pool.query(
    `INSERT INTO devices (device_name, sensor_type, zone_id, safety_threshold, warning_threshold, danger_threshold)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [deviceName, sensorType, zoneId, defaultSafety, defaultWarning, defaultDanger]
  );

  console.log(`[DeviceService] Auto-created device: ${deviceName} (${sensorType}) → zone ${zoneName || 'unassigned'}`);

  const [newRows] = await pool.query(
    'SELECT * FROM devices WHERE device_name = ?',
    [deviceName]
  );
  return newRows[0];
}

async function updateDeviceLastSeen(deviceName) {
  await pool.query(
    'UPDATE devices SET last_seen = NOW() WHERE device_name = ?',
    [deviceName]
  );
}

async function getAllDevices() {
  const [rows] = await pool.query(`
    SELECT d.*, z.name AS zone_name, z.signal_topic
    FROM devices d
    LEFT JOIN zones z ON d.zone_id = z.id
    ORDER BY d.device_name
  `);
  return rows;
}

async function updateThresholds(deviceId, safetyThreshold, warningThreshold, dangerThreshold) {
  const [result] = await pool.query(
    `UPDATE devices SET safety_threshold = ?, warning_threshold = ?, danger_threshold = ? WHERE id = ?`,
    [safetyThreshold, warningThreshold, dangerThreshold, deviceId]
  );
  return result.affectedRows > 0;
}

async function assignDeviceToZone(deviceId, zoneId) {
  const [result] = await pool.query(
    'UPDATE devices SET zone_id = ? WHERE id = ?',
    [zoneId, deviceId]
  );
  return result.affectedRows > 0;
}

// Fix existing devices that have zone_id = NULL by inferring from device name
async function backfillZoneAssignments() {
  const [devices] = await pool.query('SELECT id, device_name FROM devices WHERE zone_id IS NULL');
  let fixed = 0;
  for (const d of devices) {
    const zoneName = inferZoneName(d.device_name);
    const zoneId   = await resolveZoneId(zoneName);
    if (zoneId) {
      await pool.query('UPDATE devices SET zone_id = ? WHERE id = ?', [zoneId, d.id]);
      console.log(`[DeviceService] Backfill: ${d.device_name} → zone ${zoneName}`);
      fixed++;
    }
  }
  if (fixed > 0) console.log(`[DeviceService] Backfilled ${fixed} device(s) with zone assignments`);
}

module.exports = {
  resolveOrCreateDevice,
  updateDeviceLastSeen,
  getAllDevices,
  updateThresholds,
  assignDeviceToZone,
  inferSensorType,
  inferZoneName,
  backfillZoneAssignments,
};
