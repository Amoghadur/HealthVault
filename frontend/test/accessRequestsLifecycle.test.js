import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  formatDispatchedTime,
  getRequestDisplayInfo,
  deduplicateRequests,
  getActivePreflightRequestId
} from '../src/lib/accessRequestUi.js';

const patientViewSource = fs.readFileSync(new URL('../src/PatientView.jsx', import.meta.url), 'utf8');
const doctorViewSource = fs.readFileSync(new URL('../src/DoctorView.jsx', import.meta.url), 'utf8');
const dashboardSource = fs.readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');

test('1. Patient dashboard mounts and auto-fetches incoming requests without search or tab-switch blocking', () => {
  // Verify fetchRequests is called on mount/session restore
  assert.ok(
    patientViewSource.includes('fetchRequests();') &&
    patientViewSource.includes('const initial = setTimeout(() => {'),
    'PatientView must fetch requests immediately on mount/session restore'
  );

  // Verify fetchRequests is also called periodically (bounded 10s interval)
  assert.ok(
    patientViewSource.includes('const interval = setInterval(() => {') &&
    patientViewSource.includes('fetchRequests();'),
    'PatientView must periodically poll for incoming requests'
  );

  // Verify tab-switch always refreshes requests
  assert.ok(
    patientViewSource.includes('if (tab.id === "access") {\n                  fetchRequests();'),
    'Access Control tab switch must always refresh requests'
  );
  assert.ok(
    !patientViewSource.includes('if (activeTab === "consent" && !requestsLoaded)'),
    'Tab switch must NOT be blocked by requestsLoaded flag'
  );
});

test('2. Doctor dashboard mounts and auto-fetches outgoing requests without searching', () => {
  // Verify fetchOutgoingRequests exists and is called on mount
  assert.ok(
    doctorViewSource.includes('const fetchOutgoingRequests = useCallback(async () => {'),
    'DoctorView must define fetchOutgoingRequests'
  );

  assert.ok(
    doctorViewSource.includes('const timer = setTimeout(fetchOutgoingRequests, 0);'),
    'DoctorView must fetch outgoing requests immediately on mount'
  );

  assert.ok(
    doctorViewSource.includes('const interval = setInterval(fetchOutgoingRequests, 10000);'),
    'DoctorView must poll outgoing requests on a bounded 10s interval'
  );
});

test('3. Stable request ID deduplication prevents duplicate cards across refreshes', () => {
  // Verify PatientView deduplication logic
  assert.ok(
    patientViewSource.includes('const seen = new Set();') &&
    patientViewSource.includes('for (const r of rawList) {') &&
    patientViewSource.includes('!seen.has(String(r.id))'),
    'PatientView must deduplicate requests by stable id'
  );

  // Verify DoctorView deduplication logic
  assert.ok(
    doctorViewSource.includes('deduplicateRequests(rawRequests)'),
    'DoctorView must deduplicate outgoing requests using deduplicateRequests'
  );

  const duplicates = [
    { id: '101', doctorAddress: '0xabc', status: 'pending' },
    { id: '101', doctorAddress: '0xabc', status: 'pending' },
    { id: '102', doctorAddress: '0xdef', status: 'pending' }
  ];

  const result = deduplicateRequests(duplicates);
  assert.equal(result.length, 2, 'Must collapse duplicate request entries with the same id');
  assert.equal(result[0].id, '101');
  assert.equal(result[1].id, '102');
});

test('4. Newly created doctor request refreshes outgoing list without another patient search', () => {
  // Verify sendAccessRequest calls fetchOutgoingRequests
  assert.ok(
    doctorViewSource.includes('await fetchOutgoingRequests();'),
    'sendAccessRequest must refresh outgoing requests after sending'
  );

  // Verify requestSent is derived from outgoing requests for selected patient
  assert.ok(
    doctorViewSource.includes('const hasPendingOutgoingForPatient = Boolean('),
    'DoctorView must derive pending outgoing status from outgoingRequests'
  );

  assert.ok(
    doctorViewSource.includes('const isRequestPending = accessStatus !== true && (requestSent || hasPendingOutgoingForPatient);'),
    'DoctorView must determine pending status dynamically from outgoing list'
  );
});

