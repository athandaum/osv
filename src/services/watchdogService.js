const pool = require('../db/pool');
const { setZoneAlarmLevel, SIMULATION_MODE } = require('./alarmService');
const { signalCommsLoss } = require('./signalService');

const COMMS_LOSS_TIMEOUT = (parseInt(process.env.COMMS_LOSS_TIMEOUT) || 60) * 1000;

// Map: deviceName -> timeout handle
const watchdogs = new Map();

function resetWatchdog(deviceName, io) {
  // Clear existing timer if any
  if (watchdogs.has(deviceName)) {
    clearTimeout(watchdogs.get(deviceName));
  }

  const handle = setTimeout(() => onCommsLoss(deviceName, io), COMMS_LOSS_TIMEOUT);
  watchdogs.set(deviceName, handle);
}

async function onCommsLoss(deviceName, io) {
  watchdogs.delete(deviceName);

  if (SIMULATION_MODE) {
    console.log(`[Watchdog] Simulation mode — comms loss suppressed for ${deviceName}`);
    return;
  }

  console.warn(`[Watchdog] Comms loss detected for device: ${deviceName}`);

  try {
    const [rows] = await pool.query(`
      SELECT d.*, z.id AS z_id, z.name AS zone_name
      FROM devices d
      LEFT JOIN zones z ON d.zone_id = z.id
      WHERE d.device_name = ?
    `, [deviceName]);

    if (!rows.length || !rows[0].z_id) {
      console.warn(`[Watchdog] Device ${deviceName} has no zone mapping — cannot update alarm`);
      return;
    }

    const { z_id, zone_name } = rows[0];
    const message = `Communication lost with ${deviceName} (no data for ${COMMS_LOSS_TIMEOUT / 1000}s)`;

    await setZoneAlarmLevel(z_id, 'comms_loss', message, io);
    await signalCommsLoss(zone_name, io);

    if (io) {
      io.emit('comms:loss', { deviceName, zoneId: z_id, zoneName: zone_name });
    }
  } catch (err) {
    console.error('[Watchdog] Error handling comms loss:', err.message);
  }
}

function stopAll() {
  for (const handle of watchdogs.values()) clearTimeout(handle);
  watchdogs.clear();
}

module.exports = { resetWatchdog, stopAll };
