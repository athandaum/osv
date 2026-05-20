require('dotenv').config();
const mysql = require('mysql2/promise');

async function setup() {
  // Connect as root to create user and database
  const root = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: 'root',
    password: process.env.DB_ROOT_PASSWORD || '',
  });

  console.log('[DB Setup] Connected as root');

  const user = process.env.DB_USER;
  const pass = process.env.DB_PASSWORD;
  const db   = process.env.DB_NAME;

  await root.query(`CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log(`[DB Setup] Database '${db}' ready`);

  await root.query(`CREATE USER IF NOT EXISTS '${user}'@'localhost' IDENTIFIED BY '${pass}'`);
  await root.query(`GRANT ALL PRIVILEGES ON *.* TO '${user}'@'localhost' WITH GRANT OPTION`);
  await root.query(`FLUSH PRIVILEGES`);
  console.log(`[DB Setup] User '${user}' created with admin rights`);

  await root.end();

  // Now connect as the new user to create tables
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user,
    password: pass,
    database: db,
    multipleStatements: true,
  });

  const schema = `
    CREATE TABLE IF NOT EXISTS local_servers (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      name          VARCHAR(100) NOT NULL,
      broker_host   VARCHAR(255) NOT NULL,
      broker_port   INT NOT NULL DEFAULT 1883,
      connected     TINYINT(1) NOT NULL DEFAULT 0,
      last_seen     DATETIME NULL,
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS zones (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      name            VARCHAR(50) NOT NULL UNIQUE,
      signal_topic    VARCHAR(100) NOT NULL,
      alarm_level     ENUM('normal','warning','danger','comms_loss') NOT NULL DEFAULT 'normal',
      local_server_id INT NULL,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (local_server_id) REFERENCES local_servers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      device_name         VARCHAR(100) NOT NULL UNIQUE,
      sensor_type         ENUM('ASG','AST','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
      zone_id             INT NULL,
      local_server_id     INT NULL,
      safety_threshold    DECIMAL(10,4) NOT NULL DEFAULT 0.0000,
      warning_threshold   DECIMAL(10,4) NOT NULL DEFAULT 5.0000,
      danger_threshold    DECIMAL(10,4) NOT NULL DEFAULT 10.0000,
      active              TINYINT(1) NOT NULL DEFAULT 1,
      last_seen           DATETIME NULL,
      created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE SET NULL,
      FOREIGN KEY (local_server_id) REFERENCES local_servers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sensor_readings (
      id              BIGINT AUTO_INCREMENT PRIMARY KEY,
      device_name     VARCHAR(100) NOT NULL,
      data_value      DECIMAL(12,6) NOT NULL,
      calibration     DECIMAL(12,6) NOT NULL DEFAULT 1.000000,
      device_ts       BIGINT NOT NULL,
      device_date     VARCHAR(30) NOT NULL,
      received_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX idx_device_name (device_name),
      INDEX idx_received_at (received_at),
      INDEX idx_device_ts (device_ts)
    );

    CREATE TABLE IF NOT EXISTS alarms (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      zone_id         INT NOT NULL,
      level           ENUM('normal','warning','danger','comms_loss') NOT NULL,
      message         VARCHAR(255) NOT NULL,
      triggered_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at     DATETIME NULL,
      FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE,
      INDEX idx_zone_triggered (zone_id, triggered_at)
    );

    CREATE TABLE IF NOT EXISTS signal_status (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      zone_id     INT NOT NULL,
      channel     TINYINT NOT NULL COMMENT '0=all,1=red,2=yellow,3=green,4=buzzer',
      type        TINYINT NOT NULL COMMENT '0=large,1=small',
      data        TINYINT NOT NULL COMMENT '0=off,1=on',
      is_echo     TINYINT NOT NULL DEFAULT 0 COMMENT '0=command sent,1=echo from local server',
      sent_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE,
      INDEX idx_zone_sent (zone_id, sent_at)
    );

    CREATE TABLE IF NOT EXISTS signal_state (
      zone_id     INT NOT NULL,
      type        TINYINT NOT NULL COMMENT '0=large,1=small',
      channel     TINYINT NOT NULL DEFAULT 1 COMMENT '0=all,1=red,2=yellow,3=green,4=buzzer',
      data        TINYINT NOT NULL DEFAULT 0 COMMENT '0=off,1=on',
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (zone_id, type),
      FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS zone_thresholds (
      zone_id    INT NOT NULL PRIMARY KEY,
      min_val    DECIMAL(10,4) NOT NULL DEFAULT 5.0000 COMMENT 'Warning starts above this',
      max_val    DECIMAL(10,4) NOT NULL DEFAULT 10.0000 COMMENT 'Danger starts above this',
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS device_thresholds (
      device_id     INT NOT NULL PRIMARY KEY,
      green_min     DECIMAL(10,4) NOT NULL DEFAULT 0.0000 COMMENT 'Normal band lower bound',
      green_max     DECIMAL(10,4) NOT NULL DEFAULT 5.0000 COMMENT 'Normal band upper bound',
      yellow_min    DECIMAL(10,4) NOT NULL DEFAULT 5.0000 COMMENT 'Warning band lower bound',
      yellow_max    DECIMAL(10,4) NOT NULL DEFAULT 10.0000 COMMENT 'Warning band upper bound',
      red_min       DECIMAL(10,4) NOT NULL DEFAULT 10.0000 COMMENT 'Danger threshold — above this is red',
      signal_target TINYINT NOT NULL DEFAULT 2 COMMENT '0=large,1=small,2=both',
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
  `;

  await conn.query(schema);
  console.log('[DB Setup] All tables created');

  // Migrate: add safety_threshold if it doesn't exist (idempotent)
  await conn.query(`
    ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS safety_threshold DECIMAL(10,4) NOT NULL DEFAULT 0.0000
      AFTER local_server_id
  `).catch(() => {}); // ignore if already exists or syntax unsupported

  // Seed default zones M-1 to M-4
  await conn.query(`
    INSERT IGNORE INTO zones (name, signal_topic) VALUES
      ('M-1', 'Signal/M-1'),
      ('M-2', 'Signal/M-2'),
      ('M-3', 'Signal/M-3'),
      ('M-4', 'Signal/M-4')
  `);
  console.log('[DB Setup] Default zones M-1~M-4 seeded');

  await conn.end();
  console.log('[DB Setup] Done');
}

setup().catch(err => {
  console.error('[DB Setup] Error:', err.message);
  process.exit(1);
});
