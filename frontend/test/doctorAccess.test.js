import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('doctor dashboard contains authoritative access check and countdown refresh logic', () => {
  const source = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');

  // 1. Must query backend /records/check/:patientAddress, not direct contract polling
  assert.ok(source.includes('/records/check/'), 'DoctorView must query /records/check/ for authoritative status');
  assert.ok(!source.includes('contract.hasAccess(patientAddress, doctorAddr)'), 'DoctorView must not poll contract.hasAccess directly without expiry verification');

  // 2. Countdown ticker triggers re-check and sets expired when countdown reaches zero
  assert.ok(source.includes('remaining <= 0'), 'DoctorView must check when countdown reaches zero');
  assert.ok(source.includes('status: "expired"'), 'DoctorView must transition status to expired when countdown reaches zero');
  assert.ok(source.includes('checkAccessStatus(patientAddress)'), 'DoctorView must call checkAccessStatus on countdown zero');

  // 3. Must listen to window focus and document visibilitychange
  assert.ok(source.includes('window.addEventListener("focus"'), 'DoctorView must refresh on window focus');
  assert.ok(source.includes('document.addEventListener("visibilitychange"'), 'DoctorView must refresh on visibilitychange');

  // 4. Pre-flight check in OriginalRecordViewer before fetching decrypted bytes
  assert.ok(source.includes('// Re-check authoritative access before opening or downloading the record'), 'OriginalRecordViewer must pre-check access');
  const viewer = fs.readFileSync(new URL('../src/lib/originalRecordView.js', import.meta.url), 'utf8');
  assert.ok(viewer.includes('check?.hasAccess !== true'), 'OriginalRecordViewer must require confirmed access');

  // 5. Pre-flight check in uploadPrescription before starting upload flow
  assert.ok(source.includes('// Re-verify authoritative access before starting upload'), 'uploadPrescription must pre-verify access');

  // Shared presentation is covered by consentUi.test.js; backend status still drives it.
  assert.ok(source.includes('<ConsentStatus detail={accessDetail ? { ...accessDetail, hasAccess: accessStatus } : null} />'));
  assert.ok(source.includes('document.removeEventListener("visibilitychange", onVisibility)'));

});

test('actual doctor countdown expires access, rechecks the backend, and cleans up its timer', () => {
  const source = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('    clearInterval(countdownRef.current);');
  const end = source.indexOf('  }, [accessDetail?.expiresAt', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  const baseTime = Date.parse('2026-06-01T12:00:00Z');
  for (const seconds of [60, 0, -1]) {
    let tick, accessStatus = true, refreshes = 0;
    let detail = { status: 'active', expiresAt: new Date(baseTime + seconds * 1000).toISOString() };
    const cleared = [];
    const run = new Function('accessDetail', 'countdownRef', 'setInterval', 'clearInterval', 'Date', 'setAccessStatus', 'setAccessDetail', 'checkAccessStatus', 'patientAddress', body);
    const cleanup = run(detail, { current: null }, callback => { tick = callback; return 'timer'; },
      timer => cleared.push(timer), { parse: Date.parse, now: () => baseTime },
      value => { accessStatus = value; }, update => { detail = update(detail); },
      patient => { assert.equal(patient, 'patient-wallet'); refreshes++; }, 'patient-wallet');
    tick();
    assert.equal(accessStatus, seconds > 0);
    assert.equal(detail.status, seconds > 0 ? 'active' : 'expired');
    assert.equal(detail.remainingSeconds, Math.max(0, seconds));
    assert.equal(refreshes, seconds > 0 ? 0 : 1);
    cleanup();
    assert.equal(cleared.at(-1), 'timer');
  }
});
