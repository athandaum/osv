const express = require('express');
const router  = express.Router();
const pool    = require('../../db/pool');

// GET /api/alarms?zone=M-1&level=danger&limit=50&page=1
router.get('/', async (req, res) => {
  try {
    const { zone, level, limit = 50, page = 1 } = req.query;
    const conditions = [];
    const params     = [];

    if (zone)  { conditions.push('z.name = ?');   params.push(zone); }
    if (level) { conditions.push('a.level = ?');  params.push(level); }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim    = parseInt(limit);
    const offset = (parseInt(page) - 1) * lim;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM alarms a JOIN zones z ON a.zone_id = z.id ${where}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await pool.query(
      `SELECT a.*, z.name AS zone_name
       FROM alarms a
       JOIN zones z ON a.zone_id = z.id
       ${where}
       ORDER BY a.triggered_at DESC
       LIMIT ? OFFSET ?`,
      [...params, lim, offset]
    );

    res.json({ success: true, data: rows, total, page: parseInt(page), limit: lim });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
