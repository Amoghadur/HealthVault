import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createConsentExpiryStore, ALLOWED_DURATIONS } from '../services/consentExpiryStore.js';
import { createConsentRouter } from '../routes/consent.js';
import { createRecordRouter } from '../routes/records.js';
import { createDoctorProfileStore } from '../services/doctorProfileStore.js';

process.env.JWT_SECRET = 'synthetic-consent-expiry-test-secret';
process.env.RECORD_ENCRYPTION_KEY = 'cd'.repeat(32);

const patient = '0x0000000000000000000000000000000000000001';
const doctor = '0x00000000000000000000000000000000000000ab';
const otherDoctor = '0x0000000000000000000000000000000000000003';
const otherPatient = '0x0000000000000000000000000000000000000004';
// A complete, synthetic one-page PDF: exercises real AES-GCM decryption and delivery.
const originalPdf = (() => {
  const stream = 'BT /F1 12 Tf 72 720 Td (Synthetic original prescription) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  }
  const xref = Buffer.byteLength(pdf);
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(pdf);
})();

async function fixture(t, { expiryStoreOverride, onChainAllowed = true, onChainUnavailable = false, consentTimeoutMs = 20_000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-consent-expiry-'));
  const recordsFile = path.join(dir, 'records_metadata.json');
  const expiryFile = path.join(dir, 'consent_expiries.json');
  const profilesFile = path.join(dir, 'doctor_profiles.json');

  const expiryStore = expiryStoreOverride || createConsentExpiryStore(expiryFile);
  const profileStore = createDoctorProfileStore(profilesFile);

  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(originalPdf), cipher.final()]);
  fs.writeFileSync(path.join(dir, 'enc_sample.pdf'), encrypted);

  const records = [
    {
      id: 'rec1',
      fileName: 'test_rx.pdf',
      encryptedFileName: 'enc_sample.pdf',
      patientAddress: patient,
      doctorAddress: doctor,
      doctorName: 'Dr. Test',
      recordType: 'prescription',
      ipfsHash: 'QmTestHash',
      encryptionKey: key.toString('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      uploadedAt: '2026-03-01T10:00:00.000Z',
      fileType: 'application/pdf',
    },
    {
      id: 'rec2',
      fileName: 'other_rx.pdf',
      encryptedFileName: 'enc_sample.pdf',
      patientAddress: otherPatient,
      doctorAddress: otherDoctor,
      doctorName: 'Dr. Other',
      recordType: 'report',
      ipfsHash: 'QmOtherHash',
      encryptionKey: key.toString('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      uploadedAt: '2026-03-02T10:00:00.000Z',
      fileType: 'application/pdf',
    },
  ];
  fs.writeFileSync(recordsFile, JSON.stringify(records, null, 2));

  const state = {
    onChainAllowed,
    onChainUnavailable,
    events: [],
    checks: [],
    duringCheck: null,
  };

  const hasAccessMock = async (p, d) => {
    state.checks.push([p.toLowerCase(), d.toLowerCase()]);
    if (state.duringCheck) await state.duringCheck();
    if (state.onChainUnavailable) throw new Error('synthetic on-chain RPC failure');
    return state.onChainAllowed;
  };

  const app = express();
  app.use(express.json());
  app.use('/consent', createConsentRouter({
    profiles: profileStore,
    audit: event => state.events.push(event),
    expiryStore,
    hasAccess: hasAccessMock,
  }));
  app.use('/records', createRecordRouter({
    uploadsDir: dir,
    hasAccess: hasAccessMock,
    audit: event => state.events.push(event),
    pinFile: async () => 'QmSyntheticPinnedHash',
    expiryStore,
    consentTimeoutMs,
  }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const token = address => jwt.sign({ address }, process.env.JWT_SECRET, { expiresIn: '15m' });
  const call = (route, address = patient, options = {}) => fetch(`${base}${route}`, {
    ...options,
    headers: {
      ...(address ? { Authorization: `Bearer ${token(address)}` } : {}),
      ...options.headers,
    },
  });

  return { dir, expiryFile, recordsFile, expiryStore, state, call, token };
}

test('duration limits: only 5, 15, 30, and 60 minutes are accepted; others are rejected', async t => {
  const f = await fixture(t);

  for (const mins of ALLOWED_DURATIONS) {
    const res = await f.call('/consent/grant', patient, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doctorAddress: doctor, durationMinutes: mins }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.grant.durationMinutes, mins);
    const expectedExpiry = Date.parse(data.grant.grantedAt) + mins * 60 * 1000;
    assert.equal(Date.parse(data.grant.expiresAt), expectedExpiry);
  }

  for (const bad of [0, -5, 1, 10, 45, 61, 120, '60m', 'invalid', null, undefined]) {
    const res = await f.call('/consent/grant', patient, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doctorAddress: doctor, durationMinutes: bad }),
    });
    assert.equal(res.status, 400, `duration ${bad} must be rejected with 400`);
    const data = await res.json();
    assert.match(data.error, /Duration must be 5, 15, 30, or 60 minutes/);
  }
});

