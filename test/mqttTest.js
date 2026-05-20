require('dotenv').config();
const mqtt = require('mqtt');

const BROKER_URL = `mqtt://${process.env.MQTT_BROKER_HOST}:${process.env.MQTT_BROKER_PORT || 1883}`;

const client = mqtt.connect(BROKER_URL, {
  clientId:  'osv-test-publisher',
  username:  process.env.MQTT_USERNAME,
  password:  process.env.MQTT_PASSWORD,
  connectTimeout: 10000,
});

const payload = JSON.stringify([[
  {
    DeviceName:  'MZ-ASG-01',
    Data:        '-0.823',
    Calibration: '1.00000',
    Timestamp:   Date.now(),
    Date:        new Date().toISOString().replace('T', ' ').replace('Z', ''),
  },
  {
    DeviceName:  'MZ-AST-01',
    Data:        '3.456',
    Calibration: '1.00000',
    Timestamp:   Date.now(),
    Date:        new Date().toISOString().replace('T', ' ').replace('Z', ''),
  },
]]);

client.on('connect', () => {
  console.log(`[Test] Connected to ${BROKER_URL}`);
  client.publish('Data', payload, { qos: 1 }, (err) => {
    if (err) {
      console.error('[Test] Publish failed:', err.message);
    } else {
      console.log('[Test] Published to topic: Data');
      console.log('[Test] Payload:', payload);
    }
    client.end();
  });
});

client.on('error', (err) => {
  console.error('[Test] Connection error:', err.message);
  client.end();
});
