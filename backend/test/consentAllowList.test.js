import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createConsentRouter } from '../routes/consent.js';
import { createRecordRouter } from '../routes/records.js';
import { createConsentExpiryStore } from '../services/consentExpiryStore.js';
import { createConsentAllowListStore } from '../services/consentAllowListStore.js';

const TEST_JWT_SECRET = 'allow-list-test-jwt-secret-at-least-32-chars';
process.env.JWT_SECRET = TEST_JWT_SECRET;

const patientA = '0xaaaa111111111111111111111111111111111111';
const patientB = '0xbbbb222222222222222222222222222222222222';
const doctorWallet = '0xdddd333333333333333333333333333333333333';
const pdfBytes = Buffer.from('%PDF-1.4\nTest Patient PDF Document\n%%EOF');

function signToken(address) {
  return jwt.sign({ address }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

async function setupTestApp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-allowlist-test-'));
  const recordsFile = path.join(dir, 'records_metadata.json');
  const expiryFile = path.join(dir, 'consent_expiries.json');
  const allowListFile = path.join(dir, 'consent_allow_lists.json');

  const expiryStore = createConsentExpiryStore(expiryFile);
  const allowListStore = createConsentAllowListStore(allowListFile);

  // Encrypt sample PDFs
  function createEncryptedPdf(filename) {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(pdfBytes), cipher.final()]);
    const encName = `enc_${filename}`;
    fs.writeFileSync(path.join(dir, encName), enc);
    return { encName, keyHex: key.toString('hex'), ivHex: iv.toString('hex'), tagHex: cipher.getAuthTag().toString('hex') };
  }

  const p1 = createEncryptedPdf('report1.pdf');
  const p2 = createEncryptedPdf('report2.pdf');
  const p3 = createEncryptedPdf('report3.pdf');
  const pB = createEncryptedPdf('patientB_report.pdf');
  const pDoc = createEncryptedPdf('doctor_upload.pdf');

  const records = [
    {
      id: 'rec-1', fileName: 'report1.pdf', encryptedFileName: p1.encName,
      patientAddress: patientA, doctorAddress: '', doctorName: 'Clinic',
      encryptionKey: p1.keyHex, iv: p1.ivHex, tag: p1.tagHex, uploadedAt: '2026-03-01T10:00:00.000Z'
    },
    {
      id: 'rec-2', fileName: 'report2.pdf', encryptedFileName: p2.encName,
      patientAddress: patientA, doctorAddress: '', doctorName: 'Clinic',
      encryptionKey: p2.keyHex, iv: p2.ivHex, tag: p2.tagHex, uploadedAt: '2026-03-02T10:00:00.000Z'
    },
    {
      id: 'rec-3', fileName: 'report3.pdf', encryptedFileName: p3.encName,
      patientAddress: patientA, doctorAddress: '', doctorName: 'Clinic',
      encryptionKey: p3.keyHex, iv: p3.ivHex, tag: p3.tagHex, uploadedAt: '2026-03-03T10:00:00.000Z'
    },
    {
      id: 'rec-patient-b', fileName: 'patientB_report.pdf', encryptedFileName: pB.encName,
      patientAddress: patientB, doctorAddress: '', doctorName: 'Clinic',
      encryptionKey: pB.keyHex, iv: pB.ivHex, tag: pB.tagHex, uploadedAt: '2026-03-04T10:00:00.000Z'
    },
    {
      id: 'rec-doctor-upload', fileName: 'doctor_upload.pdf', encryptedFileName: pDoc.encName,
      patientAddress: patientA, doctorAddress: doctorWallet, doctorName: 'Dr. Test',
      encryptionKey: pDoc.keyHex, iv: pDoc.ivHex, tag: pDoc.tagHex, uploadedAt: '2026-03-05T10:00:00.000Z'
    }
  ];
  fs.writeFileSync(recordsFile, JSON.stringify(records));

  const state = { onChainAccess: true, events: [] };
  const app = express();
  app.use(express.json());

  app.use('/consent', createConsentRouter({
    expiryStore,
    allowListStore,
    hasAccess: async () => state.onChainAccess,
    recordsFilePath: recordsFile,
    audit: (evt) => state.events.push(evt)
  }));

  app.use('/records', createRecordRouter({
    uploadsDir: dir,
    expiryStore,
    allowListStore,
    hasAccess: async () => state.onChainAccess,
    audit: (evt) => state.events.push(evt)
  }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;

  function req(endpoint, callerAddress, options = {}) {
    const headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${signToken(callerAddress)}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    };
    return fetch(`${base}${endpoint}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  }

  return { req, expiryStore, allowListStore, state, recordsFile };
}

test('allow-list: doctor cannot list or view records not on allow-list, but can view allow-listed records and own uploads', async t => {
  const f = await setupTestApp(t);

  // 1. Patient A grants access to doctor with ONLY rec-1
  const grantRes = await f.req('/consent/grant', patientA, {
    method: 'POST',
    body: { doctorAddress: doctorWallet, durationMinutes: 30, recordIds: ['rec-1'] }
  });
  assert.equal(grantRes.status, 200);
  const grantData = await grantRes.json();
  assert.deepEqual(grantData.recordIds, ['rec-1']);

  // 2. Doctor queries GET /records/doctor
  const docListRes = await f.req('/records/doctor', doctorWallet);
  assert.equal(docListRes.status, 200);
  const docList = await docListRes.json();
  const visibleIds = docList.records.map(r => r.id);
  // Doctor sees rec-1 (on allow-list) and rec-doctor-upload (own upload), but NOT rec-2 or rec-3
  assert.ok(visibleIds.includes('rec-1'), 'Doctor must see allow-listed rec-1');
  assert.ok(visibleIds.includes('rec-doctor-upload'), 'Doctor must see their own upload');
  assert.ok(!visibleIds.includes('rec-2'), 'Doctor must NOT see unshared rec-2');
  assert.ok(!visibleIds.includes('rec-3'), 'Doctor must NOT see unshared rec-3');

  // 3. Doctor views rec-1 (allowed)
  const view1 = await f.req('/records/view/rec-1', doctorWallet);
  assert.equal(view1.status, 200);
  assert.deepEqual(Buffer.from(await view1.arrayBuffer()), pdfBytes);

  // 4. Doctor views own upload rec-doctor-upload (allowed)
  const viewDoc = await f.req('/records/view/rec-doctor-upload', doctorWallet);
  assert.equal(viewDoc.status, 200);

  // 5. Doctor attempts to view rec-2 (not on allow-list) -> 403
  const view2 = await f.req('/records/view/rec-2', doctorWallet);
  assert.equal(view2.status, 403);

  // 6. Doctor attempts to view rec-3 by guessing ID -> 403
  const view3 = await f.req('/records/view/rec-3', doctorWallet);
  assert.equal(view3.status, 403);
  assert.ok(!(await view3.text()).includes('Test Patient PDF Document'));
});

test('allow-list: changing allow-list takes effect immediately without re-granting', async t => {
  const f = await setupTestApp(t);

  // Initial grant with only rec-1
  await f.req('/consent/grant', patientA, {
    method: 'POST',
    body: { doctorAddress: doctorWallet, durationMinutes: 15, recordIds: ['rec-1'] }
  });

  // Verify rec-2 is forbidden initially
  assert.equal((await f.req('/records/view/rec-2', doctorWallet)).status, 403);

  // Patient adds rec-2 via PUT /consent/allowlist/:doctorAddress
  const updateRes = await f.req(`/consent/allowlist/${doctorWallet}`, patientA, {
    method: 'PUT',
    body: { recordIds: ['rec-1', 'rec-2'] }
  });
  assert.equal(updateRes.status, 200);
  const updatedData = await updateRes.json();
  assert.deepEqual(updatedData.recordIds.sort(), ['rec-1', 'rec-2']);

  // Immediately, doctor can now view rec-2
  const view2After = await f.req('/records/view/rec-2', doctorWallet);
  assert.equal(view2After.status, 200);

  // Patient removes rec-1, sharing only rec-2
  await f.req(`/consent/allowlist/${doctorWallet}`, patientA, {
    method: 'PUT',
    body: { recordIds: ['rec-2'] }
  });

  // Immediately, rec-1 is forbidden and rec-2 is allowed
  assert.equal((await f.req('/records/view/rec-1', doctorWallet)).status, 403);
  assert.equal((await f.req('/records/view/rec-2', doctorWallet)).status, 200);
});

test('allow-list: fail-closed: grant with no allow-list shares NO patient records', async t => {
  const f = await setupTestApp(t);

  // Grant without passing recordIds (or empty array)
  const grantRes = await f.req('/consent/grant', patientA, {
    method: 'POST',
    body: { doctorAddress: doctorWallet, durationMinutes: 15, recordIds: [] }
  });
  assert.equal(grantRes.status, 200);

  // Doctor list excludes patient records, only showing doctor's own upload
  const docList = await (await f.req('/records/doctor', doctorWallet)).json();
  const visibleIds = docList.records.map(r => r.id);
  assert.ok(!visibleIds.includes('rec-1'));
  assert.ok(!visibleIds.includes('rec-2'));
  assert.ok(!visibleIds.includes('rec-3'));
  assert.ok(visibleIds.includes('rec-doctor-upload'));

  // Viewing rec-1 fails closed
  assert.equal((await f.req('/records/view/rec-1', doctorWallet)).status, 403);
});

test('allow-list: expired or revoked grants show nothing even if allow-list has records', async t => {
  const f = await setupTestApp(t);

  // Grant with rec-1 and rec-2
  await f.req('/consent/grant', patientA, {
    method: 'POST',
    body: { doctorAddress: doctorWallet, durationMinutes: 15, recordIds: ['rec-1', 'rec-2'] }
  });

  // Verify access works while active
  assert.equal((await f.req('/records/view/rec-1', doctorWallet)).status, 200);

  // Patient revokes access
  const revokeRes = await f.req('/consent/revoke', patientA, {
    method: 'POST',
    body: { doctorAddress: doctorWallet }
  });
  assert.equal(revokeRes.status, 200);

  // Doctor can no longer list or view anything for patient A
  const listAfterRevoke = await (await f.req('/records/doctor', doctorWallet)).json();
  assert.equal(listAfterRevoke.records.length, 0);
  assert.equal((await f.req('/records/view/rec-1', doctorWallet)).status, 403);
  assert.equal((await f.req('/records/view/rec-2', doctorWallet)).status, 403);
  assert.equal((await f.req('/records/view/rec-doctor-upload', doctorWallet)).status, 403);
});

test('allow-list: patient cannot edit another patient allow-list and cannot inject foreign record IDs', async t => {
  const f = await setupTestApp(t);

  // Patient A grants access to doctor with rec-1
  await f.req('/consent/grant', patientA, {
    method: 'POST',
    body: { doctorAddress: doctorWallet, durationMinutes: 15, recordIds: ['rec-1'] }
  });

  // Patient B attempts to update doctor allow-list without having an active grant for doctor
  const bUpdateWithoutGrant = await f.req(`/consent/allowlist/${doctorWallet}`, patientB, {
    method: 'PUT',
    body: { recordIds: ['rec-patient-b'] }
  });
  assert.equal(bUpdateWithoutGrant.status, 404, 'Must return 404 when patient has no active grant for doctor');

  // Patient B grants access for doctor
  await f.req('/consent/grant', patientB, {
    method: 'POST',
    body: { doctorAddress: doctorWallet, durationMinutes: 15, recordIds: ['rec-patient-b'] }
  });

  // Patient B attempts to share Patient A's record ('rec-1')
  const bInjectedUpdate = await f.req(`/consent/allowlist/${doctorWallet}`, patientB, {
    method: 'PUT',
    body: { recordIds: ['rec-patient-b', 'rec-1', 'rec-2'] }
  });
  assert.equal(bInjectedUpdate.status, 200);
  const bData = await bInjectedUpdate.json();

  // Foreign records rec-1 and rec-2 MUST be stripped/ignored
  assert.deepEqual(bData.recordIds, ['rec-patient-b']);
  assert.ok(!bData.recordIds.includes('rec-1'));
  assert.ok(!bData.recordIds.includes('rec-2'));

  // Patient A's allow-list is unchanged
  const aList = await (await f.req(`/consent/allowlist/${doctorWallet}`, patientA)).json();
  assert.deepEqual(aList.recordIds, ['rec-1']);
});

test('allow-list with mixed-case addresses: doctor-uploaded record never appears in patient-documents list, unshared patient record never appears or opens, shared one does', async t => {
  const f = await setupTestApp(t);

  // Mixed case addresses
  const mixedPatient = '0xAaAa111111111111111111111111111111111111';
  const mixedDoctor = '0xDDDD333333333333333333333333333333333333';

  // Patient A grants access sharing only 'rec-1', attempting to also include doctor's upload 'rec-doctor-upload'
  const grantRes = await f.req('/consent/grant', mixedPatient, {
    method: 'POST',
    body: {
      doctorAddress: mixedDoctor,
      durationMinutes: 15,
      recordIds: ['rec-1', 'rec-doctor-upload']
    }
  });
  assert.equal(grantRes.status, 200);
  const grantData = await grantRes.json();
  // Doctor-uploaded record 'rec-doctor-upload' is rejected from the allow-list (not patient's to share)
  assert.deepEqual(grantData.recordIds, ['rec-1']);
  assert.ok(!grantData.recordIds.includes('rec-doctor-upload'));

  // Doctor queries GET /records/doctor using mixed-case doctor token
  const docListRes = await f.req('/records/doctor', mixedDoctor);
  assert.equal(docListRes.status, 200);
  const docListData = await docListRes.json();
  const returnedRecords = docListData.records;

  // Returned records: rec-1 (on allow-list) and rec-doctor-upload (uploaded by doctor)
  const returnedIds = returnedRecords.map(r => r.id);
  assert.ok(returnedIds.includes('rec-1'), 'Shared patient record rec-1 must appear');
  assert.ok(returnedIds.includes('rec-doctor-upload'), 'Doctor uploaded record must appear');
  assert.ok(!returnedIds.includes('rec-2'), 'Unshared patient record rec-2 must NEVER appear');
  assert.ok(!returnedIds.includes('rec-3'), 'Unshared patient record rec-3 must NEVER appear');

  // Verify doctorAddress is returned on records and normalized
  const docUpload = returnedRecords.find(r => r.id === 'rec-doctor-upload');
  assert.ok(docUpload, 'Doctor upload record present');
  assert.equal(docUpload.doctorAddress, mixedDoctor.toLowerCase());

  // DoctorView separation logic:
  // "Patient Clinical Documents": records where r.patientAddress == patLower AND r.doctorAddress != docLower
  const patLower = mixedPatient.toLowerCase();
  const docLower = mixedDoctor.toLowerCase();
  const patientClinicalDocuments = returnedRecords.filter(r => {
    const rPat = (r.patientAddress || '').toLowerCase();
    const rDoc = (r.doctorAddress || '').toLowerCase();
    if (rPat !== patLower) return false;
    if (docLower && rDoc === docLower) return false;
    return true;
  });

  // Doctor-uploaded record NEVER appears in the patient-documents list!
  assert.equal(patientClinicalDocuments.length, 1);
  assert.equal(patientClinicalDocuments[0].id, 'rec-1');
  assert.ok(!patientClinicalDocuments.some(r => r.id === 'rec-doctor-upload'), 'Doctor uploaded record must NEVER appear in Patient Clinical Documents');

  // Doctor-uploaded records appear ONLY in "My Uploaded Prescriptions & Reports"
  const myUploads = returnedRecords.filter(r => {
    const rDoc = (r.doctorAddress || '').toLowerCase();
    if (!rDoc) return false;
    return docLower ? rDoc === docLower : true;
  });
  assert.equal(myUploads.length, 1);
  assert.equal(myUploads[0].id, 'rec-doctor-upload');

  // File access / opening via GET /records/view/:recordId with mixed-case doctor token:
  // (1) Shared patient record opens successfully (200)
  const viewSharedRes = await f.req('/records/view/rec-1', mixedDoctor);
  assert.equal(viewSharedRes.status, 200, 'Shared patient record opens');

  // (2) Unshared patient records never open (403)
  const viewUnshared2 = await f.req('/records/view/rec-2', mixedDoctor);
  assert.equal(viewUnshared2.status, 403, 'Unshared patient record rec-2 returns 403');
  const viewUnshared3 = await f.req('/records/view/rec-3', mixedDoctor);
  assert.equal(viewUnshared3.status, 403, 'Unshared patient record rec-3 returns 403');

  // (3) Doctor's own upload opens successfully (200)
  const viewDocUpload = await f.req('/records/view/rec-doctor-upload', mixedDoctor);
  assert.equal(viewDocUpload.status, 200, 'Doctor uploaded record opens');
});
