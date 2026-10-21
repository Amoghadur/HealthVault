import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createConsentRouter, escapeHtml, escapeArrayOrString } from '../routes/consent.js';
import { createEmergencyTokenStore } from '../services/emergencyTokenStore.js';
import { createConsentRequestStore } from '../services/consentRequestStore.js';
import { createConsentExpiryStore } from '../services/consentExpiryStore.js';

process.env.JWT_SECRET = 'synthetic-emergency-test-secret-32-chars';
const patientWallet = '0x1111111111111111111111111111111111111111';
const doctorWallet = '0x2222222222222222222222222222222222222222';

async function createServerFixture(t, options = {}) {
  const dir = options.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'hv-emergency-test-'));
  const tokensFile = options.tokensFile || path.join(dir, 'emergency_tokens.json');
  const requestsFile = options.requestsFile || path.join(dir, 'consent_requests.json');
  const expiryFile = options.expiryFile || path.join(dir, 'consent_expiries.json');

  const emergencyStore = createEmergencyTokenStore(tokensFile);
  const requestStore = createConsentRequestStore(requestsFile);
  const expiryStore = createConsentExpiryStore(expiryFile);

  const events = [];
  const app = express();
  app.use(express.json());
  app.use('/consent', createConsentRouter({
    emergencyStore,
    requestStore,
    expiryStore,
    audit: event => events.push(event),
    hasAccess: async () => true,
    emergencyQrBaseUrl: options.emergencyQrBaseUrl !== undefined ? options.emergencyQrBaseUrl : 'https://emergency.healthvault.org',
    emergencyQrRateLimiter: options.emergencyQrRateLimiter || ((req, res, next) => next()),
    emergencyScanRateLimiter: options.emergencyScanRateLimiter || ((req, res, next) => next()),
  }));


  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  if (!options.dir) {
    t.after(async () => {
      try {
        if (server?.listening) await new Promise(resolve => server.close(resolve));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  const call = (route, address, body) => fetch(`http://127.0.0.1:${server.address().port}/consent${route}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(address ? { Authorization: `Bearer ${jwt.sign({ address }, process.env.JWT_SECRET)}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  return { dir, tokensFile, requestsFile, expiryFile, emergencyStore, requestStore, expiryStore, server, events, call };
}

test('escapeHtml and escapeArrayOrString properly sanitize untrusted inputs', () => {
  assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml("Tom & Jerry's"), 'Tom &amp; Jerry&#39;s');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');

  const list = ['<script>evil()</script>', '<b>Peanuts</b>', '  Dust  '];
  assert.equal(
    escapeArrayOrString(list, 'None'),
    '&lt;script&gt;evil()&lt;/script&gt;, &lt;b&gt;Peanuts&lt;/b&gt;, Dust'
  );
  assert.equal(escapeArrayOrString([], 'None'), 'None');
  assert.equal(escapeArrayOrString('   ', 'None'), 'None');
  assert.equal(escapeArrayOrString('<b>Pollen</b>', 'None'), '&lt;b&gt;Pollen&lt;/b&gt;');
});

test('emergency scan route renders script tags and HTML in profile fields strictly as text, and sets CSP/nosniff headers', async t => {
  const f = await createServerFixture(t);

  const maliciousPayload = {
    patientData: {
      name: '<script>alert("hacked name")</script>',
      bloodType: '<b onmouseover=alert("blood")>AB+</b>',
      allergies: ['<script>fetch("http://attacker.com")</script>', '<img src=x onerror=alert("allergy")>'],
      medications: ['<svg onload=alert("meds")>', '<b>Aspirin</b>'],
      emergencyContact: '<a href="javascript:alert(1)">Evil Contact</a> & "Friends"'
    }
  };

  const genRes = await f.call('/qr/generate', patientWallet, maliciousPayload);
  assert.equal(genRes.status, 200);
  const { token } = await genRes.json();
  assert.ok(token);

  const scanRes = await f.call(`/qr/scan/${token}`);
  assert.equal(scanRes.status, 200);

  // Security headers check
  const csp = scanRes.headers.get('content-security-policy');
  assert.ok(csp, 'Content-Security-Policy header must be present');
  assert.ok(csp.includes("default-src 'none'"), 'CSP must specify default-src none');
  assert.ok(csp.includes("style-src 'unsafe-inline'"), 'CSP must allow inline styles');
  assert.equal(scanRes.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(scanRes.headers.get('content-type')?.includes('text/html'));

  const html = await scanRes.text();

  // Prove raw script tags and dangerous HTML elements are NOT rendered as executable tags
  assert.ok(!html.includes('<script>'), 'Must not contain raw <script> tag');
  assert.ok(!html.includes('<b onmouseover'), 'Must not contain raw <b> tag with event handlers');
  assert.ok(!html.includes('<img src=x'), 'Must not contain raw <img> tag');
  assert.ok(!html.includes('<svg onload'), 'Must not contain raw <svg> tag');
  assert.ok(!html.includes('<a href="javascript:'), 'Must not contain raw javascript link');

  // Prove all values are safely escaped as plain text entities
  assert.ok(html.includes('&lt;script&gt;alert(&quot;hacked name&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;b onmouseover=alert(&quot;blood&quot;)&gt;AB+&lt;/b&gt;'));
  assert.ok(html.includes('&lt;script&gt;fetch(&quot;http://attacker.com&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(&quot;allergy&quot;)&gt;'));
  assert.ok(html.includes('&lt;svg onload=alert(&quot;meds&quot;)&gt;'));
  assert.ok(html.includes('&lt;b&gt;Aspirin&lt;/b&gt;'));
  assert.ok(html.includes('&lt;a href=&quot;javascript:alert(1)&quot;&gt;Evil Contact&lt;/a&gt; &amp; &quot;Friends&quot;'));
});

test('emergency tokens survive server restart without invalidation, and expired tokens are rejected', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-emergency-restart-'));
  const tokensFile = path.join(dir, 'emergency_tokens.json');
  const requestsFile = path.join(dir, 'consent_requests.json');
  const expiryFile = path.join(dir, 'consent_expiries.json');

  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  let server1;
  let tokenActive;
  let tokenExpired;

  // Server instance 1: create tokens
  {
    const f1 = await createServerFixture(t, { dir, tokensFile, requestsFile, expiryFile });
    server1 = f1.server;

    // Generate active token (1 hour expiry)
    const genRes = await f1.call('/qr/generate', patientWallet, {
      patientData: {
        bloodType: 'O+',
        allergies: ['Penicillin'],
        medications: ['Metformin'],
        emergencyContact: 'John Doe: 555-1234'
      }
    });
    assert.equal(genRes.status, 200);
    tokenActive = (await genRes.json()).token;

    // Directly seed an already expired token into the store
    tokenExpired = 'expiredtoken1234567890abcdef1234567890abcdef1234567890abcdef1234';
    const store = createEmergencyTokenStore(tokensFile);
    // Write expired token directly to disk
    const items = store.getAll();
    items.push({
      token: tokenExpired,
      patientAddress: patientWallet,
      expiry: Date.now() - 5000, // 5 seconds in the past
      expiresAt: new Date(Date.now() - 5000).toISOString(),
      createdAt: new Date(Date.now() - 10000).toISOString(),
      data: { bloodType: 'A+' }
    });
    fs.writeFileSync(tokensFile, JSON.stringify(items, null, 2));

    await new Promise(resolve => server1.close(resolve));
  }

  // Server instance 2: simulate restart with newly instantiated store pointing to same disk storage
  {
    const f2 = await createServerFixture(t, { dir, tokensFile, requestsFile, expiryFile });
    t.after(async () => {
      if (f2.server?.listening) await new Promise(resolve => f2.server.close(resolve));
    });

    // 1. Active token must succeed after restart
    const activeRes = await f2.call(`/qr/scan/${tokenActive}`);
    assert.equal(activeRes.status, 200);
    const activeHtml = await activeRes.text();
    assert.ok(activeHtml.includes('HealthVault Emergency Access'));
    assert.ok(activeHtml.includes('O+'));
    assert.ok(activeHtml.includes('Penicillin'));
    assert.ok(activeHtml.includes('John Doe: 555-1234'));

    // 2. Expired token must be rejected after restart
    const expiredRes = await f2.call(`/qr/scan/${tokenExpired}`);
    assert.equal(expiredRes.status, 410);
    const expiredHtml = await expiredRes.text();
    assert.ok(expiredHtml.includes('QR Code Expired'));

    // 3. Nonexistent token must be rejected
    const nonexistentRes = await f2.call('/qr/scan/nonexistenttoken');
    assert.equal(nonexistentRes.status, 404);
    const nonexistentHtml = await nonexistentRes.text();
    assert.ok(nonexistentHtml.includes('Invalid QR Code'));
  }
});

test('pending consent requests survive server restart, and expired requests cannot be accepted', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-request-restart-'));
  const tokensFile = path.join(dir, 'emergency_tokens.json');
  const requestsFile = path.join(dir, 'consent_requests.json');
  const expiryFile = path.join(dir, 'consent_expiries.json');

  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  let server1;
  let requestId;

  // Server 1: Doctor sends access request
  {
    const f1 = await createServerFixture(t, { dir, tokensFile, requestsFile, expiryFile });
    server1 = f1.server;

    const reqRes = await f1.call('/request', doctorWallet, { patientAddress: patientWallet, reason: 'Follow-up consultation' });
    assert.equal(reqRes.status, 200);
    const body = await reqRes.json();
    assert.equal(body.success, true);
    requestId = body.request.id;

    // Check request is in pending list
    const listRes = await f1.call('/requests', patientWallet);
    const listBody = await listRes.json();
    assert.equal(listBody.requests.length, 1);
    assert.equal(listBody.requests[0].id, requestId);

    await new Promise(resolve => server1.close(resolve));
  }

  // Server 2: Restart and verify pending request persists
  {
    const f2 = await createServerFixture(t, { dir, tokensFile, requestsFile, expiryFile });
    t.after(async () => {
      if (f2.server?.listening) await new Promise(resolve => f2.server.close(resolve));
    });

    // Patient checks requests on new server instance
    const listRes = await f2.call('/requests', patientWallet);
    const listBody = await listRes.json();
    assert.equal(listBody.requests.length, 1, 'Pending request must survive server restart');
    assert.equal(listBody.requests[0].id, requestId);
    assert.equal(listBody.requests[0].reason, 'Follow-up consultation');

    // Patient can accept the request after restart
    const respondRes = await f2.call('/respond', patientWallet, { requestId, action: 'accept', durationMinutes: 15 });
    assert.equal(respondRes.status, 200);
    assert.equal((await respondRes.json()).action, 'accept');

    // Now pending list is empty
    const listEmpty = await (await f2.call('/requests', patientWallet)).json();
    assert.equal(listEmpty.requests.length, 0);

    // Verify expired consent request handling
    const reqStore = createConsentRequestStore(requestsFile);
    const all = reqStore.getAll();
    all.push({
      id: 'expired-request-id',
      patientAddress: patientWallet,
      doctorAddress: doctorWallet,
      reason: 'Old request',
      status: 'pending',
      requestedAt: new Date(Date.now() - 100000).toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(), // expired
      respondedAt: null
    });
    fs.writeFileSync(requestsFile, JSON.stringify(all, null, 2));

    // Expired request is NOT listed as pending
    const listAfterExpiry = await (await f2.call('/requests', patientWallet)).json();
    assert.equal(listAfterExpiry.requests.length, 0, 'Expired requests must be excluded from pending');

    // Attempting to respond to expired request returns 410
    const expiredRespondRes = await f2.call('/respond', patientWallet, { requestId: 'expired-request-id', action: 'accept' });
    assert.equal(expiredRespondRes.status, 410);
    assert.equal((await expiredRespondRes.json()).error, 'Request has expired');
  }
});

test('EMERGENCY_QR_BASE_URL validation: rejects localhost, private LAN, non-HTTPS, and development hostnames', async () => {
  const { validateEmergencyQrBaseUrl, buildEmergencyScanUrl } = await import('../services/emergencyQrUrl.js');

  // 1. Missing or empty configuration
  assert.equal(validateEmergencyQrBaseUrl(undefined).valid, false);
  assert.equal(validateEmergencyQrBaseUrl(null).valid, false);
  assert.equal(validateEmergencyQrBaseUrl('').valid, false);
  assert.equal(validateEmergencyQrBaseUrl('   ').valid, false);

  // 2. Non-HTTPS protocol must be rejected
  assert.equal(validateEmergencyQrBaseUrl('http://my-tunnel.trycloudflare.com').valid, false);
  assert.ok(validateEmergencyQrBaseUrl('http://my-tunnel.trycloudflare.com').error.includes('protocol must be \'https:\''));

  // 3. Localhost and loopback addresses must be rejected
  for (const host of ['http://localhost:4000', 'https://localhost', 'https://127.0.0.1:4000', 'https://[::1]', 'https://0.0.0.0']) {
    const res = validateEmergencyQrBaseUrl(host);
    assert.equal(res.valid, false, `Must reject ${host}`);
  }

  // 4. Private LAN IPs must be rejected
  for (const ip of ['https://192.168.1.50', 'https://10.0.0.1', 'https://172.16.0.1', 'https://172.31.255.255', 'https://169.254.1.1']) {
    const res = validateEmergencyQrBaseUrl(ip);
    assert.equal(res.valid, false, `Must reject private LAN IP ${ip}`);
    assert.ok(res.error.includes('private LAN IP'));
  }

  // 5. Development-only domain suffixes must be rejected
  for (const devHost of ['https://my-mac.local', 'https://server.internal', 'https://router.lan', 'https://test.example']) {
    const res = validateEmergencyQrBaseUrl(devHost);
    assert.equal(res.valid, false, `Must reject dev domain ${devHost}`);
  }

  // 6. Valid public HTTPS endpoints must succeed
  const validCloudflare = validateEmergencyQrBaseUrl('https://my-emergency-tunnel.trycloudflare.com');
  assert.equal(validCloudflare.valid, true);
  assert.equal(validCloudflare.parsed.host, 'my-emergency-tunnel.trycloudflare.com');

  const validCustomDomain = validateEmergencyQrBaseUrl('https://emergency.healthvault.org');
  assert.equal(validCustomDomain.valid, true);

  // 7. URL construction without duplicated path segments or slashes
  const validToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const url1 = buildEmergencyScanUrl('https://emergency.healthvault.org', validToken);
  assert.equal(url1, `https://emergency.healthvault.org/consent/qr/scan/${validToken}`);

  const url2 = buildEmergencyScanUrl('https://emergency.healthvault.org/consent/qr/scan', validToken);
  assert.equal(url2, `https://emergency.healthvault.org/consent/qr/scan/${validToken}`, 'Must not duplicate /consent/qr/scan');

  const url3 = buildEmergencyScanUrl('https://emergency.healthvault.org/consent/qr/scan/', validToken);
  assert.equal(url3, `https://emergency.healthvault.org/consent/qr/scan/${validToken}`, 'Must normalize trailing slashes');
});

test('Missing or invalid EMERGENCY_QR_BASE_URL does not silently fall back to localhost and returns 503', async t => {
  // Test fixture with NO public base URL configured (null)
  const f = await createServerFixture(t, { emergencyQrBaseUrl: null });

  // 1. Config endpoint reports not configured
  const configRes = await f.call('/qr/config');
  assert.equal(configRes.status, 200);
  const config = await configRes.json();
  assert.equal(config.configured, false);
  assert.equal(config.baseUrl, null);

  // 2. Generating QR without public base URL fails with 503 and clear error
  const genRes = await f.call('/qr/generate', patientWallet, {
    patientData: { bloodType: 'B+' }
  });
  assert.equal(genRes.status, 503);
  const body = await genRes.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'EMERGENCY_QR_BASE_URL_NOT_CONFIGURED');
  assert.ok(body.error.includes('Public Emergency QR endpoint is not configured'));
  assert.ok(!JSON.stringify(body).includes('localhost'), 'Must never return or fall back to localhost');
});

test('Emergency QR revocation: patient can revoke token, revoked token is rejected with 410', async t => {
  const f = await createServerFixture(t, { emergencyQrBaseUrl: 'https://emergency.healthvault.org' });

  // 1. Generate active QR
  const genRes = await f.call('/qr/generate', patientWallet, {
    patientData: {
      name: 'Alice Smith',
      bloodType: 'A+',
      allergies: ['Latex'],
      emergencyContact: 'Bob: 555-9876'
    }
  });
  assert.equal(genRes.status, 200);
  const { token, scanUrl } = await genRes.json();
  assert.ok(scanUrl.startsWith('https://emergency.healthvault.org/consent/qr/scan/'));

  // 2. Verify active token works before revocation
  const beforeRevoke = await f.call(`/qr/scan/${token}`);
  assert.equal(beforeRevoke.status, 200);

  // Check /qr/active endpoint
  const activeRes = await f.call('/qr/active', patientWallet);
  assert.equal(activeRes.status, 200);
  const activeBody = await activeRes.json();
  assert.equal(activeBody.hasActive, true);
  assert.equal(activeBody.token, token);

  // 3. Revoke the token
  const revokeRes = await f.call('/qr/revoke', patientWallet, { token });
  assert.equal(revokeRes.status, 200);
  const revokeBody = await revokeRes.json();
  assert.equal(revokeBody.success, true);

  // 4. Scanned token now returns 410 Revoked
  const afterRevoke = await f.call(`/qr/scan/${token}`);
  assert.equal(afterRevoke.status, 410);
  const html = await afterRevoke.text();
  assert.ok(html.includes('QR Code Revoked'));
  assert.ok(html.includes('revoked by the patient'));

  // 5. Active endpoint now reports no active token
  const activeAfterRevoke = await (await f.call('/qr/active', patientWallet)).json();
  assert.equal(activeAfterRevoke.hasActive, false);
});

test('Emergency scan rejects malformed, unknown, expired, and revoked tokens with distinct states', async t => {
  const f = await createServerFixture(t, { emergencyQrBaseUrl: 'https://emergency.healthvault.org' });

  // 1. Malformed token (invalid characters / too short)
  const malformedRes = await f.call('/qr/scan/abc!bad');
  assert.equal(malformedRes.status, 400);
  const malformedHtml = await malformedRes.text();
  assert.ok(malformedHtml.includes('Malformed Emergency QR Code'));

  // 2. Unknown token (not found in database)
  const unknownToken = '1111111111111111111111111111111111111111111111111111111111111111';
  const unknownRes = await f.call(`/qr/scan/${unknownToken}`);
  assert.equal(unknownRes.status, 404);
  const unknownHtml = await unknownRes.text();
  assert.ok(unknownHtml.includes('Invalid QR Code'));

  // 3. Security headers: Referrer-Policy and Cache-Control
  assert.equal(malformedRes.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(malformedRes.headers.get('cache-control')?.includes('no-store'));
});

test('Emergency profile returns only permitted fields and never exposes medical records or private keys', async t => {
  const f = await createServerFixture(t, { emergencyQrBaseUrl: 'https://emergency.healthvault.org' });

  // Attempt to pass unauthorized medical record or private data in payload
  const suspiciousPayload = {
    patientData: {
      name: 'Safe Patient',
      bloodType: 'O-',
      allergies: ['Sulfa'],
      medications: ['Thyroxine'],
      emergencyContact: 'Doctor: 555-0000',
      privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
      recordId: 'rec-super-secret-1234',
      ipfsHash: 'QmSecretMedicalFileHash1234567890',
      clinicalSummary: 'Full confidential clinical psychiatric history'
    }
  };

  const genRes = await f.call('/qr/generate', patientWallet, suspiciousPayload);
  assert.equal(genRes.status, 200);
  const { token } = await genRes.json();

  // Scan with JSON format to inspect structured output
  const scanRes = await f.call(`/qr/scan/${token}?format=json`);
  assert.equal(scanRes.status, 200);
  const data = await scanRes.json();

  // Permitted fields are present
  assert.equal(data.patientName, 'Safe Patient');
  assert.equal(data.bloodType, 'O-');
  assert.equal(data.allergies, 'Sulfa');
  assert.equal(data.medications, 'Thyroxine');
  assert.equal(data.emergencyContact, 'Doctor: 555-0000');

  // Forbidden fields must NOT be present
  assert.equal(data.privateKey, undefined);
  assert.equal(data.recordId, undefined);
  assert.equal(data.ipfsHash, undefined);
  assert.equal(data.clinicalSummary, undefined);
});

test('Rate limiting on emergency scan and generate endpoints protects against flooding', async t => {
  let scanAttempts = 0;
  const customScanLimiter = (req, res, next) => {
    scanAttempts++;
    if (scanAttempts > 2) {
      return res.status(429).json({ error: 'Too many emergency scan attempts. Please try again later.' });
    }
    next();
  };

  const f = await createServerFixture(t, {
    emergencyQrBaseUrl: 'https://emergency.healthvault.org',
    emergencyScanRateLimiter: customScanLimiter
  });

  const genRes = await f.call('/qr/generate', patientWallet, { patientData: { bloodType: 'AB+' } });
  const { token } = await genRes.json();

  // First 2 scans succeed
  const res1 = await f.call(`/qr/scan/${token}?format=json`);
  assert.equal(res1.status, 200);

  const res2 = await f.call(`/qr/scan/${token}?format=json`);
  assert.equal(res2.status, 200);

  // 3rd scan is rate-limited (429)
  const res3 = await f.call(`/qr/scan/${token}?format=json`);
  assert.equal(res3.status, 429);
  const body3 = await res3.json();
  assert.ok(body3.error.includes('Too many'));
});
