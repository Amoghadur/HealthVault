import { useState, useEffect, useRef, useCallback } from "react";
import { ConsentStatus } from "./components/ConsentUI";
import { ethers } from "ethers";
import { apiRequest } from "./lib/api";
import { startOriginalRecordView } from "./lib/originalRecordView";
import { walletContract, waitForSuccess, transactionError } from "./lib/blockchain";
import { StatusMessage } from "./components/ui";
import { DEFAULT_RECORD_FILTERS, recordCategory, searchRecords, validateDateRange } from "./lib/recordSearch";
import { formatDispatchedTime, getRequestDisplayInfo, deduplicateRequests } from "./lib/accessRequestUi";
import PillButton from "./components/common/PillButton";
import PillInput from "./components/common/PillInput";
import EmptyState from "./components/common/EmptyState";
import Modal from "./components/common/Modal";

const CONTRACT_ABI = [
  "function uploadRecord(string memory ipfsHash) public",
  "function uploadRecordFor(address patient, string memory ipfsHash) public",
  "function getRecord(address patient) public view returns (string memory)",
  "function hasAccess(address patient, address doctor) public view returns (bool)",
  "function grantAccess(address doctor) public",
  "function revokeAccess(address doctor) public"
];

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

const PROFILE_FIELDS = [
  ["displayName", "Display name", 160, true],
  ["specialty", "Medical specialty", 120, true],
  ["affiliation", "Hospital or clinic affiliation", 200, true],
  ["department", "Department (optional)", 120, false],
  ["registrationNumber", "Professional registration number (optional, unverified)", 100, false],
];
const emptyProfile = () => Object.fromEntries(PROFILE_FIELDS.map(([key]) => [key, ""]));

function DoctorProfileEditor({ account }) {
  const [fields, setFields] = useState(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const requestRef = useRef(null);
  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setLoaded(false);
    setMessage(null);
    try {
      const { profile } = await apiRequest("/profiles/me", { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (profile && profile.walletAddress !== account.toLowerCase()) throw new Error("Wallet session mismatch. Sign out and reconnect.");
      setFields(Object.fromEntries(PROFILE_FIELDS.map(([key]) => [key, profile?.[key] || ""])));
      setLoaded(true);
    } catch (error) {
      if (!controller.signal.aborted) setMessage({ type: "error", text: error.message });
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [account]);
  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => { clearTimeout(timer); requestRef.current?.abort(); };
  }, [load]);
  const save = async event => {
    event.preventDefault();
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setSaving(true);
    setMessage(null);
    try {
      const { profile } = await apiRequest("/profiles/me", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setFields(Object.fromEntries(PROFILE_FIELDS.map(([key]) => [key, profile[key]])));
      setMessage({ type: "success", text: "Profile saved. Professional details remain self-reported and unverified." });
    } catch (error) {
      if (!controller.signal.aborted) setMessage({ type: "error", text: error.message });
    } finally { if (!controller.signal.aborted) setSaving(false); }
  };
  return <section className="panel spatial-panel spatial-layer-1" aria-label="My profile" style={{ padding: '28px', marginBottom: '24px' }}>
    <span className="section-label" style={{ marginBottom: '8px' }}>CARE PROVIDER PROFILE</span>
    <h2 className="two-tone-heading" style={{ fontSize: '20px', margin: '4px 0 8px 0' }}>Professional Credentials</h2>
    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: '720px' }}>
      Patients reviewing your consent requests can see these details. Professional credentials and hospital affiliation are self-reported and unverified. Saving a profile does not grant record access.
    </p>
    <div style={{ margin: '14px 0' }}>
      <label className="field-label">Connected Wallet Address
        <input readOnly value={account} style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', background: 'var(--bg-surface-subtle)' }} />
      </label>
    </div>
    {loading && <p role="status" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Loading profile…</p>}
    <StatusMessage type={message?.type}>{message?.text}</StatusMessage>
    {!loading && !loaded && (
      <PillButton size="sm" variant="outline" onClick={load}>
        Retry loading profile
      </PillButton>
    )}
    {loaded && <form onSubmit={save}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 14, margin: "16px 0 20px" }}>
        {PROFILE_FIELDS.map(([key, label, limit, required]) => (
          <label className="field-label" key={key}>{label}
            <input value={fields[key]} required={required} maxLength={limit} disabled={saving} onChange={event => setFields(previous => ({ ...previous, [key]: event.target.value }))} />
          </label>
        ))}
      </div>
      <PillButton type="submit" variant="primary" size="md" disabled={saving}>
        {saving ? "Saving…" : "Save Profile Details"}
      </PillButton>
    </form>}
  </section>;
}

