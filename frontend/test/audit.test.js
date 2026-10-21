import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAuditEvents, localDate, transactionUrl } from '../src/lib/audit.js';

test('only a complete on-chain transaction hash produces a Sepolia link', () => {
  const hash = '0x' + 'ab'.repeat(32);
  assert.equal(transactionUrl({ source: 'blockchain', transactionHash: hash }), `https://sepolia.etherscan.io/tx/${hash}`);
  for (const transactionHash of [undefined, '', '0x123', 'javascript:alert(1)', hash + '/extra']) {
    assert.equal(transactionUrl({ source: 'blockchain', transactionHash }), null);
  }
  assert.equal(transactionUrl({ source: 'backend', transactionHash: hash }), null);
});

test('wallet, date, action, source and search filters combine without changing the history', () => {
  const events = [
    { id: '1', source: 'blockchain', action: 'AccessGranted', actor: '0xABC', patient: '0xABC', doctor: '0xDEF', timestamp: new Date(2026, 9, 10, 12).toISOString(), transactionHash: '0x123' },
    { id: '2', source: 'backend', action: 'RecordServed', patient: '0xABC', timestamp: new Date(2026, 9, 11, 12).toISOString() },
  ];
  assert.deepEqual(filterAuditEvents(events, { wallet: ' 0xdef ', date: '2026-10-10', action: 'AccessGranted', source: 'blockchain', query: ' GRANTED ' }).map(e => e.id), ['1']);
  assert.equal(filterAuditEvents(events, { wallet: '0x111' }).length, 0);
  assert.equal(filterAuditEvents(events, { query: '0x123' }).length, 1);
  assert.equal(filterAuditEvents(events, { source: 'backend', date: '2026-10-10' }).length, 0);
  assert.equal(filterAuditEvents(events).length, 2);
  assert.equal(events.length, 2);
});

test('date filtering uses local calendar dates and never substitutes a missing timestamp', () => {
  assert.equal(localDate(new Date(2026, 0, 2, 0, 1).toISOString()), '2026-01-02');
  assert.equal(localDate(undefined), '');
  assert.equal(localDate('invalid'), '');
});
