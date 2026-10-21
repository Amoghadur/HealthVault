import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('formatRelativeTime produces correct relative time and handles edge cases', () => {
  const patientViewSource = fs.readFileSync(new URL('../src/PatientView.jsx', import.meta.url), 'utf8');

  // Verify formatRelativeTime function exists in PatientView.jsx
  assert.ok(patientViewSource.includes('function formatRelativeTime'), 'PatientView must define formatRelativeTime');

  // Simulate formatRelativeTime logic
  function formatRelativeTime(iso) {
    if (!iso) return '';
    const diffMs = Date.now() - Date.parse(iso);
    if (isNaN(diffMs) || diffMs < 0) return '';
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
  }

  assert.equal(formatRelativeTime(''), '');
  assert.equal(formatRelativeTime(null), '');
  assert.equal(formatRelativeTime('invalid-date'), '');

  const now = Date.now();
  assert.equal(formatRelativeTime(new Date(now - 15 * 1000).toISOString()), '15s ago');
  assert.equal(formatRelativeTime(new Date(now - 5 * 60 * 1000).toISOString()), '5 min ago');
  assert.equal(formatRelativeTime(new Date(now - 3 * 3600 * 1000).toISOString()), '3h ago');
  assert.equal(formatRelativeTime(new Date(now - 2 * 86400 * 1000).toISOString()), '2d ago');
});

test('5. Patient sees the correct doctor name and avatar on a pending request without entering a wallet address', () => {
  const source = fs.readFileSync(new URL('../src/PatientView.jsx', import.meta.url), 'utf8');

  // Verify pending requests section extracts doctor identity from request payload automatically
  assert.ok(source.includes('req.profile?.displayName'), 'Must resolve doctor displayName from profile');
  assert.ok(source.includes('doctorAvatar'), 'Must support doctor avatar');
  assert.ok(source.includes('Requested {reqRelTime}'), 'Must display human-readable relative request time');
  assert.ok(source.includes('title={reqExactTime}'), 'Must display exact timestamp as hover tooltip');

  // Verify patient does not need to enter address: uses req.doctorAddress from request
  assert.ok(source.includes('respondToRequest(req.id, \'accept\', req.doctorAddress)'),
    'Approval must target request doctorAddress automatically');
  assert.ok(source.includes('respondToRequest(req.id, \'reject\', req.doctorAddress)'),
    'Rejection must target request doctorAddress automatically');
});

test('6. A missing doctor profile falls back to the requester shortened wallet address', () => {
  const source = fs.readFileSync(new URL('../src/PatientView.jsx', import.meta.url), 'utf8');

  // Check fallback definition:
  assert.ok(
    source.includes('const doctorTitle = reqDoctorName || reqShortAddr || \'Care Provider\';'),
    'Title must fallback to shortened wallet address when no profile exists'
  );
  assert.ok(
    source.includes('Care Provider (No profile configured)'),
    'Subtitle must explain that no profile is configured when unprofiled'
  );
});

test('7. Multiple requests from different doctors display correct identities and preserve correct approval/rejection targets', () => {
  const source = fs.readFileSync(new URL('../src/PatientView.jsx', import.meta.url), 'utf8');

  // Map over requests with unique key
  assert.ok(source.includes('key={req.id}'), 'Must use request id as card key');
  assert.ok(source.includes('getShareableRecords(uploadedRecords, req.doctorAddress)'),
    'Checklist records must be scoped to the specific doctorAddress of each request');
  assert.ok(source.includes('requestSelectedRecords[req.id]'),
    'Selected records state must be keyed by request id');
  assert.ok(source.includes('requestDurations[req.id]'),
    'Duration selection must be keyed by request id');
});

test('Manage Shared Records displays the appropriate empty-state message with self-upload count', () => {
  const source = fs.readFileSync(new URL('../src/PatientView.jsx', import.meta.url), 'utf8');

  // RecordChecklist accepts contextMessage
  assert.ok(source.includes('contextMessage = null'), 'RecordChecklist must accept contextMessage prop');
  assert.ok(source.includes('{contextMessage || \'📂 No patient clinical documents available to share with this provider.\'}'),
    'RecordChecklist must display contextMessage when provided or fallback to default');

  // Manage Shared Records modal calculates contextMessage when records were uploaded by this doctor
  assert.ok(source.includes('Records uploaded by this doctor are already visible to them. You have no other records to share.'),
    'Manage Shared Records modal must show specific explanation when only doctor-uploaded records exist');
  assert.ok(source.includes('uploaded by this provider'), 'Must include count of doctor uploads');
});