test('exact expiry boundary: access is granted 1ms before expiry and strictly denied at/past boundary', async t => {
  const f = await fixture(t);

  const baseTime = Date.parse('2026-06-01T12:00:00.000Z');
  const grant = f.expiryStore.saveGrant({
    patientAddress: patient,
    doctorAddress: doctor,
    durationMinutes: 15,
    grantedAt: new Date(baseTime).toISOString(),
  });
  const expiryTime = Date.parse(grant.expiresAt); // baseTime + 15 * 60 * 1000

  // 1ms before expiry: active
  const before = f.expiryStore.getActiveGrant(patient, doctor, expiryTime - 1);
  assert.ok(before, 'access must be active 1ms before expiry');
  assert.equal(before.patientAddress, patient);

  // Exact boundary (now === expiresAt): strictly expired
  const exact = f.expiryStore.getActiveGrant(patient, doctor, expiryTime);
  assert.equal(exact, null, 'access must be denied at exact expiry boundary');

  // Past boundary: strictly expired
  const past = f.expiryStore.getActiveGrant(patient, doctor, expiryTime + 1);
  assert.equal(past, null, 'access must be denied past expiry boundary');
});

test('backend restart persistence: grants survive process restart without reset or extension', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-restart-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'consent_expiries.json');

  const instance1 = createConsentExpiryStore(file);
  const grantedAt = '2026-04-10T14:00:00.000Z';
  const saved = instance1.saveGrant({
    patientAddress: patient,
    doctorAddress: doctor,
    durationMinutes: 30,
    grantedAt,
  });

  assert.equal(saved.durationMinutes, 30);
  assert.equal(saved.expiresAt, '2026-04-10T14:30:00.000Z');

  // Restart simulation: instantiate completely new store pointing to same file
  const instance2 = createConsentExpiryStore(file);
  const loaded = instance2.get(patient, doctor);

  assert.deepEqual(loaded, saved, 'restarted store must load exact persisted grant');
  assert.equal(loaded.expiresAt, '2026-04-10T14:30:00.000Z', 'restart must not extend or reset expiry');
  assert.equal(loaded.revokedAt, null);
});

test('wallet isolation: grants are strictly bound to patient and doctor wallet', async t => {
  const f = await fixture(t);

  // Patient grants Doctor
  await f.call('/consent/grant', patient, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doctorAddress: doctor, durationMinutes: 15 }),
  });

  // Doctor can view Patient's record
  const allowed = await f.call('/records/view/rec1', doctor);
  assert.equal(allowed.status, 200);

  // OtherDoctor cannot view Patient's record (wallet isolation)
  const deniedDoctor = await f.call('/records/view/rec1', otherDoctor);
  assert.equal(deniedDoctor.status, 403);

  // Doctor cannot view OtherPatient's record (rec2)
  const deniedPatient = await f.call('/records/view/rec2', doctor);
  assert.equal(deniedPatient.status, 403);

  // Spoofed query parameters or headers cannot bypass wallet binding
  const spoofed = await f.call(`/records/view/rec1?doctorAddress=${doctor}`, otherDoctor, {
    headers: { 'X-Doctor-Address': doctor },
  });
  assert.equal(spoofed.status, 403);
});

