# OSV Main Server

MQTT-based data receiver and signal control server for OSV load cell and strain gauge monitoring.

---

## Architecture

```
Local Server (MQTT Broker)
    │
    │  topic: Data (every 30s)
    ▼
Main Server (MQTT Client)  ──►  MySQL Database
    │                               │
    │  topic: Signal/M-1~M-4        │
    ▼                               ▼
Local Server (Signal Lights)    REST API / Socket.IO
                                    │
                                    ▼
                                Dashboard (external)
```

- The **MQTT broker** runs on the Local Server — the Main Server connects to it as a client only.
- The Main Server **subscribes** to the `Data` topic to receive sensor readings.
- The Main Server **publishes** to `Signal/M-1` ~ `Signal/M-4` to control signal lights.

---

## Project Structure

```
osv/
├── src/
│   ├── index.js                  # Entry point — Express, Socket.IO, MQTT
│   ├── db/
│   │   ├── setup.js              # One-time DB setup (run before first start)
│   │   └── pool.js               # MySQL connection pool
│   ├── mqtt/
│   │   ├── client.js             # MQTT client, auto-reconnect, subscriptions
│   │   └── handlers/
│   │       └── dataHandler.js    # Parse, validate, and store incoming sensor data
│   ├── services/
│   │   ├── deviceService.js      # Device lookup, auto-registration, zone mapping
│   │   ├── alarmService.js       # Threshold comparison, alarm level management
│   │   ├── signalService.js      # Signal light command publisher
│   │   └── watchdogService.js    # 30-second comms-loss detection per device
│   └── api/routes/
│       ├── sensors.js            # GET /api/sensors/latest|history
│       ├── devices.js            # GET, PUT /api/devices
│       ├── zones.js              # GET /api/zones
│       ├── alarms.js             # GET /api/alarms
│       ├── signal.js             # POST /api/signal/:zone
│       └── connection.js         # GET /api/connection/status
├── test/
│   ├── dataHandler.test.js
│   └── signal.test.js
├── .env
└── .env.example
```

---

## Requirements

- Node.js v18+
- MySQL 5.7+ or 8.x (running on localhost)

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in the values:

```env
# MQTT — update when Local Server IP is known
MQTT_BROKER_HOST=192.168.1.100
MQTT_BROKER_PORT=1883
MQTT_CLIENT_ID=osv-main-server

# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_NAME=osv
DB_USER=osvadmin
DB_PASSWORD=osvadmin123!
DB_ROOT_PASSWORD=your_mysql_root_password

# HTTP Server
HTTP_PORT=43000

# Alarm thresholds (default, can be overridden per device via API)
DEFAULT_WARNING_THRESHOLD=5.0
DEFAULT_DANGER_THRESHOLD=10.0

# Seconds without data before comms-loss alarm is triggered
COMMS_LOSS_TIMEOUT=60
```

### 3. Initialize the database

Runs once to create the MySQL user, database, tables, and default zones (M-1 ~ M-4).

```bash
node src/db/setup.js
```

### 4. Start the server

```bash
npm start
```

Development mode (auto-restart on file change):

```bash
npm run dev
```

---

## Database Tables

| Table | Description |
|-------|-------------|
| `local_servers` | Local Server registry and connection status |
| `zones` | Zones M-1~M-4, signal topics, current alarm level |
| `devices` | Device list, sensor type, zone mapping, thresholds |
| `sensor_readings` | All incoming sensor readings with timestamps |
| `alarms` | Alarm history with trigger and resolve times |
| `signal_status` | Log of all signal commands sent |

---

## MQTT Protocol

### Subscribe — `Data` topic

Received from the Local Server every 30 seconds.

**Payload format:**
```json
[[
  {
    "DeviceName": "MZ-ASG-01",
    "Data": "-0.823",
    "Calibration": "1.00000",
    "Timestamp": 1771493813212,
    "Date": "2026-02-19 18:36:53:212"
  },
  {
    "DeviceName": "MZ-AST-01",
    "Data": "-0.823",
    "Calibration": "1.00000",
    "Timestamp": 1771493813212,
    "Date": "2026-02-19 18:36:53:212"
  }
]]
```

- Outer wrapper is a double array `[[...]]`
- `Data` and `Calibration` are strings — converted to float on receipt
- `Timestamp` is Unix milliseconds from the Local Server

### Publish — `Signal/M-1` ~ `Signal/M-4`

Sent by the Main Server to control signal lights per zone.

**Payload format:**
```json
{
  "Channel": 1,
  "Type": 0,
  "Data": 1,
  "Timestamp": 1771493813212,
  "Date": "2026-02-19 18:36:53:212"
}
```

