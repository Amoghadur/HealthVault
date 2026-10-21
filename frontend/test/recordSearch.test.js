import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RECORD_FILTERS, filterRecords, recordCategory, searchRecords, sortRecords, validateDateRange } from '../src/lib/recordSearch.js';

const localTime = (day, hour = 12, minute = 0, second = 0, ms = 0) => new Date(2026, 9, day, hour, minute, second, ms).toISOString();
const records = Object.freeze([
  Object.freeze({ id: 'b', fileName: 'Beta Prescription.PDF', recordType: 'prescription', doctorAddress: '0xABC', doctorName: 'Same name', uploadedAt: localTime(12) }),
  Object.freeze({ id: 'a', fileName: 'alpha.pdf', recordType: 'report', doctorAddress: '0xdef', doctorName: 'Same name', uploadedAt: localTime(10) }),
  Object.freeze({ id: 'c', fileName: 'Legacy prescription.pdf', doctorAddress: '0xabc', uploadedAt: localTime(11) }),
]);
const ids = items => items.map(record => record.id);

test('filename, category, wallet and date range combine with AND without mutating metadata', () => {
  const filters = Object.freeze({ query: '  PRESCRIPTION.PDF ', category: 'prescription', doctorAddress: ' 0xaBc ', dateFrom: '2026-10-11', dateTo: '2026-10-12', sort: 'oldest' });
  assert.deepEqual(ids(searchRecords(records, filters)), ['b']);
  for (const override of [{ query: 'absent' }, { category: 'report' }, { doctorAddress: '0xdef' }, { dateTo: '2026-10-11' }]) {
    assert.deepEqual(searchRecords(records, { ...filters, ...override }), []);
  }
  assert.deepEqual(ids(records), ['b', 'a', 'c']);
  assert.deepEqual(ids(searchRecords(records, DEFAULT_RECORD_FILTERS)), ['b', 'c', 'a']);
  assert.notEqual(sortRecords(records), records);
});

test('legacy records stay unspecified and doctor identity uses exact wallets, never names', () => {
  assert.equal(recordCategory(records[2]), 'unspecified');
  assert.deepEqual(ids(filterRecords(records, { category: 'unspecified' })), ['c']);
  assert.deepEqual(ids(filterRecords(records, { doctorAddress: '0xabc' })), ['b', 'c']);
  assert.deepEqual(filterRecords(records, { doctorAddress: 'Same name' }), []);
  assert.deepEqual(filterRecords(records, { doctorAddress: '0xa' }), []);
  assert.deepEqual(filterRecords(records, { query: 'Same name' }), []);
});

test('upload dates include both local calendar days and support one-sided ranges', () => {
  const boundaries = [
    { id: 'before', uploadedAt: localTime(9, 23, 59, 59, 999) },
    { id: 'start', uploadedAt: localTime(10, 0) },
    { id: 'end', uploadedAt: localTime(12, 23, 59, 59, 999) },
    { id: 'after', uploadedAt: localTime(13, 0) },
  ];
  assert.deepEqual(ids(filterRecords(boundaries, { dateFrom: '2026-10-10', dateTo: '2026-10-12' })), ['start', 'end']);
  assert.deepEqual(ids(filterRecords(boundaries, { dateFrom: '2026-10-12' })), ['end', 'after']);
  assert.deepEqual(ids(filterRecords(boundaries, { dateTo: '2026-10-10' })), ['before', 'start']);
});

test('invalid and reversed date ranges are rejected, including impossible calendar dates', () => {
  for (const range of [{ dateFrom: '2026-10-13', dateTo: '2026-10-12' }, { dateFrom: '2026-02-30' }, { dateTo: 'not-a-date' }, { dateFrom: '2026-1-01' }]) {
    assert.ok(validateDateRange(range));
    assert.deepEqual(searchRecords(records, range), []);
  }
  assert.equal(validateDateRange({ dateFrom: '2024-02-29', dateTo: '2024-02-29' }), '');
  assert.equal(validateDateRange(), '');
});

test('missing metadata is safe; unknown dates are excluded by date filters and sorted last', () => {
  const incomplete = [{ id: 'c', uploadedAt: null }, { id: 'b', uploadedAt: 'invalid' }, { id: 'd' }, { id: 'a', uploadedAt: localTime(12) }];
  assert.equal(filterRecords(incomplete).length, 4);
  assert.deepEqual(filterRecords(incomplete, { query: 'pdf' }), []);
  assert.deepEqual(ids(filterRecords(incomplete, { dateFrom: '2026-10-01' })), ['a']);
  for (const sort of ['oldest', 'newest']) assert.deepEqual(ids(sortRecords(incomplete, sort)), ['a', 'b', 'c', 'd']);
});

test('newest, oldest and filename sorting have deterministic ID ties and preserve category grouping order', () => {
  assert.deepEqual(ids(sortRecords(records, 'oldest')), ['a', 'c', 'b']);
  assert.deepEqual(ids(sortRecords(records, 'newest')), ['b', 'c', 'a']);
  assert.deepEqual(ids(sortRecords(records, 'title')), ['a', 'b', 'c']);
  const ties = [{ id: 'z', fileName: 'a.PDF', uploadedAt: localTime(12) }, { id: 'a', fileName: 'A.pdf', uploadedAt: localTime(12) }];
  for (const sort of ['oldest', 'newest', 'title']) assert.deepEqual(ids(sortRecords(ties, sort)), ['a', 'z']);
  const grouped = [...records, { ...records[0], id: 'd', fileName: 'A prescription.pdf', uploadedAt: localTime(9) }];
  assert.deepEqual(ids(searchRecords(grouped, { sort: 'oldest' }).filter(record => recordCategory(record) === 'prescription')), ['d', 'b']);
});
