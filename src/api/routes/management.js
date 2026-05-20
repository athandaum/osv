const express = require('express');
const router  = express.Router();
const pool    = require('../../db/pool');

// GET /api/management/zone-thresholds — all 4 zones with their threshold config
router.get('/zone-thresholds', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT z.id, z.name,
             COALESCE(zt.min_val,  5.0)  AS min_val,
             COALESCE(zt.max_val, 10.0)  AS max_val,
             zt.updated_at
      FROM zones z
      LEFT JOIN zone_thresholds zt ON zt.zone_id = z.id
      ORDER BY z.name
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/management/zone-thresholds/:zoneId — save threshold for a zone
router.post('/zone-thresholds/:zoneId', async (req, res) => {
  try {
    const zoneId = parseInt(req.params.zoneId, 10);
    const { min_val, max_val } = req.body;

    if (min_val === undefined || max_val === undefined) {
      return res.status(400).json({ success: false, message: 'min_val and max_val are required' });
    }
    if (parseFloat(min_val) >= parseFloat(max_val)) {
      return res.status(400).json({ success: false, message: 'min_val must be less than max_val' });
    }

    const [zone] = await pool.query('SELECT id FROM zones WHERE id = ?', [zoneId]);
    if (!zone.length) return res.status(404).json({ success: false, message: 'Zone not found' });

    await pool.query(`
      INSERT INTO zone_thresholds (zone_id, min_val, max_val)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE min_val = VALUES(min_val), max_val = VALUES(max_val), updated_at = NOW()
    `, [zoneId, parseFloat(min_val), parseFloat(max_val)]);

    // TODO: When real signal send is enabled, evaluate latest sensor value here
    // and call sendSignal(zoneName, channel, TYPE.BOTH, DATA.ON, io)

    res.json({ success: true, message: `Threshold saved for zone ${zoneId}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