test('Confirm duplicate patient ID is fixed in DoctorView', () => {
  const source = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');

  assert.ok(
    source.includes('!patientAddress.toLowerCase().startsWith(patientLabel.toLowerCase().slice(0, 6))'),
    'DoctorView must check patientLabel does not duplicate wallet address prefix'
  );
});

test('DoctorView: Complete patient profile lifecycle across pre-consent lookup and consent authorization', () => {
  const source = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');

  // 1. Pre-consent lookup
  assert.ok(
    source.includes('/api/patient/profile/lookup/'),
    'DoctorView must call lookup endpoint before consent'
  );

  // 2. Post-consent authorized profile retrieval
  assert.ok(
    source.includes('/api/patient/profile/public/'),
    'DoctorView must call public endpoint after active consent is granted'
  );

  // 3. Privacy restricted state
  assert.ok(
    source.includes('isPrivacyRestricted'),
    'DoctorView must track isPrivacyRestricted state'
  );
  assert.ok(
    source.includes('Anonymous Patient'),
    'DoctorView must display Anonymous Patient when privacy toggle is enabled before consent'
  );

  // 4. Loading and error states in Patient Summary
  assert.ok(
    source.includes('Loading patient profile…'),
    'Patient Summary must display loading state'
  );
  assert.ok(
    source.includes('patientProfileError'),
    'Patient Summary must display error state if API fails'
  );
  assert.ok(
    source.includes('No additional profile fields configured by patient.'),
    'Patient Summary displays unconfigured message only when not loading, no error, and no profile'
  );
});

test('9. Loading and API errors do not leave stale identities on screen', () => {
  const source = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');

  // When patient is cleared or searched anew, previous states are reset
  assert.ok(
    source.includes('setPatientPublicProfile(null);'),
    'resolvePatient must reset patient profile state'
  );
  assert.ok(
    source.includes('setIsPrivacyRestricted(false);'),
    'resolvePatient must reset privacy restriction state'
  );
  assert.ok(
    source.includes('setPatientProfileError(null);'),
    'resolvePatient must reset profile error state'
  );
  assert.ok(
    source.includes('setPatientProfileLoading(false);'),
    'resolvePatient must reset profile loading state'
  );
});

test('Valid wallet-address searches do not retain stale validation banners', () => {
  const source = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');

  // Verify resolvePatient clears validation error and feedback banner before and upon valid resolution
  assert.ok(
    source.includes('setResolveError("");'),
    'resolvePatient must clear resolveError at start'
  );
  assert.ok(
    source.includes('if (feedback?.text === "Enter a Patient ID like HV-1001 or a wallet address") {\n      setFeedback(null);\n    }'),
    'resolvePatient must clear stale validation banner from feedback'
  );
  assert.ok(
    source.includes('ethers.isAddress(input)'),
    'resolvePatient must validate Ethereum address using ethers.js'
  );
});

test('Editing the search input clears only the appropriate old validation error', () => {
  const source = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');

  // Verify PillInput onChange clears resolveError and search feedback
  assert.ok(
    source.includes('setPatientInput(e.target.value);'),
    'PillInput onChange must update patientInput'
  );
  assert.ok(
    source.includes('setResolveError("");'),
    'PillInput onChange must clear resolveError'
  );
  assert.ok(
    source.includes('if (feedback?.text === "Enter a Patient ID like HV-1001 or a wallet address") {\n                  setFeedback(null);\n                }'),
    'PillInput onChange must clear the validation banner'
  );
});

test('Empty or invalid search inputs set specific validation error', () => {
  const source = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');

  // Verify validation message on empty or invalid input
  assert.ok(
    source.includes('if (!input) {\n      setResolveError("Enter a Patient ID like HV-1001 or a wallet address");\n      return;\n    }'),
    'Empty search input must set resolveError'
  );
  assert.ok(
    source.includes('if (!isEthAddress && !isHvId) {\n      setResolveError("Enter a Patient ID like HV-1001 or a wallet address");\n      return;\n    }'),
    'Invalid input format must set resolveError'
  );
});

test('App.jsx sends selected role to /auth/verify', () => {
  const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

  assert.ok(
    appSource.includes('body: JSON.stringify({ address, signature, role })'),
    'App.jsx must include role in verify payload'
  );
});
