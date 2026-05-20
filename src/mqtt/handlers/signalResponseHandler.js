const pool   = require('../../db/pool');
const bridge = require('../bridge');

async function handleSignalResponse(topic, raw, io) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('[SignalResponse] Malformed JSON:', err.message);
    return;
  }

  // Ignore messages we published ourselves (broker loop-back)
  if (bridge.isSelfEcho(topic, parsed)) {
    console.log(`[SignalResponse] Skipping self-echo on ${topic}`);
    return;
  }

  const { Channel, Type, Data, Timestamp, Date: dateStr } = parsed;

  // Extract zone name from topic e.g. "Signal/M-1" -> "M-1"
  const zoneName = topic.split('/')[1];

  console.log(`[SignalResponse] Echo from ${zoneName}: channel=${Channel} type=${Type} data=${Data}`);

  // Log echo to DB
  try {
    const [zoneRows] = await pool.query('SELECT id FROM zones WHERE name = ?', [zoneName]);
    if (zoneRows.length) {
      await pool.query(
        `INSERT INTO signal_status (zone_id, channel, type, data, is_echo) VALUES (?, ?, ?, ?, 1)`,
        [zoneRows[0].id, Channel, Type, Data]
      );
    }
  } catch (err) {
    console.error('[SignalResponse] DB log error:', err.message);
  }

  // Emit to UI
  if (io) {
    const payload = {
      zone:      zoneName,
      channel:   Channel,
      type:      Type,
      data:      Data,
      timestamp: Timestamp,
      date:      dateStr,
    };
    console.log(`[SignalResponse] Emitting signal:echo to ${io.engine.clientsCount} client(s):`, payload);
    io.emit('signal:echo', payload);
  } else {
    console.warn('[SignalResponse] io is null — cannot emit');
  }
}

module.exports = { handleSignalResponse };
