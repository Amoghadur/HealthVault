import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createUploadAuthorization, encryptedFilesOnly } from '../middleware/recordAccess.js';

const patient = '0x0000000000000000000000000000000000000001';
const doctor = '0x0000000000000000000000000000000000000002';
test('revoked uploads are rejected server-side and temporary plaintext is removed', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-record-access-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'temporary.pdf');
  const events = [];
  let allowed = true, available = true, nextCalls = 0;
  const middleware = createUploadAuthorization({ hasAccess: async () => { if (!available) throw Error('offline'); return allowed; }, audit: e => events.push(e) });
  const req = { user: { address: doctor }, body: { patientAddress: patient }, file: { path: file } };
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  fs.writeFileSync(file, 'synthetic plaintext');
  await middleware(req, res, () => nextCalls++);
  assert.equal(nextCalls, 1);
  allowed = false;
  await middleware(req, res, () => nextCalls++);
  assert.equal(res.code, 403); assert.equal(nextCalls, 1); assert.equal(fs.existsSync(file), false);
  assert.equal(events[0].action, 'RecordUploadDenied');
  available = false; fs.writeFileSync(file, 'synthetic plaintext');
  await middleware(req, res, () => nextCalls++);
  assert.equal(res.code, 503); assert.equal(fs.existsSync(file), false);
  req.user.address = patient;
  await middleware(req, res, () => nextCalls++);
  assert.equal(nextCalls, 2);
  req.body.patientAddress = 'invalid'; fs.writeFileSync(file, 'synthetic plaintext');
  await middleware(req, res, () => nextCalls++);
  assert.equal(res.code, 400); assert.equal(fs.existsSync(file), false);
});

test('public file route blocks metadata, encoded paths and directories while preserving encrypted blobs', async t => {
  const app = express(); app.use('/files', encryptedFilesOnly, (req, res) => res.send('synthetic encrypted blob'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/files`;
  for (const route of ['/records_metadata.json', '/%72ecords_metadata.json', '/', '/enc_fake%2Frecords_metadata.json']) assert.equal((await fetch(base + route)).status, 404);
  assert.equal((await fetch(base + '/enc_123_report.pdf')).status, 200);
});
