import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DIABETES_OPTIONS,
  validateClientPatientProfile,
} from '../src/lib/patientProfile.js';

test('1. PatientView has no hardcoded Penicillin allergy and no hardcoded Type 2 Diabetes condition', () => {
  const patientViewSource = fs.readFileSync(new URL('../src/PatientView.jsx', import.meta.url), 'utf8');

  // Hardcoded Penicillin allergy alert pill must be completely removed
  assert.ok(
    !patientViewSource.includes('<span style={{ fontSize: "12px", color: "var(--text-primary)" }}>\n                  Penicillin\n                </span>'),
    'PatientView must not render static hardcoded Penicillin'
  );
  assert.ok(
    !patientViewSource.includes('allergies: "Penicillin"'),
    'PatientView must not initialize allergies to hardcoded Penicillin'
  );

  // Hardcoded Type 2 Diabetes condition must be removed from emergency QR generator
  assert.ok(
    !patientViewSource.includes('conditions: ["Type 2 Diabetes"]'),
    'PatientView generateQR must not hardcode ["Type 2 Diabetes"]'
  );
});

test('2. PatientView renders Clinical Medical Profile card with view and inline edit capabilities', () => {
  const source = fs.readFileSync(new URL('../src/PatientView.jsx', import.meta.url), 'utf8');

  // Prominent display
  assert.ok(source.includes('Medical Profile Details'), 'PatientView must display Medical Profile Details');
  assert.ok(source.includes('Known Allergies'), 'PatientView must display Known Allergies');
  assert.ok(source.includes('Diabetes Status'), 'PatientView must display Diabetes Status');

  // Action buttons
  assert.ok(source.includes('Edit Clinical Details'), 'PatientView must include Edit Clinical Details action');
  assert.ok(source.includes('Save Changes'), 'PatientView must include Save Changes action');
  assert.ok(source.includes('Cancel'), 'PatientView must include Cancel action');

  // Empty and explicit states
  assert.ok(source.includes('Not provided'), 'PatientView must display Not provided empty state');
  assert.ok(source.includes('No known allergies'), 'PatientView must display No known allergies');
});

test('3. PatientProfileModal includes Diabetes Status and Known Allergies with Add Allergy action', () => {
  const source = fs.readFileSync(new URL('../src/components/patient/PatientProfileModal.jsx', import.meta.url), 'utf8');

  // Diabetes Information dropdown
  assert.ok(source.includes('id="patient-profile-diabetes-status"'), 'Modal must render diabetes status select');
  assert.ok(source.includes('DIABETES_OPTIONS'), 'Modal must use DIABETES_OPTIONS');

  // Known Allergies controls
  assert.ok(source.includes('id="patient-profile-add-allergy"'), 'Modal must have add allergy input');
  assert.ok(source.includes('handleAddAllergy'), 'Modal must have handleAddAllergy handler');
  assert.ok(source.includes('+ Add Allergy'), 'Modal must have + Add Allergy button');
  assert.ok(source.includes('handleRemoveAllergy'), 'Modal must have handleRemoveAllergy handler');
  assert.ok(source.includes('handleAllergyStatusChange'), 'Modal must have allergy status change handler');

  // Explicit NKDA option
  assert.ok(source.includes('no_known_allergies'), 'Modal must support explicit no_known_allergies status');
  assert.ok(source.includes('No known allergies'), 'Modal must support No known allergies option');
});

test('4. Client validation supports all required diabetes options and allergy constraints', () => {
  const expectedOptions = [
    'Type 1 diabetes',
    'Type 2 diabetes',
    'Prediabetes',
    'No diabetes',
    'Unknown / Not provided',
  ];

  for (const opt of expectedOptions) {
    assert.ok(DIABETES_OPTIONS.includes(opt), `DIABETES_OPTIONS must include: ${opt}`);
    const valid = validateClientPatientProfile({ displayName: 'Test User', diabetesStatus: opt });
    assert.equal(valid.isValid, true, `Validation must accept diabetesStatus: ${opt}`);
  }

  // Invalid diabetes status rejected
  const invalid = validateClientPatientProfile({ displayName: 'Test User', diabetesStatus: 'Fictional Diabetes' });
  assert.equal(invalid.isValid, false);
  assert.ok(invalid.errors.diabetesStatus);

  // Allergies length validation
  const validAllergies = validateClientPatientProfile({
    displayName: 'Test User',
    allergies: ['Peanuts', 'Latex', 'Dust mites'],
  });
  assert.equal(validAllergies.isValid, true);

  const invalidAllergy = validateClientPatientProfile({
    displayName: 'Test User',
    allergies: ['A'.repeat(51)],
  });
  assert.equal(invalidAllergy.isValid, false);
  assert.ok(invalidAllergy.errors.allergies);
});
