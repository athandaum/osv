require('dotenv').config();
const mqtt = require('mqtt');
const { handleDataMessage }       = require('./handlers/dataHandler');
const { handleSignalResponse }    = require('./handlers/signalResponseHandler');
const bridge                      = require('./bridge');

const BROKER_URL = `mqtt://${process.env.MQTT_BROKER_HOST}:${process.env.MQTT_BROKER_PORT || 1883}`;
const CLIENT_ID  = process.env.MQTT_CLIENT_ID || 'osv-main-server';

let client = null;
let _io = null;

const TOPICS = {
  DATA:    'Data',
  SIGNAL:  ['Signal/M-1', 'Signal/M-2', 'Signal/M-3', 'Signal/M-4'],
};

function getClient() {
  return client;
}

function init(io) {
  _io = io;

  client = mqtt.connect(BROKER_URL, {
    clientId:          CLIENT_ID,
    clean:             true,
    reconnectPeriod:   5000,   // retry every 5s
    connectTimeout:    10000,
    keepalive:         60,
    username:          process.env.MQTT_USERNAME || undefined,
    password:          process.env.MQTT_PASSWORD || undefined,
  });

  bridge.setClient(client);

  client.on('connect', () => {
    console.log(`[MQTT] Connected to broker at ${BROKER_URL}`);
    if (_io) _io.emit('mqtt:status', { connected: true, broker: BROKER_URL });

    client.subscribe(TOPICS.DATA, { qos: 1 }, (err) => {
      if (err) {
        console.error('[MQTT] Subscribe error on topic Data:', err.message);
      } else {
        console.log('[MQTT] Subscribed to topic: Data');
      }
    });

    client.subscribe(TOPICS.SIGNAL, { qos: 1 }, (err) => {
      if (err) {
        console.error('[MQTT] Subscribe error on Signal topics:', err.message);
      } else {
        console.log('[MQTT] Subscribed to topics: Signal/M-1 ~ M-4');
      }
    });
  });

  client.on('reconnect', () => {
    console.log('[MQTT] Attempting to reconnect...');
    if (_io) _io.emit('mqtt:status', { connected: false, reconnecting: true, broker: BROKER_URL });
  });

  client.on('offline', () => {
    console.warn('[MQTT] Client went offline');
    if (_io) _io.emit('mqtt:status', { connected: false, reconnecting: false, broker: BROKER_URL });
  });

  client.on('error', (err) => {
    console.error('[MQTT] Error:', err.message);
    if (_io) _io.emit('mqtt:error', { message: err.message });
  });

  client.on('close', () => {
    console.warn('[MQTT] Connection closed');
  });

  client.on('message', (topic, payload) => {
    const raw = payload.toString();
    if (topic === TOPICS.DATA) {
      handleDataMessage(raw, _io);
    } else if (TOPICS.SIGNAL.includes(topic)) {
      handleSignalResponse(topic, raw, _io);
    }
  });

  return client;
}

function publish(topic, payload) {
  if (!client || !client.connected) {
    console.error('[MQTT] Cannot publish — not connected');
    return false;
  }
  const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
  client.publish(topic, message, { qos: 1 }, (err) => {
    if (err) {
      console.error(`[MQTT] Publish error on ${topic}:`, err.message);
    } else {
      console.log(`[MQTT] Published to ${topic}:`, message);
    }
  });
  return true;
}

function isConnected() {
  return client !== null && client.connected;
}

module.exports = { init, publish, isConnected, getClient };