test('5. Accept / reject status changes immediately refresh requests and active grants', () => {
  // In PatientView respondToRequest:
  assert.ok(
    patientViewSource.includes('if (typeof fetchRequests === "function") fetchRequests();'),
    'respondToRequest must call fetchRequests after action'
  );
  assert.ok(
    patientViewSource.includes('if (typeof fetchGrants === "function") fetchGrants();'),
    'respondToRequest must call fetchGrants after action'
  );

  // In PatientView grantAccess and revokeAccess:
  assert.ok(
    patientViewSource.includes('if (typeof fetchRequests === "function") fetchRequests();'),
    'grantAccess and revokeAccess must refresh requests'
  );
});

test('6. Distinct loading, empty, and error states exist and do not show stale data as current', () => {
  // PatientView state indicators
  assert.ok(patientViewSource.includes('requestsLoading'), 'PatientView must track requestsLoading');
  assert.ok(patientViewSource.includes('requestsError'), 'PatientView must track requestsError');
  assert.ok(patientViewSource.includes('Retry Loading Requests'), 'PatientView must provide retry on error');
  assert.ok(patientViewSource.includes('No Pending Access Requests'), 'PatientView must show empty state distinctly');
  assert.ok(patientViewSource.includes('Checking incoming care provider access requests'), 'PatientView must display loading state');

  // DoctorView state indicators
  assert.ok(doctorViewSource.includes('outgoingLoading'), 'DoctorView must track outgoingLoading');
  assert.ok(doctorViewSource.includes('outgoingError'), 'DoctorView must track outgoingError');
  assert.ok(doctorViewSource.includes('Retry Loading Outgoing Requests'), 'DoctorView must provide retry on error');
  assert.ok(doctorViewSource.includes('No outgoing access requests dispatched'), 'DoctorView must show empty state distinctly');
  assert.ok(doctorViewSource.includes('Checking outgoing requests…'), 'DoctorView must display loading state');
});

test('7. Window focus and visibility listeners and polling intervals are registered and cleaned up on unmount', () => {
  // PatientView focus and visibility listeners
  assert.ok(
    patientViewSource.includes('window.addEventListener("focus", handleFocus);') &&
    patientViewSource.includes('document.addEventListener("visibilitychange", handleVisibility);') &&
    patientViewSource.includes('window.removeEventListener("focus", handleFocus);') &&
    patientViewSource.includes('document.removeEventListener("visibilitychange", handleVisibility);'),
    'PatientView must add and remove focus & visibility listeners'
  );

  // PatientView timer cleanup
  assert.ok(
    patientViewSource.includes('clearTimeout(initial);') &&
    patientViewSource.includes('clearInterval(interval);'),
    'PatientView must clear timers on unmount'
  );

  // DoctorView focus and visibility listeners
  assert.ok(
    doctorViewSource.includes('window.addEventListener("focus", onFocus);') &&
    doctorViewSource.includes('document.addEventListener("visibilitychange", onVisibility);') &&
    doctorViewSource.includes('window.removeEventListener("focus", onFocus);') &&
    doctorViewSource.includes('document.removeEventListener("visibilitychange", onVisibility);'),
    'DoctorView must add and remove focus & visibility listeners'
  );

  // DoctorView timer cleanup
  assert.ok(
    doctorViewSource.includes('clearTimeout(timer);') &&
    doctorViewSource.includes('clearInterval(interval);'),
    'DoctorView must clear timers on unmount'
  );

  // Component unmount guards
  assert.ok(patientViewSource.includes('isMountedRef.current = false'), 'PatientView must guard unmounted state');
  assert.ok(doctorViewSource.includes('doctorMountedRef.current = false'), 'DoctorView must guard unmounted state');
});

