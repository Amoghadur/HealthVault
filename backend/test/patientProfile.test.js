import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createPatientRouter } from '../routes/patient.js';
import { createPatientProfileStore } from '../services/patientProfileStore.js';

process.env.JWT_SECRET = 'synthetic-patient-profile-test-secret';
const patientWallet = '0x0000000000000000000000000000000000000001';
const doctorWallet = '0x00000000000000000000000000000000000000ab';
const otherWallet = '0x0000000000000000000000000000000000000002';

const validFields = {
  displayName: ' John Doe ',
  avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  phone: '+91 98765 43210',
  dateOfBirth: '1990-05-15',
  bloodGroup: 'O+',
  about: 'Software engineer and cyclist',
  emergencyContactName: 'Jane Doe',
  emergencyContactPhone: '+91 98765 43211',
};

async function fixture(t, { storeOverride, hasAccessOverride, expiryStoreOverride } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-patient-profiles-'));
  const file = path.join(dir, 'patient_profiles.json');
  const store = storeOverride || createPatientProfileStore(file);

  let onChainAccess = true;
  const hasAccess = hasAccessOverride || (async (p, d) => onChainAccess);

  let activeGrant = { expiresAt: new Date(Date.now() + 60000).toISOString() };
  const expiryStore = expiryStoreOverride !== undefined
    ? expiryStoreOverride
    : {
        getActiveGrant: (p, d) => activeGrant,
      };

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/patient', createPatientRouter({ store, hasAccess, expiryStore }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const call = (address = patientWallet, endpoint = '/patient/profile', body, extra = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, {
      method: body === undefined ? 'GET' : (extra.method || 'POST'),
      headers: {
        'Content-Type': 'application/json',
        ...(address ? { Authorization: `Bearer ${jwt.sign({ address }, process.env.JWT_SECRET, { expiresIn: extra.expired ? -1 : 300 })}` } : {}),
        ...extra.headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  return {
    file,
    dir,
    store,
    call,
    setOnChainAccess: (val) => { onChainAccess = val; },
    setActiveGrant: (val) => { activeGrant = val; },
  };
}

test('patient profiles: require authentication, normalize wallet, and isolate profiles', async (t) => {
  const f = await fixture(t);

  // Unauthenticated requests
  assert.equal((await f.call(null)).status, 401);
  assert.equal((await f.call(null, '/patient/profile', validFields)).status, 401);
  assert.equal((await f.call(patientWallet, '/patient/profile', undefined, { expired: true })).status, 401);
  assert.equal((await f.call('invalid-wallet')).status, 401);

  // Initial read returns null profile
  const initial = await (await f.call(patientWallet)).json();
  assert.deepEqual(initial, { profile: null });
  assert.equal(fs.existsSync(f.file), false, 'Initial read must not create storage file');

  // Save profile with mixed case wallet
  const mixedCaseWallet = patientWallet.toUpperCase().replace('0X', '0x');
  const saveRes = await f.call(mixedCaseWallet, '/patient/profile', validFields);
  assert.equal(saveRes.status, 200);
  assert.equal(saveRes.headers.get('cache-control'), 'no-store');

  const { profile } = await saveRes.json();
  assert.equal(profile.walletAddress, patientWallet);
  assert.equal(profile.displayName, 'John Doe');
  assert.equal(profile.bloodGroup, 'O+');
  assert.equal(profile.phone, '+91 98765 43210');
  assert.equal(profile.emergencyContactName, 'Jane Doe');
  assert.ok(profile.createdAt);
  assert.ok(profile.updatedAt);

  // Another patient sees null profile
  const otherRes = await (await f.call(otherWallet)).json();
  assert.deepEqual(otherRes, { profile: null });

  // Update profile preserves createdAt
  const updateRes = await f.call(patientWallet, '/patient/profile', {
    ...validFields,
    displayName: 'John Updated',
  }, { method: 'PUT' });
  assert.equal(updateRes.status, 200);
  const updated = (await updateRes.json()).profile;
  assert.equal(updated.displayName, 'John Updated');
  assert.equal(updated.createdAt, profile.createdAt);
});

test('patient profiles: field validation, sanitization, and extra field rejection', async (t) => {
  const f = await fixture(t);

  // displayName validation
  assert.equal((await f.call(patientWallet, '/patient/profile', { ...validFields, displayName: 'a' })).status, 400);
  assert.equal((await f.call(patientWallet, '/patient/profile', { ...validFields, displayName: 'a'.repeat(41) })).status, 400);
  assert.equal((await f.call(patientWallet, '/patient/profile', { ...validFields, displayName: '   ' })).status, 400);

  // HTML stripping in displayName and text fields
  const htmlRes = await f.call(patientWallet, '/patient/profile', {
    ...validFields,
    displayName: '<b>Alice In Wonderland</b>',
    about: '<script>alert(1)</script>Health enthusiast',
    emergencyContactName: '<span>Bob</span>',
  });
  assert.equal(htmlRes.status, 200);
  const htmlData = (await htmlRes.json()).profile;
  assert.equal(htmlData.displayName, 'Alice In Wonderland');
  assert.equal(htmlData.about, 'alert(1)Health enthusiast');
  assert.equal(htmlData.emergencyContactName, 'Bob');

  // Reject unexpected / sensitive fields (diagnoses, conditions, isAdmin, __proto__)
  for (const forbiddenKey of ['conditions', 'diagnoses', 'isAdmin', '__proto__', 'role', 'verified']) {
    const res = await f.call(patientWallet, '/patient/profile', {
      ...validFields,
      [forbiddenKey]: 'malicious',
    });
    assert.equal(res.status, 400, `Must reject forbidden field: ${forbiddenKey}`);
  }

  // Reject invalid blood group
  assert.equal((await f.call(patientWallet, '/patient/profile', { ...validFields, bloodGroup: 'Z+' })).status, 400);

  // Reject invalid date of birth
  assert.equal((await f.call(patientWallet, '/patient/profile', { ...validFields, dateOfBirth: 'invalid-date' })).status, 400);
  assert.equal((await f.call(patientWallet, '/patient/profile', { ...validFields, dateOfBirth: '2099-01-01' })).status, 400);

  // Reject invalid phone
  assert.equal((await f.call(patientWallet, '/patient/profile', { ...validFields, phone: 'call-me-maybe-1234567890' })).status, 400);

  // Reject invalid avatar format (e.g. svg, executable, or oversized)
  assert.equal((await f.call(patientWallet, '/patient/profile', { ...validFields, avatar: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400);
  assert.equal((await f.call(patientWallet, '/patient/profile', { ...validFields, avatar: 'not-a-data-url' })).status, 400);

  // Oversized avatar (> 200 KB)
  const hugeData = 'data:image/png;base64,' + 'A'.repeat(300_000);
  assert.equal((await f.call(patientWallet, '/patient/profile', { ...validFields, avatar: hugeData })).status, 400);
});

test('patient profiles: doctor public endpoint enforces active consent and redacts private fields', async (t) => {
  const f = await fixture(t);

  // Save patient profile first
  await f.call(patientWallet, '/patient/profile', validFields);

  // Doctor requests public profile with active consent
  f.setOnChainAccess(true);
  f.setActiveGrant({ expiresAt: new Date(Date.now() + 60000).toISOString() });

  const docRes = await f.call(doctorWallet, `/patient/profile/public/${patientWallet}`);
  assert.equal(docRes.status, 200);
  const { profile } = await docRes.json();

  // MUST return displayName, avatar, walletAddress
  assert.equal(profile.walletAddress, patientWallet);
  assert.equal(profile.displayName, 'John Doe');
  assert.equal(profile.avatar, validFields.avatar);

  // MUST NOT expose private fields
  assert.equal(profile.phone, undefined);
  assert.equal(profile.dateOfBirth, undefined);
  assert.equal(profile.bloodGroup, undefined);
  assert.equal(profile.about, undefined);
  assert.equal(profile.emergencyContactName, undefined);
  assert.equal(profile.emergencyContactPhone, undefined);

  // When consent expiryStore has no active grant -> 403
  f.setActiveGrant(null);
  const expiredRes = await f.call(doctorWallet, `/patient/profile/public/${patientWallet}`);
  assert.equal(expiredRes.status, 403);
  assert.equal((await expiredRes.json()).error, 'No active patient consent grant.');

  // When on-chain access is false -> 403
  f.setActiveGrant({ expiresAt: new Date(Date.now() + 60000).toISOString() });
  f.setOnChainAccess(false);
  const revokedRes = await f.call(doctorWallet, `/patient/profile/public/${patientWallet}`);
  assert.equal(revokedRes.status, 403);

  // Self lookup is always allowed even without doctor grant
  const selfRes = await f.call(patientWallet, `/patient/profile/public/${patientWallet}`);
  assert.equal(selfRes.status, 200);
  assert.equal((await selfRes.json()).profile.displayName, 'John Doe');

  // Invalid target address -> 400
  const invalidAddrRes = await f.call(doctorWallet, '/patient/profile/public/not-a-wallet');
  assert.equal(invalidAddrRes.status, 400);
});

test('patient profiles: corrupt storage fails closed (503)', async (t) => {
  const f = await fixture(t);
  await f.call(patientWallet, '/patient/profile', validFields);

  fs.writeFileSync(f.file, '{ corrupt json');
  assert.equal((await f.call(patientWallet)).status, 503);
  assert.equal((await f.call(patientWallet, '/patient/profile', validFields)).status, 503);
});
