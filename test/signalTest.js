require('dotenv').config();
const mqtt     = require('mqtt');
const readline = require('readline');

const BROKER_URL = `mqtt://${process.env.MQTT_BROKER_HOST}:${process.env.MQTT_BROKER_PORT || 1883}`;

const ZONES    = ['M-1', 'M-2', 'M-3', 'M-4'];
const CHANNELS = { 0: 'All', 1: 'Red', 2: 'Yellow', 3: 'Green', 4: 'Buzzer' };
const TYPES    = { 0: 'Large', 1: 'Small' };

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

const client = mqtt.connect(BROKER_URL, {
  clientId:       'osv-test-signal',
  username:       process.env.MQTT_USERNAME,
  password:       process.env.MQTT_PASSWORD,
  connectTimeout: 10000,
});

async function publishEcho(zone, channel, type, data) {
  const payload = JSON.stringify({
    Channel:   channel,
    Type:      type,
    Data:      data,
    Timestamp: Date.now(),
    Date:      new Date().toISOString().replace('T', ' ').replace('Z', ''),
  });

  return new Promise((resolve) => {
    client.publish(`Signal/${zone}`, payload, { qos: 1 }, (err) => {
      if (err) console.error(`  ✗ ${zone} ch=${channel} type=${type} data=${data} — ${err.message}`);
      else     console.log(`  ✓ ${zone} ch=${channel} type=${TYPES[type]} data=${data === 1 ? 'ON' : 'OFF'}`);
      resolve();
    });
  });
}

async function run() {
  console.log('\n═══════════════════════════════════');
  console.log('  OSV Signal Echo Test');
  console.log('═══════════════════════════════════\n');

  while (true) {
    // Zone selection
    console.log('Zone:');
    console.log('  0 = All (M-1 ~ M-4)');
    ZONES.forEach((z, i) => console.log(`  ${i + 1} = ${z}`));
    const zoneInput = (await ask('Select zone [0-4]: ')).trim();
    if (zoneInput === 'q') break;
    const zoneIdx = parseInt(zoneInput);
    if (isNaN(zoneIdx) || zoneIdx < 0 || zoneIdx > 4) { console.log('Invalid.\n'); continue; }
    const selectedZones = zoneIdx === 0 ? ZONES : [ZONES[zoneIdx - 1]];

    // Channel selection
    console.log('\nChannel:');
    Object.entries(CHANNELS).forEach(([k, v]) => console.log(`  ${k} = ${v}`));
    const chInput = (await ask('Select channel [0-4]: ')).trim();
    const channel = parseInt(chInput);
    if (isNaN(channel) || channel < 0 || channel > 4) { console.log('Invalid.\n'); continue; }

    // Type selection
    console.log('\nType:');
    console.log('  0 = Large');
    console.log('  1 = Small');
    console.log('  2 = Both');
    const typeInput = (await ask('Select type [0-2]: ')).trim();
    const typeVal = parseInt(typeInput);
    if (isNaN(typeVal) || typeVal < 0 || typeVal > 2) { console.log('Invalid.\n'); continue; }
    const selectedTypes = typeVal === 2 ? [0, 1] : [typeVal];

    // Data
    console.log('\nData:');
    console.log('  1 = ON');
    console.log('  0 = OFF');
    const dataInput = (await ask('Select data [0/1]: ')).trim();
    const data = parseInt(dataInput);
    if (data !== 0 && data !== 1) { console.log('Invalid.\n'); continue; }

    // Summary
    const typeLabel   = typeVal === 2 ? 'Both' : TYPES[typeVal];
    const zonesLabel  = zoneIdx === 0 ? 'All zones' : selectedZones.join(', ');
    console.log(`\nSending: ${zonesLabel} | ch=${CHANNELS[channel]} | type=${typeLabel} | ${data === 1 ? 'ON' : 'OFF'}`);

    // Publish
    for (const zone of selectedZones) {
      for (const type of selectedTypes) {
        await publishEcho(zone, channel, type, data);
        await new Promise(r => setTimeout(r, 100));
      }
    }

    console.log('Done.\n');

    const again = (await ask('Send another? [y/n]: ')).trim().toLowerCase();
    if (again !== 'y') break;
    console.log();
  }

  rl.close();
  client.end();
  console.log('\nDisconnected. Bye.');
}

client.on('connect', () => {
  console.log(`[SignalTest] Connected to ${BROKER_URL}`);
  run();
});

client.on('error', (err) => {
  console.error('[SignalTest] Connection error:', err.message);
  rl.close();
  client.end();
});