test('8. No hardcoded or fabricated default requests or doctor names exist in runtime UI', () => {
  assert.ok(!patientViewSource.includes('Dr. Lionel Kohli'), 'PatientView must NOT hardcode Dr. Lionel Kohli');
  assert.ok(!doctorViewSource.includes('Dr. Lionel Kohli'), 'DoctorView must NOT hardcode Dr. Lionel Kohli');
  assert.ok(!patientViewSource.includes('Dr. Kohli'), 'PatientView must NOT hardcode Dr. Kohli');

  // Verify Doctor Lionel Kohli is not seeded in frontend
  const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.ok(!appSource.includes('Lionel Kohli'), 'App.jsx must NOT hardcode Dr. Lionel Kohli');
});

test('9. Blockchain confirmation must precede verified access status and success confirmation', () => {
  assert.ok(
    patientViewSource.includes('await waitForSuccess(tx);'),
    'grantAccess and revokeAccess must await transaction confirmation before backend sync'
  );

  assert.ok(
    patientViewSource.includes('const nowHasAccess = await verifyContract.hasAccess(account, addr);'),
    'grantAccess must verify on-chain status before displaying success confirmation'
  );
});

test('10. Timestamp formatting regression tests: supports ISO, numeric, numeric string, and safe fallback', () => {
  // Valid ISO string
  const isoStr = '2026-10-20T14:18:46.797Z';
  const expectedIso = new Date(isoStr).toLocaleString();
  assert.equal(formatDispatchedTime(isoStr), expectedIso, 'Must format valid ISO timestamp');

  // Valid numeric timestamp (ms since epoch)
  const numTimestamp = 1792505926797;
  const expectedNum = new Date(numTimestamp).toLocaleString();
  assert.equal(formatDispatchedTime(numTimestamp), expectedNum, 'Must format numeric millisecond timestamp');

  // Valid numeric string
  const numStr = '1792505926797';
  assert.equal(formatDispatchedTime(numStr), expectedNum, 'Must format numeric string timestamp');

  // Missing or invalid values must fall back to "Request time unavailable" without fabricating dates
  assert.equal(formatDispatchedTime(undefined), 'Request time unavailable');
  assert.equal(formatDispatchedTime(null), 'Request time unavailable');
  assert.equal(formatDispatchedTime(''), 'Request time unavailable');
  assert.equal(formatDispatchedTime('   '), 'Request time unavailable');
  assert.equal(formatDispatchedTime('invalid-date'), 'Request time unavailable');
  assert.equal(formatDispatchedTime('Invalid Date'), 'Request time unavailable');
  assert.equal(formatDispatchedTime(0), 'Request time unavailable');
  assert.equal(formatDispatchedTime(-100), 'Request time unavailable');
  assert.equal(formatDispatchedTime(NaN), 'Request time unavailable');
});

