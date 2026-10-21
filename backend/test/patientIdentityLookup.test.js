import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createPatientRouter } from '../routes/patient.js';
import { createPatientProfileStore, validatePatientProfileFields } from '../services/patientProfileStore.js';

process.env.JWT_SECRET = 'patient-identity-lookup-test-secret-xyz';
const JWT_SECRET = process.env.JWT_SECRET;
const patientWallet  = '0x0000000000000000000000000000000000000001';
const doctorWallet   = '0x00000000000000000000000000000000000000ab';
const minimalProfile = {
  displayName: 'Test User', avatar: '', phone: '', dateOfBirth: '',
  bloodGroup: '', about: '', emergencyContactName: '', emergencyContactPhone: '',
};

async function fixture(t, { storeOverride, hasAccessOverride, expiryStoreOverride } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-id-lookup-'));
  const file = path.join(dir, 'patient_profiles.json');
  const store = storeOverride || createPatientProfileStore(file);
  const hasAccess = hasAccessOverride ?? (async () => true);
  const activeGrant = { expiresAt: new Date(Date.now() + 60000).toISOString() };
  const expiryStore = expiryStoreOverride !== undefined ? expiryStoreOverride : { getActiveGrant: () => activeGrant };
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/patient', createPatientRouter({ store, hasAccess, expiryStore }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const token = (address = doctorWallet, opts = {}) =>
    jwt.sign({ address }, JWT_SECRET, { expiresIn: opts.expired ? -1 : 300 });
  const call = (address, endpoint, body, extra = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, {
      method: body === undefined ? 'GET' : (extra.method || 'POST'),
      headers: { 'Content-Type': 'application/json', ...(address ? { Authorization: `Bearer ${token(address)}` } : {}), ...extra.headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  return { store, call, token, server };
}

test('showIdentityToDoctors defaults to true when absent', () => {
  const result = validatePatientProfileFields(minimalProfile);
  assert.strictEqual(result.showIdentityToDoctors, true);
});

test('showIdentityToDoctors=false is preserved', () => {
  const result = validatePatientProfileFields({ ...minimalProfile, showIdentityToDoctors: false });
  assert.strictEqual(result.showIdentityToDoctors, false);
});

test('GET /profile/lookup — empty profile when patient not registered', async (t) => {
  const { call } = await fixture(t);
  const res = await call(doctorWallet, `/patient/profile/lookup/${patientWallet}`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.profile.displayName, '');
  assert.strictEqual(body.hasProfile, false);
  assert.strictEqual(body.privacyRestricted, false);
});

test('GET /profile/lookup — requires authentication', async (t) => {
  const { server } = await fixture(t);
  const res = await fetch(`http://127.0.0.1:${server.address().port}/patient/profile/lookup/${patientWallet}`);
  assert.strictEqual(res.status, 401);
});

test('1. Doctor searches for a patient whose profile has a configured name and avatar', async (t) => {
  const { store, call } = await fixture(t);
  const avatarData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  store.save(patientWallet, { ...minimalProfile, displayName: 'Dr. Arjun Sharma Patient', avatar: avatarData });
  const res = await call(doctorWallet, `/patient/profile/lookup/${patientWallet}`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.profile.displayName, 'Dr. Arjun Sharma Patient');
  assert.strictEqual(body.profile.avatar, avatarData);
  assert.strictEqual(body.hasProfile, true);
  assert.strictEqual(body.privacyRestricted, false);
});

test('2. Patient identity is hidden before consent when showIdentityToDoctors is disabled', async (t) => {
  const { store, call } = await fixture(t);
  const avatarData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  store.save(patientWallet, { ...minimalProfile, displayName: 'Secret Identity Patient', avatar: avatarData, showIdentityToDoctors: false });
  const res = await call(doctorWallet, `/patient/profile/lookup/${patientWallet}`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.profile.displayName, '');
  assert.strictEqual(body.profile.avatar, '');
  assert.strictEqual(body.hasProfile, true);
  assert.strictEqual(body.privacyRestricted, true);
});

test('3. Patient identity is shown before consent only when the privacy setting permits it', async (t) => {
  const { store, call } = await fixture(t);
  store.save(patientWallet, { ...minimalProfile, displayName: 'Permitted Patient', showIdentityToDoctors: true });
  const res = await call(doctorWallet, `/patient/profile/lookup/${patientWallet}`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.profile.displayName, 'Permitted Patient');
  assert.strictEqual(body.privacyRestricted, false);
});

test('4. Authorized profile details are loaded only after the existing consent checks succeed', async (t) => {
  // Without consent grant -> 403
  const { store, call } = await fixture(t, { expiryStoreOverride: { getActiveGrant: () => null } });
  store.save(patientWallet, { ...minimalProfile, displayName: 'Consented Patient', showIdentityToDoctors: false });
  const unauthRes = await call(doctorWallet, `/patient/profile/public/${patientWallet}`);
  assert.strictEqual(unauthRes.status, 403);

  // With active consent grant -> 200 and authorized profile details loaded
  const grantFixture = await fixture(t, {
    expiryStoreOverride: { getActiveGrant: () => ({ expiresAt: new Date(Date.now() + 60000).toISOString() }) },
    hasAccessOverride: async () => true,
  });
  grantFixture.store.save(patientWallet, { ...minimalProfile, displayName: 'Consented Patient', showIdentityToDoctors: false });
  const authRes = await grantFixture.call(doctorWallet, `/patient/profile/public/${patientWallet}`);
  assert.strictEqual(authRes.status, 200);
  const body = await authRes.json();
  // Name and avatar revealed under active consent even though showIdentityToDoctors was false
  assert.strictEqual(body.profile.displayName, 'Consented Patient');
  assert.strictEqual(body.hasProfile, true);
});

test('8. Revoked or expired consent does not reveal protected patient data', async (t) => {
  // Expired grant
  const fExpired = await fixture(t, { expiryStoreOverride: { getActiveGrant: () => null } });
  fExpired.store.save(patientWallet, { ...minimalProfile, displayName: 'Protected Patient' });
  const resExpired = await fExpired.call(doctorWallet, `/patient/profile/public/${patientWallet}`);
  assert.strictEqual(resExpired.status, 403);

  // Revoked on-chain access
  const fRevoked = await fixture(t, { hasAccessOverride: async () => false });
  fRevoked.store.save(patientWallet, { ...minimalProfile, displayName: 'Protected Patient' });
  const resRevoked = await fRevoked.call(doctorWallet, `/patient/profile/public/${patientWallet}`);
  assert.strictEqual(resRevoked.status, 403);
});

test('GET /profile/lookup — returns ONLY allowed identity fields and never exposes sensitive profile fields or records', async (t) => {
  const { store, call } = await fixture(t, { expiryStoreOverride: { getActiveGrant: () => null } });
  const fullProfile = {
    displayName: 'Sensitive Patient',
    avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    phone: '+1234567890',
    dateOfBirth: '1992-05-10',
    bloodGroup: 'B+',
    about: 'Confidential patient health diagnosis',
    emergencyContactName: 'Emergency Person',
    emergencyContactPhone: '+1987654321',
    showIdentityToDoctors: true,
  };
  store.save(patientWallet, fullProfile);
  const res = await call(doctorWallet, `/patient/profile/lookup/${patientWallet}`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();

  assert.deepEqual(Object.keys(body).sort(), ['hasProfile', 'privacyRestricted', 'profile']);
  assert.strictEqual(body.privacyRestricted, false);
  assert.strictEqual(body.hasProfile, true);

  // body.profile must contain ONLY walletAddress, displayName, avatar
  assert.deepEqual(Object.keys(body.profile).sort(), ['avatar', 'displayName', 'walletAddress']);
  assert.strictEqual(body.profile.walletAddress, patientWallet);
  assert.strictEqual(body.profile.displayName, 'Sensitive Patient');
  assert.strictEqual(body.profile.avatar, fullProfile.avatar);

  // Assert strictly that medical records or other profile fields are NOT exposed
  assert.strictEqual(body.profile.phone, undefined);
  assert.strictEqual(body.profile.dateOfBirth, undefined);
  assert.strictEqual(body.profile.bloodGroup, undefined);
  assert.strictEqual(body.profile.about, undefined);
  assert.strictEqual(body.profile.emergencyContactName, undefined);
  assert.strictEqual(body.profile.emergencyContactPhone, undefined);
  assert.strictEqual(body.records, undefined);
  assert.strictEqual(body.profile.records, undefined);
});

test('showIdentityToDoctors=false persisted in store', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-pps-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createPatientProfileStore(path.join(dir, 'p.json'));
  store.save(patientWallet, { ...minimalProfile, showIdentityToDoctors: false });
  assert.strictEqual(store.get(patientWallet).showIdentityToDoctors, false);
});
