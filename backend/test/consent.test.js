import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createConsentRouter } from '../routes/consent.js';
import { createDoctorProfileStore } from '../services/doctorProfileStore.js';
import { createConsentExpiryStore, defaultExpiryStore } from '../services/consentExpiryStore.js';
import { createConsentRequestStore } from '../services/consentRequestStore.js';
import { createEmergencyTokenStore } from '../services/emergencyTokenStore.js';

// Guard the production singleton as well as injecting a temporary store below.
// Any accidental fallback must fail before it can read or mutate real consent data.
const realExpiryFile = defaultExpiryStore.filePath;
const readRealExpiry = () => fs.existsSync(realExpiryFile) ? fs.readFileSync(realExpiryFile) : null;
const realExpiryBefore = readRealExpiry();
const guardedMethods = Object.keys(defaultExpiryStore).filter(key => typeof defaultExpiryStore[key] === 'function');
for (const method of guardedMethods) {
  mock.method(defaultExpiryStore, method, () => { throw new Error(`Test attempted production expiry store access: ${method}`); });
}
after(() => {
  try {
    assert.deepEqual(readRealExpiry(), realExpiryBefore, 'Real consent expiry data must remain byte-for-byte unchanged');
    for (const method of guardedMethods) {
      assert.equal(defaultExpiryStore[method].mock.callCount(), 0, `Unexpected production expiry store call: ${method}`);
    }
  } finally {
    mock.restoreAll();
  }
});

process.env.JWT_SECRET = 'synthetic-consent-profile-test-secret';
const doctor = '0x0000000000000000000000000000000000000001';
const patient = '0x0000000000000000000000000000000000000002';
const stranger = '0x0000000000000000000000000000000000000003';
const fields = { displayName: '<b>Self-entered name</b>', specialty: 'Cardiology', affiliation: 'Self-reported Clinic', registrationNumber: 'UNVERIFIED-1' };

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-consent-profile-'));
  let server;
  // Register cleanup before setup can fail; remove only this test-owned directory.
  t.after(async () => {
    try {
      if (server?.listening) await new Promise(resolve => server.close(resolve));
    } finally {
      assert.equal(path.dirname(fs.realpathSync(dir)), fs.realpathSync(os.tmpdir()));
      assert.ok(path.basename(dir).startsWith('hv-consent-profile-'));
      fs.rmSync(dir, { recursive: true });
    }
  });
  const file = path.join(dir, 'profiles.json');
  const profiles = createDoctorProfileStore(file);
  const expiryFile = path.join(dir, 'consent_expiries.json');
  const expiryStore = createConsentExpiryStore(expiryFile);
  const requestsFile = path.join(dir, 'consent_requests.json');
  const requestStore = createConsentRequestStore(requestsFile);
  const tokensFile = path.join(dir, 'emergency_tokens.json');
  const emergencyStore = createEmergencyTokenStore(tokensFile);
  assert.notEqual(path.resolve(expiryFile), path.resolve(realExpiryFile));
  const events = [];
  const app = express(); app.use(express.json()); app.use('/consent', createConsentRouter({
    profiles, expiryStore, requestStore, emergencyStore, audit: event => events.push(event),
    hasAccess: async () => true, // Synthetic blockchain verification only.
  }));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const call = (route, address, body) => fetch(`http://127.0.0.1:${server.address().port}/consent${route}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(address ? { Authorization: `Bearer ${jwt.sign({ address }, process.env.JWT_SECRET)}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { profiles, file, expiryFile, expiryStore, requestStore, emergencyStore, events, call };
}

test('consent grant, status, revoke and request responses use only the injected temporary expiry store', async t => {
  const f = await fixture(t);
  assert.equal(fs.existsSync(f.expiryFile), false);
  assert.equal((await f.call('/grant', patient, { doctorAddress: doctor, durationMinutes: 5 })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(f.expiryFile, 'utf8'))[0].durationMinutes, 5);
  assert.equal((await (await f.call(`/status/${doctor}`, patient)).json()).hasAccess, true);
  assert.equal((await f.call('/revoke', patient, { doctorAddress: doctor })).status, 200);
  assert.ok(f.expiryStore.get(patient, doctor).revokedAt);
  const { request } = await (await f.call('/request', doctor, { patientAddress: patient })).json();
  assert.equal((await f.call('/respond', patient, { requestId: request.id, action: 'accept', durationMinutes: 30 })).status, 200);
  assert.equal(f.expiryStore.getActiveGrant(patient, doctor).durationMinutes, 30);
  assert.equal((await f.call('/respond', patient, { requestId: request.id, action: 'reject' })).status, 200);
  assert.equal(f.expiryStore.getActiveGrant(patient, doctor), null);
  assert.deepEqual(readRealExpiry(), realExpiryBefore);
});

