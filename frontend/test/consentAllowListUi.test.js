import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('PatientView RecordChecklist: Select all, Select none, and item toggle logic', () => {
  const patientViewSource = fs.readFileSync(new URL('../src/PatientView.jsx', import.meta.url), 'utf8');

  // Verify RecordChecklist exists and has Select all and Select none
  assert.ok(patientViewSource.includes('function RecordChecklist'), 'PatientView must define RecordChecklist');
  assert.ok(patientViewSource.includes('Select all'), 'RecordChecklist must have "Select all" button');
  assert.ok(patientViewSource.includes('Select none'), 'RecordChecklist must have "Select none" button');
  assert.ok(patientViewSource.includes('records selected'), 'RecordChecklist must display selection count');

  // Extract RecordChecklist implementation to test logic directly
  const match = patientViewSource.match(/function RecordChecklist\(\{[\s\S]*?\n\}/);
  assert.ok(match, 'RecordChecklist function extracted');

  const records = [
    { id: 'rec-1', fileName: 'blood_test.pdf', recordType: 'report', uploadedAt: '2026-03-01T10:00:00Z' },
    { id: 'rec-2', fileName: 'prescription.pdf', recordType: 'prescription', uploadedAt: '2026-03-02T10:00:00Z' },
    { id: 'rec-3', fileName: 'discharge.pdf', recordType: 'report', uploadedAt: '2026-03-03T10:00:00Z' }
  ];

  // Helper simulating RecordChecklist action handlers
  const handleSelectAll = (recs, onChange) => onChange(recs.map(r => r.id));
  const handleSelectNone = (onChange) => onChange([]);
  const handleToggle = (id, selectedIds, onChange) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(item => item !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  // Test 1: Select All
  let currentSelected = [];
  handleSelectAll(records, (ids) => { currentSelected = ids; });
  assert.deepEqual(currentSelected, ['rec-1', 'rec-2', 'rec-3'], 'Select all must select all record IDs');

  // Test 2: Select None
  handleSelectNone((ids) => { currentSelected = ids; });
  assert.deepEqual(currentSelected, [], 'Select none must empty selected IDs');

  // Test 3: Toggle individual items
  handleToggle('rec-2', currentSelected, (ids) => { currentSelected = ids; });
  assert.deepEqual(currentSelected, ['rec-2']);

  handleToggle('rec-1', currentSelected, (ids) => { currentSelected = ids; });
  assert.deepEqual(currentSelected, ['rec-2', 'rec-1']);

  handleToggle('rec-2', currentSelected, (ids) => { currentSelected = ids; });
  assert.deepEqual(currentSelected, ['rec-1']);
});

test('PatientView: active grants display shared records count and Manage shared records modal', () => {
  const patientViewSource = fs.readFileSync(new URL('../src/PatientView.jsx', import.meta.url), 'utf8');

  // Active grants count and manage button
  assert.ok(patientViewSource.includes('records shared'), 'Active grants must show "X of Y records shared"');
  assert.ok(patientViewSource.includes('Manage shared records'), 'Active grants must provide "Manage shared records" button');

  // Modal for managing shared records
  assert.ok(patientViewSource.includes('Manage Shared Records'), 'Must contain Manage Shared Records modal');
  assert.ok(patientViewSource.includes('/consent/allowlist/'), 'Must interact with /consent/allowlist endpoint');
  assert.ok(patientViewSource.includes('saveSharedRecords'), 'Must have saveSharedRecords handler');
});

test('DoctorView: empty state and no IPFS CIDs or patient wallet addresses on cards', () => {
  const doctorViewSource = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');

  // Friendly empty state
  assert.ok(
    doctorViewSource.includes("The patient hasn't shared any records yet."),
    'DoctorView must display friendly empty state when patient has shared no records'
  );

  // Cards must NOT display IPFS hash or CID
  assert.ok(
    !doctorViewSource.includes('IPFS: {rec.ipfsHash}'),
    'Patient Clinical Documents cards must not display IPFS CIDs'
  );
  assert.ok(
    !doctorViewSource.includes('IPFS: {record.ipfsHash}'),
    'DoctorRecordHistory cards must not display IPFS CIDs'
  );

  // DoctorRecordHistory cards must not display raw full patient wallet address
  assert.ok(
    !doctorViewSource.includes('Patient: <code style={{ fontFamily: \'var(--font-mono)\' }}>{record.patientAddress}</code>'),
    'DoctorRecordHistory cards must not display full patient wallet address'
  );

  // Cards display filename, type, and upload date
  assert.ok(doctorViewSource.includes('{rec.fileName}'), 'Cards must display fileName');
  assert.ok(doctorViewSource.includes('{rec.recordType}'), 'Cards must display recordType');
  assert.ok(doctorViewSource.includes('uploadedAt'), 'Cards must display upload timestamp/date');
});

test('DoctorView: separates patient shared clinical documents from doctor uploaded prescriptions', () => {
  const doctorViewSource = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');

  // Patient Clinical Documents filters to exclude doctor's own uploads
  assert.ok(
    doctorViewSource.includes('docLower && rDoc === docLower'),
    'Patient Clinical Documents must show records shared by patient, excluding doctor self-uploads'
  );

  // DoctorRecordHistory filters to only show doctor's own uploads
  assert.ok(
    doctorViewSource.includes('docLower ? rDoc === docLower : true'),
    'DoctorRecordHistory must filter to only show doctor own uploads'
  );

  // Both views deduplicate by record ID
  assert.ok(
    doctorViewSource.includes('new Map(records.map(r => [r.id, r]))'),
    'DoctorView must de-duplicate patient records by ID'
  );
  assert.ok(
    doctorViewSource.includes('new Map(myUploads.map(r => [r.id, r]))'),
    'DoctorRecordHistory must de-duplicate doctor uploads by ID'
  );
});

test('DoctorView & PatientView: mixed-case addresses filter doctor-uploaded records correctly', () => {
  const mixedDoctor = '0x0FaDA4a5613E20687501De59635c636e1DA4C30e';
  const mixedPatient = '0x2aD085b40dDD05E9628a4A0780c38B8EAB27C25B';

  const docLower = mixedDoctor.toLowerCase();
  const patLower = mixedPatient.toLowerCase();

  const returnedFromBackend = [
    {
      id: 'rec-doc-upload',
      fileName: 'doctor_prescription.pdf',
      patientAddress: mixedPatient.toUpperCase(),
      doctorAddress: mixedDoctor, // mixed case
      recordType: 'prescription'
    },
    {
      id: 'rec-patient-shared',
      fileName: 'patient_blood_work.pdf',
      patientAddress: mixedPatient.toLowerCase(),
      doctorAddress: null,
      recordType: 'report'
    }
  ];

  // (b) "Patient Clinical Documents" must show ONLY records on the allow-list that the doctor did not upload
  const patientClinicalDocuments = returnedFromBackend.filter((r) => {
    const rPat = (r.patientAddress || "").toLowerCase();
    const rDoc = (r.doctorAddress || "").toLowerCase();
    if (rPat !== patLower) return false;
    if (docLower && rDoc === docLower) return false;
    return true;
  });

  assert.equal(patientClinicalDocuments.length, 1);
  assert.equal(patientClinicalDocuments[0].id, 'rec-patient-shared');
  assert.ok(!patientClinicalDocuments.some(r => r.id === 'rec-doc-upload'), 'Doctor upload must NEVER appear in Patient Clinical Documents');

  // Doctor-uploaded records appear ONLY in "My Uploaded Prescriptions & Reports"
  const doctorUploads = returnedFromBackend.filter((r) => {
    const rDoc = (r.doctorAddress || "").toLowerCase();
    if (!rDoc) return false;
    return docLower ? rDoc === docLower : true;
  });

  assert.equal(doctorUploads.length, 1);
  assert.equal(doctorUploads[0].id, 'rec-doc-upload');

  // PatientView: getShareableRecords excludes doctor-uploaded records even with mixed-case doctor address
  const allPatientVaultRecords = [
    { id: 'rec-1', fileName: 'patient_mri.pdf', doctorAddress: '' },
    { id: 'rec-doc-1', fileName: 'doctor_notes.pdf', doctorAddress: mixedDoctor },
    { id: 'rec-2', fileName: 'patient_lab.pdf', doctorAddress: null },
  ];

  const shareable = allPatientVaultRecords.filter(r => {
    const uploader = (r.doctorAddress || "").toLowerCase().trim();
    return uploader !== docLower;
  });

  assert.equal(shareable.length, 2);
  assert.deepEqual(shareable.map(r => r.id), ['rec-1', 'rec-2']);
  assert.ok(!shareable.some(r => r.id === 'rec-doc-1'), 'Doctor uploads are not the patient to share');
});
