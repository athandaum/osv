/**
 * Thin bridge that holds the MQTT client reference.
 * Breaks the circular dependency:
 *   client.js → dataHandler → alarmService → signalService → client.js
 * Services require bridge.js instead of client.js directly.
 */

/**
 * Self-echo detection using an in-memory fingerprint counter.
 * When we publish, we record the fingerprint (topic|Channel|Type|Data).
 * When we receive the same message back (our own MQTT echo), we consume
 * one count and skip it. The Local Server's echo arrives later on the
 * same topic but WITHOUT being in this tracker, so it passes through.
 */
let _client = null;

// fingerprint -> pending count
const _selfEchos = new Map();

function setClient(client) {
  _client = client;
}

function publish(topic, payload) {
  if (!_client || !_client.connected) {
    console.error('[MQTTBridge] Cannot publish — not connected');
    return false;
  }

  const message = typeof payload === 'string' ? payload : JSON.stringify(payload);

  // Register fingerprint BEFORE publishing so it's ready when the broker
  // loops our own message back to us (usually < 50 ms).
  if (typeof payload === 'object' &&
      payload.Channel !== undefined &&
      payload.Type    !== undefined &&
      payload.Data    !== undefined) {
    const fp = `${topic}|${payload.Channel}|${payload.Type}|${payload.Data}`;
    _selfEchos.set(fp, (_selfEchos.get(fp) || 0) + 1);
    // Safety cleanup: remove after 3 s in case the broker never loops it back
    setTimeout(() => {
      const n = _selfEchos.get(fp);
      if (n > 1) _selfEchos.set(fp, n - 1);
      else       _selfEchos.delete(fp);
    }, 3000);
  }

  _client.publish(topic, message, { qos: 1 }, (err) => {
    if (err) console.error(`[MQTTBridge] Publish error on ${topic}:`, err.message);
    else     console.log(`[MQTTBridge] Published to ${topic}:`, message);
  });
  return true;
}

/**
 * Returns true if this incoming message is our own publish looped back by
 * the broker. Consumes one count so the next identical message (the actual
 * Local Server echo) will pass through normally.
 */
function isSelfEcho(topic, parsed) {
  if (parsed.Channel === undefined || parsed.Type === undefined || parsed.Data === undefined) return false;
  const fp = `${topic}|${parsed.Channel}|${parsed.Type}|${parsed.Data}`;
  const n  = _selfEchos.get(fp) || 0;
  if (n > 0) {
    if (n > 1) _selfEchos.set(fp, n - 1);
    else       _selfEchos.delete(fp);
    return true;
  }
  return false;
}

function isConnected() {
  return _client !== null && _client.connected;
}

module.exports = { setClient, publish, isConnected, isSelfEcho };
