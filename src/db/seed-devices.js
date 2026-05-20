require('dotenv').config();
const mysql = require('mysql2/promise');

const SENSORS = [
  // No  Legend              Installed  Type          Zone   Floor  Serial    Safety  Warning  Danger
  {  device_name: 'M4-F1-AST-01', active: 1, sensor_type: 'AST', zone: 'M-4', floor: 'F1', serial: 'AST-01', safety: 19.89, warning: 26.52, danger: 33.15 },
  {  device_name: 'M3-F2-AST-02', active: 1, sensor_type: 'AST', zone: 'M-3', floor: 'F2', serial: 'AST-02', safety: 23.72, warning: 31.63, danger: 39.54 },
  {  device_name: 'M1-F2-AST-03', active: 0, sensor_type: 'AST', zone: 'M-1', floor: 'F2', serial: 'AST-03', safety: 51.94, warning: 69.25, danger: 86.56 },
  {  device_name: 'M4-F3-AST-04', active: 1, sensor_type: 'AST', zone: 'M-4', floor: 'F3', serial: 'AST-04', safety: 28.07, warning: 37.43, danger: 46.79 },
  {  device_name: 'M2-F3-AST-05', active: 0, sensor_type: 'AST', zone: 'M-2', floor: 'F3', serial: 'AST-05', safety: 64.16, warning: 85.54, danger: 106.93 },
  {  device_name: 'M3-F4-AST-06', active: 0, sensor_type: 'AST', zone: 'M-3', floor: 'F4', serial: 'AST-06', safety: 29.59, warning: 39.45, danger: 49.31 },
  {  device_name: 'M1-F4-AST-07', active: 0, sensor_type: 'AST', zone: 'M-1', floor: 'F4', serial: 'AST-07', safety: 19.25, warning: 25.67, danger: 32.09 },
  {  device_name: 'M2-F4-AST-08', active: 0, sensor_type: 'AST', zone: 'M-2', floor: 'F4', serial: 'AST-08', safety: 20.18, warning: 26.90, danger: 33.63 },
  {  device_name: 'M2-F4-AST-09', active: 0, sensor_type: 'AST', zone: 'M-2', floor: 'F4', serial: 'AST-09', safety: 20.18, warning: 26.90, danger: 33.63 },
  {  device_name: 'M4-F5-AST-10', active: 0, sensor_type: 'AST', zone: 'M-4', floor: 'F5', serial: 'AST-10', safety: 38.36, warning: 51.15, danger: 63.94 },
  {  device_name: 'M4-F1-ASG-01', active: 1, sensor_type: 'ASG', zone: 'M-4', floor: 'F1', serial: 'ASG-01', safety: 27.64, warning: 36.86, danger: 46.07 },
  {  device_name: 'M4-F1-ASG-02', active: 1, sensor_type: 'ASG', zone: 'M-4', floor: 'F1', serial: 'ASG-02', safety: 26.45, warning: 35.27, danger: 44.09 },
  {  device_name: 'M2-F1-ASG-03', active: 1, sensor_type: 'ASG', zone: 'M-2', floor: 'F1', serial: 'ASG-03', safety: 27.64, warning: 36.86, danger: 46.07 },
  {  device_name: 'M4-F2-ASG-04', active: 1, sensor_type: 'ASG', zone: 'M-4', floor: 'F2', serial: 'ASG-04', safety: 27.29, warning: 36.38, danger: 45.48 },
  {  device_name: 'M2-F2-ASG-05', active: 1, sensor_type: 'ASG', zone: 'M-2', floor: 'F2', serial: 'ASG-05', safety: 27.29, warning: 36.38, danger: 45.48 },
  {  device_name: 'M4-F3-ASG-06', active: 0, sensor_type: 'ASG', zone: 'M-4', floor: 'F3', serial: 'ASG-06', safety: 31.66, warning: 42.22, danger: 52.77 },
  {  device_name: 'M2-F3-ASG-07', active: 0, sensor_type: 'ASG', zone: 'M-2', floor: 'F3', serial: 'ASG-07', safety: 31.66, warning: 42.22, danger: 52.77 },
  {  device_name: 'M4-F3-ASG-08', active: 1, sensor_type: 'ASG', zone: 'M-4', floor: 'F3', serial: 'ASG-08', safety: 41.84, warning: 55.79, danger: 69.74 },
  {  device_name: 'M4-F4-ASG-09', active: 0, sensor_type: 'ASG', zone: 'M-4', floor: 'F4', serial: 'ASG-09', safety: 27.51, warning: 36.68, danger: 45.85 },
  {  device_name: 'M2-F4-ASG-10', active: 0, sensor_type: 'ASG', zone: 'M-2', floor: 'F4', serial: 'ASG-10', safety: 27.51, warning: 36.68, danger: 45.85 },
  {  device_name: 'M4-F5-ASG-11', active: 0, sensor_type: 'ASG', zone: 'M-4', floor: 'F5', serial: 'ASG-11', safety: 27.28, warning: 36.37, danger: 45.46 },
  {  device_name: 'M2-F5-ASG-12', active: 0, sensor_type: 'ASG', zone: 'M-2', floor: 'F5', serial: 'ASG-12', safety: 27.28, warning: 36.37, danger: 45.46 },
  {  device_name: 'M4-F5-ASG-13', active: 0, sensor_type: 'ASG', zone: 'M-4', floor: 'F5', serial: 'ASG-13', safety: 14.64, warning: 19.52, danger: 24.40 },
  {  device_name: 'M2-F6-ASG-14', active: 0, sensor_type: 'ASG', zone: 'M-2', floor: 'F6', serial: 'ASG-14', safety: 32.11, warning: 42.81, danger: 53.51 },
];

async function seed() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST,
    port:     process.env.DB_PORT,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  console.log('[Seed] Connected');

  // Load zone name → id map
  const [zones] = await conn.query('SELECT id, name FROM zones');
  const zoneMap = {};
  zones.forEach(z => { zoneMap[z.name] = z.id; });
  console.log('[Seed] Zones:', zoneMap);

  let inserted = 0, updated = 0;

  for (const s of SENSORS) {
    const zoneId = zoneMap[s.zone] || null;
    if (!zoneId) {
      console.warn(`[Seed] Zone not found for ${s.device_name} (${s.zone}) — skipping`);
      continue;
    }

    const [existing] = await conn.query(
      'SELECT id FROM devices WHERE device_name = ?', [s.device_name]
    );

    if (existing.length) {
      await conn.query(`
        UPDATE devices SET
          sensor_type       = ?,
          zone_id           = ?,
          active            = ?,
          safety_threshold  = ?,
          warning_threshold = ?,
          danger_threshold  = ?
        WHERE device_name = ?
      `, [s.sensor_type, zoneId, s.active, s.safety, s.warning, s.danger, s.device_name]);
      console.log(`[Seed] Updated: ${s.device_name}`);
      updated++;
    } else {
      await conn.query(`
        INSERT INTO devices
          (device_name, sensor_type, zone_id, active, safety_threshold, warning_threshold, danger_threshold)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [s.device_name, s.sensor_type, zoneId, s.active, s.safety, s.warning, s.danger]);
      console.log(`[Seed] Inserted: ${s.device_name}`);
      inserted++;
    }
  }

  console.log(`[Seed] Done — ${inserted} inserted, ${updated} updated`);
  await conn.end();
}

seed().catch(err => {
  console.error('[Seed] Error:', err.message);
  process.exit(1);
});
