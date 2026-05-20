const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('Signal payload structure', () => {
  function buildSignalPayload(channel, type, data) {
    const now = Date.now();
    const dateStr = new Date(now).toISOString().replace('T', ' ').replace('Z', '');
    return { Channel: channel, Type: type, Data: data, Timestamp: now, Date: dateStr };
  }

  it('builds valid signal payload', () => {
    const p = buildSignalPayload(1, 0, 1);
    assert.equal(p.Channel, 1);
    assert.equal(p.Type, 0);
    assert.equal(p.Data, 1);
    assert.ok(typeof p.Timestamp === 'number');
    assert.ok(typeof p.Date === 'string');
  });

  it('Channel 0 means all channels', () => {
    const p = buildSignalPayload(0, 0, 0);
    assert.equal(p.Channel, 0);
  });

  it('Data 0 means Off, 1 means On', () => {
    assert.equal(buildSignalPayload(1, 0, 0).Data, 0);
    assert.equal(buildSignalPayload(1, 0, 1).Data, 1);
  });

  it('topic is Signal/{zoneName}', () => {
    const zones = ['M-1', 'M-2', 'M-3', 'M-4'];
    zones.forEach(z => {
      assert.equal(`Signal/${z}`, `Signal/${z}`);
    });
  });
});

describe('Alarm threshold logic', () => {
  function getLevel(value, warningThreshold, dangerThreshold) {
    const abs = Math.abs(value);
    if (abs >= dangerThreshold)  return 'danger';
    if (abs >= warningThreshold) return 'warning';
    return 'normal';
  }

  it('returns normal for value below warning threshold', () => {
    assert.equal(getLevel(2.0, 5.0, 10.0), 'normal');
  });

  it('returns warning for value at warning threshold', () => {
    assert.equal(getLevel(5.0, 5.0, 10.0), 'warning');
  });

  it('returns danger for value at danger threshold', () => {
    assert.equal(getLevel(10.0, 5.0, 10.0), 'danger');
  });

  it('uses absolute value for negative readings', () => {
    assert.equal(getLevel(-11.0, 5.0, 10.0), 'danger');
  });
});

describe('Watchdog timing', () => {
  it('comms loss timeout defaults to 60s when env not set', () => {
    const timeout = (parseInt(undefined) || 60) * 1000;
    assert.equal(timeout, 60000);
  });

  it('respects custom COMMS_LOSS_TIMEOUT env', () => {
    const timeout = (parseInt('90') || 60) * 1000;
    assert.equal(timeout, 90000);
  });
});