test('revocation: access is denied immediately on-chain or via backend revoke', async t => {
  const f = await fixture(t);

  // Grant 60 minutes
  await f.call('/consent/grant', patient, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doctorAddress: doctor, durationMinutes: 60 }),
  });
  assert.equal((await f.call('/records/view/rec1', doctor)).status, 200);

  // Patient revokes via backend
  const revokeRes = await f.call('/consent/revoke', patient, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doctorAddress: doctor }),
  });
  assert.equal(revokeRes.status, 200);

  // Immediate denial
  const revokedView = await f.call('/records/view/rec1', doctor);
  assert.equal(revokedView.status, 403);
  const statusRes = await (await f.call(`/consent/status/${doctor}`, patient)).json();
  assert.equal(statusRes.hasAccess, false);
  assert.equal(statusRes.status, 'revoked');

  // Test on-chain revocation: simulate contract returning false
  f.expiryStore.saveGrant({ patientAddress: patient, doctorAddress: doctor, durationMinutes: 60 });
  f.state.onChainAllowed = false;

  const onChainDenied = await f.call('/records/view/rec1', doctor);
  assert.equal(onChainDenied.status, 403);
  assert.equal(f.expiryStore.getActiveGrant(patient, doctor), null, 'on-chain false must revoke store grant');
});

test('RPC failure: blockchain/RPC outages fail closed (503) and never leak decrypted content', async t => {
  const f = await fixture(t);

  // Grant active expiry
  await f.call('/consent/grant', patient, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doctorAddress: doctor, durationMinutes: 30 }),
  });

  // Make RPC fail
  f.state.onChainUnavailable = true;

  const viewRes = await f.call('/records/view/rec1', doctor);
  assert.equal(viewRes.status, 503);
  const viewText = await viewRes.text();
  assert.ok(!viewText.includes('Synthetic original'), 'must never leak plaintext on RPC outage');

  const docRes = await f.call('/records/doctor', doctor);
  assert.equal(docRes.status, 503);

  const statusRes = await f.call(`/consent/status/${doctor}`, patient);
  assert.equal(statusRes.status, 503);
  const statusData = await statusRes.json();
  assert.equal(statusData.status, 'verification-unavailable');
});

test('renewal: patient can renew expired or active grant with new duration', async t => {
  const f = await fixture(t);

  // Initial 5 min grant in the past (expired)
  const pastTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  f.expiryStore.saveGrant({
    patientAddress: patient,
    doctorAddress: doctor,
    durationMinutes: 5,
    grantedAt: pastTime,
  });

  assert.equal(f.expiryStore.getActiveGrant(patient, doctor), null, 'should be initially expired');
  assert.equal((await f.call('/records/view/rec1', doctor)).status, 403);

  // Patient renews for 30 minutes
  const renewRes = await f.call('/consent/grant', patient, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doctorAddress: doctor, durationMinutes: 30 }),
  });
  assert.equal(renewRes.status, 200);

  const activeGrant = f.expiryStore.getActiveGrant(patient, doctor);
  assert.ok(activeGrant);
  assert.equal(activeGrant.durationMinutes, 30);
  assert.equal((await f.call('/records/view/rec1', doctor)).status, 200);
});

test('patient self-access: patient viewing and listing is never blocked by doctor expiry or RPC failures', async t => {
  const f = await fixture(t);

  // No grant exists for patient to any doctor
  f.state.onChainUnavailable = true;

  // Patient can still view their own record
  const selfView = await f.call('/records/view/rec1', patient);
  assert.equal(selfView.status, 200);
  assert.deepEqual(Buffer.from(await selfView.arrayBuffer()), originalPdf);

  // Patient can still list their own records
  const selfList = await f.call('/records/patient', patient);
  assert.equal(selfList.status, 200);
  const data = await selfList.json();
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].id, 'rec1');
});

