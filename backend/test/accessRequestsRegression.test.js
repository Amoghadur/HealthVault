import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuthRouter } from '../routes/auth.js';
import { createConsentRouter } from '../routes/consent.js';
import { createConsentRequestStore } from '../services/consentRequestStore.js';
import { createConsentExpiryStore } from '../services/consentExpiryStore.js';
import { createDoctorProfileStore } from '../services/doctorProfileStore.js';
import { createPatientProfileStore } from '../services/patientProfileStore.js';

const TEST_SECRET = 'access-requests-test-jwt-secret-at-least-32-chars';
process.env.JWT_SECRET = TEST_SECRET;

const patientWallet = '0x1111111111111111111111111111111111111111';
const doctorWallet = '0x2222222222222222222222222222222222222222';
const doctor2Wallet = '0x3333333333333333333333333333333333333333';

function signToken(payload) {
  return jwt.sign(payload, TEST_SECRET, { expiresIn: '1h' });
}

function setupTestApp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-access-test-'));
  const requestsFile = path.join(dir, 'consent_requests.json');
  const expiryFile = path.join(dir, 'consent_expiries.json');
  const doctorFile = path.join(dir, 'doctor_profiles.json');
  const patientFile = path.join(dir, 'patient_profiles.json');

  const requestStore = createConsentRequestStore(requestsFile);
  const expiryStore = createConsentExpiryStore(expiryFile);
  const doctorProfiles = createDoctorProfileStore(doctorFile);
  const patientProfiles = createPatientProfileStore(patientFile);

  // Seed doctor profile
  doctorProfiles.save(doctorWallet, {
    displayName: 'Dr. John Watson',
    specialty: 'General Medicine',
    affiliation: 'St. Jude Hospital',
    department: 'Primary Care'
  });

  const app = express();
  app.use(express.json());

  const authRouter = createAuthRouter({
    secret: TEST_SECRET,
    doctorProfiles,
    challenges: {
      issue: () => ({ challenge: 'test-challenge', expiresAt: Date.now() + 60000 }),
      verifyAndConsume: (addr) => addr.toLowerCase()
    },
    lookupRateLimiter: (req, res, next) => next(),
    authRateLimiter: (req, res, next) => next()
  });

  const consentRouter = createConsentRouter({
    expiryStore,
    requestStore,
    profiles: doctorProfiles,
    patientProfiles,
    rateLimiter: (req, res, next) => next()
  });

  app.use('/auth', authRouter);
  app.use('/consent', consentRouter);

  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  return { app, requestStore, expiryStore, doctorProfiles, patientProfiles, requestsFile };
}

test('1. Patient login and token generation does not create an access request', async (t) => {
  const { app, requestStore } = setupTestApp(t);

  const initialRequests = requestStore.getPendingForPatient(patientWallet);
  assert.equal(initialRequests.length, 0, 'Store must start empty');

  // Simulate patient login via /auth/verify
  const server = app.listen(0);
  t.after(() => server.close());
  const port = server.address().port;

  const res = await fetch(`http://localhost:${port}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: patientWallet,
      signature: 'dummy-sig',
      role: 'patient'
    })
  });

  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.role, 'patient');

  // Verify request store remains empty
  const requestsAfterLogin = requestStore.getPendingForPatient(patientWallet);
  assert.equal(requestsAfterLogin.length, 0, 'Patient login must never create an access request');
});

test('2. Patient session restoration and request list fetch does not create a request', async (t) => {
  const { app, requestStore } = setupTestApp(t);

  const server = app.listen(0);
  t.after(() => server.close());
  const port = server.address().port;

  const patientToken = signToken({ address: patientWallet, role: 'patient' });

  // Patient dashboard mounts and fetches incoming requests
  const res = await fetch(`http://localhost:${port}/consent/requests`, {
    headers: { Authorization: `Bearer ${patientToken}` }
  });

  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.requests, []);

  // Ensure request store is still empty
  assert.equal(requestStore.getPendingForPatient(patientWallet).length, 0, 'Dashboard mount/fetch must never create a request');
});