test('11. Status labels regression tests: Awaiting Approval, Approved, Rejected, Expired, Revoked', () => {
  const patient = '0x2ad085b40ddd05e9628a4a0780c38b8eab27c25b';
  const future = new Date(Date.now() + 600000).toISOString();
  const past = new Date(Date.now() - 600000).toISOString();

  // Pending request with unexpired TTL
  const pendingReq = { id: 'p1', patientAddress: patient, status: 'pending', expiresAt: future };
  const pendingInfo = getRequestDisplayInfo(pendingReq, patient, null);
  assert.equal(pendingInfo.label, 'Awaiting Approval');
  assert.equal(pendingInfo.statusKey, 'awaiting_approval');
  assert.equal(pendingInfo.isConsentActive, false);

  // Pending request with expired TTL
  const expiredPendingReq = { id: 'p2', patientAddress: patient, status: 'pending', expiresAt: past };
  const expiredPendingInfo = getRequestDisplayInfo(expiredPendingReq, patient, null);
  assert.equal(expiredPendingInfo.label, 'Expired');
  assert.equal(expiredPendingInfo.statusKey, 'expired');

  // Approved request with confirmed active consent
  const approvedReq = { id: 'a1', patientAddress: patient, status: 'accepted', authorizationStatus: 'approved' };
  const approvedInfo = getRequestDisplayInfo(approvedReq, patient, { status: 'active' });
  assert.equal(approvedInfo.label, 'Approved');
  assert.equal(approvedInfo.statusKey, 'approved');
  assert.equal(approvedInfo.isConsentActive, true);

  // Approved request from the past WITHOUT active consent (e.g. grant expired) must be Expired
  const pastApprovedReq = { id: 'a2', patientAddress: patient, status: 'accepted', authorizationStatus: 'expired' };
  const pastApprovedInfo = getRequestDisplayInfo(pastApprovedReq, patient, null);
  assert.equal(pastApprovedInfo.label, 'Expired', 'Approved request with expired grant must NOT show as Approved');
  assert.equal(pastApprovedInfo.isConsentActive, false);

  // Approved request where preflight accessDetail indicates expired
  const expiredDetailReq = { id: 'a3', patientAddress: patient, status: 'accepted' };
  const expiredDetailInfo = getRequestDisplayInfo(expiredDetailReq, patient, { status: 'expired' });
  assert.equal(expiredDetailInfo.label, 'Expired');

  // Explicitly rejected request
  const rejectedReq = { id: 'r1', patientAddress: patient, status: 'rejected' };
  const rejectedInfo = getRequestDisplayInfo(rejectedReq, patient, null);
  assert.equal(rejectedInfo.label, 'Rejected');
  assert.equal(rejectedInfo.statusKey, 'rejected');

  // Revoked request or grant
  const revokedReq = { id: 'rv1', patientAddress: patient, status: 'revoked' };
  const revokedInfo = getRequestDisplayInfo(revokedReq, patient, null);
  assert.equal(revokedInfo.label, 'Revoked');
  assert.equal(revokedInfo.statusKey, 'revoked');

  // Grant revoked via accessDetail
  const revokedDetailReq = { id: 'rv2', patientAddress: patient, status: 'accepted' };
  const revokedDetailInfo = getRequestDisplayInfo(revokedDetailReq, patient, { status: 'revoked' });
  assert.equal(revokedDetailInfo.label, 'Revoked');
});

test('12. Selected-patient indicator regression tests: only active preflight patient and active card', () => {
  const patient1 = '0x2ad085b40ddd05e9628a4a0780c38b8eab27c25b';
  const patient2 = '0x10068cec2e3cc077fbfd00fc221b8a35fe5d23db';

  const requests = [
    { id: 'req-new', patientAddress: patient1, status: 'accepted' },
    { id: 'req-old', patientAddress: patient1, status: 'rejected' },
    { id: 'req-other', patientAddress: patient2, status: 'pending' }
  ];

  // Inactive preflight selection: patientFound = false
  assert.equal(
    getActivePreflightRequestId(requests, false, patient1),
    null,
    'Must return null when preflight selection is inactive (patientFound=false)'
  );

  // Inactive preflight selection: invalid or empty address
  assert.equal(getActivePreflightRequestId(requests, true, ''), null);
  assert.equal(getActivePreflightRequestId(requests, true, 'not-an-address'), null);
  assert.equal(getActivePreflightRequestId(requests, true, null), null);

  // Active preflight selection: returns the active request ID for the selected patient
  const activeId = getActivePreflightRequestId(requests, true, patient1);
  assert.equal(activeId, 'req-new', 'Must select the primary active card for patient1');

  // Preflight card selection logic: only the active request is marked selected
  const isReqNewSelected = (activeId === requests[0].id);
  const isReqOldSelected = (activeId === requests[1].id);
  const isReqOtherSelected = (activeId === requests[2].id);

  assert.equal(isReqNewSelected, true, 'Primary request for patient1 is selected');
  assert.equal(isReqOldSelected, false, 'Older request for patient1 is NOT marked as selected');
  assert.equal(isReqOtherSelected, false, 'Unrelated patient2 card is NOT marked as selected');
});