function OriginalRecordViewer({ record, onStatusRefresh }) {
  const [view, setView] = useState({ status: "loading" });
  useEffect(() => {
    // Re-check authoritative access before opening or downloading the record.
    const attempt = startOriginalRecordView({
      recordId: record.id,
      patientAddress: record.patientAddress,
      baseUrl: API_URL,
      token: localStorage.getItem("healthvault_token"),
      onStatusRefresh,
      onState: setView,
    });
    return () => attempt.close();
  }, [record.id, record.patientAddress, onStatusRefresh]);
  return <div style={{ marginTop: '14px' }}>
    <StatusMessage type="error">{view.error}</StatusMessage>
    {view.status === "loading" && <p role="status" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{view.message || "Checking consent and loading original record…"}</p>}
    {view.status === "ready" && (
      <iframe
        src={view.url}
        title={record.fileName}
        style={{ width: "100%", height: 600, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card-sm)", background: "#FFFFFF" }}
      />
    )}
  </div>;
}

function DoctorRecordHistory({ account, refreshVersion, onStatusRefresh }) {
  const [records, setRecords] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_RECORD_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewingRecord, setViewingRecord] = useState(null);
  const filteredRecords = searchRecords(records, filters);
  const dateRangeError = validateDateRange(filters);
  const setFilter = (field, value) => setFilters(previous => ({ ...previous, [field]: value }));

  const activeViewingRecord = records.some(record => record.id === viewingRecord) ? viewingRecord : null;

  const requestRef = useRef(null);
  const fetchHistory = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");

    try {
      const data = await apiRequest("/records/doctor", { signal: controller.signal, cache: "no-store" });
      if (!controller.signal.aborted) {
        const docLower = account ? account.toLowerCase() : "";
        const myUploads = (data.records || []).filter(r => {
          const rDoc = r.doctorAddress ? r.doctorAddress.toLowerCase() : "";
          if (!rDoc) return false;
          return docLower ? rDoc === docLower : true;
        });
        const uniqueUploads = Array.from(new Map(myUploads.map(r => [r.id, r])).values());
        setRecords(uniqueUploads);
        setError("");
      }
    } catch (err) {
      if (err.name === "AbortError" || controller.signal.aborted) return;
      setError(err.message || "Failed to load upload history.");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [account]);

  useEffect(() => {
    const timer = setTimeout(fetchHistory, 0);
    return () => {
      clearTimeout(timer);
      requestRef.current?.abort();
    };
  }, [fetchHistory, refreshVersion]);

  return <section className="panel spatial-panel spatial-layer-1" aria-label="My Uploaded Prescriptions" style={{ padding: '28px', marginBottom: '24px' }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: '16px' }}>
      <div>
        <span className="section-label" style={{ marginBottom: '6px' }}>CLINICAL RECORD VAULT</span>
        <h2 className="two-tone-heading" style={{ fontSize: "20px", margin: 0 }}>
          My Uploaded Prescriptions & <span className="highlight-primary">Reports</span>
        </h2>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: '4px 0 0 0' }}>
          Only your uploads with current, active patient consent appear. Viewing original files verifies patient consent before streaming.
        </p>
      </div>
      <PillButton size="sm" variant="outline" onClick={fetchHistory} disabled={loading}>
        {loading ? "Loading…" : "Refresh"}
      </PillButton>
    </div>

    {/* Search & Filter Bar */}
    <div className="spatial-layer-1" style={{ padding: "18px", borderRadius: "var(--radius-spatial-md)", marginBottom: "20px" }}>
      <PillInput
        placeholder="Search uploaded records by file name…"
        value={filters.query}
        onChange={e => setFilter("query", e.target.value)}
        icon={<span>🔍</span>}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 12, marginTop: '12px' }}>
        <label className="field-label">Record category
          <select value={filters.category} onChange={e => setFilter("category", e.target.value)}>
            <option value="">All categories</option><option value="prescription">Prescription</option><option value="report">Report</option><option value="unspecified">Unspecified</option>
          </select>
        </label>
        <label className="field-label">Uploaded from<input type="date" value={filters.dateFrom} aria-invalid={!!dateRangeError} onChange={e => setFilter("dateFrom", e.target.value)} /></label>
        <label className="field-label">Uploaded through<input type="date" value={filters.dateTo} aria-invalid={!!dateRangeError} onChange={e => setFilter("dateTo", e.target.value)} /></label>
        <label className="field-label">Sort records
          <select value={filters.sort} onChange={e => setFilter("sort", e.target.value)}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="title">Filename A–Z</option>
          </select>
        </label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
        <button
          type="button"
          onClick={() => setFilters(DEFAULT_RECORD_FILTERS)}
          style={{ background: 'none', border: 'none', color: 'var(--primary-dark)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
        >
          Clear filters
        </button>
      </div>
      {dateRangeError && <StatusMessage type="error">{dateRangeError}</StatusMessage>}
    </div>

    {loading && <p role="status" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Loading upload history…</p>}
    {!loading && error && (
      <div style={{ padding: '16px 0' }}>
        <StatusMessage type="error">{error}</StatusMessage>
        <div style={{ marginTop: '12px' }}>
          <PillButton size="sm" variant="outline" onClick={fetchHistory}>
            Retry Loading Records
          </PillButton>
        </div>
      </div>
    )}
    {!loading && !error && !dateRangeError && <>
      <p role="status" style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '16px' }}>
        Showing {filteredRecords.length} of {records.length} accessible uploaded records.
      </p>

      {records.length === 0 && (
        <EmptyState
          icon="📂"
          title="No uploaded records currently accessible"
          description="When you upload clinical prescriptions or reports for an authenticated patient, they will appear here while consent remains active."
        />
      )}

      {records.length > 0 && filteredRecords.length === 0 && (
        <p className="empty-state" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          No records match your search and filters.
        </p>
      )}

      {[
        ["prescription", "Prescriptions"],
        ["unspecified", "Earlier uploads — type unspecified"],
        ["report", "Uploaded reports"],
      ].map(([type, title]) => {
        const group = filteredRecords.filter(record => recordCategory(record) === type);
        if (!group.length) return null;
        return <section key={type} aria-label={title} style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '10px' }}>
            {title}
          </h3>
          {type === "unspecified" && <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>These records have no recorded category. They may be prescriptions or other clinical documents.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {group.map(record => (
              <article
                key={record.id}
                className="glass-card spatial-layer-2"
                style={{
                  padding: "18px 22px",
                  borderRadius: "var(--radius-spatial-md)",
                  overflowWrap: "anywhere",
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{record.fileName}</strong>
                    <div style={{ fontSize: "12px", color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {type} · Uploaded {new Date(record.uploadedAt).toLocaleString()}
                    </div>
                  </div>
                  <PillButton
                    size="sm"
                    variant={activeViewingRecord === record.id ? "outline" : "primary"}
                    onClick={() => setViewingRecord(activeViewingRecord === record.id ? null : record.id)}
                  >
                    {activeViewingRecord === record.id ? "Close Original" : "View Original PDF"}
                  </PillButton>
                </div>
                {activeViewingRecord === record.id && (
                  <Modal
                    isOpen={activeViewingRecord === record.id}
                    onClose={() => setViewingRecord(null)}
                    title={record.fileName}
                    subtitle={`Uploaded: ${new Date(record.uploadedAt).toLocaleString()} · ${type}`}
                    maxWidth="860px"
                  >
                    <OriginalRecordViewer key={record.id} record={record} onStatusRefresh={onStatusRefresh} />
                  </Modal>
                )}
              </article>
            ))}
          </div>
        </section>;
      })}
    </>}
  </section>;
}

export default function DoctorView({ account, activePage = "overview", onNavigatePage }) {
  const [feedback, setFeedback] = useState(null);
  const notify = (text, type = "error") => setFeedback({ text, type });
  const [patientInput, setPatientInput] = useState("");
  const [patientAddress, setPatientAddress] = useState("");
  const [patientLabel, setPatientLabel] = useState("");
  const [patientFound, setPatientFound] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [resolveLoading, setResolveLoading] = useState(false);
  const [accessStatus, setAccessStatus] = useState(null);
  // Backend-authoritative access detail: { status, expiresAt, remainingSeconds }
  const [accessDetail, setAccessDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [prescription, setPrescription] = useState(null);
  const [recordType, setRecordType] = useState("");
  const [uploadStatus, setUploadStatus] = useState(null);
  const [requestSent, setRequestSent] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);
  const [outgoingRequests, setOutgoingRequests] = useState([]);
  const [outgoingLoading, setOutgoingLoading] = useState(false);
  const [outgoingError, setOutgoingError] = useState("");
  const outgoingInFlightRef = useRef(false);
  const doctorMountedRef = useRef(true);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [sessionUploadCount, setSessionUploadCount] = useState(0);
  const [doctorAppointments, setDoctorAppointments] = useState([]);
  const [apptLoading, setApptLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [appointmentMessage, setAppointmentMessage] = useState(null);
  const [patientPublicProfile, setPatientPublicProfile] = useState(null);
  const [patientProfileLoading, setPatientProfileLoading] = useState(false);
  const [patientProfileError, setPatientProfileError] = useState(null);
  const [isPrivacyRestricted, setIsPrivacyRestricted] = useState(false);
  const countdownRef = useRef(null);

  // Fetch patient profile:
  // Before active consent: calls /api/patient/profile/lookup/:address (respects privacy toggle)
  // After active consent: calls /api/patient/profile/public/:address (consent-authorized)
  const fetchPatientProfile = useCallback(async (patAddr, hasConsent) => {
    if (!patAddr || !ethers.isAddress(patAddr)) {
      setPatientPublicProfile(null);
      setIsPrivacyRestricted(false);
      setPatientProfileLoading(false);
      return;
    }
    setPatientProfileLoading(true);
    setPatientProfileError(null);
    try {
      const endpoint = hasConsent
        ? `/api/patient/profile/public/${encodeURIComponent(patAddr)}`
        : `/api/patient/profile/lookup/${encodeURIComponent(patAddr)}`;
      const data = await apiRequest(endpoint, { cache: 'no-store' });
      if (data?.profile) {
        setPatientPublicProfile(data.profile);
        setIsPrivacyRestricted(Boolean(!hasConsent && data.privacyRestricted));
      } else {
        setPatientPublicProfile(null);
        setIsPrivacyRestricted(false);
      }
    } catch (err) {
      if (hasConsent && err.message && (err.message.includes('403') || err.message.includes('consent'))) {
        try {
          const fallback = await apiRequest(`/api/patient/profile/lookup/${encodeURIComponent(patAddr)}`, { cache: 'no-store' });
          setPatientPublicProfile(fallback?.profile || null);
          setIsPrivacyRestricted(Boolean(fallback?.privacyRestricted));
          return;
        } catch {
          // ignore fallback error
        }
      }
      setPatientProfileError(err.message || 'Failed to load patient profile.');
      setPatientPublicProfile(null);
    } finally {
      setPatientProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!patientAddress || !ethers.isAddress(patientAddress)) {
      return;
    }
    const timer = setTimeout(() => fetchPatientProfile(patientAddress, accessStatus === true), 0);
    return () => clearTimeout(timer);
  }, [patientAddress, accessStatus, fetchPatientProfile]);

  const visiblePatientProfile = patientAddress ? patientPublicProfile : null;

  const [patientRecords, setPatientRecords] = useState([]);
  const [patientRecordsLoading, setPatientRecordsLoading] = useState(false);
  const [patientRecordsError, setPatientRecordsError] = useState("");
  const [viewingPatientRecord, setViewingPatientRecord] = useState(null);

  const fetchPatientRecords = useCallback(async (patAddr) => {
    if (!patAddr || !ethers.isAddress(patAddr)) return;
    const controller = new AbortController();
    setPatientRecordsLoading(true);
    setPatientRecordsError("");
    try {
      const data = await apiRequest("/records/doctor", { signal: controller.signal, cache: "no-store" });
      if (!controller.signal.aborted) {
        const patLower = patAddr.toLowerCase();
        const docLower = account ? account.toLowerCase() : "";
        const records = (data?.records || []).filter((r) => {
          const rPat = r.patientAddress ? r.patientAddress.toLowerCase() : "";
          const rDoc = r.doctorAddress ? r.doctorAddress.toLowerCase() : "";
          if (rPat !== patLower) return false;
          // Patient clinical documents must show ONLY records that the doctor did NOT upload
          if (docLower && rDoc === docLower) return false;
          return true;
        });
        const unique = Array.from(new Map(records.map(r => [r.id, r])).values());
        setPatientRecords(unique);
      }
    } catch (err) {
      if (err.name === "AbortError" || controller.signal.aborted) return;
      setPatientRecordsError(err.message || "Failed to load patient records.");
    } finally {
      if (!controller.signal.aborted) {
        setPatientRecordsLoading(false);
      }
    }
  }, [account]);

  useEffect(() => {
    if (!patientAddress || !ethers.isAddress(patientAddress) || !accessStatus) {
      return;
    }
    const timer = setTimeout(() => fetchPatientRecords(patientAddress), 0);
    return () => clearTimeout(timer);
  }, [patientAddress, accessStatus, historyVersion, fetchPatientRecords]);

  const visiblePatientRecords = (patientAddress && accessStatus) ? patientRecords : [];

  // Stable across countdown/status updates: a viewer result must not abort its own load.
  const handleRecordStatusRefresh = useCallback((patAddr, statusData) => {
    if (patientAddress && patAddr.toLowerCase() === patientAddress.toLowerCase()) {
      setAccessStatus(statusData.hasAccess === true);
      setAccessDetail(statusData);
    }
  }, [patientAddress]);

  // Authoritative access check via backend (checks BOTH expiry AND on-chain consent)
  const checkAccessStatus = useCallback(async (patAddr) => {
    if (!patAddr || !ethers.isAddress(patAddr)) return;
    try {
      const data = await apiRequest(`/records/check/${encodeURIComponent(patAddr)}`, { cache: "no-store" });
      setAccessStatus(data.hasAccess === true);
      setAccessDetail(data);
      setResolveError("");
      if (data.hasAccess) setRequestSent(false);
    } catch (err) {
      if (err.name === "AbortError") return;
      if (err.message?.includes("session") || err.message?.includes("401")) {
        setAccessStatus(null);
        setAccessDetail({ status: "verification-unavailable" });
        setResolveError("Session expired. Sign out and connect again.");
      } else {
        setAccessStatus(null);
        setAccessDetail({ status: "verification-unavailable" });
        setResolveError("Could not verify access. Check your connection and retry.");
      }
    }
  }, []);

  // Poll backend every 5 seconds for authoritative access status
  useEffect(() => {
    if (!patientAddress || !ethers.isAddress(patientAddress)) {
      return;
    }

    const timer = setTimeout(() => checkAccessStatus(patientAddress), 0);
    const interval = setInterval(() => checkAccessStatus(patientAddress), 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [patientAddress, checkAccessStatus]);

  // Countdown ticker: update remaining seconds locally and trigger re-check at expiry
  useEffect(() => {
    clearInterval(countdownRef.current);
    if (!accessDetail?.expiresAt || accessDetail.status !== "active") return;

    countdownRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.round((Date.parse(accessDetail.expiresAt) - Date.now()) / 1000));
      if (remaining <= 0) {
        // Expiry reached — immediately re-check authoritative status
        clearInterval(countdownRef.current);
        setAccessStatus(false);
        setAccessDetail(prev => prev ? { ...prev, status: "expired", remainingSeconds: 0 } : prev);
        checkAccessStatus(patientAddress);
      } else {
        setAccessDetail(prev => prev ? { ...prev, remainingSeconds: remaining } : prev);
      }
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, [accessDetail?.expiresAt, accessDetail?.status, patientAddress, checkAccessStatus]);

  // Doctor outgoing requests state management & unmount guard
  useEffect(() => {
    doctorMountedRef.current = true;
    return () => {
      doctorMountedRef.current = false;
    };
  }, []);

  const fetchOutgoingRequests = useCallback(async () => {
    if (outgoingInFlightRef.current) return;
    outgoingInFlightRef.current = true;
    setOutgoingLoading(true);
    setOutgoingError("");
    try {
      const token = localStorage.getItem("healthvault_token");
      if (!token) {
        if (doctorMountedRef.current) {
          setOutgoingLoading(false);
          outgoingInFlightRef.current = false;
        }
        return;
      }
      const data = await apiRequest("/consent/requests?type=outgoing", { cache: "no-store" });
      if (!doctorMountedRef.current) return;
      const rawRequests = Array.isArray(data?.requests) ? data.requests : [];
      const deduped = deduplicateRequests(rawRequests).sort((a, b) => {
        const timeA = Date.parse(a.requestedAt || a.createdAt || 0) || 0;
        const timeB = Date.parse(b.requestedAt || b.createdAt || 0) || 0;
        return timeB - timeA;
      });
      setOutgoingRequests(deduped);
      setOutgoingError("");
    } catch (err) {
      if (doctorMountedRef.current) {
        setOutgoingError(err.message || "Failed to load outgoing access requests.");
      }
    } finally {
      if (doctorMountedRef.current) {
        setOutgoingLoading(false);
        outgoingInFlightRef.current = false;
      }
    }
  }, []);

  // Poll outgoing requests every 10s and fetch immediately on mount
  useEffect(() => {
    const timer = setTimeout(fetchOutgoingRequests, 0);
    const interval = setInterval(fetchOutgoingRequests, 10000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [fetchOutgoingRequests]);

  // Re-check access and outgoing requests on page focus / visibility change
  useEffect(() => {
    const onFocus = () => {
      fetchOutgoingRequests();
      if (patientAddress && ethers.isAddress(patientAddress)) {
        checkAccessStatus(patientAddress);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [patientAddress, checkAccessStatus, fetchOutgoingRequests]);

  // Derived pending request status for selected patient
  const hasPendingOutgoingForPatient = Boolean(
    patientAddress && outgoingRequests.some(
      r => (r.patientAddress || "").toLowerCase() === patientAddress.toLowerCase() && r.status === "pending"
    )
  );
  const isRequestPending = accessStatus !== true && (requestSent || hasPendingOutgoingForPatient);

  const resolvePatient = async () => {
    const input = patientInput.trim();
    setResolveError("");
    if (feedback?.text === "Enter a Patient ID like HV-1001 or a wallet address") {
      setFeedback(null);
    }

    if (!input) {
      setResolveError("Enter a Patient ID like HV-1001 or a wallet address");
      return;
    }

    const isEthAddress = ethers.isAddress(input);
    const isHvId = /^HV-\d+$/i.test(input);

    if (!isEthAddress && !isHvId) {
      setResolveError("Enter a Patient ID like HV-1001 or a wallet address");
      return;
    }

    setResolveLoading(true);
    setPatientAddress("");
    setPatientFound(false);
    setAccessStatus(null);
    setAccessDetail(null);
    setPatientPublicProfile(null);
    setIsPrivacyRestricted(false);
    setPatientProfileLoading(false);
    setPatientProfileError(null);
    setRequestSent(false);
    setUploadStatus(null);

    try {
      if (isEthAddress) {
        const normalized = input.toLowerCase();
        setPatientAddress(normalized);
        setPatientLabel(normalized.slice(0, 8) + "..." + normalized.slice(-4));
        setPatientFound(true);
        const isAlreadyPending = outgoingRequests.some(
          r => (r.patientAddress || "").toLowerCase() === normalized && r.status === "pending"
        );
        setRequestSent(isAlreadyPending);
        if (feedback?.text === "Enter a Patient ID like HV-1001 or a wallet address") {
          setFeedback(null);
        }
      } else {
        const token = localStorage.getItem("healthvault_token");
        const res = await fetch(`${API_URL}/auth/lookup/${encodeURIComponent(input.toUpperCase())}`, {
          headers: token ? { "Authorization": `Bearer ${token}` } : {}
        });
        const data = await res.json();
        if (!res.ok || !data.address) {
          setResolveError(data.error || "Patient ID not found. Ask the patient for their HealthVault ID.");
          return;
        }
        const normalized = data.address.toLowerCase();
        setPatientAddress(normalized);
        setPatientLabel(data.patientId);
        setPatientFound(true);
        const isAlreadyPending = outgoingRequests.some(
          r => (r.patientAddress || "").toLowerCase() === normalized && r.status === "pending"
        );
        setRequestSent(isAlreadyPending);
        if (feedback?.text === "Enter a Patient ID like HV-1001 or a wallet address") {
          setFeedback(null);
        }
      }
    } catch (err) {
      setResolveError("Error: " + err.message);
    } finally {
      if (doctorMountedRef.current) {
        setResolveLoading(false);
      }
    }
  };

  const sendAccessRequest = async () => {
    if (!patientAddress) return notify("Find a patient first");
    try {
      setRequestLoading(true);
      const token = localStorage.getItem("healthvault_token");
      const res = await fetch(`${API_URL}/consent/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          patientAddress: patientAddress.toLowerCase(),
          reason: "Medical consultation and record access"
        })
      });
      const data = await res.json();
      if (data.success) {
        setRequestSent(true);
        notify("Request sent. The patient can respond in Manage Access.", "success");
        await fetchOutgoingRequests();
      } else {
        notify("Error: " + (data.error || "Could not send request"));
      }
    } catch (err) {
      notify("Error: " + err.message);
    } finally {
      if (doctorMountedRef.current) {
        setRequestLoading(false);
      }
    }
  };

  const uploadPrescription = async () => {
    if (!patientAddress) { setUploadStatus({ type: "error", text: "Find a patient first." }); return; }
    if (!prescription) { setUploadStatus({ type: "error", text: "Choose a PDF to upload." }); return; }
    if (!recordType) { setUploadStatus({ type: "error", text: "Choose Prescription or Report." }); return; }
    const token = localStorage.getItem("healthvault_token");
    if (!token) { setUploadStatus({ type: "error", text: "Session expired. Sign in again." }); return; }

    // Re-verify authoritative access before starting upload
    try {
      const check = await apiRequest(`/records/check/${encodeURIComponent(patientAddress)}`, { cache: "no-store" });
      setAccessStatus(check.hasAccess === true);
      setAccessDetail(check);
      if (!check.hasAccess) {
        setUploadStatus({
          type: "error",
          text: check.status === "expired"
            ? "Upload failed: Patient access consent has expired. Access is required before uploading."
            : "Upload failed: Patient access consent is not active."
        });
        return;
      }
    } catch (err) {
      setUploadStatus({ type: "error", text: "Could not verify patient consent on-chain. " + err.message });
      return;
    }

    try {
      setLoading(true);
      setUploadStatus({ type: "info", text: "Step 1 of 3 — Uploading file to server for AES-256-GCM encryption..." });
      const formData = new FormData();
      formData.append("file", prescription);
      formData.append("patientAddress", patientAddress);
      formData.append("recordType", recordType);

      const response = await fetch(`${API_URL}/records/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      setHistoryVersion(version => version + 1);
      setPrescription(null);

      setUploadStatus({ type: "info", text: "Step 2 of 3 — Server upload complete. Recording returned hash on blockchain..." });

      const contract = await walletContract(CONTRACT_ABI, account);

      setUploadStatus({ type: "info", text: "Step 3 of 3 — Please confirm in MetaMask..." });
      const transaction = await contract.uploadRecordFor(patientAddress, data.ipfsHash);
      const receipt = await waitForSuccess(transaction);

      setSessionUploadCount(count => count + 1);

      setUploadStatus({
        type: "success",
        text: `✅ Record uploaded successfully!\n\n🔒 Encrypted with AES-256\n📦 Stored by server (IPFS availability not independently verified)\n⛓ Hash on Ethereum blockchain\n\nIPFS Hash:\n${data.ipfsHash}\n\nTransaction:\n${receipt.hash}`
      });
    } catch (err) {
      setUploadStatus({ type: "error", text: transactionError(err) + " A server upload may already exist; check upload history before uploading again." });
    } finally {
      setLoading(false);
      setHistoryVersion(version => version + 1);
    }
  };

  const fetchAppointments = useCallback(async () => {
    try {
      setApptLoading(true);
      const data = await apiRequest("/appointments/doctor");
      setDoctorAppointments(data.appointments || []);
    } catch (err) {
      setAppointmentMessage({ type: "error", text: err.message });
    } finally {
      setApptLoading(false);
    }
  }, []);

  useEffect(() => { const timer = setTimeout(fetchAppointments, 0); return () => clearTimeout(timer); }, [fetchAppointments]);

  const confirmAppointment = async (id) => {
    try {
      const token = localStorage.getItem("healthvault_token");
      setConfirmingId(id);
      const result = await apiRequest(`/appointments/confirm/${id}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      setDoctorAppointments(prev =>
        prev.map(a => a.id === id ? result.appointment : a)
      );
    } catch (err) {
      setAppointmentMessage({ type: "error", text: err.message });
    } finally { setConfirmingId(null); }
  };

  const handleSelectPatient = (req) => {
    if (!req?.patientAddress) return;
    setPatientInput(req.patientAddress);
    const normalized = req.patientAddress.toLowerCase();
    setPatientAddress(normalized);
    setPatientLabel(normalized.slice(0, 8) + "..." + normalized.slice(-4));
    setPatientFound(true);
    setRequestSent(req.status === "pending");
    if (typeof onNavigatePage === "function") {
      onNavigatePage("overview");
    }
  };

  return (
    <div className="role-view doctor-view">
      <StatusMessage type={feedback?.type}>{feedback?.text}</StatusMessage>

      {/* Dedicated Page: Outgoing Requests */}
      {activePage === "outgoing-requests" && (
        <section
          className="panel spatial-panel spatial-layer-1"
          aria-label="Outgoing Access Requests"
          style={{ padding: "28px", marginBottom: "24px" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: "16px" }}>
            <div>
              <span className="section-label" style={{ marginBottom: "6px" }}>ACCESS DISPATCH</span>
              <h3 className="two-tone-heading" style={{ fontSize: "20px", margin: 0 }}>
                Outgoing Access <span className="highlight-primary">Requests</span>
              </h3>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "4px 0 0 0" }}>
                Track access requests dispatched to patients. Updates automatically when patients approve or reject.
              </p>
            </div>
            <PillButton
              size="sm"
              variant="outline"
              onClick={fetchOutgoingRequests}
              disabled={outgoingLoading}
            >
              {outgoingLoading ? "Refreshing…" : "Refresh"}
            </PillButton>
          </div>

          {outgoingLoading && outgoingRequests.length === 0 && (
            <p role="status" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              ⏳ Checking outgoing requests…
            </p>
          )}

          {outgoingError && (
            <div style={{ marginBottom: "16px" }}>
              <StatusMessage type="error">{outgoingError}</StatusMessage>
              <div style={{ marginTop: "10px" }}>
                <PillButton size="sm" variant="outline" onClick={fetchOutgoingRequests}>
                  Retry Loading Outgoing Requests
                </PillButton>
              </div>
            </div>
          )}

          {!outgoingLoading && !outgoingError && outgoingRequests.length === 0 && (
            <EmptyState
              icon="📨"
              title="No outgoing access requests dispatched"
              description="When you find a patient and send an access request, its live status will be tracked here."
            />
          )}

          {outgoingRequests.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {outgoingRequests.map((req) => {
                const displayInfo = getRequestDisplayInfo(req, patientAddress, accessDetail);
                const dispatchedText = formatDispatchedTime(req.requestedAt || req.createdAt);
                return (
                  <div
                    key={req.id}
                    className="glass-card spatial-layer-2"
                    style={{
                      padding: "16px 20px",
                      borderRadius: "var(--radius-spatial-md)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "12px",
                      border: "1px solid var(--border-subtle)"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      {req.patientAvatar ? (
                        <img
                          src={req.patientAvatar}
                          alt=""
                          style={{ width: "36px", height: "36px", borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "50%",
                            background: "var(--primary-tint, #eff6ff)",
                            color: "var(--primary-dark, #1d4ed8)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700,
                            fontSize: "14px",
                            flexShrink: 0
                          }}
                        >
                          {(req.patientName || "P").trim().charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>
                            {req.patientName || `Patient: ${(req.patientAddress || "").slice(0, 10)}…${(req.patientAddress || "").slice(-4)}`}
                          </strong>
                          {req.patientAddress && (
                            <code style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-secondary)" }}>
                              {(req.patientAddress || "").slice(0, 8)}…{(req.patientAddress || "").slice(-4)}
                            </code>
                          )}
                          <span
                            data-testid={`request-status-${req.id}`}
                            className={`badge-status ${displayInfo.badgeClass}`}
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: "var(--radius-pill)",
                              background: displayInfo.bg,
                              color: displayInfo.color
                            }}
                          >
                            {displayInfo.icon} {displayInfo.label}
                          </span>
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
                          Dispatched: {dispatchedText} · Reason: {req.reason || "Consultation"}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "8px" }}>
                      {req.patientAddress && (
                        <PillButton
                          size="sm"
                          variant="outline"
                          onClick={() => handleSelectPatient(req)}
                        >
                          Select Patient
                        </PillButton>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Main Workspace (overview) */}
      {activePage === "overview" && (
        <>
          {/* Doctor Profile Banner */}
          <div
            className="glass-card spatial-layer-2"
        style={{
          padding: "24px 28px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "20px",
          marginBottom: "28px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              background: "var(--accent-gradient)",
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "18px",
              fontWeight: 700,
              boxShadow: "0 4px 14px rgba(35, 128, 113, 0.3)",
            }}
          >
            ✚
          </div>
          <div>
            <h2 className="two-tone-heading" style={{ fontSize: "22px", margin: "0 0 4px 0" }}>
              Welcome, <span className="highlight-primary">Care Provider</span>
            </h2>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Authenticated · Cryptographic access restricted to verified patient grants
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "var(--bg-surface-subtle)",
            padding: "8px 16px",
            borderRadius: "var(--radius-pill)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
            Session Wallet
          </span>
          <code style={{ fontSize: "12px", fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--primary-dark)" }}>
            {account.slice(0, 8)}…{account.slice(-4)}
          </code>
        </div>
      </div>

      {/* Stats Row in Big Number Style */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
          gap: "16px",
          marginBottom: "28px",
        }}
      >
        {[
          { label: "Selected Patient", value: patientFound ? "1 Active" : "None", detail: patientLabel || "Search by ID or 0x" },
          { label: "Pending Outgoing", value: String(outgoingRequests.filter(r => r.status === "pending").length), detail: "Awaiting patient approval" },
          { label: "Session Uploads", value: String(sessionUploadCount), detail: "Confirmed on-chain this session" },
          { label: "Appointment Requests", value: String(doctorAppointments.length), detail: "Pending patient consultations" },
        ].map((item, idx) => (
          <div
            key={idx}
            className="stat-card spatial-layer-2"
            style={{
              padding: "22px 20px",
            }}
          >
            <span className="stat-label">{item.label}</span>
            <div className="stat-value">{item.value}</div>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{item.detail}</span>
          </div>
        ))}
      </div>

      {/* Patient Lookup & Live Consent Verification Panel */}
      <div
        className="panel spatial-panel spatial-layer-1"
        style={{
          padding: "28px",
          marginBottom: "24px",
        }}
      >
        <span className="section-label" style={{ marginBottom: "6px" }}>
          IDENTITY & ACCESS PREFLIGHT
        </span>
        <h3 className="two-tone-heading" style={{ fontSize: "20px", margin: "0 0 6px 0" }}>
          Find Patient & <span className="highlight-primary">Verify Consent</span>
        </h3>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "20px" }}>
          Enter a patient’s unique HealthVault ID (e.g. HV-1001) or full Ethereum wallet address.
        </p>

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
          <div style={{ flex: 1, minWidth: "260px" }}>
            <PillInput
              aria-label="Patient ID or wallet address"
              placeholder="HV-1001  or  0x38E602..."
              value={patientInput}
              onChange={(e) => {
                setPatientInput(e.target.value);
                setResolveError("");
                if (feedback?.text === "Enter a Patient ID like HV-1001 or a wallet address") {
                  setFeedback(null);
                }
              }}
              onKeyDown={(e) => e.key === "Enter" && resolvePatient()}
              icon={<span>🔍</span>}
            />
          </div>
          <PillButton
            size="md"
            variant="primary"
            onClick={resolvePatient}
            disabled={resolveLoading}
          >
            {resolveLoading ? "Resolving…" : "Find Patient"}
          </PillButton>
        </div>

        {resolveError && (
          <div style={{ marginBottom: "16px" }}>
            <StatusMessage type="error">{resolveError}</StatusMessage>
          </div>
        )}

        {patientFound && (
          <div>
            {/* Patient Header Card */}
            <div
              className="glass-card spatial-layer-2"
              style={{
                background: "var(--primary-tint)",
                borderRadius: "var(--radius-spatial-md)",
                border: "1px solid var(--primary-light)",
                padding: "20px",
                display: "flex",
                alignItems: "center",
                gap: "16px",
                marginBottom: "20px",
              }}
            >
              <div
                style={{
                  width: "44px",
                  height: "44px",
                  borderRadius: "50%",
                  overflow: "hidden",
                  background: "var(--primary-dark)",
                  color: "#FFFFFF",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "18px",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {visiblePatientProfile?.avatar ? (
                  <img
                    src={visiblePatientProfile.avatar}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  (visiblePatientProfile?.displayName || "P").charAt(0).toUpperCase()
                )}
              </div>
              <div style={{ flex: 1 }}>
                <strong style={{ fontSize: "15px", color: "var(--text-primary)" }}>
                  {visiblePatientProfile?.displayName || (isPrivacyRestricted && !accessStatus ? "Anonymous Patient" : "Patient")}
                </strong>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                  {accessStatus === true
                    ? "Active Cryptographic Consent Granted"
                    : isPrivacyRestricted
                    ? "Identity Restricted · Consent Required to View Name & Records"
                    : "Consent Required to View Records"}
                </div>
                <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--primary-dark)', marginTop: '3px' }}>
                  {patientLabel && !patientAddress.toLowerCase().startsWith(patientLabel.toLowerCase().slice(0, 6))
                    ? `ID: ${patientLabel} · ${patientAddress.slice(0, 10)}…${patientAddress.slice(-4)}`
                    : `Wallet: ${patientAddress.slice(0, 10)}…${patientAddress.slice(-4)}`}
                </div>
              </div>
            </div>

            {/* Authoritative Live Consent Status Badge */}
            <div style={{ marginBottom: "20px" }}>
              <ConsentStatus detail={accessDetail ? { ...accessDetail, hasAccess: accessStatus } : null} />
            </div>

            {/* Send Access Request when no active consent */}
            {accessStatus !== true && (
              <div
                className="spatial-layer-1"
                style={{
                  borderRadius: "var(--radius-spatial-md)",
                  padding: "20px",
                  marginBottom: "20px",
                }}
              >
                <div style={{ marginBottom: "14px" }}>
                  <PillButton
                    size="md"
                    variant={isRequestPending ? "outline" : "primary"}
                    onClick={sendAccessRequest}
                    disabled={requestLoading || isRequestPending}
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    {isRequestPending ? "✓ Access Request Sent — Awaiting Patient Approval" : requestLoading ? "Sending…" : "📨 Send Access Request to Patient"}
                  </PillButton>
                </div>

                <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  <strong>Access Flow:</strong>
                  <ol style={{ margin: "6px 0 0 18px", padding: 0 }}>
                    <li>Click Send Access Request above.</li>
                    <li>Patient opens Access Control tab on their dashboard.</li>
                    <li>Patient confirms temporary grant duration and approves in MetaMask.</li>
                    <li>This workspace synchronizes automatically within 5 seconds.</li>
                  </ol>
                </div>

                {accessStatus === false && !isRequestPending && (
                  <div style={{
                    background: accessDetail?.status === "expired" ? "var(--status-warning-bg)" : "var(--status-error-bg)",
                    borderRadius: "var(--radius-inner)", padding: "12px 14px", fontSize: "12px",
                    color: accessDetail?.status === "expired" ? "var(--status-warning-text)" : "var(--status-error-text)",
                    lineHeight: 1.6, marginTop: "14px",
                    border: "1px solid var(--border-subtle)"
                  }}>
                    {accessDetail?.status === "expired"
                      ? "⏳ Temporary consent has expired. Please send a new access request to the patient."
                      : accessDetail?.status === "verification-unavailable"
                      ? "⚠️ Unable to verify patient consent on-chain. Check your connection and retry."
                      : "No access — patient has not approved yet. Send an access request using the button above."}
                  </div>
                )}
              </div>
            )}

            {/* Clinical Patient Record Viewer (Clean Layout with Sticky Summary) */}
            {accessStatus === true && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
                  gap: "20px",
                  marginTop: "24px",
                }}
              >
                {/* Patient Summary (Real profile data from backend) */}
                <div
                  className="glass-card spatial-layer-2"
                  style={{
                    padding: "20px",
                    borderRadius: "var(--radius-spatial-md)",
                    height: "fit-content",
                  }}
                >
                  <span className="section-label" style={{ marginBottom: "8px" }}>
                    PATIENT PROFILE
                  </span>
                  <h4 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 10px 0" }}>
                    Patient Summary
                  </h4>

                  {patientProfileLoading ? (
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontStyle: "italic", padding: "8px 0" }}>
                      Loading patient profile…
                    </div>
                  ) : patientProfileError ? (
                    <div style={{ fontSize: "12px", color: "var(--status-error-text)", padding: "8px 0" }}>
                      {patientProfileError}
                    </div>
                  ) : visiblePatientProfile?.displayName ? (
                    <div style={{ fontSize: "12px", lineHeight: 1.8, color: "var(--text-secondary)" }}>
                      <div><strong>Name:</strong> {visiblePatientProfile.displayName}</div>
                      <div><strong>Wallet:</strong> <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>{visiblePatientProfile.walletAddress || patientAddress}</code></div>
                      <div><strong>Consent:</strong> Active {accessDetail?.remainingSeconds ? `(${Math.floor(accessDetail.remainingSeconds / 60)}m ${accessDetail.remainingSeconds % 60}s remaining)` : "on-chain"}</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "12px", lineHeight: 1.8, color: "var(--text-secondary)" }}>
                      <div><strong>Wallet:</strong> <code style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>{patientAddress}</code></div>
                      <div><strong>Consent:</strong> Active {accessDetail?.remainingSeconds ? `(${Math.floor(accessDetail.remainingSeconds / 60)}m ${accessDetail.remainingSeconds % 60}s remaining)` : "on-chain"}</div>
                      <div style={{ marginTop: "8px", color: "var(--text-tertiary)", fontStyle: "italic" }}>
                        No additional profile fields configured by patient.
                      </div>
                    </div>
                  )}
                </div>

                {/* Accessible Clinical Records (Real records granted by patient) */}
                <div>
                  <span className="section-label" style={{ marginBottom: "8px" }}>
                    AUTHORIZED RECORDS
                  </span>
                  <h4 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 12px 0" }}>
                    Patient Clinical Documents
                  </h4>

                  {patientRecordsLoading && (
                    <p role="status" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                      Loading authorized patient documents…
                    </p>
                  )}

                  {!patientRecordsLoading && patientRecordsError && (
                    <StatusMessage type="error">{patientRecordsError}</StatusMessage>
                  )}

                  {!patientRecordsLoading && !patientRecordsError && visiblePatientRecords.length === 0 && (
                    <EmptyState
                      icon="📂"
                      title="No clinical documents shared yet"
                      description="The patient hasn't shared any records yet."
                    />
                  )}

                  {!patientRecordsLoading && !patientRecordsError && visiblePatientRecords.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {visiblePatientRecords.map((rec) => (
                        <div
                          key={rec.id}
                          className="glass-card spatial-layer-2"
                          style={{
                            padding: "16px 20px",
                            borderRadius: "var(--radius-spatial-md)",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
                            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                              <span style={{ fontSize: "20px" }}>{rec.recordType === "prescription" ? "💊" : "📄"}</span>
                              <div>
                                <strong style={{ fontSize: "13px", color: "var(--text-primary)" }}>{rec.fileName}</strong>
                                <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }}>
                                  {new Date(rec.uploadedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {rec.recordType}
                                </div>
                              </div>
                            </div>
                            <PillButton
                              size="sm"
                              variant="outline"
                              onClick={() => setViewingPatientRecord(rec)}
                            >
                              View Original PDF
                            </PillButton>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {viewingPatientRecord && (
                    <Modal
                      isOpen={!!viewingPatientRecord}
                      onClose={() => setViewingPatientRecord(null)}
                      title={viewingPatientRecord.fileName}
                      subtitle={`Uploaded: ${new Date(viewingPatientRecord.uploadedAt).toLocaleString()} · ${viewingPatientRecord.recordType}`}
                      maxWidth="860px"
                    >
                      <OriginalRecordViewer
                        record={viewingPatientRecord}
                        onStatusRefresh={handleRecordStatusRefresh}
                      />
                    </Modal>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>



      {/* Upload Prescription or Report (Accessible strictly when consent is active) */}
      {accessStatus === true && (
        <div
          className="panel spatial-panel spatial-layer-1"
          style={{
            padding: "28px",
            marginBottom: "24px",
          }}
        >
          <span className="section-label" style={{ marginBottom: "6px" }}>
            RECORD UPLOAD
          </span>
          <h3 className="two-tone-heading" style={{ fontSize: "20px", margin: "0 0 8px 0" }}>
            Upload Prescription or <span className="highlight-primary">Report</span>
          </h3>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: "20px" }}>
            The server encrypts and stores the file with AES-256-GCM. MetaMask then records its cryptographic hash on-chain.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
              gap: "16px",
              marginBottom: "18px",
            }}
          >
            <label className="field-label">Record Type
              <select value={recordType} disabled={loading} onChange={e => setRecordType(e.target.value)}>
                <option value="">Choose record type</option>
                <option value="prescription">Prescription</option>
                <option value="report">Report</option>
              </select>
            </label>

            <label className="field-label">Select PDF Document
              <input
                aria-label="Prescription or report PDF"
                type="file"
                accept="application/pdf,.pdf"
                disabled={loading}
                onChange={e => { setPrescription(e.target.files?.[0] || null); setUploadStatus(null); }}
              />
            </label>
          </div>

          {prescription && (
            <div style={{ padding: "10px 16px", borderRadius: "var(--radius-pill)", background: "var(--primary-tint)", fontSize: "12px", color: "var(--primary-dark)", marginBottom: "16px" }}>
              📎 {prescription.name} ({(prescription.size / 1024).toFixed(1)} KB)
            </div>
          )}

          <PillButton
            size="lg"
            variant="primary"
            onClick={uploadPrescription}
            disabled={loading || !prescription || !recordType}
          >
            {loading ? "Processing Encryption & Consensus…" : "🔒 Encrypt and Anchor to Blockchain"}
          </PillButton>

          {uploadStatus && (
            <div style={{ marginTop: "16px" }}>
              <StatusMessage type={uploadStatus.type}>{uploadStatus.text}</StatusMessage>
            </div>
          )}
        </div>
      )}

      {/* Doctor Record History */}
      <DoctorRecordHistory
        account={account}
        refreshVersion={historyVersion}
        onStatusRefresh={handleRecordStatusRefresh}
      />

      {/* Doctor Profile Editor */}
      <DoctorProfileEditor key={account} account={account} />

        </>
      )}

      {/* Dedicated Page: Appointments */}
      {activePage === "appointments" && (
        <section
          className="panel spatial-panel spatial-layer-1"
          style={{
            padding: "28px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
            <div>
              <span className="section-label" style={{ marginBottom: "6px" }}>
                CONSULTATION QUEUE
              </span>
              <h3 className="two-tone-heading" style={{ fontSize: "20px", margin: 0 }}>
                Patient Appointment <span className="highlight-primary">Requests</span>
              </h3>
            </div>

            <PillButton
              size="sm"
              variant="outline"
              onClick={fetchAppointments}
              disabled={apptLoading}
            >
              {apptLoading ? "Loading…" : "Refresh"}
            </PillButton>
          </div>

          <StatusMessage type={appointmentMessage?.type}>{appointmentMessage?.text}</StatusMessage>

          {doctorAppointments.length === 0 ? (
            <EmptyState
              icon="📅"
              title="No appointment requests pending"
              description="When patients schedule consultations with your wallet address, their booking requests will appear here for confirmation."
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {doctorAppointments.map((apt, i) => (
                <div
                  key={i}
                  className="glass-card spatial-layer-2"
                  style={{
                    padding: "16px 20px",
                    borderRadius: "var(--radius-spatial-md)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "12px",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>{apt.patientName}</strong>
                      <code style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--primary-dark)" }}>
                        {apt.patientId}
                      </code>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                      📅 {new Date(apt.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} at {apt.time} · Reason: {apt.reason}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        padding: "4px 12px",
                        borderRadius: "var(--radius-pill)",
                        background: apt.status === "confirmed" ? "var(--status-success-bg)" : "var(--status-warning-bg)",
                        color: apt.status === "confirmed" ? "var(--status-success-text)" : "var(--status-warning-text)",
                      }}
                    >
                      {apt.status}
                    </span>

                    {apt.status === "pending" && (
                      <PillButton
                        size="sm"
                        variant="primary"
                        disabled={confirmingId !== null}
                        onClick={() => confirmAppointment(apt.id)}
                      >
                        {confirmingId === apt.id ? "Confirming…" : "Confirm"}
                      </PillButton>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
