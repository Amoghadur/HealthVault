import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createAuthRouter, registerId } from '../routes/auth.js';
import { createPatientRouter } from '../routes/patient.js';
import { createPatientProfileStore } from '../services/patientProfileStore.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_SECRET = 'patient-id-search-test-secret-at-least-32-chars';
process.env.JWT_SECRET = TEST_SECRET;
const doctorWallet = '0x1111111111111111111111111111111111111111';
const patientWallet = '0x2222222222222222222222222222222222222222';
const otherPatientWallet = '0x3333333333333333333333333333333333333333';
const knownDoctorWallet = '0x4444444444444444444444444444444444444444';

async function setupServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-id-test-'));
  const profileFile = path.join(dir, 'patient_profiles.json');
  const store = createPatientProfileStore(profileFile);

  const app = express();
  app.use(express.json());
  app.use('/auth', createAuthRouter({ secret: TEST_SECRET }));
  app.use('/patient', createPatientRouter({ store, hasAccess: async () => false }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, store };
}

test('A doctor can resolve HV-1003 when it belongs to a registered patient', async t => {
  const { base } = await setupServer(t);
  registerId('HV-1003', patientWallet, 'patient');

  const doctorToken = jwt.sign(
    { address: doctorWallet, patientId: 'HV-DOC', role: 'doctor' },
    TEST_SECRET,
    { expiresIn: '1h' }
  );

  const res = await fetch(`${base}/auth/lookup/HV-1003`, {
    headers: { Authorization: `Bearer ${doctorToken}` },
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.patientId, 'HV-1003');
  assert.equal(data.address.toLowerCase(), patientWallet.toLowerCase());
});

test('A patient cannot use the doctor-only patient lookup permission to enumerate other patients', async t => {
  const { base } = await setupServer(t);
  registerId('HV-1003', patientWallet, 'patient');
  registerId('HV-1005', otherPatientWallet, 'patient');

  const patientToken = jwt.sign(
    { address: patientWallet, patientId: 'HV-1003', role: 'patient' },
    TEST_SECRET,
    { expiresIn: '1h' }
  );

  // Patient tries to look up other patient HV-1005
  const res = await fetch(`${base}/auth/lookup/HV-1005`, {
    headers: { Authorization: `Bearer ${patientToken}` },
  });

  assert.equal(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /Patients may only look up doctor IDs/i);
});

test('Patient-to-doctor lookup still works', async t => {
  const { base } = await setupServer(t);
  registerId('HV-1006', knownDoctorWallet, 'doctor');

  const patientToken = jwt.sign(
    { address: patientWallet, patientId: 'HV-1003', role: 'patient' },
    TEST_SECRET,
    { expiresIn: '1h' }
  );

  const res = await fetch(`${base}/auth/lookup/HV-1006`, {
    headers: { Authorization: `Bearer ${patientToken}` },
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.patientId, 'HV-1006');
  assert.equal(data.address.toLowerCase(), knownDoctorWallet.toLowerCase());
});

test('Unknown IDs return a clear not-found response (404)', async t => {
  const { base } = await setupServer(t);

  const doctorToken = jwt.sign(
    { address: doctorWallet, patientId: 'HV-DOC', role: 'doctor' },
    TEST_SECRET,
    { expiresIn: '1h' }
  );

  const res = await fetch(`${base}/auth/lookup/HV-9876`, {
    headers: { Authorization: `Bearer ${doctorToken}` },
  });

  assert.equal(res.status, 404);
  const data = await res.json();
  assert.match(data.error, /not found/i);
});

test('Malformed HealthVault IDs return a 400 Bad Request', async t => {
  const { base } = await setupServer(t);

  const doctorToken = jwt.sign(
    { address: doctorWallet, patientId: 'HV-DOC', role: 'doctor' },
    TEST_SECRET,
    { expiresIn: '1h' }
  );

  const res = await fetch(`${base}/auth/lookup/invalid-format`, {
    headers: { Authorization: `Bearer ${doctorToken}` },
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Invalid HealthVault ID format/i);
});

test('Patient privacy settings and consent authorization are still enforced after lookup', async t => {
  const { base, store } = await setupServer(t);
  registerId('HV-1003', patientWallet, 'patient');

  // Configure patient profile with showIdentityToDoctors: false
  store.save(patientWallet, {
    displayName: 'Secret Identity',
    showIdentityToDoctors: false,
  });

  const doctorToken = jwt.sign(
    { address: doctorWallet, patientId: 'HV-DOC', role: 'doctor' },
    TEST_SECRET,
    { expiresIn: '1h' }
  );

  // 1. Resolve ID -> returns wallet address
  const lookupRes = await fetch(`${base}/auth/lookup/HV-1003`, {
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
  assert.equal(lookupRes.status, 200);
  const lookupData = await lookupRes.json();
  const resolvedAddress = lookupData.address;

  // 2. Pre-consent profile lookup: identity is hidden because showIdentityToDoctors is false
  const profileLookupRes = await fetch(`${base}/patient/profile/lookup/${resolvedAddress}`, {
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
  assert.equal(profileLookupRes.status, 200);
  const profileData = await profileLookupRes.json();
  assert.equal(profileData.profile.displayName, '');
  assert.equal(profileData.privacyRestricted, true);

  // 3. Pre-consent public profile (attempting to access protected profile before consent): 403 Forbidden
  const publicProfileRes = await fetch(`${base}/patient/profile/public/${resolvedAddress}`, {
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
  assert.equal(publicProfileRes.status, 403);
});