test('all protected record routes enforce expiry: upload, doctor history, viewing, and status', async t => {
  const f = await fixture(t);

  // 1. Without grant:
  // /records/doctor excludes patient records
  assert.deepEqual((await (await f.call('/records/doctor', doctor)).json()).records, []);

  // /records/view/:recordId returns 403
  assert.equal((await f.call('/records/view/rec1', doctor)).status, 403);

  // /records/check/:patientAddress returns hasAccess: false
  const checkBefore = await (await f.call(`/records/check/${patient}`, doctor)).json();
  assert.equal(checkBefore.hasAccess, false);

  // /records/upload without grant returns 403
  const formWithoutGrant = new FormData();
  formWithoutGrant.append('file', new Blob([originalPdf], { type: 'application/pdf' }), 'upload.pdf');
  formWithoutGrant.append('patientAddress', patient);
  const uploadNoGrant = await f.call('/records/upload', doctor, { method: 'POST', body: formWithoutGrant });
  assert.equal(uploadNoGrant.status, 403);
  assert.match((await uploadNoGrant.json()).error, /Patient access consent has expired or has not been granted/);

  // 2. Patient grants 15 minutes
  await f.call('/consent/grant', patient, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doctorAddress: doctor, durationMinutes: 15 }),
  });

  // /records/doctor now includes the record
  const historyActive = await (await f.call('/records/doctor', doctor)).json();
  assert.equal(historyActive.records.length, 1);
  assert.equal(historyActive.records[0].id, 'rec1');

  // /records/view/:recordId returns 200 with decrypted bytes
  const viewActive = await f.call('/records/view/rec1', doctor);
  assert.equal(viewActive.status, 200);
  assert.deepEqual(Buffer.from(await viewActive.arrayBuffer()), originalPdf);

  // /records/upload succeeds with active grant
  const formWithGrant = new FormData();
  formWithGrant.append('file', new Blob([originalPdf], { type: 'application/pdf' }), 'upload2.pdf');
  formWithGrant.append('patientAddress', patient);
  const uploadActive = await f.call('/records/upload', doctor, { method: 'POST', body: formWithGrant });
  assert.equal(uploadActive.status, 200);

  // /consent/status reflects active status and remainingSeconds
  const statusActive = await (await f.call(`/consent/status/${doctor}`, patient)).json();
  assert.equal(statusActive.hasAccess, true);
  assert.equal(statusActive.status, 'active');
  assert.ok(statusActive.remainingSeconds > 0 && statusActive.remainingSeconds <= 900);

  // /consent/grants lists the grant for patient
  const grantsList = await (await f.call('/consent/grants', patient)).json();
  assert.equal(grantsList.grants.length, 1);
  assert.equal(grantsList.grants[0].status, 'active');
});

test('regression: expired grant is strictly denied even when on-chain consent remains active', async t => {
  const f = await fixture(t, { onChainAllowed: true });

  // Patient granted 5 minutes in the past (expired 5 minutes ago)
  const pastTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  f.expiryStore.saveGrant({
    patientAddress: patient,
    doctorAddress: doctor,
    durationMinutes: 5,
    grantedAt: pastTime,
  });

  // On-chain consent is active
  assert.equal(f.state.onChainAllowed, true);

  // 1. GET /records/view/:recordId must return 403 and never return decrypted bytes
  const viewRes = await f.call('/records/view/rec1', doctor);
  assert.equal(viewRes.status, 403);
  const viewText = await viewRes.text();
  assert.match(viewText, /Access denied/);
  assert.ok(!viewText.includes('Synthetic original'), 'must never release decrypted PDF when expired');

  // 2. GET /records/doctor must exclude patient records
  const docHistory = await (await f.call('/records/doctor', doctor)).json();
  assert.deepEqual(docHistory.records, []);

  // 3. GET /records/check/:patientAddress must report hasAccess: false and status: expired
  const checkRes = await (await f.call(`/records/check/${patient}`, doctor)).json();
  assert.equal(checkRes.hasAccess, false);
  assert.equal(checkRes.status, 'expired');

  // 4. Missing expiry grant must also deny
  const checkMissing = await (await f.call(`/records/check/${otherPatient}`, doctor)).json();
  assert.equal(checkMissing.hasAccess, false);
});


