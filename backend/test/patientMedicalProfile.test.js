import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createPatientRouter } from '../routes/patient.js';
import {
  createPatientProfileStore,
  validatePatientProfileFields,
  ALLOWED_DIABETES_STATUS,
} from '../services/patientProfileStore.js';

process.env.JWT_SECRET = 'medical-profile-test-secret-32-chars';
const JWT_SECRET = process.env.JWT_SECRET;
const patient1Wallet = '0x1111111111111111111111111111111111111111';
const patient2Wallet = '0x2222222222222222222222222222222222222222';
const doctorWallet   = '0xdddddddddddddddddddddddddddddddddddddddd';

const baseProfile = {
  displayName: 'Alice Johnson',
  avatar: '',
  phone: '+91 99887 76655',
  dateOfBirth: '1995-04-12',
  bloodGroup: 'B+',
  about: 'Cyclist and runner',
  emergencyContactName: 'Bob Johnson',
  emergencyContactPhone: '+91 99887 76656',
  showIdentityToDoctors: true,
};

async function fixture(t, { initialProfiles = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-med-profile-test-'));
  const file = path.join(dir, 'patient_profiles.json');
  if (initialProfiles.length > 0) {
    fs.writeFileSync(file, JSON.stringify(initialProfiles, null, 2));
  }
  const store = createPatientProfileStore(file);
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/patient', createPatientRouter({ store }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const token = (address) => jwt.sign({ address }, JWT_SECRET, { expiresIn: 300 });

  const call = (address, method, endpoint, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(address ? { Authorization: `Bearer ${token(address)}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  return { store, call, file };
}

test('1. Patient can add, edit, remove, save, and reload allergies', async (t) => {
  const { call } = await fixture(t);

  // Initial save: add 3 allergies
  const res1 = await call(patient1Wallet, 'POST', '/patient/profile', {
    ...baseProfile,
    allergies: ['Penicillin', 'Peanuts', 'Latex'],
    allergiesStatus: 'has_allergies',
  });
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.deepEqual(body1.profile.allergies, ['Penicillin', 'Peanuts', 'Latex']);
  assert.equal(body1.profile.allergiesStatus, 'has_allergies');

  // Edit/remove allergy: remove 'Penicillin', keep ['Peanuts', 'Latex']
  const res2 = await call(patient1Wallet, 'POST', '/patient/profile', {
    ...baseProfile,
    allergies: ['Peanuts', 'Latex'],
    allergiesStatus: 'has_allergies',
  });
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.deepEqual(body2.profile.allergies, ['Peanuts', 'Latex']);

  // Reload profile from server (simulating refresh / re-login)
  const getRes = await call(patient1Wallet, 'GET', '/patient/profile');
  assert.equal(getRes.status, 200);
  const reloaded = await getRes.json();
  assert.deepEqual(reloaded.profile.allergies, ['Peanuts', 'Latex']);
  assert.equal(reloaded.profile.allergiesStatus, 'has_allergies');
});

test('2. Patient can explicitly select "No known allergies" and "Unknown"', async (t) => {
  const { call } = await fixture(t);

  // Explicitly select "No known allergies"
  const resNkda = await call(patient1Wallet, 'POST', '/patient/profile', {
    ...baseProfile,
    allergies: [],
    allergiesStatus: 'no_known_allergies',
  });
  assert.equal(resNkda.status, 200);
  const bodyNkda = await resNkda.json();
  assert.equal(bodyNkda.profile.allergiesStatus, 'no_known_allergies');
  assert.deepEqual(bodyNkda.profile.allergies, []);

  // Explicitly select "Unknown / Not provided"
  const resUnknown = await call(patient1Wallet, 'POST', '/patient/profile', {
    ...baseProfile,
    allergies: [],
    allergiesStatus: 'unknown',
  });
  assert.equal(resUnknown.status, 200);
  const bodyUnknown = await resUnknown.json();
  assert.equal(bodyUnknown.profile.allergiesStatus, 'unknown');
  assert.deepEqual(bodyUnknown.profile.allergies, []);
});

test('3. Test every diabetes status, including "Unknown / Not provided" and "No diabetes"', async (t) => {
  const { call } = await fixture(t);

  const testCases = [
    'Type 1 diabetes',
    'Type 2 diabetes',
    'Prediabetes',
    'No diabetes',
    'Unknown / Not provided',
  ];

  for (const status of testCases) {
    const res = await call(patient1Wallet, 'POST', '/patient/profile', {
      ...baseProfile,
      diabetesStatus: status,
    });
    assert.equal(res.status, 200, `Must accept diabetes status: ${status}`);
    const body = await res.json();
    assert.equal(body.profile.diabetesStatus, status);
  }

  // Blank/empty defaults to "Unknown / Not provided"
  const resBlank = await call(patient1Wallet, 'POST', '/patient/profile', {
    ...baseProfile,
    diabetesStatus: '',
  });
  assert.equal(resBlank.status, 200);
  assert.equal((await resBlank.json()).profile.diabetesStatus, 'Unknown / Not provided');

  // Invalid diabetes status is rejected with 400
  const resInvalid = await call(patient1Wallet, 'POST', '/patient/profile', {
    ...baseProfile,
    diabetesStatus: 'Gestational Hypoglycemia Nonexistent',
  });
  assert.equal(resInvalid.status, 400);
});

test('4. One patient cannot update another patient\'s profile', async (t) => {
  const { call } = await fixture(t);

  // Patient 1 saves their profile
  await call(patient1Wallet, 'POST', '/patient/profile', {
    ...baseProfile,
    displayName: 'Patient One',
    diabetesStatus: 'Type 1 diabetes',
    allergies: ['Peanuts'],
    allergiesStatus: 'has_allergies',
  });

  // Patient 2 saves their own profile
  await call(patient2Wallet, 'POST', '/patient/profile', {
    ...baseProfile,
    displayName: 'Patient Two',
    diabetesStatus: 'No diabetes',
    allergies: [],
    allergiesStatus: 'no_known_allergies',
  });

  // Verify Patient 1's profile is isolated and unchanged by Patient 2
  const p1Res = await call(patient1Wallet, 'GET', '/patient/profile');
  const p1 = (await p1Res.json()).profile;
  assert.equal(p1.displayName, 'Patient One');
  assert.equal(p1.diabetesStatus, 'Type 1 diabetes');
  assert.deepEqual(p1.allergies, ['Peanuts']);

  // Verify Patient 2's profile
  const p2Res = await call(patient2Wallet, 'GET', '/patient/profile');
  const p2 = (await p2Res.json()).profile;
  assert.equal(p2.displayName, 'Patient Two');
  assert.equal(p2.diabetesStatus, 'No diabetes');
  assert.equal(p2.allergiesStatus, 'no_known_allergies');
});

test('5. Existing profiles without allergies and diabetesStatus remain compatible', async (t) => {
  const legacyProfile = {
    walletAddress: patient1Wallet,
    displayName: 'Legacy User',
    avatar: '',
    phone: '1234567890',
    dateOfBirth: '1985-01-01',
    bloodGroup: 'A+',
    about: 'Old profile created before new fields',
    emergencyContactName: 'Contact Person',
    emergencyContactPhone: '9876543210',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const { call } = await fixture(t, { initialProfiles: [legacyProfile] });

  // Read existing legacy profile
  const res = await call(patient1Wallet, 'GET', '/patient/profile');
  assert.equal(res.status, 200);
  const { profile } = await res.json();
  assert.equal(profile.displayName, 'Legacy User');
  assert.deepEqual(profile.allergies, []);
  assert.equal(profile.allergiesStatus, 'unknown');
  assert.equal(profile.diabetesStatus, 'Unknown / Not provided');
});

test('6. Public profile lookups do NOT expose allergies or diabetesStatus', async (t) => {
  const { call } = await fixture(t);

  // Patient saves sensitive allergies and diabetes status
  await call(patient1Wallet, 'POST', '/patient/profile', {
    ...baseProfile,
    allergies: ['Morphine', 'Iodine'],
    allergiesStatus: 'has_allergies',
    diabetesStatus: 'Type 2 diabetes',
  });

  // Doctor looks up patient via public search route
  const lookupRes = await call(doctorWallet, 'GET', `/patient/profile/lookup/${patient1Wallet}`);
  assert.equal(lookupRes.status, 200);
  const lookupBody = await lookupRes.json();

  // Public lookup returns ONLY displayName and avatar
  assert.ok(lookupBody.profile.displayName);
  assert.equal(lookupBody.profile.allergies, undefined, 'Public lookup must not leak allergies');
  assert.equal(lookupBody.profile.allergiesStatus, undefined, 'Public lookup must not leak allergiesStatus');
  assert.equal(lookupBody.profile.diabetesStatus, undefined, 'Public lookup must not leak diabetesStatus');
});