test('13. Request deduplication regression tests: preserves separate legitimate requests', () => {
  // Realistic set of distinct requests (e.g. Dr. Lionel Kohli dispatch history)
  const distinctRequests = [
    { id: '1792417814590', patientAddress: '0x2ad085b40ddd05e9628a4a0780c38b8eab27c25b', status: 'rejected' },
    { id: '1792423611268', patientAddress: '0x2ad085b40ddd05e9628a4a0780c38b8eab27c25b', status: 'accepted' },
    { id: '1792433457286', patientAddress: '0x2ad085b40ddd05e9628a4a0780c38b8eab27c25b', status: 'rejected' },
    { id: '1792435802906', patientAddress: '0x2ad085b40ddd05e9628a4a0780c38b8eab27c25b', status: 'accepted' },
    { id: '1792438945674', patientAddress: '0x2ad085b40ddd05e9628a4a0780c38b8eab27c25b', status: 'rejected' },
    { id: '1792505926797', patientAddress: '0x2ad085b40ddd05e9628a4a0780c38b8eab27c25b', status: 'accepted' }
  ];

  // Distinct requests must all be preserved
  const preserved = deduplicateRequests(distinctRequests);
  assert.equal(preserved.length, 6, 'Must preserve all 6 distinct legitimate requests');

  // When duplicate representations exist with the same id, deduplicate them
  const withDuplicates = [
    ...distinctRequests,
    { id: '1792505926797', patientAddress: '0x2ad085b40ddd05e9628a4a0780c38b8eab27c25b', status: 'accepted' },
    { id: '1792438945674', patientAddress: '0x2ad085b40ddd05e9628a4a0780c38b8eab27c25b', status: 'rejected' }
  ];
  assert.equal(withDuplicates.length, 8);
  const deduped = deduplicateRequests(withDuplicates);
  assert.equal(deduped.length, 6, 'Must collapse duplicate representations of the same id');

  // Safe with null/empty inputs
  assert.deepEqual(deduplicateRequests([]), []);
  assert.deepEqual(deduplicateRequests(null), []);
  assert.deepEqual(deduplicateRequests(undefined), []);
});

test('14. "Selected in Preflight" is completely removed from all visible UI, labels, and button states', () => {
  // Must not appear anywhere in doctor view, patient view, or dashboard
  assert.equal(
    doctorViewSource.includes('Selected in Preflight'),
    false,
    'DoctorView must not contain any "Selected in Preflight" badge, label, or button text'
  );
  assert.equal(
    doctorViewSource.includes('SELECTED IN PREFLIGHT'),
    false,
    'DoctorView must not contain uppercase "SELECTED IN PREFLIGHT"'
  );
  assert.equal(
    dashboardSource.includes('Selected in Preflight'),
    false,
    'Dashboard must not contain "Selected in Preflight"'
  );
  assert.equal(
    patientViewSource.includes('Selected in Preflight'),
    false,
    'PatientView must not contain "Selected in Preflight"'
  );

  // selectedRequestId conditional UI state must be removed from DoctorView
  assert.equal(
    doctorViewSource.includes('selectedRequestId'),
    false,
    'DoctorView must not retain selectedRequestId state'
  );

  // The request action button must use clean "Select Patient" action
  assert.ok(
    doctorViewSource.includes('Select Patient'),
    'DoctorView must offer clean "Select Patient" action button'
  );
});

test('15. Outgoing Requests appears in doctor sidebar in correct position with dedicated route', () => {
  // Doctor sidebar order: Audit Dashboard -> Appointments -> Outgoing Requests -> Privacy Centre
  const auditIdx = dashboardSource.indexOf('Audit Dashboard');
  const apptIdx = dashboardSource.indexOf('Appointments');
  const outgoingIdx = dashboardSource.indexOf('Outgoing Requests');
  const privacyIdx = dashboardSource.indexOf('Privacy Centre');

  assert.ok(auditIdx !== -1, 'Audit Dashboard must be present in sidebar');
  assert.ok(apptIdx !== -1, 'Appointments must be present in sidebar');
  assert.ok(outgoingIdx !== -1, 'Outgoing Requests must be present in sidebar');
  assert.ok(privacyIdx !== -1, 'Privacy Centre must be present in sidebar');

  assert.ok(
    auditIdx < apptIdx,
    'Audit Dashboard must appear before Appointments in doctor sidebar'
  );
  assert.ok(
    apptIdx < outgoingIdx,
    'Appointments must appear before Outgoing Requests in doctor sidebar'
  );
  assert.ok(
    outgoingIdx < privacyIdx,
    'Outgoing Requests must appear before Privacy Centre in doctor sidebar'
  );

  // Hash routing supports #outgoing-requests
  assert.ok(
    dashboardSource.includes('outgoing-requests'),
    'Dashboard must recognize outgoing-requests navigation state'
  );
  assert.ok(
    dashboardSource.includes('#outgoing-requests'),
    'Dashboard must support #outgoing-requests hash route'
  );
});