// These fixtures use only temporary metadata/ciphertext/consent files and mocked RPC.
for (const outcome of ['expired', 'revoked']) {
  for (const route of ['/records/view/rec1', '/records/check/' + patient]) {
    test('viewer authorization rechecks ' + outcome + ' consent after RPC: ' + route, async t => {
      const f = await fixture(t);
      f.expiryStore.saveGrant({ patientAddress: patient, doctorAddress: doctor, durationMinutes: 15 });
      const metadataBefore = fs.readFileSync(f.recordsFile, 'utf8');
      f.state.duringCheck = () => {
        if (outcome === 'revoked') f.expiryStore.revoke(patient, doctor);
        else f.expiryStore.saveGrant({ patientAddress: patient, doctorAddress: doctor, durationMinutes: 5,
          grantedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
      };
      const response = await f.call(route, doctor);
      if (route.includes('/view/')) {
        assert.equal(response.status, 403);
        assert.ok(!(await response.text()).includes('Synthetic original'));
      } else {
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.hasAccess, false);
        assert.equal(result.status, outcome);
      }
      assert.ok(!f.state.events.some(event => event.action === 'RecordServed'));
      assert.equal(fs.readFileSync(f.recordsFile, 'utf8'), metadataBefore);
    });
  }
}

for (const route of ['/records/view/rec1', '/records/check/' + patient]) {
  test('viewer authorization rejects a JWT that expires during RPC: ' + route, async t => {
    const f = await fixture(t);
    f.expiryStore.saveGrant({ patientAddress: patient, doctorAddress: doctor, durationMinutes: 60 });
    const later = Date.now() + 20 * 60 * 1000;
    f.state.duringCheck = () => t.mock.method(Date, 'now', () => later);
    const response = await f.call(route, doctor);
    t.mock.restoreAll();
    assert.equal(response.status, 401);
    assert.ok(!(await response.text()).includes('Synthetic original'));
    assert.ok(!f.state.events.some(event => event.action === 'RecordServed'));
  });

  test('viewer authorization times out an unresolved RPC safely: ' + route, async t => {
    const f = await fixture(t, { consentTimeoutMs: 20 });
    f.expiryStore.saveGrant({ patientAddress: patient, doctorAddress: doctor, durationMinutes: 15 });
    const expiryBefore = fs.readFileSync(f.expiryFile, 'utf8');
    const metadataBefore = fs.readFileSync(f.recordsFile, 'utf8');
    f.state.duringCheck = () => new Promise(() => {});
    const response = await f.call(route, doctor);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.ok(!body.includes('Synthetic original'));
    assert.ok(!body.includes('synthetic on-chain RPC failure'));
    assert.ok(!f.state.events.some(event => event.action === 'RecordServed'));
    assert.equal(fs.readFileSync(f.expiryFile, 'utf8'), expiryBefore);
    assert.equal(fs.readFileSync(f.recordsFile, 'utf8'), metadataBefore);
  });

  test('viewer authorization handles unavailable consent storage: ' + route, async t => {
    const f = await fixture(t, { expiryStoreOverride: {
      getActiveGrant() { throw new Error('synthetic private storage detail'); },
    } });
    const response = await f.call(route, doctor);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.ok(!body.includes('synthetic private storage detail'));
    assert.ok(!body.includes('Synthetic original'));
    assert.equal(f.state.checks.length, 0);
  });
}

test('authorized viewer preflight and original PDF delivery preserve isolated metadata and grants', async t => {
  const f = await fixture(t);
  f.expiryStore.saveGrant({ patientAddress: patient, doctorAddress: doctor, durationMinutes: 15 });
  const expiryBefore = fs.readFileSync(f.expiryFile, 'utf8');
  const metadataBefore = fs.readFileSync(f.recordsFile, 'utf8');
  const preflight = await f.call('/records/check/' + patient, doctor);
  assert.equal(preflight.status, 200);
  assert.equal((await preflight.json()).hasAccess, true);
  const response = await f.call('/records/view/rec1', doctor);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/pdf/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), originalPdf);
  assert.equal(fs.readFileSync(f.expiryFile, 'utf8'), expiryBefore);
  assert.equal(fs.readFileSync(f.recordsFile, 'utf8'), metadataBefore);
});
