const express = require('express');
const router  = express.Router();
const pool    = require('../../db/pool');

// GET /api/zones
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT z.*,
        (SELECT COUNT(*) FROM devices d WHERE d.zone_id = z.id) AS device_count
      FROM zones z
      ORDER BY z.name
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