**Channel values:**

| Value | Meaning |
|-------|---------|
| 0 | All channels (1~4) |
| 1 | Red |
| 2 | Yellow |
| 3 | Green |
| 4 | Buzzer |

**Type values:**

| Value | Meaning |
|-------|---------|
| 0 | Large signal light |
| 1 | Small signal light |

**Data values:**

| Value | Meaning |
|-------|---------|
| 0 | Off |
| 1 | On |

> Max 2 channels can be on at the same time.

---

## Alarm Logic

| Level | Condition | Signal Action |
|-------|-----------|---------------|
| `normal` | Value below warning threshold | Green ON |
| `warning` | Value >= warning threshold | Yellow ON |
| `danger` | Value >= danger threshold | Red ON + Buzzer ON |
| `comms_loss` | No data received for `COMMS_LOSS_TIMEOUT` seconds | Yellow ON |

- Thresholds are evaluated against the absolute value of the reading.
- Default thresholds: warning = `5.0`, danger = `10.0` (configurable per device via API).
- Each device has its own watchdog timer. The timer resets on every received reading.
- Alarm level changes are logged to the `alarms` table.

---

## REST API

Base URL: `http://localhost:43000`

### Sensor Data

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sensors/latest` | Latest reading per device |
| GET | `/api/sensors/history` | Historical readings with filters |

**Query parameters for `/history`:**

| Param | Type | Description |
|-------|------|-------------|
| `device` | string | Filter by DeviceName |
| `from` | datetime | Start of range |
| `to` | datetime | End of range |
| `limit` | number | Max results (default 100) |
| `offset` | number | Pagination offset (default 0) |

### Devices

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/devices` | List all devices |
| PUT | `/api/devices/:id/thresholds` | Update warning/danger thresholds |
| PUT | `/api/devices/:id/zone` | Assign device to a zone |

**PUT `/api/devices/:id/thresholds` body:**
```json
{ "warning_threshold": 5.0, "danger_threshold": 10.0 }
```

**PUT `/api/devices/:id/zone` body:**
```json
{ "zone_id": 1 }
```

### Zones

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/zones` | List all zones with current alarm level |

### Alarms

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/alarms` | Alarm history |

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `zone` | string | Filter by zone name (e.g. `M-1`) |
| `limit` | number | Max results (default 50) |
| `offset` | number | Pagination offset |

### Signal Control

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/signal/:zone` | Manually send signal command to a zone |

**Valid zones:** `M-1`, `M-2`, `M-3`, `M-4`

**Body:**
```json
{ "channel": 1, "type": 0, "data": 1 }
```

### Connection Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/connection/status` | MQTT connection status and local server list |

---

## Socket.IO Events

Connect to `http://localhost:43000` with a Socket.IO client.

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `mqtt:status` | Server → Client | `{ connected, reconnecting, broker }` | MQTT connection state change |
| `mqtt:error` | Server → Client | `{ message }` | MQTT error |
| `sensor:data` | Server → Client | `{ deviceName, dataValue, calibration, deviceDate, receivedAt }` | New sensor reading received |
| `alarm:change` | Server → Client | `{ zoneId, level, message, previous }` | Alarm level changed |
| `signal:sent` | Server → Client | `{ zone, channel, type, data, timestamp }` | Signal command published |
| `comms:loss` | Server → Client | `{ deviceName, zoneId, zoneName }` | Device comms loss detected |

---

## Device Mapping

When a device is seen for the first time, it is auto-registered in the `devices` table with:
- Sensor type inferred from `DeviceName` (`ASG` or `AST`)
- Default thresholds from `.env`
- No zone assignment

**Assign a device to a zone after first data arrives:**

```bash
# Get device list to find the device ID
GET /api/devices

# Assign to zone (zone_id 1 = M-1, 2 = M-2, etc.)
PUT /api/devices/1/zone
{ "zone_id": 1 }
```

Once assigned, threshold checks and alarm logic will activate for that device.

---

## Tests

```bash
npm test
```

Test coverage:
- Sensor type inference
- Payload parsing (`[[...]]` double-array unwrap)
- Field validation (required fields, null detection)
- Numeric type conversion
- Signal payload structure
- Alarm threshold logic (normal / warning / danger / negative values)
- Watchdog timeout configuration

---

## MySQL User

| Field | Value |
|-------|-------|
| User | `osvadmin` |
| Password | set in `.env` → `DB_PASSWORD` |
| Host | `localhost` |
| Privileges | ALL PRIVILEGES WITH GRANT OPTION |

Created automatically by `node src/db/setup.js`.
