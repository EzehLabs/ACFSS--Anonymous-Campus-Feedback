const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFutoLocation } = require('./location');

test('accepts a precise location at the FUTO campus', () => {
  assert.deepEqual(
    validateFutoLocation({ latitude: 5.3844, longitude: 7.0365, accuracy: 20 }),
    { valid: true, withinCampus: true }
  );
});

test('accepts a precise location within 3 km of FUTO', () => {
  assert.equal(
    validateFutoLocation({ latitude: 5.405, longitude: 7.0365, accuracy: 50 }).withinCampus,
    true
  );
});

test('rejects a location outside the 3 km FUTO geofence', () => {
  assert.equal(
    validateFutoLocation({ latitude: 5.43, longitude: 7.0365, accuracy: 50 }).withinCampus,
    false
  );
});

test('rejects missing, invalid, or imprecise locations', () => {
  assert.equal(validateFutoLocation(null).valid, false);
  assert.equal(
    validateFutoLocation({ latitude: 95, longitude: 7, accuracy: 50 }).valid,
    false
  );
  assert.equal(
    validateFutoLocation({ latitude: 5.3844, longitude: 7.0365, accuracy: 1001 }).valid,
    false
  );
});
