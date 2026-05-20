const pool = require('../db/pool');
// signalNormal, signalWarning, signalDanger imported when SIMULATION_MODE = false
// const { signalNormal, signalWarning, signalDanger } = require('./signalService');

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION MODE — set to false when real sensor data is being received and
// automatic signal-send should be active. While true the service evaluates
// thresholds and emits 'simulation:threshold' events to the UI but does NOT
// send any actual MQTT signal commands.
const SIMULATION_MODE = true;
// ─────────────────────────────────────────────────────────────────────────────

async function getZoneForDevice(device) {
  if (!device.zone_id) return null;
  const [rows] = await pool.query('SELECT * FROM zones WHERE id = ?', [device.zone_id]);
  return rows[0] || null;
}

async function setZoneAlarmLevel(zoneId, level, message, io) {
  const [rows] = await pool.query('SELECT alarm_level FROM zones WHERE id = ?', [zoneId]);
  if (!rows.length) return;

  const current = rows[0].alarm_level;

  // Always emit so UI stays in sync, but only write DB if level changed
  if (current !== level) {
    await pool.query('UPDATE zones SET alarm_level = ? WHERE id = ?', [level, zoneId]);
    await pool.query(
      `INSERT INTO alarms (zone_id, level, message) VALUES (?, ?, ?)`,
      [zoneId, level, message]
    );
    await pool.query(
      `UPDATE alarms SET resolved_at = NOW()
       WHERE zone_id = ? AND resolved_at IS NULL AND level != ?`,
      [zoneId, level]
    );
    console.log(`[AlarmService] Zone ${zoneId} level changed: ${current} → ${level}`);
  }

  if (io) {
    io.emit('alarm:change', { zoneId, level, message, previous: current });
  }
}

async function checkThresholds(device, dataValue, io) {
  const zone = await getZoneForDevice(device);
  if (!zone) return; // device not mapped to a zone yet

  // Load device-specific threshold configuration (Management page settings)
  const [thRows] = await pool.query(
    'SELECT * FROM device_thresholds WHERE device_id = ?', [device.id]
  );
  const th = thRows[0] || null;

  const absValue  = Math.abs(dataValue);
  const redMin    = th ? parseFloat(th.red_min)    : device.danger_threshold;
  const yellowMin = th ? parseFloat(th.yellow_min) : device.warning_threshold;
  const signalTarget = th ? th.signal_target : 2; // 0=large, 1=small, 2=both

  let level, message;

  if (absValue >= redMin) {
    level   = 'danger';
    message = `${device.device_name} value ${dataValue} exceeded danger threshold ${redMin}`;
  } else if (absValue >= yellowMin) {
    level   = 'warning';
    message = `${device.device_name} value ${dataValue} exceeded warning threshold ${yellowMin}`;
  } else {
    level   = 'normal';
    message = `${device.device_name} value ${dataValue} is within normal range`;
  }

  // In simulation mode always keep zones green — no warning/danger signals
  if (SIMULATION_MODE) level = 'normal';

  await setZoneAlarmLevel(zone.id, level, message, io);

  if (SIMULATION_MODE) {
    // ── Simulation: log what would be sent, emit to UI ──
    const channelName  = { normal: 'GREEN', warning: 'YELLOW', danger: 'RED' }[level];
    const targetLabel  = ['Large', 'Small', 'Both'][signalTarget] ?? 'Both';
    console.log(
      `[AlarmService] SIMULATION — ${zone.name}: val=${dataValue} level=${level}` +
      ` → would send ${channelName} to ${targetLabel} signal`
    );
    if (io) {
      io.emit('simulation:threshold', {
        deviceName:   device.device_name,
        zoneName:     zone.name,
        dataValue,
        level,
        channel:      channelName,
        signalTarget,
        targetLabel,
      });
    }
  } else {
    // ── ACTUAL SIGNAL SEND ──
    // Uncomment the block below (and set SIMULATION_MODE = false above) when
    // real sensor data is arriving and automatic signalling should be active.
    //
    // if (level === 'normal')  await signalNormal(zone.name, io);
    // if (level === 'warning') await signalWarning(zone.name, io);
    // if (level === 'danger')  await signalDanger(zone.name, io);
  }
}

module.exports = { checkThresholds, setZoneAlarmLevel, SIMULATION_MODE };