test('3. Only a real doctor request created through POST /consent/request appears in patient incoming list', async (t) => {
  const { app } = setupTestApp(t);

  const server = app.listen(0);
  t.after(() => server.close());
  const port = server.address().port;

  const doctorToken = signToken({ address: doctorWallet, role: 'doctor' });
  const patientToken = signToken({ address: patientWallet, role: 'patient' });

  // 1. Initially empty
  const preCheck = await fetch(`http://localhost:${port}/consent/requests`, {
    headers: { Authorization: `Bearer ${patientToken}` }
  });
  assert.deepEqual((await preCheck.json()).requests, []);

  // 2. Doctor creates an access request
  const createRes = await fetch(`http://localhost:${port}/consent/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${doctorToken}`
    },
    body: JSON.stringify({
      patientAddress: patientWallet,
      reason: 'Routine cardiovascular evaluation'
    })
  });

  assert.equal(createRes.status, 200);
  const createdBody = await createRes.json();
  assert.equal(createdBody.success, true);
  assert.ok(createdBody.request.id, 'Created request must have a stable id');

  // 3. Patient incoming list now shows this real doctor request
  const incomingRes = await fetch(`http://localhost:${port}/consent/requests`, {
    headers: { Authorization: `Bearer ${patientToken}` }
  });
  const incomingBody = await incomingRes.json();
  assert.equal(incomingBody.requests.length, 1);
  const req = incomingBody.requests[0];
  assert.equal(req.id, createdBody.request.id);
  assert.equal(req.doctorAddress.toLowerCase(), doctorWallet.toLowerCase());
  assert.equal(req.patientAddress.toLowerCase(), patientWallet.toLowerCase());
  assert.equal(req.reason, 'Routine cardiovascular evaluation');
  assert.equal(req.status, 'pending');
  assert.ok(req.profile, 'Must include doctor profile');
  assert.equal(req.profile.displayName, 'Dr. John Watson');
});

test('4. Existing legitimate pending requests are preserved with metadata intact', async (t) => {
  const { app, requestsFile } = setupTestApp(t);

  // Directly seed a genuine pending request
  const seeded = {
    id: "1792438945674",
    doctorAddress: doctorWallet,
    patientAddress: patientWallet,
    reason: "Initial consultation",
    status: "pending",
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString()
  };
  fs.writeFileSync(requestsFile, JSON.stringify([seeded], null, 2));

  const server = app.listen(0);
  t.after(() => server.close());
  const port = server.address().port;

  const patientToken = signToken({ address: patientWallet, role: 'patient' });

  const res = await fetch(`http://localhost:${port}/consent/requests`, {
    headers: { Authorization: `Bearer ${patientToken}` }
  });
  const body = await res.json();
  assert.equal(body.requests.length, 1);
  assert.equal(body.requests[0].id, seeded.id);
  assert.equal(body.requests[0].reason, 'Initial consultation');
  assert.equal(body.requests[0].status, 'pending');
});

test('5. Stable request ID deduplication preserves separate legitimate requests', async (t) => {
  const { requestStore, requestsFile } = setupTestApp(t);

  // Seed two distinct legitimate requests (different doctors)
  const req1 = requestStore.createRequest({
    doctorAddress: doctorWallet,
    patientAddress: patientWallet,
    reason: 'Cardio check'
  }).request;

  const req2 = requestStore.createRequest({
    doctorAddress: doctor2Wallet,
    patientAddress: patientWallet,
    reason: 'Neuro consult'
  }).request;

  assert.notEqual(req1.id, req2.id, 'Distinct requests must receive distinct IDs');

  // Verify getPendingForPatient returns both
  const pending = requestStore.getPendingForPatient(patientWallet);
  assert.equal(pending.length, 2, 'Both legitimate requests must be returned');

  // Verify deduplication: if identical ID appears in storage array, query returns exactly 1 instance
  const rawItems = JSON.parse(fs.readFileSync(requestsFile, 'utf8'));
  rawItems.push({ ...req1 }); // simulated duplicate entry
  fs.writeFileSync(requestsFile, JSON.stringify(rawItems, null, 2));

  const deduped = requestStore.getPendingForPatient(patientWallet);
  assert.equal(deduped.length, 2, 'Duplicate IDs must be collapsed to a single entry');
});

