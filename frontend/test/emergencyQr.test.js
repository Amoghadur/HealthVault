import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('PatientView Emergency QR UI includes cross-device destination host, copy link, and revocation', () => {
  const source = fs.readFileSync(new URL('../src/PatientView.jsx', import.meta.url), 'utf8');

  // Verify public endpoint configuration banner exists
  assert.ok(
    source.includes('Public Cross-Device Endpoint Not Configured'),
    'PatientView must explain when public endpoint is not configured'
  );
  assert.ok(
    source.includes('EMERGENCY_QR_BASE_URL'),
    'PatientView must reference EMERGENCY_QR_BASE_URL configuration'
  );

  // Verify verified HTTPS badge and host indicator
  assert.ok(
    source.includes('HTTPS Verified'),
    'PatientView must indicate HTTPS verified status'
  );
  assert.ok(
    source.includes('Public Scanner Endpoint'),
    'PatientView must display public scanner endpoint indicator'
  );

  // Verify Copy Scan Link action
  assert.ok(
    source.includes('handleCopyLink'),
    'PatientView must provide handleCopyLink handler'
  );
  assert.ok(
    source.includes('Copy Scan Link'),
    'PatientView modal must include Copy Scan Link action'
  );

  // Verify Revocation action
  assert.ok(
    source.includes('revokeQR'),
    'PatientView must provide revokeQR handler'
  );
  assert.ok(
    source.includes('Revoke QR') || source.includes('Revoke now'),
    'PatientView must include Revoke QR action'
  );

  // Verify token expiry display
  assert.ok(
    source.includes('Auto-expires at'),
    'PatientView must display auto-expiry time'
  );

  // Verify active QR restoration
  assert.ok(
    source.includes('/consent/qr/active'),
    'PatientView must query /consent/qr/active to restore existing active session'
  );
  assert.ok(
    source.includes('/consent/qr/config'),
    'PatientView must query /consent/qr/config to check public endpoint availability'
  );

  // Verify no hardcoded localhost fallback for QR URL
  assert.ok(
    !source.includes('http://localhost:4000/consent/qr/scan/'),
    'PatientView must not construct hardcoded localhost scan URLs'
  );
});
