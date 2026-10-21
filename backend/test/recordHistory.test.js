import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createRecordRouter } from '../routes/records.js';

// Node runs test files in separate processes. These never change any .env file.
process.env.JWT_SECRET = 'synthetic-record-history-test-secret';
process.env.RECORD_ENCRYPTION_KEY = 'ab'.repeat(32);
const patient = '0x0000000000000000000000000000000000000001';
const doctor = '0x00000000000000000000000000000000000000ab';
const otherDoctor = '0x0000000000000000000000000000000000000003';
const otherPatient = '0x0000000000000000000000000000000000000004';
const original = Buffer.from('%PDF-1.4\nSynthetic original prescription\n%%EOF');

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-record-history-'));
  const file = path.join(dir, 'records_metadata.json');
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(original), cipher.final()]);
  fs.writeFileSync(path.join(dir, 'enc_synthetic.pdf'), encrypted);
  const common = {
    fileName: 'prescription.pdf', patientAddress: patient, doctorAddress: doctor.toUpperCase(),
    doctorName: 'Synthetic display name', ipfsHash: 'synthetic-cid',
    uploadedAt: '2026-01-01T00:00:00.000Z', fileType: 'application/pdf',
    encryptedFileName: 'enc_synthetic.pdf', encryptionKey: key.toString('hex'),
    iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'),
    internalSecret: 'must-not-leak',
  };
  const records = [
    { ...common, id: 'rx', recordType: 'prescription' },
    { ...common, id: 'legacy' }, // A prescription filename must never imply a category.
    { ...common, id: 'report', recordType: 'report', uploadedAt: '2026-02-01T00:00:00.000Z' },
    { ...common, id: 'other', doctorAddress: otherDoctor, recordType: 'prescription' },
    { ...common, id: 'revoked', patientAddress: otherPatient, recordType: 'prescription' },
  ];
  const write = value => fs.writeFileSync(file, JSON.stringify(value));
  write(records);
  const state = { allowed: true, unavailable: false, checks: [], events: [], pins: [], duringCheck: null };
  const app = express();
  app.use('/records', createRecordRouter({
    uploadsDir: dir,
    hasAccess: async (target, actor) => {
      state.checks.push([target, actor]);
      if (state.duringCheck) await state.duringCheck();
      if (state.unavailable) throw Error('synthetic RPC failure');
      return state.allowed && target === patient;
    },
    audit: event => state.events.push(event),
    pinFile: async (bytes, name) => { state.pins.push({ bytes, name }); return 'synthetic-upload-cid'; },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    // The exact directory was created above under the OS temporary directory.
    fs.rmSync(dir, { recursive: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/records`;
  const token = address => jwt.sign({ address }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const call = (route, address = doctor, options = {}) => fetch(base + route, {
    ...options, headers: { ...(address ? { Authorization: `Bearer ${token(address)}` } : {}), ...options.headers },
  });
  return { dir, file, records, write, state, call, token };
}

test('history authenticates, isolates JWT uploader, redacts metadata, and preserves legacy classification', async t => {
  const f = await fixture(t);
  const before = fs.readFileSync(f.file, 'utf8');
  assert.equal((await f.call('/doctor', null)).status, 401);
  assert.equal((await f.call('/doctor', null, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
  const response = await f.call(`/doctor?doctorAddress=${otherDoctor}&recordType=prescription`, doctor, { headers: { 'X-Doctor-Address': otherDoctor } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { records } = await response.json();
  assert.deepEqual(records.map(r => r.id), ['report', 'rx', 'legacy']);
  assert.equal(records.find(r => r.id === 'legacy').recordType, 'unspecified');
  assert.equal(records.find(r => r.id === 'rx').recordType, 'prescription');
  const safeKeys = ['doctorAddress', 'fileName', 'fileType', 'id', 'ipfsHash', 'patientAddress', 'recordType', 'uploadedAt'].sort();
  for (const record of records) assert.deepEqual(Object.keys(record).sort(), safeKeys);
  assert.deepEqual(f.state.checks, [[patient, doctor], [otherPatient, doctor]]);
  assert.deepEqual((await (await f.call('/doctor', otherDoctor)).json()).records.map(r => r.id), ['other']);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before, 'read APIs must not rewrite legacy metadata');
});

test('patient metadata remains JWT-scoped, adds only safe filter fields, and never needs file decryption', async t => {
  const f = await fixture(t);
  const before = fs.readFileSync(f.file, 'utf8');
  // Listing still works without encrypted contents or a working consent RPC.
  fs.unlinkSync(path.join(f.dir, 'enc_synthetic.pdf'));
  f.state.unavailable = true;
  assert.equal((await f.call('/patient', null)).status, 401);
  assert.equal((await f.call('/patient', null, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
  const response = await f.call(`/patient?patientAddress=${otherPatient}&doctorAddress=${otherDoctor}`, patient);
  assert.equal(response.status, 200);
  const { records: listed } = await response.json();
  assert.deepEqual(listed.map(r => r.id), ['rx', 'legacy', 'report', 'other']);
  const safeKeys = ['id', 'fileName', 'doctorName', 'doctorAddress', 'recordType', 'ipfsHash', 'uploadedAt'].sort();
  for (const record of listed) assert.deepEqual(Object.keys(record).sort(), safeKeys);
  assert.equal(listed.find(r => r.id === 'rx').doctorAddress, doctor);
  assert.equal(listed.find(r => r.id === 'other').doctorAddress, otherDoctor);
  assert.equal(listed.find(r => r.id === 'legacy').recordType, 'unspecified');
  assert.equal(listed.find(r => r.id === 'report').recordType, 'report');
  assert.deepEqual((await (await f.call('/patient', doctor)).json()).records, []);
  assert.deepEqual((await (await f.call('/patient', otherPatient)).json()).records.map(r => r.id), ['revoked']);
  assert.deepEqual(f.state.checks, []);
  assert.deepEqual(f.state.events, []);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});

test('doctor viewing decrypts the original, rejects another uploader, and rechecks revoked consent', async t => {
  const f = await fixture(t);
  const allowed = await f.call('/view/rx');
  assert.equal(allowed.status, 200);
  assert.match(allowed.headers.get('content-type'), /application\/pdf/);
  assert.equal(allowed.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await allowed.arrayBuffer()), original);
  assert.ok(f.state.events.some(e => e.action === 'RecordServed' && e.actor === doctor));
  const checks = f.state.checks.length;
  assert.equal((await f.call('/view/other')).status, 403);
  assert.equal(f.state.checks.length, checks, 'another uploader is rejected without consulting consent');
  f.state.allowed = false;
  assert.deepEqual((await (await f.call('/doctor')).json()).records, []);
  assert.equal((await f.call('/view/rx')).status, 403);
  assert.ok(f.state.events.some(e => e.action === 'RecordAccessDenied' && e.recordId === 'rx'));
  f.state.allowed = true;
  assert.equal((await f.call('/view/legacy')).status, 200);
  assert.equal((await f.call('/view/report')).status, 200);
});

test('consent failures disclose neither partial history nor decrypted content', async t => {
  const f = await fixture(t);
  f.state.duringCheck = () => { if (f.state.checks.length === 2) f.state.unavailable = true; };
  const history = await f.call('/doctor');
  assert.equal(history.status, 503);
  assert.deepEqual(Object.keys(await history.json()), ['error']);
  const view = await f.call('/view/rx');
  assert.equal(view.status, 503);
  assert.ok(!(await view.text()).includes('Synthetic original'));
  assert.ok(f.state.events.some(e => e.action === 'RecordAccessDenied' && e.outcome === 'consent-unavailable'));
  assert.ok(!f.state.events.some(e => e.action === 'RecordServed'));
});

test('patient viewing retains header access and rejects query token even when RPC is unavailable', async t => {
  const f = await fixture(t);
  f.state.unavailable = true;
  for (const route of ['/view/rx', '/view/legacy']) {
    const response = await f.call(route, patient);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
  }
  assert.deepEqual(f.state.checks, []);
  assert.equal((await f.call('/view/rx', null)).status, 401);
  assert.equal((await f.call(`/view/legacy?token=${f.token(patient)}`, null)).status, 401);
  assert.equal((await f.call('/view/rx?token=invalid', null)).status, 401);
  assert.equal((await f.call('/view/rx', otherPatient)).status, 403);
  assert.equal((await f.call('/view/missing', patient)).status, 404);
  assert.equal(f.state.events.filter(e => e.action === 'RecordServed' && e.actor === patient).length, 2);
});

test('history reads fresh storage and viewing cannot serve a record removed during consent checking', async t => {
  const f = await fixture(t);
  f.write(f.records.filter(r => r.id !== 'legacy'));
  assert.ok(!(await (await f.call('/doctor')).json()).records.some(r => r.id === 'legacy'));
  f.state.duringCheck = () => f.write([]);
  assert.equal((await f.call('/view/rx')).status, 404);
  fs.writeFileSync(f.file, '{invalid');
  assert.equal((await f.call('/doctor')).status, 500);
  assert.equal((await f.call('/view/rx', patient)).status, 500);
});

test('synthetic uploads persist explicit types, accept unclassified legacy clients, and reject invalid types', async t => {
  const f = await fixture(t);
  for (const type of ['prescription', 'report', undefined]) {
    const body = new FormData();
    body.append('file', new Blob([original], { type: 'application/pdf' }), 'synthetic.pdf');
    body.append('patientAddress', patient);
    body.append('doctorAddress', otherDoctor);
    if (type !== undefined) body.append('recordType', type);
    const response = await f.call('/upload', doctor, { method: 'POST', body });
    assert.equal(response.status, 200);
    const result = await response.json();
    const stored = JSON.parse(fs.readFileSync(f.file, 'utf8')).find(r => r.id === result.recordId);
    assert.equal(stored.recordType, type || 'unspecified');
    assert.equal(stored.doctorAddress, doctor);
    assert.equal(stored.patientAddress, patient);
    assert.equal(result.encryptionKey, undefined);
    assert.ok(!f.state.pins.at(-1).bytes.equals(original), 'Pinata stub receives encrypted bytes only');
  }
  const before = fs.readFileSync(f.file, 'utf8');
  const files = fs.readdirSync(f.dir).sort();
  const body = new FormData();
  body.append('file', new Blob([original], { type: 'application/pdf' }), 'invalid.pdf');
  body.append('patientAddress', patient);
  body.append('recordType', 'inferred-prescription');
  assert.equal((await f.call('/upload', doctor, { method: 'POST', body })).status, 400);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(f.dir).sort(), files, 'invalid upload plaintext is removed');
  assert.equal(f.state.pins.length, 3);
  assert.equal(f.state.events.filter(e => e.action === 'RecordStored').length, 3);
});
