import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { createChallengeStore } from '../services/authChallenges.js';
import { createAuthRouter, createLookupRateLimiter } from '../routes/auth.js';

test('single-use signature cannot be replayed, including after requesting a fresh nonce', async () => {
  const wallet = ethers.Wallet.createRandom();
  const store = createChallengeStore();
  const challenge = store.issue(wallet.address);
  const signature = await wallet.signMessage(challenge.message);
  assert.equal(store.verifyAndConsume(wallet.address, signature), wallet.address.toLowerCase());
  assert.throws(() => store.verifyAndConsume(wallet.address, signature));
  const next = store.issue(wallet.address);
  assert.notEqual(next.nonce, challenge.nonce);
  assert.throws(() => store.verifyAndConsume(wallet.address, signature));
  assert.equal(store.verifyAndConsume(wallet.address, await wallet.signMessage(next.message)), wallet.address.toLowerCase());
});
test('challenge expires at five minutes and new issuance invalidates old signatures', async () => {
  let time = 1700000000000;
  const wallet = ethers.Wallet.createRandom();
  const store = createChallengeStore({ now: () => time });
  const challenge = store.issue(wallet.address);
  const signature = await wallet.signMessage(challenge.message);
  time += 5 * 60 * 1000;
  assert.throws(() => store.verifyAndConsume(wallet.address, signature), /expired/);
  const old = store.issue(wallet.address);
  const oldSignature = await wallet.signMessage(old.message);
  store.issue(wallet.address);
  assert.throws(() => store.verifyAndConsume(wallet.address, oldSignature));
});
test('wrong wallet, altered message, altered origin and legacy static messages are rejected', async () => {
  const a = ethers.Wallet.createRandom(), b = ethers.Wallet.createRandom();
  const store = createChallengeStore();
  const challenge = store.issue(a.address);
  store.issue(b.address);
  const signatures = [
    await b.signMessage(challenge.message),
    await a.signMessage(challenge.message.replace('11155111', '1')),
    await a.signMessage(challenge.message.replace('localhost:5173', 'attacker.example')),
    await a.signMessage(`Welcome to HealthVault!\n\nSigning this message proves you own this wallet.\nNo transaction. No fees.\n\nWallet: ${a.address}`),
  ];
  for (const signature of signatures) assert.throws(() => store.verifyAndConsume(a.address, signature));
  assert.throws(() => store.verifyAndConsume(b.address, signatures[0]));
  assert.equal(store.verifyAndConsume(a.address.toLowerCase(), await a.signMessage(challenge.message)), a.address.toLowerCase());
});
test('login endpoints preserve token/ID response, reject parallel replay and validate inputs', async t => {
  const secret = 'synthetic-auth-test-secret-at-least-32-chars';
  const wallet = ethers.Wallet.createRandom();
  const app = express(); app.use(express.json()); app.use('/auth', createAuthRouter({ secret }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/auth`;
  const challenge = await (await fetch(`${base}/nonce/${wallet.address}`)).json();
  const body = JSON.stringify({ address: wallet.address, signature: await wallet.signMessage(challenge.message) });
  const replies = await Promise.all([1, 2].map(() => fetch(base + '/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })));
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 401]);
  const data = await replies.find(r => r.status === 200).json();
  assert.equal(jwt.verify(data.token, secret).address, wallet.address.toLowerCase());
  assert.match(data.patientId, /^HV-/);
  assert.equal((await fetch(base + '/nonce/not-a-wallet')).status, 400);
  assert.equal((await fetch(base + '/myid', { headers: { Authorization: `Bearer ${data.token}` } })).status, 200);
});

test('patient lookup requires authentication, restricts by role strictly on server, rejects forged X-Role, and enforces rate limits', async t => {
  const secret = 'synthetic-lookup-test-secret-at-least-32-chars';
  const callerWallet = ethers.Wallet.createRandom();
  const doctorToken = jwt.sign({ address: callerWallet.address.toLowerCase(), patientId: 'HV-DOC', role: 'doctor' }, secret, { expiresIn: '1h' });
  const patientToken = jwt.sign({ address: callerWallet.address.toLowerCase(), patientId: 'HV-PAT', role: 'patient' }, secret, { expiresIn: '1h' });
  const rolelessToken = jwt.sign({ address: callerWallet.address.toLowerCase(), patientId: 'HV-NONE' }, secret, { expiresIn: '1h' });

  // Known doctor in server registry (HV-1002 in KNOWN_WALLETS)
  const knownDoctorAddress = '0x89a34dfd2ee6f6c5714dbe7c391294fe87deb1c7';
  const serverKnownDoctorToken = jwt.sign({ address: knownDoctorAddress, patientId: 'HV-1002' }, secret, { expiresIn: '1h' });

  const lookupRateLimiter = createLookupRateLimiter({ max: 10, windowMs: 60000 });

  const app = express();
  app.use(express.json());
  app.use('/auth', createAuthRouter({ secret, lookupRateLimiter }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}/auth`;

  // 1. Unauthenticated request: must return 401 and must NOT leak wallet address
  const unauthRes = await fetch(`${base}/lookup/HV-1001`);
  assert.equal(unauthRes.status, 401);
  const unauthBody = await unauthRes.json();
  assert.equal(unauthBody.address, undefined);
  assert.match(unauthBody.error, /Authentication required/i);

  // 2. Request with invalid token: must return 401
  const invalidRes = await fetch(`${base}/lookup/HV-1001`, {
    headers: { Authorization: 'Bearer bad-or-forged-token' }
  });
  assert.equal(invalidRes.status, 401);
  const invalidBody = await invalidRes.json();
  assert.equal(invalidBody.address, undefined);

  // 3. Doctor looking up patient ID (HV-1001): 200 OK, returns minimum data without client role headers
  const docLookupPat = await fetch(`${base}/lookup/HV-1001`, {
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  assert.equal(docLookupPat.status, 200);
  const docLookupPatBody = await docLookupPat.json();
  assert.equal(docLookupPatBody.patientId, 'HV-1001');
  assert.equal(docLookupPatBody.address, '0x38e602e8e54d9f73ed6b81a7437701b5ed78e4d1');

  // 4. Doctor looking up doctor ID (HV-1002): 403 Forbidden
  const docLookupDoc = await fetch(`${base}/lookup/HV-1002`, {
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  assert.equal(docLookupDoc.status, 403);
  const docLookupDocBody = await docLookupDoc.json();
  assert.match(docLookupDocBody.error, /Doctors may only look up patient IDs/i);

  // 5. Patient looking up doctor ID (HV-1002): 200 OK, returns doctor address without client role headers
  const patLookupDoc = await fetch(`${base}/lookup/HV-1002`, {
    headers: { Authorization: `Bearer ${patientToken}` }
  });
  assert.equal(patLookupDoc.status, 200);
  const patLookupDocBody = await patLookupDoc.json();
  assert.equal(patLookupDocBody.patientId, 'HV-1002');
  assert.equal(patLookupDocBody.address, '0x89a34dfd2ee6f6c5714dbe7c391294fe87deb1c7');

  // 6. Patient looking up patient ID (HV-1001): 403 Forbidden
  const patLookupPat = await fetch(`${base}/lookup/HV-1001`, {
    headers: { Authorization: `Bearer ${patientToken}` }
  });
  assert.equal(patLookupPat.status, 403);
  const patLookupPatBody = await patLookupPat.json();
  assert.match(patLookupPatBody.error, /Patients may only look up doctor IDs/i);

  // 7. Security test: Forged X-Role header from patient (claiming to be doctor) is rejected
  const forgedDocRes = await fetch(`${base}/lookup/HV-1001`, {
    headers: { Authorization: `Bearer ${patientToken}`, 'X-Role': 'doctor' }
  });
  assert.equal(forgedDocRes.status, 403, 'Forged X-Role: doctor from patient token must be rejected');
  const forgedDocBody = await forgedDocRes.json();
  assert.match(forgedDocBody.error, /Patients may only look up doctor IDs/i);

  // 8. Security test: Forged X-Role header on roleless unknown token is rejected
  const forgedUnknownRes = await fetch(`${base}/lookup/HV-1001`, {
    headers: { Authorization: `Bearer ${rolelessToken}`, 'X-Role': 'doctor' }
  });
  assert.equal(forgedUnknownRes.status, 403, 'Forged X-Role on unassigned role token must be rejected');
  const forgedUnknownBody = await forgedUnknownRes.json();
  assert.match(forgedUnknownBody.error, /Valid user role/i);

  // 9. Server-side role resolution fallback: roleless token for known doctor wallet succeeds
  const serverDoctorRes = await fetch(`${base}/lookup/HV-1001`, {
    headers: { Authorization: `Bearer ${serverKnownDoctorToken}` }
  });
  assert.equal(serverDoctorRes.status, 200, 'Server-side identity resolves role when token omits role claim');
  const serverDoctorBody = await serverDoctorRes.json();
  assert.equal(serverDoctorBody.patientId, 'HV-1001');

  // 10. Non-existent ID: returns 404
  const notFoundRes = await fetch(`${base}/lookup/HV-9999`, {
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  assert.equal(notFoundRes.status, 404);

  // 11. Rate limiting: 10 requests made by callerWallet. 11th request exceeds limit of 10 -> 429
  // Requests made by callerWallet so far:
  // docLookupPat (1), docLookupDoc (2), patLookupDoc (3), patLookupPat (4), forgedDocRes (5), forgedUnknownRes (6), notFoundRes (7)
  // Let's make 3 more to reach 10:
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${base}/lookup/HV-1001`, { headers: { Authorization: `Bearer ${doctorToken}` } });
    assert.equal(r.status, 200);
  }

  // 11th request exceeds max of 10: must return 429 Too Many Requests
  const eleventhRes = await fetch(`${base}/lookup/HV-1001`, {
    headers: { Authorization: `Bearer ${doctorToken}` }
  });
  assert.equal(eleventhRes.status, 429);
  assert.ok(eleventhRes.headers.get('retry-after'));
  const rateLimitBody = await eleventhRes.json();
  assert.match(rateLimitBody.error, /Too many patient lookup attempts/i);
});