test('consent requester identity is JWT-bound and current profiles are shown only to the target patient', async t => {
  const f = await fixture(t);
  f.profiles.save(doctor, fields);
  assert.equal((await f.call('/requests', null)).status, 401);
  assert.equal((await f.call('/request', null, { patientAddress: patient })).status, 401);
  const response = await f.call('/request', doctor, { patientAddress: patient, doctorAddress: stranger, doctorName: 'Forged verified doctor', reason: 'Consultation' });
  const { request } = await response.json();
  assert.equal(request.doctorAddress, doctor);
  assert.equal(request.doctorName, fields.displayName);
  assert.equal(request.profile.verificationStatus, 'unverified');
  assert.deepEqual((await (await f.call(`/requests?patientAddress=${patient}`, stranger)).json()).requests, []);
  f.profiles.save(doctor, { ...fields, displayName: 'Updated profile' });
  const listed = await (await f.call('/requests', patient)).json();
  assert.equal(listed.requests[0].doctorName, 'Updated profile');
  assert.equal(listed.requests[0].profile.displayName, 'Updated profile');
  const duplicate = await (await f.call('/request', doctor, { patientAddress: patient, doctorName: 'Spoofed' })).json();
  assert.equal(duplicate.request.id, request.id);
  assert.equal(duplicate.request.doctorName, 'Updated profile');
  assert.equal((await f.call('/respond', stranger, { requestId: request.id, action: 'accept' })).status, 404);
  const accepted = await (await f.call('/respond', patient, { requestId: request.id, action: 'accept', doctorAddress: stranger })).json();
  assert.equal(accepted.doctorAddress, doctor);
  assert.deepEqual((await (await f.call('/requests', patient)).json()).requests, []);
  assert.equal(f.events.at(-1).doctor, doctor);
});

test('missing or unavailable profiles preserve wallet-only request and rejection workflows', async t => {
  const f = await fixture(t);
  const { request } = await (await f.call('/request', doctor, { patientAddress: patient, doctorName: 'Claimed doctor' })).json();
  assert.equal(request.profile, null);
  assert.equal(request.doctorName, `Wallet ${doctor}`);
  assert.equal(request.profileUnavailable, false);
  fs.writeFileSync(f.file, 'corrupt');
  const listed = await (await f.call('/requests', patient)).json();
  assert.equal(listed.requests[0].profile, null);
  assert.equal(listed.requests[0].profileUnavailable, true);
  assert.equal(listed.requests[0].doctorName, `Wallet ${doctor}`);
  const next = await f.call('/request', stranger, { patientAddress: patient });
  assert.equal(next.status, 200);
  assert.equal((await next.json()).request.profileUnavailable, true);
  assert.equal((await f.call('/respond', patient, { requestId: request.id, action: 'reject' })).status, 200);
  assert.equal(f.events.at(-1).action, 'RequestRejected');
});

test('actual PatientView request handler waits for successful wallet grant before responding; failures never accept', async () => {
  const source = fs.readFileSync(new URL('../../frontend/src/PatientView.jsx', import.meta.url), 'utf8');
  const match = source.match(/const respondToRequest = async \(requestId, action, doctorAddr\) => \{([\s\S]*?)\n  \};/);
  assert.ok(match, 'PatientView consent handler must be located');
  for (const scenario of ['success', 'cancelled', 'reverted', 'reject']) {
    const calls = [];
    const handler = new Function('getContract', 'waitForSuccess', 'apiRequest', 'localStorage', 'setLoading', 'setMessage', 'setPendingRequests', 'transactionError', `return async (requestId, action, doctorAddr) => {${match[1]}};`)(
      async () => ({ grantAccess: async address => { calls.push(['grant', address]); if (scenario === 'cancelled') throw Error('cancelled'); return 'transaction'; } }),
      async tx => { assert.equal(tx, 'transaction'); calls.push(['receipt']); if (scenario === 'reverted') throw Error('reverted'); },
      async (route, options) => { calls.push(['respond', route, JSON.parse(options.body).action]); },
      { getItem: () => 'synthetic-token' }, () => {}, () => {}, () => {}, error => error.message,
    );
    await handler('request-id', scenario === 'reject' ? 'reject' : 'accept', doctor);
    if (scenario === 'success') assert.deepEqual(calls, [['grant', doctor], ['receipt'], ['respond', '/consent/respond', 'accept']]);
    else if (scenario === 'reject') assert.deepEqual(calls, [['respond', '/consent/respond', 'reject']]);
    else assert.ok(!calls.some(([name]) => name === 'respond'));
  }
});
