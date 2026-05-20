const pool = require('../../db/pool');
const { updateDeviceLastSeen, resolveOrCreateDevice } = require('../../services/deviceService');
const { checkThresholds } = require('../../services/alarmService');
const { resetWatchdog } = require('../../services/watchdogService');

const REQUIRED_FIELDS = ['DeviceName', 'Data', 'Calibration', 'Timestamp', 'Date'];

async function handleDataMessage(raw, io, skipWatchdog = false) {
  let parsed;

  // Parse JSON
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('[DataHandler] Malformed JSON:', err.message);
    return;
  }

  // Local Server sends {"Error":"..."} when a device is offline — log and skip
  if (parsed && parsed.Error) {
    console.warn('[DataHandler] Device error from Local Server:', parsed.Error);
    return;
  }

  // The payload is [[{...}, {...}]] — unwrap outer array
  let readings;
  if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
    readings = parsed[0];
  } else if (Array.isArray(parsed)) {
    readings = parsed;
  } else {
    console.error('[DataHandler] Unexpected payload structure:', JSON.stringify(parsed).slice(0, 300));
    return;
  }

  if (!readings.length) {
    console.warn('[DataHandler] Empty readings array received');
    return;
  }

  const receivedAt = new Date();
  const validRows  = [];

  for (const item of readings) {
    // Validate required fields
    const missing = REQUIRED_FIELDS.filter(f => item[f] === undefined || item[f] === null);
    if (missing.length) {
      console.warn(`[DataHandler] Skipping item missing fields [${missing.join(', ')}]:`, item);
      continue;
    }

    const dataValue   = parseFloat(item.Data);
    const calibration = parseFloat(item.Calibration);

    if (isNaN(dataValue) || isNaN(calibration)) {
      console.warn('[DataHandler] Skipping item with non-numeric Data/Calibration:', item);
      continue;
    }

    validRows.push({
      device_name:  item.DeviceName,
      data_value:   dataValue,
      calibration,
      device_ts:    item.Timestamp,
      device_date:  item.Date,
      received_at:  receivedAt,
    });
  }

  if (!validRows.length) {
    console.warn('[DataHandler] No valid readings after validation');
    return;
  }

  // Bulk insert
  try {
    const values = validRows.map(r => [
      r.device_name,
      r.data_value,
      r.calibration,
      r.device_ts,
      r.device_date,
      r.received_at,
    ]);
    await pool.query(
      `INSERT INTO sensor_readings (device_name, data_value, calibration, device_ts, device_date, received_at)
       VALUES ?`,
      [values]
    );
    console.log(`[DataHandler] Inserted ${validRows.length} readings`);
  } catch (err) {
    console.error('[DataHandler] DB insert error:', err.message);
    return;
  }

  // Post-insert: update device tracking, watchdog, alarms
  for (const row of validRows) {
    try {
      const device = await resolveOrCreateDevice(row.device_name);
      await updateDeviceLastSeen(row.device_name);
      if (!skipWatchdog) resetWatchdog(row.device_name, io);
      await checkThresholds(device, row.data_value, io);

      if (io) {
        io.emit('sensor:data', {
          deviceName:  row.device_name,
          dataValue:   row.data_value,
          calibration: row.calibration,
          deviceDate:  row.device_date,
          receivedAt:  receivedAt.toISOString(),
        });
      }
    } catch (err) {
      console.error(`[DataHandler] Post-insert error for ${row.device_name}:`, err.message);
    }
  }
}

module.exports = { handleDataMessage };
