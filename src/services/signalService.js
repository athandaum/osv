const pool   = require('../db/pool');
const bridge = require('../mqtt/bridge');

// Channel mapping
const CHANNEL = { ALL: 0, RED: 1, YELLOW: 2, GREEN: 3, BUZZER: 4 };
const TYPE    = { LARGE: 0, SMALL: 1, BOTH: 2 };
const DATA    = { OFF: 0, ON: 1 };

async function getZoneByName(zoneName) {
  const [rows] = await pool.query('SELECT * FROM zones WHERE name = ?', [zoneName]);
  return rows[0] || null;
}

async function publishSignal(zone, channel, type, dataValue, io) {
  const now     = Date.now();
  const dateStr = new Date(now).toISOString().replace('T', ' ').replace('Z', '');
  const payload = { Channel: channel, Type: type, Data: dataValue, Timestamp: now, Date: dateStr };

  const published = bridge.publish(zone.signal_topic, payload);
  if (!published) return false;

  try {
    await pool.query(
      `INSERT INTO signal_status (zone_id, channel, type, data) VALUES (?, ?, ?, ?)`,
      [zone.id, channel, type, dataValue]
    );
  } catch (err) {
    console.error('[SignalService] DB log error:', err.message);
  }

  if (io) {
    io.emit('signal:sent', { zone: zone.name, channel, type, data: dataValue, timestamp: now });
  }

  return true;
}

async function upsertState(zoneId, type, channel, dataValue) {
  try {
    await pool.query(
      `INSERT INTO signal_state (zone_id, type, channel, data)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE channel = VALUES(channel), data = VALUES(data), updated_at = NOW()`,
      [zoneId, type, channel, dataValue]
    );
  } catch (err) {
    console.error('[SignalService] State upsert error:', err.message);
  }
}

async function sendSignal(zoneName, channel, type, dataValue, io) {
  const zone = await getZoneByName(zoneName);
  if (!zone) {
    console.error(`[SignalService] Zone not found: ${zoneName}`);
    return false;
  }

  // type=2 (BOTH) — publish for Large then Small in one service call
  if (type === TYPE.BOTH) {
    for (const t of [TYPE.LARGE, TYPE.SMALL]) {
      if (dataValue === DATA.ON && channel !== CHANNEL.ALL) {
        await publishSignal(zone, CHANNEL.ALL, t, DATA.OFF, io);
      }
      const ok = await publishSignal(zone, channel, t, dataValue, io);
      if (!ok) return false;
      await upsertState(zone.id, t, channel, dataValue);
    }
    return true;
  }

  // When turning ON a specific channel, clear all channels first
  if (dataValue === DATA.ON && channel !== CHANNEL.ALL) {
    const cleared = await publishSignal(zone, CHANNEL.ALL, type, DATA.OFF, io);
    if (!cleared) return false;
  }

  const ok = await publishSignal(zone, channel, type, dataValue, io);
  if (ok) await upsertState(zone.id, type, channel, dataValue);
  return ok;
}

// Convenience helpers for alarm levels
async function signalNormal(zoneName, io) {
  // Green ON, everything else OFF
  await sendSignal(zoneName, CHANNEL.ALL,   TYPE.LARGE, DATA.OFF, io);
  await sendSignal(zoneName, CHANNEL.GREEN, TYPE.LARGE, DATA.ON,  io);
}

async function signalWarning(zoneName, io) {
  // Yellow ON
  await sendSignal(zoneName, CHANNEL.ALL,    TYPE.LARGE, DATA.OFF, io);
  await sendSignal(zoneName, CHANNEL.YELLOW, TYPE.LARGE, DATA.ON,  io);
}

async function signalDanger(zoneName, io) {
  // Red ON + Buzzer ON
  await sendSignal(zoneName, CHANNEL.ALL,   TYPE.LARGE, DATA.OFF, io);
  await sendSignal(zoneName, CHANNEL.RED,   TYPE.LARGE, DATA.ON,  io);
  await sendSignal(zoneName, CHANNEL.BUZZER,TYPE.LARGE, DATA.ON,  io);
}

async function signalCommsLoss(zoneName, io) {
  // Yellow ON as comms-loss warning
  await sendSignal(zoneName, CHANNEL.ALL,    TYPE.LARGE, DATA.OFF, io);
  await sendSignal(zoneName, CHANNEL.YELLOW, TYPE.LARGE, DATA.ON,  io);
}

module.exports = {
  sendSignal,
  signalNormal,
  signalWarning,
  signalDanger,
  signalCommsLoss,
  CHANNEL,
  TYPE,
  DATA,
};
