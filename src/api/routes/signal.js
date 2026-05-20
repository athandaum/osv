const express = require('express');
const router  = express.Router();
const pool    = require('../../db/pool');
const { sendSignal, CHANNEL, TYPE, DATA } = require('../../services/signalService');

// GET /api/signal/state — current L/S state for every zone
router.get('/state', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT z.name AS zone, ss.type, ss.channel, ss.data
       FROM signal_state ss
       JOIN zones z ON z.id = ss.zone_id`
    );
    // Shape: { "M-1": { L: {channel,data}, S: {channel,data} }, ... }
    const state = {};
    rows.forEach(r => {
      if (!state[r.zone]) state[r.zone] = {};
      const key = r.type === 0 ? 'L' : 'S';
      state[r.zone][key] = { channel: r.channel, data: r.data };
    });
    res.json({ success: true, data: state });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/signal/:zone
// Body: { channel, type, data }
router.post('/:zone', async (req, res) => {
  try {
    const { zone } = req.params;
    const { channel, type, data } = req.body;

    const validZones    = ['M-1', 'M-2', 'M-3', 'M-4'];
    const validChannels = Object.values(CHANNEL);
    const validTypes    = Object.values(TYPE);
    const validData     = Object.values(DATA);

    if (!validZones.includes(zone)) {
      return res.status(400).json({ success: false, message: `Invalid zone. Valid: ${validZones.join(', ')}` });
    }
    if (!validChannels.includes(channel)) {
      return res.status(400).json({ success: false, message: 'Invalid channel (0=all,1=red,2=yellow,3=green,4=buzzer)' });
    }
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid type (0=large,1=small,2=both)' });
    }
    if (!validData.includes(data)) {
      return res.status(400).json({ success: false, message: 'Invalid data (0=off,1=on)' });
    }

    const io = req.app.get('io');
    const ok = await sendSignal(zone, channel, type, data, io);
    if (!ok) return res.status(503).json({ success: false, message: 'MQTT not connected or zone not found' });

    res.json({ success: true, message: `Signal sent to ${zone}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
