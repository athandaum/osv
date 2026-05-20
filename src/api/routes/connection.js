const express  = require('express');
const http     = require('http');
const router   = express.Router();
const pool     = require('../../db/pool');
const mqttClient = require('../../mqtt/client');

// GET /api/connection/status
router.get('/status', async (req, res) => {
  try {
    const mqttConnected = mqttClient.isConnected();

    const [localServers] = await pool.query(
      'SELECT id, name, broker_host, broker_port, connected, last_seen FROM local_servers'
    );

    res.json({
      success: true,
      data: {
        mqtt: {
          connected: mqttConnected,
          broker: `${process.env.MQTT_BROKER_HOST}:${process.env.MQTT_BROKER_PORT}`,
        },
        local_servers: localServers,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/connection/clients
// Proxies RabbitMQ management API to list all connected MQTT clients
router.get('/clients', async (req, res) => {
  const host     = process.env.MQTT_BROKER_HOST;
  const mgmtPort = parseInt(process.env.RABBITMQ_MGMT_PORT) || 15672;
  const user     = process.env.MQTT_USERNAME;
  const pass     = process.env.MQTT_PASSWORD;
  const auth     = Buffer.from(`${user}:${pass}`).toString('base64');

  // Fetch connections and consumers in parallel
  function rabbitGet(path) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: host,
        port:     mgmtPort,
        path,
        method:   'GET',
        headers:  { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        timeout:  5000,
      };
      const req = http.request(options, (r) => {
        let body = '';
        r.on('data', c => body += c);
        r.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('Invalid JSON from RabbitMQ')); }
        });
      });
      req.on('error',   reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('RabbitMQ timeout')); });
      req.end();
    });
  }

  try {
    const [connections, consumers] = await Promise.all([
      rabbitGet('/api/connections'),
      rabbitGet('/api/consumers'),
    ]);

    // Build a map: connection_name -> list of queues subscribed
    const subMap = {};
    if (Array.isArray(consumers)) {
      consumers.forEach(c => {
        const name = c.channel_details && c.channel_details.connection_name;
        if (!name) return;
        if (!subMap[name]) subMap[name] = [];
        subMap[name].push(c.queue && c.queue.name);
      });
    }

    const clients = (Array.isArray(connections) ? connections : []).map(c => ({
      name:         c.name,
      client_id:    (c.client_properties && c.client_properties.client_id) || c.name,
      peer_host:    c.peer_host,
      peer_port:    c.peer_port,
      protocol:     c.protocol,
      state:        c.state,
      connected_at: c.connected_at,   // epoch ms
      subscriptions: subMap[c.name] || [],
      recv_oct:     c.recv_oct,
      send_oct:     c.send_oct,
    }));

    res.json({ success: true, data: clients, broker: `${host}:${mgmtPort}` });
  } catch (err) {
    res.status(502).json({ success: false, message: `Cannot reach RabbitMQ management: ${err.message}` });
  }
});

module.exports = router;