test('6. Newly created doctor request appears immediately without another patient search', async (t) => {
  const { app } = setupTestApp(t);

  const server = app.listen(0);
  t.after(() => server.close());
  const port = server.address().port;

  const doctorToken = signToken({ address: doctorWallet, role: 'doctor' });

  // 1. Doctor outgoing requests before creation
  const preDocRes = await fetch(`http://localhost:${port}/consent/requests?type=outgoing`, {
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  assert.deepEqual((await preDocRes.json()).requests, []);

  // 2. Doctor creates request
  await fetch(`http://localhost:${port}/consent/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${doctorToken}`
    },
    body: JSON.stringify({
      patientAddress: patientWallet,
      reason: 'Follow-up lab review'
    })
  });

  // 3. Doctor outgoing requests immediately contains the request without patient search
  const postDocRes = await fetch(`http://localhost:${port}/consent/requests?type=outgoing`, {
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  const docBody = await postDocRes.json();
  assert.equal(docBody.requests.length, 1);
  assert.equal(docBody.requests[0].patientAddress.toLowerCase(), patientWallet.toLowerCase());
  assert.equal(docBody.requests[0].status, 'pending');
});

test('7. Accept and reject status changes reflect in incoming and outgoing endpoints', async (t) => {
  const { app } = setupTestApp(t);

  const server = app.listen(0);
  t.after(() => server.close());
  const port = server.address().port;

  const doctorToken = signToken({ address: doctorWallet, role: 'doctor' });
  const patientToken = signToken({ address: patientWallet, role: 'patient' });

  // Doctor creates request
  const createRes = await fetch(`http://localhost:${port}/consent/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${doctorToken}`
    },
    body: JSON.stringify({
      patientAddress: patientWallet,
      reason: 'General checkup'
    })
  });
  const reqId = (await createRes.json()).request.id;

  // Patient rejects the request
  const rejectRes = await fetch(`http://localhost:${port}/consent/respond`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`
    },
    body: JSON.stringify({
      requestId: reqId,
      action: 'reject'
    })
  });
  assert.equal(rejectRes.status, 200);

  // Patient incoming pending list is now empty
  const incomingRes = await fetch(`http://localhost:${port}/consent/requests`, {
    headers: { Authorization: `Bearer ${patientToken}` }
  });
  assert.deepEqual((await incomingRes.json()).requests, [], 'Rejected request must no longer be pending');

  // Doctor outgoing list shows rejected status
  const outgoingRes = await fetch(`http://localhost:${port}/consent/requests?type=outgoing`, {
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  const outgoingBody = await outgoingRes.json();
  assert.equal(outgoingBody.requests.length, 1);
  assert.equal(outgoingBody.requests[0].id, reqId);
  assert.equal(outgoingBody.requests[0].status, 'rejected');
});

test('8. Patient cannot create an access request (doctor role strictly required)', async (t) => {
  const { app } = setupTestApp(t);

  const server = app.listen(0);
  t.after(() => server.close());
  const port = server.address().port;

  const patientToken = signToken({ address: patientWallet, role: 'patient' });

  const res = await fetch(`http://localhost:${port}/consent/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${patientToken}`
    },
    body: JSON.stringify({
      patientAddress: patientWallet,
      reason: 'Unauthorized self request'
    })
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.ok(body.error.includes('Only doctors'));
});
