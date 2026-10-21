import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateClientPatientProfile,
  formatShortAddress,
  calculateAge,
  DEFAULT_PATIENT_PROFILE,
} from '../src/lib/patientProfile.js';

test('formatShortAddress handles addresses and edge cases', () => {
  assert.equal(formatShortAddress(''), '');
  assert.equal(formatShortAddress(null), '');
  assert.equal(formatShortAddress('0x1234'), '0x1234');
  assert.equal(formatShortAddress('0x6c1A4da70506164Aa34F1D1d376c35dA5834Cf39'), '0x6c1A…Cf39');
});

test('calculateAge calculates correct age from birth date', () => {
  assert.equal(calculateAge(''), null);
  assert.equal(calculateAge(null), null);
  assert.equal(calculateAge('invalid-date'), null);

  const birthDate = '1995-06-15';
  const age = calculateAge(birthDate);
  assert.ok(typeof age === 'number' && age > 0 && age < 100);

  // Future date returns null
  assert.equal(calculateAge('2099-01-01'), null);
});

test('validateClientPatientProfile validates required and optional fields', () => {
  // Empty name fails
  const emptyRes = validateClientPatientProfile({ ...DEFAULT_PATIENT_PROFILE });
  assert.equal(emptyRes.isValid, false);
  assert.ok(emptyRes.errors.displayName);

  // Valid profile passes
  const validRes = validateClientPatientProfile({
    displayName: 'Ananya Roy',
    phone: '+91 9988776655',
    dateOfBirth: '1998-04-12',
    bloodGroup: 'B+',
    about: 'Bio info',
    emergencyContactName: 'Kunal Roy',
    emergencyContactPhone: '+91 9988776654',
  });
  assert.equal(validRes.isValid, true);
  assert.deepEqual(validRes.errors, {});

  // Invalid blood group
  const badBlood = validateClientPatientProfile({ displayName: 'Test', bloodGroup: 'C+' });
  assert.equal(badBlood.isValid, false);
  assert.ok(badBlood.errors.bloodGroup);

  // Long bio
  const longBio = validateClientPatientProfile({ displayName: 'Test', about: 'x'.repeat(125) });
  assert.equal(longBio.isValid, false);
  assert.ok(longBio.errors.about);

  // Invalid phone characters
  const badPhone = validateClientPatientProfile({ displayName: 'Test', phone: 'abc12345' });
  assert.equal(badPhone.isValid, false);
  assert.ok(badPhone.errors.phone);
});
