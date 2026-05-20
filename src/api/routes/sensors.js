const express = require('express');
const router  = express.Router();
const pool    = require('../../db/pool');

// Format a date value to "yyyy-mm-dd hh:mm:ss" with no milliseconds or timezone
function fmtDate(val) {
  if (!val) return '';
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d)) return String(val).slice(0, 19).replace('T', ' ');
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// GET /api/sensors/latest — latest reading per device
router.get('/latest', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT sr.*
      FROM sensor_readings sr
      INNER JOIN (
        SELECT device_name, MAX(received_at) AS max_received
        FROM sensor_readings
        GROUP BY device_name
      ) latest ON sr.device_name = latest.device_name AND sr.received_at = latest.max_received
      ORDER BY sr.device_name
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/sensors/history/csv — same filters as /history, returns CSV (must be before /history)
router.get('/history/csv', async (req, res) => {
  try {
    const { device, zone, from, to } = req.query;
    const conditions = [];
    const params     = [];

    if (device) { conditions.push('sr.device_name = ?'); params.push(device); }
    if (zone)   { conditions.push('z.name = ?');         params.push(zone); }
    if (from)   { conditions.push('sr.received_at >= ?'); params.push(from); }
    if (to)     { conditions.push('sr.received_at <= ?'); params.push(to); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(10000);

    const [rows] = await pool.query(
      `SELECT sr.id, sr.device_name, COALESCE(z.name, '—') AS zone_name,
              sr.data_value, sr.calibration, sr.device_date, sr.received_at
       FROM sensor_readings sr
       LEFT JOIN devices d ON d.device_name = sr.device_name
       LEFT JOIN zones z ON z.id = d.zone_id
       ${where}
       ORDER BY sr.received_at DESC
       LIMIT ?`,
      params
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sensor-data.csv"');

    const header = 'No,Device Name,Zone,Data Value,Calibration,Device Date,Received At\n';
    const csv = rows.map((r, i) =>
      [
        i + 1,
        r.device_name,
        r.zone_name,
        r.data_value,
        r.calibration,
        fmtDate(r.device_date),
        fmtDate(r.received_at),
      ].join(',')
    ).join('\n');

    res.send(header + csv);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/sensors/history?device=MZ-ASG-01&zone=M-1&from=2026-01-01&to=2026-12-31&limit=50&page=1
router.get('/history', async (req, res) => {
  try {
    const { device, zone, from, to, limit = 50, page = 1 } = req.query;
    const conditions = [];
    const params     = [];

    if (device) { conditions.push('sr.device_name = ?'); params.push(device); }
    if (zone)   { conditions.push('z.name = ?');         params.push(zone); }
    if (from)   { conditions.push('sr.received_at >= ?'); params.push(from); }
    if (to)     { conditions.push('sr.received_at <= ?'); params.push(to); }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim    = parseInt(limit);
    const offset = (parseInt(page) - 1) * lim;

    // Get total count
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM sensor_readings sr
       LEFT JOIN devices d ON d.device_name = sr.device_name
       LEFT JOIN zones z ON z.id = d.zone_id
       ${where}`,
      params
    );
    const total = countRows[0].total;

    params.push(lim, offset);
    const [rows] = await pool.query(
      `SELECT sr.id, sr.device_name, COALESCE(z.name, '—') AS zone_name,
              sr.data_value, sr.calibration, sr.device_date, sr.received_at
       FROM sensor_readings sr
       LEFT JOIN devices d ON d.device_name = sr.device_name
       LEFT JOIN zones z ON z.id = d.zone_id
       ${where}
       ORDER BY sr.received_at DESC
       LIMIT ? OFFSET ?`,
      params
    );
    res.json({ success: true, data: rows, total, page: parseInt(page), limit: lim });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