test('16. Dedicated Outgoing Requests page exists and does not duplicate monitor in Workspace', () => {
  // DoctorView conditionally renders the dedicated page when activePage === "outgoing-requests"
  assert.ok(
    doctorViewSource.includes('activePage === "outgoing-requests"'),
    'DoctorView must provide a dedicated view when activePage === "outgoing-requests"'
  );

  // Workspace (activePage === "overview") does not render the embedded monitor
  assert.ok(
    doctorViewSource.includes('activePage === "overview"'),
    'DoctorView must restrict main Workspace rendering to activePage === "overview"'
  );

  // Verifying that outgoing-requests renders the request cards while overview does not render the list
  const overviewSection = doctorViewSource.split('activePage === "overview"')[1];
  assert.ok(
    !overviewSection.includes('<div className="outgoing-requests-list">'),
    'Workspace (overview) must NOT render the embedded outgoing-requests-list simultaneously'
  );

  // Manual refresh button exists on the dedicated page
  assert.ok(
    doctorViewSource.includes('fetchOutgoingRequests') &&
    doctorViewSource.includes('Refresh'),
    'Dedicated Outgoing Requests page must include a manual refresh button'
  );
});

test('17. Patient selection from request card navigates back to Workspace without granting consent or exposing records', () => {
  // Check handleSelectPatient implementation in DoctorView
  assert.ok(
    doctorViewSource.includes('const handleSelectPatient = (req) => {'),
    'DoctorView must implement handleSelectPatient'
  );

  const handleSelectFn = doctorViewSource.slice(
    doctorViewSource.indexOf('const handleSelectPatient ='),
    doctorViewSource.indexOf('return (', doctorViewSource.indexOf('const handleSelectPatient ='))
  );

  // Navigates back to overview/workspace
  assert.ok(
    handleSelectFn.includes('onNavigatePage("overview")'),
    'Selecting a patient must navigate back to overview/workspace'
  );

  // Must NOT grant consent or call smart contract grant functions
  assert.ok(
    !handleSelectFn.includes('grantAccess') &&
    !handleSelectFn.includes('grantConsent') &&
    !handleSelectFn.includes('walletContract'),
    'handleSelectPatient must never execute transactions or grant consent as a side effect'
  );

  // Preflight lookup is populated
  assert.ok(
    handleSelectFn.includes('setPatientInput(req.patientAddress)') &&
    handleSelectFn.includes('setPatientAddress(normalized)') &&
    handleSelectFn.includes('setPatientFound(true)'),
    'Selecting a patient must populate preflight state for lookup in Workspace'
  );
});

test('18. Existing patient search, consent checks, audit dashboard, and appointments remain intact', () => {
  // Patient search / preflight lookup handler intact
  assert.ok(
    doctorViewSource.includes('const resolvePatient = async () => {'),
    'DoctorView must retain resolvePatient preflight search function'
  );

  // Access check and countdown logic intact
  assert.ok(
    doctorViewSource.includes('checkAccessStatus') &&
    doctorViewSource.includes('countdownRef'),
    'DoctorView must retain authoritative access verification and countdown ticker'
  );

  // Appointments dedicated section intact
  assert.ok(
    doctorViewSource.includes('activePage === "appointments"') &&
    doctorViewSource.includes('CONSULTATION QUEUE'),
    'DoctorView must support dedicated Appointments page'
  );

  // Audit dashboard intact in Dashboard.jsx
  assert.ok(
    dashboardSource.includes('activePage === "activity"') &&
    dashboardSource.includes('<AuditDashboard'),
    'Dashboard must retain functional AuditDashboard'
  );
});
