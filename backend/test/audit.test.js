import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createAuditStore } from '../services/auditStore.js';
import { createBlockchainReader, eventInterface } from '../services/blockchain.js';
import { createAuditRouter } from '../routes/audit.js';

const patient = '0x0000000000000000000000000000000000000001';
const doctor = '0x0000000000000000000000000000000000000002';
const stranger = '0x0000000000000000000000000000000000000003';
const contract = '0x0000000000000000000000000000000000000004';
const blockHash = '0x' + '11'.repeat(32);
function log(name, args, index = 0) {
  return { ...eventInterface.encodeEventLog(eventInterface.getEvent(name), args), address: contract, blockNumber: 100, blockHash, transactionHash: '0x' + '22'.repeat(32), index };
}
function provider(logs) {
  return { getNetwork: async () => ({ chainId: 11155111n }), getCode: async () => '0xab', getBlockNumber: async () => 102,
    getLogs: async () => logs, getBlock: async () => ({ timestamp: 1700000000, hash: blockHash }), getTransaction: async () => ({ from: doctor }),
    getTransactionReceipt: async hash => ({ hash, blockHash, blockNumber: 100, status: 1 }) };
}

test('audit persists across store instances, scopes wallets, and excludes secret fields', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'audit.jsonl');
  const first = createAuditStore(file);
  first.append({ action: 'RecordStored', actor: doctor, patient, recordId: '42', encryptionKey: 'must-not-persist', token: 'must-not-persist' });
  const second = createAuditStore(file);
  assert.equal(second.read(patient).length, 1);
  assert.equal(second.read(doctor).length, 1);
  assert.equal(second.read(stranger).length, 0);
  assert.equal(fs.readFileSync(file, 'utf8').includes('must-not-persist'), false);
  fs.appendFileSync(file, 'corrupt\n');
  assert.throws(() => second.read(patient));
});

test('decodes real-format upload/grant/revoke logs with block time and transaction actor', async () => {
  const logs = [log('RecordUploaded', [patient, 'cid']), log('AccessGranted', [patient, doctor], 1), log('AccessRevoked', [patient, doctor], 2)];
  const reader = createBlockchainReader({ provider: provider(logs), address: contract, expectedRuntime: '0xab' });
  const result = await reader.read({ wallet: doctor });
  assert.equal(result.events.length, 3);
  assert.equal(result.events[0].actor, doctor);
  assert.equal(result.events[0].timestamp, '2023-11-14T22:13:20.000Z');
  assert.equal(result.events[2].action, 'AccessRevoked');
  assert.ok(result.events.every(event => event.transactionStatus === 'success'));
  assert.equal(JSON.stringify(result.events).includes('cid'), false);
  assert.equal((await reader.read({ wallet: stranger })).events.length, 0);
});

test('missing or unavailable receipts leave transaction status unknown', async () => {
  for (const getTransactionReceipt of [async () => null, async () => { throw Error('RPC unavailable'); }]) {
    const reader = createBlockchainReader({ provider: { ...provider([log('AccessGranted', [patient, doctor])]), getTransactionReceipt }, address: contract, expectedRuntime: '0xab' });
    const { events } = await reader.read({ wallet: patient });
    assert.equal(events.length, 1);
    assert.equal(events[0].transactionStatus, 'unknown');
  }
});

test('reverted or mismatched receipts cannot verify an emitted event', async () => {
  for (const change of [{ status: 0 }, { hash: 'different' }, { blockHash: 'different' }, { blockNumber: 101 }]) {
    const p = provider([log('AccessGranted', [patient, doctor])]);
    p.getTransactionReceipt = async hash => ({ hash, blockHash, blockNumber: 100, status: 1, ...change });
    const reader = createBlockchainReader({ provider: p, address: contract, expectedRuntime: '0xab' });
    await assert.rejects(reader.read({ wallet: patient }), /receipt does not match/);
  }
});

test('removed logs are omitted and each transaction receipt is fetched once per read', async () => {
  const p = provider([log('AccessGranted', [patient, doctor]), log('AccessRevoked', [patient, doctor], 1), { ...log('AccessGranted', [patient, doctor], 2), removed: true }]);
  let calls = 0;
  p.getTransactionReceipt = async hash => { calls++; return { hash, blockHash, blockNumber: 100, status: 1 }; };
  const reader = createBlockchainReader({ provider: p, address: contract, expectedRuntime: '0xab' });
  assert.equal((await reader.read({ wallet: patient })).events.length, 2);
  assert.equal(calls, 1);
});

test('wrong network, bytecode mismatch, reorganization and RPC failures never produce fake events', async () => {
  for (const change of [
    { getNetwork: async () => ({ chainId: 1n }) }, { getCode: async () => '0x' },
    { getLogs: async () => { throw new Error('RPC offline'); } },
    { getBlock: async () => ({ timestamp: 1, hash: 'different' }) },
  ]) {
    const reader = createBlockchainReader({ provider: { ...provider([log('AccessGranted', [patient, doctor])]), ...change }, address: contract, expectedRuntime: '0xab' });
    await assert.rejects(reader.read({ wallet: patient }));
  }
});

test('RPC block range limits are split; unrelated failures are not retried', async () => {
  const ranges = [];
  const p = provider([]);
  p.getLogs = async ({ fromBlock, toBlock }) => { ranges.push([fromBlock, toBlock]); if (toBlock - fromBlock > 9) throw Error('block range limit'); return []; };
  const reader = createBlockchainReader({ provider: p, address: contract, expectedRuntime: '0xab' });
  await reader.read({ wallet: patient, fromBlock: 80, toBlock: 100 });
  assert.ok(ranges.length > 1);
});

test('audit API reports partial failure, ignores requested wallet, and rejects invalid ranges', async t => {
  const app = express();
  let readWallet;
  app.use('/audit', createAuditRouter({
    auth: (req, res, next) => { req.user = { address: patient }; next(); },
    store: { read: wallet => { readWallet = wallet; return []; } },
    getReader: () => ({ read: async () => { throw Error('RPC URL with private credential'); } }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/audit`;
  const data = await (await fetch(url + '?wallet=' + stranger)).json();
  assert.equal(readWallet, patient);
  assert.equal(data.events.length, 0);
  assert.equal(data.warnings.length, 1);
  assert.equal(JSON.stringify(data).includes('credential'), false);
  assert.equal((await fetch(url + '?toBlock=-1')).status, 400);
  assert.equal((await fetch(url + '?fromBlock=0&toBlock=99999')).status, 400);
});
