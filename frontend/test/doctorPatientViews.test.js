import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('DoctorView has no hardcoded patient data and no visible Sepolia references', () => {
  const source = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');

  // BUG 2 checks: No invented patient summary data or static mock clinical documents
  assert.ok(!source.includes('Penicillin'), 'DoctorView must not contain hardcoded Penicillin allergy');
  assert.ok(!source.includes('Type 2 Diabetes'), 'DoctorView must not contain hardcoded Diabetes condition');
  assert.ok(!source.includes('Active on Sepolia'), 'DoctorView must not contain hardcoded Active on Sepolia');
  assert.ok(!source.includes('samplePatients'), 'DoctorView must not contain samplePatients');
  assert.ok(!source.includes('Blood Test Report'), 'DoctorView must not contain static mock documents');
  assert.ok(!source.includes('Unstable Angina'), 'DoctorView must not contain static mock diagnosis');

  // Word "Sepolia" must be removed from visible strings in DoctorView
  assert.ok(!source.includes('Sepolia'), 'DoctorView must have all visible references to Sepolia removed');

  // Friendly empty states when no records or no profile
  assert.ok(source.includes('No clinical documents shared yet'), 'DoctorView must provide friendly empty state for records');
  assert.ok(source.includes('No additional profile fields configured by patient'), 'DoctorView must handle empty profile gracefully');

  // Real data from backend is wired
  assert.ok(source.includes('visiblePatientRecords'), 'DoctorView must display real filtered records');
  assert.ok(source.includes('visiblePatientProfile'), 'DoctorView must display real patient profile fields');
});

test('DoctorRecordHistory renders exactly once and handles loading, error with retry, and empty states', () => {
  const source = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');

  // BUG 3 checks: DoctorRecordHistory appears exactly once in DoctorView
  const matches = source.match(/<DoctorRecordHistory\b/g);
  assert.equal(matches ? matches.length : 0, 1, 'DoctorRecordHistory must be rendered exactly once');

  // Handles loading, empty, and error state with retry button
  assert.ok(source.includes('Loading upload history…'), 'Must show loading indicator');
  assert.ok(source.includes('Retry Loading Records'), 'Must show retry button on error');
  assert.ok(source.includes('No uploaded records currently accessible'), 'Must show empty state when no uploads exist');
  assert.ok(source.includes('fetchHistory'), 'Must expose manual refresh/retry mechanism');
});

test('PatientView uses blob URL record viewer with Authorization header and revokes on close', () => {
  const source = fs.readFileSync(new URL('../src/PatientView.jsx', import.meta.url), 'utf8');

  // BUG 1 checks: PatientView does not embed raw backend URL in iframe
  assert.ok(!source.includes('src={`${API_URL}/records/view/'), 'PatientView must not embed raw backend URL in iframe');

  // Uses fetch with Authorization header and blob URL
  assert.ok(source.includes('Authorization: `Bearer ${token}`'), 'PatientRecordViewer must fetch with Authorization header');
  assert.ok(source.includes('URL.createObjectURL(blob)'), 'PatientRecordViewer must create blob URL');
  assert.ok(source.includes('URL.revokeObjectURL(objectUrl)'), 'PatientRecordViewer must revoke blob URL on cleanup');
  assert.ok(source.includes('<PatientRecordViewer record={selectedPdfRecord} />'), 'PatientView must render PatientRecordViewer in modal');
});
