import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createProfileRouter } from '../routes/profiles.js';
import { createDoctorProfileStore } from '../services/doctorProfileStore.js';

process.env.JWT_SECRET = 'synthetic-profile-test-secret-at-least-32-chars';
const doctor = '0x00000000000000000000000000000000000000ab';
const other = '0x0000000000000000000000000000000000000002';
const fields = { displayName: ' Test Doctor ', specialty: 'Cardiology', affiliation: 'Test Clinic', department: 'Medicine', registrationNumber: 'SELF-123' };

async function fixture(t, override) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-profiles-'));
  const file = path.join(dir, 'profiles.json');
  const store = createDoctorProfileStore(file);
  const app = express(); app.use(express.json()); app.use('/profiles', createProfileRouter({ store: override || store }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true }); });
  const call = (address = doctor, body, extra = {}) => fetch(`http://127.0.0.1:${server.address().port}/profiles/me${extra.query || ''}`, {
    method: body === undefined ? 'GET' : 'PUT',
    headers: { 'Content-Type': 'application/json', ...(address ? { Authorization: `Bearer ${jwt.sign({ address }, process.env.JWT_SECRET, { expiresIn: extra.expired ? -1 : 300 })}` } : {}), ...extra.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { file, dir, store, call };
}

test('profiles bind ownership to JWT, normalize wallets, persist and isolate updates', async t => {
  const f = await fixture(t);
  assert.equal((await f.call(null)).status, 401);
  assert.equal((await f.call(null, fields)).status, 401);
  assert.equal((await f.call(doctor, undefined, { expired: true })).status, 401);
  assert.equal((await f.call('not-a-wallet')).status, 401);
  assert.equal((await f.call(null, undefined, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
  assert.deepEqual(await (await f.call()).json(), { profile: null });
  assert.equal(fs.existsSync(f.file), false, 'read must not create storage');
  const saved = await f.call(doctor.toUpperCase().replace('0X', '0x'), fields, { query: `?walletAddress=${other}`, headers: { 'X-Wallet-Address': other, 'X-Role': 'admin' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('cache-control'), 'no-store');
  const { profile } = await saved.json();
  assert.equal(profile.walletAddress, doctor);
  assert.equal(profile.displayName, 'Test Doctor');
  assert.equal(profile.verificationStatus, 'unverified');
  assert.deepEqual(createDoctorProfileStore(f.file).get(doctor), profile);
  assert.deepEqual(await (await f.call(other)).json(), { profile: null });
  await f.call(other, { ...fields, displayName: 'Other doctor' });
  const updated = await (await f.call(doctor, { displayName: 'Updated', specialty: 'Surgery', affiliation: 'Another Clinic' })).json();
  assert.equal(updated.profile.createdAt, profile.createdAt);
  assert.equal(updated.profile.department, '');
  assert.equal(updated.profile.registrationNumber, '');
  assert.equal(f.store.get(other).displayName, 'Other doctor');
  assert.deepEqual(fs.readdirSync(f.dir), ['profiles.json']);
});

test('invalid fields and ownership, timestamp or verification spoofing cannot alter a profile', async t => {
  const f = await fixture(t);
  f.store.save(doctor, fields);
  const before = fs.readFileSync(f.file, 'utf8');
  const invalid = [null, [], {}, { ...fields, displayName: '  ' }, { ...fields, specialty: 42 }, { ...fields, affiliation: 'x'.repeat(201) }, { ...fields, department: null }, { ...fields, registrationNumber: 'x'.repeat(101) }, { ...fields, displayName: 'bad\nname' }];
  for (const key of ['walletAddress', 'doctorAddress', 'verificationStatus', 'verified', 'createdAt', 'updatedAt', 'unexpected', '__proto__']) invalid.push({ ...fields, [key]: 'spoofed' });
  for (const body of invalid) assert.equal((await f.call(doctor, body)).status, 400, JSON.stringify(body));
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});

test('corrupt storage fails closed and is never replaced by a save', async t => {
  const f = await fixture(t);
  const good = f.store.save(doctor, fields);
  for (const raw of ['invalid', '{}', JSON.stringify([good, good]), JSON.stringify([{ ...good, verificationStatus: 'verified' }]), JSON.stringify([{ ...good, createdAt: 'bad' }]), JSON.stringify([{ ...good, secret: 'unexpected' }])]) {
    fs.writeFileSync(f.file, raw);
    assert.equal((await f.call()).status, 503);
    assert.equal((await f.call(doctor, fields)).status, 503);
    assert.equal(fs.readFileSync(f.file, 'utf8'), raw);
  }
});

test('failed atomic replacement preserves the previous profile and removes temporary files', async t => {
  const f = await fixture(t);
  f.store.save(doctor, fields);
  const before = fs.readFileSync(f.file, 'utf8');
  t.mock.method(fs, 'renameSync', () => { throw new Error('synthetic rename failure'); });
  assert.equal((await f.call(doctor, { ...fields, displayName: 'Must not persist' })).status, 503);
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(f.dir), ['profiles.json']);
});

test('unavailable reads and writes return safe errors without internal paths', async t => {
  const f = await fixture(t, { get() { throw Error('secret storage path'); }, save() { throw Error('secret storage path'); } });
  for (const response of [await f.call(), await f.call(doctor, fields)]) {
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('secret storage path'));
  }
});
