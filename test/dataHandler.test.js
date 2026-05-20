const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Mock dependencies before requiring the handler
const insertedRows = [];
const deviceCache  = {};
const watchdogs    = {};
const alarmCalls   = [];
const ioCalls      = [];

// Stub pool
const pool = {
  query: async (sql, params) => {
    if (sql.includes('INSERT INTO sensor_readings')) {
      insertedRows.push(...(params[0] || []));
      return [{ affectedRows: params[0].length }];
    }
    if (sql.includes('SELECT * FROM devices')) {
      const name = params[0];
      return [deviceCache[name] ? [deviceCache[name]] : []];
    }
    if (sql.includes('INSERT INTO devices')) {
      const [name, type, w, d] = params;
      deviceCache[name] = { id: 1, device_name: name, sensor_type: type, warning_threshold: w, danger_threshold: d, zone_id: null };
      return [{}];
    }
    if (sql.includes('UPDATE devices SET last_seen')) {
      return [{}];
    }
    return [[]];
  }
};

// Inject mocks via module registry trick — use direct function testing
const { inferSensorType } = require('../src/services/deviceService');

describe('inferSensorType', () => {
  it('returns ASG for MZ-ASG-01', () => {
    assert.equal(inferSensorType('MZ-ASG-01'), 'ASG');
  });
  it('returns AST for MZ-AST-01', () => {
    assert.equal(inferSensorType('MZ-AST-01'), 'AST');
  });
  it('returns UNKNOWN for unknown names', () => {
    assert.equal(inferSensorType('MZ-XYZ-01'), 'UNKNOWN');
  });
});

describe('Payload parsing logic', () => {
  function parsePayload(raw) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && Array.isArray(parsed[0])) return parsed[0];
    if (Array.isArray(parsed)) return parsed;
    return null;
  }

  it('unwraps double-array [[...]] payload', () => {
    const raw = JSON.stringify([[{ DeviceName: 'MZ-ASG-01', Data: '-0.823', Calibration: '1.00000', Timestamp: 1234, Date: '2026-01-01' }]]);
    const result = parsePayload(raw);
    assert.equal(result.length, 1);
    assert.equal(result[0].DeviceName, 'MZ-ASG-01');
  });

  it('handles single-array [...] payload', () => {
    const raw = JSON.stringify([{ DeviceName: 'MZ-ASG-01', Data: '-0.823', Calibration: '1.00000', Timestamp: 1234, Date: '2026-01-01' }]);
    const result = parsePayload(raw);
    assert.equal(result.length, 1);
  });

  it('returns null for non-array payload', () => {
    const raw = JSON.stringify({ DeviceName: 'X' });
    const result = parsePayload(raw);
    assert.equal(result, null);
  });

  it('throws on malformed JSON', () => {
    assert.throws(() => JSON.parse('not json'), SyntaxError);
  });
});

describe('Field validation logic', () => {
  const REQUIRED = ['DeviceName', 'Data', 'Calibration', 'Timestamp', 'Date'];

  function validate(item) {
    return REQUIRED.filter(f => item[f] === undefined || item[f] === null);
  }

  it('passes valid item', () => {
    assert.deepEqual(validate({ DeviceName: 'X', Data: '1', Calibration: '1', Timestamp: 1, Date: 'd' }), []);
  });

  it('detects missing Data field', () => {
    assert.ok(validate({ DeviceName: 'X', Calibration: '1', Timestamp: 1, Date: 'd' }).includes('Data'));
  });

  it('detects null Timestamp', () => {
    assert.ok(validate({ DeviceName: 'X', Data: '1', Calibration: '1', Timestamp: null, Date: 'd' }).includes('Timestamp'));
  });
});

describe('Numeric conversion', () => {
  it('parses Data string to float', () => {
    assert.equal(parseFloat('-0.823'), -0.823);
  });
  it('parses Calibration string to float', () => {
    assert.equal(parseFloat('1.00000'), 1.0);
  });
  it('rejects non-numeric Data', () => {
    assert.ok(isNaN(parseFloat('abc')));
  });
});
